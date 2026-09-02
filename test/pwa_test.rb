require 'json'
require 'tmpdir'
require_relative 'test_helper'

# The app is read on a phone propped against an erg, on a home Wi-Fi that is not always there.
# Installing it and surviving the network are the two halves of that, and the second one is a cache
# — which is the thing commit 2117d78 was written to forbid. These tests are mostly about why that
# is not a contradiction.

# What the browser needs before it will offer to install anything. Read off disk: a manifest is a
# file, and nothing about these questions needs a page open.
class ManifestTest < Minitest::Test
  MANIFEST = JSON.parse(File.read(File.expand_path('../public/manifest.webmanifest', __dir__)))

  def test_the_manifest_says_what_an_install_needs
    assert_equal 'Web ERG Trainer', MANIFEST['name']
    assert_equal 'standalone', MANIFEST['display']
    # Both relative: the installed app has to start at the path it was installed from. See the note
    # at the top of index.erb.
    assert_equal '.', MANIFEST['start_url']
    assert_equal '.', MANIFEST['scope']
  end

  # A manifest that names an icon it does not have is a manifest a browser silently declines to
  # install from, with nothing in the page to say so.
  def test_every_icon_it_names_is_there_at_the_size_it_claims
    MANIFEST['icons'].each do |icon|
      path = File.expand_path("../public/#{icon['src']}", __dir__)

      assert_path_exists path, "#{icon['src']} is declared and missing"
      next if icon['sizes'] == 'any'

      # Width and height out of the IHDR chunk, which is always the first one and always at byte 16.
      assert_equal icon['sizes'], File.binread(path, 24)[16, 8].unpack('N2').join('x'),
                   "#{icon['src']} is not its size"
    end
  end

  # Android wants a maskable icon or it puts the square one on a white circle.
  def test_android_gets_an_icon_it_can_mask
    assert(MANIFEST['icons'].any? { |icon| icon['purpose'] == 'maskable' })
  end
end

# And that the page points at both of them — relatively, which is the part that would break in
# production and nowhere else.
class ManifestLinkTest < CapybaraTestBase
  def test_the_page_links_the_manifest_and_the_touch_icon
    # The attribute, not the resolved property: relative is the whole point. Under a Funnel sub-path
    # a rooted href asks the domain root for a manifest that is not there.
    assert_equal 'manifest.webmanifest', link_href('link[rel=manifest]')
    # iOS reads none of the manifest and wants its own link instead.
    assert_equal 'icons/apple-touch-icon.png', link_href('link[rel="apple-touch-icon"]')
  end

  private

  def link_href(selector)
    page.evaluate_script("document.querySelector(#{selector.to_json}).getAttribute('href')")
  end
end

# The relative paths the worker is given, as the browser will ask for them.
def request_paths
  App::PRECACHE.map { |path| path == './' ? '/' : "/#{path}" }
end

# The precache list, which is the whole of the freshness argument: a version is installed whole or
# not at all, so a document is always built from one build. That is only true if the list is
# complete, and a list maintained by hand is complete right up until someone adds a module.
class PrecacheTest < CapybaraTestBase
  def test_it_holds_everything_the_app_loads
    # Whatever the browser actually fetched to render the page, from this origin, plus the document
    # itself — which resource timing does not report.
    loaded = page.evaluate_script(<<~JS)
      [location.pathname].concat(
        performance.getEntriesByType('resource')
          .map(entry => entry.name)
          .filter(name => name.startsWith(location.origin))
          .map(name => new URL(name).pathname)
      )
    JS
    refute_empty loaded
    (loaded.uniq - request_paths).each do |missing|
      flunk "#{missing} is loaded by the app and would not be in the cache after a deploy"
    end
  end
end

