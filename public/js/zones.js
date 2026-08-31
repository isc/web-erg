/**
 * The power bands, as one table.
 *
 * They used to be a ladder of ifs inside the SVG renderer, which was fine while the graph was the
 * only thing that had an opinion about zones. The end-of-session summary counts time against the
 * same bounds, so a second copy of the numbers — or of the rule for reading them — would eventually
 * let a bar's colour and the line claiming time in that zone tell two different stories.
 *
 * Both the fractions of FTP and the colours live here: every consumer wants both, and neither the
 * renderer nor the summary is a sensible host for a table the other one needs.
 */

export const ZONES = [
  { name: 'Recovery', max: 0.56, color: '#888' },
  { name: 'Endurance', max: 0.76, color: '#2196f3' },
  { name: 'Tempo', max: 0.9, color: '#4caf50' },
  { name: 'Threshold', max: 1.05, color: '#ffeb3b' },
  { name: 'VO2 max', max: 1.2, color: '#ff9800' },
  { name: 'Anaerobic', max: Infinity, color: '#f44336' }
]

/**
 * The band a fraction of FTP falls in. Bounds are exclusive-upper and the table is ascending; that
 * rule is written once, here, rather than at each place that needs an answer.
 */
export function zoneFor(relative) {
  // The last band runs to Infinity, so only a NaN — a phase with no power, a reading that never
  // arrived — can miss every bound, and the caller still needs a zone back.
  return ZONES.find(zone => relative < zone.max) || ZONES[ZONES.length - 1]
}

export function getZoneColor(relative) {
  return zoneFor(relative).color
}
