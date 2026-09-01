import { formatForTimer } from './utils.js'

/**
 * The rower's units, and the one conversion between them.
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
