export function isTestEnv() {
  return document.cookie.includes('test-env')
}

export function formatForTimer(seconds) {
  const min = Math.floor(seconds / 60)
  const sec = seconds % 60
  return `${min}:${sec.toString().padStart(2, '0')}`
}

// A workout is 50.83 minutes only to a machine. Durations are stored as decimal minutes — the
// library JSON does too, and the filters compare them numerically — so the rounding belongs here,
// at the point of display, and nowhere else.
export function formatDuration(minutes) {
  const totalSeconds = Math.round(Number(minutes) * 60)
  if (!isFinite(totalSeconds) || totalSeconds <= 0) return ''
  const hours = Math.floor(totalSeconds / 3600)
  const mins = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  // Seconds are noise once a session runs into hours.
  if (hours) return mins ? `${hours} h ${mins} min` : `${hours} h`
  // A 30-second interval is "30 s", not "0 min 30 s".
  if (!mins) return `${seconds} s`
  if (seconds) return `${mins} min ${seconds} s`
  return `${mins} min`
}

// Under a minute the seconds are the whole message, and a leading "0:" is noise on a number meant
// to be read at a glance. Above, m:ss is the only readable form.
export function formatCountdown(seconds) {
  const value = Math.max(0, Math.round(Number(seconds) || 0))
  if (value < 60) return String(value)
  return formatForTimer(value)
}

export function parseXmlDoc(xmlText) {
  const parser = new DOMParser()
  return parser.parseFromString(xmlText, 'application/xml')
}

export function downloadDataUrl(dataUrl, extension) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = new Date().toISOString() + extension
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // This function owns the anchor, so it owns the object URL's lifetime too. Revoking on the same
  // tick as the click races the download in some browsers.
  if (dataUrl.startsWith('blob:'))
    setTimeout(() => URL.revokeObjectURL(dataUrl), 60000)
}
