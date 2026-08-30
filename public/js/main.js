import { WorkoutRunner, parseZwoMeta, parseZwoPhases } from './workout.js'
import {
  bluetoothAvailable,
  connectErgometer,
  connectHeartRateMonitor,
  setErgPower,
  setOnCadenceUpdate,
  setOnConnectionChange,
  setOnHeartRateUpdate,
  setOnPowerUpdate
} from './bluetooth.js'
import { expandPhases } from './phases.js'
import {
  downloadDataUrl,
  formatDuration,
  formatForTimer,
  isTestEnv,
  parseXmlDoc
} from './utils.js'
import { downloadTcx, generateTcx } from './tcx-export.js'

import { renderWorkoutSvg } from './workout-rendering.js'

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
    heartRateMonitorBatteryLevel: null,
    heartRateMonitorConnecting: false,
    selectedWorkout: null,
    cadenceTarget: null,
    screenshotDataUrl: null,
    screenshotPending: false,
    startError: null,
    connectionWarning: null,

    // Drives the "Bluetooth not supported" modal. Availability is the Bluetooth module's question:
    // it is the one that swaps in the mock, and headless browsers expose no navigator.bluetooth, so
    // asking navigator directly here left the modal covering the page for the whole test suite.
    get bluetoothUnavailable() {
      return !bluetoothAvailable()
    },

    formatDuration,

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
      this.heartRateMonitorConnecting = true
      const heartRateMonitor = await connectHeartRateMonitor()
      this.heartRateMonitorConnecting = false
      if (!heartRateMonitor) return
      this.heartRateMonitorName = heartRateMonitor.name
      this.heartRateMonitorBatteryLevel = heartRateMonitor.batteryLevel
    },
    get heartRateMonitorButtonLabel() {
      if (this.heartRateMonitorConnecting) return 'Connecting...'
      if (!this.heartRateMonitorName) return 'Connect'
      const parts = [this.heartRateMonitorName]
      // A watch broadcasting its heart rate usually exposes no battery service, and the label read
      // "null%" — which says nothing beyond the fact that we asked.
      if (this.heartRateMonitorBatteryLevel != null)
        parts.push(`${this.heartRateMonitorBatteryLevel}%`)
      // Showing the live rate is the only way to tell, before starting, that the strap or the watch
      // is actually sending something.
      if (this.heartRate !== '-') parts.push(`${this.heartRate} bpm`)
      return parts.join(' · ')
    },
    // Device callbacks belong to the page, not to a running workout: a trainer that drops while
    // the rider is still choosing a workout has to show something too.
    registerDeviceCallbacks() {
      setOnConnectionChange((device, state) => {
        const label = device === 'ergometer' ? 'Bike' : 'Heart rate monitor'
        if (state === 'connected') this.connectionWarning = null
        else if (state === 'reconnecting')
          this.connectionWarning = `${label} disconnected — reconnecting…`
        else
          this.connectionWarning = `${label} lost. Check it, then reconnect it.`
      })
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
    captureScreenshot() {
      // screenshotDataUrl used to double as the in-flight marker, holding `true` during the
      // capture. Exporting before it resolved then downloaded a file whose href was the string
      // "true" — a 404 page saved as .png.
      if (this.screenshotPending || this.screenshotDataUrl) return
      this.screenshotPending = true
      html2canvas(document.documentElement)
        .then(canvas => {
          this.screenshotDataUrl = canvas.toDataURL('image/png')
        })
        .catch(e => {
          console.warn('html2canvas capture failed', e)
        })
        .finally(() => {
          this.screenshotPending = false
        })
    },
    loadWorkoutFromXml(xml) {
      // Parsed once and passed around: the phases, the metadata and the audio coach all used to
      // run their own DOMParser over the same string.
      const xmlDoc = parseXmlDoc(xml)
      const rawPhases = parseZwoPhases(xmlDoc)
      const phases = expandPhases(rawPhases)
      this.workoutMeta = parseZwoMeta(xmlDoc, phases)
      this.workoutRunner?.stop()
      this.workoutRunner = new WorkoutRunner(
        phases,
        setErgPower,
        this.onWorkoutEnd.bind(this),
        this.ftp,
        this,
        this.$refs.workoutSvg,
        xmlDoc,
        rawPhases
      )
      renderWorkoutSvg(phases, this.$refs.workoutSvg)
      this.workoutFinished = false
      this.workoutSelected = true
      this.startError = null
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
      // The heart rate monitor used to be required, and a missing one made this method return
      // silently: pressing Start did nothing at all, with nothing on screen to say why.
      this.startError = null
      if (!this.ergometerName) {
        this.startError = 'Connect your bike before starting.'
        return
      }
      if (!this.workoutSelected) {
        this.startError = 'Choose a workout before starting.'
        return
      }
      if (!isTestEnv()) document.documentElement.requestFullscreen?.()
      localStorage.setItem('ftp', this.ftp)
      localStorage.setItem('weight', this.weight)
      this.showWorkout = true
      this.showForm = false
      this.requestWakeLock()
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
    exportActivity() {
      let notes = ''
      if (this.workoutMeta?.name) notes += this.workoutMeta?.name
      if (this.workoutMeta?.description)
        notes += (notes ? ' - ' : '') + this.workoutMeta?.description
      downloadTcx(generateTcx(this.workoutSamples, notes, this.weight))
      if (this.screenshotDataUrl)
        downloadDataUrl(this.screenshotDataUrl, '.png')
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
      this.registerDeviceCallbacks()
      const savedFtp = localStorage.getItem('ftp')
      if (savedFtp) this.ftp = parseInt(savedFtp)
      const savedWeight = localStorage.getItem('weight')
      if (savedWeight) this.weight = parseInt(savedWeight)
    }
  }
}
