require_relative 'test_helper'

# The frames in pm5-capture.js are what a Concept2 PM5 sent on 31 August 2026, extracted from the
# probe reports. Nothing here is a fixture someone wrote: every assertion below is a number the
# machine produced, and most of them are cross-checked against a second field carrying the same
# quantity in different units. That is the whole reason the capture exists — without an erg, an
# agreement between two of the erg's own characteristics is the strongest evidence available.
class Pm5DecoderTest < CapybaraTestBase
  MODULES = {
    pm5: '/js/ergometers/concept2-pm5.js',
    capture: '/js/pm5-capture.js',
    rowing: '/js/rowing.js'
  }.freeze

  # The last frame a characteristic sent during the captured session, decoded. "Last" because the
  # PM5 freezes its final reading and keeps repeating it, so that frame is the finished piece.
  def decode(decoder, uuid, which: :last)
    in_page_module(MODULES, <<~JS, uuid, which.to_s, decoder)
      const frames = capture.CAPTURES['fixed-100m'].frames.filter(f => f.uuid === args[0])
      const frame = args[1] === 'last' ? frames[frames.length - 1] : frames[0]
      const bytes = Uint8Array.from(frame.hex.split(' '), b => parseInt(b, 16))
      return pm5[args[2]](new DataView(bytes.buffer))
    JS
  end

  def test_general_status_reads_the_distance_the_piece_covered
    status = decode('decodeGeneralStatus', 'ce060031-43e5-11e4-916c-0800200c9a66')

    assert_in_delta 100.0, status['distance'], 0.01
    assert_in_delta 33.39, status['elapsed'], 0.01
    # Drag, not resistance: nothing on a Concept2 accepts a load setting. FTMS reports the same 174
    # in a field it calls "resistance level", which is why that field must never be shown as one.
    assert_equal 174, status['dragFactor']
    # 12 is WORKOUTLOGGED — the piece was over and written to the monitor's log.
    assert_equal 12, status['workoutState']
  end

  def test_status_one_agrees_with_itself_about_pace_and_speed
    status = decode('decodeAdditionalStatus1', 'ce060032-43e5-11e4-916c-0800200c9a66')

    assert_equal 23, status['strokeRate']
    # 255 means no belt was paired. Reporting it as a heart rate of 255 bpm is the failure this
    # guards against.
    assert_nil status['heartRate']
    # Two fields, one measurement: 500 m at 3.443 m/s takes 145.2 s, and the erg says 145.68.
    assert_in_delta 500 / status['speed'], status['pace'], 1.0
    assert_in_delta 167.04, status['averagePace'], 0.01
  end

  def test_stroke_data_carries_the_power_the_cockpit_reads
    stroke = decode('decodeAdditionalStrokeData', 'ce060036-43e5-11e4-916c-0800200c9a66')

    assert_equal 114, stroke['power']
    assert_equal 13, stroke['strokeCount']
    assert_in_delta 32.95, stroke['elapsed'], 0.01
  end

  def test_split_scales_are_not_the_ones_the_spec_publishes
    split = decode('decodeSplitData', 'ce060037-43e5-11e4-916c-0800200c9a66')

    # The published scale would make this 3.34 s and 10 m. The same frame times itself at 33.39 s
    # and 100.0 m, so split time is tenths and split distance is whole metres.
    assert_in_delta 33.4, split['splitTime'], 0.05
    assert_equal 100, split['splitDistance']
    assert_in_delta split['elapsed'], split['splitTime'], 0.05
    assert_in_delta split['distance'], split['splitDistance'], 0.05
  end

  def test_the_summary_dates_itself_to_the_minute
    summary = decode('decodeWorkoutSummary', 'ce060039-43e5-11e4-916c-0800200c9a66')

    assert_equal [2026, 8, 31], [summary['year'], summary['month'], summary['day']]
    assert_equal [22, 48], [summary['hours'], summary['minutes']]
    assert_in_delta 33.40, summary['elapsed'], 0.01
    assert_in_delta 100.0, summary['distance'], 0.01
    assert_equal 23, summary['averageStrokeRate']
  end

  def test_two_characteristics_agree_on_the_average_pace_at_different_scales
    status = decode('decodeAdditionalStatus1', 'ce060032-43e5-11e4-916c-0800200c9a66')
    summary = decode('decodeWorkoutSummary', 'ce060039-43e5-11e4-916c-0800200c9a66')

    # 0x0032 counts hundredths, 0x0039 counts tenths. Getting either scale wrong moves the number
    # by a factor of ten, so this is the check that pins both.
    assert_in_delta status['averagePace'], summary['averagePace'], 0.05
  end

  # The one piece of arithmetic the whole rowing cockpit rests on: watts = 2.80 / pace³. If it is
  # wrong, the target split the app shows is wrong, and nothing on the screen would say so.
  def test_the_power_to_split_conversion_matches_what_the_erg_reported
    status = decode('decodeAdditionalStatus1', 'ce060032-43e5-11e4-916c-0800200c9a66')
    stroke = decode('decodeAdditionalStrokeData', 'ce060036-43e5-11e4-916c-0800200c9a66')

    computed = in_page_module(MODULES, 'return rowing.splitFromPower(args[0])', stroke['power'])

    assert_in_delta status['pace'], computed, 1.0
  end

  def test_the_conversion_inverts
    round_trip = in_page_module(
      MODULES,
      'return rowing.powerFromSplit(rowing.splitFromPower(args[0]))',
      213
    )

    assert_in_delta 213, round_trip, 0.0001
  end
end
