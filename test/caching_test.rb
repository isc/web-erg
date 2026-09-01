require_relative 'test_helper'

# A browser left to choose its own freshness lifetime per file will happily pair a fresh module with
# a stale one, and an ES module graph that fails to link renders nothing at all.
class CachingTest < ModuleTestBase
  def header_for(path)
    page.evaluate_async_script(<<~JS, path)
      const done = arguments[arguments.length - 1]
      fetch(arguments[0], { cache: 'no-store' })
        .then(r => done(r.headers.get('cache-control')))
    JS
  end

  def test_the_page_must_be_revalidated
    assert_includes header_for('/'), 'no-cache'
  end

  # Every file the service worker will be told to hold, and the worker's own script — which is the
  # one whose freshness decides all the others', since the browser re-fetches it on each navigation
  # and installs a new version only if its bytes moved. Asserted against the real list rather than
  # against a handful of names, because a handful is a second answer to "what is the app" and it is
  # the weaker one.
  def test_every_asset_the_worker_holds_must_be_revalidated
    stale = page.evaluate_async_script(<<~JS, App::PRECACHE + ['sw.js'])
      const done = arguments[arguments.length - 1]
      Promise.all(arguments[0].map(asset =>
        fetch(asset, { cache: 'no-store' })
          .then(r => [asset, r.headers.get('cache-control')])
      )).then(pairs => done(pairs.filter(([, header]) => !(header || '').includes('no-cache'))))
    JS

    assert_empty stale, 'these may be served stale, and a stale one of them is half an app'
  end
end
