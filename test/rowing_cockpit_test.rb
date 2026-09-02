require_relative 'test_helper'

# The rower is the machine with no ERG mode: nothing the app sends can make the erg hold a target,
# so the cockpit is not a comfort but the entire feedback loop. What it has to get right is that
# split and target split are the same computation applied to two wattages, and that the gap between
# them is legible.
#
# The arithmetic behind that gap is in rowing.js and is tested there, in `SplitDeviationTest`. What
# is left here is what only a browser can answer: that a PM5 puts the app in rowing units, and that
# the cockpit is wired to those functions at all.
class RowingCockpitTest < CapybaraTestBase
  def test_connecting_a_pm5_switches_the_app_to_rowing
    connect_rower

    assert_equal 'rower', app_state('ergometer.kind')
    refute app_state('ergometer.controlsPower'), 'a Concept2 accepts no power target'
  end

  def test_the_cockpit_reads_in_split_and_strokes_per_minute
    page.driver.resize(*PHONE)
    connect_rower

    # Uppercased by the stylesheet, like every label in the cockpit.
    within '.cockpit-metrics' do
      assert_text '/500 M'
      assert_text 'SPM'
      assert_text 'DISTANCE'
      assert_no_text 'RPM'
    end
  end

  def test_the_wide_table_gains_split_and_distance
    connect_rower

    within 'table.workout-data' do
      assert_text 'Split'
      assert_text 'Stroke rate'
      assert_text 'Distance'
    end
  end

  # The wiring, end to end: two wattages in, and the readings the deviation is made of out. 213 W is
  # 1:58 /500 m by w = 2.80 / pace³, the identity the probe confirmed on the machine, and both
  # numbers go through it, so on target the gap is exactly zero rather than the residue of two
  # different estimators.
  #
  # Asserted against a `connect_rower` — an erg present and saying nothing — so that the reading
  # under test is the one the test wrote rather than whichever one arrived last. Before the capture
  # was held back, `splitDelta` came back once as 234 seconds, the split of eight watts. The target
  # is the one reading the test cannot hold: the runner republishes it every second, so everything
  # here is read straight after it is written and never waited for.
  def test_the_cockpit_reads_both_splits_off_the_same_conversion
    connect_rower
    set_app_state(power: 213, targetWatts: 213)

    assert_equal '1:58', app_state('splitLabel')
    assert_equal '1:58', app_state('targetSplitLabel')
    assert_equal 0, app_state('splitDelta')
    assert_equal 'split-good', app_state('splitStatus')
  end

  # And the other half, which `SplitDeviationTest` cannot see: the colour, the fill and the number
  # are bound to those getters and reach the element. 180 W against a 213 W target is nearly seven
  # seconds per 500 m down.
  def test_the_deviation_bar_is_bound_to_the_gap
    page.driver.resize(*PHONE)
    connect_rower
    set_app_state(power: 180, targetWatts: 213)

    assert_equal 'split-deviation-fill split-warning', rendered('.split-deviation-fill', 'className')
    assert_match(/--from: 50%; --width: 34\.05\d*%/,
                 rendered('.split-deviation-fill', 'getAttribute("style")'))
    assert_equal '+6.8 s /500 m', rendered('.split-deviation-label', 'textContent')
  end

  # One round trip, with no waiting: whatever the element holds now. Capybara's own finders retry,
  # and a reading this test wrote is gone by the time a retry would run.
  def rendered(selector, property)
    page.evaluate_script("document.querySelector('#{selector}').#{property}")
  end
end

# rowing.js, imported into a page with nothing else on it. Every function under it is pure, so what
# these tests need from a browser is an ES module loader and nothing more — no app, no Alpine, no
# erg.
module RowingModule
  MODULES = { rowing: '/js/rowing.js' }.freeze

  def rowing(body, *)
    in_page_module(MODULES, body, *)
  end
end

