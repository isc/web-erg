# Roadmap

Functional gaps, in the order I would close them. Each one states the evidence it rests on, so a
future reader can check whether it is still true rather than taking it on faith. Nothing here is a
bug — the bugs found in the August 2026 audit are fixed and in `main`.

## ~~1. Never lose a session~~ — done (August 2026)

Samples are written to localStorage every ten seconds while the ride happens, and an interrupted
session is offered for export on the next load. Resuming a workout mid-ride is deliberately not
attempted: the trainer connection, the phase clock and the elapsed time would all have to be
rebuilt, and the thing actually worth saving is the ride data.

## 2. Speak the coaching cues — two answers, neither finished

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

**Since August 2026 there is a second answer, and the two have not been reconciled.** A workout
opened from the library now goes to an LLM coach instead: `POST /llm_coach` sends the athlete's live
state and the workout's own ZWO to a model, every fifteen seconds between the first pedal stroke and
the last, and speaks whatever comes back through Inworld. It covers all 1378 workouts, and it talks
about the phase coming next rather than only the cue written for this one — at two paid API calls per
poll, online only.

That leaves the text-event path as the fallback for a file the rider dropped in, which is exactly the
case that has no pre-generated audio either. Those rides are still silent, and `speechSynthesis` is
still the cheap answer for them.

What the coach itself still gets wrong:

- **Ramps.** It reads a ramp as a single target and says so, when the point of the phase is that the
  number is moving, and in which direction. The state now carries the phase object whole, so
  `powerLow`/`powerHigh` and the cadence pair are in front of it; whether that is enough has not been
  checked.
- **The workout is never introduced.** The description sits in the ZWO and is read on screen before
  the start, never aloud. Reading it at the gun, and using the warm-up — the one phase with time to
  listen — to say what the session holds, is the part a rider wants before the first interval rather
  than during it.

## 3. Show the power target — partly done

Cadence has a target and a colour that says whether you are inside it (`getCadenceStatus`). Power —
the point of the whole session — shows a bare number.

In ERG mode the trainer holds the target, so it rarely matters. It matters exactly when it does:
`FreeRide` and `MaxEffort` phases, where nothing is controlled and the rider needs a number to aim
at, and the moments when ERG loses the target. Note that the library's `Freeride` elements carry a
`Target` attribute that is currently parsed by nobody.

The cockpit does this on a phone, and `WorkoutRunner.currentPowerTarget()` is now the one place the
target is computed — the same call ERG sends. What remains is the wide-screen table, which still
shows a bare number, and the deviation bar sketched in the design.

## ~~4. A layout that works on a phone~~ — done (August 2026)

Below 640px the metrics table gives way to a cockpit: the seconds left in the phase, large enough to
read at arm's length and tinted with the phase's zone colour; power, cadence and heart rate demoted
to a row; a strip naming the phase after this one; and the workout graph kept at a readable scale in
a horizontal scroller that recentres itself whenever the phase changes. One layout, no switch — only
the countdown's own formatting adapts, `23` under a minute and `12:47` above.

Wide screens keep the table unchanged: it is read from a laptop, or mirrored to a TV, and it works
there.

Two things fell out of it. The power target a phase asks for is now computed in one place and shown
(part of item 3 above). And on a phone the workout's title and description used to take the top 40 %
of the screen, pushing the countdown below the fold — both are read before starting, so during the
ride the name alone is enough.

⚠️ **A watch will connect, name itself, and then say nothing while Garmin Connect holds it.**
Confirmed on a Pixel with a Forerunner 970 (August 2026): the phone is already paired to the watch
for Garmin Connect, so the watch is in touch with it *as a watch*, and refuses to serve its broadcast
stream to a second client on the same device. Every step succeeds — GATT connect, service discovery,
subscribing — and no notification ever arrives. Force-stop Garmin Connect and the readings appear
immediately. A dedicated strap has no such conflict.

Android may also want the *Nearby devices* permission, and location services on depending on
versions, before Chrome shows any device at all.

## Known duplication — pay it when you next touch the metrics

`views/workout_display.erb` renders the same four values twice: the cockpit for phones, the table
for wide screens, with CSS deciding which is visible. Six bindings are duplicated (`power`,
`cadence`, `heartRate`, `timer`, `getCadenceStatus`, `phaseProgress`) across about 79 lines.

**Not worth fixing for speed.** Both copies re-evaluate on every Bluetooth notification, one to four
times a second — a `parseFloat` and a few text writes. It is waste, and it is imperceptible.

**Worth fixing when the two can start to drift**, which is the moment a metric is added or changed:
the same value would then have to be edited in two places, silently. That is the failure this repo
has already had twice, in the phase expansion and in the phase countdown.

Note that gating the two blocks with `x-if` and a `matchMedia` flag — the obvious move — does not
fix this. It conditions the duplicated markup rather than removing it, and it moves the breakpoint
out of CSS into JS, where rotation and resize become the app's problem. The fix that works is one
markup both widths share, differing only in stylesheet — which means reworking the wide layout, the
one that currently earns its keep on the TV.

