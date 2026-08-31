import { formatForTimer, isTestEnv } from './utils.js'
import { phaseLabel, totalDurationSeconds } from './phases.js'

import { AudioCoach } from './audio-coach.js'

export class WorkoutRunner {
  constructor(
    expandedPhases,
    setErgPower,
    onWorkoutEnd,
    ftp,
    alpineInstance,
    workoutSvgEl,
    xmlDoc,
    rawPhases,
    xmlPath = null
  ) {
    this.expandedPhases = expandedPhases
    this.totalDurationSeconds = totalDurationSeconds(expandedPhases)
    this.setErgPower = setErgPower
    this.onWorkoutEnd = onWorkoutEnd
    this.ftp = ftp
    this.currentPhaseIndex = 0
    this.currentPhaseElapsed = 0
    this.timer = null
    this.running = false
    this.alpineInstance = alpineInstance
    this.workoutSvgEl = workoutSvgEl
    this.xmlDoc = xmlDoc
    this.rawPhases = rawPhases
    this.xmlPath = xmlPath
    this.initializeAudioCoach()
  }

  async initializeAudioCoach() {
    this.audioCoach = new AudioCoach()
    // The LLM coach needs the workout's path: the server reads the ZWO from it. Without one — a
    // file the rider dropped in — fall back to the workout's own recorded text events. The test
    // suite loads a library workout, so it has a path, and every run billed a real OpenAI and
    // Inworld call before this.
    if (this.xmlPath && !isTestEnv()) {
      this.audioCoach.startLlmCoach(
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

  updatePhaseProgressBar() {
    if (!this.alpineInstance) return
    const phase = this.expandedPhases[this.currentPhaseIndex]
    if (!phase?.duration) {
      this.alpineInstance.phaseProgress = 0
      this.alpineInstance.phaseSecondsRemaining = 0
      return
    }
    const percent = Math.min(this.currentPhaseElapsed / phase.duration, 1) * 100
    this.alpineInstance.phaseProgress = isNaN(percent) ? 0 : percent

    this.alpineInstance.phaseSecondsRemaining = Math.max(
      0,
      Math.round(phase.duration - this.currentPhaseElapsed)
    )
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
    this.totalElapsed = 0
    this.renderedPhase = null
    this.sendCurrentErg()
    this.updatePhaseProgressBar()
    this.updatePhaseClasses()
    this.timer = setInterval(() => this.tick(), 1000)
  }

  pause() {
    if (this.running && this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  resume() {
    if (this.running && !this.timer)
      this.timer = setInterval(() => this.tick(), 1000)
  }

  stop() {
    this.running = false
    clearInterval(this.timer)
    this.timer = null
    // The coach polls on its own interval, which outlived the ride: it kept asking for advice, and
    // paying for it, long after the rider had left the bike.
    this.audioCoach?.llmStopLlmCoach()
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

    if (this.currentPhaseElapsed >= phase.duration) {
      this.currentPhaseIndex++
      this.currentPhaseElapsed = 0
      if (this.currentPhaseIndex >= this.expandedPhases.length) {
        this.stop()
        return
      }
    }
    this.sendCurrentErg()
    this.updatePhaseProgressBar()
    this.updatePhaseClasses()
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
    const floatAttributes = [
      'Duration',
      'OnDuration',
      'OffDuration',
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
