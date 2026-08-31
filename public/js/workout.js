import { formatForTimer } from './utils.js'
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
    rawPhases
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
    this.initializeAudioCoach()
  }

  async initializeAudioCoach() {
    this.audioCoach = new AudioCoach()
    const audioReady = await this.audioCoach.loadTextEvents(
      this.xmlDoc,
      this.rawPhases
    )
    if (!audioReady) this.audioCoach = null
  }

  updatePhaseProgressBar() {
    if (!this.alpineInstance) return
    const phase = this.expandedPhases[this.currentPhaseIndex]
    if (!phase?.duration) {
      this.alpineInstance.phaseProgress = 0
      this.alpineInstance.phaseTimeRemaining = '0:00'
      return
    }
    const percent = Math.min(this.currentPhaseElapsed / phase.duration, 1) * 100
    this.alpineInstance.phaseProgress = isNaN(percent) ? 0 : percent

    const remainingSeconds = Math.max(
      0,
      phase.duration - this.currentPhaseElapsed
    )
    this.alpineInstance.phaseTimeRemaining = formatForTimer(remainingSeconds)
  }

  updatePhaseClasses() {
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
    // Only when the phase changes: on a phone the graph is wider than the screen and scrolls, and
    // yanking it back every second would fight the rider's own scrolling.
    if (current && this.scrolledToPhase !== this.currentPhaseIndex) {
      this.scrolledToPhase = this.currentPhaseIndex
      current.scrollIntoView({ inline: 'center', block: 'nearest' })
    }
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
    this.onWorkoutEnd()
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

  /** How much of the whole session is behind, as a percentage. */
  sessionProgress() {
    if (!this.totalDurationSeconds) return 0
    return Math.min(
      100,
      ((this.totalElapsed || 0) / this.totalDurationSeconds) * 100
    )
  }

  currentPhaseSecondsRemaining() {
    const phase = this.expandedPhases[this.currentPhaseIndex]
    if (!phase?.duration) return 0
    return Math.max(0, Math.round(phase.duration - this.currentPhaseElapsed))
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
