/**
 * The Concept2 PM5, over its proprietary service.
 *
 * Every layout below was decoded from frames this machine actually sent on 31 August 2026, and
 * every scale is cross-checked against a second field that carries the same quantity in different
 * units — a 100 m piece in 33.40 s is 167.0 s/500 m and 2.994 m/s, and the erg says all three. The
 * captures are in probe-reports/ (gitignored) and, stripped to the frames, in pm5-capture.js, which
 * is what the mock replays. Where a scale differs from Concept2's published spec, the comment says
 * so: two of them do.
 *
 * The rower is the machine that inverts the app. There is no ERG mode on a Concept2 — no
 * counterpart to setErgPower — which the probe settled rather than assumed: FTMS is exposed but
 * declares `Target Setting Features = 0x00000000` and carries no Control Point at all. So this
 * adapter reads and never writes, and the app becomes the metronome.
 */

import { describeBytes, u8, u16, u24 } from './frame.js'

const C2 = suffix => `ce0600${suffix}-43e5-11e4-916c-0800200c9a66`

export const ROWING_SERVICE = C2('30')
export const DEVICE_INFO_SERVICE = C2('10')
export const CONTROL_SERVICE = C2('20')

export const GENERAL_STATUS = C2('31')
export const ADDITIONAL_STATUS_1 = C2('32')
export const ADDITIONAL_STROKE_DATA = C2('36')
export const SPLIT_DATA = C2('37')
export const WORKOUT_SUMMARY = C2('39')

// Named here because the app has to declare, once, that it cannot drive this machine. Everything
// downstream — the cockpit's shape, whether a power target is sent, which sport the TCX claims —
// reads this rather than asking what kind of ergometer is on the other end.
export const CAPABILITIES = {
  kind: 'rower',
  label: 'Rower',
  controlsPower: false,
  metrics: ['power', 'strokeRate', 'split', 'distance']
}

// A stroke is two to three seconds; power arrives once per stroke, not continuously. Six seconds is
// two missed strokes at a slow rate, past which the rower has stopped rather than slowed.
const STROKE_TIMEOUT_MS = 6000

// The states worth a line in the device log. The rest are transitions nobody watching a screen
// needs named; 12 is the one this machine was observed in after a piece ended.
const WORKOUT_STATES = {
  0: 'waiting to begin',
  1: 'workout row',
  10: 'workout end',
  11: 'terminated',
  12: 'logged'
}

/**
 * 0x0031 General Status, 19 B, about 1 Hz even at rest. The authoritative distance: the stroke
 * characteristics carry the same counter, but this one keeps ticking between strokes.
 */
export function decodeGeneralStatus(view) {
  return {
    elapsed: u24(view, 0) / 100,
    distance: u24(view, 3) / 10,
    workoutType: u8(view, 6),
    intervalType: u8(view, 7),
    workoutState: u8(view, 8),
    rowingState: u8(view, 9),
    strokeState: u8(view, 10),
    totalWorkDistance: u24(view, 11) / 10,
    workoutDuration: u24(view, 14),
    workoutDurationType: u8(view, 17),
    dragFactor: u8(view, 18)
  }
}

/**
 * 0x0032 Additional Status 1, 17 B. Stroke rate is the field the cockpit reads; pace is decoded
 * because it is the machine's own answer to a number the app computes from power, and the two
 * agreeing is what pins the conversion in rowing.js.
 *
 * A heart rate of 255 means no belt is paired — it is not a reading.
 */
export function decodeAdditionalStatus1(view) {
  const heartRate = u8(view, 6)
  return {
    elapsed: u24(view, 0) / 100,
    speed: u16(view, 3) / 1000,
    strokeRate: u8(view, 5),
    heartRate: heartRate === 0xff ? null : heartRate,
    pace: u16(view, 7) / 100,
    averagePace: u16(view, 9) / 100,
    restDistance: u16(view, 11),
    restTime: u24(view, 13) / 100,
    ergMachineType: u8(view, 16)
  }
}

