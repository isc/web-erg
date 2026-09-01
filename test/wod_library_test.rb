require_relative 'test_helper'

# No machine-readable rowing workout library exists. What does exist is Concept2's Workout of the
# Day newsletter, addressable by date and in the clear, which scripts/import_c2_wod.rb turns into
# .zwo files committed beside the Zwift ones. These tests are about what shipped, not about the
# fetching: the corpus is in the repo and nothing depends on that server at run time — nor on a
# browser, which is why this one reads the files straight off disk.
class WodCorpusTest < Minitest::Test
  CORPUS = JSON.parse(
    File.read(File.expand_path('../public/rowing_workouts.json', __dir__))
  )['Concept2 Workout of the Day'].freeze

  def test_the_archive_shipped
    assert_operator CORPUS.size, :>, 50, 'the sampled archive holds roughly this many distinct WODs'
  end

  # The point of the whole extension. A rowing corpus that came out expressed in seconds would mean
  # the import had quietly rewritten every "8 x 500m" as a duration.
  def test_the_corpus_is_written_in_metres_where_the_archive_is
    distance_workouts = Dir[File.expand_path('../public/rowing_workouts/*.zwo', __dir__)]
                        .count { |path| File.read(path).include?('Distance=') }

    assert_operator distance_workouts, :>=, 20
  end

  # No WOD carries an intensity — "5 x 4 min / 2 min easy" is the whole specification. The targets
  # are derived by Paul's Law from the 2 km reference, so a shorter piece must come out harder.
  def test_shorter_pieces_are_given_harder_targets
    assert_operator hardest('12_x_250m_45_sec_easy.zwo'), :>, hardest('4_x_1500m_2_min_easy.zwo')
  end

  # A 2 km piece is the anchor the rule is stated against, so it must come out at exactly the
  # rider's rowing FTP. Anything else means the reference and the formula have drifted apart.
  def test_two_kilometres_is_the_anchor
    zwo = workout('2000m_3_minutes_rest_1000m_2_minutes_rest_500m.zwo')

    assert_includes zwo, '<SteadyState Distance="2000" Power="1.0"/>'
  end

  private

  def workout(name)
    File.read(File.expand_path("../public/rowing_workouts/#{name}", __dir__))
  end

  def hardest(name)
    workout(name).scan(/Power="([\d.]+)"/).flatten.map(&:to_f).max
  end
end

# And that the corpus reached the library the rides are chosen from — the one thing about it that
# needs the app open.
class WodLibraryTest < CapybaraTestBase
  def test_a_wod_is_choosable_from_the_same_library_as_the_rides
    click_on 'Choose from Library'
    fill_in 'Search for a workout...', with: '8 x 500m'
    within(find('details', text: '8 x 500m, 2 minutes rest')) do
      click_on 'Select', match: :first
    end

    assert_no_text 'Workout Library'
    assert_text 'Selected: 8 x 500m, 2 minutes rest'
  end

  def test_a_chosen_wod_loads_its_phases
    click_on 'Choose from Library'
    fill_in 'Search for a workout...', with: '8 x 500m'
    within(find('details', text: '8 x 500m, 2 minutes rest')) do
      click_on 'Select', match: :first
    end
    wait_until { app_state('workoutRunner') }

    # Eight 500 m pieces and the paddle after each.
    assert_equal 16, app_state('workoutRunner.expandedPhases.length')
  end

  def test_the_rides_are_still_in_the_library_beside_them
    click_on 'Choose from Library'

    assert_text 'Concept2 Workout of the Day'
    assert_text 'Athlete Inspired'
  end
end
