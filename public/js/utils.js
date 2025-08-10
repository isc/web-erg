export function isTestEnv() {
  return document.cookie.includes('test-env')
}

export function formatForTimer(seconds) {
  const min = Math.floor(seconds / 60)
  const sec = seconds % 60
  return `${min}:${sec.toString().padStart(2, '0')}`
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
}
