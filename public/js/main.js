import { WorkoutRunner, parseZwoMeta, parseZwoPhases } from './workout.js'
import {
  bluetoothAvailable,
  connectErgometer,
  connectHeartRateMonitor,
  describeConnectionFailure,
  setOnLog,
  setErgPower,
  setOnCadenceUpdate,
  setOnConnectionChange,
  setOnHeartRateUpdate,
  setOnPowerUpdate
} from './bluetooth.js'
import { expandPhases } from './phases.js'
import { clearSession, loadSession, saveSession } from './session-store.js'
import {
  downloadDataUrl,
  formatCountdown,
  formatDuration,
  formatForTimer,
  isTestEnv,
  parseXmlDoc
} from './utils.js'
import { downloadTcx, generateTcx } from './tcx-export.js'

import { renderWorkoutSvg } from './workout-rendering.js'
import { getZoneColor } from './zones.js'
import { metric, summariseSession, zoneShare } from './session-summary.js'

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
    phaseSecondsRemaining: 0,
    wakeLock: null,
    isPaused: false,
    ergometerConnecting: false,
    heartRateMonitorBatteryLevel: null,
    heartRateMonitorConnecting: false,
    selectedWorkout: null,
    cadenceTarget: null,
    phase: null,
    nextPhase: null,
    phaseSecondsRemaining: 0,
    elapsedSeconds: 0,
    screenshotDataUrl: null,
    screenshotPending: false,
    startError: null,
    connectionWarning: null,
    deviceError: null,
    deviceLog: [],
    recoveredSession: null,
    persistInterval: null,
    summary: null,

    // Drives the "Bluetooth not supported" modal. Availability is the Bluetooth module's question:
    // it is the one that swaps in the mock, and headless browsers expose no navigator.bluetooth, so
    // asking navigator directly here left the modal covering the page for the whole test suite.
    get bluetoothUnavailable() {
      return !bluetoothAvailable()
    },

    formatDuration,
    metric,
    zoneShare,

    // The zone rows, or none: the markup asks for them four times and should not have to spell out
    // that there may be no summary yet each time.
    get zones() {
      return this.summary?.zones || []
    },

    // The path the workout was loaded from, when it came from the bundled library: the LLM coach
    // endpoint reads the ZWO server-side from it.
    loadedWorkoutPath: null,

    async requestWakeLock() {
      try {
        this.wakeLock = await navigator.wakeLock?.request('screen')
      } catch (error) {
        // Refused on a hidden document, and in headless browsers. Not worth interrupting a ride.
        console.warn('Screen wake lock refused: ' + error)
      }
    },
    async releaseWakeLock() {
      await this.wakeLock?.release()
      this.wakeLock = null
    },
    async connectErgo() {
      this.deviceError = null
      this.ergometerConnecting = true
      try {
        this.ergometerName = await connectErgometer()
      } catch (error) {
        this.deviceError = describeConnectionFailure('Bike', error)
      } finally {
        this.ergometerConnecting = false
      }
    },
    get ergometerButtonLabel() {
      if (this.ergometerConnecting) return 'Connecting...'
      return this.ergometerName || 'Connect'
    },
    async connectHeartRateMonitor() {
      this.deviceError = null
      this.heartRateMonitorConnecting = true
      try {
        const monitor = await connectHeartRateMonitor()
        this.heartRateMonitorName = monitor.name
        this.heartRateMonitorBatteryLevel = monitor.batteryLevel
      } catch (error) {
        this.deviceError = describeConnectionFailure('Heart rate monitor', error)
      } finally {
        this.heartRateMonitorConnecting = false
      }
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
        rawPhases,
        this.loadedWorkoutPath
      )
      renderWorkoutSvg(phases, this.$refs.workoutSvg)
      // The previous ride's numbers have nothing to say about the one being loaded.
      this.summary = null
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
      this.startPersisting()
    },
    startTimerUI() {
      this.timerStartTime = Date.now()
      // Immediately, not on the first tick: otherwise the cockpit shows a blank countdown for the
      // first second of every phase-driven start.
      this.workoutRunner?.publishPhase()
      if (this.timerInterval) clearInterval(this.timerInterval)
      this.timerInterval = setInterval(() => {
        if (!this.workoutRunner?.isRunning()) return
        const currentElapsed = Math.floor(
          (Date.now() - this.timerStartTime) / 1000
        )
        this.elapsedSeconds = this.elapsedTime + currentElapsed
        this.timer = formatForTimer(this.elapsedSeconds)
        this.cadenceTarget = this.workoutRunner.getCurrentCadenceTarget()
      }, 1000)
    },
    get phaseZone() {
      return getZoneColor(this.phase?.relative ?? 0)
    },
    get phaseCountdown() {
      return formatCountdown(this.phaseSecondsRemaining)
    },
    get phaseTimeRemaining() {
      return formatForTimer(this.phaseSecondsRemaining)
    },
    get sessionProgress() {
      // The same elapsed count the timer prints beside it, rather than a second tally of its own.
      const total = this.workoutRunner?.totalDurationSeconds
      if (!total) return 0
      return Math.min(100, (this.elapsedSeconds / total) * 100)
    },
    // Both sides of the session line are clock readings — "0:02 / 50:50". formatDuration is for
    // prose, as in "Effort 10 s".
    get sessionTotal() {
      return formatForTimer(this.workoutRunner?.totalDurationSeconds || 0)
    },
    get cadenceTargetLabel() {
      const target = this.cadenceTarget
      if (!target) return ''
      return target.type === 'range'
        ? ` ↑${target.min}-${target.max}`
        : ` ↑${target.target}`
    },
    // The rounding rule lives here once. The two callers differ only in whether the watts belong:
    // the phase on screen already shows them in the row below, the next phase does not.
    phasePercent(phase) {
      if (!phase) return ''
      return phase.relative == null
        ? 'free ride'
        : `${Math.round(phase.relative * 100)} % FTP`
    },
    phaseIntensity(phase) {
      const percent = this.phasePercent(phase)
      return phase?.watts == null ? percent : `${percent} · ${phase.watts} W`
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
    // Every ten seconds rather than on every notification: samples arrive several times a second,
    // and re-serialising the whole ride each time would cost more than the ride is worth.
    startPersisting() {
      const persist = () => this.persistSession()
      if (this.persistInterval) clearInterval(this.persistInterval)
      this.persistInterval = setInterval(persist, 10000)
    },
    stopPersisting() {
      if (this.persistInterval) clearInterval(this.persistInterval)
      this.persistInterval = null
    },
    persistSession() {
      if (!this.workoutSamples.length) return
      saveSession({
        savedAt: new Date().toISOString(),
        name: this.workoutMeta?.name,
        notes: this.activityNotes(),
        weight: this.weight,
        samples: this.workoutSamples
      })
    },
    activityNotes() {
      return [this.workoutMeta?.name, this.workoutMeta?.description]
        .filter(Boolean)
        .join(' - ')
    },
    discardRecoveredSession() {
      this.recoveredSession = null
      clearSession()
    },
    exportRecoveredSession() {
      const session = this.recoveredSession
      downloadTcx(generateTcx(session.samples, session.notes, session.weight))
      this.discardRecoveredSession()
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
      // Computed once, here, rather than in a getter: a getter would re-walk every second of the
      // ride on each of Alpine's re-renders, and the samples stop changing the moment this runs.
      this.summary = summariseSession(this.workoutSamples, this.ftp)
      this.workoutFinished = true
      this.isPaused = false
      this.releaseWakeLock()
      this.stopPersisting()
      // A last write, so what is on disk covers the ride to its final second.
      this.persistSession()
    },
    exportActivity() {
      downloadTcx(
        generateTcx(this.workoutSamples, this.activityNotes(), this.weight)
      )
      if (this.screenshotDataUrl)
        downloadDataUrl(this.screenshotDataUrl, '.png')
      // Exported means safe: nothing left to offer on the next load.
      clearSession()
    },
    async loadWorkoutFromLibrary(workoutUrl) {
      try {
        const workoutPath = `zwift_workouts_all_collections_ordered_Mar21/${workoutUrl}`
        const response = await fetch(workoutPath)
        if (!response.ok)
          throw new Error(`Failed to load workout: ${response.status}`)

        const xml = await response.text()
        this.loadedWorkoutPath = workoutPath
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
      setOnLog(message => {
        // Bounded: a long session with a flapping device would otherwise grow without end.
        this.deviceLog = [
          ...this.deviceLog.slice(-49),
          { at: new Date().toLocaleTimeString(), message }
        ]
      })
      this.recoveredSession = loadSession()
      this.registerDeviceCallbacks()
      // The browser drops a screen wake lock the moment the page is hidden, and never restores it
      // on its own. One glance at another window and the screen is free to sleep for the rest of
      // the session — taking any AirPlay mirror with it.
      document.addEventListener('visibilitychange', () => {
        if (
          document.visibilityState === 'visible' &&
          this.showWorkout &&
          !this.workoutFinished
        )
          this.requestWakeLock()
      })
      const savedFtp = localStorage.getItem('ftp')
      if (savedFtp) this.ftp = parseInt(savedFtp)
      const savedWeight = localStorage.getItem('weight')
      if (savedWeight) this.weight = parseInt(savedWeight)
    }
  }
}
