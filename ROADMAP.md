# Roadmap

Functional gaps, in the order I would close them. Each one states the evidence it rests on, so a
future reader can check whether it is still true rather than taking it on faith. Nothing here is a
bug — the bugs found in the August 2026 audit are fixed and in `main`.

## 1. Never lose a session

`workoutSamples` lives only in the Alpine component's memory. A closed tab, a browser crash or a
laptop that falls asleep at minute 45 destroys the whole ride: nothing is written anywhere until
**Export activity** is clicked, at the very end.

Persist samples as they arrive (localStorage is enough — a 90-minute ride is a few hundred kB) and
offer to resume, or at least to export, an interrupted session on the next load.

This is the one to do first: it removes an entire class of silent, unrecoverable loss, and it is
independent of everything else.

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

## 4. A mode legible from across the room

The app is now ridden from a TV, mirrored over AirPlay from a Mac (see `isc/home-infra`,
`charras/SETUP.md` §15). The layout is an HTML table sized for a laptop at arm's length: power,
cadence and heart rate in body text.

Large numbers, phase time remaining large, everything else small.

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
