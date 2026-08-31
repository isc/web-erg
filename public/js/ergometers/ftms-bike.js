/**
 * The smart trainer, over standard FTMS plus Cycling Power.
 *
 * This is the machine the app was written for, moved here unchanged when the PM5 arrived and needed
 * the same seam. It is also the only one of the two that can be driven: FTMS carries a Control
 * Point, so the workout's power target becomes the trainer's resistance and the rider only has to
 * turn the pedals.
 */

import { decodeNotification, i16, u16 } from './frame.js'

export const FITNESS_MACHINE_SERVICE = '00001826-0000-1000-8000-00805f9b34fb'
export const FITNESS_MACHINE_CONTROL_POINT = '00002ad9-0000-1000-8000-00805f9b34fb'
const CYCLING_POWER_SERVICE = '00001818-0000-1000-8000-00805f9b34fb'
const CYCLING_POWER_MEASUREMENT = '00002a63-0000-1000-8000-00805f9b34fb'

// Fitness Machine Control Point opcodes (FTMS 4.16).
const OP_REQUEST_CONTROL = 0x00
const OP_START_OR_RESUME = 0x07
const OP_SET_TARGET_POWER = 0x05

export const CAPABILITIES = {
  kind: 'bike',
  label: 'Bike',
  controlsPower: true,
  metrics: ['power', 'cadence']
}

let controlCharacteristic = null
let handlers = {}
let prevCrankRevs = null
let prevCrankEventTime = null
let lastCadence = null
let announcedFirstPowerReading = false
let seen = new Set()

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
    handlers.log('⚠️ Control Point indications unavailable: ' + error)
  }
  try {
    await writeControlPoint(characteristic, [OP_REQUEST_CONTROL])
    await writeControlPoint(characteristic, [OP_START_OR_RESUME])
  } catch (error) {
    // Not fatal: some trainers accept a target power without the handshake, and refusing to ride
    // because of a spec detail would be worse than trying.
    handlers.log('⚠️ Control request refused, sending power anyway: ' + error)
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
    handlers.log(
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

export async function openBike(server, callbacks) {
  handlers = callbacks
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
  announcedFirstPowerReading = false
  seen = new Set()
}

// A trainer that has gone away cannot be sent a target, and pretending otherwise turns every
// second of the workout into a failed write.
export function closeBike() {
  controlCharacteristic = null
}

export async function setTargetPower(watts) {
  if (!controlCharacteristic) {
    handlers.log('⚠️ Not connected or characteristic missing.')
    return
  }
  try {
    await writeControlPoint(controlCharacteristic, [
      OP_SET_TARGET_POWER,
      watts & 0xff,
      (watts >> 8) & 0xff
    ])
    handlers.log(`➡️ Power set to ${watts} watts.`)
  } catch (error) {
    handlers.log('⚠️ Failed to send power command: ' + error)
  }
}

function onCyclingPowerNotification(event) {
  const reading = decodeNotification({
    seen,
    key: CYCLING_POWER_MEASUREMENT,
    label: 'trainer',
    value: event.target.value,
    decode: readCyclingPower,
    log: handlers.log
  })
  if (!reading) return
  if (!announcedFirstPowerReading) {
    announcedFirstPowerReading = true
    handlers.log(`✅ First trainer reading: ${reading.power} W`)
  }
  handlers.onPower(reading.power)
  handlers.onCadence(reading.power === 0 ? '-' : reading.cadence)
}

function readCyclingPower(value) {
  let offset = 0
  const flags = u16(value, offset)
  offset += 2
  const instantaneousPower = i16(value, offset)
  offset += 2
  if (flags & 0x01) offset += 1
  if (flags & 0x02) offset += 2
  if (flags & 0x04) offset += 6
  if (flags & 0x08) offset += 2
  let cadence = '-'
  if (flags & 0x10) {
    const crankRevs = u16(value, offset)
    offset += 2
    const crankEventTime = u16(value, offset)
    if (prevCrankRevs !== null && prevCrankEventTime !== null) {
      let revsDiff = crankRevs - prevCrankRevs
      let timeDiff = crankEventTime - prevCrankEventTime
      if (revsDiff < 0) revsDiff += 65536
      if (timeDiff < 0) timeDiff += 65536
      if (revsDiff > 0 && timeDiff > 0)
        lastCadence = String(Math.round((revsDiff * 60 * 1024) / timeDiff))
    }
    prevCrankRevs = crankRevs
    prevCrankEventTime = crankEventTime
    cadence = lastCadence !== null ? lastCadence : '-'
  }
  return { power: instantaneousPower, cadence }
}
