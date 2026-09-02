require_relative 'test_helper'

# On a phone the four-column table is four cramped columns, read by someone at 300 W with about a
# second to spare. The cockpit is the same data with a hierarchy.
class CockpitTest < CapybaraTestBase
  # The cockpit is what a phone gets, so the phone is the precondition of the class rather than the
  # first line of seven of its tests. `test_a_wide_screen_keeps_the_table` is the one that undoes it.
  def setup
    super
    page.driver.resize(*PHONE)
  end

  def test_a_phone_gets_the_cockpit_and_not_the_table
    ride

    assert_selector '.cockpit', visible: true
    assert_no_selector 'table.workout-data', visible: true
  end

  def test_a_wide_screen_keeps_the_table
    page.driver.resize(1024, 768)
    ride

    assert_selector 'table.workout-data', visible: true
    assert_no_selector '.cockpit', visible: true
  end

  def test_the_cockpit_names_the_target_the_phase_asks_for
    # The fixture opens on a warm-up ramping from 40 % of FTP, so 200 W of FTP means 80 W to hold.
    ride(ftp: 200)

    within '.cockpit' do
      assert_text '40 % FTP'
      assert_text '↑80'
    end
  end

  def test_the_cockpit_announces_the_phase_after_this_one
    ride

    within '.cockpit-next' do
      # The fixture's second phase is a MaxEffort: 30 seconds the trainer does not control.
      assert_text 'Max effort'
      assert_text '30 s'
      # Uppercased by the stylesheet, like every label in the cockpit.
      assert_text 'FREE RIDE'
    end
  end

  # Three readings of one screen, taken from one ride: they are all rendered at the same moment by
  # the same component, and a ride is the most expensive thing this file does. The session bar
  # beside them used to be asserted too, on its literal `max="100"` and on a value that cannot be
  # negative — it would have passed with the feature removed.
  def test_the_cockpit_is_one_screen_of_readings
    ride

    # Elapsed and total on the same line, in the same form. The fixture is 3 minutes.
    within '.cockpit-session' do
      assert_text %r{\d:\d\d\s*/\s*3:00}
    end

    # The decoder rounds what it computes from the crank counter: a cadence reads as a whole
    # number, and the em dash of a trainer saying nothing would satisfy that on its own.
    within '.cockpit-metrics' do
      assert_selector 'li', text: /\d+\s*RPM/
      assert_no_text(/\d\.\d/)
    end

    # The warm-up is 60 s, so the countdown reads 1:00 and then bare seconds — never "0:07".
    assert_selector '.cockpit-countdown', text: /\A(1:00|\d{1,2})\z/
  end
end
