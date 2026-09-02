require_relative 'test_helper'

# rowing.js on its own: the conversion between the rower's two units, the deviation from a target,
# and the readings a phase is counted down in. All of it is pure, so what these tests need from a
# browser is an ES module loader and nothing more — no app, no Alpine, no erg. The cockpit that
# binds them is `RowingCockpitTest`.
class RowingTest < ModuleTestBase
  MODULES = { rowing: '/js/rowing.js' }.freeze

  # One round trip per test: `in_page_module` is a CDP call that rebuilds its own wrapper, and a
  # scenario that ships a delta out to Ruby only to send it back for the next reading pays for
  # three.
  def rowing(body, *)
    in_page_module(MODULES, body, *)
  end

  # The gap as the cockpit forms it: two wattages, each through the same conversion, and everything
  # the cockpit reads off the result.
  def deviation(watts, target_watts)
    rowing(<<~JS, watts, target_watts)
      const delta = rowing.splitDelta(
        rowing.splitFromPower(args[0]),
        rowing.splitFromPower(args[1])
      )
      return [delta, rowing.splitDeltaStatus(delta), rowing.formatSplitDelta(delta),
              rowing.splitDeltaStyle(delta)]
    JS
  end

  # 213 W is 1:58 /500 m by w = 2.80 / pace³, the identity the probe confirmed on the machine. Both
  # numbers go through it, which is the point: on target the gap is exactly zero rather than the
  # residue of two different estimators.
  def test_the_same_wattage_on_both_sides_is_a_gap_of_exactly_zero
    delta, status, label = deviation(213, 213)

    assert_equal 0, delta
    assert_equal 'split-good', status
    assert_equal '±0.0 s /500 m', label
  end

  # 213 W asks for 1:58.0; 180 W is 2:04.8, so nearly seven seconds per 500 m down. The bar grows
  # right from the centre, which is what "behind" looks like.
  def test_being_behind_the_target_reads_as_a_positive_gap
    delta, status, label, style = deviation(180, 213)

    assert_in_delta 6.81, delta, 0.05
    assert_equal 'split-warning', status
    assert_match(/\A\+6\.8 s/, label)
    assert_in_delta 50, from_of(style), 0.001
  end

  # Negative is faster, because a smaller split is a better one. The fill then starts left of centre
  # and ends exactly on it — anchored to the target whichever side the rower is, which is the
  # invariant that makes the bar readable without reading the number beside it.
  def test_being_ahead_of_the_target_reads_as_a_negative_gap
    delta, _, label, style = deviation(260, 213)

    assert_operator delta, :<, 0
    assert_match(/\A−/, label)
    from, width = style.scan(/([\d.]+)%/).flatten.map(&:to_f)

    assert_operator from, :<, 50
    assert_in_delta 50, from + width, 0.001
  end

  # The thresholds rowing.js documents, swept in one pass so the bands cannot drift apart.
  def test_two_seconds_is_good_and_five_is_still_close
    assert_equal %w[split-good split-good split-close split-close split-warning split-warning],
                 rowing('return [0, 2, 2.1, 5, 5.1, -5.1].map(rowing.splitDeltaStatus)')
  end

  # Ten seconds per 500 m is a different piece, not a deviation. Past that the bar pins rather than
  # running off the end of its track.
  def test_the_deviation_bar_pins_rather_than_overflowing
    pinned = rowing('return [40, -40].map(rowing.splitDeltaStyle)')

    assert_equal ['--from: 50%; --width: 50%', '--from: 0%; --width: 50%'], pinned
  end

  # A free ride has no target, and an erg nobody is pulling has no split. Neither is a deviation of
  # zero: there is nothing to show, and the bar says so by being empty rather than centred on a gap
  # it does not have.
  def test_no_target_means_no_gap_to_show
    # `null` asserted in the page: a null crosses the CDP boundary as an empty string, which is what
    # the other three readings are anyway, so Ruby cannot tell the four apart from here.
    no_gap, status, label, style = rowing(<<~JS, 200, nil)
      const delta = rowing.splitDelta(
        rowing.splitFromPower(args[0]),
        rowing.splitFromPower(args[1])
      )
      return [delta === null, rowing.splitDeltaStatus(delta), rowing.formatSplitDelta(delta),
              rowing.splitDeltaStyle(delta)]
    JS

    assert no_gap, 'a phase with no target has no deviation, not a deviation of zero'
    assert_equal '', status
    assert_equal '', label
    assert_equal '--from: 50%; --width: 0%', style
  end

  # The value carries its own unit, because the unit changes with the number: every caller that
  # appended its own "m" printed "6.00 km m" for any session past a kilometre, which is most of the
  # Concept2 archive. And 1:59.6 used to print as "1:60" — the minute was taken out first and the
  # remainder rounded after, on a number the cockpit re-reads with every power packet.
  def test_a_reading_carries_its_own_unit
    assert_equal ["850\u00a0m", "6.00\u00a0km", '2:00'],
                 rowing(<<~JS)
                   return [rowing.formatDistance(850), rowing.formatDistance(6000),
                           rowing.formatSplit(119.6)]
                 JS
  end

  # A phase written in metres counts down in metres, and one written in time counts down in
  # seconds. Which it is, is the phase's own business — nothing tells these functions.
  def test_the_countdown_takes_the_unit_of_the_phase
    assert_equal ['320', 'metres to go', "320\u00a0m"], readings({ distance: 500 }, 320)
    assert_equal ['45', 'seconds', '0:45'], readings({ duration: 60 }, 45)
  end

  # Above a minute the countdown is m:ss and the label stops naming a unit — and it is the rounded
  # number that decides, so 59.7 s cannot read "1:00" over the word "seconds".
  def test_the_label_agrees_with_the_number_it_labels
    assert_equal ['1:30', 'remaining'], readings({ duration: 120 }, 90).first(2)
    assert_equal ['1:00', 'remaining'], readings({ duration: 120 }, 59.7).first(2)
  end

  def readings(phase, remaining)
    rowing(<<~JS, phase, remaining)
      return [rowing.formatPhaseCountdown(args[0], args[1]),
              rowing.countdownUnit(args[0], args[1]),
              rowing.formatPhaseRemaining(args[0], args[1])]
    JS
  end

  # The whole of a phase, not what is left of it — the line the cockpit shows for the next one.
  def test_a_phase_names_its_own_length
    assert_equal ["500\u00a0m", '4 min', ''],
                 rowing(<<~JS)
                   return [{ distance: 500 }, { duration: 240 }, null].map(rowing.formatPhaseLength)
                 JS
  end

  def from_of(style)
    style[/--from: ([\d.]+)%/, 1].to_f
  end
end
