require_relative 'test_helper'

# Rowing is trained in distance — 4×1000, 8×500, a 2 km test — and .zwo has only Duration. That is
# not a gap in the Zwift library but a gap in the format: no subset of it contains those sessions
# because they cannot be written in it. A Distance attribute is the extension, and what ends such a
# phase is the metres the erg counted, never a clock.
class DistancePhasesTest < CapybaraTestBase
  MODULES = {
    phases: '/js/phases.js',
    workout: '/js/workout.js',
    utils: '/js/utils.js'
  }.freeze

  def expand(xml, ftp = 200)
    in_page_module(
      MODULES,
      'return phases.expandPhases(workout.parseZwoPhases(utils.parseXmlDoc(args[0])), args[1])',
      xml,
      ftp
    )
  end

  def test_a_phase_can_be_written_in_metres
    expanded = expand(<<~XML)
      <workout_file><workout>
        <SteadyState Distance="1000" Power="0.75"/>
      </workout></workout_file>
    XML

    assert_equal 1000, expanded[0]['distance']
  end

  # 0.75 × 200 W is 150 W, which is 2:12.5 per 500 m, so 1000 m is about 265 s. Nothing about the
  # ride depends on that number — it sizes the bar on the graph and the session total, and the
  # phase itself ends on metres.
  def test_a_distance_phase_is_given_an_estimated_duration
    expanded = expand(<<~XML)
      <workout_file><workout>
        <SteadyState Distance="1000" Power="0.75"/>
      </workout></workout_file>
    XML

    assert_in_delta 265, expanded[0]['duration'], 2
  end

  def test_the_estimate_follows_the_rider_s_own_ftp
    xml = <<~XML
      <workout_file><workout>
        <SteadyState Distance="1000" Power="0.75"/>
      </workout></workout_file>
    XML

    assert_operator expand(xml, 300)[0]['duration'], :<, expand(xml, 150)[0]['duration']
  end

  def test_intervals_repeat_in_metres_too
    expanded = expand(<<~XML)
      <workout_file><workout>
        <IntervalsT Repeat="4" OnDistance="500" OffDistance="200" OnPower="0.9" OffPower="0.5"/>
      </workout></workout_file>
    XML

    distances = expanded.map { |phase| phase['distance'] }

    assert_equal 8, expanded.length
    assert_equal [500, 200, 500, 200, 500, 200, 500, 200], distances
  end

  def test_a_workout_written_in_time_gains_no_distance
    expanded = expand(<<~XML)
      <workout_file><workout>
        <SteadyState Duration="60" Power="0.6"/>
      </workout></workout_file>
    XML

    assert_nil expanded[0]['distance']
    assert_equal 60, expanded[0]['duration']
  end

  # The whole point of the extension: the erg's count moves the workout on, and a rower who stops
  # halfway through a 500 has not finished it however long they sit there. The capture is a 100 m
  # piece, so the fixture is two thirty-metre pieces and a paddle.
  def test_the_erg_s_count_and_not_the_clock_is_what_ends_the_phase
    row(fixture: 'Rowing_Distance.zwo')

    wait_until(20) { app_state('phase?.number').to_i >= 2 }

    assert_operator app_state('distance').to_f, :>=, 30
    # The estimated duration of a 30 m phase at 0.8 × 200 W is about seven seconds. Reaching the
    # second phase says the metres moved it on, but not that the clock did not — this does: the
    # third phase is the first one measured in time, and it has not been reached.
    assert_operator app_state('phase?.number').to_i, :<=, 3
  end

  def test_both_pieces_are_rowed_before_the_workout_reaches_the_paddle
    row(fixture: 'Rowing_Distance.zwo')

    wait_until(20) { app_state('phase?.number').to_i == 3 }

    assert_operator app_state('distance').to_f, :>=, 60
  end

  # The countdown formatting, given a phase written in metres. Driven directly rather than rowed to:
  # the assertion is about what the hero says, and the runner has its own tests above.
  def test_the_countdown_is_in_metres_while_the_phase_is
    page.driver.resize(*PHONE)
    row(fixture: 'Rowing_Distance.zwo')
    set_app_state(phase: { distance: 500, label: 'Steady' }, phaseMetresRemaining: 320)

    assert_equal '320', app_state('phaseCountdown')
    assert_equal 'metres to go', app_state('phaseCountdownUnit')
    assert_selector '.cockpit-countdown', text: '320'
  end

  def test_a_phase_written_in_time_still_counts_down_in_seconds
    row(fixture: 'Rowing_Distance.zwo')
    set_app_state(phase: { duration: 60, label: 'Steady' }, phaseSecondsRemaining: 45)

    assert_equal '45', app_state('phaseCountdown')
    assert_equal 'seconds', app_state('phaseCountdownUnit')
  end
end
