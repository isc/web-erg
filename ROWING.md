# Porting to a Concept2 rower

Notes taken before writing any rowing code, so the next session starts from what was measured
rather than from what sounded plausible. Everything here rests on numbers that can be re-checked;
where a claim is a hypothesis rather than a measurement, it says so.

## The constraint everything else follows from

**A Concept2 has no ERG mode.** The load comes from the flywheel and the damper, mechanically.
Nothing on the PM5 accepts a resistance target, so there is no counterpart to `setErgPower()`.

The app therefore inverts: today the trainer holds the target and the rider follows; on a rower the
app is a metronome and the rower holds the target. That promotes item 3 of the [roadmap](ROADMAP.md)
— show the power target and the deviation from it — from a comfort to the only feedback that exists.
`WorkoutRunner.currentPowerTarget()` already computes it in one place; it simply stops being
consumed by the Bluetooth layer and starts being consumed by the display alone.

Note that the PM5 *can* be programmed with a workout over its control service (CSAFE), so the
monitor shows its own splits. That is a later refinement, not a substitute: it still does not
control resistance.

## What carries over, and what does not

Carries over unchanged: the `.zwo` pipeline (`phases.js`, interval expansion, `parseZwoMeta`), the
SVG rendering, the cockpit, the wake lock, session persistence and recovery, the end-of-session
summary. Power is the metric both machines share — the PM5 reports watts — so `%FTP → watts` works
as-is, **provided a separate rowing FTP is stored**: rowing engages far more muscle mass and a
cycling FTP does not transpose.

| Bike | Rower |
|---|---|
| Cadence (rpm) | Stroke rate (spm) — same slot, different range, different targets |
| — | **Split /500 m**, the number a rower actually reads: `W = 2.80 / pace³` (pace in s/m), and its inverse to display a target |
| Distance modelled by `virtualSpeedFromPower` | **Real** distance from the PM5 — the whole aero model goes |
| Pause = cadence absent | The PM5 exposes a workout state, and reports power averaged **per stroke** (so ~every 2 s at 30 spm, not continuously) |
| Coggan zones | UT2/UT1/AT/TR/AN bands — `zones.js` is already a single table, to be parameterised |
| TCX `Sport="Biking"` | `Sport="Other"` (the schema allows only Running/Biking/Other); fix the type in Strava after import |

## The Zwift library does not transpose

Measured on what is in this repo (1100 workouts across 1375 `.zwo` files):

| | |
|---|---|
| Median duration | **60 min** (max 300) |
| ≤ 45 min | 272 (25 %) |
| With a cadence target | 535 / 1375 (39 %) |
| With blocks < 30 s | 366 / 1375 (27 %) |
| With a free-ride phase | 225 / 1375 (16 %) |
| **≤ 45 min and no free phase** | **169 (15 %)** |

A median of 60 minutes is a cycling library. Long endurance rides have no rowing equivalent — the
load per minute is much higher (legs, back and arms, plus a catch that has to be paid for). Three
quarters of the catalogue goes on duration alone, and of what survives, the cadence targets are
meaningless in spm and the sub-30-second blocks demand a precision nobody produces by feel once no
ERG is holding it.

Two problems are structural rather than a matter of filtering:

1. **`.zwo` cannot express distance.** Rowing is largely trained in distance — `4×1000 m`,
   `8×500 m`, `5×1500 m`, a 2 km test. The format has only `Duration`. No subset of the library
   contains those sessions, because they are not expressible in it.
2. **Zones are anchored differently.** A rower works from an offset to 2 km split (UT2 ≈ 2k+24 s/500 m,
   UT1 ≈ +16, AT ≈ +10, TR ≈ +5), not from a percentage of FTP. Arithmetically convertible, but the
   boundaries do not land in the same places.

## Survey of existing rowing workout sources (August 2026)

No ready-made machine-readable rowing workout library exists.

