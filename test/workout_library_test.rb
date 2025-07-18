# frozen_string_literal: true

require_relative 'test_helper'

class WorkoutLibraryTest < CapybaraTestBase
  def test_open_and_close_workout_library_modal
    click_on 'Choisir dans la bibliothèque'
    assert_text "Bibliothèque d'entraînements"
    click_on 'Fermer'
    assert_no_text "Bibliothèque d'entraînements"
  end

  def test_open_and_pick_workout_from_library
    click_on 'Choisir dans la bibliothèque'
    find('summary', text: 'Athlete Inspired').click
    within(find('details', text: 'Anna Meares - Team Sprint')) do
      click_on 'Sélectionner', match: :first
    end
    assert_no_text "Bibliothèque d'entraînements"
    assert_text 'Sélectionné: Anna Meares - Team Sprint (32.25 min)'
  end

  def test_search_workouts_in_library
    click_on 'Choisir dans la bibliothèque'
    fill_in 'Rechercher un entraînement...', with: 'Fun is st'
    assert_text 'Fun is Staying Cool'
  end
end
