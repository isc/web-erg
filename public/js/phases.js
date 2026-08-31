/**
 * Turns the phases of a .zwo file into the flat, second-by-second timeline both the runner and the
 * SVG work from. It lives on its own because they used to expand phases separately, and disagreed:
 * the SVG kept the phases the runner silently dropped, so `data-phase-index` stopped matching the
 * runner's index and the progress highlight pointed at the wrong bar for the rest of the session.
 */

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

export function expandPhases(phases) {
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
          duration: phase.onDuration,
          power: phase.onPower,
          cadence: phase.cadence
        })
        expanded.push({
          type: 'Off',
          duration: phase.offDuration,
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
        duration: phase.duration,
        power: phase.power || 0,
        ...cadence
      })
    } else {
      // FreeRide, MaxEffort, RestDay — and whatever a future .zwo introduces. No ERG target, but
      // the phase keeps its slot in the timeline: that is the whole point of not dropping it.
      expanded.push({
        type,
        duration: phase.duration || 0,
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
