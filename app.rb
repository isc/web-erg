require 'digest'
require 'rack/deflater'
require 'fileutils'
require 'json'
require 'sinatra'
require 'openai'
require 'pathname'
require 'base64'
require 'securerandom'
require 'net/http'
require 'dotenv'
Dotenv.load

class App < Sinatra::Base
  REPORTS_DIR = File.expand_path('probe-reports', __dir__)

  # The whole ZWO goes into the coach's system prompt, and the coach is asked for advice every few
  # seconds for the length of a ride — a few hundred times, for a file that is bundled and never
  # changes. Read each one once.
  WORKOUT_XML = Hash.new { |cache, path| cache[path] = File.read(path) }

  # The directories a workout may be loaded from, and the words the coach uses for each. Anything
  # outside them is refused: the path arrives from the browser and names a file to read.
  #
  # A rowing coach is not a cycling coach with the nouns swapped, and one line in particular has to
  # go: a Concept2 holds no target, so "you will almost always be at target" is exactly wrong. On a
  # rower the deviation is the whole of the feedback, and worth talking about.
  DISCIPLINES = {
    'zwift_workouts_all_collections_ordered_Mar21' => {
      athlete: 'cyclist', sport: 'cycling', rate: 'cadence',
      machine: 'The cyclist is using a bike that is controlled like an Ergometer, so no need to ' \
               'congratulate on achieving the target power because it is almost always going to ' \
               'be at target except if there is a real big deviation which would most likely ' \
               'mean that the cyclist is taking a break.'
    },
    'rowing_workouts' => {
      athlete: 'rower', sport: 'rowing', rate: 'stroke rate',
      machine: 'The rower is on a Concept2, which has no ERG mode and holds no target: the pace ' \
               'is entirely the athlete to keep. Hitting the target split is an achievement and ' \
               'drifting off it is the thing worth correcting. Speak in splits per 500 metres, ' \
               'which is what the athlete reads, rather than in watts.'
    }
  }.freeze

  PUBLIC_DIR = File.expand_path('public', __dir__)

  # The app, as a set of files.
  #
  # Everything the service worker must hold for the app to run with no network: the page, the
  # stylesheet, every module, the vendored libraries, the icons and the two catalogues. Read off
  # disk rather than listed by hand, because a module added and not listed is exactly the
  # half-cached app the worker exists to prevent, and a list nobody remembers to edit is worse than
  # no list. test/pwa_test.rb checks it against what a browser actually loads.
  #
  # What is deliberately not here: twelve megabytes of .zwo files and eight of recorded coaching.
  # Those are content rather than the app, and the worker keeps whichever of them the rider opened.
  APP_FILE_GLOBS = %w[
    main.css
    js/**/*.js
    vendor/*
    icons/*
    manifest.webmanifest
    rowing_workouts.json
    zwift_workouts.json
  ].freeze

  def self.app_files
    APP_FILE_GLOBS.flat_map { |glob| Dir[File.join(PUBLIC_DIR, glob)] }.select { |p| File.file?(p) }
  end

  # Relative, never rooted at /: see the note in index.erb about the sub-path this is served under.
  def self.precache_paths
    ['./', *app_files.map { |path| path.delete_prefix("#{PUBLIC_DIR}/") }.sort]
  end

  # Every file whose bytes decide what the app is: the assets above, the templates — the worker's
  # own body is one of them — and the code that renders them. Any change to any of them is a
  # different version, and a different version is a different cache, filled whole or not opened.
  def self.app_version_inputs
    app_files + Dir[File.join(__dir__, 'views', '*.erb')] + [File.join(__dir__, 'app.rb')]
  end

  def self.app_version(paths = app_version_inputs)
    paths.sort.inject(Digest::SHA256.new) do |digest, path|
      digest << path.delete_prefix("#{__dir__}/") << "\0" << Digest::SHA256.file(path).hexdigest
    end.hexdigest[0, 16]
  end

  # One snapshot of the disk, taken once, because the container is restarted by deploy.sh and a boot
  # is a deploy. Both halves have to come from the same instant: deploy.sh pulls and then restarts,
  # so a list read per request could pair the version hashed at the last boot with files pulled
  # since — an install that adds new files to the live cache under the old name, which is a cache
  # holding two builds and exactly what none of this is allowed to produce.
  VERSION = app_version.freeze
  PRECACHE = precache_paths.freeze

  enable :sessions
  set :views, 'views'
  set :public_folder, PUBLIC_DIR

  # The extension is not in Rack's table, and a manifest served as octet-stream is a manifest some
  # browsers decline to read.
  mime_type :webmanifest, 'application/manifest+json'

  # 1.3 MB of app, 321 kB of it compressed, and the worker re-downloads the whole set on every
  # deploy — over a home Wi-Fi, to a phone. Only what compresses: an mp3 or a PNG gains nothing and
  # a range request for audio would rather not be re-encoded on the way past.
  use Rack::Deflater, if: lambda { |_env, _status, headers, _body|
    headers['Content-Type'].to_s.match?(%r{\A(text/|image/svg|application/(javascript|json|xml|manifest))})
  }
  set :session_secret, ENV['SESSION_SECRET'] || SecureRandom.hex(64)

  post '/llm_coach' do
    content_type :json

    payload = JSON.parse(request.body.read)
    workout_state = payload['state']
    xml_path = payload['xml_path']

    xml_abs_path = File.expand_path(File.join(settings.public_folder, xml_path))
    discipline = DISCIPLINES.find do |root, _|
      xml_abs_path.start_with?(File.expand_path(File.join(settings.public_folder, root)))
    end&.last
    unless discipline && File.exist?(xml_abs_path)
      status 400
      return { audio_url: nil, text: 'Invalid or missing workout XML path' }.to_json
    end

    session[:llm_history] ||= []
    assistant_history = session[:llm_history].last(3)

    # The previous state as well as the current one: what the numbers are doing is the interesting
    # half, and the coach cannot see a trend in a single sample.
    previous_state = session[:last_state]
    session[:last_state] = workout_state
    user_prompt = if previous_state
                    "Current athlete state:\n#{workout_state.to_json}\n" \
                      "Previous athlete state:\n#{previous_state.to_json}"
                  else
                    workout_state.to_json
                  end

    system_prompt = <<~PROMPT
      You are a virtual #{discipline[:sport]} coach for indoor training.
      The #{discipline[:athlete]} name is Ivan but do not repeat it each time, only once in a while.
      Here is the structured workout in Zwift ZWO/XML format:
      ===
      #{WORKOUT_XML[xml_abs_path]}
      ===

      Avoid repeating yourself: do not repeat advice or encouragement given in your recent messages (see chat log below).
      You can take some inspiration from the text events tags that might be in the structure workout file.
      Always write "watts" in full, to ensure correct text-to-speech synthesis.
      #{discipline[:machine]}
      The #{discipline[:athlete]} has a display in front of him, so no need to restate his current power, #{discipline[:rate]}, or heart rate. Only comment on the evolution or exceptional values.
      At each request, you receive a JSON representing the athlete's live state (current time, heart rate, #{discipline[:rate]}, power, current phase, etc).
      - Offer encouragement, advice, or corrections when appropriate (especially at phase changes, or if the athlete is far from the target).
      - When the current phase is an intense phase, do not make long sentences but short motivational sentences.
      - You can comment on upcoming phases.
      - Right before an intense phase, it's interesting to advise the #{discipline[:athlete]} to raise the #{discipline[:rate]}.
      - You can congratulate the #{discipline[:athlete]} once he has finished an intense phase.
      - Otherwise, if nothing is relevant, reply strictly with "__NO_MESSAGE__".

      Respond ONLY with either a phrase to synthesize or "__NO_MESSAGE__".
    PROMPT

    message_history = [
      { role: 'system', content: system_prompt }
    ]
    assistant_history.each do |msg|
      message_history << { role: 'assistant', content: msg }
    end
    message_history << { role: 'user', content: user_prompt }

    client = OpenAI::Client.new(api_key: ENV.fetch('OPENAI_API_KEY', nil))
    response = client.chat.completions.create(
      model: 'gpt-3.5-turbo',
      messages: message_history
    )
    llm_text = response.choices.first.message.content

    if llm_text == '__NO_MESSAGE__'
      status 200
      return { audio_url: nil, text: nil }.to_json
    end
    session[:llm_history] << llm_text
    session[:llm_history] = session[:llm_history].last(5)

    uri = URI('https://api.inworld.ai/tts/v1/voice')
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = true
    request = Net::HTTP::Post.new(uri)
    request['Authorization'] = ENV.fetch('INWORLD_API_KEY', nil)
    request['Content-Type'] = 'application/json'

    request.body = {
      text: llm_text,
      voiceId: 'Mark',
      modelId: 'inworld-tts-1'
    }.to_json

    response = http.request(request)

    if response.code.to_i == 200
      response_data = JSON.parse(response.body)
      audio_content = response_data['audioContent']
      if audio_content
        audio_dir = File.join(settings.public_folder, 'audio')
        FileUtils.mkdir_p(audio_dir)
        filename = "inworld_#{SecureRandom.hex(8)}.mp3"
        audio_path = File.join(audio_dir, filename)
        File.binwrite(audio_path, Base64.decode64(audio_content))
        audio_url = "/audio/#{filename}"
      end
      { audio_url:, text: llm_text }.to_json
    else
      { audio_url: nil, text: llm_text, response: response.code }.to_json
    end
  end

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

  # The worker. A template rather than a static file, because the two things it cannot know about
  # itself — which version this is, and which files that version consists of — are the whole design.
  # The browser re-fetches this script on every navigation and compares it byte for byte; a deploy
  # that changes any asset changes the digest, which changes these bytes, which is what makes the
  # browser install the new version. `cache_control :no_cache` on it — the before filter below — is
  # what keeps that check honest.
  get '/sw.js' do
    content_type 'text/javascript'
    erb :'service_worker.js', layout: false
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
    { path: }.to_json
  end
end
