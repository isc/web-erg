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

window.workoutApp = function () {
  return {
    isErgoConnected: false,
    isHrmConnected: false,
    workoutRunner: null,
    timerInterval: null,
    workoutSamples: [],
    lastSampleTime: null,
    workoutName: '',
    workoutDescription: '',
    workoutFinished: false,
    showZwoInput: true,
    showWorkoutSvg: false,
    showDashboard: false,
    power: '-',
    cadence: '-',
    heartRate: '-',
    timer: '0:00',
    workoutSelected: false,
    showForm: true,
    ftp: 150,
    weight: 70,
    get canStartWorkout() {
      return this.isErgoConnected && this.isHrmConnected && this.workoutSelected
    },
    async connectErgo() {
      this.isErgoConnected = await connectErgometer()
    },
    async connectHrm() {
      this.isHrmConnected = await connectHeartRateMonitor()
    },
    onZwoFileChange(e) {
      const file = e.target.files[0]
      if (!file) {
        this.workoutSelected = false
        return
      }
      this.workoutSelected = true
      const reader = new FileReader()
      reader.onload = event => {
        const xml = event.target.result
        const phases = parseZwoPhases(xml)
        const meta = parseZwoMeta(xml)
        this.workoutName = meta.name
        this.workoutDescription = meta.description
        if (this.workoutRunner) this.workoutRunner.stop()
        this.workoutRunner = new WorkoutRunner(
          phases,
          setErgPower,
          this.onWorkoutEnd.bind(this),
          this.ftp
        )
        parseAndDisplayZwo(xml, null, this.$refs.workoutSvg)
        this.showZwoInput = false
        this.workoutFinished = false
      }
      reader.readAsText(file)
    },
    startWorkout() {
      localStorage.setItem('ftp', this.ftp)
      localStorage.setItem('weight', this.weight)
      this.showWorkoutSvg = true
      this.showDashboard = true
      this.showForm = false
    },
    startTimerUI() {
      let start = Date.now()
      this.resetTimerUI()
      if (this.timerInterval) clearInterval(this.timerInterval)
      this.timerInterval = setInterval(() => {
        if (!this.workoutRunner?.isRunning()) return
        const elapsed = Math.floor((Date.now() - start) / 1000)
        const min = Math.floor(elapsed / 60)
        const sec = elapsed % 60
        this.timer = `${min}:${sec.toString().padStart(2, '0')}`
      }, 1000)
    },
    stopTimerUI() {
      if (this.timerInterval) clearInterval(this.timerInterval)
      this.timerInterval = null
      this.resetTimerUI()
    },
    resetTimerUI() {
      this.timer = '0:00'
      this.workoutSelected = false
    },
    addOrUpdateSample(sample) {
      const now = new Date()
      const iso = now.toISOString()
      if (!this.lastSampleTime || now - this.lastSampleTime > 1500) {
        this.workoutSamples.push({ time: iso })
        this.lastSampleTime = now
      }
      const last = this.workoutSamples[this.workoutSamples.length - 1]
      Object.assign(last, sample)
    },
    onWorkoutEnd() {
      this.stopTimerUI()
      this.workoutFinished = true
    },
    exportTcx() {
      let notes = ''
      if (this.workoutName) notes += this.workoutName
      if (this.workoutDescription)
        notes += (notes ? ' - ' : '') + this.workoutDescription
      downloadTcx(generateTcx(this.workoutSamples, notes, this.weight))
    },
    init() {
      const savedFtp = localStorage.getItem('ftp')
      if (savedFtp) this.ftp = parseInt(savedFtp)
      const savedWeight = localStorage.getItem('weight')
      if (savedWeight) this.weight = parseInt(savedWeight)

      setOnPowerUpdate(val => {
        this.power = val
        if (
          this.workoutRunner &&
          !this.workoutRunner.isRunning() &&
          Number(val) > 0 &&
          !this.workoutFinished
        ) {
          this.workoutRunner.start()
          this.startTimerUI()
        }
        if (this.workoutRunner?.isRunning())
          this.addOrUpdateSample({ power: val })
      })
      setOnCadenceUpdate(val => {
        this.cadence = val
        if (this.workoutRunner?.isRunning())
          this.addOrUpdateSample({ cadence: val })
      })
      setOnHeartRateUpdate(val => {
        this.heartRate = val
        if (this.workoutRunner?.isRunning())
          this.addOrUpdateSample({ heartRate: val })
      })
    }
  }
}
