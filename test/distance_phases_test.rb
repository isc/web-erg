require_relative 'test_helper'

# Rowing is trained in distance — 4×1000, 8×500, a 2 km test — and .zwo has only Duration. That is
# not a gap in the Zwift library but a gap in the format: no subset of it contains those sessions
# because they cannot be written in it. A Distance attribute is the extension, and what ends such a
# phase is the metres the erg counted, never a clock.
class DistancePhasesTest < ModuleTestBase
  include PhaseExpansion

  KILOMETRE = '<SteadyState Distance="1000" Power="0.75"/>'.freeze

  # 0.75 × 200 W is 150 W, which is 2:12.5 per 500 m, so 1000 m is about 265 s. Nothing about the
  # ride depends on that estimate — it sizes the bar on the graph and the session total, and the
  # phase itself ends on metres.
  def test_a_phase_can_be_written_in_metres_and_given_an_estimated_duration
    expanded = expand(zwo(KILOMETRE), 200)

    assert_equal 1000, expanded[0]['distance']
    assert_in_delta 265, expanded[0]['duration'], 2
  end

  def test_the_estimate_follows_the_rider_s_own_ftp
    assert_operator expand(zwo(KILOMETRE), 300)[0]['duration'],
                    :<, expand(zwo(KILOMETRE), 150)[0]['duration']
  end

  def test_intervals_repeat_in_metres_too
    expanded = expand(
      zwo('<IntervalsT Repeat="4" OnDistance="500" OffDistance="200" OnPower="0.9" OffPower="0.5"/>')
    )

    distances = expanded.map { |phase| phase['distance'] }

    assert_equal 8, expanded.length
    assert_equal [500, 200, 500, 200, 500, 200, 500, 200], distances
  end

  def test_a_workout_written_in_time_gains_no_distance
    expanded = expand(zwo('<SteadyState Duration="60" Power="0.6"/>'))

    assert_nil expanded[0]['distance']
    assert_equal 60, expanded[0]['duration']
  end
end

# And what the runner does with them. The capture is a 100 m piece, so the fixture is two
# thirty-metre pieces and a paddle.
class DistanceRunnerTest < CapybaraTestBase
  # The whole point of the extension: the erg's count moves the workout on, and a rower who stops
  # halfway through a 500 has not finished it however long they sit there. One rowed session for
  # both halves of that — a replayed capture is the most expensive thing this suite does, and the
  # two questions are asked of the same moment in it.
  def test_the_erg_s_count_and_not_the_clock_is_what_ends_the_phase
    row(fixture: 'Rowing_Distance.zwo')

    wait_until(20) { app_state('phase?.number').to_i >= 2 }

    # The estimated duration of a 30 m phase at 0.8 × 200 W is about seven seconds. Reaching the
    # second phase says the metres moved it on, but not that the clock did not — this does: the
    # third phase is the first one measured in time, and it has not been reached.
    assert_operator app_state('phase?.number').to_i, :<=, 3

    # And the next piece opens at the boundary, not at wherever the rower was when the reading
    # arrived. Frames arrive metres apart, so a piece is always noticed to be over some way past
    # its end — the first reading past thirty metres reports fifty-nine. Rebasing to that reading
    # would throw the overshoot away, so the offset from the start of the workout must stay an
    # exact multiple of the piece length however late the reading was.
    rowed = app_state('workoutRunner.phaseStartDistance') -
            app_state('workoutRunner.startDistance')

    assert_in_delta 0, rowed % 30, 0.001, "phases opened #{rowed} m in, which is not a whole piece"
  end

  # That the hero is wired to the metres, not what metres read like — `RowingTest` has the
  # formatting itself, without a browser. Driven directly rather than rowed to: the assertion is
  # about what the hero says, and the runner has its own tests above. The erg is connected and
  # silent, because a phase written from the test survives only until the runner publishes the real
  # one a second later.
  def test_the_countdown_is_in_metres_while_the_phase_is
    page.driver.resize(*PHONE)
    connect_rower(fixture: 'Rowing_Distance.zwo')
    set_app_state(phase: { distance: 500, label: 'Steady' }, phaseRemaining: 320)

    assert_selector '.cockpit-countdown', text: '320'
    # Uppercased by the stylesheet, like every label in the cockpit.
    assert_selector '.cockpit-unit', text: 'METRES TO GO'
  end

  # A phase written in metres is ended by the machine's count and by nothing else, so on a trainer
  # it would never end at all: the session would sit on its first interval until Stop was pressed.
  def test_a_workout_in_metres_is_refused_on_a_machine_that_counts_none
    ride(fixture: 'Rowing_Distance.zwo')

    assert_text 'This workout is measured in metres.'
    refute app_state('showWorkout')
  end
end
