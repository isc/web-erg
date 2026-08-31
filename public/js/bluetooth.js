import { isTestEnv } from './utils.js'
import mockBluetooth from './bluetooth_mock.js'

const FITNESS_MACHINE_SERVICE = '00001826-0000-1000-8000-00805f9b34fb'
const FITNESS_MACHINE_CONTROL_POINT = '00002ad9-0000-1000-8000-00805f9b34fb'
const CYCLING_POWER_SERVICE = '00001818-0000-1000-8000-00805f9b34fb'
const CYCLING_POWER_MEASUREMENT = '00002a63-0000-1000-8000-00805f9b34fb'

// Fitness Machine Control Point opcodes (FTMS 4.16).
const OP_REQUEST_CONTROL = 0x00
const OP_START_OR_RESUME = 0x07
const OP_SET_TARGET_POWER = 0x05

const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000]

let controlCharacteristic
let prevCrankRevs = null
let prevCrankEventTime = null
let lastCadence = null
let announcedFirstPower = false
let announcedFirstPowerReading = false
let announcedFirstHeartRate = false
let announcedFirstHeartRateReading = false

const bluetoothApi = isTestEnv() ? mockBluetooth : navigator.bluetooth

export function bluetoothAvailable() {
  return !!bluetoothApi
}

// Every step of a connection is already narrated here. On a phone there is no console to read it
// in, so the narration is also handed to whoever wants to show it.
let onLog = () => {}

export function setOnLog(cb) {
  onLog = cb
}

function log(msg) {
  console.log(msg)
  onLog(String(msg))
}

let onPowerUpdate = () => {}
let onCadenceUpdate = () => {}
let onHeartRateUpdate = () => {}
let onConnectionChange = () => {}

export function setOnPowerUpdate(cb) {
  onPowerUpdate = cb
}
export function setOnCadenceUpdate(cb) {
  onCadenceUpdate = cb
}
export function setOnHeartRateUpdate(cb) {
  onHeartRateUpdate = cb
}
export function setOnConnectionChange(cb) {
  onConnectionChange = cb
}

/**
 * A dropout mid-session used to be terminal: the disconnect handler pushed '-', which the UI reads
 * as "not pedalling" and turns into a pause, and nothing ever reconnected or said anything. The
 * device stays permitted after a disconnect, so gatt.connect() works without a fresh user gesture.
 */
async function reconnect(device, openFn, kind) {
  for (const delay of RECONNECT_DELAYS_MS) {
    if (device.gatt.connected) return true
    onConnectionChange(kind, 'reconnecting')
    await new Promise(resolve => setTimeout(resolve, delay))
    try {
      await openFn(device)
      log(`✅ ${kind} reconnected.`)
      onConnectionChange(kind, 'connected')
      return true
    } catch (error) {
      log(`⚠️ ${kind} reconnect failed: ${error}`)
    }
  }
  onConnectionChange(kind, 'lost')
  return false
}

/**
 * FTMS requires the client to be granted control before any other control-point opcode is honoured,
 * and answers on the same characteristic by indication. Skipping this happens to work on some
 * trainers and is silently refused on others — and without the indication nothing ever reports that
 * a power target was rejected.
 */
async function requestFitnessMachineControl(characteristic) {
  try {
    await characteristic.startNotifications?.()
    characteristic.addEventListener?.(
      'characteristicvaluechanged',
      onControlPointResponse
    )
  } catch (error) {
    log('⚠️ Control Point indications unavailable: ' + error)
  }
  try {
    await writeControlPoint(characteristic, [OP_REQUEST_CONTROL])
    await writeControlPoint(characteristic, [OP_START_OR_RESUME])
  } catch (error) {
    // Not fatal: some trainers accept a target power without the handshake, and refusing to ride
    // because of a spec detail would be worse than trying.
    log('⚠️ Control request refused, sending power anyway: ' + error)
  }
}

function writeControlPoint(characteristic, bytes) {
  const data = new Uint8Array(bytes)
  return characteristic.writeValueWithResponse
    ? characteristic.writeValueWithResponse(data)
    : characteristic.writeValue(data)
}

function onControlPointResponse(event) {
  const value = event.target.value
  if (!value || value.byteLength < 3 || typeof value.getUint8 !== 'function')
    return
  // Response format: 0x80, request opcode, result code (0x01 = success).
  const requestOpcode = value.getUint8(1)
  const resultCode = value.getUint8(2)
  if (resultCode !== 0x01)
    log(
      `⚠️ Trainer refused control opcode 0x${requestOpcode.toString(16)} (result 0x${resultCode.toString(16)}).`
    )
}

async function takeControl(server) {
  const service = await server.getPrimaryService(FITNESS_MACHINE_SERVICE)
  controlCharacteristic = await service.getCharacteristic(
    FITNESS_MACHINE_CONTROL_POINT
  )
  await requestFitnessMachineControl(controlCharacteristic)
}

async function subscribeCyclingPower(server) {
  const service = await server.getPrimaryService(CYCLING_POWER_SERVICE)
  const characteristic = await service.getCharacteristic(
    CYCLING_POWER_MEASUREMENT
  )
  await characteristic.startNotifications()
  characteristic.addEventListener(
    'characteristicvaluechanged',
    onCyclingPowerNotification
  )
}

