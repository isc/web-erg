# Web ERG Trainer

A web-based trainer application for structured indoor workouts, over Web Bluetooth, on either of two machines: an ERG-mode smart trainer or a Concept2 rowing ergometer. Which one it is is decided on connection, by the machine, and there is no setting to flip.

The two are not symmetrical. A trainer takes a power target and holds it, so the app drives the bike and the rider pedals. A Concept2 has no ERG mode — the load comes from the flywheel and the damper, mechanically — so on a rower the app is a metronome and the rower holds the target. See [ROWING.md](ROWING.md).

## Features

- **Bluetooth Integration**: Connect to smart trainers (ERG mode over FTMS), Concept2 PM5 monitors, and heart rate monitors via Web Bluetooth API
- **Zwift Workout Support**: Load and execute Zwift workout files (.zwo format), extended with distance-based phases so a rowing session can say `8 x 500m`
- **Workout Library**: Browse and select from a comprehensive collection of Zwift workouts organized by training programs, alongside the Concept2 Workout of the Day archive
- **Real-time Metrics**: Display power, cadence and heart rate during a ride; split per 500 m against the target split, deviation, stroke rate and the erg's own distance during a row
- **Visual Workout Display**: Interactive SVG-based workout visualization showing zones and progression
- **Audio Coaching**: AI-generated audio coaching instructions using text-to-speech
- **Session Summary**: Average power, normalised power, average heart rate and time in zone when the workout ends
- **TCX Export**: Export completed workouts as TCX files for upload to training platforms — with the Concept2's measured distance rather than a modelled one, and `Sport="Other"` for a row
- **FTP-based Training**: Workouts automatically scale based on your Functional Threshold Power (FTP), stored separately for rowing — rowing engages far more muscle mass and a cycling FTP does not transpose
- **Responsive Design**: Works on desktop and mobile devices

## Technology Stack

- **Backend**: Ruby with Sinatra framework
- **Frontend**: Vanilla JavaScript with Alpine.js for reactivity
- **Styling**: Pico CSS framework
- **Testing**: Minitest with Capybara for integration tests
- **Bluetooth**: Web Bluetooth API for device connectivity
- **Audio**: AI-generated coaching using Inworld TTS API

## Prerequisites

- Ruby
- Modern web browser with Web Bluetooth support (Chrome, Edge, Opera)
- A Bluetooth smart trainer or a Concept2 with a PM5, and optionally a heart rate monitor

## Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd weberg
```

2. Install dependencies:

```bash
bundle install
```

3. Start the server:

```bash
bundle exec puma
```

4. Open your browser and navigate to `http://localhost:9292`

## Usage

### Basic Workout Flow

1. **Connect Devices**:

   - Click "Connect" to pair your Bluetooth smart trainer
   - Optionally connect a heart rate monitor

2. **Set Parameters**:

   - Enter your FTP (Functional Threshold Power) in watts
   - Enter your weight in kg

3. **Select Workout**:

   - Upload a .zwo file from your computer, or
   - Browse the workout library to select from pre-loaded Zwift workouts

4. **Start Training**:

   - Click "Start" to begin the workout
   - Follow the power targets and visual cues
   - Listen to audio coaching instructions (if available)

5. **Complete Workout**:
   - Export your session as a TCX file for upload to Strava, TrainingPeaks, etc.

### Workout Library

The application includes a comprehensive collection of Zwift workouts organized by training programs:

- FTP Builder programs
- Racing-specific training
- Triathlon preparation
- Gran Fondo training
- Specialty programs (Time Trials, Gravel, Mountain Bike)

### Audio Coaching

The application can generate AI-powered audio coaching instructions for workouts. To use this feature:

1. Set the `INWORLD_API_KEY` environment variable with your Inworld TTS API key
2. Run the audio generation script:

```bash
ruby scripts/generate_workout_audio.rb path/to/workout.zwo
```

## Roadmap

What is missing and in what order, with the evidence behind each item: [`ROADMAP.md`](ROADMAP.md).

## Deployment

Deployed on the **Charras home server** (see the private `isc/home-infra` repo, `charras/SETUP.md`
§15): a `ruby:3.4` container serving the checkout in `/opt/web-erg` on port 8085, published
over HTTPS by Tailscale Funnel at
**<https://charras-server.tailcef78d.ts.net/web-erg/>** — HTTPS is not optional here, Web Bluetooth
only works in a secure context.

Update the deployment with `./deploy.sh` on the box (git pull → `bundle install` → restart).

Because Funnel serves the app under a **sub-path** and strips the prefix before it reaches Sinatra,
the page references its assets **relatively** (`main.css`, `js/main.js`) and a small script in
`views/index.erb` forces the trailing slash. Keep both when adding assets: a root-absolute
`/js/foo.js` works locally and silently 404s in production.

## Development

### Running Tests

```bash
rake test
```

### Code Formatting

```bash
bundle exec rubocop
```

### Adding New Workouts

1. Place .zwo files in the appropriate directory under `public/zwift_workouts_all_collections_ordered_Mar21/`
2. Run the workout parsing script to update the workout library:

```bash
ruby scripts/parse_zwift_workouts.rb
```

## Project Structure

```
├── app.rb                 # Main Sinatra application
├── config.ru              # Rack configuration
├── public/
│   ├── js/                # Frontend JavaScript modules
│   ├── audio/             # Generated workout audio files
│   └── zwift_workouts*/   # Zwift workout collections
├── views/                 # ERB templates
├── scripts/               # Ruby utility scripts
└── test/                  # Test suite
```

## Browser Compatibility

This application requires a modern browser with Web Bluetooth support:

- ✅ Chrome 56+
- ✅ Edge 79+
- ✅ Opera 43+
- ❌ Firefox (Web Bluetooth not supported)
- ❌ Safari (Web Bluetooth not supported)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Run the test suite
6. Submit a pull request

## License

MIT

## Acknowledgments

- Zwift for the workout file format and extensive workout library
- Web Bluetooth API community for making device connectivity possible
- Inworld AI for text-to-speech capabilities
