require_relative 'test_helper'

class WorkoutTest < CapybaraTestBase
  def test_workout_full_flow
    find_field('Bike').click
    find_field('Heart Rate Monitor').click
    attach_file(
      'workoutFile',
      File.expand_path('The_Famous_40_20_s.zwo', __dir__),
      visible: false
    )
    click_on 'Start'
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
    find_field('Bike').click
    attach_file(
      'workoutFile',
      File.expand_path('The_Famous_40_20_s.zwo', __dir__),
      visible: false
    )
    click_on 'Start'
    assert_selector '[x-ref="workoutSvg"]', visible: true
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
    assert_text 'Connect your bike before starting.'

    find_field('Bike').click
    click_on 'Start'
    assert_text 'Choose a workout before starting.'
  end

  def test_counts_the_full_duration_of_a_workout_with_undocumented_tags
    find_field('Bike').click
    find_field('Heart Rate Monitor').click
    attach_file(
      'workoutFile',
      File.expand_path('Mixed_And_Unusual.zwo', __dir__),
      visible: false
    )
    click_on 'Start'
    # 60 + 30 + 60 + 30 seconds. Only the Warmup used to be counted, for a reported 1 minute.
    assert_text 'Mixed & Unusual • 3 min'
  end

  def test_ftp_and_weight_local_storage
    find_field('Bike').click
    find_field('Heart Rate Monitor').click
    fill_in 'FTP (watts)', with: '200'
    fill_in 'Weight (kg)', with: '75'
    attach_file(
      'workoutFile',
      File.expand_path('The_Famous_40_20_s.zwo', __dir__),
      visible: false
    )
    click_on 'Start'
    visit '/'
    assert_field 'FTP (watts)', with: '200'
    assert_field 'Weight (kg)', with: '75'
  end
end
