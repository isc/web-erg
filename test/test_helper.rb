require 'etc'

# One browser per lane, one lane per test thread. Almost the whole of this suite is spent waiting on
# a browser, which is time Ruby spends outside the GVL, so lanes buy close to their number back —
# up to the point where the Chromes start competing for cores, which on this hardware is about
# eight. Set through Minitest's own knob rather than beside it, so there is one number and one name
# for it; `MT_CPU=1` still runs the suite in a single browser.
ENV['MT_CPU'] ||= [Etc.nprocessors, 8].min.to_s

require 'capybara'
require 'capybara/dsl'
require 'capybara/minitest'
require 'minitest/autorun'
require 'rack'
require 'capybara/cuprite'
require_relative '../app'

# Every class in this suite runs in parallel — there is no shared state left between tests that a
# lane's own browser does not hold — so it is said once here rather than remembered per class.
Minitest::Test.parallelize_me!
LANES = Minitest.parallel_executor.size

# Every session gets its own driver, its own browser and its own cookie jar, and each of them is
# reached from a different thread. Without this, `Capybara.session_name` is one global and all the
# threads share one browser.
Capybara.threadsafe = true

# A page with nothing on it, for the tests whose subject is a module rather than the app. Loading
# the app for those costs the whole ES module graph, Alpine, the CDN stylesheet and the workout
# library JSON — about six hundred milliseconds each, for a document none of them look at. Wrapped
# around the app here rather than added to it as a route: it is scaffolding for the suite, and the
# app should not carry a page that only the suite ever opens.
BLANK_PAGE = lambda do |_env|
  [200, { 'content-type' => 'text/html; charset=utf-8' },
   ['<!doctype html><html lang="en"><head><title>blank</title></head><body></body></html>']]
end

Capybara.app = Rack::Builder.new do
  map('/__blank') { run BLANK_PAGE }
  run App
end.to_app

# One Puma serves every lane. Four threads was Capybara's default and is one per two browsers once
# the suite runs wide, which turns the server into the queue everything waits in.
Capybara.server = :puma, { Silent: true, Threads: '0:32' }

Capybara.register_driver(:cuprite) do |app|
  # CI runners have no usable Chrome sandbox; asking for one there aborts the browser at launch.
  browser_options = ENV['CI'] ? { 'no-sandbox' => nil } : {}
  Capybara::Cuprite::Driver.new(
    app,
    headless: !ENV['DISABLE_HEADLESS'],
    browser_options:,
    # How long a single CDP round trip may take, and how long a browser may take to come up.
    # Ferrum's defaults are 5 s and 10 s, which are generous for one browser and thin for eight on a
    # machine that is also doing something else: a `click_on` failed twice in twenty runs with
    # "timed out waiting for response", which is the protocol giving up, not the app being wrong.
    # Raising a ceiling nothing reaches when the machine is idle is not the same as retrying.
    timeout: 30,
    process_timeout: 30
  )
end
Capybara.default_driver = :cuprite
Capybara.enable_aria_label = true
# Two seconds is Capybara's default and it was always thin here: the fake devices report at 1 Hz and
# the app opens a new sample only once 1.5 s has passed, so anything waiting on a reading to reach a
# sample is waiting on two clocks that do not line up. On a loaded CI runner that is a coin toss.
Capybara.default_max_wait_time = 5

# Capybara's session pool is a plain Hash filled by a default proc, so a lane arriving first would
# be writing to it while another reads. Every session a run can use is therefore created here, on
# one thread, before any test starts. Creating one costs nothing: the browser behind it is not
# launched until something visits a page, so lanes a short run never reaches never start a Chrome.
# One more than there are threads, because a suite run with a filter that matches one test runs it
# on the main one.
LANE_QUEUE = Thread::Queue.new
(0..LANES).each do |index|
  Capybara.session_name = :"lane-#{index}"
  Capybara.current_session
  LANE_QUEUE << :"lane-#{index}"
end

# Every target Ferrum attached to and did not adopt, per lane, and the lanes whose network has been
# taken away. The first is written from Ferrum's own reader thread as well as from the test's, so
# every lane's entry is created here, on one thread; what happens to it afterwards is one lane's
# own business and one lane is one thread.
OWN_NETWORK = LANE_QUEUE.size.times.to_h { |index| [:"lane-#{index}", []] }.freeze
OFFLINE = Set.new

