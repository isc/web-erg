/**
 * A GATT server with no radio behind it.
 *
 * The bike half is synthetic: it makes up a power packet from whatever wattage localStorage names,
 * which is enough because the app's cycling path has been exercised on the real trainer for months.
 *
 * The rowing half is not synthetic. It replays pm5-capture.js — the frames a Concept2 PM5 sent on
 * 31 August 2026, in the order it sent them — so the decoder is tested against bytes the machine
 * really produced rather than against our idea of what it produces. There is no erg here and there
 * will not be one; this is the only thing that makes the port verifiable.
 *
 * Three liberties are taken with the replay:
 *
 *  - Time is compressed twentyfold, so a seventy-three second piece takes under four seconds. The
 *    order and the spacing are the capture's; only the clock is faster.
 *  - When the frames run out, the 1 Hz status characteristics keep repeating their last packet and
 *    the stroke ones fall silent. That is not an invention: it is exactly what the machine did for
 *    the ten seconds after the final stroke of the captured piece.
 *  - Nothing is sent until the page dispatches `mock-pm5-go`. See `replay()` below.
 */

import { bytesFrom } from './ergometers/frame.js'
import { FITNESS_MACHINE_SERVICE } from './ergometers/ftms-bike.js'
import {
  ADDITIONAL_STATUS_1,
  CONTROL_SERVICE,
  DEVICE_INFO_SERVICE,
  GENERAL_STATUS,
  ROWING_SERVICE
} from './ergometers/concept2-pm5.js'

const CONTROL_POINT = '00002ad9-0000-1000-8000-00805f9b34fb'
const POWER_MEASUREMENT = '00002a63-0000-1000-8000-00805f9b34fb'
const CYCLING_POWER = '00001818-0000-1000-8000-00805f9b34fb'
const HEART_RATE_CONTROL = 'ce060040-43e5-11e4-916c-0800200c9a66'

// The services each machine answers for, taken from the adapters themselves. Spelling them out here
// would let the mock's idea of what a PM5 is drift from the app's, and the drift would surface as
// "the mock stopped looking like a rower" rather than as anything that points at the cause.
const PM5_SERVICES = [
  DEVICE_INFO_SERVICE,
  CONTROL_SERVICE,
  ROWING_SERVICE,
  HEART_RATE_CONTROL,
  FITNESS_MACHINE_SERVICE
]
const BIKE_SERVICES = [FITNESS_MACHINE_SERVICE, CYCLING_POWER]

// The characteristics the PM5 broadcasts on a timer rather than on a stroke. Taken from the capture:
// these notified 144 times in the seventy-three seconds, the stroke ones only when a stroke ended.
// It matters because their carrying on is what tells the adapter that the rowing has stopped.
const PERIODIC = new Set([GENERAL_STATUS, ADDITIONAL_STATUS_1])

// Twenty times the capture's own clock, which is what turns a seventy-three second piece into a
// test that finishes.
const SPEED = 20
const CAPTURE = 'fixed-100m'

// Keyed by the characteristic UUID the caller asks for, the way a real GATT server is: dispatching
// on the service instead meant a service could only ever hand back one characteristic shape.
const CHARACTERISTIC_TYPES = {
  [CONTROL_POINT]: 'control',
  [POWER_MEASUREMENT]: 'power',
  heart_rate_measurement: 'hr',
  battery_level: 'battery'
}

function setting(key, fallback) {
  return localStorage.getItem(key) || fallback
}

function FakeCharacteristic(type) {
  this.type = type
  this._listeners = {}
}
FakeCharacteristic.prototype.startNotifications = function () {
  return Promise.resolve(this)
}
FakeCharacteristic.prototype.writeValue = function () {
  return Promise.resolve()
}
FakeCharacteristic.prototype.writeValueWithResponse = function () {
  return Promise.resolve()
}
FakeCharacteristic.prototype.readValue = function () {
  return Promise.resolve({ getUint8: () => 37 })
}
FakeCharacteristic.prototype.addEventListener = function (event, cb) {
  this._listeners[event] = cb
  // Only the measurement characteristics stream. The control point answers by indication, and
  // faking a stream of power packets on it made the response parser choke.
  if (event !== 'characteristicvaluechanged') return
  if (this.type !== 'power' && this.type !== 'hr') return
  setInterval(() => {
    const watts = localStorage.getItem('ergPower') || 0
    cb({ target: { value: this.type === 'power' ? bikePower(watts) : heartRate() } })
  }, 1000)
}

