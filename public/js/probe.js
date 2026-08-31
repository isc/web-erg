/**
 * What is actually inside the erg, as opposed to what the documentation says is inside it.
 *
 * Everything the rowing port needs to be written rests on the PM5's Bluetooth layout, and every
 * UUID in ROWING.md was written from memory. This page connects, walks the GATT tree, reads what
 * can be read and listens to what notifies, and hands the whole thing back as a report — so the
 * adapter is written against observed bytes rather than against a recollection.
 *
 * Deliberately plain DOM, with no Alpine and no CDN: a diagnostic tool that fails to load because a
 * CDN is slow, on the one occasion the erg is in front of us, would be a bad trade for consistency
 * with the rest of the app.
 */

// Concept2 publishes its own service under this base — 16-bit shorthand does not apply, so every
// UUID is spelled in full. Standard services follow, because the whole question this page answers
// first is whether a recent PM5 also exposes FTMS, which would make the port far shorter.
const C2 = suffix => `ce0600${suffix}-43e5-11e4-916c-0800200c9a66`

// Every proprietary service has to be named here or it stays invisible: getPrimaryServices() only
// returns what the chooser granted, so a service absent from this list reads in the report exactly
// like a service the erg does not have. The four are taken from OpenRowingMonitor's PM5 emulation
// (app/peripherals/ble/pm5/), which is an implementation rather than a recollection.
const CANDIDATE_SERVICES = [
  C2('10'), // device information (proprietary)
  C2('20'), // control — CSAFE
  C2('30'), // rowing
  C2('40'), // heart rate control
  'fitness_machine',
  'cycling_power',
  'cycling_speed_and_cadence',
  'heart_rate',
  'device_information',
  'battery_service'
]

// Anything that answers on the rowing service is worth naming in the report, so the dump reads as
// something other than a wall of UUIDs. Wrong guesses are harmless: the name is a label, and the
// bytes underneath are reported either way.
const EXPECTED_NAMES = {
  [C2('11')]: 'model number?',
  [C2('12')]: 'serial number?',
  [C2('13')]: 'hardware revision?',
  [C2('14')]: 'firmware revision?',
  [C2('15')]: 'manufacturer?',
  [C2('16')]: 'erg machine type?',
  [C2('17')]: 'ATT mtu?',
  [C2('18')]: 'log data?',
  [C2('21')]: 'control receive (CSAFE)?',
  [C2('22')]: 'control transmit?',
  [C2('31')]: 'general status',
  [C2('32')]: 'additional status 1',
  [C2('33')]: 'additional status 2',
  [C2('34')]: 'status sample rate?',
  [C2('35')]: 'stroke data (end of drive, end of recovery)',
  [C2('36')]: 'additional stroke data (end of drive)',
  [C2('37')]: 'split data (end of split)',
  [C2('38')]: 'additional split data (end of split)',
  [C2('39')]: 'workout summary (end of workout)',
  [C2('3a')]: 'additional workout summary (end of workout)',
  [C2('3b')]: 'heart rate belt information?',
  [C2('3d')]: 'force curve (end of drive)',
  [C2('3e')]: 'additional status 3',
  [C2('3f')]: 'logged workout (end of workout)',
  [C2('41')]: 'heart rate control?'
}

const report = { startedAt: new Date().toISOString(), device: null, services: [], log: [] }

const $ = id => document.getElementById(id)

function log(message) {
  const at = new Date().toLocaleTimeString()
  report.log.push(`${at} ${message}`)
  const li = document.createElement('li')
  li.innerHTML = `<small>${at}</small> ${message}`
  $('log').prepend(li)
  console.log(message)
}

