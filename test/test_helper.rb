require "capybara"
require "capybara/dsl"
require "capybara/minitest"
require "minitest/autorun"
require "rack"
require "capybara/cuprite"

Capybara.app =
  Rack::Builder.new do
    use Rack::Static,
        urls: [""],
        root: File.expand_path("..", __dir__),
        index: "index.html"
    run ->(_env) { [404, { "Content-Type" => "text/plain" }, ["Not Found"]] }
  end

Capybara.register_driver(:cuprite) do |app|
  Capybara::Cuprite::Driver.new(app, headless: false)
end
Capybara.default_driver = :cuprite
Capybara.enable_aria_label = true

class CapybaraTestBase < Minitest::Test
  include Capybara::DSL
  include Capybara::Minitest::Assertions

  def setup
    page.driver.set_cookie("test-env", "true")
    visit "/"
  end
end
