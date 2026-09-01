import { isTestEnv } from './utils.js'

/**
 * The page's half of the conversation the service worker starts. The worker itself is
 * views/service_worker.js.erb.
 *
 * `sw.js`, not `/sw.js`: a rooted path would register a worker at the domain root rather than under
 * the sub-path this is served from, which is the bet index.erb explains at the top of the page.
 *
 * A worker outlives the page that registered it, and a test's browser outlives the test, so in the
 * suite it is registered only when a test asks for it by name. Otherwise one PWA test would leave a
 * worker answering for every test that ran after it in the same lane, out of a cache none of them
 * filled.
 */
export function registerServiceWorker(onUpdate) {
  if (!navigator.serviceWorker) return
  if (isTestEnv() && !localStorage.getItem('serviceWorker')) return

  // Whether this page was already being served by a worker when it loaded. The first registration
  // on a machine also fires controllerchange, and there is nothing stale about a page that has just
  // put the very first version in place.
  let controlled = !!navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (controlled) onUpdate()
    controlled = true
  })

  navigator.serviceWorker.register('sw.js').catch(error => {
    // Nothing here is load-bearing for a ride: a page with no worker is the app as it was before
    // there was one.
    console.warn('Service worker registration failed', error)
  })
}
