require_relative 'test_helper'

# The rower is the machine with no ERG mode: nothing the app sends can make the erg hold a target,
# so the cockpit is not a comfort but the entire feedback loop. What it has to get right is that
# split and target split are the same computation applied to two wattages, and that the gap between
# them is legible.
#
# The arithmetic behind that gap is rowing.js's, and `RowingTest` has it without a browser. What is
# left here is what only a browser can answer: that a PM5 puts the app in rowing units, and that the
# cockpit is wired to those functions at all.
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

  # Both splits off the same conversion, through the component: 213 W reads 1:58 whether it is the
  # erg reporting it or the phase asking for it.
  #
  # The target is the one reading a test cannot hold — the runner republishes it every second — so
  # everything here is read straight after it is written and never waited for.
  def test_the_cockpit_reads_both_splits_off_the_same_conversion
    connect_rower
    set_app_state(power: 213, targetWatts: 213)

    assert_equal '1:58', app_state('splitLabel')
    assert_equal '1:58', app_state('targetSplitLabel')
  end

  # And the half `RowingTest` cannot see: the colour, the fill and the number reach the element.
  # 180 W against a 213 W target is nearly seven seconds per 500 m down — a warning, a bar filled
  # right of centre, and a signed label, none of which is the empty default.
  def test_the_deviation_bar_is_bound_to_the_gap
    connect_rower
    set_app_state(power: 180, targetWatts: 213)

    # One script, so the three readings are one snapshot: a re-render between them would otherwise
    # be a re-render between two assertions about the same stroke.
    class_name, style, label = page.evaluate_script(<<~JS)
      (() => {
        const fill = document.querySelector('.split-deviation-fill')
        return [fill.className, fill.getAttribute('style'),
                document.querySelector('.split-deviation-label').textContent]
      })()
    JS

    assert_equal 'split-deviation-fill split-warning', class_name
    assert_match(/--from: 50%; --width: 34\.05\d*%/, style)
    assert_equal '+6.8 s /500 m', label
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