## 5. Send to Strava without the file round trip

Today: download a `.tcx`, open Strava, choose the file, type a title. Every single ride.

Strava's API accepts an activity upload directly, and the workout name is right there to use as the
title. This is the largest item — it needs a registered Strava app and a token kept server-side —
but the Sinatra server already exists to hold it, and this is the gesture repeated after every
session.

The rides also arrive as a plain ride rather than a **Virtual Ride**, which is what an hour on a
controlled trainer is. That distinction may need `.fit` rather than `.tcx`, which decides what the
exporter has to produce — so it is worth settling before the upload is built, not after.

## 6. Skip or extend a phase

Nothing shortens an interval that is not happening today, and nothing stretches a warm-up. Worse,
**Stop** is final: `WorkoutRunner.stop()` sets `workoutFinished` and there is no way back. A bad
interval currently means either suffering through it or losing the session.

## ~~End-of-session summary~~ — done (August 2026)

The completed panel now says what the ride was: average power, normalised power, average heart rate
and time in zone, the last as a bar in the graph's own colours with a legend under it. One markup
for both widths — the panel is read standing still, so a phone and a TV want the same thing, and it
adds nothing to the duplication noted above.

Three things were decided along the way, all in `session-summary.js`:

- **Samples are not one per second.** `addOrUpdateSample` starts a new one only once 1.5 s has
  passed, so averaging the samples themselves would weight a reading held for four seconds like one
  held for two. Every metric is computed from a one-second grid built by holding each reading for as
  long as it stood.
- **A reading stands in for five seconds at most.** Past that the rider stopped — a pause, a dropped
  trainer — and the rest of the gap is counted as nothing rather than as more seconds at the last
  wattage seen. A one-minute pause used to be worth a full minute of phantom work.
- **Normalised power is null under thirty seconds**, the width of the rolling window it is defined
  on. A number taken from a shorter window would not be normalised power.

Time in zone counts through `zoneFor()` in the new `zones.js` — the same lookup, over the same
table, that colours the workout graph. The bands used to be a ladder of ifs inside the SVG renderer;
sharing the numbers alone would not have been enough, since the rule for reading them (ascending,
exclusive upper bound) would then have existed twice.

Not done: the **recovered session** offered on the next load still only offers export. Its stored
samples would summarise fine, but the FTP that was in force during that ride is not saved with them,
and time in zone computed against today's FTP would be quietly wrong.

## Smaller, later

- **Let a missing reading be `null`** — `bluetooth.js` invents `'-'` for "the device said nothing",
  a *display* string that then travels into `workoutSamples` and out to every consumer: `main.js`
  compares against it to pause the ride, `tcx-export.js` tests for it three times, and the summary
  reads it through `reading()` in `utils.js`. That helper is the one place the question is now
  answered, and the other consumers still answer it for themselves. Reporting `null` from the device
  layer and formatting it as `-` at the binding would collapse all of them — but a session persisted
  before the change still holds `'-'` in localStorage, so the old spelling has to survive somewhere
  regardless. Pay it when the next consumer of a sample appears.
- **Follow a plan** — the library ships multi-week plans and the app has no notion of where you are
  in one. Finding "the next one" is done by hand, every time.
- **Guided FTP test** — FTP is typed in by hand and scales every workout's intensity. A ride that
  finishes well under the heart rate its wattage should have cost is evidence the number has gone
  stale, and the summary already computes both halves of that comparison; it could say so, and offer
  the new number, without anyone riding a test at all.
- **Warn about the strap before it dies, not after** — the battery level is read once at connect
  time and shown in the button label, and nothing ever looks at it again. A strap that quits
  mid-session takes the heart rate half of the ride with it. The moment that warning is worth
  something is the end of a ride, when there is time to charge it, rather than the start of the next.
- **Say how close the ride was to what was asked** — the summary says what the ride *was*: average
  power, normalised power, time in zone. It does not say whether it matched the workout. In ERG the
  power half is nearly free, since the trainer holds the target; the honest score lives in the
  cadence targets and in the `FreeRide` and `MaxEffort` phases, where nothing is controlled and the
  rider is the only thing deciding.
- **Ask the rider who they are** — the coach greets Ivan because `app.rb` hard-codes the name into
  the system prompt. Anyone else who rides is called Ivan too. Storing it is the easy half; the
  prompt also has to carry how it is *said*, since the name goes to a text-to-speech engine that will
  otherwise guess.

## Further out

Neither of these rests on evidence yet — they are ideas about what an indoor ride could be, kept
here so they are not lost.

- **Music that follows the cadence** — generated ambience whose beat tracks the cadence the phase is
  asking for, so the rider pedals to the music instead of to a number. The target is already computed
  every second by `getCurrentCadenceTarget()`.
- **The camera as an input** — the device is already sitting in front of a rider with nothing to do
  with their hands. "Give me a V" at the end of a hard interval, or a smile the coach reacts to, is a
  different kind of feedback than a number going up.
