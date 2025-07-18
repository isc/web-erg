# frozen_string_literal: true

require_relative "test_helper"

class WorkoutTest < CapybaraTestBase
  def test_workout_full_flow
    find_field("Vélo").click
    find_field("Cardio").click
    attach_file(
      "workoutFile",
      File.expand_path("The_Famous_40_20_s.zwo", __dir__),
      visible: false
    )
    click_on "Démarrer"
    assert_selector '[x-ref="workoutSvg"]', visible: true
  end

  def test_ftp_and_weight_local_storage
    find_field("Vélo").click
    find_field("Cardio").click
    fill_in "FTP (watts)", with: "200"
    fill_in "Poids (kg)", with: "75"
    attach_file(
      "workoutFile",
      File.expand_path("The_Famous_40_20_s.zwo", __dir__),
      visible: false
    )
    click_on "Démarrer"
    visit "/"
    assert_field "FTP (watts)", with: "200"
    assert_field "Poids (kg)", with: "75"
  end
end
