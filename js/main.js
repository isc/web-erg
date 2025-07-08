import { WorkoutRunner, parseAndDisplayZwo, parseZwoPhases } from './workout.js'
import {
  connect,
  connectHrm,
  setErgPower,
  setOnCadenceUpdate,
  setOnHeartRateUpdate,
  setOnPowerUpdate
} from './bluetooth.js'

const connectBtn = document.getElementById('connectBtn')
const connectHrmBtn = document.getElementById('connectHrmBtn')
const zwoFileInput = document.getElementById('zwoFileInput')
const workoutSvgEl = document.getElementById('workoutSvg')
const connectContainer = document.getElementById('connectContainer')
const workoutContainer = document.getElementById('workoutContainer')
const powerValueEl = document.getElementById('powerValue')
const cadenceValueEl = document.getElementById('cadenceValue')
const dashboardEl = document.getElementById('dashboard')
const timerValueEl = document.getElementById('timerValue')
const hrValueEl = document.getElementById('hrValue')

let isConnected = false
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

connectHrmBtn.addEventListener('click', async () => {
  const ok = await connectHrm()
  isConnected = ok
  updateUI()
})

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
setOnHeartRateUpdate(val => {
  hrValueEl.textContent = val
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
