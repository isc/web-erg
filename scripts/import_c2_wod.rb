#!/usr/bin/env ruby
# The Concept2 Workout of the Day archive, turned into workouts this app can run.
#
# No machine-readable rowing workout library exists — ErgZone is a closed ecosystem, ErgData logs
# results and stores no definitions, intervals.icu expects you to author your own. What does exist
# is Concept2's WOD newsletter, addressable by date, in the clear and unauthenticated:
#
#     https://utilities.concept2.com/wod-email/newsletter/YYYY-MM-DD/en/us
#
# It is a newsletter template and not an API, so it can break. This fetches it once, into a
# gitignored cache, and writes .zwo files that are committed; nothing depends on it at run time.
#
# Usage: ruby scripts/import_c2_wod.rb
#
# ## The intensity the archive does not have
#
# No WOD carries a target. "5 × 4 min / 2 min easy" is the whole specification — the rowing
# convention is to hold the hardest sustainable pace, not to chase a percentage. But this app's
# entire feedback loop on a rower is the gap between a target split and the actual one, and with no
# target there is nothing on screen to row against.
#
# So the targets are derived, by a named rule rather than an invented constant. Paul's Law: pace per
# 500 m slows by about five seconds for each doubling of distance. Anchored on a 2 km reference —
# which is what a rowing FTP is anchored on too — it turns a piece's length into a fraction of 2 km
# power, which is exactly what a .zwo Power attribute means. Shorter pieces come out harder, longer
# ones easier, and the rider's own rowing FTP sets the absolute level at run time.
#
# The residual is that the fraction depends slightly on whose 2 km it is: a 1:45 rower and a 2:00
# rower do not scale identically. Over the plausible range that moves a 500 m target by about four
# per cent, which is inside the noise of holding a split by feel.

require 'json'
require 'net/http'
require 'fileutils'
require 'date'
require 'cgi'

ROOT = File.expand_path('..', __dir__)
CACHE = File.join(ROOT, 'tmp', 'wod-cache')
OUTPUT = File.join(ROOT, 'public', 'rowing_workouts')
INDEX = File.join(ROOT, 'public', 'rowing_workouts.json')

HOST = 'utilities.concept2.com'.freeze
# Bisected: 2022-07-01 is a 500 and 2022-09-01 is not. About four dates in five are missing
# altogether — gaps in the archive, not parse failures.
FIRST_DAY = Date.new(2022, 9, 1)

# A 7:28 two-kilometre piece. Only the ratios below depend on it, and they depend on it weakly.
REFERENCE_2K_SPLIT = 112.0
SECONDS_PER_DOUBLING = 5.0
# Light pressure between pieces, which is what the archive says when it says "easy".
REST_POWER = 0.55
# Paul's Law is stated over 500 m to 10 km. A twenty-second sprint is well outside it, so the
# extrapolation is clamped rather than trusted.
MIN_POWER = 0.7
MAX_POWER = 1.8

NUMBER_WORDS = {
  'one' => 1, 'two' => 2, 'three' => 3, 'four' => 4, 'five' => 5, 'six' => 6,
  'seven' => 7, 'eight' => 8, 'nine' => 9, 'ten' => 10, 'eleven' => 11, 'twelve' => 12
}.freeze

# --- Fetching ---------------------------------------------------------------

