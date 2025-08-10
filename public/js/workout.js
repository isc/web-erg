import { formatForTimer, parseXmlDoc } from './utils.js'

import { AudioCoach } from './audio-coach.js'

export class WorkoutRunner {
  constructor(
    phases,
    setErgPower,
    onWorkoutEnd,
    ftp,
    alpineInstance,
    workoutSvgEl,
    xmlText
  ) {
    this.originalPhases = phases
    this.expandedPhases = this.expandPhases(phases)
    this.totalDurationSeconds = this.expandedPhases.reduce(
      (sum, p) => sum + (p.duration || 0),
      0
    )
    this.setErgPower = setErgPower
    this.onWorkoutEnd = onWorkoutEnd
    this.ftp = ftp
    this.currentPhaseIndex = 0
    this.currentPhaseElapsed = 0
    this.timer = null
    this.running = false
    this.alpineInstance = alpineInstance
    this.workoutSvgEl = workoutSvgEl
    this.xmlText = xmlText
    this.initializeAudioCoach()
  }

  expandPhases(phases) {
    let expanded = []
    for (const p of phases) {
      const cadenceValues = {
        cadence: p.cadence,
        cadenceLow: p.cadenceLow,
        cadenceHigh: p.cadenceHigh
      }
      if (p.type === 'IntervalsT') {
        const repeat = p.repeat || 1
        for (let i = 0; i < repeat; i++) {
          expanded.push({
            type: 'On',
            duration: p.onDuration,
            power: p.onPower,
            cadence: p.cadence
          })
          expanded.push({
            type: 'Off',
            duration: p.offDuration,
            power: p.offPower,
            cadence: p.cadenceResting
          })
        }
      } else if (p.type === 'SteadyState') {
        expanded.push({
          type: 'SteadyState',
          duration: p.duration,
          power: p.power || 0,
          ...cadenceValues
        })
      } else if (p.type === 'Warmup' || p.type === 'Cooldown') {
        const duration = p.duration
        const powerLow = p.powerLow || 0
        const powerHigh = p.powerHigh || powerLow
        if (powerLow !== powerHigh) {
          expanded.push({
            type: 'Ramp',
            duration,
            powerLow,
            powerHigh,
            ...cadenceValues
          })
        } else {
          expanded.push({
            type: p.type,
            duration,
            power: powerLow,
            ...cadenceValues
          })
        }
      } else if (p.type === 'Ramp') {
        expanded.push({
          type: 'Ramp',
          duration: p.duration,
          powerLow: p.powerLow,
          powerHigh: p.powerHigh,
          ...cadenceValues
        })
      } else if (p.type === 'FreeRide') {
        expanded.push({
          type: 'FreeRide',
          duration: p.duration,
          power: 0,
          cadence: p.cadence
        })
      }
    }
    return expanded
  }

  async initializeAudioCoach() {
    this.audioCoach = new AudioCoach()
    const audioReady = await this.audioCoach.loadTextEvents(this.xmlText)
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
    if (phase.type !== 'FreeRide')
      this.setErgPower(Math.round(targetPower * this.ftp))
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

export function parseZwoPhases(xmlText) {
  let workout = parseXmlDoc(xmlText).querySelector('workout')
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

export function parseZwoMeta(xmlText) {
  let xmlDoc = parseXmlDoc(xmlText)
  const name = getTagContent(xmlDoc, 'name')
  const description = getTagContent(xmlDoc, 'description')
  const author = getTagContent(xmlDoc, 'author')

  let totalDuration = 0
  let workout = xmlDoc.querySelector('workout')
  for (let node of workout.children) {
    let tag = node.tagName
    if (['Warmup', 'Cooldown', 'SteadyState', 'FreeRide', 'Ramp'].includes(tag))
      totalDuration += parseFloat(node.getAttribute('Duration')) || 0
    else if (tag === 'IntervalsT') {
      const repeat = parseInt(node.getAttribute('Repeat')) || 1
      const onDuration = parseFloat(node.getAttribute('OnDuration')) || 0
      const offDuration = parseFloat(node.getAttribute('OffDuration')) || 0
      totalDuration += repeat * (onDuration + offDuration)
    }
  }
  totalDuration = totalDuration / 60
  if (totalDuration % 1) totalDuration = totalDuration.toFixed(2)
  return { name, description, author, totalDuration }
}
