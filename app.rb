require 'sinatra'

class App < Sinatra::Base
  set :views, 'views'
  set :public_folder, 'public'

  get '/' do
    erb :index
  end
end
