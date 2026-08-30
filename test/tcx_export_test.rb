require 'rexml/document'
require_relative 'test_helper'

# Samples are created whenever more than 1.5 s has elapsed, never one per second, and the export
# used to assume otherwise — every ride reached Strava short on both duration and distance.
class TcxExportTest < CapybaraTestBase
  SAMPLES = (0..5).map do |i|
    {
      'time' => (Time.utc(2026, 1, 1) + (i * 2)).strftime('%Y-%m-%dT%H:%M:%S.000Z'),
      'power' => 200,
      'cadence' => 90,
      'heartRate' => 140 + i
    }
  end

  def generate(samples, name)
    in_page_module(
      { tcx: '/js/tcx-export.js' },
      'return tcx.generateTcx(args[0], args[1], 70)',
      samples,
      name
    )
  end

  def lap
    doc = REXML::Document.new(generate(SAMPLES, 'Sweet Spot & Threshold'))
    doc.elements['//Lap']
  end

  def test_duration_follows_the_sample_clock_not_the_sample_count
    # Six samples, two seconds apart: ten seconds of riding, not six.
    assert_in_delta 10.0, lap.elements['TotalTimeSeconds'].text.to_f, 0.01
  end

  def test_distance_is_integrated_over_the_real_step
    lap_distance = lap.elements['DistanceMeters'].text.to_f
    last_trackpoint = lap.elements['Track/Trackpoint[last()]/DistanceMeters'].text.to_f

    assert_operator lap_distance, :>, 0, 'the lap used to report a hardcoded zero'
    assert_in_delta lap_distance, last_trackpoint, 0.01
  end

  def test_an_ampersand_in_the_name_still_yields_parsable_xml
    tcx = generate(SAMPLES, 'Sweet Spot & Threshold')

    assert_includes tcx, 'Sweet Spot &amp; Threshold'
    notes = REXML::Document.new(tcx).elements['//Activity/Notes']
    assert_equal 'Sweet Spot & Threshold', notes.text
  end

  def test_lap_carries_the_elements_the_schema_requires
    %w[TotalTimeSeconds DistanceMeters Calories Intensity TriggerMethod].each do |element|
      refute_nil lap.elements[element], "#{element} is required on ActivityLap_t"
    end
    assert_nil lap.elements['Name'], 'ActivityLap_t has no Name element'
  end

  def test_empty_sample_list_produces_nothing
    assert_equal '', generate([], 'Whatever')
  end
end
