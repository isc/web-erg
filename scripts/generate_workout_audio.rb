#!/usr/bin/env ruby

require 'nokogiri'
require 'net/http'
require 'json'
require 'base64'
require 'fileutils'

class WorkoutAudioGenerator
  INWORLD_API_URL = 'https://api.inworld.ai/tts/v1/voice'.freeze
  VOICE_ID = 'Shaun'.freeze
  MODEL_ID = 'inworld-tts-1'.freeze

  def initialize(workout_file_path)
    @workout_file_path = workout_file_path
    @api_key = ENV.fetch('INWORLD_API_KEY', nil)

    raise 'INWORLD_API_KEY environment variable not set' unless @api_key
    raise "Workout file not found: #{workout_file_path}" unless File.exist?(workout_file_path)
  end

  def generate_audio_files
    puts '🎵 Generating audio files for workout...'

    doc = Nokogiri::XML(File.read(@workout_file_path))

    unique_id = doc.at_xpath('//uniqueId')&.text
    raise 'No uniqueId found in workout file' unless unique_id

    audio_dir = File.join(File.dirname(__FILE__), '..', 'public', 'audio', unique_id)
    FileUtils.mkdir_p(audio_dir)
    puts "📁 Created directory: #{audio_dir}"

    text_messages = extract_text_messages(doc)
    puts "📝 Found #{text_messages.length} text messages"

    text_messages.each_with_index do |message, index|
      filename = format('%03d.mp3', index + 1)
      filepath = File.join(audio_dir, filename)

      puts "🎤 Generating #{filename}: \"#{message[0..50]}#{message.length > 50 ? '...' : ''}\""

      success = generate_single_audio(message, filepath)
      if success
        puts "✅ Generated: #{filename}"
      else
        puts "❌ Failed: #{filename}"
      end

      sleep(0.5) # Add a small delay to be respectful to the API
    end

    puts "🎉 Audio generation complete! Files saved in: #{audio_dir}"
  end

  private

  def extract_text_messages(doc)
    messages = []

    doc.at_xpath('//workout').children.each do |child|
      next unless child.name && %w[Warmup SteadyState Ramp IntervalsT Cooldown FreeRide Freeride RestDay MaxEffort
                                   SolidState cooldown].include?(child.name)

      child.xpath('.//textevent').each do |textevent|
        message = textevent['message']
        next if !message || message.strip.empty?

        messages << message.gsub('&apos;', "'")
      end
    end

    messages
  end

  def generate_single_audio(text, output_path)
    uri = URI(INWORLD_API_URL)

    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = true

    request = Net::HTTP::Post.new(uri)
    request['Authorization'] = "Basic #{@api_key}"
    request['Content-Type'] = 'application/json'

    enhanced_text = enhance_text_with_emotion(text)

    request.body = { text: enhanced_text, voiceId: VOICE_ID, modelId: MODEL_ID }.to_json

    begin
      response = http.request(request)

      if response.code == '200'
        response_data = JSON.parse(response.body)
        audio_content = response_data['audioContent']

        if audio_content
          File.binwrite(output_path, Base64.decode64(audio_content))
          true
        else
          puts '❌ No audio content in response'
          false
        end
      else
        puts "❌ API request failed: #{response.code} - #{response.body}"
        false
      end
    rescue StandardError => e
      puts "❌ Error generating audio: #{e.message}"
      false
    end
  end

  def enhance_text_with_emotion(text)
    # Add emotion tags based on content for more natural coaching voice
    case text
    when /GO GO GO|PUSH|CRUSH|DIG/i
      "[excited] #{text}"
    when /nice work|great|excellent|superb|awesome/i
      "[pleased] #{text}"
    when /welcome|hello/i
      "[friendly] #{text}"
    when /final|last/i
      "[determined] #{text}"
    when /rest|easy|relax|recovery/i
      "[calm] #{text}"
    else
      text
    end
  end
end

if __FILE__ == $0
  if ARGV.length != 1
    puts 'Usage: ruby generate_workout_audio.rb <workout_file.zwo>'
    puts 'Example: ruby generate_workout_audio.rb 7_Vo2_Development.zwo'
    exit 1
  end

  workout_file = ARGV[0]

  begin
    generator = WorkoutAudioGenerator.new(workout_file)
    generator.generate_audio_files
  rescue StandardError => e
    puts "❌ Error: #{e.message}"
    exit 1
  end
end