# Cached to disk, because a re-run should not cost their server fifteen hundred requests again.
class Archive
  def initialize(cache)
    @cache = cache
    FileUtils.mkdir_p(cache)
  end

  def fetch_missing(dates)
    @http = nil
    dates.each do |date|
      next if File.exist?(page_path(date)) || File.exist?(miss_path(date))

      fetch(date)
      sleep 0.05
    end
  end

  # A miss is written too. Four dates in five are simply not in the archive, and re-asking for them
  # on every run would be fifteen hundred requests to learn nothing.
  def fetch(date)
    @http ||= Net::HTTP.start(HOST, 443, use_ssl: true, keep_alive_timeout: 30)
    response = @http.get("/wod-email/newsletter/#{date}/en/us")
    path = response.code == '200' ? page_path(date) : miss_path(date)
    File.write(path, response.code == '200' ? response.body : response.code)
  rescue StandardError => e
    warn "#{date}: #{e}; reconnecting"
    @http = nil
    retry
  end

  # Title, description and the date it ran, for every page in the cache, oldest first.
  def each_workout
    Dir[File.join(@cache, '*.html')].each do |path|
      body = File.read(path, encoding: 'UTF-8', invalid: :replace, undef: :replace)
      # The first h2.sub in the newsletter is the workout's name and the p under it its prose.
      # Everything above is the masthead and everything below is the honorboard link.
      match = body.match(%r{<h2 class="sub">(.*?)</h2>\s*<p>(.*?)</p>}m)
      next unless match

      yield File.basename(path, '.html'), plain(match[1]), plain(match[2])
    end
  end

  private

  def page_path(date) = File.join(@cache, "#{date}.html")
  def miss_path(date) = File.join(@cache, "#{date}.miss")

  def plain(html)
    CGI.unescapeHTML(html.gsub(/<[^>]+>/, ' ')).gsub(/\s+/, ' ').strip
  end
end

# --- Parsing ----------------------------------------------------------------

# One piece of work and the rest that follows it. Rests in this corpus are always time, even when
# the work is distance.
#
# How long a piece is, and how far, are asked by the target, the phase and the index, so the
# conversion between the two lives here once — otherwise the 2 km reference the whole intensity
# model rests on would be spelled out in three places and could drift apart.
Piece = Struct.new(:kind, :amount, :rest, keyword_init: true) do
  def distance? = kind == :distance

  # At the reference pace, for a piece named in time. Only the ratio downstream depends on it.
  def metres = distance? ? amount : (amount / REFERENCE_2K_SPLIT) * 500
  def seconds = distance? ? (amount / 500.0) * REFERENCE_2K_SPLIT : amount
end

