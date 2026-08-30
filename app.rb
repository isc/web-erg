require 'sinatra'

class App < Sinatra::Base
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
end
