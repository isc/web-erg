# Web ERG Trainer

A web-based ERG (Electronically Controlled Resistance) trainer application that allows cyclists to perform structured workouts using Zwift workout files (.zwo) with Bluetooth-enabled smart trainers and heart rate monitors.

## Features

- **Bluetooth Integration**: Connect to smart trainers (ERG mode) and heart rate monitors via Web Bluetooth API
- **Zwift Workout Support**: Load and execute Zwift workout files (.zwo format)
- **Workout Library**: Browse and select from a comprehensive collection of Zwift workouts organized by training programs
- **Real-time Metrics**: Display power, cadence, and heart rate data during workouts
- **Visual Workout Display**: Interactive SVG-based workout visualization showing zones and progression
- **Audio Coaching**: AI-generated audio coaching instructions using text-to-speech
- **TCX Export**: Export completed workouts as TCX files for upload to training platforms
- **FTP-based Training**: Workouts automatically scale based on your Functional Threshold Power (FTP)
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
- Bluetooth-enabled smart trainer and/or heart rate monitor

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

   - Click "Connecter" to pair your Bluetooth smart trainer
   - Optionally connect a heart rate monitor

2. **Set Parameters**:

   - Enter your FTP (Functional Threshold Power) in watts
   - Enter your weight in kg

3. **Select Workout**:

   - Upload a .zwo file from your computer, or
   - Browse the workout library to select from pre-loaded Zwift workouts

4. **Start Training**:

   - Click "Démarrer" to begin the workout
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
