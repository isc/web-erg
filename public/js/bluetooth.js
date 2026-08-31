import { isTestEnv } from './utils.js'
import mockBluetooth from './bluetooth_mock.js'
import { describeBytes, u8, u16 } from './ergometers/frame.js'
import {
  CAPABILITIES as BIKE,
  FITNESS_MACHINE_SERVICE,
  forgetControl,
  openBike,
  setTargetPower
} from './ergometers/ftms-bike.js'
import {
  CAPABILITIES as ROWER,
  CONTROL_SERVICE,
  DEVICE_INFO_SERVICE,
  ROWING_SERVICE,
  openPm5
} from './ergometers/concept2-pm5.js'

const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000]

// Under a mock the whole capture replays in a few seconds, so six real seconds of silence would
// outlast the session and never fire. The adapter takes the figure rather than reading the
// environment itself: what counts as "stopped rowing" is the caller's question.
const TEST_STROKE_TIMEOUT_MS = 1500

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
let onDistanceUpdate = () => {}
let onErgSummary = () => {}

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
// Metres rowed, straight off the PM5. The bike has no counterpart: its distance is modelled from
// power at export time, and there is nothing live to report.
export function setOnDistanceUpdate(cb) {
  onDistanceUpdate = cb
}
// What the machine itself says the session was, when it says so. Only a rower does.
export function setOnErgSummary(cb) {
  onErgSummary = cb
}

/**
 * What the connected machine can do, which is not the same question as what it is. The rest of the
 * app reads this rather than branching on a device name: a rower reports distance and cannot be
 * driven, a trainer can be driven and reports cadence, and every screen that differs between the
 * two differs on one of those facts.
 */
let capabilities = BIKE

export function ergometerCapabilities() {
  return capabilities
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

// What each adapter is handed. One object, so an adapter can only reach the app through the same
// callbacks the app already exposes, and adding a machine cannot quietly add a back channel.
const handlers = {
  log,
  onPower: value => onPowerUpdate(value),
  onCadence: value => onCadenceUpdate(value),
  onStrokeRate: value => onCadenceUpdate(value),
  onDistance: value => onDistanceUpdate(value),
  onErgSummary: value => onErgSummary(value)
}

/**
 * Which machine is on the other end, asked of the machine rather than of its name.
 *
 * A PM5 advertises as "PM5 <serial>", but a renamed monitor or an OpenRowingMonitor emulating one
 * would not, and the answer that matters is whether the proprietary rowing service is there. A
 * trainer refuses it, which is the whole test.
 */
async function openErgometer(device) {
  const server = await device.gatt.connect()
  try {
    await server.getPrimaryService(ROWING_SERVICE)
  } catch {
    capabilities = BIKE
    await openBike(server, handlers)
    return
  }
  capabilities = ROWER
  await openPm5(server, handlers, {
    ...(isTestEnv() ? { strokeTimeoutMs: TEST_STROKE_TIMEOUT_MS } : {})
  })
}

export async function connectErgometer() {
  log('Requesting Bluetooth device...')
  const device = await bluetoothApi.requestDevice({
    // Two filters, not one: a Concept2 exposes neither of the standard cycling services under a
    // name the chooser can filter on, and a trainer has no rowing service. Either shape is offered.
    filters: [
      { services: ['fitness_machine', 'cycling_power'] },
      { services: [ROWING_SERVICE] }
    ],
    // Everything a filter did not already grant, and the PM5's own device-information service —
    // getPrimaryService refuses a UUID that was never asked for, which reads exactly like a machine
    // that does not have it.
    optionalServices: [
      FITNESS_MACHINE_SERVICE,
      ROWING_SERVICE,
      DEVICE_INFO_SERVICE,
      CONTROL_SERVICE
    ]
  })
  log(`Connecting to ${device.name}...`)
  await openErgometer(device)
  log(`✅ Connected and ready — ${capabilities.label.toLowerCase()}.`)
  onConnectionChange('ergometer', 'connected')
  device.addEventListener('gattserverdisconnected', () => {
    log('⚠️ Device disconnected.')
    forgetControl()
    onPowerUpdate('-')
    onCadenceUpdate('-')
    reconnect(device, openErgometer, 'ergometer')
  })
  return device.name
}

/**
 * The workout's power target, sent to the machine — where there is a machine that takes one.
 *
 * A Concept2 has no ERG mode: the load comes from the flywheel and the damper, mechanically, and
 * the probe confirmed the monitor advertises no target-setting features at all. The runner still
 * computes the target every second, because on a rower that number is the whole of the feedback;
 * it simply stops being sent anywhere and starts being displayed instead.
 */
export async function setErgPower(watts) {
  if (!capabilities.controlsPower) return
  await setTargetPower(watts)
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
  const flags = u8(value, 0)
  const hr = (flags & 0x01) === 0 ? u8(value, 1) : u16(value, 1)
  if (!announcedFirstHeartRateReading) {
    announcedFirstHeartRateReading = true
    log(`✅ First heart rate reading: ${hr} bpm`)
  }
  onHeartRateUpdate(hr)
}
