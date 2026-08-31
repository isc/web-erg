require 'capybara'
require 'capybara/dsl'
require 'capybara/minitest'
require 'minitest/autorun'
require 'rack'
require 'capybara/cuprite'
require_relative '../app'

Capybara.app = App

Capybara.register_driver(:cuprite) do |app|
  options = { headless: !ENV['DISABLE_HEADLESS'] }
  # CI runners have no usable Chrome sandbox; asking for one there aborts the browser at launch.
  options[:browser_options] = { 'no-sandbox' => nil } if ENV['CI']
  Capybara::Cuprite::Driver.new(app, **options)
end
Capybara.default_driver = :cuprite
Capybara.enable_aria_label = true

class CapybaraTestBase < Minitest::Test
  include Capybara::DSL
  include Capybara::Minitest::Assertions

  def setup
    page.driver.set_cookie('test-env', 'true')
    visit '/'
  end

  # localStorage outlives a test: the browser is reused, and the app keeps FTP, the fake trainer's
  # wattage, an unfinished session and the mock's failure switch there. One test arming any of them
  # would otherwise decide the outcome of the next.
  def teardown
    page.execute_script('localStorage.clear()')
    # A test that shrank the window to a phone would otherwise hand the next one a phone.
    page.driver.resize(1024, 768)
  end

  PHONE = [390, 844].freeze

  # The fake trainer reports whatever wattage localStorage names, so seeding it stands in for a
  # rider turning the pedals: the runner only starts once power goes above zero.
  def ride(fixture: 'Mixed_And_Unusual.zwo', ftp: nil, heart_rate: false)
    page.execute_script("localStorage.setItem('ergPower', '150')")
    start_session(fixture, 'FTP (watts)', ftp, heart_rate:)
  end

  # The same, on a Concept2. The mock then replays pm5-capture.js — the frames the real machine
  # sent — instead of inventing a power packet, so the erg starts the workout by being rowed.
  # `speed` compresses the capture's own clock; the default replays a 73-second piece in four.
  def row(fixture: 'Rowing_Intervals.zwo', ftp: nil, heart_rate: false, session: 'fixed-100m',
          speed: nil)
    mock_settings(mockErgometer: 'pm5', mockPm5Session: session, mockPm5Speed: speed)
    start_session(fixture, 'Rowing FTP (watts)', ftp, heart_rate:)
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

  def mock_settings(**settings)
    settings.compact.each do |key, value|
      page.execute_script("localStorage.setItem('#{key}', '#{value}')")
    end
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

  # The runner only starts once power arrives, and the first sample lands a moment after that.
  # Anything asserting on recorded data has to wait for one.
  def ride_until_samples_exist(**)
    ride(**)
    wait_until { app_state('workoutSamples.length').positive? }
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
