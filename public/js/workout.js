import { formatForTimer } from './utils.js'
import { phaseLabel, totalDurationSeconds } from './phases.js'

import { AudioCoach } from './audio-coach.js'

export class WorkoutRunner {
  constructor({
    expandedPhases,
    setErgPower,
    onWorkoutEnd,
    ftp = null,
    alpineInstance,
    workoutSvgEl,
    xmlDoc,
    rawPhases,
    xmlPath = null
  }) {
    this.expandedPhases = expandedPhases
    this.totalDurationSeconds = totalDurationSeconds(expandedPhases)
    this.setErgPower = setErgPower
    this.onWorkoutEnd = onWorkoutEnd
    this.fixedFtp = ftp
    this.currentPhaseIndex = 0
    this.currentPhaseElapsed = 0
    // Metres, as the erg counts them. Absolute, and reset by nothing: the phase records where it
    // started rather than the counter being zeroed, so a machine that never restarts its odometer
    // and one that does are the same problem.
    this.distance = 0
    this.phaseStartDistance = 0
    this.timer = null
    this.running = false
    this.alpineInstance = alpineInstance
    this.workoutSvgEl = workoutSvgEl
    this.xmlDoc = xmlDoc
    this.rawPhases = rawPhases
    this.xmlPath = xmlPath
    this.initializeAudioCoach()
  }

  /**
   * Read, not copied. A workout can be loaded before any machine is connected, and which of the
   * two FTPs applies is not knowable until one is — a rowing FTP is a different quantity from a
   * cycling one. Snapshotting it at construction meant every wattage on screen had to be
   * recomputed by hand at Start, and anything derived in between stayed quietly stale.
   */
  get ftp() {
    return this.alpineInstance?.trainingFtp ?? this.fixedFtp
  }

  async initializeAudioCoach() {
    this.audioCoach = new AudioCoach()
    // The LLM coach needs the workout's path: the server reads the ZWO from it. Without one — a
    // file the rider dropped in — fall back to the workout's own recorded text events.
    if (this.xmlPath) {
      this.audioCoach.useLlmCoach(
        () => this.buildLlmWorkoutState(),
        this.xmlPath
      )
      return
    }
    const audioReady = await this.audioCoach.loadTextEvents(
      this.xmlDoc,
      this.rawPhases
    )
    if (!audioReady) this.audioCoach = null
  }

  // The athlete's live state, as sent to the coach on each poll.
  buildLlmWorkoutState() {
    const phase = this.expandedPhases[this.currentPhaseIndex]
    return {
      currentTime: this.totalElapsed || 0,
      phaseIndex: this.currentPhaseIndex,
      phaseElapsed: this.currentPhaseElapsed,
      phase: phase,
      heartRate: this.alpineInstance ? this.alpineInstance.heartRate : null,
      cadence: this.alpineInstance ? this.alpineInstance.cadence : null,
      power: this.alpineInstance ? this.alpineInstance.power : null,
      ftp: this.ftp,
      running: this.running
    }
  }

  /** Metres rowed since the current phase opened, which is what ends a phase measured in them. */
  get phaseDistance() {
    return this.distance - this.phaseStartDistance
  }

  /**
   * How far through the phase is, and how much of it is left — in whichever unit the phase is
   * written in. A distance phase counts down in metres because that is what the rower is being
   * asked for; its estimated duration would count down to zero while there were still metres to
   * row, which is worse than useless.
   */
  updatePhaseProgressBar() {
    if (!this.alpineInstance) return
    const phase = this.expandedPhases[this.currentPhaseIndex]
    const total = phase?.distance || phase?.duration
    const done = phase?.distance ? this.phaseDistance : this.currentPhaseElapsed
    if (!total) {
      this.alpineInstance.phaseProgress = 0
      this.alpineInstance.phaseSecondsRemaining = 0
      this.alpineInstance.phaseMetresRemaining = 0
      return
    }
    const percent = Math.min(done / total, 1) * 100
    this.alpineInstance.phaseProgress = isNaN(percent) ? 0 : percent

    const remaining = Math.max(0, Math.round(total - done))
    this.alpineInstance.phaseSecondsRemaining = phase.distance ? 0 : remaining
    this.alpineInstance.phaseMetresRemaining = phase.distance ? remaining : 0
  }

