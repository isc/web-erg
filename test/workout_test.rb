# frozen_string_literal: true

require 'capybara'
require 'capybara/dsl'
require 'capybara/minitest'
require 'minitest/autorun'
require 'rack'
require 'capybara/cuprite'

Capybara.app =
  Rack::Builder.new do
    use Rack::Static,
        urls: [''],
        root: File.expand_path('..', __dir__),
        index: 'index.html'
    run ->(_env) { [404, { 'Content-Type' => 'text/plain' }, ['Not Found']] }
  end

Capybara.register_driver(:cuprite) do |app|
  Capybara::Cuprite::Driver.new(app, headless: false)
end
Capybara.default_driver = :cuprite

class WorkoutTest < Minitest::Test
  include Capybara::DSL
  include Capybara::Minitest::Assertions

  def setup
    page.driver.set_cookie('test-env', 'true')
    visit '/'
  end

  def test_workout_full_flow
    click_on 'Connecter', match: :first
    find('#connectHrm').click
    attach_file('zwoInput', File.expand_path('The_Famous_40_20_s.zwo', __dir__))
    click_on 'Démarrer'
    assert_selector '[x-ref="workoutSvg"]', visible: true
  end

  def test_ftp_and_weight_local_storage
    fill_in 'FTP (watts)', with: '200'
    fill_in 'Poids (kg)', with: '75'
    click_on 'Connecter', match: :first
    find('#connectHrm').click
    attach_file('zwoInput', File.expand_path('The_Famous_40_20_s.zwo', __dir__))
    click_on 'Démarrer'
    visit '/'
    assert_field 'FTP (watts)', with: '200'
    assert_field 'Poids (kg)', with: '75'
  end
end