class WodParser
  # A quantity, in whichever unit it names. Bare numbers are left to the caller, which knows the
  # unit from the end of the list they came from — "1/3/5/3/1 minutes" says it once, at the end.
  UNIT = /m\b|meters?\b|min\b|mins\b|minutes?\b|s\b|sec\b|secs\b|seconds?\b|cals?\b|calories?\b/
  AMOUNT = /(?:\d+:\d\d|:\d\d|\d+\s*(?:#{UNIT}))/

  def initialize(title, description)
    @title = normalise(title)
    @description = normalise(description)
  end

  # The pieces, or nil if this is not a shape we know how to run.
  def pieces
    text = "#{@title}. #{@description}"
    return nil if text.include?('cal') # No calorie phase exists; see the README of this script.

    repeated_rounds || repeated || listed || sequence || single
  end

  private

  def normalise(text)
    text = text.downcase
    # "(BikeErg: 4000m)" is a note for a different machine and derails every list matcher.
    text = text.gsub(/\((?:bikerg|bike erg|skierg|ski erg)[^)]*\)/, ' ')
    text = text.gsub(/(\d),(\d\d\d)/, '\1\2')
    # "Intervals of 6/3/3/1/1/1 minutes" is the same ladder as "6/3/3/1/1/1 minutes" with a
    # preamble the list matcher would otherwise read as the first item.
    text = text.sub(/\Aintervals of /, '')
    NUMBER_WORDS.each { |word, value| text = text.gsub(/\b#{word}\b/, value.to_s) }
    text.gsub(/\s+/, ' ').strip
  end

  # Each pattern paired with the seconds-or-metres its capture is counted in. Ordered: "1000m"
  # must be read as metres before "1000" is read as a bare number.
  UNITS = [
    [/\A(\d+):(\d\d)\z/, :clock],
    [/\A:(\d\d)\z/, [:time, 1]],
    [/\A(\d+)\s*(?:m|meters?)\z/, [:distance, 1]],
    [/\A(\d+)\s*(?:min|mins|minutes?)\z/, [:time, 60]],
    [/\A(\d+)\s*(?:s|sec|secs|seconds?)\z/, [:time, 1]]
  ].freeze

  # "20 seconds", "2:30", ":45", "1000m" — as a kind and a number. A bare number takes the unit its
  # list ended with: "1/3/5/3/1 minutes" says it once, at the end.
  def amount(text, unit = nil)
    text = text.strip
    UNITS.each do |pattern, meaning|
      match = pattern.match(text)
      next unless match
      return [:time, (match[1].to_i * 60) + match[2].to_i] if meaning == :clock

      kind, scale = meaning
      return [kind, match[1].to_i * scale]
    end
    return [unit, unit == :time ? text.to_i * 60 : text.to_i] if unit && text.match?(/\A\d+\z/)

    nil
  end

  def seconds(text)
    kind, value = amount(text)
    kind == :time ? value : nil
  end

  # The rest between pieces, wherever the sentence chose to put it: "/ 2 min easy", ", 2 minutes
  # rest", "with 2 minutes light", "2 minutes rest between intervals".
  def rest_seconds
    source = "#{@title} #{@description}"
    match = source.match(%r{(?:/|,|with|and)\s*(#{AMOUNT})\s*(?:of\s*)?(?:easy|rest|light|recovery)}) ||
            source.match(/(#{AMOUNT})\s*(?:easy|rest|light|recovery)/)
    match && seconds(match[1])
  end

  # "2 rounds of 16 x 20 seconds work and 10 seconds rest"
  def repeated_rounds
    match = @title.match(%r{(\d+) rounds? of (\d+) ?x ?(#{AMOUNT})\s*(?:work)?\s*(?:and|,|/)\s*(#{AMOUNT})})
    return nil unless match

    kind, value = amount(match[3])
    rest = seconds(match[4])
    return nil unless kind && rest

    round = Array.new(match[2].to_i) { Piece.new(kind:, amount: value, rest:) }
    # Between rounds the description names a longer break; three minutes is what it says.
    Array.new(match[1].to_i) { round }
         .flat_map.with_index { |set, index| index.zero? ? set : [rest_round] + set }
  end

  def rest_round = Piece.new(kind: :time, amount: 180, rest: nil)

  # "8 x 500m, 2 minutes rest", "10 x 1 min / 1 min easy", "12 x 250m / 45 sec easy", "8 x 1000m"
  def repeated
    match = @title.match(/\A(\d+) ?x ?(#{AMOUNT})/) || @description.match(/\A(\d+) ?x ?(#{AMOUNT})/)
    return nil unless match

    kind, value = amount(match[2])
    return nil unless kind

    Array.new(match[1].to_i) { Piece.new(kind:, amount: value, rest: rest_seconds) }
  end

  # A ladder or a pyramid: "1/3/5/3/1 minutes with 2 minutes rest", "2000/1500/1000/500m with three
  # minutes rest", "2 min, 3 min, 4 min, 3 min, 2 min pyramid / 2 min easy", "20 - 40 - 60 Cal".
  def listed
    list, unit = list_and_unit
    return nil unless list && list.length >= 3

    rest = rest_seconds
    pieces = list.map do |item|
      kind, value = amount(item, unit)
      return nil unless kind

      Piece.new(kind:, amount: value, rest:)
    end
    # "equal work and rest" says the rest rather than naming it.
    pieces.each { |piece| piece.rest = piece.amount } if @title.include?('equal work and rest')
    pieces
  end

  def list_and_unit
    body = @title.split(/\s+(?:with|pyramid|-\s|minutes with)/).first
    items = SEPARATORS.map { |separator| split_list(body, separator) }.find(&:itself)
    return nil unless items

    # The unit is stated once, at the end of the list: "1/3/5/3/1 minutes".
    [items, items.last.match?(/m\b|meters?\b/) ? :distance : :time]
  end

  SEPARATORS = %w[/ , -].freeze

  # A list only if every item starts with a number and there are at least three: "5 x 4 min" splits
  # on nothing, and "8 x 500m, 2 minutes rest" would otherwise read as a two-item ladder.
  def split_list(body, separator)
    items = body.split(separator).map(&:strip).reject(&:empty?)
    items if items.length >= 3 && items.all? { |item| item.match?(/\A\d/) }
  end

  # An explicit chain: "2000m/3 minutes rest/1000m/2 minutes rest/500m",
  # "3000m, 3 minutes rest, 10 minutes work".
  def sequence
    parts = @title.split(%r{\s*[/,]\s*}).map(&:strip)
    return nil unless parts.length >= 3

    pieces = []
    parts.each { |part| return nil unless append_part(pieces, part) }
    pieces.empty? ? nil : pieces
  end

  # One item of an explicit chain: either a piece of work, or the rest that closes the piece before
  # it. False if it is neither, which disqualifies the whole reading.
  def append_part(pieces, part)
    if part.match?(/rest|easy|light/)
      rest = seconds(part.sub(/\s*(rest|easy|light).*/, '').strip)
      return false unless rest && pieces.any?

      pieces.last.rest = rest
    else
      kind, value = amount(part.sub(/\s*work.*/, '').strip)
      return false unless kind

      pieces << Piece.new(kind:, amount: value, rest: nil)
    end
    true
  end

  # "5000m time trial", "30 minute time trial", "6000m", "1900m".
  def single
    match = @title.match(/\A(#{AMOUNT})/)
    return nil unless match

    kind, value = amount(match[1])
    kind ? [Piece.new(kind:, amount: value, rest: nil)] : nil
  end
end

# --- Targets ----------------------------------------------------------------

# Paul's Law, as a fraction of 2 km power — which is what a .zwo Power attribute means once the
# rider's rowing FTP is anchored on their 2 km.
def target_power(piece)
  metres = piece.metres
  return REST_POWER if metres <= 0

  split = REFERENCE_2K_SPLIT + (SECONDS_PER_DOUBLING * Math.log2(metres / 2000.0))
  ratio = (REFERENCE_2K_SPLIT / split)**3
  ratio.clamp(MIN_POWER, MAX_POWER).round(2)
end

# --- Writing ----------------------------------------------------------------

def phase(piece)
  length = piece.distance? ? "Distance=\"#{piece.amount}\"" : "Duration=\"#{piece.amount}\""
  work = "    <SteadyState #{length} Power=\"#{target_power(piece)}\"/>"
  return work unless piece.rest&.positive?

  "#{work}\n    <SteadyState Duration=\"#{piece.rest}\" Power=\"#{REST_POWER}\"/>"
end

def zwo(title, description, first_seen, pieces)
  <<~XML
    <workout_file>
      <name>#{CGI.escapeHTML(title)}</name>
      <description>#{CGI.escapeHTML(description)}

    Concept2 Workout of the Day, #{first_seen}. The archive specifies structure and never
    intensity — a WOD says "5 x 4 min / 2 min easy" and leaves the pace to you. The targets here are
    derived by Paul's Law from your rowing FTP: shorter pieces harder, longer ones easier. Warm up
    before you start; the WOD is the piece, and nothing has been added to it.</description>
      <author>Concept2</author>
      <sportType>rowing</sportType>
      <workout>
    #{pieces.map { |piece| phase(piece) }.join("\n")}
      </workout>
    </workout_file>
  XML
end

def slug(title)
  title.downcase.gsub(/[^a-z0-9]+/, '_').gsub(/\A_|_\z/, '')[0, 60]
end

def duration_minutes(pieces)
  (pieces.sum { |piece| piece.seconds + (piece.rest || 0) } / 60.0).round
end

# --- Run --------------------------------------------------------------------

archive = Archive.new(CACHE)
archive.fetch_missing((FIRST_DAY..Date.today).to_a)

FileUtils.rm_rf(OUTPUT)
FileUtils.mkdir_p(OUTPUT)

index = {}
seen = {}
skipped = Hash.new(0)
dates = 0

archive.each_workout do |date, title, description|
  dates += 1
  next if seen.key?(title)

  pieces = WodParser.new(title, description).pieces
  if pieces.nil? || pieces.empty?
    skipped[title] += 1
    next
  end
  seen[title] = true
  name = "#{slug(title)}.zwo"
  File.write(File.join(OUTPUT, name), zwo(title, description, date, pieces))
  index[name] = {
    name: title,
    description:,
    author: 'Concept2',
    duration: duration_minutes(pieces),
    url: name
  }
end

File.write(INDEX, JSON.pretty_generate('Concept2 Workout of the Day' => index))

puts "#{dates} cached days, #{seen.size} distinct workouts written to #{OUTPUT}"
puts "#{skipped.size} shapes skipped:"
skipped.each_key { |title| puts "  - #{title}" }