  /**
   * Pushed when the phase changes rather than polled every second: a phase lasts minutes, and
   * reassigning freshly built objects each tick made every binding that reads them look changed.
   */
  publishPhase() {
    if (!this.alpineInstance) return
    this.alpineInstance.phase = {
      ...this.phaseSummary(this.currentPhaseIndex),
      number: this.currentPhaseIndex + 1,
      count: this.expandedPhases.length
    }
    this.alpineInstance.nextPhase = this.phaseSummary(this.currentPhaseIndex + 1)
  }

  updatePhaseClasses() {
    if (this.renderedPhase === this.currentPhaseIndex) return
    this.renderedPhase = this.currentPhaseIndex
    const svg = this.workoutSvgEl.querySelector('svg')
    if (!svg) return
    let current = null
    svg.querySelectorAll('[data-phase-index]').forEach((el, i) => {
      el.classList.remove('phase-completed', 'phase-current')
      if (i < this.currentPhaseIndex) el.classList.add('phase-completed')
      else if (i === this.currentPhaseIndex) {
        el.classList.add('phase-current')
        current = el
      }
    })
    this.publishPhase()
    // On a phone the graph is wider than the screen and scrolls; keeping the current bar in view
    // is worth one layout, once per phase.
    current?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }

  getCurrentCadenceTarget() {
    const phase = this.expandedPhases[this.currentPhaseIndex]
    if (!phase) return null
    if (phase.cadence) return { target: phase.cadence, type: 'fixed' }
    if (phase.cadenceHigh && phase.cadenceLow) {
      if (phase.type === 'Ramp' && phase.duration > 0) {
        const progress = this.currentPhaseElapsed / phase.duration
        const target = Math.round(
          phase.cadenceLow + (phase.cadenceHigh - phase.cadenceLow) * progress
        )
        return {
          target,
          type: 'range',
          min: phase.cadenceLow,
          max: phase.cadenceHigh
        }
      } else {
        return {
          target: Math.round((phase.cadenceHigh + phase.cadenceLow) / 2),
          type: 'range',
          min: phase.cadenceLow,
          max: phase.cadenceHigh
        }
      }
    }
    return null
  }

  start() {
    if (this.running || this.expandedPhases.length === 0) return
    this.running = true
    this.currentPhaseIndex = 0
    this.currentPhaseElapsed = 0
    this.phaseStartDistance = this.distance
    this.totalElapsed = 0
    this.renderedPhase = null
    this.refreshPhase()
    this.timer = setInterval(() => this.tick(), 1000)
    // The coach runs on its own interval rather than this clock, so every one of these three has to
    // say so. Left to itself it started as soon as a workout was picked and never stopped: it asked
    // for advice, and paid for it, over a workout being browsed and over a ride long since ended.
    this.audioCoach?.startLlmCoach()
  }

  pause() {
    if (this.running && this.timer) {
      clearInterval(this.timer)
      this.timer = null
      this.audioCoach?.stopLlmCoach()
    }
  }

  resume() {
    if (this.running && !this.timer) {
      this.timer = setInterval(() => this.tick(), 1000)
      this.audioCoach?.startLlmCoach()
    }
  }

  stop() {
    this.running = false
    clearInterval(this.timer)
    this.timer = null
    this.audioCoach?.stopLlmCoach()
    this.onWorkoutEnd()
    this.renderedPhase = null
    this.updatePhaseClasses()
  }

  isRunning() {
    return this.running
  }

  /**
   * The fraction of FTP a phase asks for at a given moment, or null when it names none. Free-ride
   * phases answer their .zwo Target if they have one: nothing sends it to the trainer, but it is
   * still the number the rider is being asked for.
   */
  relativePowerAt(index, elapsed = 0) {
    const phase = this.expandedPhases[index]
    if (!phase) return null
    const relative = phase.freeRide
      ? phase.target
      : phase.type === 'Ramp'
        ? phase.powerLow +
          (phase.powerHigh - phase.powerLow) * (elapsed / phase.duration)
        : (phase.power ?? 0)
    return relative == null || isNaN(relative) ? null : relative
  }

  /** What a phase is, in the terms the rider reads: name, length, and what it asks for. */
  phaseSummary(index) {
    const phase = this.expandedPhases[index]
    if (!phase) return null
    const relative = this.relativePowerAt(index)
    return {
      label: phaseLabel(phase.type),
      duration: phase.duration || 0,
      distance: phase.distance || 0,
      freeRide: !!phase.freeRide,
      relative,
      watts: relative === null ? null : Math.round(relative * this.ftp)
    }
  }

