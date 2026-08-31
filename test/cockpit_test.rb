require_relative 'test_helper'

# On a phone the four-column table is four cramped columns, read by someone at 300 W with about a
# second to spare. The cockpit is the same data with a hierarchy.
class CockpitTest < CapybaraTestBase
  def test_a_phone_gets_the_cockpit_and_not_the_table
    page.driver.resize(*PHONE)
    ride

    assert_selector '.cockpit', visible: true
    assert_no_selector 'table.workout-data', visible: true
  end

  def test_a_wide_screen_keeps_the_table
    ride

    assert_selector 'table.workout-data', visible: true
    assert_no_selector '.cockpit', visible: true
  end

  def test_the_cockpit_names_the_target_the_phase_asks_for
    page.driver.resize(*PHONE)
    # The fixture opens on a warm-up ramping from 40 % of FTP, so 200 W of FTP means 80 W to hold.
    ride(ftp: 200)

    within '.cockpit' do
      assert_text '40 % FTP'
      assert_text '↑80'
    end
  end

  def test_the_cockpit_announces_the_phase_after_this_one
    page.driver.resize(*PHONE)
    ride

    within '.cockpit-next' do
      # The fixture's second phase is a MaxEffort: 30 seconds the trainer does not control.
      assert_text 'Max effort'
      assert_text '30 s'
      # Uppercased by the stylesheet, like every label in the cockpit.
      assert_text 'FREE RIDE'
    end
  end

  def test_the_countdown_drops_the_leading_zero_below_a_minute
    page.driver.resize(*PHONE)
    ride

    # The warm-up is 60 s, so it reads as 1:00 and then as bare seconds.
    assert_selector '.cockpit-countdown', text: /\A(1:00|\d{1,2})\z/
  end
end
