require 'rexml/document'
require_relative 'test_helper'

# A rower measures its distance; a trainer has it modelled from watts. That difference reaches the
# exported file, and so does the sport — the TCX schema has only Running, Biking and Other, so a
# rowing session goes out as Other and gets corrected in Strava after import.
class RowingExportTest < CapybaraTestBase
  MODULES = { tcx: '/js/tcx-export.js', summary: '/js/session-summary.js' }.freeze
  START = Time.utc(2026, 8, 31, 22, 48, 0)

  # As the app records them: a sample every two seconds, distance in metres straight off the PM5.
  # A 100 m piece in 33.4 s at 75 W, which is the piece the probe actually captured.
  ROWED = (0..5).map do |i|
    {
      'time' => (START + (i * 2)).strftime('%Y-%m-%dT%H:%M:%S.000Z'),
      'power' => 75,
      'cadence' => 23,
      'distance' => i * 6.0
    }
  end

  # The same session on a trainer: no distance to be had, so the export models one from watts.
  RIDDEN = ROWED.map { |sample| sample.except('distance') }

  def generate(samples, sport = nil)
    in_page_module(MODULES, 'return tcx.generateTcx(args[0], "100m", 70, args[1] || undefined)',
                   samples, sport)
  end

  def sport_of(samples, sport = nil)
    REXML::Document.new(generate(samples, sport)).elements['//Activity'].attributes['Sport']
  end

  def summarise(samples)
    in_page_module(MODULES, 'return summary.summariseSession(args[0], 200)', samples)
  end

  def lap(samples, sport = 'Other')
    REXML::Document.new(generate(samples, sport)).elements['//Lap']
  end

  def laps(samples, sport = 'Other')
    REXML::Document.new(generate(samples, sport)).elements.to_a('//Lap')
  end

  # A session's phases are the only structure it has, and one lap for the whole thing threw all of
  # it away: an 8 x 500 m reached Strava as a single undifferentiated block.
  def test_each_phase_becomes_its_own_lap
    phased = ROWED.each_with_index.map do |sample, i|
      sample.merge('phaseIndex' => i < 3 ? 0 : 1,
                   'phaseLabel' => i < 3 ? 'Work' : 'Rest')
    end

    assert_equal 2, laps(phased).length
    assert_equal(%w[Work Rest], laps(phased).map { |l| l.elements['Notes']&.text })
  end

  # A lap's DistanceMeters is its own, while a trackpoint's is measured from the start of the
  # activity. Summing the laps must therefore give the session, not double it.
  def test_lap_distances_are_the_laps_own_and_add_up_to_the_session
    phased = ROWED.each_with_index.map { |sample, i| sample.merge('phaseIndex' => i < 3 ? 0 : 1) }
    metres = laps(phased).map { |l| l.elements['DistanceMeters'].text.to_f }

    assert_equal ROWED.last['distance'], metres.sum
    assert(metres.all?(&:positive?))
  end

  # Sessions recorded before phases were stamped carry no phaseIndex at all. They must still export,
  # as the single lap they always were.
  def test_samples_without_a_phase_still_make_one_lap
    assert_equal 1, laps(ROWED).length
  end

  # Work is work however the distance was arrived at, so the same wattage over the same seconds must
  # cost the same calories on either machine.
  def test_calories_do_not_depend_on_how_the_distance_was_found
    assert_equal lap(RIDDEN, nil).elements['Calories'].text,
                 lap(ROWED).elements['Calories'].text
  end

  def test_a_rowing_session_is_exported_as_other
    assert_equal 'Other', sport_of(ROWED, 'Other')
  end

  def test_a_ride_still_goes_out_as_biking_by_default
    assert_equal 'Biking', sport_of(RIDDEN)
  end

  # The whole aero model goes on a rower. 30 m rowed is 30 m exported, not the 65 m a bicycle would
  # have freewheeled at the same 75 W — twice the distance for the same work, which is the gap
  # between a machine that measures and a model that guesses.
  def test_distance_is_the_erg_s_count_and_not_the_bicycle_model
    assert_in_delta 30.0, lap(ROWED).elements['DistanceMeters'].text.to_f, 0.01
    assert_in_delta 64.6, lap(RIDDEN, nil).elements['DistanceMeters'].text.to_f, 0.5
  end

  # Speed is then a consequence of the distance rather than a second guess at it: 6 m every 2 s.
  def test_speed_follows_the_measured_distance
    speed = lap(ROWED).elements['Track/Trackpoint[last()]/Extensions/ns3:TPX/ns3:Speed'].text.to_f

    assert_in_delta 3.0, speed, 0.01
  end

  def test_a_distance_a_sample_never_carried_does_not_reset_the_total
    # The distance stream is one of four writing into a sample, and the others can open one before
    # it arrives. A gap must hold the total, not zero it.
    gapped = ROWED.each_with_index.map { |s, i| i == 3 ? s.except('distance') : s }

    assert_in_delta 30.0, lap(gapped).elements['DistanceMeters'].text.to_f, 0.01
  end

  def test_the_summary_reports_the_metres_the_machine_counted
    assert_in_delta 30.0, summarise(ROWED)['distance'], 0.01
  end

  def test_a_ride_summary_has_no_distance_to_report
    assert_nil summarise(RIDDEN)['distance']
  end
end