  currentPowerTarget() {
    const relative = this.relativePowerAt(
      this.currentPhaseIndex,
      this.currentPhaseElapsed
    )
    if (relative === null) return null
    return { relative, watts: Math.round(relative * this.ftp) }
  }

  sendCurrentErg() {
    const phase = this.expandedPhases[this.currentPhaseIndex]
    // A free-ride phase (FreeRide, MaxEffort, RestDay…) has no ERG target: the rider decides.
    if (!phase || phase.freeRide) return
    const target = this.currentPowerTarget()
    if (target) this.setErgPower(target.watts)
  }

  /**
   * Metres, pushed by whichever machine counts them. A phase written in distance ends here rather
   * than on the clock: a rower who stops mid-piece has not finished it, and the workout waits.
   */
  setDistance(metres) {
    this.distance = metres
    if (!this.running) return
    const phase = this.expandedPhases[this.currentPhaseIndex]
    if (!phase?.distance || this.phaseDistance < phase.distance) return
    if (this.advancePhase()) this.refreshPhase()
  }

  /** True if there is still a phase to run. */
  advancePhase() {
    this.currentPhaseIndex++
    this.currentPhaseElapsed = 0
    this.phaseStartDistance = this.distance
    if (this.currentPhaseIndex < this.expandedPhases.length) return true
    this.stop()
    return false
  }

  refreshPhase() {
    this.sendCurrentErg()
    this.updatePhaseProgressBar()
    this.updatePhaseClasses()
  }

  tick() {
    if (!this.running) return
    const phase = this.expandedPhases[this.currentPhaseIndex]
    if (!phase) {
      this.stop()
      return
    }

    this.currentPhaseElapsed++
    this.totalElapsed++
    this.audioCoach?.checkAndPlayMessages(this.totalElapsed)

    if (this.totalElapsed >= this.totalDurationSeconds / 2)
      this.alpineInstance.captureScreenshot()

    // A phase measured in metres is ended by setDistance and by nothing else. Its duration is an
    // estimate of how long it ought to take, and ending on an estimate would cut a piece short
    // for anyone rowing it slower than the estimate assumed.
    if (!phase.distance && this.currentPhaseElapsed >= phase.duration) {
      if (!this.advancePhase()) return
    }
    this.refreshPhase()
  }
}

export function parseZwoPhases(xmlDoc) {
  let workout = xmlDoc.querySelector('workout')
  return Array.from(workout.children).map(node => {
    let phase = { type: node.tagName }
    const intAttributes = [
      'Cadence',
      'CadenceLow',
      'CadenceHigh',
      'CadenceResting',
      'Repeat'
    ]
    // Distance, OnDistance and OffDistance are this app's extension to the format, in metres. A
    // rowing session is written as 4×1000 or 8×500 and .zwo can only say seconds; nothing else
    // about the file changes, so a rowing workout is still a .zwo and still opens in the library.
    const floatAttributes = [
      'Duration',
      'OnDuration',
      'OffDuration',
      'Distance',
      'OnDistance',
      'OffDistance',
      'Power',
      'PowerLow',
      'PowerHigh',
      'OnPower',
      'OffPower',
      'Target'
    ]
    intAttributes.forEach(attr => {
      const value = parseInt(node.getAttribute(attr))
      if (!isNaN(value))
        phase[attr.charAt(0).toLowerCase() + attr.slice(1)] = value
    })
    floatAttributes.forEach(attr => {
      const value = parseFloat(node.getAttribute(attr))
      if (!isNaN(value))
        phase[attr.charAt(0).toLowerCase() + attr.slice(1)] = value
    })
    return phase
  })
}

function getTagContent(xmlDoc, tagName) {
  const node = xmlDoc.querySelector(tagName)
  return node ? node.textContent.trim() : ''
}

// Takes the phases the caller has already expanded: the duration on screen is then, by
// construction, the duration actually ridden. The old copy of this logic listed the tag names it
// knew, and under-reported every workout built from a tag missing from that list.
export function parseZwoMeta(xmlDoc, expandedPhases) {
  return {
    name: getTagContent(xmlDoc, 'name'),
    description: getTagContent(xmlDoc, 'description'),
    author: getTagContent(xmlDoc, 'author'),
    totalDuration: totalDurationSeconds(expandedPhases) / 60
  }
}
