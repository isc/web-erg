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

import { isTestEnv } from './utils.js'

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
    showZwoInput: true,
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
    phaseColor: '#ccc',
    wakeLock: null,
    isPaused: false,
    async requestWakeLock() {
      if ('wakeLock' in navigator)
        this.wakeLock = await navigator.wakeLock.request('screen')
    },
    async releaseWakeLock() {
      if (this.wakeLock) {
        await this.wakeLock.release()
        this.wakeLock = null
      }
    },
    async connectErgo() {
      this.ergometerName = await connectErgometer()
    },
    async connectHeartRateMonitor() {
      const { name, batteryLevel } = await connectHeartRateMonitor()
      this.heartRateMonitorName = name
      this.heartRateMonitorBatteryLevel = batteryLevel
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
    heartRateMonitorLabel() {
      if (!this.heartRateMonitorName) return 'Connecter'
      return `${this.heartRateMonitorName} - ${this.heartRateMonitorBatteryLevel}%`
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
        this.workoutMeta = parseZwoMeta(xml)
        if (this.workoutRunner) this.workoutRunner.stop()
        this.workoutRunner = new WorkoutRunner(
          phases,
          setErgPower,
          this.onWorkoutEnd.bind(this),
          this.ftp,
          this,
          this.$refs.workoutSvg
        )
        parseAndDisplayZwo(xml, this.$refs.workoutSvg)
        this.showZwoInput = false
        this.workoutFinished = false
      }
      reader.readAsText(file)
    },
    startWorkout() {
      if (!this.ergometerName || !this.heartRateMonitorName) return
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
        const totalElapsed = this.elapsedTime + currentElapsed
        const min = Math.floor(totalElapsed / 60)
        const sec = totalElapsed % 60
        this.timer = `${min}:${sec.toString().padStart(2, '0')}`
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
    init() {
      const savedFtp = localStorage.getItem('ftp')
      if (savedFtp) this.ftp = parseInt(savedFtp)
      const savedWeight = localStorage.getItem('weight')
      if (savedWeight) this.weight = parseInt(savedWeight)
    }
  }
}
