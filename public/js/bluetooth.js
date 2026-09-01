import { isTestEnv } from './utils.js'
import mockBluetooth from './bluetooth_mock.js'
import { decodeNotification, u8, u16 } from './ergometers/frame.js'
import {
  CAPABILITIES as BIKE,
  FITNESS_MACHINE_SERVICE,
  closeBike,
  openBike,
  setTargetPower
} from './ergometers/ftms-bike.js'
import {
  CAPABILITIES as ROWER,
  CONTROL_SERVICE,
  DEVICE_INFO_SERVICE,
  ROWING_SERVICE,
  closePm5,
  openPm5
} from './ergometers/concept2-pm5.js'

const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000]

const TEST_STROKE_TIMEOUT_MS = 1500

let announcedFirstHeartRateReading = false
let seenHeartRate = new Set()

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

/**
 * The machines this app knows how to talk to.
 *
 * Each declares what it can do rather than what it is, and answers for itself whether a given GATT
 * server is one of it. Adding the third — FTMS Rower firmware, or an OpenRowingMonitor emulating a
 * PM5 — is a matter of appending an entry, not of editing the connection path.
 *
 * Order matters only in that the first match wins, and the two matchers are disjoint: a trainer has
 * no rowing service and a Concept2 exposes neither cycling service.
 */
const ADAPTERS = [
  {
    capabilities: ROWER,
    service: ROWING_SERVICE,
    open: openPm5,
    close: closePm5,
    // Under a mock the whole capture replays in a few seconds, so six real seconds of silence would
    // outlast the session and never fire. The adapter takes the figure rather than reading the
    // environment itself: what counts as "stopped rowing" is the caller's question.
    options: () => (isTestEnv() ? { strokeTimeoutMs: TEST_STROKE_TIMEOUT_MS } : {})
  },
  {
    capabilities: BIKE,
    service: FITNESS_MACHINE_SERVICE,
    open: openBike,
    close: closeBike,
    setTargetPower,
    options: () => ({})
  }
]

let adapter = ADAPTERS[ADAPTERS.length - 1]

/**
 * What the connected machine can do, which is not the same question as what it is. The rest of the
 * app reads this rather than branching on a device name: a rower reports distance and cannot be
 * driven, a trainer can be driven and reports cadence, and every screen that differs between the
 * two differs on one of those facts.
 */
export function ergometerCapabilities() {
  return adapter.capabilities
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
  onDistance: value => onDistanceUpdate(value)
}

/**
 * Which machine is on the other end, asked of the machine rather than of its name.
 *
 * A PM5 advertises as "PM5 <serial>", but a renamed monitor or an OpenRowingMonitor emulating one
 * would not, and the answer that matters is which services are actually there. Asking for one the
 * device does not have is refused, which is the whole test.
 */
async function openErgometer(device) {
  const server = await device.gatt.connect()
  for (const candidate of ADAPTERS) {
    try {
      await server.getPrimaryService(candidate.service)
    } catch {
      continue
    }
    adapter = candidate
    await candidate.open(server, handlers, candidate.options())
    return
  }
  throw new Error('Connected, but this device speaks neither FTMS nor Concept2.')
}

export async function connectErgometer() {
  log('Requesting Bluetooth device...')
  const device = await bluetoothApi.requestDevice({
    // A service filter matches what a device *advertises*, not what it turns out to have once
    // connected — and a PM5 advertises neither its rowing service nor FTMS. Filtering on
    // ROWING_SERVICE alone therefore left the erg out of the chooser entirely while /probe, which
    // asks by name, found it every time. So the name goes in, exactly as the probe asks for it:
    // this hardware answers to `PM5 430912985`. Filters are alternatives, so the trainer's shape is
    // unaffected, and the service filters stay for a firmware that does advertise them.
    filters: [
      { services: ['fitness_machine', 'cycling_power'] },
      { services: [ROWING_SERVICE] },
      { namePrefix: 'PM5' }
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
  log(`✅ Connected and ready — ${adapter.capabilities.label.toLowerCase()}.`)
  onConnectionChange('ergometer', 'connected')
  device.addEventListener('gattserverdisconnected', () => {
    log('⚠️ Device disconnected.')
    // Whatever the adapter was still running on its own — a control characteristic it would keep
    // writing to, a clock still pushing readings into a screen whose device is gone.
    adapter.close()
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
  if (!adapter.setTargetPower) return
  await adapter.setTargetPower(watts)
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
  announcedFirstHeartRateReading = false
  seenHeartRate = new Set()
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
  const hr = decodeNotification({
    seen: seenHeartRate,
    key: 'heart_rate',
    label: 'heart rate',
    value: event.target.value,
    decode: readHeartRate,
    log
  })
  if (hr === null) return
  if (!announcedFirstHeartRateReading) {
    announcedFirstHeartRateReading = true
    log(`✅ First heart rate reading: ${hr} bpm`)
  }
  onHeartRateUpdate(hr)
}

// Bit 0 of the flags says whether the rate is one byte or two.
function readHeartRate(value) {
  const flags = u8(value, 0)
  return (flags & 0x01) === 0 ? u8(value, 1) : u16(value, 1)
}
