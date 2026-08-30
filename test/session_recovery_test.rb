require_relative 'test_helper'

# Nothing was written anywhere until "Export activity" was clicked, at the very end: a tab closed at
# minute 45 destroyed the ride.
class SessionRecoveryTest < CapybaraTestBase
  STORE = { store: '/js/session-store.js' }.freeze

  def store_call(body, *args)
    in_page_module(STORE, body, *args)
  end

  def test_saved_session_survives_a_round_trip
    store_call('store.saveSession(args[0]); return null',
               { 'notes' => 'Ride', 'samples' => [{ 'power' => 100 }] })
    assert_equal 1, store_call('return store.loadSession().samples.length')
  end

  def test_a_session_without_samples_is_nothing_to_recover
    store_call("store.saveSession({ name: 'Ride', samples: [] }); return null")
    assert_nil store_call('return store.loadSession()')
  end

  def test_unreadable_storage_is_treated_as_empty_not_as_an_error
    page.execute_script("localStorage.setItem('web-erg:session', 'not json')")
    assert_nil store_call('return store.loadSession()')
  end

  def test_an_interrupted_ride_is_offered_on_the_next_load
    ride_until_samples_exist
    page.execute_script("Alpine.$data(document.querySelector('[x-data]')).persistSession()")

    visit '/'
    assert_text 'An interrupted session was found'
    assert_text 'Mixed & Unusual'
    assert_button 'Export it'
  end

  def test_discarding_forgets_it_for_good
    ride_until_samples_exist
    page.execute_script("Alpine.$data(document.querySelector('[x-data]')).persistSession()")

    visit '/'
    click_on 'Discard'
    assert_no_text 'An interrupted session was found'

    visit '/'
    assert_no_text 'An interrupted session was found'
  end

  private

  # The fake trainer reports whatever wattage localStorage names, so seeding it stands in for a
  # rider turning the pedals: the runner only starts once power goes above zero.
  def ride_until_samples_exist
    page.execute_script("localStorage.setItem('ergPower', '120')")
    find_field('Bike').click
    attach_file(
      'workoutFile',
      File.expand_path('Mixed_And_Unusual.zwo', __dir__),
      visible: false
    )
    click_on 'Start'
    Timeout.timeout(Capybara.default_max_wait_time) do
      sleep 0.2 until page.evaluate_script(
        "Alpine.$data(document.querySelector('[x-data]')).workoutSamples.length"
      ).positive?
    end
  end
end
