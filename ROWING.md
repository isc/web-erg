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
control resistance — and it caps out early (see [Programming the monitor](#programming-the-monitor-csafe)).

Standard FTMS is not an alternative route: it has **no structured-workout push at all**. That is
first-hand from the OpenRowingMonitor lead developer, who implements both protocols
([forum.intervals.icu, post #23](https://forum.intervals.icu/t/intervals-row-a-workout-player-for-concept2-rowers/120499/23)).
Whatever guidance the app gives, it gives on its own screen.

**Measured, not deduced.** The probe settled it on the hardware: this PM5 *does* expose FTMS Rower,
and it advertises `Target Setting Features = 0x00000000` with no Control Point characteristic at
all. There is nothing to write to. See [`probe-reports/FINDINGS.md`](probe-reports/FINDINGS.md).

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
| Pause = cadence absent | The PM5 exposes a workout state, and reports power averaged **per stroke** (so ~every 2 s at 30 spm, not continuously) — with its own idea of what counts as rest, see [Reporting quirks](#reporting-quirks-to-design-around) |
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

   There is a second-order problem underneath: a rowing FTP is normally *derived from a 2 km time*,
   a ~6–7 minute effort, whereas the cycling notion assumes 30–60 minutes of time-to-exhaustion.
   The two are not the same quantity, and %FTP targets built on the cycling assumption come out too
   hard at and below threshold. A coach in the thread ships a correction for exactly this, calling
   it "Power EQ" ([post #34](https://forum.intervals.icu/t/intervals-row-a-workout-player-for-concept2-rowers/120499/34));
   he gives no formula. If we scale `%FTP → watts` at all for rowing, this is the place, and it
   needs its own calibration rather than a borrowed constant.

   **What was done instead.** `zones.js` still holds the Coggan table, unchanged. Converting the
   bands would need exactly the calibration nobody has published, and a rowing zone table built on
   a borrowed constant would be worse than an honest cycling one that is labelled as such. The
   separate rowing FTP *is* stored — that part was not optional, since a cycling FTP makes rowing
   targets unrowable — and the WOD targets are anchored on the 2 km directly (see below), which
   sidesteps the problem rather than solving it. A zone table anchored on a stored 2 km split, the
   way every rowing plan states them, is the honest next step and is not in this work.

## Survey of existing rowing workout sources (August 2026)

No ready-made machine-readable rowing workout library exists.

| Source | Verdict |
|---|---|
| [ErgZone](https://www.erg.zone/) | Preloads the Concept2 dailies and handles custom workouts, but no documented export or public API ([FAQ](https://help.erg.zone/article/147-concept2-workouts)) — closed ecosystem |
| [ErgData / C2 Logbook](https://www.concept2.com/ergdata) | Logs *results*; stores no workout definitions |
| [intervals.icu](https://forum.intervals.icu/t/intervals-row-a-workout-player-for-concept2-rowers/120499) | Structured workouts, rowing support, a PM5 player in progress — but you author the workouts yourself; no library |
| [OpenRowingMonitor](https://github.com/JaapvanEkris/openrowingmonitor) | A real interval model (distance / SPM / speed targets, **no power targets**) — a good precedent for the format, no catalogue. Also the best PM5 documentation and a PM5 emulator, see below |
| [Ride Cave](https://ridecave.com) | Closest architectural precedent: browser-based, Web Bluetooth straight to the trainer, intervals.icu-integrated, free, no install. Cycling today; the author says rowing is planned. Not known to be open source |
| [The Pete Plan](https://thepeteplan.wordpress.com/the-pete-plan/) | Prose on a WordPress blog |

## The corpus that does exist: the Concept2 WOD archive

The Workout of the Day newsletter is addressable by date, in the clear, unauthenticated:

```
https://utilities.concept2.com/wod-email/newsletter/YYYY-MM-DD/en/us
```

Each page carries a title, a one-line description, and the PM5 button sequence. Probed on
2026-08-31:

- **Coverage**: roughly August/September 2022 to today (~1460 days). The boundary was bisected:
  `2022-07-01` fails, `2022-09-01` succeeds. Fetching the whole range settled the rate: **315 dates
  answer and 1146 return 500**, so it is four dates in five missing rather than one in four as an
  early sample suggested. Gaps in the archive, not parse failures.
- **Natively rowing**: `8 x 500m, 2 minutes rest`, `4 x 1000m / 1 min easy`, pyramids, calorie
  intervals.
- **Highly repetitive**: **71 distinct sessions across all 315 available days**. The extrapolation
  from a 126-day sample put it at 85–150; the whole archive is smaller than that, because the WOD
  repeats more heavily than the sample showed.
- **Parseable**: the shipped importer converts **63 / 71 (89 %)**. The eight misses are seven
  calorie workouts, which have no phase in this app to be, and `Triple Tabata`, whose structure is
  in its prose rather than its title.

The regular shapes are: `N x <time> / <rest> easy`, `N x <distance>m, <rest> rest`,
`a/b/c minutes with <rest> rest` (ladders and pyramids), `N x <n> Cals`, and single pieces or time
trials.

### The catch, and what was decided

**No WOD carries an intensity target.** "5 × 4 min / 2 min easy" is the whole specification — the
rowing convention is to hold the hardest sustainable pace, not to chase a percentage. The corpus
gives structure and never intensity.

The choice was between annotating a target ourselves and displaying structure only. **Annotating
won**, because on a Concept2 the gap between a target split and the actual one *is* the feedback
loop — there is no ERG mode behind it — and a corpus with no targets leaves the cockpit with
nothing to show.

The rule is **Paul's Law**, not an invented constant: pace per 500 m slows about five seconds for
each doubling of distance. Anchored on a 2 km reference — which is what a rowing FTP is anchored on
too — it turns a piece's length into a fraction of 2 km power, which is exactly what a `.zwo`
`Power` attribute already means. A 2000 m piece comes out at 1.00 by construction, 500 m repeats at
1.32, a 30-minute time trial at 0.77.

Two limits worth knowing:

- the fraction depends slightly on *whose* 2 km it is. A 1:45 rower and a 2:00 rower do not scale
  identically, which moves a 500 m target by about four per cent — inside the noise of holding a
  split by feel, but it is an approximation and not an identity;
- Paul's Law is stated from 500 m to 10 km. The twenty-second sprints are extrapolation, and the
  importer clamps them to 1.8 × rather than trusting the formula out there.

This is not an official API, it is a newsletter template, and it can break. `scripts/import_c2_wod.rb`
fetches once into a gitignored cache, dedupes, and writes `.zwo` files into `public/rowing_workouts/`
that are committed, so nothing depends on that server at run time.

## Plan

All five steps are done. What each turned into, and where it differs from what was planned, is in
the commit messages; what could not be checked without the machine is at the end of this file.

1. ~~**Probe the PM5 over Bluetooth**~~ — done. `probe-reports/FINDINGS.md` is the result, and it
   overrides anything above that disagrees with it.
2. ~~**A PM5 adapter**~~ plus its mock in `bluetooth_mock.js`, so the rest is testable without the erg.
   Second target for the same adapter: **OpenRowingMonitor**, which emulates a PM5 as a real BLE
   peripheral. A mock exercises our own parsing against our own assumptions; ORM exercises it
   against an independent implementation of the protocol, over a real radio. Its author offered to
   test the app against ORM ([post #23](https://forum.intervals.icu/t/intervals-row-a-workout-player-for-concept2-rowers/120499/23)).
3. ~~**A rowing cockpit**~~: target split against actual split, deviation bar, stroke rate, distance.
4. ~~**Summary and export**~~ adapted (real distance, `Sport="Other"`).
5. ~~**The workout format**~~, extended with distance-based phases, and the WOD archive imported.

### Architecture

`bluetooth.js` is already the right seam: it exposes callbacks, not characteristics. Split it into
two adapters — `ergometers/ftms-bike.js` and `ergometers/concept2-pm5.js` — behind one interface,
each declaring its capabilities (`{ controlsPower: false, metrics: [...] }`). The rest of the app
reads that descriptor instead of assuming a bike. The mode is detected on connection, with no
setting to flip: the two machines are never in the same room.

One repository, one app. A separate fork would duplicate the `.zwo` pipeline and the 1378 workouts
to save one indirection.

## PM5 Bluetooth

The PM5 speaks a **proprietary Concept2 service**, not standard FTMS. Recent firmware is reported to
add FTMS Rower as well; the probe answers that. The device advertises with a name beginning `PM5`.

### The documentation exists, and it is not ours to write

Concept2 publishes the protocol as two public PDFs, no account needed:

- [PM5 Bluetooth Smart Interface Specification](https://www.concept2.co.uk/files/pdf/us/monitors/PM5_BluetoothSmartInterfaceDefinition.pdf), rev 1.30
- [PM CSAFE Communication Definition](https://www.concept2.co.uk/files/pdf/us/monitors/PM5_CSAFECommunicationDefinition.pdf), rev 0.27

More useful still, OpenRowingMonitor documents the protocol *as observed on the wire* — Bluetooth
traces, field-by-field, plus the behaviours the spec leaves ambiguous:
[`docs/PM5_Interface.md`](https://github.com/JaapvanEkris/openrowingmonitor/blob/main/docs/PM5_Interface.md).
It also lists which characteristics ErgZone and EXR actually subscribe to, which is a free
priority list for the adapter.

Characteristics, from that document (short IDs; the base UUID
`CE06xxxx-43E5-11E4-916C-0800200C9A66` is still from memory and the probe confirms it):

| ID | What it carries | When it fires |
|---|---|---|
| `0x0031` General Status | Workout state, interval type, elapsed, distance | every broadcast interval |
| `0x0032` Additional Status | | every broadcast interval |
| `0x0033` Additional Status 2 | | every broadcast interval |
| `0x003E` Additional Status 3 | | every broadcast interval |
| `0x0035` Stroke Data | | end of drive, and again end of recovery |
| `0x0036` Additional Stroke Data | | end of drive |
| `0x003D` Force Curve Data | | end of drive |
| `0x0037` Split Data | | end of split |
| `0x0038` Additional Split Data | | end of split |
| `0x0039` Workout Summary | | end of workout |
| `0x003A` Additional Workout Summary | | end of workout |
| `0x003F` Logged Workout | | end of workout |

Two corrections to what this file previously guessed: `0x003D` is the **force curve**, not
multiplexed information, and the whole `0x0038`–`0x003F` range — split, summary and logged-workout
messages — was missing. The force curve is per-stroke and free; nothing in the app consumes it
today, but it is the one rowing metric with no cycling equivalent.

### Programming the monitor (CSAFE)

The sequence to push a workout, per interval, is a string of commands closed by
`CSAFE_PM_SET_SCREENSTATE`:

```
CSAFE_PM_SET_WORKOUTINTERVALCOUNT
CSAFE_PM_SET_WORKOUTTYPE
CSAFE_PM_SET_INTERVALTYPE
CSAFE_PM_SET_WORKOUTDURATION
CSAFE_PM_SET_RESTDURATION
CSAFE_PM_CONFIGURE_WORKOUT
```

**The monitor accepts at most 50 intervals.** That figure comes from the forum thread, not from a
measurement here, and it is the reason the app in that thread exists at all: an over-under or a
Ronstadt session runs to 80+ intervals and simply cannot be loaded. Our own WOD corpus stays well
under 50, so the ceiling is not binding for step 5 — but it does mean CSAFE can never be the app's
only way of expressing a workout.

Interval types are `distance`, `time` and `calories`. Note the structural mismatch: a PM5 workout is
either *one* piece with identical splits, or *several* intervals of varying length with no splits
inside them. Our phase model, which nests freely, does not map onto that one-to-one.

### Reporting quirks to design around

From ORM's traces — these are behaviours, not fields, and they are the kind of thing a probe run
will not reveal on its own:

- **Splits are reported late.** The PM5 sends a split summary *after* the split has ended, i.e.
  already inside the next one. The cockpit must not read that as the new split's data.
- **Rest is an attribute of an interval, not an entity.** When a planned pause starts, the PM5 emits
  no split report; the rest data arrives folded into the report that closes the interval.
  `0x0031`'s interval type flips to `INTERVALTYPE_REST` while `0x0037` still says `INTERVALTYPE_DIST`.
- **Unplanned pauses do not exist.** Stop rowing mid-piece and the PM5 keeps the clock running, does
  not change split, and counts the whole thing as *moving* time. Our summary and TCX export decide
  whether to reproduce that or to correct it; ErgData and the C2 logbook reproduce it, so a
  corrected number will not match what the rower sees elsewhere.

### What the probe is still for

The documentation above is third-party and vendor PDFs, not this hardware. The probe answers: which
services this firmware actually exposes, whether FTMS Rower is among them, the real broadcast
interval, and whether the base UUID above is right. It stays step 1.

---

## What still needs a human on the erg

Everything below was written without a Concept2 in the room. The mock replays the frames the machine
sent on 31 August 2026, so the decoder is tested against real bytes — but a replay of seventy-three
seconds proves what it proves and no more. These are the claims that a session on the machine would
confirm or destroy, roughly in the order they would break a ride.

**The connection, over an hour.** The probe held the link for nine minutes, six of them idle, and
did not drop. An hour-long session is a different question, and so is what happens when it does drop:
`reconnect()` is exercised by nothing here, because the mock has no way to disconnect. Watch the
device log for `⚠️ Device disconnected` and see whether it comes back.

**Whether the app notices you have stopped.** The adapter decides that rowing has stopped when no
stroke has arrived for six seconds *and* stroke rate is not already zero. Six seconds is two missed
strokes at a slow rate; it was chosen, not measured. If the session pauses while you are still
rowing, it is too short; if a real break takes ten seconds to register, it is too long.

**Whether the 1 Hz status characteristics speak mid-piece.** They did not in the capture — `0x0031`
and `0x0032` were silent between the start and the end of the 100 m piece, which is why distance is
also taken from Stroke Data. If that silence was an artefact of the probe rather than the machine,
stroke rate on the cockpit will be steadier than these notes expect. If it was real, stroke rate
updates only at the ends of a piece and something else has to feed it.

**Whether a distance phase ends when it should.** The runner advances on the erg's own count and
never on the clock, which is right, but the whole path has only ever been exercised over a 100 m
replay. Row `8 x 500m, 2 minutes rest` and check that the eighth piece is the eighth.

**Whether the targets are sane to row.** Paul's Law against a 2 km reference of 1:52 gives 1.32 ×
FTP for 500 m repeats and 0.77 × for a 30-minute piece. The numbers are internally consistent; that
does not make them the right session. The reference is a constant in `scripts/import_c2_wod.rb`
and the rowing FTP is a field on the form — if the targets come out uniformly hard or soft, the FTP
is the thing to move first, and only then the reference.

**Whether the cockpit is legible mid-piece.** The split leads, the deviation bar is centred on the
target, and both were designed at a desk. Ten seconds per 500 m as full scale on the bar is a guess.
So is which of the five metrics deserve the two columns a phone gives them.

**Whether the exported file is what Strava expects.** The TCX validates against the schema and the
distance is the erg's own, but no rowing file from this app has been uploaded anywhere. `Sport` is
`Other`, which has to be corrected to Rowing after import.

**Not implemented, deliberately.** CSAFE — nothing is ever written to `0x0021`, so the PM5 shows its
own workout and not ours. The force curve on `0x003D` and `0x0043` is decoded nowhere; it is the one
rowing metric with no cycling equivalent and nothing consumes it yet. And `0x0033`'s corrected
`Last Split Time` scale is recorded in FINDINGS but not in code, because no screen needs it.
