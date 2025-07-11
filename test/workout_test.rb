# frozen_string_literal: true

require 'capybara'
require 'capybara/dsl'
require 'test/unit'
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

class WorkoutTest < Test::Unit::TestCase
  include Capybara::DSL

  def test_workout_full_flow
    page.driver.set_cookie('test-env', 'true')
    visit '/'
    click_on 'Connecter', match: :first
    find('#connectHrm').click
    attach_file('zwoInput', File.expand_path('The_Famous_40_20_s.zwo', __dir__))
    click_on 'Démarrer'
    assert page.has_css?('[x-ref="workoutSvg"]', visible: true)
  end
end