function bikePower(watts) {
  const now = Date.now()
  const targetRPM = watts > 0 ? 60 : 0
  let flags = 0x00
  let crankRevs = 0
  let crankEventTime = 0
  if (targetRPM > 0) {
    flags = 0x10 // Cadence data present
    crankRevs = Math.floor((now / 1000) * (targetRPM / 60)) % 65536
    crankEventTime = ((now / 1000) * 1024) % 65536
  }
  return {
    getUint16: offset => {
      if (offset === 0) return flags
      if (offset === 4) return crankRevs
      if (offset === 6) return crankEventTime
      return 0
    },
    getInt16: offset => (offset === 2 ? watts : 0),
    byteLength: 8,
    buffer: new Uint8Array(8).buffer
  }
}

function heartRate() {
  return {
    // Offset 0 is the flags byte, offset 1 the 8-bit rate. Answering 0 to both, as this
    // used to, meant the mock reported a heart rate of zero.
    getUint8: offset => (offset === 0 ? 0x00 : 120),
    getUint16: () => 120,
    byteLength: 2,
    buffer: new Uint8Array([0x00, 120]).buffer
  }
}

/**
 * One PM5, replaying one captured session. The characteristics share a registry because the capture
 * is a single stream in wall-clock order: scheduling each characteristic separately would let the
 * status frames that close the piece arrive before the strokes that earn them.
 */
function pm5Device(captures) {
  const session = captures[CAPTURE]
  const listeners = new Map()
  let started = false

  const deliver = frame => listeners.get(frame.uuid)?.({ target: { value: bytesFrom(frame.hex) } })

  function run() {
    for (const frame of session.frames)
      setTimeout(() => deliver(frame), frame.at / SPEED)
    const ends = session.frames[session.frames.length - 1].at / SPEED
    // The last packet each periodic characteristic sent, repeated at the rate it was sending them.
    const held = [...PERIODIC]
      .map(uuid => session.frames.filter(frame => frame.uuid === uuid).pop())
      .filter(Boolean)
    setTimeout(() => setInterval(() => held.forEach(deliver), 1000), ends)
  }

  // Subscribing is not rowing. If the capture started the moment the app subscribed — which is when
  // the erg connects — the piece would be running while the form was still being filled in, and how
  // many metres were on the monitor at Start would be decided by how fast the browser was that
  // afternoon. So the capture waits on the shelf until the page says go, which puts every stroke
  // after Start. A page that never says go has a PM5 that is connected and silent, which is a real
  // enough state — an erg with nobody on it — and the one a test about what the cockpit *computes*
  // wants, since nothing then overwrites a reading it wrote itself.
  function replay() {
    if (started) return
    started = true
    window.addEventListener('mock-pm5-go', run, { once: true })
  }

  function characteristic(uuid) {
    const fake = new FakeCharacteristic('pm5')
    fake.addEventListener = (event, cb) => {
      if (event !== 'characteristicvaluechanged') return
      listeners.set(uuid, cb)
      replay()
    }
    fake.readValue = () =>
      Promise.resolve(bytesFrom(session.reads[uuid] || '00'))
    return fake
  }

  return {
    services: PM5_SERVICES,
    getCharacteristic: uuid => Promise.resolve(characteristic(uuid))
  }
}

function bikeDevice() {
  return {
    services: BIKE_SERVICES,
    getCharacteristic: uuid =>
      Promise.resolve(
        new FakeCharacteristic(CHARACTERISTIC_TYPES[uuid] || 'unknown')
      )
  }
}

function heartRateDevice() {
  return {
    services: ['heart_rate', 'battery_service'],
    getCharacteristic: uuid =>
      Promise.resolve(
        new FakeCharacteristic(CHARACTERISTIC_TYPES[uuid] || 'unknown')
      )
  }
}

const mockBluetooth = {
  requestDevice: async opts => {
    const failure = localStorage.getItem('mockBluetoothFailure')
    if (failure) throw new Error(failure)

    const wantsHeartRate = opts.filters?.some(filter =>
      filter.services?.includes('heart_rate')
    )
    const rowing = setting('mockErgometer', 'bike') === 'pm5'
    // Loaded here rather than imported at the top: the capture is 32 kB of hex that only a test
    // ever reads, and a static import puts it on the module graph of every real page load.
    const machine = wantsHeartRate
      ? heartRateDevice()
      : rowing
        ? pm5Device((await import('./pm5-capture.js')).CAPTURES)
        : bikeDevice()

    // A real GATT server refuses a service the device does not have, and that refusal is how the
    // app tells a rower from a trainer. A mock that resolved everything would make every machine
    // look like the last one added.
    const server = {
      getPrimaryService: uuid =>
        machine.services.includes(uuid)
          ? Promise.resolve(machine)
          : Promise.reject(
              new Error(`No Services matching UUID ${uuid} found in Device.`)
            )
    }

    const name = wantsHeartRate ? 'Fake HRM' : rowing ? 'Fake PM5' : 'Fake Ergo'
    return {
      name,
      gatt: { connect: () => Promise.resolve(server) },
      addEventListener: () => {}
    }
  }
}
export default mockBluetooth
