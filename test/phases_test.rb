require_relative 'test_helper'

# The runner and the SVG each used to expand phases their own way, and disagreed about which tags
# exist: 40 of the workouts shipped in public/ contain a tag the runner dropped on the floor.
class PhasesTest < ModuleTestBase
  include PhaseExpansion

  def test_keeps_phases_whose_tag_the_runner_used_to_drop
    expanded = expand(File.read(File.expand_path('Mixed_And_Unusual.zwo', __dir__)))

    assert_equal 4, expanded.length
    assert_equal 180, (expanded.sum { |phase| phase['duration'] })
  end

  def test_undocumented_tags_carry_no_erg_target
    expanded = expand(zwo('<MaxEffort Duration="30"/><SteadyState Duration="60" Power="0.7"/>'))

    assert expanded[0]['freeRide'], 'MaxEffort must not impose a power target'
    refute expanded[1]['freeRide'], 'SteadyState must impose a power target'
  end

  def test_alternate_spellings_are_canonicalised
    expanded = expand(zwo(<<~XML))
      <cooldown Duration="30" PowerLow="0.6" PowerHigh="0.3"/>
      <Freeride Duration="20"/>
      <SolidState Duration="10" Power="0.5"/>
    XML

    assert_equal 'Ramp', expanded[0]['type']
    assert_equal 'FreeRide', expanded[1]['type']
    assert_equal 'SteadyState', expanded[2]['type']
  end
end
