let device, server
let controlCharacteristic

const logEl = document.getElementById('log')
const connectBtn = document.getElementById('connectBtn')
const setPowerBtn = document.getElementById('setPowerBtn')
const powerInput = document.getElementById('powerInput')
const powerValueEl = document.getElementById('powerValue')
const cadenceValueEl = document.getElementById('cadenceValue')
const zwoFileInput = document.getElementById('zwoFileInput')
const workoutPhasesEl = document.getElementById('workoutPhases')

let cyclingPowerChar
let prevCrankRevs = null
let prevCrankEventTime = null
let lastCadence = null
let cadenceTimeout = null

function log(msg) {
  logEl.textContent += msg + '\n'
  logEl.scrollTop = logEl.scrollHeight
}

async function connect() {
  log('Requesting Bluetooth device...')
  try {
    device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'KICKR' }],
      optionalServices: ['fitness_machine', 'cycling_power']
    })

    log(`Connecting to ${device.name}...`)
    server = await device.gatt.connect()

    log('Getting Fitness Machine Service...')
    const service = await server.getPrimaryService(
      '00001826-0000-1000-8000-00805f9b34fb'
    )

    log('Getting Control Point Characteristic...')
    controlCharacteristic = await service.getCharacteristic(
      '00002ad9-0000-1000-8000-00805f9b34fb'
    )

    log('Getting Cycling Power Service...')
    const cyclingService = await server.getPrimaryService(
      '00001818-0000-1000-8000-00805f9b34fb'
    )
    log('Getting Cycling Power Measurement Characteristic...')
    cyclingPowerChar = await cyclingService.getCharacteristic(
      '00002a63-0000-1000-8000-00805f9b34fb'
    )
    await cyclingPowerChar.startNotifications()
    cyclingPowerChar.addEventListener(
      'characteristicvaluechanged',
      handleCyclingPowerNotification
    )
    log('✅ Subscribed to Cycling Power notifications.')

    log('✅ Connected and ready.')
    setPowerBtn.disabled = false

    device.addEventListener('gattserverdisconnected', () => {
      log('⚠️ Device disconnected.')
      setPowerBtn.disabled = true
      powerValueEl.textContent = '-'
      cadenceValueEl.textContent = '-'
    })
  } catch (error) {
    log('⚠️ ' + error)
  }
}

async function setErgPower(watts) {
  if (!controlCharacteristic) {
    log('⚠️ Not connected or characteristic missing.')
    return
  }

  try {
    // Opcode 0x05 = Set Target Power
    const data = new Uint8Array(3)
    data[0] = 0x05
    data[1] = watts & 0xff
    data[2] = (watts >> 8) & 0xff

    await controlCharacteristic.writeValue(data)
    log(`➡️ Power set to ${watts} watts.`)
  } catch (error) {
    log('⚠️ Failed to send power command: ' + error)
  }
}

