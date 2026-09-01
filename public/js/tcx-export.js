import { downloadDataUrl, reading } from './utils.js'

/**
 * Where the distance in an exported activity comes from.
 *
 * A trainer reports none, so the bike's is modelled: watts against rolling resistance and drag,
 * solved for the speed that would consume them. A Concept2 counts the flywheel and reports metres,
 * so on a rower the whole model goes and the samples carry the answer — and the speed written to
 * each trackpoint is then the distance the erg actually covered over the time it took, rather than
 * a number a bicycle would have gone at that wattage.
 */
function hasMeasuredDistance(samples) {
  return samples.some(sample => reading(sample.distance) !== null)
}

function virtualSpeedFromPower(powerWatts, options = {}) {
  // Physical constants
  const g = 9.81 // gravity (m/s²)
  const airDensity = 1.225 // kg/m³ (standard air)

  // Cyclist / bike parameters (default values)
  const mass = options.mass ?? 80 // total mass in kg
  const cda = options.cda ?? 0.3 // frontal aerodynamic coefficient (m²)
  const cr = options.cr ?? 0.005 // rolling resistance coefficient
  const slope = options.slope ?? 0 // slope (rad) - here 0 rad = flat

  // Numerical resolution: binary search on speed
  let vMin = 0 // minimum speed (m/s)
  let vMax = 50 // maximum speed (m/s) => 180 km/h, more than enough
  let v = 0

  const tolerance = 0.01 // tolerance on power (W)
  const maxIterations = 100

  for (let i = 0; i < maxIterations; i++) {
    v = (vMin + vMax) / 2

    // Resistance forces
    const rollingResistance = cr * mass * g
    const aerodynamicDrag = 0.5 * airDensity * cda * v * v
    const gravityResistance = mass * g * Math.sin(slope) // here = 0 if flat road

    const totalResistance =
      rollingResistance + aerodynamicDrag + gravityResistance

    const estimatedPower = totalResistance * v

    if (Math.abs(estimatedPower - powerWatts) < tolerance) {
      break
    }

    if (estimatedPower > powerWatts) {
      vMax = v
    } else {
      vMin = v
    }
  }

  return v // in m/s for TCX
}

// Nothing here was escaped, and both the name and the description come straight from a .zwo's
// textContent — already decoded. A workout called "Sweet Spot & Threshold" produced an XML
// document that no importer would accept.
function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Text content is escaped by construction; nested elements are passed as an array of already-built
 * markup. Leaving that to the caller is what let `tag('Name', workoutName)` ship unescaped in the
 * first place — a builder that cannot tell text from children will eventually be handed the wrong
 * one again.
 */
function tag(name, content = '', attrs = {}) {
  const attrStr = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
    .join('')
  const inner = Array.isArray(content) ? content.join('') : escapeXml(content)
  return `<${name}${attrStr}>${inner}</${name}>`
}

