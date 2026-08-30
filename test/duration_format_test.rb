require_relative 'test_helper'

# Durations are stored as decimal minutes, which is fine for the library's filters and unreadable on
# screen: a workout announced itself as "50.83 minutes".
class DurationFormatTest < CapybaraTestBase
  def format(minutes)
    in_page_module({ utils: '/js/utils.js' }, 'return utils.formatDuration(args[0])', minutes)
  end

  def test_whole_minutes_stay_plain
    assert_equal '45 min', format(45)
  end

  def test_decimal_minutes_become_seconds
    assert_equal '50 min 50 s', format(50.83)
    assert_equal '32 min 15 s', format(32.25)
  end

  def test_seconds_are_dropped_once_there_are_hours
    assert_equal '1 h 31 min', format(91)
    assert_equal '1 h', format(60)
    assert_equal '1 h 30 min', format(90.5)
  end

  def test_nothing_to_say_about_an_empty_duration
    assert_equal '', format(0)
    assert_equal '', format(nil)
  end
end