async function openErgometer(device) {
  const server = await device.gatt.connect()
  // Sequential, deliberately. Running the two service discoveries concurrently saves one BLE round
  // trip and coincided with intermittent connection failures on Android, whose GATT stack has a
  // reputation for mishandling overlapping operations. A second saved is not worth a pairing that
  // fails one time in two.
  await takeControl(server)
  await subscribeCyclingPower(server)
  // A reconnected trainer restarts its crank counters; keeping the old ones yields one absurd
  // cadence spike before the next revolution lands.
  prevCrankRevs = null
  prevCrankEventTime = null
  announcedFirstPower = false
  announcedFirstPowerReading = false
}

export async function connectErgometer() {
  log('Requesting Bluetooth device...')
  const device = await bluetoothApi.requestDevice({
    filters: [{ services: ['fitness_machine', 'cycling_power'] }]
  })
  log(`Connecting to ${device.name}...`)
  await openErgometer(device)
  log('✅ Connected and ready.')
  onConnectionChange('ergometer', 'connected')
  device.addEventListener('gattserverdisconnected', () => {
    log('⚠️ Device disconnected.')
    controlCharacteristic = null
    onPowerUpdate('-')
    onCadenceUpdate('-')
    reconnect(device, openErgometer, 'ergometer')
  })
  return device.name
}

export async function setErgPower(watts) {
  if (!controlCharacteristic) {
    log('⚠️ Not connected or characteristic missing.')
    return
  }
  try {
    await writeControlPoint(controlCharacteristic, [
      OP_SET_TARGET_POWER,
      watts & 0xff,
      (watts >> 8) & 0xff
    ])
    log(`➡️ Power set to ${watts} watts.`)
  } catch (error) {
    log('⚠️ Failed to send power command: ' + error)
  }
}

async function openHeartRateMonitor(device) {
  const server = await device.gatt.connect()
  const service = await server.getPrimaryService('heart_rate')
  const characteristic = await service.getCharacteristic(
    'heart_rate_measurement'
  )
  await characteristic.startNotifications()
  characteristic.addEventListener(
    'characteristicvaluechanged',
    onHeartRateNotification
  )
  announcedFirstHeartRate = false
  announcedFirstHeartRateReading = false
  return server
}

export async function connectHeartRateMonitor() {
  log('Requesting Bluetooth HRM device...')
  const device = await bluetoothApi.requestDevice({
    filters: [{ services: ['heart_rate'] }],
    optionalServices: ['battery_service']
  })
  const server = await openHeartRateMonitor(device)
  log('✅ Subscribed to Heart Rate notifications.')
  onConnectionChange('heartRateMonitor', 'connected')
  device.addEventListener('gattserverdisconnected', () => {
    log('⚠️ HRM device disconnected.')
    onHeartRateUpdate('-')
    reconnect(device, openHeartRateMonitor, 'heartRateMonitor')
  })
  return { name: device.name, batteryLevel: await readBattery(server) }
}

/**
 * Closing the device chooser is not a failure, and saying so would be noise. Everything else is
 * worth repeating verbatim: the browser's own wording ("GATT Server is disconnected", "No Services
 * matching UUID") is the only clue there is, and on a phone nobody is reading a console.
 */
export function describeConnectionFailure(deviceLabel, error) {
  if (/cancel/i.test(error?.message || '')) return null
  return `${deviceLabel}: ${error?.message || error}`
}

async function readBattery(server) {
  try {
    const batteryService = await server.getPrimaryService('battery_service')
    const batteryChar = await batteryService.getCharacteristic('battery_level')
    return (await batteryChar.readValue()).getUint8(0)
  } catch (e) {
    log('⚠️ Could not read battery level: ' + e)
    return null
  }
}

// A packet that arrives and then fails to parse leaves exactly the same trace as a packet that
// never arrived: none. Announcing the raw bytes of the first one, before touching them, is what
// separates "the device is silent" from "we cannot read what it says".
function describeBytes(value) {
  return Array.from(new Uint8Array(value.buffer))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join(' ')
}

function onCyclingPowerNotification(event) {
  const value = event.target.value
  if (!announcedFirstPower) {
    announcedFirstPower = true
    log(`✅ First trainer packet: ${describeBytes(value)}`)
  }
  try {
    readCyclingPower(value)
  } catch (error) {
    log(`⚠️ Unreadable trainer packet (${describeBytes(value)}): ${error}`)
  }
}

function readCyclingPower(value) {
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
        lastCadence = String(Math.round(cadenceRaw))
      }
    }
    prevCrankRevs = crankRevs
    prevCrankEventTime = crankEventTime
    cadence = lastCadence !== null ? lastCadence : '-'
  }
  if (!announcedFirstPowerReading) {
    announcedFirstPowerReading = true
    log(`✅ First trainer reading: ${instantaneousPower} W`)
  }
  onPowerUpdate(instantaneousPower)
  onCadenceUpdate(instantaneousPower === 0 ? '-' : cadence)
}

function onHeartRateNotification(event) {
  const value = event.target.value
  if (!announcedFirstHeartRate) {
    announcedFirstHeartRate = true
    log(`✅ First heart rate packet: ${describeBytes(value)}`)
  }
  try {
    readHeartRate(value)
  } catch (error) {
    log(`⚠️ Unreadable heart rate packet (${describeBytes(value)}): ${error}`)
  }
}

function readHeartRate(value) {
  let offset = 0
  const flags = value.getUint8(offset)
  offset += 1
  const hr =
    (flags & 0x01) === 0
      ? value.getUint8(offset)
      : value.getUint16(offset, true)
  if (!announcedFirstHeartRateReading) {
    announcedFirstHeartRateReading = true
    log(`✅ First heart rate reading: ${hr} bpm`)
  }
  onHeartRateUpdate(hr)
}
