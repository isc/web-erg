import { WorkoutRunner, parseZwoMeta, parseZwoPhases } from './workout.js'
import { renderWorkoutSvg } from './workout-rendering.js'
import {
  connectErgometer,
  connectHeartRateMonitor,
  setErgPower,
  setOnCadenceUpdate,
  setOnHeartRateUpdate,
  setOnPowerUpdate
} from './bluetooth.js'
import { downloadTcx, generateTcx } from './tcx-export.js'
import { formatForTimer, isTestEnv } from './utils.js'

window.workoutApp = function () {
  return {
    ergometerName: null,
    heartRateMonitorName: null,
    workoutRunner: null,
    timerInterval: null,
    workoutSamples: [],
    lastSampleTime: null,
    workoutMeta: null,
    workoutFinished: false,
    elapsedTime: 0,
    timerStartTime: null,
    showWorkout: false,
    power: '-',
    cadence: '-',
    heartRate: '-',
    timer: '0:00',
    workoutSelected: false,
    showForm: true,
    ftp: 150,
    weight: 70,
    phaseProgress: 0,
    phaseTimeRemaining: '0:00',
    wakeLock: null,
    isPaused: false,
    ergometerButtonLabel: 'Connect',
    heartRateMonitorButtonLabel: 'Connect',
    selectedWorkout: null,
    cadenceTarget: null,

    async requestWakeLock() {
      this.wakeLock = await navigator.wakeLock?.request('screen')
    },
    async releaseWakeLock() {
      await this.wakeLock?.release()
      this.wakeLock = null
    },
    async connectErgo() {
      this.ergometerButtonLabel = 'Connecting...'
      this.ergometerName = await connectErgometer()
      this.ergometerButtonLabel = this.ergometerName || 'Connect'
    },
    async connectHeartRateMonitor() {
      this.heartRateMonitorButtonLabel = 'Connecting...'
      const heartRateMonitor = await connectHeartRateMonitor()
      if (!heartRateMonitor) {
        this.heartRateMonitorButtonLabel = 'Connect'
        return
      }
      this.heartRateMonitorName = heartRateMonitor.name
      this.heartRateMonitorBatteryLevel = heartRateMonitor.batteryLevel
      this.heartRateMonitorButtonLabel = `${this.heartRateMonitorName} - ${this.heartRateMonitorBatteryLevel}%`
    },
    setCallbacks() {
      setOnPowerUpdate(val => {
        this.power = val
        if (
          !this.workoutRunner.isRunning() &&
          Number(val) > 0 &&
          !this.workoutFinished
        ) {
          this.workoutRunner.start()
          this.startTimerUI()
        }
        this.addOrUpdateSample({ power: val })
      })
      setOnCadenceUpdate(val => {
        this.cadence = val
        val === '-' ? this.pauseWorkout() : this.resumeWorkout()
        this.addOrUpdateSample({ cadence: val })
      })
      setOnHeartRateUpdate(val => {
        this.heartRate = val
        this.addOrUpdateSample({ heartRate: val })
      })
    },
    loadWorkoutFromXml(xml) {
      const phases = parseZwoPhases(xml)
      console.log({ phases })
      this.workoutMeta = parseZwoMeta(xml)
      this.workoutRunner?.stop()
      this.workoutRunner = new WorkoutRunner(
        phases,
        setErgPower,
        this.onWorkoutEnd.bind(this),
        this.ftp,
        this,
        this.$refs.workoutSvg,
        xml
      )
      renderWorkoutSvg(phases, this.$refs.workoutSvg)
      this.workoutFinished = false
      this.workoutSelected = true
    },
    onZwoFileChange(e) {
      const file = e.target.files[0]
      if (!file) {
        this.workoutSelected = false
        return
      }
      const reader = new FileReader()
      reader.onload = event => {
        this.loadWorkoutFromXml(event.target.result)
      }
      reader.readAsText(file)
    },
    startWorkout() {
      if (
        !this.ergometerName ||
        !this.heartRateMonitorName ||
        !this.workoutSelected
      )
        return
      if (!isTestEnv()) document.documentElement.requestFullscreen?.()
      localStorage.setItem('ftp', this.ftp)
      localStorage.setItem('weight', this.weight)
      this.showWorkout = true
      this.showForm = false
      this.requestWakeLock()
      this.setCallbacks()
    },
    startTimerUI() {
      this.timerStartTime = Date.now()
      if (this.timerInterval) clearInterval(this.timerInterval)
      this.timerInterval = setInterval(() => {
        if (!this.workoutRunner?.isRunning()) return
        const currentElapsed = Math.floor(
          (Date.now() - this.timerStartTime) / 1000
        )
        this.timer = formatForTimer(this.elapsedTime + currentElapsed)
        this.cadenceTarget = this.workoutRunner.getCurrentCadenceTarget()
      }, 1000)
    },
    stopTimerUI() {
      if (this.timerInterval) clearInterval(this.timerInterval)
      this.timerInterval = null
      if (this.timerStartTime) {
        this.elapsedTime += Math.floor(
          (Date.now() - this.timerStartTime) / 1000
        )
        this.timerStartTime = null
      }
    },
    pauseWorkout() {
      if (!this.isPaused && this.workoutRunner?.isRunning()) {
        this.isPaused = true
        this.stopTimerUI()
        this.workoutRunner.pause()
      }
    },
    resumeWorkout() {
      if (this.isPaused && this.workoutRunner?.isRunning()) {
        this.isPaused = false
        this.startTimerUI()
        this.workoutRunner.resume?.()
      }
    },
    addOrUpdateSample(sample) {
      if (!this.workoutRunner?.isRunning() || this.isPaused) return
      const now = new Date()
      const iso = now.toISOString()
      if (!this.lastSampleTime || now - this.lastSampleTime > 1500) {
        this.workoutSamples.push({ time: iso })
        this.lastSampleTime = now
      }
      const last = this.workoutSamples[this.workoutSamples.length - 1]
      Object.assign(last, sample)
    },
    stopWorkout() {
      this.workoutRunner.stop()
    },
    onWorkoutEnd() {
      this.stopTimerUI()
      this.workoutFinished = true
      this.isPaused = false
      this.releaseWakeLock()
    },
    exportTcx() {
      let notes = ''
      if (this.workoutMeta?.name) notes += this.workoutMeta?.name
      if (this.workoutMeta?.description)
        notes += (notes ? ' - ' : '') + this.workoutMeta?.description
      downloadTcx(generateTcx(this.workoutSamples, notes, this.weight))
    },
    async loadWorkoutFromLibrary(workoutUrl) {
      try {
        const workoutPath = `zwift_workouts_all_collections_ordered_Mar21/${workoutUrl}`
        const response = await fetch(workoutPath)
        if (!response.ok)
          throw new Error(`Failed to load workout: ${response.status}`)

        const xml = await response.text()
        this.loadWorkoutFromXml(xml)
        return true
      } catch (error) {
        console.error('Error loading workout:', error)
        alert('Error loading workout')
        return false
      }
    },
    getCadenceStatus() {
      if (!this.cadenceTarget || this.cadence === '-') return ''
      const currentCadence = parseFloat(this.cadence)
      if (isNaN(currentCadence)) return ''
      if (this.cadenceTarget.type === 'fixed') {
        const target = this.cadenceTarget.target
        const tolerance = 5
        if (Math.abs(currentCadence - target) <= tolerance)
          return 'cadence-good'
        else return 'cadence-warning'
      } else if (this.cadenceTarget.type === 'range') {
        if (
          currentCadence >= this.cadenceTarget.min &&
          currentCadence <= this.cadenceTarget.max
        )
          return 'cadence-good'
        else return 'cadence-warning'
      }
      return ''
    },
    init() {
      const savedFtp = localStorage.getItem('ftp')
      if (savedFtp) this.ftp = parseInt(savedFtp)
      const savedWeight = localStorage.getItem('weight')
      if (savedWeight) this.weight = parseInt(savedWeight)
    }
  }
}
