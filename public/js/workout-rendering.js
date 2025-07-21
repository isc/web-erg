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

export function renderWorkoutSvg(phases, svgEl) {
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
      const repeat = p.repeat || 1
      for (let i = 0; i < repeat; i++) {
        expanded.push({ type: 'On', duration: p.onDuration, power: p.onPower })
        expanded.push({
          type: 'Off',
          duration: p.offDuration,
          power: p.offPower
        })
      }
    } else expanded.push(p)
  }
  const totalDuration = expanded.reduce((sum, p) => sum + (p.duration || 0), 0)
  let x = margin
  let svg = `<svg viewBox="0 0 ${svgWidth} ${svgHeight}">`
  let gradCount = 0
  let gradients = ''
  let paths = ''
  for (let i = 0; i < expanded.length; i++) {
    const phase = expanded[i]
    const duration = phase.duration || 0
    const width =
      (duration / totalDuration) *
      (svgWidth - 2 * margin - phaseGap * (expanded.length - 1))
    let color = '#ccc'
    let barH = minBarHeight
    if (phase.power) {
      const pwr = phase.power
      color = getZoneColor(pwr)
      barH = minBarHeight + (maxBarHeight - minBarHeight) * Math.min(pwr, 1.5)
    }
    let dataAttr = `data-phase-index=\"${i}\"`
    if (phase.powerLow && phase.powerHigh) {
      const pLow = phase.powerLow,
        pHigh = phase.powerHigh
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