function handleCyclingPowerNotification(event) {
  const value = event.target.value
  let offset = 0
  const flags = value.getUint16(offset, true)
  offset += 2
  const instantaneousPower = value.getInt16(offset, true)
  offset += 2
  // Parsing dynamique des champs optionnels selon les flags
  if (flags & 0x01) offset += 1
  if (flags & 0x02) offset += 2
  if (flags & 0x04) offset += 6
  if (flags & 0x08) offset += 2
  if (flags & 0x10) {
    const crankRevs = value.getUint16(offset, true)
    offset += 2
    const crankEventTime = value.getUint16(offset, true)
    offset += 2
    let revsDiff = null,
      timeDiff = null,
      cadenceRaw = null
    if (prevCrankRevs !== null && prevCrankEventTime !== null) {
      revsDiff = crankRevs - prevCrankRevs
      timeDiff = crankEventTime - prevCrankEventTime
      if (revsDiff < 0) revsDiff += 65536
      if (timeDiff < 0) timeDiff += 65536
      if (revsDiff > 0 && timeDiff > 0) {
        cadenceRaw = (revsDiff * 60 * 1024) / timeDiff
        lastCadence = cadenceRaw.toFixed(1)
      }
    }
    log(
      `[DEBUG] flags=0x${flags.toString(
        16
      )} offset=${offset} crankRevs=${crankRevs} crankEventTime=${crankEventTime} revsDiff=${revsDiff} timeDiff=${timeDiff} cadenceRaw=${cadenceRaw}`
    )
    prevCrankRevs = crankRevs
    prevCrankEventTime = crankEventTime
  } else {
    log(
      `[DEBUG] flags=0x${flags.toString(
        16
      )} offset=${offset} (pas de données manivelle)`
    )
  }
  powerValueEl.textContent = instantaneousPower
  if (instantaneousPower === 0) {
    cadenceValueEl.textContent = '-'
  } else {
    cadenceValueEl.textContent = lastCadence !== null ? lastCadence : '-'
  }
  // Timeout pour effacer la cadence si plus de notifications
  if (cadenceTimeout) clearTimeout(cadenceTimeout)
  cadenceTimeout = setTimeout(() => {
    lastCadence = null
    cadenceValueEl.textContent = '-'
  }, 2000)
}

connectBtn.addEventListener('click', connect)
setPowerBtn.addEventListener('click', () => {
  const watts = parseInt(powerInput.value)
  if (watts >= 0 && watts <= 1500) {
    setErgPower(watts)
  } else {
    log('⚠️ Power value must be between 0 and 1500.')
  }
})

zwoFileInput.addEventListener('change', handleZwoFile, false)

function handleZwoFile(e) {
  const file = e.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = function (event) {
    const xml = event.target.result
    parseAndDisplayZwo(xml)
  }
  reader.readAsText(file)
}

function getZoneColor(power) {
  // power = fraction FTP (ex: 0.75)
  if (power < 0.56) return '#888' // Z1
  if (power < 0.76) return '#2196f3' // Z2
  if (power < 0.9) return '#4caf50' // Z3
  if (power < 1.05) return '#ffeb3b' // Z4
  if (power < 1.2) return '#ff9800' // Z5
  return '#f44336' // Z6+
}

function renderWorkoutSvg(phases) {
  const svgWidth = 800,
    svgHeight = 200,
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
  let svg = `<svg width="100%" viewBox="0 0 ${svgWidth} ${svgHeight}" style="background:#222;border-radius:40px;display:block;max-width:100%;height:auto;">`
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
      // Ramp: gradient + interpolate height
      const pLow = parseFloat(phase.powerLow),
        pHigh = parseFloat(phase.powerHigh)
      const color1 = getZoneColor(pLow),
        color2 = getZoneColor(pHigh)
      const h1 =
        minBarHeight + (maxBarHeight - minBarHeight) * Math.min(pLow, 1.5)
      const h2 =
        minBarHeight + (maxBarHeight - minBarHeight) * Math.min(pHigh, 1.5)
      svg += `<defs>
        <linearGradient id="grad${gradCount}" x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stop-color="${color1}"/>
          <stop offset="100%" stop-color="${color2}"/>
        </linearGradient>
      </defs>`
      // Trapezoid effect for ramp
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
  document.getElementById('workoutSvg').innerHTML = svg
}

function parseAndDisplayZwo(xmlText) {
  let parser = new DOMParser()
  let xmlDoc = parser.parseFromString(xmlText, 'application/xml')
  let workout = xmlDoc.querySelector('workout')
  if (!workout) {
    workoutPhasesEl.innerHTML = '<p>Workout non trouvé dans le fichier.</p>'
    document.getElementById('workoutSvg').innerHTML = ''
    return
  }
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
        continue // ignore textevent etc.
    }
    phases.push(phase)
  }
  // Affichage SVG
  renderWorkoutSvg(phases)
  // Affichage texte
  if (phases.length === 0) {
    workoutPhasesEl.innerHTML = '<p>Aucune phase trouvée.</p>'
    return
  }
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
