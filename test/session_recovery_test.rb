require_relative 'test_helper'

# Nothing was written anywhere until "Export activity" was clicked, at the very end: a tab closed at
# minute 45 destroyed the ride.
class SessionRecoveryTest < ModuleTestBase
  STORE = { store: '/js/session-store.js' }.freeze

  def store_call(body, *)
    in_page_module(STORE, body, *)
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
end

# And what the rider is shown on the next load. The store above is where it is kept; this is the
# offer, which only a session that was really interrupted can produce.
class InterruptedSessionTest < CapybaraTestBase
  def test_an_interrupted_ride_is_offered_on_the_next_load
    ride_until_samples_exist
    app_state('persistSession()')

    visit '/'
    assert_text 'An interrupted session was found'
    assert_text 'Mixed & Unusual'
    assert_button 'Export it'
  end

  def test_discarding_forgets_it_for_good
    ride_until_samples_exist
    app_state('persistSession()')

    visit '/'
    click_on 'Discard'
    assert_no_text 'An interrupted session was found'

    visit '/'
    assert_no_text 'An interrupted session was found'
  end
end
