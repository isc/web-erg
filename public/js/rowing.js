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
 * m:ss.t — the form a PM5 prints and every rower reads. Tenths are kept because a split is held to
 * about a second and the tenth is what tells you which side of the target you are on.
 */
export function formatSplit(seconds) {
  if (seconds == null || !isFinite(seconds)) return '—'
  const total = Math.max(0, Number(seconds))
  const minutes = Math.floor(total / 60)
  const rest = total - minutes * 60
  return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`
}

// Metres, as the cockpit says them: whole numbers below a kilometre, kilometres above, where the
// last few metres stop being the thing you are reading. Nothing rowed reads as an em dash, the
// same as a split nobody has produced yet — a machine that has not spoken is not a machine at zero.
export function formatDistance(metres) {
  if (metres == null || !isFinite(metres)) return '—'
  if (metres < 1000) return String(Math.round(metres))
  return `${(metres / 1000).toFixed(2)} km`
}
