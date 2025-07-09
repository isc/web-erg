import {
  WorkoutRunner,
  parseAndDisplayZwo,
  parseZwoMeta,
  parseZwoPhases
} from './workout.js'
import {
  connectErgometer,
  connectHeartRateMonitor,
  setErgPower,
  setOnCadenceUpdate,
  setOnHeartRateUpdate,
  setOnPowerUpdate
} from './bluetooth.js'
import { downloadTcx, generateTcx } from './tcx-export.js'

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

let isErgoConnected = false
let isHrmConnected = false
let workoutRunner = null
let timerInterval = null
let workoutSamples = []
let lastSampleTime = null
let workoutName = ''
let workoutDescription = ''
let workoutFinished = false

function updateUI() {
  if (!isErgoConnected || !isHrmConnected) {
    connectContainer.style.display = 'flex'
    workoutContainer.style.display = 'none'
    zwoFileInput.disabled = true
  } else {
    connectContainer.style.display = 'none'
    workoutContainer.style.display = 'flex'
    zwoFileInput.disabled = false
  }
}

updateUI()

connectBtn.addEventListener('click', async () => {
  const ok = await connectErgometer()
  isErgoConnected = ok
  updateUI()
})

connectHrmBtn.addEventListener('click', async () => {
  const ok = await connectHeartRateMonitor()
  isHrmConnected = ok
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
    if (!workoutRunner?.isRunning()) return
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
  if (
    workoutRunner &&
    !workoutRunner.isRunning() &&
    Number(val) > 0 &&
    !workoutFinished
  ) {
    workoutRunner.start()
    startTimerUI()
  }
  if (workoutRunner?.isRunning()) addOrUpdateSample({ power: val })
})
setOnCadenceUpdate(val => {
  cadenceValueEl.textContent = val
  if (workoutRunner?.isRunning()) addOrUpdateSample({ cadence: val })
})
setOnHeartRateUpdate(val => {
  hrValueEl.textContent = val
  if (workoutRunner?.isRunning()) addOrUpdateSample({ heartRate: val })
})

function addOrUpdateSample(sample) {
  const now = new Date()
  const iso = now.toISOString()
  if (!lastSampleTime || now - lastSampleTime > 1500) {
    workoutSamples.push({ time: iso })
    lastSampleTime = now
  }
  const last = workoutSamples[workoutSamples.length - 1]
  Object.assign(last, sample)
}

zwoFileInput.addEventListener(
  'change',
  e => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = function (event) {
      const xml = event.target.result
      const phases = parseZwoPhases(xml)
      const meta = parseZwoMeta(xml)
      workoutName = meta.name
      workoutDescription = meta.description
      if (workoutRunner) workoutRunner.stop()
      workoutRunner = new WorkoutRunner(phases, setErgPower, onWorkoutEnd)
      parseAndDisplayZwo(xml, null, workoutSvgEl)
      zwoFileInput.style.display = 'none'
      workoutSvgEl.style.display = 'block'
      dashboardEl.style.display = 'block'
      stopTimerUI()
      workoutFinished = false
    }
    reader.readAsText(file)
  },
  false
)

function onWorkoutEnd() {
  stopTimerUI()
  workoutFinished = true
  let notes = ''
  if (workoutName) notes += workoutName
  if (workoutDescription) notes += (notes ? ' - ' : '') + workoutDescription
  let exportBtn = document.getElementById('exportTcxBtn')
  let endMsg = document.getElementById('workoutEndMsg')
  if (!endMsg) {
    endMsg = document.createElement('div')
    endMsg.id = 'workoutEndMsg'
    endMsg.textContent = 'Workout terminé !'
    endMsg.style.fontSize = '1.3em'
    endMsg.style.margin = '1em 0 0.5em 0'
    endMsg.style.color = '#4caf50'
    dashboardEl.appendChild(endMsg)
  }
  if (!exportBtn) {
    exportBtn = document.createElement('button')
    exportBtn.id = 'exportTcxBtn'
    exportBtn.textContent = 'Exporter TCX'
    exportBtn.style.margin = '1em'
    dashboardEl.appendChild(exportBtn)
  }
  exportBtn.onclick = () => downloadTcx(generateTcx(workoutSamples, notes))
}
