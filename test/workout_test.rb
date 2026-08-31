require_relative 'test_helper'

class WorkoutTest < CapybaraTestBase
  def test_workout_full_flow
    ride(fixture: 'The_Famous_40_20_s.zwo', heart_rate: true)
    assert_selector '[x-ref="workoutSvg"]', visible: true
  end

  def test_heart_rate_button_shows_the_live_rate
    # Before this, nothing listened to the belt until the workout started, so there was no way to
    # check on the setup screen that the watch was actually broadcasting.
    find_field('Heart Rate Monitor').click
    # The button disables itself once connected, so it has to be looked up with disabled: :all.
    assert_field 'Heart Rate Monitor', with: /120 bpm/, disabled: :all
  end

  def test_starts_without_a_heart_rate_monitor
    # The heart rate belt used to be mandatory, and its absence made Start a silent no-op.
    ride(fixture: 'The_Famous_40_20_s.zwo')
    assert_selector '[x-ref="workoutSvg"]', visible: true
  end

  def test_the_bluetooth_log_is_readable_without_a_console
    find_field('Heart Rate Monitor').click

    assert_text 'Bluetooth log'
    find('summary', text: 'Bluetooth log').click
    assert_text 'Subscribed to Heart Rate notifications'
    # Silence is the state that is hard to read: a first reading separates "not connected" from
    # "connected and saying nothing".
    assert_text 'First heart rate reading: 120 bpm'
  end

  def test_a_failed_connection_says_what_went_wrong
    page.execute_script(
      "localStorage.setItem('mockBluetoothFailure', 'GATT Server is disconnected.')"
    )
    find_field('Ergometer').click

    assert_text 'Ergometer: GATT Server is disconnected.'
    assert_field 'Ergometer', with: 'Connect'
  end

  def test_closing_the_device_chooser_is_not_an_error
    page.execute_script(
      "localStorage.setItem('mockBluetoothFailure', " \
      "'User cancelled the requestDevice() chooser.')"
    )
    find_field('Ergometer').click

    assert_field 'Ergometer', with: 'Connect'
    assert_no_selector '.device-error', visible: true
  end

  def test_a_device_warning_shows_before_the_workout_starts
    # The banner used to live inside the workout display, hidden until Start — invisible exactly
    # when the rider is connecting devices and needs to know one has dropped.
    page.execute_script(
      "Alpine.$data(document.querySelector('[x-data]'))" \
      ".connectionWarning = 'Heart rate monitor lost. Check it, then reconnect it.'"
    )
    assert_text 'Heart rate monitor lost.'
  end

  def test_refusing_to_start_says_why
    click_on 'Start'
    assert_text 'Connect your ergometer before starting.'

    find_field('Ergometer').click
    click_on 'Start'
    assert_text 'Choose a workout before starting.'
  end

  def test_counts_the_full_duration_of_a_workout_with_undocumented_tags
    ride(heart_rate: true)
    # 60 + 30 + 60 + 30 seconds. Only the Warmup used to be counted, for a reported 1 minute.
    assert_text 'Mixed & Unusual • 3 min'
  end

  def test_ftp_and_weight_local_storage
    fill_in 'Weight (kg)', with: '75'
    ride(fixture: 'The_Famous_40_20_s.zwo', ftp: 200, heart_rate: true)
    visit '/'
    assert_field 'FTP (watts)', with: '200'
    assert_field 'Weight (kg)', with: '75'
  end
end
