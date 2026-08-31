/**
 * What the ride was, once it is over.
 *
 * Everything here was already in `workoutSamples` — the array the TCX export has always written to
 * a file and the screen has never shown. The rider finished a session and learned nothing from it
 * without uploading it somewhere first.
 *
 * The one thing that needs care is that samples are NOT one per second. `addOrUpdateSample` starts
 * a new one only once more than 1.5 s has passed, and creates none at all while the ride is paused.
 * Averaging the samples themselves would weight a reading held for four seconds the same as one
 * held for two, and normalised power is defined over a 30-second rolling window of seconds, not of
 * samples. So the readings are expanded onto a one-second grid first, and everything is computed
 * from that.
 */

import { ZONES, zoneFor } from './zones.js'
import { formatDuration, reading } from './utils.js'

// How long a single reading may stand in for. Samples land about two seconds apart, so five
// absorbs ordinary jitter and a device that misses a notification or two. Past that the rider
// stopped — a pause, a dropped trainer, a phone call — and the remainder of the gap is counted as
// nothing at all rather than as more seconds at the last wattage seen, which is work nobody did.
const MAX_HOLD_SECONDS = 5

// Normalised power is defined on a 30-second rolling average, which is what makes it read the cost
// of an interval session rather than its arithmetic mean.
const ROLLING_WINDOW_SECONDS = 30

// Every caller has already established that it has something to average.
function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/**
 * The samples on a one-second grid: each reading repeated for as long as it stood, capped at
 * MAX_HOLD_SECONDS. The last sample stands for one second, having nothing after it to measure
 * against.
 */
function perSecondReadings(samples) {
  const readings = (samples || [])
    .map(sample => ({
      at: new Date(sample.time).getTime(),
      power: reading(sample.power),
      heartRate: reading(sample.heartRate)
    }))
    .filter(reading => isFinite(reading.at))

  const grid = []
  readings.forEach((reading, index) => {
    const next = readings[index + 1]
    const gap = next ? Math.round((next.at - reading.at) / 1000) : 1
    const held = Math.min(Math.max(gap, 1), MAX_HOLD_SECONDS)
    for (let second = 0; second < held; second++) grid.push(reading)
  })
  return grid
}

/**
 * (mean of the fourth powers of the 30-second rolling averages) ^ ¼.
 *
 * Null under thirty seconds of riding: the window has nothing to average, and a number invented
 * from a shorter one would not be normalised power.
 */
function normalisedPower(powers) {
  if (powers.length < ROLLING_WINDOW_SECONDS) return null
  const fourthPowers = []
  let sum = 0
  powers.forEach((power, index) => {
    sum += power
    if (index >= ROLLING_WINDOW_SECONDS)
      sum -= powers[index - ROLLING_WINDOW_SECONDS]
    if (index >= ROLLING_WINDOW_SECONDS - 1)
      fourthPowers.push((sum / ROLLING_WINDOW_SECONDS) ** 4)
  })
  return Math.round(average(fourthPowers) ** 0.25)
}

// Counted by the very lookup the workout graph is coloured by, so a bar's colour and the line
// claiming time in that zone can never tell two different stories.
function timeInZones(powers, ftp) {
  if (!ftp || !powers.length) return []
  const seconds = new Map()
  for (const power of powers) {
    const zone = zoneFor(power / ftp)
    seconds.set(zone, (seconds.get(zone) || 0) + 1)
  }
  // In the table's order, which is the order the bar draws them in.
  return ZONES.filter(zone => seconds.has(zone)).map(zone => ({
    name: zone.name,
    color: zone.color,
    seconds: seconds.get(zone),
    percent: (seconds.get(zone) / powers.length) * 100
  }))
}

/**
 * Null when the ride recorded no power at all — there is nothing to summarise, and an empty panel
 * says less than no panel.
 */
export function summariseSession(samples, ftp) {
  const grid = perSecondReadings(samples)
  const powers = grid
    .map(reading => reading.power)
    .filter(power => power !== null)
  if (!powers.length) return null
  const heartRates = grid
    .map(reading => reading.heartRate)
    .filter(rate => rate !== null && rate > 0)
  const averagePower = Math.round(average(powers))

  return {
    // Not displayed anywhere: it is how the tests pin the hold rule above, which is otherwise only
    // visible as its effect on the averages.
    seconds: grid.length,
    averagePower,
    normalisedPower: normalisedPower(powers),
    averageHeartRate: heartRates.length
      ? Math.round(average(heartRates))
      : null,
    zones: timeInZones(powers, ftp)
  }
}

/**
 * How the panel says these numbers. Here rather than in the Alpine component because they format
 * the shape this module defines: a zone row, and a metric that may be missing.
 */

// The unit belongs to the number, not to the row: an absent metric printed as "— W" reads as a
// broken reading rather than as one that was never taken.
export function metric(value, unit) {
  return value == null ? '—' : `${value} ${unit}`
}

// "12 min 30 s · 24 %" — the share is what the eye compares, the duration is what the legs
// remember.
export function zoneShare(zone) {
  return `${formatDuration(zone.seconds / 60)} · ${Math.round(zone.percent)} %`
}