# And that the version is a fact about the files rather than a number someone has to remember to
# bump. No browser needed: this is arithmetic over the contents of a directory.
class AppVersionTest < Minitest::Test
  def test_the_same_files_are_the_same_version
    assert_equal App.app_version, App.app_version
  end

  def test_changing_a_byte_of_any_of_them_is_a_new_version
    Dir.mktmpdir do |dir|
      asset = File.join(dir, 'main.css')
      File.write(asset, 'a {}')
      before = App.app_version([asset])
      File.write(asset, 'a { color: red }')

      refute_equal before, App.app_version([asset])
    end
  end

  # Renaming a file changes the app even when no file's contents changed, so the path is part of
  # what is hashed.
  def test_moving_a_file_is_a_new_version_too
    Dir.mktmpdir do |dir|
      File.write(File.join(dir, 'a.js'), 'x')
      before = App.app_version([File.join(dir, 'a.js')])
      File.rename(File.join(dir, 'a.js'), File.join(dir, 'b.js'))

      refute_equal before, App.app_version([File.join(dir, 'b.js')])
    end
  end

  # The templates are not assets and are never precached — they are rendered into the page — but a
  # change to one of them is as much a new build as a change to a module, and a browser holding the
  # old page against the new modules is the failure this whole design is about.
  def test_the_templates_and_the_code_that_renders_them_count
    versioned = App.app_version_inputs.map { |path| File.basename(path) }

    assert_includes versioned, 'index.erb'
    assert_includes versioned, 'workout_display.erb'
    assert_includes versioned, 'app.rb'
    # The worker's own body among them: it is a template, which is how it gets there for free and
    # how it stays unreachable as a static file.
    assert_includes versioned, 'service_worker.js.erb'
  end
end

# The worker itself, in a browser, doing what it is for.
#
# It is registered only for these tests — the app skips registration under the test cookie unless
# localStorage asks — because a worker outlives the page that registered it and a lane's browser
# outlives the test, so one left behind would answer for every test that ran after it.
class ServiceWorkerTest < CapybaraTestBase
  def setup
    # The flag is read as the module graph loads, so it is written from a blank page on the same
    # origin rather than by loading the app once to throw it away.
    claim_lane
    visit '/__blank'
    page.execute_script("localStorage.setItem('serviceWorker', 'on')")
    super
    wait_until(20) { page.evaluate_script('!!navigator.serviceWorker.controller') }
  end

  def teardown
    network(offline: false)
    visit '/'
    await_script(<<~JS)
      return navigator.serviceWorker.getRegistrations()
        .then(regs => Promise.all(regs.map(reg => reg.unregister())))
        .then(() => caches.keys())
        .then(names => Promise.all(names.map(name => caches.delete(name))))
    JS
    super
  end

  def cached_paths
    await_script(<<~JS, App::VERSION)
      return caches.open('web-erg-' + args[0])
        .then(cache => cache.keys())
        .then(keys => keys.map(request => new URL(request.url).pathname))
    JS
  end

  # The install is `cache.addAll` over the whole list, which is one promise: a version that could
  # not be fetched whole never opens its cache at all. So "everything is there" is not a hope, and
  # this is the assertion that says the list the worker was given is the list app.rb computed.
  def test_the_whole_of_the_app_is_in_one_cache
    assert_equal request_paths.sort, cached_paths.sort
  end

  # The point of the exercise. The network goes, the page is reloaded, and the app is still an app:
  # a workout is chosen, started and ridden, so the library, the .zwo and every module behind them
  # came out of the cache. Registration and the wait for a controller cost more than everything
  # asserted here, which is why the ride is not a second test after a plainer one.
  def test_a_workout_can_still_be_ridden_with_no_network
    network(offline: true)

    visit '/'

    assert_selector 'form', visible: true
    # Not merely that the browser kept the page: the modules linked and Alpine is running the
    # component, which is exactly what a half-cached app fails to do.
    assert_equal 150, app_state('ftp')

    ride_until_samples_exist

    assert_selector '[x-ref="workoutSvg"]', visible: true
    assert_operator app_state('workoutSamples.length'), :>, 0
  end

  # The control for the two tests above: with the network really gone, something the cache has never
  # held has to fail. If this ever passes, offline is not offline and they proved nothing.
  def test_offline_really_is_offline
    network(offline: true)

    reachable = await_script(<<~JS)
      return fetch('never-fetched-before.txt').then(() => true, () => false)
    JS

    refute reachable, 'the network answered while it was meant to be gone'
  end
end

# What the page does when the worker reports that the app moved on underneath it.
class UpdateBannerTest < CapybaraTestBase
  def test_a_deploy_mid_ride_does_not_take_the_ride_with_it
    ride_until_samples_exist
    samples = app_state('workoutSamples.length')
    app_state('onAppUpdated()')

    assert_text 'A new version of the app is ready'
    assert_button 'Reload now'
    # Still the same page, still the same ride: nothing reloaded underneath it.
    assert_operator app_state('workoutSamples.length'), :>=, samples
  end

  def test_a_tab_that_is_not_riding_reloads_itself
    page.execute_script('window.beforeTheUpdate = true')
    app_state('onAppUpdated()')

    wait_until { page.evaluate_script('window.beforeTheUpdate') != true }
    assert_selector 'form', visible: true
  end
end
