require_relative 'test_helper'

# The runner and the SVG each used to expand phases their own way, and disagreed about which tags
# exist: 40 of the workouts shipped in public/ contain a tag the runner dropped on the floor.
class PhasesTest < CapybaraTestBase
  MODULES = {
    phases: '/js/phases.js',
    workout: '/js/workout.js',
    utils: '/js/utils.js'
  }.freeze

  def expand(xml)
    in_page_module(
      MODULES,
      'return phases.expandPhases(workout.parseZwoPhases(utils.parseXmlDoc(args[0])))',
      xml
    )
  end

  def test_keeps_phases_whose_tag_the_runner_used_to_drop
    expanded = expand(File.read(File.expand_path('Mixed_And_Unusual.zwo', __dir__)))

    assert_equal 4, expanded.length
    assert_equal 180, (expanded.sum { |phase| phase['duration'] })
  end

  def test_undocumented_tags_carry_no_erg_target
    expanded = expand(<<~XML)
      <workout_file><workout>
        <MaxEffort Duration="30"/>
        <SteadyState Duration="60" Power="0.7"/>
      </workout></workout_file>
    XML

    assert expanded[0]['freeRide'], 'MaxEffort must not impose a power target'
    refute expanded[1]['freeRide'], 'SteadyState must impose a power target'
  end

  def test_alternate_spellings_are_canonicalised
    expanded = expand(<<~XML)
      <workout_file><workout>
        <cooldown Duration="30" PowerLow="0.6" PowerHigh="0.3"/>
        <Freeride Duration="20"/>
        <SolidState Duration="10" Power="0.5"/>
      </workout></workout_file>
    XML

    assert_equal 'Ramp', expanded[0]['type']
    assert_equal 'FreeRide', expanded[1]['type']
    assert_equal 'SteadyState', expanded[2]['type']
  end
end
