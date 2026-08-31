/**
 * Turns the phases of a .zwo file into the flat, second-by-second timeline both the runner and the
 * SVG work from. It lives on its own because they used to expand phases separately, and disagreed:
 * the SVG kept the phases the runner silently dropped, so `data-phase-index` stopped matching the
 * runner's index and the progress highlight pointed at the wrong bar for the rest of the session.
 *
 * A phase may now be measured in metres instead of seconds. Rowing is trained in distance — 4×1000,
 * 8×500, a 2 km test — and .zwo has no way to say so, which is why no subset of the Zwift library
 * contains those sessions: they are not expressible in it. A `Distance` attribute is the extension,
 * and it is the erg's own count that ends such a phase, not a clock.
 *
 * A distance phase still gets a duration, because the graph has to draw a bar of some width and the
 * session line has to show a total. That number is an ESTIMATE and nothing about the ride depends
 * on it: it is what the phase would take at the split its power target implies.
 */
import { splitFromPower } from './rowing.js'

// The shipped library is not consistent about tag names: `Freeride` and `cooldown` appear alongside
// the documented spellings, and some collections use tags Zwift never documented (`SolidState`,
// `MaxEffort`, `RestDay`). Matching on the raw tagName dropped 40 of the workouts in this repo.
const CANONICAL_TYPES = new Map([
  ['warmup', 'Warmup'],
  ['cooldown', 'Cooldown'],
  ['steadystate', 'SteadyState'],
  ['solidstate', 'SteadyState'],
  ['ramp', 'Ramp'],
  ['intervalst', 'IntervalsT'],
  ['freeride', 'FreeRide'],
  ['maxeffort', 'MaxEffort'],
  ['restday', 'RestDay']
])

function canonicalType(tagName) {
  return CANONICAL_TYPES.get(String(tagName).toLowerCase()) || tagName
}

// When nothing has said otherwise. Only the width of a bar depends on it.
const NOMINAL_FTP = 150
// A distance phase with no power target — most of the Concept2 archive, which specifies structure
// and never intensity — is drawn as though it were rowed at a steady endurance effort.
const NOMINAL_RELATIVE_POWER = 0.75

/**
 * How long a phase measured in metres would take, at the split its power target implies. Used for
 * the graph and the session total; the phase itself ends on metres rowed.
 */
function estimatedSeconds(distance, relativePower, ftp) {
  const split = splitFromPower((relativePower || NOMINAL_RELATIVE_POWER) * ftp)
  return Math.round((distance / 500) * split)
}

// Seconds if the phase names them, an estimate from metres if it names those instead.
function lengthOf(distance, duration, power, ftp) {
  return distance
    ? { distance, duration: estimatedSeconds(distance, power, ftp) }
    : { duration: duration || 0 }
}

export function expandPhases(phases, ftp = NOMINAL_FTP) {
  const expanded = []
  for (const phase of phases) {
    const type = canonicalType(phase.type)
    const cadence = {
      cadence: phase.cadence,
      cadenceLow: phase.cadenceLow,
      cadenceHigh: phase.cadenceHigh
    }

    if (type === 'IntervalsT') {
      const repeat = phase.repeat || 1
      for (let i = 0; i < repeat; i++) {
        expanded.push({
          type: 'On',
          ...lengthOf(phase.onDistance, phase.onDuration, phase.onPower, ftp),
          power: phase.onPower,
          cadence: phase.cadence
        })
        expanded.push({
          type: 'Off',
          ...lengthOf(phase.offDistance, phase.offDuration, phase.offPower, ftp),
          power: phase.offPower,
          cadence: phase.cadenceResting
        })
      }
    } else if (type === 'Warmup' || type === 'Cooldown' || type === 'Ramp') {
      const powerLow = phase.powerLow ?? phase.power ?? 0
      const powerHigh = phase.powerHigh ?? powerLow
      const ramping = powerLow !== powerHigh
      expanded.push({
        type: ramping ? 'Ramp' : type,
        duration: phase.duration,
        ...(ramping ? { powerLow, powerHigh } : { power: powerLow }),
        ...cadence
      })
    } else if (type === 'SteadyState') {
      expanded.push({
        type: 'SteadyState',
        ...lengthOf(phase.distance, phase.duration, phase.power, ftp),
        power: phase.power || 0,
        ...cadence
      })
    } else {
      // FreeRide, MaxEffort, RestDay — and whatever a future .zwo introduces. No ERG target, but
      // the phase keeps its slot in the timeline: that is the whole point of not dropping it.
      expanded.push({
        type,
        ...lengthOf(phase.distance, phase.duration, phase.target, ftp),
        freeRide: true,
        // Zwift's Freeride elements carry a Target the trainer does not enforce. It is still the
        // number the rider is meant to hold, so it is worth showing even though nothing sends it.
        target: phase.target,
        ...cadence
      })
    }
  }
  return expanded
}

const PHASE_LABELS = {
  On: 'Effort',
  Off: 'Recovery',
  Warmup: 'Warm-up',
  Cooldown: 'Cool-down',
  Ramp: 'Ramp',
  SteadyState: 'Steady',
  FreeRide: 'Free ride',
  MaxEffort: 'Max effort',
  RestDay: 'Rest'
}

export function phaseLabel(type) {
  return PHASE_LABELS[type] || type
}

export function totalDurationSeconds(expandedPhases) {
  return expandedPhases.reduce((sum, phase) => sum + (phase.duration || 0), 0)
}

// How long one un-expanded phase lasts, going through the same expansion as everything else so a
// phase's length can never be computed two ways.
export function phaseDurationSeconds(phase) {
  return totalDurationSeconds(expandPhases([phase]))
}
