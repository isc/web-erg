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

function tag(name, content = '', attrs = {}) {
  const attrStr = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join('')
  return `<${name}${attrStr}>${content}</${name}>`
}

export function generateTcx(samples, name = '', weight = 70) {
  if (!samples || samples.length === 0) return ''
  let totalDistance = 0
  const activityId = samples[0].time
  const lapStartTime = samples[0].time
  let trackpoints = ''
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]
    let speed = undefined
    if (s.power !== undefined && s.power !== '-')
      speed = virtualSpeedFromPower(Number(s.power), { mass: weight + 10 })
    let dist = 0
    if (speed !== undefined && i > 0) dist = speed * 1
    totalDistance += dist
    let children =
      tag('Time', s.time) + tag('DistanceMeters', totalDistance.toFixed(2))
    if (s.cadence !== undefined && s.cadence !== '-')
      children += tag('Cadence', Math.round(Number(s.cadence)))
    if (s.heartRate !== undefined && s.heartRate !== '-')
      children += tag(
        'HeartRateBpm',
        tag('Value', Math.round(Number(s.heartRate)))
      )
    if (s.power !== undefined && s.power !== '-')
      children += tag(
        'Extensions',
        tag(
          'ns3:TPX',
          (speed !== undefined ? tag('ns3:Speed', speed.toFixed(3)) : '') +
            tag('ns3:Watts', Math.round(Number(s.power))),
          {
            'xmlns:ns3': 'http://www.garmin.com/xmlschemas/ActivityExtension/v2'
          }
        )
      )
    trackpoints += tag('Trackpoint', children)
  }
  const track = tag('Track', trackpoints)
  const lap = tag(
    'Lap',
    tag('TotalTimeSeconds', samples.length) +
      tag('DistanceMeters', '0') +
      tag('Name', name) + // Ajout du titre dans le Lap
      track,
    { StartTime: lapStartTime }
  )
  const activity = tag('Activity', tag('Id', activityId) + lap, {
    Sport: 'Biking'
  })
  const activities = tag('Activities', activity)
  const tcx =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    tag('TrainingCenterDatabase', activities, {
      xmlns: 'http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2',
      'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
      'xsi:schemaLocation':
        'http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd'
    })
  return tcx
}

export function downloadTcx(tcxString) {
  const blob = new Blob([tcxString], { type: 'application/xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = new Date().toISOString() + '.tcx'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
