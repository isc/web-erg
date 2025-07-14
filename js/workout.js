function getZoneColor(power) {
  if (power < 0.56) return '#888'
  if (power < 0.76) return '#2196f3'
  if (power < 0.9) return '#4caf50'
  if (power < 1.05) return '#ffeb3b'
  if (power < 1.2) return '#ff9800'
  return '#f44336'
}

function svgRampUp(x, width, h1, h2, svgHeight, margin, barRadius, gradId) {
  const yTopLeft = svgHeight - h1 - margin
  const yTopRight = svgHeight - h2 - margin
  const controlLeftX = x
  const controlLeftY = yTopLeft + barRadius * 0.5
  const rightArrondiStartX = x + width - barRadius
  return `<path d="
    M${x + barRadius},${yTopLeft}
    Q${controlLeftX},${controlLeftY} ${x},${yTopLeft + barRadius}
    L${x},${svgHeight - margin - barRadius}
    Q${x},${svgHeight - margin} ${x + barRadius},${svgHeight - margin}
    L${rightArrondiStartX},${svgHeight - margin}
    Q${x + width},${svgHeight - margin} ${x + width},${
    svgHeight - margin - barRadius
  }
    L${x + width},${yTopRight + barRadius}
    Q${x + width},${yTopRight} ${rightArrondiStartX},${yTopRight}
    L${x + barRadius},${yTopLeft}
    Z
  " fill="url(#${gradId})"/>`
}

function svgRampDown(x, width, h1, h2, svgHeight, margin, barRadius, gradId) {
  const yTopLeft = svgHeight - h1 - margin
  const yTopRight = svgHeight - h2 - margin
  const leftArrondiStartX = x + barRadius
  const controlRightX = x + width
  const controlRightY = yTopRight + barRadius * 0.5
  return `<path d="
    M${leftArrondiStartX},${yTopLeft}
    Q${x},${yTopLeft} ${x},${yTopLeft + barRadius}
    L${x},${svgHeight - margin - barRadius}
    Q${x},${svgHeight - margin} ${x + barRadius},${svgHeight - margin}
    L${x + width - barRadius},${svgHeight - margin}
    Q${x + width},${svgHeight - margin} ${x + width},${
    svgHeight - margin - barRadius
  }
    L${x + width},${yTopRight + barRadius}
    Q${controlRightX},${controlRightY} ${x + width - barRadius},${yTopRight}
    L${leftArrondiStartX},${yTopLeft}
    Z
  " fill="url(#${gradId})"/>`
}

function svgSteadyState(x, width, barH, svgHeight, margin, barRadius, color) {
  return `<rect x="${x}" y="${
    svgHeight - barH - margin
  }" width="${width}" height="${barH}" rx="${barRadius}" fill="${color}" />`
}

