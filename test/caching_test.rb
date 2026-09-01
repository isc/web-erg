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

  def test_every_module_must_be_revalidated
    %w[/js/main.js /js/bluetooth.js /js/session-store.js /main.css].each do |asset|
      assert_includes header_for(asset).to_s, 'no-cache', "#{asset} may be served stale"
    end
  end
end
