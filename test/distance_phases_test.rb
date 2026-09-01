require_relative 'test_helper'

# Rowing is trained in distance — 4×1000, 8×500, a 2 km test — and .zwo has only Duration. That is
# not a gap in the Zwift library but a gap in the format: no subset of it contains those sessions
# because they cannot be written in it. A Distance attribute is the extension, and what ends such a
# phase is the metres the erg counted, never a clock.
class DistancePhasesTest < ModuleTestBase
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
end

# And what the runner does with them. The capture is a 100 m piece, so the fixture is two
# thirty-metre pieces and a paddle.
class DistanceRunnerTest < CapybaraTestBase
  # The whole point of the extension: the erg's count moves the workout on, and a rower who stops
  # halfway through a 500 has not finished it however long they sit there.
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
  # the assertion is about what the hero says, and the runner has its own tests above. The erg is
  # connected and silent, because a phase written from the test survives only until the runner
  # publishes the real one a second later.
  def test_the_countdown_is_in_metres_while_the_phase_is
    page.driver.resize(*PHONE)
    connect_rower(fixture: 'Rowing_Distance.zwo')
    set_app_state(phase: { distance: 500, label: 'Steady' }, phaseRemaining: 320)

    assert_equal '320', app_state('phaseCountdown')
    assert_equal 'metres to go', app_state('phaseCountdownUnit')
    assert_selector '.cockpit-countdown', text: '320'
  end

  def test_a_phase_written_in_time_still_counts_down_in_seconds
    connect_rower(fixture: 'Rowing_Distance.zwo')
    set_app_state(phase: { duration: 60, label: 'Steady' }, phaseRemaining: 45)

    assert_equal '45', app_state('phaseCountdown')
    assert_equal 'seconds', app_state('phaseCountdownUnit')
  end

  # The wide layout's own line under the graph used to be seconds and only seconds, so a thousand
  # metre piece read 0:00 from its first second to its last while the bar beside it filled normally.
  def test_the_wide_layout_line_says_metres_too
    connect_rower(fixture: 'Rowing_Distance.zwo')
    set_app_state(phase: { distance: 500, label: 'Steady' }, phaseRemaining: 320)

    assert_equal '320 m', app_state('phaseRemainingLabel')
  end

  # The next piece opens at the boundary, not at wherever the rower was when the reading arrived.
  # Rebasing to the reading throws the overshoot away — about four metres a piece at 1 Hz, which
  # over eight pieces is a whole extra length of the erg.
  def test_a_piece_opens_at_the_boundary_and_not_at_the_reading_that_passed_it
    row(fixture: 'Rowing_Distance.zwo')

    wait_until(20) { app_state('phase?.number').to_i >= 2 }

    # Frames arrive metres apart, so a piece is always noticed to be over some way past its end —
    # the first reading past thirty metres reports fifty-nine. The next piece must still open on
    # the boundary, carrying the overshoot forward, so the offset from the start of the workout
    # stays an exact multiple of the piece length however late the reading was.
    rowed = app_state('workoutRunner.phaseStartDistance') -
            app_state('workoutRunner.startDistance')

    assert_in_delta 0, rowed % 30, 0.001, "phases opened #{rowed} m in, which is not a whole piece"
  end

  # A phase written in metres is ended by the machine's count and by nothing else, so on a trainer
  # it would never end at all: the session would sit on its first interval until Stop was pressed.
  def test_a_workout_in_metres_is_refused_on_a_machine_that_counts_none
    page.execute_script("localStorage.setItem('ergPower', '150')")
    find_field('Ergometer').click
    attach_file('workoutFile', File.expand_path('Rowing_Distance.zwo', __dir__), visible: false)
    click_on 'Start'

    assert_text 'This workout is measured in metres.'
    refute app_state('showWorkout')
  end
end
