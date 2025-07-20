import { formatForTimer } from './utils.js'
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
      if (p.type === 'IntervalsT') {
        const repeat = parseInt(p.repeat) || 1
        for (let i = 0; i < repeat; i++) {
          expanded.push({
            type: 'On',
            duration: parseFloat(p.onDuration),
            power: parseFloat(p.onPower)
          })
          expanded.push({
            type: 'Off',
            duration: parseFloat(p.offDuration),
            power: parseFloat(p.offPower)
          })
        }
      } else if (p.type === 'SteadyState') {
        expanded.push({
          type: 'SteadyState',
          duration: parseFloat(p.duration),
          power: p.power ? parseFloat(p.power) : 0
        })
      } else if (p.type === 'Warmup' || p.type === 'Cooldown') {
        const duration = parseFloat(p.duration)
        const powerLow = p.powerLow ? parseFloat(p.powerLow) : 0
        const powerHigh = p.powerHigh ? parseFloat(p.powerHigh) : powerLow
        if (powerLow !== powerHigh) {
          expanded.push({ type: 'Ramp', duration, powerLow, powerHigh })
        } else {
          expanded.push({ type: p.type, duration, power: powerLow })
        }
      } else if (p.type === 'Ramp') {
        expanded.push({
          type: 'Ramp',
          duration: parseFloat(p.duration),
          powerLow: parseFloat(p.powerLow),
          powerHigh: parseFloat(p.powerHigh)
        })
      } else if (p.type === 'FreeRide') {
        expanded.push({
          type: 'FreeRide',
          duration: parseFloat(p.duration),
          power: 0
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
  let parser = new DOMParser()
  let xmlDoc = parser.parseFromString(xmlText, 'application/xml')
  let workout = xmlDoc.querySelector('workout')
  if (!workout) return []
  let phases = []
  for (let node of workout.children) {
    let tag = node.tagName
    let phase = { type: tag }
    switch (tag) {
      case 'Warmup':
      case 'Cooldown':
        phase.duration = node.getAttribute('Duration')
        phase.powerLow = node.getAttribute('PowerLow')
        phase.powerHigh = node.getAttribute('PowerHigh')
        break
      case 'SteadyState':
        phase.duration = node.getAttribute('Duration')
        phase.power = node.getAttribute('Power')
        break
      case 'IntervalsT':
        phase.repeat = node.getAttribute('Repeat')
        phase.onDuration = node.getAttribute('OnDuration')
        phase.onPower = node.getAttribute('OnPower')
        phase.offDuration = node.getAttribute('OffDuration')
        phase.offPower = node.getAttribute('OffPower')
        break
      case 'FreeRide':
        phase.duration = node.getAttribute('Duration')
        break
      case 'Ramp':
        phase.duration = node.getAttribute('Duration')
        phase.powerLow = node.getAttribute('PowerLow')
        phase.powerHigh = node.getAttribute('PowerHigh')
        break
      default:
        continue
    }
    phases.push(phase)
  }
  return phases
}

function getTagContent(xmlDoc, tagName) {
  const node = xmlDoc.querySelector(tagName)
  return node ? node.textContent.trim() : ''
}

export function parseZwoMeta(xmlText) {
  let parser = new DOMParser()
  let xmlDoc = parser.parseFromString(xmlText, 'application/xml')
  const name = getTagContent(xmlDoc, 'name')
  const description = getTagContent(xmlDoc, 'description')
  const author = getTagContent(xmlDoc, 'author')

  let totalDuration = 0
  let workout = xmlDoc.querySelector('workout')
  if (workout)
    for (let node of workout.children) {
      let tag = node.tagName
      if (
        ['Warmup', 'Cooldown', 'SteadyState', 'FreeRide', 'Ramp'].includes(tag)
      )
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
