function getZoneColor(power) {
  if (power < 0.56) return '#888'
  if (power < 0.76) return '#2196f3'
  if (power < 0.9) return '#4caf50'
  if (power < 1.05) return '#ffeb3b'
  if (power < 1.2) return '#ff9800'
  return '#f44336'
}

export function renderWorkoutSvg(phases, svgEl) {
  const svgWidth = 1800,
    svgHeight = 300,
    margin = 20
  const minBarHeight = 40,
    maxBarHeight = 140,
    barRadius = 18
  let expanded = []
  for (const p of phases) {
    if (p.type === 'IntervalsT') {
      const repeat = parseInt(p.repeat) || 1
      for (let i = 0; i < repeat; i++) {
        expanded.push({ type: 'On', duration: p.onDuration, power: p.onPower })
        expanded.push({
          type: 'Off',
          duration: p.offDuration,
          power: p.offPower
        })
      }
    } else {
      expanded.push(p)
    }
  }
  const totalDuration = expanded.reduce(
    (sum, p) => sum + (parseFloat(p.duration) || 0),
    0
  )
  let x = margin
  let svg = `<svg width="100%" viewBox="0 0 ${svgWidth} ${svgHeight}" style="background:#222;border-radius:40px;display:block;height:auto;">`
  let gradCount = 0
  for (const phase of expanded) {
    const duration = parseFloat(phase.duration) || 0
    const width = (duration / totalDuration) * (svgWidth - 2 * margin)
    let color = '#ccc'
    let barH = minBarHeight
    if (phase.power) {
      const pwr = parseFloat(phase.power)
      color = getZoneColor(pwr)
      barH = minBarHeight + (maxBarHeight - minBarHeight) * Math.min(pwr, 1.5)
    }
    if (phase.powerLow && phase.powerHigh) {
      const pLow = parseFloat(phase.powerLow),
        pHigh = parseFloat(phase.powerHigh)
      const color1 = getZoneColor(pLow),
        color2 = getZoneColor(pHigh)
      const h1 =
        minBarHeight + (maxBarHeight - minBarHeight) * Math.min(pLow, 1.5)
      const h2 =
        minBarHeight + (maxBarHeight - minBarHeight) * Math.min(pHigh, 1.5)
      svg += `<defs><linearGradient id="grad${gradCount}" x1="0%" y1="100%" x2="0%" y2="0%"><stop offset="0%" stop-color="${color1}"/><stop offset="100%" stop-color="${color2}"/></linearGradient></defs>`
      svg += `<polygon points="${x},${svgHeight - margin} ${x + width},${
        svgHeight - margin
      } ${x + width},${svgHeight - h2 - margin} ${x},${
        svgHeight - h1 - margin
      }" fill="url(#grad${gradCount})"/>`
      x += width
      gradCount++
      continue
    }
    svg += `<rect x="${x}" y="${
      svgHeight - barH - margin
    }" width="${width}" height="${barH}" rx="${barRadius}" fill="${color}" />`
    x += width
  }
  svg += '</svg>'
  svgEl.innerHTML = svg
}

export function parseAndDisplayZwo(xmlText, workoutPhasesEl, workoutSvgEl) {
  const phases = parseZwoPhases(xmlText)
  renderWorkoutSvg(phases, workoutSvgEl)
  if (phases.length === 0) {
    if (workoutPhasesEl)
      workoutPhasesEl.innerHTML = '<p>Aucune phase trouvée.</p>'
    return
  }
  if (workoutPhasesEl) {
    let html = '<h3>Phases du workout :</h3><ol>'
    for (let p of phases) {
      html += `<li><strong>${p.type}</strong> - `
      if (p.duration) html += `Durée: ${p.duration}s `
      if (p.power) html += `Puissance: ${p.power} `
      if (p.powerLow) html += `Puissance début: ${p.powerLow} `
      if (p.powerHigh) html += `Puissance fin: ${p.powerHigh} `
      if (p.repeat) html += `Répéter: ${p.repeat}x `
      if (p.onDuration) html += `On: ${p.onDuration}s @ ${p.onPower} `
      if (p.offDuration) html += `Off: ${p.offDuration}s @ ${p.offPower} `
      html += '</li>'
    }
    html += '</ol>'
    workoutPhasesEl.innerHTML = html
  }
}

const FTP = 150

export class WorkoutRunner {
  constructor(phases, setErgPower, onWorkoutEnd) {
    this.originalPhases = phases
    this.expandedPhases = this.expandPhases(phases)
    this.setErgPower = setErgPower
    this.onWorkoutEnd = onWorkoutEnd
    this.currentPhaseIndex = 0
    this.currentPhaseElapsed = 0
    this.timer = null
    this.running = false
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
          expanded.push({
            type: 'Ramp',
            duration,
            powerLow,
            powerHigh
          })
        } else {
          expanded.push({
            type: p.type,
            duration,
            power: powerLow
          })
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

  start() {
    if (this.running || this.expandedPhases.length === 0) return
    this.running = true
    this.currentPhaseIndex = 0
    this.currentPhaseElapsed = 0
    this.sendCurrentErg()
    this.timer = setInterval(() => this.tick(), 1000)
  }

  stop() {
    this.running = false
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (this.onWorkoutEnd) this.onWorkoutEnd()
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
    } else {
      targetPower = phase.power
    }
    if (phase.type !== 'FreeRide') {
      this.setErgPower(Math.round(targetPower * FTP))
    }
  }

  tick() {
    if (!this.running) return
    const phase = this.expandedPhases[this.currentPhaseIndex]
    if (!phase) {
      this.stop()
      return
    }
    this.currentPhaseElapsed++
    if (this.currentPhaseElapsed >= phase.duration) {
      this.currentPhaseIndex++
      this.currentPhaseElapsed = 0
      if (this.currentPhaseIndex >= this.expandedPhases.length) {
        this.stop()
        return
      }
    }
    this.sendCurrentErg()
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
