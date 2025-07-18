require 'rake/testtask'

task default: :test

Rake::TestTask.new(:test) do |t|
  t.libs << 'test'
  t.pattern = 'test/*_test.rb'
  t.verbose = true
end

task :rubocop do
  sh 'bundle exec rubocop'
end

task 'rubocop:fix' do
  sh 'bundle exec rubocop -a'
end
