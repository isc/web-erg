import { WorkoutRunner, parseAndDisplayZwo, parseZwoPhases } from './workout.js'
import {
  connect,
  setErgPower,
  setOnCadenceUpdate,
  setOnPowerUpdate
} from './bluetooth.js'

const connectBtn = document.getElementById('connectBtn')
const zwoFileInput = document.getElementById('zwoFileInput')
const workoutSvgEl = document.getElementById('workoutSvg')
const connectContainer = document.getElementById('connectContainer')
const workoutContainer = document.getElementById('workoutContainer')
const powerValueEl = document.getElementById('powerValue')
const cadenceValueEl = document.getElementById('cadenceValue')
const dashboardEl = document.getElementById('dashboard')
const timerValueEl = document.getElementById('timerValue')

let isConnected = false
let workoutStarted = false
let workoutInterval = null
let currentPhaseIndex = 0
let currentPhaseElapsed = 0
let expandedPhases = []
let workoutRunner = null
let timerInterval = null

function updateUI() {
  if (!isConnected) {
    connectContainer.style.display = 'flex'
    workoutContainer.style.display = 'none'
  } else {
    connectContainer.style.display = 'none'
    workoutContainer.style.display = 'flex'
  }
}

updateUI()

connectBtn.addEventListener('click', async () => {
  const ok = await connect()
  isConnected = ok
  updateUI()
})

function expandPhases(phases) {
  // Déroule les IntervalsT en On/Off pour séquencement simple
  let expanded = []
  for (const p of phases) {
    if (p.type === 'IntervalsT') {
      const repeat = parseInt(p.repeat) || 1
      for (let i = 0; i < repeat; i++) {
        expanded.push({
          type: 'On',
          duration: parseFloat(p.onDuration),
          power: parseFloat(p.onPower)
        })
        expanded.push({
          type: 'Off',
          duration: parseFloat(p.offDuration),
          power: parseFloat(p.offPower)
        })
      }
    } else if (
      p.type === 'SteadyState' ||
      p.type === 'Warmup' ||
      p.type === 'Cooldown'
    ) {
      // Pour Warmup/Cooldown, on prend powerLow comme consigne de départ
      expanded.push({
        type: p.type,
        duration: parseFloat(p.duration),
        power: p.power
          ? parseFloat(p.power)
          : p.powerLow
          ? parseFloat(p.powerLow)
          : 0
      })
    } else if (p.type === 'Ramp') {
      // Pour Ramp, on va interpoler la puissance à chaque tick
      expanded.push({
        type: 'Ramp',
        duration: parseFloat(p.duration),
        powerLow: parseFloat(p.powerLow),
        powerHigh: parseFloat(p.powerHigh)
      })
    } else if (p.type === 'FreeRide') {
      expanded.push({
        type: 'FreeRide',
        duration: parseFloat(p.duration),
        power: 0
      })
    }
  }
  return expanded
}

function startWorkout() {
  if (workoutStarted || expandedPhases.length === 0) return
  workoutStarted = true
  workoutStartTime = Date.now()
  currentPhaseIndex = 0
  currentPhaseElapsed = 0
  sendCurrentErg()
  workoutInterval = setInterval(tickWorkout, 1000)
}

function stopWorkout() {
  workoutStarted = false
  if (workoutInterval) clearInterval(workoutInterval)
  workoutInterval = null
}

function sendCurrentErg() {
  const phase = expandedPhases[currentPhaseIndex]
  if (!phase) return
  let targetPower = 0
  if (phase.type === 'Ramp') {
    // Interpolation linéaire
    const t = currentPhaseElapsed
    const d = phase.duration
    targetPower = phase.powerLow + (phase.powerHigh - phase.powerLow) * (t / d)
  } else {
    targetPower = phase.power
  }
  if (phase.type !== 'FreeRide') {
    setErgPower(Math.round(targetPower * 1)) // *1 pour compatibilité, à adapter si FTP
  }
}

function tickWorkout() {
  if (!workoutStarted) return
  const phase = expandedPhases[currentPhaseIndex]
  if (!phase) {
    stopWorkout()
    return
  }
  currentPhaseElapsed++
  if (currentPhaseElapsed >= phase.duration) {
    currentPhaseIndex++
    currentPhaseElapsed = 0
    if (currentPhaseIndex >= expandedPhases.length) {
      stopWorkout()
      return
    }
  }
  sendCurrentErg()
}

function resetTimerUI() {
  timerValueEl.textContent = '0:00'
}

function startTimerUI() {
  let start = Date.now()
  resetTimerUI()
  if (timerInterval) clearInterval(timerInterval)
  timerInterval = setInterval(() => {
    if (!workoutRunner || !workoutRunner.isRunning()) return
    const elapsed = Math.floor((Date.now() - start) / 1000)
    const min = Math.floor(elapsed / 60)
    const sec = elapsed % 60
    timerValueEl.textContent = `${min}:${sec.toString().padStart(2, '0')}`
  }, 1000)
}

function stopTimerUI() {
  if (timerInterval) clearInterval(timerInterval)
  timerInterval = null
  resetTimerUI()
}

setOnPowerUpdate(val => {
  powerValueEl.textContent = val
  if (workoutRunner && !workoutRunner.isRunning() && Number(val) > 0) {
    workoutRunner.start()
    startTimerUI()
  }
})
setOnCadenceUpdate(val => {
  cadenceValueEl.textContent = val
})

zwoFileInput.addEventListener(
  'change',
  e => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = function (event) {
      const xml = event.target.result
      const phases = parseZwoPhases(xml)
      if (workoutRunner) workoutRunner.stop()
      workoutRunner = new WorkoutRunner(phases, setErgPower, onWorkoutEnd)
      parseAndDisplayZwo(xml, null, workoutSvgEl)
      zwoFileInput.style.display = 'none'
      workoutSvgEl.style.display = 'block'
      dashboardEl.style.display = 'block'
      stopTimerUI()
    }
    reader.readAsText(file)
  },
  false
)

function onWorkoutEnd() {
  stopTimerUI()
}
