let device, server
let controlCharacteristic
let cyclingPowerChar
let prevCrankRevs = null
let prevCrankEventTime = null
let lastCadence = null
let cadenceTimeout = null

function log(msg) {
  console.log(msg)
}

// Callbacks à setter depuis main.js
let onPowerUpdate = () => {}
let onCadenceUpdate = () => {}
let onHeartRateUpdate = () => {}

export function setOnPowerUpdate(cb) {
  onPowerUpdate = cb
}
export function setOnCadenceUpdate(cb) {
  onCadenceUpdate = cb
}

export function setOnHeartRateUpdate(cb) {
  onHeartRateUpdate = cb
}

export async function connect() {
  log('Requesting Bluetooth device...')
  try {
    device = await navigator.bluetooth.requestDevice({
      filters: [{ services: ['fitness_machine', 'cycling_power'] }]
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
    device.addEventListener('gattserverdisconnected', () => {
      log('⚠️ Device disconnected.')
      onPowerUpdate('-')
      onCadenceUpdate('-')
    })
    return true
  } catch (error) {
    log('⚠️ ' + error)
    return false
  }
}

export async function setErgPower(watts) {
  if (!controlCharacteristic) {
    log('⚠️ Not connected or characteristic missing.')
    return
  }
  try {
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

export async function connectHrm() {
  log('Requesting Bluetooth HRM device...')
  let hrmDevice, hrmServer, hrmChar
  try {
    hrmDevice = await navigator.bluetooth.requestDevice({
      filters: [{ services: ['heart_rate'] }],
      optionalServices: ['battery_service']
    })
    log(`Connecting to HRM ${hrmDevice.name}...`)
    hrmServer = await hrmDevice.gatt.connect()
    const hrmService = await hrmServer.getPrimaryService('heart_rate')
    hrmChar = await hrmService.getCharacteristic('heart_rate_measurement')
    await hrmChar.startNotifications()
    hrmChar.addEventListener(
      'characteristicvaluechanged',
      handleHeartRateNotification
    )
    log('✅ Subscribed to Heart Rate notifications.')
    hrmDevice.addEventListener('gattserverdisconnected', () => {
      log('⚠️ HRM device disconnected.')
      onHeartRateUpdate('-')
    })
    return true
  } catch (error) {
    log('⚠️ HRM: ' + error)
    return false
  }
}

function handleCyclingPowerNotification(event) {
  const value = event.target.value
  let offset = 0
  const flags = value.getUint16(offset, true)
  offset += 2
  const instantaneousPower = value.getInt16(offset, true)
  offset += 2
  if (flags & 0x01) offset += 1
  if (flags & 0x02) offset += 2
  if (flags & 0x04) offset += 6
  if (flags & 0x08) offset += 2
  let cadence = '-'
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
    prevCrankRevs = crankRevs
    prevCrankEventTime = crankEventTime
    cadence = lastCadence !== null ? lastCadence : '-'
  }
  onPowerUpdate(instantaneousPower)
  onCadenceUpdate(instantaneousPower === 0 ? '-' : cadence)
  if (cadenceTimeout) clearTimeout(cadenceTimeout)
  cadenceTimeout = setTimeout(() => {
    lastCadence = null
    onCadenceUpdate('-')
  }, 2000)
}

function handleHeartRateNotification(event) {
  const value = event.target.value
  let offset = 0
  const flags = value.getUint8(offset)
  offset += 1
  let hr
  if ((flags & 0x01) === 0) {
    hr = value.getUint8(offset)
    offset += 1
  } else {
    hr = value.getUint16(offset, true)
    offset += 2
  }
  onHeartRateUpdate(hr)
}
