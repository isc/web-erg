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
- **Installable, and offline**: a web app manifest and a service worker, so it installs to a phone's home screen and a session already loaded keeps running when the Wi-Fi drops. The cache is one whole version at a time, never a mixture of two — see [Deployment](#deployment)

## Technology Stack

- **Backend**: Ruby with Sinatra framework
- **Frontend**: Vanilla JavaScript with Alpine.js for reactivity
- **Styling**: Pico CSS framework
- **Third-party libraries**: vendored under `public/vendor/`, not fetched from a CDN — an app that needs jsdelivr to render is not an app that survives a home Wi-Fi dropping
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
`/js/foo.js` works locally and silently 404s in production. The service worker registration, the
manifest link and every path in the precache list are relative for the same reason.

### What a deploy does to a browser that already has the app

`app.rb` sets `cache_control :no_cache` on every response, because a deploy once left a browser
holding a fresh `main.js` beside a stale `bluetooth.js`: the ES module graph failed to link and the
page rendered black with nothing to say why. The service worker does not weaken that, it sharpens
it:

- `App::VERSION` is a digest of every file that decides what the app is — the assets, the templates,
  and `app.rb` itself. Computed at boot, which on this box is the same thing as at deploy.
- `/sw.js` is generated with that digest and the asset list in it, so a deploy changes its bytes.
  The browser re-fetches it on every navigation and compares it, and `no-cache` keeps that honest.
- Installing a version is one `cache.addAll` over the whole list: it succeeds whole or not at all,
  and the old cache is only deleted once the new one is live. **A page is always built from one
  build**, which the header alone never guaranteed.
- When the new version activates, a tab that is not mid-workout reloads itself; a tab that is
  mid-workout shows a banner and keeps the build it started with, because swapping the code out from
  under a session is worse than one page load.

Adding an asset needs nothing: the list is read off disk. `test/pwa_test.rb` compares it against
what a browser actually loads, so a module that escapes it fails the suite rather than a ride.

### Icons

`public/icons/icon.svg` is the source; `scripts/generate_icons.sh` rasterises the PNGs the manifest
declares. Run it after editing the SVG and commit the output.

## Development

### Running Tests

```bash
rake test
```

The suite runs one headless Chrome per lane, `min(nproc, 8)` of them by default. `MT_CPU=1` puts it
back on a single browser, which is the way to read a failure.

There is no Ruby on the Charras server, and the stock `ruby:3.4` image has no Chrome. `Dockerfile.test`
is the image that has both:

```bash
docker build -f Dockerfile.test -t web-erg-test .
docker run --rm -v "$PWD":/app -w /app -e BUNDLE_PATH=/app/vendor/bundle -e CI=true \
  web-erg-test bash -lc "bundle exec rake test"
```

`CI=true` is what passes `--no-sandbox`; without it Chrome will not start as root in a container.

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
│   ├── vendor/            # Alpine, Pico and html2canvas, pinned and served from here
│   ├── icons/             # App icon, and the PNGs generated from it
│   ├── audio/             # Generated workout audio files
│   ├── manifest.webmanifest
│   └── zwift_workouts*/   # Zwift workout collections
├── views/                 # ERB templates, including service_worker.js.erb, served as /sw.js
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
