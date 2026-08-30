/**
 * Keeps the ride on disk while it happens.
 *
 * Samples used to live only in the Alpine component: a closed tab, a browser crash or a laptop
 * asleep at minute 45 destroyed the whole session, because nothing was written anywhere until
 * "Export activity" was clicked at the very end.
 *
 * Everything here is defensive. localStorage throws in private windows and when the quota is full,
 * and losing the ability to ride because a backup failed would be a worse bargain than the loss it
 * guards against.
 */

const KEY = 'web-erg:session'

export function saveSession(session) {
  try {
    localStorage.setItem(KEY, JSON.stringify(session))
    return true
  } catch (error) {
    console.warn('Could not save the session in progress: ' + error)
    return false
  }
}

export function loadSession() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const session = JSON.parse(raw)
    // A session with no samples has nothing to recover, and anything that does not look like one is
    // treated as absent rather than as an error: this runs on every page load.
    if (!session?.samples?.length) return null
    return session
  } catch (error) {
    console.warn('Ignoring an unreadable stored session: ' + error)
    return null
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(KEY)
  } catch (error) {
    console.warn('Could not clear the stored session: ' + error)
  }
}