function hex(dataView) {
  return Array.from(new Uint8Array(dataView.buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join(' ')
}

// A model number and a firmware revision are ASCII; a status packet is not. Printing both spellings
// costs one line and saves guessing which of the two a characteristic meant to be.
function ascii(dataView) {
  return Array.from(new Uint8Array(dataView.buffer))
    .map(b => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '·'))
    .join('')
}

function describeProperties(properties) {
  return ['read', 'write', 'writeWithoutResponse', 'notify', 'indicate']
    .filter(name => properties[name])
    .join(', ')
}

function row(entry) {
  const tr = document.createElement('tr')
  tr.id = `char-${entry.uuid}`
  const guess = EXPECTED_NAMES[entry.uuid] ? ` <em>${EXPECTED_NAMES[entry.uuid]}</em>` : ''
  tr.innerHTML = `
    <td><code>${entry.uuid}</code>${guess}</td>
    <td><small>${entry.properties}</small></td>
    <td class="count">${entry.packets.length || '—'}</td>
    <td class="sample"><code>${entry.read ? entry.read.hex : ''}</code></td>`
  return tr
}

async function readCharacteristic(characteristic, entry) {
  try {
    const value = await characteristic.readValue()
    entry.read = { hex: hex(value), ascii: ascii(value), bytes: value.byteLength }
    log(`read ${entry.uuid} → ${entry.read.hex}  "${entry.read.ascii}"`)
  } catch (error) {
    entry.readError = String(error)
    log(`⚠️ read ${entry.uuid} failed: ${error}`)
  }
}

// Keeping the first ten alone is what the first run got wrong: a characteristic that already
// notified while the erg sat idle filled its quota with zeroes, and the rowing that followed was
// discarded. So keep both ends — the opening frames, which show the resting state, and a rolling
// window of the most recent ones, which is where the load actually is.
const PACKETS_FIRST = 5
const PACKETS_LAST = 10

async function subscribe(characteristic, entry) {
  try {
    await characteristic.startNotifications()
    characteristic.addEventListener('characteristicvaluechanged', event => {
      entry.total = (entry.total || 0) + 1
      const packet = { at: new Date().toISOString(), hex: hex(event.target.value) }
      if (entry.packets.length < PACKETS_FIRST) {
        entry.packets.push(packet)
        if (entry.packets.length === 1) log(`✅ first packet on ${entry.uuid}: ${packet.hex}`)
      } else {
        entry.recent.push(packet)
        if (entry.recent.length > PACKETS_LAST) entry.recent.shift()
      }
      const tr = $(`char-${entry.uuid}`)
      if (!tr) return
      tr.querySelector('.count').textContent = entry.total
      tr.querySelector('.sample').innerHTML = `<code>${hex(event.target.value)}</code>`
    })
    entry.subscribed = true
  } catch (error) {
    entry.subscribeError = String(error)
    log(`⚠️ subscribe ${entry.uuid} failed: ${error}`)
  }
}

/**
 * Sequential throughout, and not by accident. bluetooth.js already carries the lesson: running two
 * service discoveries concurrently coincided with intermittent connection failures on Android,
 * whose GATT stack mishandles overlapping operations. A probe that runs the tree in parallel and
 * fails halfway would be blamed on the erg.
 */
async function walk(server) {
  let services = []
  try {
    services = await server.getPrimaryServices()
  } catch (error) {
    log(`⚠️ could not enumerate services: ${error}`)
    return
  }
  log(`${services.length} service(s) reachable.`)
  for (const service of services) {
    const block = { uuid: service.uuid, characteristics: [] }
    report.services.push(block)

    const section = document.createElement('section')
    section.innerHTML = `<h3><code>${service.uuid}</code></h3>
      <table><thead><tr><th>characteristic</th><th>properties</th><th>packets</th>
      <th>last / read</th></tr></thead><tbody></tbody></table>`
    $('tree').append(section)
    const tbody = section.querySelector('tbody')

    let characteristics = []
    try {
      characteristics = await service.getCharacteristics()
    } catch (error) {
      log(`⚠️ ${service.uuid}: no characteristics readable: ${error}`)
      continue
    }
    for (const characteristic of characteristics) {
      const entry = {
        uuid: characteristic.uuid,
        properties: describeProperties(characteristic.properties),
        packets: [],
        recent: []
      }
      block.characteristics.push(entry)
      tbody.append(row(entry))
      if (characteristic.properties.read) await readCharacteristic(characteristic, entry)
      if (characteristic.properties.notify || characteristic.properties.indicate)
        await subscribe(characteristic, entry)
    }
  }
  log('✅ Walk complete. Now row for thirty seconds, then send the report.')
}

async function connect(options) {
  try {
    $('send').disabled = false
    log('Requesting device…')
    const device = await navigator.bluetooth.requestDevice(options)
    report.device = { name: device.name || null, id: device.id || null }
    log(`Connecting to ${device.name || '(unnamed)'}…`)
    device.addEventListener('gattserverdisconnected', () => log('⚠️ disconnected.'))
    const server = await device.gatt.connect()
    log('✅ Connected. Walking the GATT tree…')
    await walk(server)
  } catch (error) {
    log(`⚠️ ${error}`)
  }
}

async function send() {
  report.sentAt = new Date().toISOString()
  try {
    const response = await fetch('probe/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report, null, 2)
    })
    const body = await response.json()
    log(response.ok ? `✅ Report saved as ${body.path}` : `⚠️ Server refused: ${body.error}`)
  } catch (error) {
    log(`⚠️ Could not send report: ${error}`)
  }
}

$('pm5').addEventListener('click', () =>
  connect({ filters: [{ namePrefix: 'PM5' }], optionalServices: CANDIDATE_SERVICES })
)
// The fallback that matters if the erg names itself anything else: the chooser shows everything,
// and the report still records what was found under whatever name it went by.
$('any').addEventListener('click', () =>
  connect({ acceptAllDevices: true, optionalServices: CANDIDATE_SERVICES })
)
$('send').addEventListener('click', send)

if (!navigator.bluetooth)
  log('⚠️ No navigator.bluetooth — this page needs Chrome/Edge over localhost or HTTPS.')
