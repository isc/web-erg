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

  def generate(samples, sport)
    in_page_module(MODULES, 'return tcx.generateTcx(args[0], "100m", 70, args[1])', samples, sport)
  end

  def lap(samples, sport = 'Other')
    REXML::Document.new(generate(samples, sport)).elements['//Lap']
  end

  def test_a_rowing_session_is_exported_as_other
    document = REXML::Document.new(generate(ROWED, 'Other'))

    assert_equal 'Other', document.elements['//Activity'].attributes['Sport']
  end

  def test_a_ride_still_goes_out_as_biking_by_default
    ridden = ROWED.map { |sample| sample.except('distance') }
    document = REXML::Document.new(
      in_page_module(MODULES, 'return tcx.generateTcx(args[0], "ride", 70)', ridden)
    )

    assert_equal 'Biking', document.elements['//Activity'].attributes['Sport']
  end

  # The whole aero model goes on a rower. 30 m rowed is 30 m exported, not the 65 m a bicycle would
  # have freewheeled at the same 75 W — twice the distance for the same work, which is the gap
  # between a machine that measures and a model that guesses.
  def test_distance_is_the_erg_s_count_and_not_the_bicycle_model
    assert_in_delta 30.0, lap(ROWED).elements['DistanceMeters'].text.to_f, 0.01

    ridden = ROWED.map { |sample| sample.except('distance') }
    modelled = REXML::Document.new(
      in_page_module(MODULES, 'return tcx.generateTcx(args[0], "ride", 70)', ridden)
    ).elements['//Lap/DistanceMeters'].text.to_f

    assert_in_delta 64.6, modelled, 0.5
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
    result = in_page_module(MODULES, 'return summary.summariseSession(args[0], 200)', ROWED)

    assert_in_delta 30.0, result['distance'], 0.01
  end

  def test_a_ride_summary_has_no_distance_to_report
    ridden = ROWED.map { |sample| sample.except('distance') }
    result = in_page_module(MODULES, 'return summary.summariseSession(args[0], 200)', ridden)

    assert_nil result['distance']
  end
end
