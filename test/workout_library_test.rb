require_relative 'test_helper'

class WorkoutLibraryTest < CapybaraTestBase
  def test_open_and_close_workout_library_modal
    click_on 'Choose from Library'
    assert_text 'Workout Library'
    click_on 'Close'
    assert_no_text 'Workout Library'
  end

  def test_open_and_pick_workout_from_library
    click_on 'Choose from Library'
    find('summary', text: 'Athlete Inspired').click
    within(find('details', text: 'Anna Meares - Team Sprint')) do
      click_on 'Select', match: :first
    end
    assert_no_text 'Workout Library'
    assert_text 'Selected: Anna Meares - Team Sprint (32.25 min)'
  end

  def test_search_workouts_in_library_by_name
    click_on 'Choose from Library'
    fill_in 'Search for a workout...', with: 'Fun is st'
    assert_text 'Fun is Staying Cool'
  end

  def test_filter_workouts_by_duration_and_description
    click_on 'Choose from Library'
    fill_in 'Min. duration (min)', with: '60'
    assert_text 'Week 10.1 - Day 1 • 91 minutes'
    fill_in 'Max. duration (min)', with: '70'
    assert_no_text 'Week 10.1 - Day 1 • 91 minutes'
    assert_text 'Week 10.5 - Day 5 • 60 minutes'
    fill_in 'Search for a workout...', with: 'aiming'
    assert_text 'Ride as you feel aiming to keep power'
    assert_no_text 'Week 10.5 - Day 5 • 60 minutes'
    fill_in 'Max. duration (min)', with: ''
    fill_in 'Min. duration (min)', with: '999'
    assert_text 'No workouts found for the selected criteria'
  end
end
