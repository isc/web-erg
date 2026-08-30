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

end
