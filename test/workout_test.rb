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
    assert_text 'Mixed & Unusual • 3 minutes'
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