| Source | Verdict |
|---|---|
| [ErgZone](https://www.erg.zone/) | Preloads the Concept2 dailies and handles custom workouts, but no documented export or public API ([FAQ](https://help.erg.zone/article/147-concept2-workouts)) — closed ecosystem |
| [ErgData / C2 Logbook](https://www.concept2.com/ergdata) | Logs *results*; stores no workout definitions |
| [intervals.icu](https://forum.intervals.icu/t/intervals-row-a-workout-player-for-concept2-rowers/120499) | Structured workouts, rowing support, a PM5 player in progress — but you author the workouts yourself; no library |
| [OpenRowingMonitor](https://github.com/JaapvanEkris/openrowingmonitor) | A real interval model (distance / SPM / speed targets, **no power targets**) — a good precedent for the format, no catalogue |
| [The Pete Plan](https://thepeteplan.wordpress.com/the-pete-plan/) | Prose on a WordPress blog |

## The corpus that does exist: the Concept2 WOD archive

The Workout of the Day newsletter is addressable by date, in the clear, unauthenticated:

```
https://utilities.concept2.com/wod-email/newsletter/YYYY-MM-DD/en/us
```

Each page carries a title, a one-line description, and the PM5 button sequence. Probed on
2026-08-31:

- **Coverage**: roughly August/September 2022 to today (~1450 days). About **27 % of dates return
  500** — gaps in the archive, not parse failures. The boundary was bisected: `2022-07-01` fails,
  `2022-09-01` succeeds.
- **Natively rowing**: `8 x 500m, 2 minutes rest`, `4 x 1000m / 1 min easy`, pyramids, calorie
  intervals.
- **Highly repetitive**: 52 distinct sessions over 126 sampled days. Extrapolating the collision
  rate across the whole archive puts the distinct set at roughly **85–150 sessions**.
- **Parseable**: a thirty-line prototype converted **48 / 52 (92 %)** into structured phases. The
  four misses are all trivial — a named `Triple Tabata`, a `5 x 1000m` with no explicit rest, a
  dash-separated calorie ladder, and one "equal work and rest" phrasing.

The regular shapes are: `N x <time> / <rest> easy`, `N x <distance>m, <rest> rest`,
`a/b/c minutes with <rest> rest` (ladders and pyramids), `N x <n> Cals`, and single pieces or time
trials.

### The catch

**No WOD carries an intensity target.** "5 × 4 min / 2 min easy" is the whole specification — the
rowing convention is to hold the hardest sustainable pace, not to chase a percentage. The corpus
gives structure and never intensity. Two ways out, still to be decided:

- annotate a target ourselves per interval length, derived from a stored 2 km split (what every
  rowing plan does), or
- display work/rest structure only and let the rower judge — defensible, since no ERG is holding
  anything anyway.

This is not an official API, it is a newsletter template, and it can break. Fetch once, dedupe, and
store the result in the repo alongside the `.zwo` files so nothing depends on it at run time.

## Plan

1. **Probe the PM5 over Bluetooth** — `/probe`, in this branch. Nothing below is worth writing
   before its output is in hand.
2. **A PM5 adapter** plus its mock in `bluetooth_mock.js`, so the rest is testable without the erg.
3. **A rowing cockpit**: target split against actual split, deviation bar, stroke rate, distance.
4. **Summary and export** adapted (real distance, `Sport="Other"`).
5. **The workout format**, extended with distance-based phases, and the WOD archive imported into it.

### Architecture

`bluetooth.js` is already the right seam: it exposes callbacks, not characteristics. Split it into
two adapters — `ergometers/ftms-bike.js` and `ergometers/concept2-pm5.js` — behind one interface,
each declaring its capabilities (`{ controlsPower: false, metrics: [...] }`). The rest of the app
reads that descriptor instead of assuming a bike. The mode is detected on connection, with no
setting to flip: the two machines are never in the same room.

One repository, one app. A separate fork would duplicate the `.zwo` pipeline and the 1378 workouts
to save one indirection.

## PM5 Bluetooth — hypothesis to be confirmed by the probe

The PM5 speaks a **proprietary Concept2 service**, not standard FTMS. Recent firmware is reported to
add FTMS Rower as well; the probe answers that. From the C2 "PM Bluetooth Smart Communication
Interface Definition", base UUID `CE06xxxx-43E5-11E4-916C-0800200C9A66`:

| UUID | What it should be |
|---|---|
| `CE060010-…` | Device information service (`0011` model, `0012` serial, `0014` firmware) |
| `CE060020-…` | Control service — `0021` receive (CSAFE, write), `0022` transmit (notify) |
| `CE060030-…` | Rowing service |
| `CE060031-…` | General status |
| `CE060032-…` / `CE060033-…` | Additional status 1 and 2 |
| `CE060035-…` | Stroke data |
| `CE060036-…` | Additional stroke data |
| `CE060037-…` | Split / interval data |
| `CE06003D-…` | Multiplexed information |

Every row above is from memory and none of it has been checked against hardware. The probe dumps
what is actually there, which is the point of running it first.

The device advertises with a name beginning `PM5`.