# A lane's browser, and the state that outlives a page load in it. Included rather than inherited:
# the two bases below differ only in which page they open, and neither is a kind of the other.
module BrowserTest
  def self.included(base)
    base.include Capybara::DSL
    base.include Capybara::Minitest::Assertions
  end

  # `Capybara.session_name` is already a thread variable, so it is the lane: claimed on this
  # thread's first test and still set on its last. Threads are the executor's and there is one lane
  # for each, so the queue can never be empty — `pop(true)` says so out loud rather than hanging the
  # run if that stops being true.
  def claim_lane
    return unless Capybara.session_name == :default

    Capybara.session_name = LANE_QUEUE.pop(true)
    resume_paused_targets
  end

  # Ferrum attaches to every target Chrome opens with `waitForDebuggerOnStart`, and then resumes
  # only the ones it recognises — `page` and `iframe` (ferrum/contexts.rb, ALLOWED_TARGET_TYPES).
  # A service worker is neither, so it starts paused and is never let go: the browser fetches
  # sw.js, creates the worker, and `register()` returns a promise that settles never. Forty seconds
  # of that looks exactly like a bug in the worker, and is not one.
  #
  # Subscribed once per lane, on the lane's own browser, and only for the targets Ferrum walked
  # past — its own handler still runs for pages. What it walked past is kept, because a worker is
  # its own target and CDP emulates network conditions per target: taking the network away from the
  # page leaves the worker with a network of its own. See `network`.
  def resume_paused_targets
    lane = Capybara.session_name
    client = page.driver.browser.client
    client.on('Target.attachedToTarget') do |params|
      next if %w[page iframe].include?(params.dig('targetInfo', 'type'))

      session = client.session(params['sessionId'])
      OWN_NETWORK[lane] << session
      emulate(session, offline: true) if OFFLINE.include?(lane)
      session.command('Runtime.runIfWaitingForDebugger', async: true) if params['waitingForDebugger']
    end
  end

  # The network, given to or taken from the page and every worker behind it — including a worker
  # that starts later, since Chrome stops an idle one and attaches a fresh target when it is needed
  # again. Both halves are the lane's, so a test that ends offline hands the next one a browser that
  # is not.
  def network(offline:)
    lane = Capybara.session_name
    offline ? OFFLINE << lane : OFFLINE.delete(lane)
    page.driver.browser.network.emulate_network_conditions(offline:)
    OWN_NETWORK[lane].delete_if { |session| !emulate(session, offline:) }
  end

  # False for a worker Chrome has already discarded, which is also how the list is pruned: there is
  # nothing left to connect or disconnect.
  def emulate(session, offline:)
    session.command('Network.enable')
    session.command('Network.emulateNetworkConditions', offline:, latency: 0,
                                                        downloadThroughput: 0, uploadThroughput: 0)
    true
  rescue StandardError
    false
  end

  # A promise, awaited in the page. Ferrum passes the callback in as the last argument, and every
  # caller had written the same two-line bridge to it; here the body just returns its promise and
  # sees whatever was passed here as `args[0]`, `args[1]`, … — the same shape as `in_page_module`.
  def await_script(body, *)
    page.evaluate_async_script(<<~JS, *)
      const done = arguments[arguments.length - 1]
      const args = Array.from(arguments).slice(0, -1)
      ;(() => { #{body} })().then(done)
    JS
  end

  # localStorage outlives a test: the browser is reused, and the app keeps FTP, the fake trainer's
  # wattage, an unfinished session and the mock's failure switch there. One test arming any of them
  # would otherwise decide the outcome of the next.
  def teardown
    page.execute_script('localStorage.clear()')
    # A test that shrank the window to a phone would otherwise hand the next one a phone.
    page.driver.resize(1024, 768)
  end
end

# For tests whose subject is a module: `in_page_module` needs a document to import into and an
# origin to import from, and nothing more than that.
class ModuleTestBase < Minitest::Test
  include BrowserTest

  def setup
    claim_lane
    visit '/__blank'
  end

  # Calls into the app's own ES modules from the page under test. `body` is JavaScript whose value
  # is returned; it sees the imported modules under the names given in `modules`, and the arguments
  # passed here as `args[0]`, `args[1]`, ...
  def in_page_module(modules, body, *)
    names = modules.keys.join(', ')
    paths = modules.values.map { |path| "import('#{path}')" }.join(', ')
    evaluate_async_script(<<~JS, *)
      const done = arguments[arguments.length - 1]
      const args = Array.from(arguments).slice(0, -1)
      Promise.all([#{paths}]).then(([#{names}]) => { done((() => { #{body} })()) })
    JS
  end
end

# For tests whose subject is the app: the page, the Alpine component behind it, and a ride or a row
# through it.
class CapybaraTestBase < Minitest::Test
  include BrowserTest

  def setup
    claim_lane
    # The cookie decides whether bluetooth.js swaps in the mock, and it is read as the module graph
    # loads, so it has to be set before the page that loads it.
    page.driver.set_cookie('test-env', 'true')
    visit '/'
  end

  PHONE = [390, 844].freeze

  # The fake trainer reports whatever wattage localStorage names, so seeding it stands in for a
  # rider turning the pedals: the runner only starts once power goes above zero.
  def ride(fixture: 'Mixed_And_Unusual.zwo', ftp: nil, heart_rate: false)
    page.execute_script("localStorage.setItem('ergPower', '150')")
    start_session(fixture, 'FTP (watts)', ftp, heart_rate:)
  end

  # A Concept2 connected, a workout started, and nobody on the erg. The mock holds its capture until
  # `start_rowing`, so this is a machine that is present and saying nothing — which is what a test
  # about what the cockpit *computes* wants, since a reading it writes itself then stays written.
  # Before the capture was held back, `splitDelta` came back once as 234 seconds, the split of eight
  # watts, and passed on the rerun.
  def connect_rower(fixture: 'Rowing_Intervals.zwo', ftp: nil, heart_rate: false)
    page.execute_script("localStorage.setItem('mockErgometer', 'pm5')")
    start_session(fixture, 'Rowing FTP (watts)', ftp, heart_rate:)
  end

  # And then someone starts rowing. The mock replays pm5-capture.js — the frames the real machine
  # sent, at twenty times its own clock — rather than inventing a power packet, so the workout is
  # started by being rowed. Every metre lands after Start, so the session's distance baseline is the
  # erg's own zero.
  def row(...)
    connect_rower(...)
    start_rowing
  end

  def start_rowing
    page.execute_script("window.dispatchEvent(new Event('mock-pm5-go'))")
  end

  # Connect, choose a workout, start. All that differs between the two machines is what the mock
  # was told to be and which of the two FTP fields the form is showing.
  def start_session(fixture, ftp_field, ftp, heart_rate: false)
    find_field('Ergometer').click
    find_field('Heart Rate Monitor').click if heart_rate
    fill_in ftp_field, with: ftp.to_s if ftp
    attach_file('workoutFile', File.expand_path(fixture, __dir__), visible: false)
    click_on 'Start'
  end

  # Capybara's own waiting covers the page; this covers the app's state behind it. The default is
  # Capybara's, and a caller waiting on something slower than a render — a capture replaying, a
  # phase turning over — says how long it is prepared to wait.
  def wait_until(seconds = Capybara.default_max_wait_time)
    Timeout.timeout(seconds) { sleep 0.2 until yield }
  end

  # Whatever the Alpine component currently holds, as `app.workoutSamples.length` would read it.
  def app_state(expression)
    page.evaluate_script("Alpine.$data(document.querySelector('[x-data]')).#{expression}")
  end

  # And the other direction. A test that needs the component to hold a particular reading — one the
  # mock has no way to produce on demand — writes it here rather than spelling out Alpine.$data.
  def set_app_state(**values)
    values.each do |key, value|
      page.execute_script(
        "Alpine.$data(document.querySelector('[x-data]')).#{key} = #{value.to_json}"
      )
    end
  end

  # Pick a workout out of the library dialog by name.
  #
  # The button beside its name, never the first one inside its collection. The list re-renders on
  # every keystroke of the search box, and a `Select` found by position can belong to a different
  # workout by the time it is clicked: asking for "8 x 500m, 2 minutes rest" once started
  # "4 x 1500m / 2 min easy" instead, one run in twenty. A workout's heading and its button are
  # siblings, which is true whatever the filter is doing.
  def select_workout(name)
    find('h6', text: name).sibling('button', text: 'Select').click
  end

  # The runner only starts once power arrives, and the first sample lands a moment after that.
  # Anything asserting on recorded data has to wait for one.
  def ride_until_samples_exist(**)
    ride(**)
    wait_until { app_state('workoutSamples.length').positive? }
  end
end

# Phases, as the runner and the graph get them: a .zwo body expanded into the flat timeline. Two
# suites drive it — the tags it accepts, and the metres extension — and they had a byte-identical
# `MODULES` and expander each.
module PhaseExpansion
  MODULES = {
    phases: '/js/phases.js',
    workout: '/js/workout.js',
    utils: '/js/utils.js'
  }.freeze

  def expand(xml, ftp = nil)
    in_page_module(
      MODULES,
      'return phases.expandPhases(workout.parseZwoPhases(utils.parseXmlDoc(args[0])), ' \
      'args[1] ?? undefined)',
      xml,
      ftp
    )
  end

  # The wrapper every one of these fixtures needs and none of them is about.
  def zwo(body)
    "<workout_file><workout>#{body}</workout></workout_file>"
  end
end