/**
 * 0x0036 Additional Stroke Data, 15 B, once at the end of each drive. This is where power comes
 * from, and it is the only characteristic that says anything while the piece is under way — the
 * 1 Hz status ones were, on this capture, silent between the start and the end of the piece.
 */
export function decodeAdditionalStrokeData(view) {
  return {
    elapsed: u24(view, 0) / 100,
    power: u16(view, 3),
    caloriesPerHour: u16(view, 5),
    strokeCount: u16(view, 7),
    projectedWorkTime: u24(view, 9),
    projectedWorkDistance: u24(view, 12)
  }
}

/**
 * 0x0037 Split Data, 18 B.
 *
 * Two scales here are NOT what Concept2's spec says. Split time reads 334 for a split the same
 * frame times at 33.39 s, so it is tenths and not hundredths; split distance reads 100 for 100 m,
 * so it is whole metres and not tenths. This is the same class of error OpenRowingMonitor already
 * found on Last Split Time.
 *
 * The split is reported only once the NEXT one opens, so a cockpit that read this as the current
 * split would be a whole interval behind. Nothing here is on the live path for that reason.
 */
export function decodeSplitData(view) {
  return {
    elapsed: u24(view, 0) / 100,
    distance: u24(view, 3) / 10,
    splitTime: u24(view, 6) / 10,
    splitDistance: u24(view, 9),
    restTime: u16(view, 12),
    restDistance: u16(view, 14),
    type: u8(view, 16),
    number: u8(view, 17)
  }
}

/**
 * 0x0039 Workout Summary, 20 B, once when a piece genuinely ends. An unlimited repeating interval
 * workout never emits one, because it never ends.
 *
 * The packed date and time were verified to the minute against the wall clock.
 */
export function decodeWorkoutSummary(view) {
  const date = u16(view, 0)
  return {
    // month = bits 0-3, day = bits 4-8, year - 2000 = bits 9-15.
    year: 2000 + (date >> 9),
    month: date & 0x0f,
    day: (date >> 4) & 0x1f,
    // Minutes first, then hours: 0x1630 is 22:48.
    minutes: u8(view, 2),
    hours: u8(view, 3),
    elapsed: u24(view, 4) / 100,
    distance: u24(view, 7) / 10,
    averageStrokeRate: u8(view, 10),
    endingHeartRate: u8(view, 11),
    averageHeartRate: u8(view, 12),
    minimumHeartRate: u8(view, 13),
    maximumHeartRate: u8(view, 14),
    averageDragFactor: u8(view, 15),
    recoveryHeartRate: u8(view, 16),
    workoutType: u8(view, 17),
    averagePace: u16(view, 18) / 10
  }
}

// Everything the connection has heard so far. Reset on open, because a reconnected PM5 that was
// zeroed in the meantime must not inherit the last session's distance.
let live = {}
let handlers = {}
let staleTimer = null
let announced = new Set()

// Once per characteristic, and only the first time: the raw bytes of a packet that did not parse
// are the only clue there is, and on a phone nobody is reading a console.
function decodeOrLog(uuid, label, value, decode) {
  if (!announced.has(uuid)) {
    announced.add(uuid)
    handlers.log(`✅ First ${label} packet: ${describeBytes(value)}`)
  }
  try {
    return decode(value)
  } catch (error) {
    handlers.log(`⚠️ Unreadable ${label} packet (${describeBytes(value)}): ${error}`)
    return null
  }
}

/**
 * Stroke rate, or the '-' that means "not rowing" — which is the same signal the bike sends with an
 * absent cadence, so the app pauses and resumes on a rower without knowing it is one.
 *
 * Two ways to be stopped, and both are needed. A rower who eases off drops to a rate of zero; a
 * rower who stops dead leaves the PM5 holding the last rate it saw — this machine was still
 * reporting 23 spm ten seconds after the final stroke — and only the absence of new strokes says so.
 */
