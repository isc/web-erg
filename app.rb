require 'fileutils'
require 'json'
require 'sinatra'

class App < Sinatra::Base
  REPORTS_DIR = File.expand_path('probe-reports', __dir__)

  set :views, 'views'
  set :public_folder, 'public'

  # Without this the responses carry only Last-Modified, and the browser picks its own freshness
  # lifetime per file. After a deploy it can then hold a fresh main.js next to a stale bluetooth.js:
  # the ES module graph fails to link, nothing defines workoutApp, and the page renders as a blank
  # screen — black, on a phone in dark mode — with no error the rider can see. `no-cache` still lets
  # the browser keep the bytes, it just has to revalidate, so this costs a 304 and not a download.
  # This server has been here before: see ping-pong-games-nginx.conf.example in isc/home-infra.
  set :static_cache_control, [:no_cache]

  before { cache_control :no_cache }

  get '/' do
    erb :index
  end

  # A one-off instrument for the Concept2 port: everything in ROWING.md about the PM5's Bluetooth
  # layout was written from memory, and this is what replaces it with observed bytes. Local only —
  # Web Bluetooth needs localhost or HTTPS, and the reports are gitignored.
  get '/probe' do
    erb :probe, layout: false
  end

  get '/probe/' do
    redirect to('/probe')
  end

  post '/probe/report' do
    content_type :json
    payload = request.body.read
    halt 413, { error: 'report too large' }.to_json if payload.bytesize > 2_000_000
    FileUtils.mkdir_p(REPORTS_DIR)
    path = File.join(REPORTS_DIR, "pm5-#{Time.now.strftime('%Y%m%d-%H%M%S')}.json")
    File.write(path, payload)
    { path: path }.to_json
  end
end
