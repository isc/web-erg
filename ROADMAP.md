# Roadmap

Functional gaps, in the order I would close them. Each one states the evidence it rests on, so a
future reader can check whether it is still true rather than taking it on faith. Nothing here is a
bug — the bugs found in the August 2026 audit are fixed and in `main`.

## ~~1. Never lose a session~~ — done (August 2026)

Samples are written to localStorage every ten seconds while the ride happens, and an interrupted
session is offered for export on the next load. Resuming a workout mid-ride is deliberately not
attempted: the trainer connection, the phase clock and the elapsed time would all have to be
rebuilt, and the thing actually worth saving is the ride data.

## 2. Speak the coaching cues — 1018 of 1378 workouts have them, 2 are heard

`audio-coach.js` already parses the `<textevent>` elements of **every** workout, with their offsets,
and computes when each should fire. It then looks for a pre-generated MP3, and when there is none —
which is almost always — it drops the lot and displays nothing.

- workouts in the library: **1378**
- workouts containing `<textevent>`: **1018**
- workouts with generated audio in `public/audio/`: **2**

The gap exists because each MP3 costs an Inworld API call and a manual run of
`scripts/generate_workout_audio.rb`. The browser's `speechSynthesis` reads text aloud for free,
offline, with nothing to pre-generate. Even without speech, simply **showing** the message on screen
would take coaching from 2 workouts to 1018.

The parsing is already written. This is wiring, not new machinery.

## 3. Show the power target

Cadence has a target and a colour that says whether you are inside it (`getCadenceStatus`). Power —
the point of the whole session — shows a bare number.

In ERG mode the trainer holds the target, so it rarely matters. It matters exactly when it does:
`FreeRide` and `MaxEffort` phases, where nothing is controlled and the rider needs a number to aim
at, and the moments when ERG loses the target. Note that the library's `Freeride` elements carry a
`Target` attribute that is currently parsed by nobody.

Symmetrical with the work already done on cadence.

## 4. A layout that works on a phone

Not a TV mode — the TV is fine. It mirrors a laptop screen that was already being read from a
distance, so the existing layout survives the trip unchanged.

The real gap is the other direction. Chrome on Android is the **only** mobile browser that ships Web
Bluetooth, which means an Android phone can run this app standalone, at the bike, with no laptop and
no mirroring in the loop. Nothing about the current layout suits that:

- The metrics are a four-column `<table>`. On a phone that is four cramped columns, when it should be
  a few large tiles.
- The workout SVG has a 2400-unit viewBox for the whole session. Squeezed into a phone's width, a
  40-second interval in a 50-minute workout is about five pixels — the shape of the session is
  legible, the phase you are in is not. It probably wants a window around the current phase rather
  than the whole ride.
- The library dialog lists 1378 workouts as nested `<details>`, with the duration filters in a row of
  inputs. It is a mouse-shaped thing.
- Tap targets and no hover, throughout.
- Fullscreen and the screen wake lock stop being conveniences: on a phone, a screen that locks takes
  the ride down with it.

The low-battery dialog, on the other hand, finally earns its place — it reads as if it was written
for exactly this.

⚠️ Check first, before designing anything: on Android, Chrome needs the *Nearby devices* permission
and, depending on the Android and Chrome versions, location services switched on, or it will simply
show no devices. Worth confirming on the actual phone that the trainer and the watch are reachable
at all.

## 5. Send to Strava without the file round trip

Today: download a `.tcx`, open Strava, choose the file, type a title. Every single ride.

Strava's API accepts an activity upload directly, and the workout name is right there to use as the
title. This is the largest item — it needs a registered Strava app and a token kept server-side —
but the Sinatra server already exists to hold it, and this is the gesture repeated after every
session.

## 6. Skip or extend a phase

Nothing shortens an interval that is not happening today, and nothing stretches a warm-up. Worse,
**Stop** is final: `WorkoutRunner.stop()` sets `workoutFinished` and there is no way back. A bad
interval currently means either suffering through it or losing the session.

## Smaller, later

- **End-of-session summary** — average power, normalised power, average heart rate, time in zone.
  All of it is already in `workoutSamples`; none of it is ever shown.
- **Follow a plan** — the library ships multi-week plans and the app has no notion of where you are
  in one. Finding "the next one" is done by hand, every time.
- **Guided FTP test** — FTP is typed in by hand and scales every workout's intensity.
