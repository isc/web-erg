let device, server
let controlCharacteristic

const logEl = document.getElementById('log')
const connectBtn = document.getElementById('connectBtn')
const setPowerBtn = document.getElementById('setPowerBtn')
const powerInput = document.getElementById('powerInput')
const powerValueEl = document.getElementById('powerValue')
const cadenceValueEl = document.getElementById('cadenceValue')

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
