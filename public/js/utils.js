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
