require 'time'
require_relative 'test_helper'

# Average power, normalised power, average heart rate and time in zone were all already in
# `workoutSamples`. They only ever left the app inside a .tcx file: the rider finished a session and
# was told nothing about it.
class SessionSummaryTest < ModuleTestBase
  MODULES = { summary: '/js/session-summary.js' }.freeze
  START = Time.utc(2026, 8, 31, 10, 0, 0)

  def summarise(samples, ftp = 200)
    in_page_module(MODULES, 'return summary.summariseSession(args[0], args[1])', samples, ftp)
  end

  # A ride as the app records it: `time` is an ISO string and the values are whatever the device
  # last said, '-' included.
  def samples(readings, step: 2)
    readings.each_with_index.map do |reading, index|
      at = reading[:after] || (index * step)
      { 'time' => (START + at).iso8601 }.merge(reading.except(:after).transform_keys(&:to_s))
    end
  end

  def watts(list, step: 2)
    samples(list.map { |power| { power: } }, step:)
  end

  def test_a_reading_counts_for_as_long_as_it_stood
    # Samples are created only once 1.5 s has passed, never one per second. Averaging the samples
    # themselves would count 200 W held for one second as heavily as 100 W held for two.
    result = summarise(watts([100, 200]))

    assert_equal 3, result['seconds']
    assert_equal 133, result['averagePower']
  end

  def test_a_pause_is_not_ridden_at_the_last_wattage_seen
    # Two readings, then a minute of nothing, then two more: the app adds no samples while the ride
    # is paused. The minute must not arrive in the average as sixty seconds at 300 W.
    result = summarise(samples([
                                 { power: 300, after: 0 },
                                 { power: 300, after: 2 },
                                 { power: 100, after: 62 },
                                 { power: 100, after: 64 }
                               ]))

    # 300 W for 2 s and then the 5 s a reading may stand in for, 100 W for 2 s and the last second.
    # Sixty seconds at 300 W would have made the average 290.
    assert_equal 10, result['seconds']
    assert_equal 240, result['averagePower']
  end

  def test_normalised_power_reads_the_cost_of_the_intervals
    # Four minutes alternating 300 W and 100 W by the half-minute. The mean is 200 W; normalised
    # power is higher, which is the entire point of computing it.
    alternating = (0...240).map { |second| (second / 30).even? ? 300 : 100 }
    result = summarise(watts(alternating, step: 1))

    assert_equal 200, result['averagePower']
    assert_operator result['normalisedPower'], :>, result['averagePower']
  end

  def test_normalised_power_is_nothing_under_thirty_seconds
    # Its 30-second rolling window has not closed once. A number taken from a shorter one would not
    # be normalised power.
    assert_nil summarise(watts([200, 200, 200]))['normalisedPower']
  end

  def test_time_in_zone_uses_the_bands_the_graph_is_coloured_by
    # At 200 W of FTP: 100 W is 50 % — recovery — and 160 W is 80 %, tempo.
    zones = summarise(watts([100, 100, 160, 160]))['zones']

    assert_equal(%w[Recovery Tempo], zones.map { |zone| zone['name'] })
    # Two seconds each, plus the second the last reading of each pair stands for.
    assert_equal([4, 3], zones.map { |zone| zone['seconds'] })
    # Literally the graph's colours: one table answers both.
    graph_colors = in_page_module({ zones: '/js/zones.js' },
                                  'return [zones.getZoneColor(0.5), zones.getZoneColor(0.8)]')
    assert_equal(graph_colors, zones.map { |zone| zone['color'] })
  end

  def test_a_device_that_said_nothing_is_left_out
    # '-' is what the cockpit displays for a missing metric, and it reaches the samples unchanged.
    result = summarise(samples([
                                 { power: 200, heartRate: '-' },
                                 { power: 200, heartRate: 140 },
                                 { power: '-', heartRate: 140 }
                               ]))

    assert_equal 200, result['averagePower']
    assert_equal 140, result['averageHeartRate']
  end

  def test_a_ride_with_no_power_has_nothing_to_summarise
    assert_nil summarise([])
    assert_nil summarise(samples([{ heartRate: 140 }, { heartRate: 141 }]))
  end
end

# And the two that ride: what the summary is *for* is the panel at the end of a session, and only a
# real ride proves the numbers reach it and that they belong to the ride that produced them.
class SessionSummaryPanelTest < CapybaraTestBase
  def test_finishing_a_ride_shows_what_it_was
    ride_until_samples_exist(heart_rate: true)
    # The strap reports a second after the trainer does, and the first sample is created before it
    # says anything: stopping on that one alone would leave the heart rate out of the summary. The
    # two clocks are 1 s and 1.5 s apart and neither is aligned to the other, so how long this takes
    # depends on where in the cycle the ride started — up to about four seconds, on a slow runner.
    wait_until(15) { app_state('workoutSamples.some(sample => Number(sample.heartRate) > 0)') }
    page.execute_script("Alpine.$data(document.querySelector('[x-data]')).stopWorkout()")

    within '.session-summary' do
      # Uppercased by the stylesheet, like every label the app puts above a number.
      assert_text 'AVERAGE POWER'
      # The fake trainer holds 150 W, which is also the default FTP: threshold, by the same bands
      # the graph is coloured by.
      assert_text '150 W'
      assert_text '120 bpm'
      assert_text 'Threshold'
    end
  end

  def test_the_summary_belongs_to_the_ride_that_produced_it
    ride_until_samples_exist
    page.execute_script("Alpine.$data(document.querySelector('[x-data]')).stopWorkout()")
    assert_selector '.session-summary'

    attach_file('workoutFile', File.expand_path('The_Famous_40_20_s.zwo', __dir__), visible: false)
    assert_no_selector '.session-summary', visible: true
  end
end
