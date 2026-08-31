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
    find_field('Bike').click
    find_field('Heart Rate Monitor').click if heart_rate
    fill_in 'FTP (watts)', with: ftp.to_s if ftp
    attach_file('workoutFile', File.expand_path(fixture, __dir__), visible: false)
    click_on 'Start'
  end

  # Capybara's own waiting covers the page; this covers the app's state behind it.
  def wait_until
    Timeout.timeout(Capybara.default_max_wait_time) { sleep 0.2 until yield }
  end

  # Whatever the Alpine component currently holds, as `app.workoutSamples.length` would read it.
  def app_state(expression)
    page.evaluate_script("Alpine.$data(document.querySelector('[x-data]')).#{expression}")
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
