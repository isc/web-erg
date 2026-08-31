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

  enable :sessions
  set :views, 'views'
  set :public_folder, 'public'
  set :session_secret, ENV['SESSION_SECRET'] || SecureRandom.hex(64)

  post '/llm_coach' do
    content_type :json

    payload = JSON.parse(request.body.read)
    workout_state = payload['state']
    xml_path = payload['xml_path']

    zwift_root = File.expand_path(File.join(settings.public_folder, 'zwift_workouts_all_collections_ordered_Mar21'))

    xml_abs_path = File.expand_path(File.join(settings.public_folder, xml_path))
    unless xml_abs_path.start_with?(zwift_root) && File.exist?(xml_abs_path)
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
      You are a virtual cycling coach for indoor training.
      The cyclist name is Ivan but do not repeat it each time, only once in a while.
      Here is the structured workout in Zwift ZWO/XML format:
      ===
      #{WORKOUT_XML[xml_abs_path]}
      ===

      Avoid repeating yourself: do not repeat advice or encouragement given in your recent messages (see chat log below).
      You can take some inspiration from the text events tags that might be in the structure workout file.
      Always write "watts" in full, to ensure correct text-to-speech synthesis.
      The cyclist is using a bike that is controlled like an Ergometer, so no need to congratulate on achieving the target power
      because it's almost always going to be at target except if there's a real big deviation which would most likely mean that the cyclist is taking a break.
      The cyclist has a display in front of him, so no need to restate his current power, cadence, or heart rate. Only comment on the evolution or exceptional values.
      At each request, you receive a JSON representing the athlete's live state (current time, heart rate, cadence, power, current phase, etc).
      - Offer encouragement, advice, or corrections when appropriate (especially at phase changes, or if the athlete is far from the target).
      - When the current phase is an intense phase, do not make long sentences but short motivational sentences.
      - You can comment on upcoming phases.
      - Right before an intense phase, it's interesting to advise the cyclist to increase the cadence.
      - You can congratulate the cyclist once he has finished an intense phase.
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