export function renderWorkoutSvg(phases, svgEl, currentPhaseIndex = null) {
  const svgWidth = 2400,
    svgHeight = 340,
    margin = 20,
    phaseGap = 6
  const minBarHeight = 80,
    maxBarHeight = 250,
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
  let svg = `<svg class="workout-svg" width="100%" viewBox="0 0 ${svgWidth} ${svgHeight}">`
  let gradCount = 0
  let gradients = ''
  let paths = ''
  for (let i = 0; i < expanded.length; i++) {
    const phase = expanded[i]
    const duration = parseFloat(phase.duration) || 0
    const width =
      (duration / totalDuration) *
      (svgWidth - 2 * margin - phaseGap * (expanded.length - 1))
    let color = '#ccc'
    let barH = minBarHeight
    if (phase.power) {
      const pwr = parseFloat(phase.power)
      color = getZoneColor(pwr)
      barH = minBarHeight + (maxBarHeight - minBarHeight) * Math.min(pwr, 1.5)
    }
    let dataAttr = `data-phase-index=\"${i}\"`
    if (phase.powerLow && phase.powerHigh) {
      const pLow = parseFloat(phase.powerLow),
        pHigh = parseFloat(phase.powerHigh)
      const color1 = getZoneColor(pLow),
        color2 = getZoneColor(pHigh)
      const h1 =
        minBarHeight + (maxBarHeight - minBarHeight) * Math.min(pLow, 1.5)
      const h2 =
        minBarHeight + (maxBarHeight - minBarHeight) * Math.min(pHigh, 1.5)
      gradients += `<linearGradient id="grad${gradCount}" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="${color1}"/><stop offset="100%" stop-color="${color2}"/></linearGradient>`
      let rampPath = ''
      if (h1 <= h2) {
        rampPath = svgRampUp(
          x,
          width,
          h1,
          h2,
          svgHeight,
          margin,
          barRadius,
          `grad${gradCount}`
        )
      } else {
        rampPath = svgRampDown(
          x,
          width,
          h1,
          h2,
          svgHeight,
          margin,
          barRadius,
          `grad${gradCount}`
        )
      }
      rampPath = rampPath.replace('<path ', `<path ${dataAttr} `)
      paths += rampPath
      x += width + phaseGap
      gradCount++
      continue
    }
    let rect = svgSteadyState(
      x,
      width,
      barH,
      svgHeight,
      margin,
      barRadius,
      color
    )
    rect = rect.replace('<rect ', `<rect ${dataAttr} `)
    paths += rect
    x += width + phaseGap
  }
  if (gradients) svg += `<defs>${gradients}</defs>`
  svg += paths
  svg += '</svg>'
  svgEl.innerHTML = svg
}

export function parseAndDisplayZwo(xmlText, workoutSvgEl) {
  renderWorkoutSvg(parseZwoPhases(xmlText), workoutSvgEl)
}

export class WorkoutRunner {
  constructor(
    phases,
    setErgPower,
    onWorkoutEnd,
    ftp = 150,
    alpineInstance = null,
    workoutSvgEl = null
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

  updatePhaseProgressBar() {
    if (!this.alpineInstance) return
    const phase = this.expandedPhases[this.currentPhaseIndex]
    if (!phase || !phase.duration) {
      this.alpineInstance.phaseProgress = 0
      this.alpineInstance.phaseColor = '#ccc'
      return
    }
    const percent = Math.min(this.currentPhaseElapsed / phase.duration, 1) * 100
    let color = '#ccc'
    if (phase.power) color = getZoneColor(phase.power)
    if (phase.powerLow) color = getZoneColor(phase.powerLow)
    this.alpineInstance.phaseProgress = isNaN(percent) ? 0 : percent
    this.alpineInstance.phaseColor = color
  }

  updatePhaseClasses() {
    const svg = this.workoutSvgEl.querySelector('svg')
    svg.querySelectorAll('[data-phase-index]').forEach((el, i) => {
      el.classList.remove('phase-completed', 'phase-current', 'phase-upcoming')
      if (i < this.currentPhaseIndex) el.classList.add('phase-completed')
      else if (i === this.currentPhaseIndex) el.classList.add('phase-current')
      else el.classList.add('phase-upcoming')
    })
  }

  start() {
    if (this.running || this.expandedPhases.length === 0) return
    this.running = true
    this.currentPhaseIndex = 0
    this.currentPhaseElapsed = 0
    this.sendCurrentErg()
    this.updatePhaseProgressBar()
    this.updatePhaseClasses()
    this.timer = setInterval(() => this.tick(), 1000)
  }

  stop() {
    this.running = false
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (this.onWorkoutEnd) this.onWorkoutEnd()
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
    } else {
      targetPower = phase.power
    }
    if (phase.type !== 'FreeRide') {
      this.setErgPower(Math.round(targetPower * this.ftp))
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

export function parseZwoMeta(xmlText) {
  let parser = new DOMParser()
  let xmlDoc = parser.parseFromString(xmlText, 'application/xml')
  let name = ''
  let description = ''
  const nameNode = xmlDoc.querySelector('name')
  if (nameNode) name = nameNode.textContent.trim()
  const descNode = xmlDoc.querySelector('description')
  if (descNode) description = descNode.textContent.trim()

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
  return { name, description, totalDuration: (totalDuration / 60).toFixed(2) }
}
