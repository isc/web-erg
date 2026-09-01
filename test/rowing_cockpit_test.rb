require_relative 'test_helper'

# The rower is the machine with no ERG mode: nothing the app sends can make the erg hold a target,
# so the cockpit is not a comfort but the entire feedback loop. What it has to get right is that
# split and target split are the same computation applied to two wattages, and that the gap between
# them is legible.
#
# All of it is asserted against a `connect_rower` — an erg present and saying nothing — so that the
# numbers under test are the numbers the test wrote rather than whichever ones arrived last.
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

  # 213 W is 1:58 /500 m by w = 2.80 / pace³ — the identity the probe confirmed on the machine.
  # Both numbers go through it, which is the point: on target, the gap is exactly zero rather than
  # the residue of two different estimators.
  def test_split_and_target_are_the_same_conversion_of_two_wattages
    connect_rower

    set_app_state(power: 213, targetWatts: 213)

    assert_equal '1:58', app_state('splitLabel')
    assert_equal '1:58', app_state('targetSplitLabel')
    assert_equal 0, app_state('splitDelta')
    assert_equal 'split-good', app_state('splitStatus')
  end

  def test_being_behind_the_target_reads_as_a_positive_gap
    connect_rower

    # 213 W asks for 1:58.0; 180 W is 2:04.8, so nearly seven seconds per 500 m down.
    set_app_state(power: 180, targetWatts: 213)

    assert_in_delta 6.81, app_state('splitDelta'), 0.05
    assert_equal 'split-warning', app_state('splitStatus')
    assert_match(/\A\+6\.8 s/, app_state('splitDeltaLabel'))
  end

  def test_being_ahead_of_the_target_fills_the_bar_to_the_left
    connect_rower

    set_app_state(power: 260, targetWatts: 213)

    assert_operator app_state('splitDelta'), :<, 0
    # The fill starts left of centre and ends exactly on it, which is the invariant that makes the
    # bar readable at all: whichever side it is on, it is anchored to the target.
    from, width = app_state('splitDeviationStyle').scan(/([\d.]+)%/).flatten.map(&:to_f)
    assert_operator from, :<, 50
    assert_in_delta 50, from + width, 0.001
  end

  # Ten seconds per 500 m is a different piece, not a deviation. Past that the bar pins rather than
  # running off the end of its track.
  def test_the_deviation_bar_pins_rather_than_overflowing
    connect_rower

    set_app_state(power: 60, targetWatts: 300)

    assert_equal '--from: 50%; --width: 50%', app_state('splitDeviationStyle')
  end

  # The value carries its own unit, because the unit changes with the number. Every caller that
  # appended its own "m" printed "6.00 km m" for any session past a kilometre, which is most of
  # the Concept2 archive.
  def test_distance_names_its_own_unit
    connect_rower

    set_app_state(distance: 850)

    assert_equal "850\u00a0m", app_state('distanceLabel')

    set_app_state(distance: 6000)

    assert_equal "6.00\u00a0km", app_state('distanceLabel')
  end

  def test_no_target_means_no_gap_to_show
    connect_rower

    set_app_state(power: 200, targetWatts: nil)

    assert_equal '', app_state('splitDeltaLabel')
    assert_equal '--from: 50%; --width: 0%', app_state('splitDeviationStyle')
  end
end

# The one test here that is rowed rather than driven. Every metre of this comes off the PM5: there
# is no aerodynamic model on a rower and no opportunity for one, the machine counts the flywheel.
class RowedDistanceTest < CapybaraTestBase
  def test_distance_is_the_erg_s_own_count
    row

    # The capture is a 100 m piece. It is held until Start, so nothing was rowed before the session
    # began and the erg's counter and the session's are the same number.
    wait_until(15) { app_state('distance').to_f >= 100 }

    assert_equal 100.0, app_state('distance')
    assert_equal app_state('ergDistance'), app_state('distance')
  end
end

# 1:59.6 used to print as "1:60": the minute was taken out first and the remainder rounded after.
# The cockpit re-reads this on every power packet, so it was a matter of time. The subject is
# rowing.js and nothing above it, so there is no erg to connect.
class SplitFormatTest < ModuleTestBase
  def test_a_split_never_prints_sixty_seconds
    split = in_page_module({ rowing: '/js/rowing.js' }, 'return rowing.formatSplit(args[0])', 119.6)

    assert_equal '2:00', split
  end
end
