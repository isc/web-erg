import { formatForTimer } from './utils.js'
import { totalDurationSeconds } from './phases.js'

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
    svg.querySelectorAll('[data-phase-index]').forEach((el, i) => {
      el.classList.remove('phase-completed', 'phase-current')
      if (i < this.currentPhaseIndex) el.classList.add('phase-completed')
      else if (i === this.currentPhaseIndex) el.classList.add('phase-current')
    })
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

  sendCurrentErg() {
    const phase = this.expandedPhases[this.currentPhaseIndex]
    if (!phase) return
    let targetPower = 0
    if (phase.type === 'Ramp') {
      const t = this.currentPhaseElapsed
      const d = phase.duration
      targetPower =
        phase.powerLow + (phase.powerHigh - phase.powerLow) * (t / d)
    } else targetPower = phase.power
    // A free-ride phase (FreeRide, MaxEffort, RestDay…) has no ERG target: the rider decides.
    if (!phase.freeRide) this.setErgPower(Math.round(targetPower * this.ftp))
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
      'OffPower'
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