# The deviation, as arithmetic: two splits in, and the number, the label, the colour and the bar
# out. All of it is pure, so none of it needs a browser with an erg attached — only a document to
# import the module into.
class SplitDeviationTest < ModuleTestBase
  include RowingModule

  # The gap as the cockpit forms it: two wattages, each through the same conversion.
  def delta_between(watts, target_watts)
    rowing(<<~JS, watts, target_watts)
      return rowing.splitDelta(
        rowing.splitFromPower(args[0]),
        rowing.splitFromPower(args[1])
      )
    JS
  end

  def style(delta)
    rowing('return rowing.deviationStyle(args[0])', delta)
  end

  def fill(delta)
    style(delta).scan(/([\d.]+)%/).flatten.map(&:to_f)
  end

  def test_the_same_wattage_on_both_sides_is_a_gap_of_exactly_zero
    assert_equal 0, delta_between(213, 213)
    assert_equal 'split-good', rowing('return rowing.deviationStatus(0)')
  end

  # 213 W asks for 1:58.0; 180 W is 2:04.8, so nearly seven seconds per 500 m down.
  def test_being_behind_the_target_reads_as_a_positive_gap
    delta = delta_between(180, 213)

    assert_in_delta 6.81, delta, 0.05
    assert_equal 'split-warning', rowing('return rowing.deviationStatus(args[0])', delta)
    assert_match(/\A\+6\.8 s/, rowing('return rowing.formatSplitDelta(args[0])', delta))
  end

  # Negative is faster, because a smaller split is a better one.
  def test_being_ahead_of_the_target_reads_as_a_negative_gap
    delta = delta_between(260, 213)

    assert_operator delta, :<, 0
    assert_match(/\A−/, rowing('return rowing.formatSplitDelta(args[0])', delta))
  end

  # Two seconds per 500 m is about what a good rower holds; past five the piece is a different
  # piece. The same two thresholds colour the bar and the number, so they cannot disagree.
  def test_the_thresholds_are_two_seconds_and_five
    statuses = rowing(<<~JS)
      return [0, 2, 2.1, 5, 5.1, -5.1].map(rowing.deviationStatus)
    JS

    assert_equal %w[split-good split-good split-close split-close split-warning split-warning],
                 statuses
  end

  def test_the_bar_is_anchored_to_the_target_whichever_side_the_rower_is_on
    # The fill starts left of centre and ends exactly on it when the rower is ahead, which is the
    # invariant that makes the bar readable at all.
    from, width = fill(delta_between(260, 213))

    assert_operator from, :<, 50
    assert_in_delta 50, from + width, 0.001

    # And behind, it starts on the centre and grows right.
    from, = fill(delta_between(180, 213))

    assert_in_delta 50, from, 0.001
  end

  # Ten seconds per 500 m is a different piece, not a deviation. Past that the bar pins rather than
  # running off the end of its track.
  def test_the_deviation_bar_pins_rather_than_overflowing
    assert_equal '--from: 50%; --width: 50%', style(delta_between(60, 300))
    assert_equal '--from: 0%; --width: 50%', style(-40)
  end

  # A free ride has no target, and an erg nobody is pulling has no split. Neither is a deviation of
  # zero: there is nothing to show, and the bar says so by being empty rather than centred on a gap
  # it does not have.
  def test_no_target_means_no_gap_to_show
    assert_nil delta_between(200, nil)
    assert_equal '', rowing('return rowing.formatSplitDelta(null)')
    assert_equal '', rowing('return rowing.deviationStatus(null)')
    assert_equal '--from: 50%; --width: 0%', style(nil)
  end
end

# The rower's two units, as they are read. The value carries its own unit, because the unit changes
# with the number: every caller that appended its own "m" printed "6.00 km m" for any session past a
# kilometre, which is most of the Concept2 archive.
class RowingUnitsTest < ModuleTestBase
  include RowingModule

  def test_distance_names_its_own_unit
    assert_equal "850\u00a0m", rowing('return rowing.formatDistance(args[0])', 850)
    assert_equal "6.00\u00a0km", rowing('return rowing.formatDistance(args[0])', 6000)
  end

  # 1:59.6 used to print as "1:60": the minute was taken out first and the remainder rounded after.
  # The cockpit re-reads this on every power packet, so it was a matter of time.
  def test_a_split_never_prints_sixty_seconds
    assert_equal '2:00', rowing('return rowing.formatSplit(args[0])', 119.6)
  end

  # A phase written in metres counts down in metres: its duration is only an estimate, and a
  # countdown that reached zero with two hundred metres still to row would be worse than none.
  def test_the_countdown_takes_the_unit_of_the_phase
    assert_equal '320', rowing('return rowing.formatPhaseCountdown(args[0], true)', 320)
    assert_equal 'metres to go', rowing('return rowing.countdownUnit(args[0], true)', 320)
    assert_equal "320\u00a0m", rowing('return rowing.formatPhaseRemaining(args[0], true)', 320)
  end

  # Under a minute the seconds are the whole message, and a leading "0:" is noise on a number meant
  # to be read at a glance.
  def test_a_phase_written_in_time_counts_down_in_seconds
    assert_equal '45', rowing('return rowing.formatPhaseCountdown(args[0], false)', 45)
    assert_equal 'seconds', rowing('return rowing.countdownUnit(args[0], false)', 45)
    assert_equal '0:45', rowing('return rowing.formatPhaseRemaining(args[0], false)', 45)

    assert_equal '1:30', rowing('return rowing.formatPhaseCountdown(args[0], false)', 90)
    assert_equal 'remaining', rowing('return rowing.countdownUnit(args[0], false)', 90)
  end
end