function publishStrokeRate() {
  const stale = !live.lastStrokeAt || Date.now() - live.lastStrokeAt > live.strokeTimeoutMs
  const rowing = !stale && live.strokeRate > 0
  handlers.onStrokeRate(rowing ? live.strokeRate : '-')
  // A rower who has stopped is producing no watts, whatever the last stroke said. Saying so keeps
  // the recorded session honest and stops the summary averaging in work nobody did.
  if (stale) handlers.onPower(0)
}

function onGeneralStatus(value) {
  const status = decodeOrLog(GENERAL_STATUS, 'PM5 status', value, decodeGeneralStatus)
  if (!status) return
  handlers.onDistance(status.distance)
  if (live.dragFactor !== status.dragFactor) {
    live.dragFactor = status.dragFactor
    handlers.log(`Drag factor ${status.dragFactor}.`)
  }
  if (live.workoutState !== status.workoutState) {
    live.workoutState = status.workoutState
    const name = WORKOUT_STATES[status.workoutState]
    if (name) handlers.log(`PM5 workout state: ${name}.`)
  }
}

function onAdditionalStatus1(value) {
  const status = decodeOrLog(ADDITIONAL_STATUS_1, 'PM5 stroke rate', value, decodeAdditionalStatus1)
  if (!status) return
  live.strokeRate = status.strokeRate
  publishStrokeRate()
}

function onAdditionalStrokeData(value) {
  const stroke = decodeOrLog(ADDITIONAL_STROKE_DATA, 'PM5 stroke', value, decodeAdditionalStrokeData)
  if (!stroke) return
  live.lastStrokeAt = Date.now()
  handlers.onPower(stroke.power)
  publishStrokeRate()
}

function onSplitData(value) {
  const split = decodeOrLog(SPLIT_DATA, 'PM5 split', value, decodeSplitData)
  if (split) handlers.log(`Split ${split.number}: ${split.splitDistance} m in ${split.splitTime} s.`)
}

function onWorkoutSummary(value) {
  const summary = decodeOrLog(WORKOUT_SUMMARY, 'PM5 summary', value, decodeWorkoutSummary)
  if (!summary) return
  handlers.log(`PM5 summary: ${summary.distance} m in ${summary.elapsed} s.`)
  handlers.onErgSummary(summary)
}

const SUBSCRIPTIONS = [
  [GENERAL_STATUS, onGeneralStatus],
  [ADDITIONAL_STATUS_1, onAdditionalStatus1],
  [ADDITIONAL_STROKE_DATA, onAdditionalStrokeData],
  [SPLIT_DATA, onSplitData],
  [WORKOUT_SUMMARY, onWorkoutSummary]
]

/**
 * Sequential, deliberately, for the reason bluetooth.js already records: overlapping GATT
 * operations coincided with intermittent connection failures on Android. Five round trips here
 * rather than two, and no pairing that fails one time in two.
 */
export async function openPm5(server, callbacks, { strokeTimeoutMs = STROKE_TIMEOUT_MS } = {}) {
  handlers = callbacks
  live = { strokeTimeoutMs, strokeRate: 0, lastStrokeAt: null }
  announced = new Set()
  const service = await server.getPrimaryService(ROWING_SERVICE)
  for (const [uuid, onNotification] of SUBSCRIPTIONS) {
    const characteristic = await service.getCharacteristic(uuid)
    await characteristic.startNotifications()
    characteristic.addEventListener('characteristicvaluechanged', event =>
      onNotification(event.target.value)
    )
  }
  // The status characteristics keep firing after the last stroke, so nothing else would ever notice
  // that the rowing stopped. This is the only clock in the adapter.
  if (staleTimer) clearInterval(staleTimer)
  staleTimer = setInterval(publishStrokeRate, 1000)
}
