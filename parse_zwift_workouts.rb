#!/usr/bin/env ruby
# Script to parse Zwift workout files and create a JSON tree structure
# Usage: ruby parse_zwift_workouts.rb [output_file]

require 'nokogiri'
require 'json'
require 'find'

class ZwiftWorkoutParser
  attr_reader :errors

  def initialize(root_path)
    @root_path = root_path
    @workout_tree = {}
    @errors = []
  end

  def parse_workouts
    puts "Scanning directory: #{@root_path}"

    Find.find(@root_path) do |path|
      if File.directory?(path)
        next
      elsif %w[.zwo .xml].include?(File.extname(path))
        relative_path = path[@root_path.length..].sub(%r{^/}, '')
        workout = parse_zwo_file(path)
        add_workout_to_tree(relative_path, workout) if workout
      end
    end
    puts "Parsing complete with #{@errors.length} errors" if @errors.any?
    @workout_tree
  end

  def to_json_string
    JSON.pretty_generate(@workout_tree)
  end

  private

  def add_workout_to_tree(relative_path, workout_data)
    parts = relative_path.split('/')
    filename = parts.pop

    current_node = @workout_tree
    parts.each do |part|
      pretty_name = part.gsub('_', ' ')
      current_node[pretty_name] ||= {}
      current_node = current_node[pretty_name]
    end
    workout_data[:url] = relative_path
    current_node[filename] = workout_data
  end

  def parse_zwo_file(filepath)
    doc = Nokogiri.XML(File.read(filepath))
    name = text_content(doc, 'name')
    duration = calculate_duration(doc)
    return nil if duration.zero?

    {
      name: name.empty? ? File.basename(filepath, '.*') : name,
      description: text_content(doc, 'description'),
      author: text_content(doc, 'author'),
      duration: calculate_duration(doc)
    }
  rescue StandardError => e
    @errors << "#{filepath}: #{e.message}"
    invalid_workout_data(filepath)
  end

  def invalid_workout_data(filepath)
    {
      name: File.basename(filepath, '.*'),
      description: 'Could not parse workout',
      author: '',
      duration: 0,
      url: ''
    }
  end

  def text_content(doc, tag_name)
    node = doc.at_css(tag_name)
    node ? node.text.strip : ''
  end

  def formatted_duration(total_duration)
    total_duration_minutes = total_duration / 60.0

    if (total_duration_minutes % 1).zero?
      total_duration_minutes.to_i
    else
      total_duration_minutes.round(2)
    end
  end

  def calculate_duration(doc)
    total_duration =
      doc.css('workout > *').sum do |node|
        if node.name == 'IntervalsT'
          repeat = node['Repeat'].to_i
          repeat = 1 if repeat.zero?
          repeat * (node['OnDuration'].to_f + node['OffDuration'].to_f)
        else
          node['Duration'].to_f
        end
      end
    formatted_duration(total_duration)
  end
end

def count_workouts_recursive(node)
  count = 0
  node.each_value do |value|
    next unless value.is_a?(Hash)

    count +=
      if value.key?(:name) && value.key?(:duration)
        1
      else
        count_workouts_recursive(value)
      end
  end
  count
end

def print_summary(workout_tree)
  puts "\n=== WORKOUT SUMMARY ==="
  puts "Total collections: #{workout_tree.keys.count}\n"

  total_workouts = 0

  workout_tree.each do |collection, workouts|
    next unless workouts.is_a?(Hash)

    workout_count = count_workouts_recursive(workouts)
    total_workouts += workout_count
    puts "#{collection}: #{workout_count} workouts"
  end

  puts "\nTOTAL: #{total_workouts} workouts"
end

if __FILE__ == $PROGRAM_NAME
  workout_folder =
    '/Users/ivanschneider/Code/weberg/zwift_workouts_all_collections_ordered_Mar21'
  output_file =
    ARGV[0] || '/Users/ivanschneider/Code/weberg/zwift_workouts.json'

  unless Dir.exist?(workout_folder)
    puts "Error: Workout folder not found at #{workout_folder}"
    exit 1
  end

  parser = ZwiftWorkoutParser.new(workout_folder)
  workout_tree = parser.parse_workouts

  File.write(output_file, parser.to_json_string)
  puts "Workout tree saved to #{output_file}"

  if parser.errors.any?
    puts "\nErrors encountered:"
    parser.errors.each { |error| puts "  - #{error}" }
  end

  print_summary(workout_tree)
end