export function generateTcx(samples, name = '', weight = 70, sport = 'Biking') {
  if (!samples || samples.length === 0) return ''
  const measured = hasMeasuredDistance(samples)
  const activityId = samples[0].time
  const startedAt = new Date(samples[0].time).getTime()
  let previousTime = startedAt
  // Cumulative across the whole activity, because a Trackpoint's DistanceMeters is measured from
  // the start of the activity while a Lap's is the lap's own. Two different quantities, one of
  // which is a difference of the other.
  let totalDistance = 0

  // One lap per workout phase. A single lap for the whole session threw away the only structure the
  // session had — an 8 x 500 m arrived at Strava as one undifferentiated block. Samples recorded
  // before phases were stamped carry no phaseIndex, so they all share `undefined` and fall into a
  // single lap exactly as before.
  const laps = []
  let lap = null
  const openLap = sample => ({
    phaseIndex: sample.phaseIndex,
    phaseLabel: sample.phaseLabel,
    startTime: sample.time,
    startedAt: new Date(sample.time).getTime(),
    lastTime: 0,
    // Accumulated as the lap runs rather than differenced at the end. A start-and-end pair needed
    // both a fallback for the end that could never fire and a clamp against a subtraction that
    // could never go negative, which is two defences around a number that is simply a sum.
    distance: 0,
    kilojoules: 0,
    maxSpeed: 0,
    heartRateSum: 0,
    heartRateCount: 0,
    maxHeartRate: 0,
    trackpoints: ''
  })

  for (const sample of samples) {
    // Pushed at creation. Lap objects are mutated by reference for the rest of their samples, so
    // appending here rather than on the way out removes both the second push site and its guard.
    if (!lap || sample.phaseIndex !== lap.phaseIndex) {
      lap = openLap(sample)
      laps.push(lap)
    }
    const time = new Date(sample.time).getTime()
    // Samples are not one per second — they are created whenever more than 1.5 s has passed, and
    // not at all while the session is paused. Assuming a 1 s step, as this used to, under-reported
    // both the duration and the distance of every ride uploaded to Strava.
    const stepSeconds = Math.max(0, (time - previousTime) / 1000)
    previousTime = time
    lap.lastTime = time

    const hasPower = sample.power !== undefined && sample.power !== '-'
    const children = []
    let speed
    // Work done is work done however the distance was arrived at.
    if (hasPower) lap.kilojoules += (Number(sample.power) * stepSeconds) / 1000
    if (measured) {
      // The erg's own count, which only ever goes up. A sample the distance stream had not reached
      // yet leaves the total where it was rather than resetting it to zero.
      const metres = reading(sample.distance)
      if (metres !== null && metres > totalDistance) {
        speed = stepSeconds > 0 ? (metres - totalDistance) / stepSeconds : 0
        lap.distance += metres - totalDistance
        totalDistance = metres
        if (speed > lap.maxSpeed) lap.maxSpeed = speed
      } else {
        speed = 0
      }
    } else if (hasPower) {
      speed = virtualSpeedFromPower(Number(sample.power), { mass: weight + 10 })
      lap.distance += speed * stepSeconds
      totalDistance += speed * stepSeconds
      if (speed > lap.maxSpeed) lap.maxSpeed = speed
    }

    children.push(tag('Time', sample.time))
    children.push(tag('DistanceMeters', totalDistance.toFixed(2)))
    if (sample.cadence !== undefined && sample.cadence !== '-')
      children.push(tag('Cadence', Math.round(Number(sample.cadence))))
    if (sample.heartRate !== undefined && sample.heartRate !== '-') {
      const bpm = Math.round(Number(sample.heartRate))
      lap.heartRateSum += bpm
      lap.heartRateCount++
      if (bpm > lap.maxHeartRate) lap.maxHeartRate = bpm
      children.push(tag('HeartRateBpm', [tag('Value', bpm)]))
    }
    if (hasPower)
      children.push(
        tag(
          'Extensions',
          [
            tag(
              'ns3:TPX',
              [
                tag('ns3:Speed', speed.toFixed(3)),
                tag('ns3:Watts', Math.round(Number(sample.power)))
              ],
              {
                'xmlns:ns3':
                  'http://www.garmin.com/xmlschemas/ActivityExtension/v2'
              }
            )
          ]
        )
      )
    lap.trackpoints += tag('Trackpoint', children)
  }

  // ActivityLap_t is a sequence: TotalTimeSeconds, DistanceMeters, MaximumSpeed?, Calories,
  // AverageHeartRateBpm?, MaximumHeartRateBpm?, Intensity, Cadence?, TriggerMethod, Track*, Notes?.
  // Calories, Intensity and TriggerMethod are REQUIRED and were missing, and the lap carried a
  // <Name> element, which the schema has no such thing as — Notes is the right place, and it is
  // where a phase's own label goes.
  const lapTag = entry => {
    const children = [
      tag('TotalTimeSeconds', ((entry.lastTime - entry.startedAt) / 1000).toFixed(2)),
      tag('DistanceMeters', entry.distance.toFixed(2))
    ]
    if (entry.maxSpeed > 0) children.push(tag('MaximumSpeed', entry.maxSpeed.toFixed(3)))
    children.push(tag('Calories', Math.round(entry.kilojoules)))
    if (entry.heartRateCount)
      children.push(
        tag('AverageHeartRateBpm', [
          tag('Value', Math.round(entry.heartRateSum / entry.heartRateCount))
        ]),
        tag('MaximumHeartRateBpm', [tag('Value', entry.maxHeartRate)])
      )
    children.push(
      tag('Intensity', 'Active'),
      tag('TriggerMethod', 'Manual'),
      tag('Track', [entry.trackpoints])
    )
    if (entry.phaseLabel) children.push(tag('Notes', entry.phaseLabel))
    return tag('Lap', children, { StartTime: entry.startTime })
  }

  const activityChildren = [tag('Id', activityId), ...laps.map(lapTag)]
  if (name) activityChildren.push(tag('Notes', name))
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    tag(
      'TrainingCenterDatabase',
      // The TCX schema allows only Running, Biking and Other, so a rowing session goes out as
      // Other and gets its type corrected in Strava after import. There is no third option to
      // choose more carefully between.
      [tag('Activities', [tag('Activity', activityChildren, { Sport: sport })])],
      {
        xmlns: 'http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2',
        'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
        'xsi:schemaLocation':
          'http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd'
      }
    )
  )
}

export function downloadTcx(tcxString) {
  const blob = new Blob([tcxString], { type: 'application/xml' })
  const url = URL.createObjectURL(blob)
  downloadDataUrl(url, '.tcx')
}
