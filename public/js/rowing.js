import { formatCountdown, formatDuration, formatForTimer } from './utils.js'

/**
 * The rower's units, the one conversion between them, and how a reading in either one is read.
 *
 * A rower reads split — the time to cover 500 m at the current effort — where a cyclist reads
 * watts. Concept2 defines the two as the same measurement: watts = 2.80 / pace³, with pace in
 * seconds per metre. It is an identity, not a model, which is why there is no aerodynamic
 * guesswork here to match `virtualSpeedFromPower`.
 *
 * The probe confirmed it on the machine: the PM5 reported 75 W average and 167.0 s/500 m average
 * for the same 100 m piece, and 2.80 / (167/500)³ = 75.1 W.
 *
 * Everything the cockpit shows in split therefore comes through here, from watts — including the
 * target. Target and actual are then the same computation applied to two numbers, so the deviation
 * between them is a real difference in effort rather than the gap between two estimators.
 *
 * The deviation between the two, and the phase readings below it, are here for the same reason:
 * they are arithmetic on those units, and they were getters on the Alpine component until reaching
 * them meant booting a browser and connecting an erg.
 */

// Concept2's published constant. Pace is seconds per metre throughout; only the display divides by
// 500, because "split" is a distance the number happens to be quoted over, not a unit of its own.
const WATTS_PER_PACE_CUBED = 2.8

/** Seconds to cover 500 m at this power, or null when there is no power to convert. */
export function splitFromPower(watts) {
  const power = Number(watts)
  if (!isFinite(power) || power <= 0) return null
  return 500 * Math.cbrt(WATTS_PER_PACE_CUBED / power)
}

/** The watts a 500 m split asks for — the inverse, used to read a target back out of a split. */
export function powerFromSplit(splitSeconds) {
  const split = Number(splitSeconds)
  if (!isFinite(split) || split <= 0) return null
  const pace = split / 500
  return WATTS_PER_PACE_CUBED / (pace * pace * pace)
}

/**
 * m:ss — the form a PM5 prints and every rower reads.
 *
 * Whole seconds, not tenths. An earlier version kept the tenth on the grounds that it says which
 * side of the target you are on, but a stroke-to-stroke split swings by seconds, so the tenth was
 * noise dressed as precision — and it read worst on the target, which does not move at all and had
 * no business being quoted to 2:11.5. The deviation bar is what says which side of the target you
 * are on, and it says it without arithmetic.
 */
export function formatSplit(seconds) {
  if (seconds == null || !isFinite(seconds)) return '—'
  // Rounded BEFORE formatForTimer sees it. Handing it a fraction printed 1:59.96, and taking the
  // minute out first and rounding the remainder after printed 1:60 for anything above 1:59.5.
  return formatForTimer(Math.round(Math.max(0, Number(seconds))))
}

// Always metres, whatever the number: a countdown that switches to "6.00 km" at a thousand loses
// the metre it is counting in. `formatDistance` is the one that chooses its unit; this is the one
// for a reading whose unit is fixed. Both keep the space non-breaking, which is the whole reason
// they are here rather than spelled out at each call site.
export function formatMetres(metres) {
  if (metres == null || !isFinite(metres)) return '—'
  return `${Math.round(metres)}\u00a0m`
}

// Metres, as the cockpit says them: whole metres below a kilometre, kilometres above, where the
// last few metres stop being the thing you are reading. The unit is part of the answer and not the
// caller's to add — it changes with the number, and every caller that appended its own "m" printed
// "6.00 km m" for any session past a kilometre, which is most of them.
//
// Nothing rowed reads as an em dash, the same as a split nobody has produced yet: a machine that
// has not spoken is not a machine at zero.
// The space before the unit is non-breaking. In a cockpit column narrow enough to wrap, an ordinary
// space put the "m" on its own line under the number, which reads as a stray letter rather than as
// a unit.
export function formatDistance(metres) {
  if (metres == null || !isFinite(metres)) return '—'
  if (metres < 1000) return formatMetres(metres)
  return `${(metres / 1000).toFixed(2)}\u00a0km`
}

/**
 * The gap between the split being rowed and the split the workout is asking for.
 *
 * Negative is faster, because a smaller split is a better one — so the sign reads the way a rower
 * expects rather than the way a subtraction does. Both arguments come out of `splitFromPower`, so
 * the difference is a real difference in effort and not the gap between two estimators.
 *
 * Null when either side is missing: a free ride has no target, and an erg nobody is pulling has no
 * split, and neither is a deviation of zero. The three readings below say the same by being empty,
 * which is why they return '' and not the em dash a missing split prints — there is no gap to
 * quote, so there is no line to write.
 */
export function splitDelta(currentSplit, targetSplit) {
  if (currentSplit == null || targetSplit == null) return null
  return currentSplit - targetSplit
}

export function formatSplitDelta(delta) {
  if (delta == null) return ''
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '±'
  return `${sign}${Math.abs(delta).toFixed(1)} s /500 m`
}

// Two seconds per 500 m is about what a good rower holds; past five the piece is a different piece.
// The same two thresholds colour the bar and the number, so they cannot disagree.
export function splitDeltaStatus(delta) {
  if (delta == null) return ''
  const gap = Math.abs(delta)
  if (gap <= 2) return 'split-good'
  return gap <= 5 ? 'split-close' : 'split-warning'
}

/**
 * The deviation bar, as an inline style: a fill that grows from the centre towards whichever side
 * the rower is on, and is anchored to it whichever side that is. Ten seconds per 500 m pins it —
 * past that the exact size of the error has stopped being the useful information.
 */
export function splitDeltaStyle(delta) {
  if (delta == null) return '--from: 50%; --width: 0%'
  const offset = Math.max(-50, Math.min(50, (delta / 10) * 50))
  const from = offset >= 0 ? 50 : 50 + offset
  return `--from: ${from}%; --width: ${Math.abs(offset)}%`
}

/**
 * A phase, and what is left of it, read in the unit it was written in.
 *
 * A phase written in metres counts down in metres: its duration is only an estimate, and a
 * countdown that reached zero with two hundred metres still to row would be worse than none. That
 * choice is rowing's — no ride is measured this way — so the readings it decides live here, beside
 * the other conversion between the rower's two units. Each takes the phase and asks it, rather than
 * being told which unit to use: which one a phase is written in is the phase's own business.
 */
export function formatPhaseCountdown(phase, remaining) {
  // Rounded once, and by the same rule for both units, so the number and the unit under it cannot
  // disagree: 59.7 s reads "1:00" and must not be labelled "seconds".
  const value = whole(remaining)
  return phase?.distance ? String(value) : formatCountdown(value)
}

export function countdownUnit(phase, remaining) {
  if (phase?.distance) return 'metres to go'
  return whole(remaining) < 60 ? 'seconds' : 'remaining'
}

// The wide layout's own line under the graph. It used to be seconds and only seconds, so a
// thousand-metre piece showed 0:00 from its first second to its last.
export function formatPhaseRemaining(phase, remaining) {
  return phase?.distance ? formatMetres(remaining) : formatForTimer(whole(remaining))
}

// "500 m" or "4 min", whichever the phase was written in — the whole of it, not what is left.
export function formatPhaseLength(phase) {
  if (!phase) return ''
  return phase.distance
    ? formatMetres(phase.distance)
    : formatDuration((phase.duration || 0) / 60)
}

function whole(seconds) {
  return Math.max(0, Math.round(Number(seconds) || 0))
}
