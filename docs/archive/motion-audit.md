# Motion curve audit — vs. standard After Effects easing

## 60fps velocity audit (2026-07-08)

Question raised: does the animation actually play the velocity the speed
graph draws? Frame-stepped against a similar curve in AE at 60fps, the
lab's marker seemed off. Full audit, live in the app, `1:2@90°` velocity
read with strength 0.5, duration 1400ms:

**Clock.** `renderController` accumulates real rAF deltas
(`dt = (now − last)/1000`, clamped only at 100ms stall recovery). At a
measured steady 60fps (16.7ms frames) animation time is wall time.

**Proof A — the drawn curve is what plays.** The solid speed path
(240 SVG points, un-mapped to `(p, v)`) against the numerical derivative
of the played LUT (`linear()` export): max deviation 1.8% of peak, mean
0.5%, speed peaks at p=0.707 (drawn) vs 0.717 (played, one bin of the
24-stop export). The solid curve IS the derivative of the motion.

**Proof B — the motion is the curve's integral, frame by frame.** The
ruler circle sampled at rAF cadence for two cycles (110 frames @ 60fps):
max position error vs the LUT 0.0029 of total travel (mean 0.0007);
measured velocity peak at p=0.691 vs 0.707 drawn — within one frame.

**Verdict: the rendered velocity is correct.** What looked wrong was the
instrument: the playhead used to sit at the EASED x (position), while
AE's playhead sweeps TIME. Reading a time chart at a position index made
the marker linger near zero for half the duration and teleport across
the spike — and the dot's height wasn't the current speed. Two further
methodology notes for AE comparisons: the lab holds 600ms at the end of
each loop (AE doesn't), and an eyeballed "similar" AE bezier can't hug
zero speed for 40% of the duration the way a strength-shaped curve does
— position diverges enormously wherever speed is near zero.

**Change:** the playhead (cursor + dot on the curve) now sweeps linear
time, exactly like AE — the dot's height is the current speed. The
circle on the ruler is the object the curve drives (eased), like a layer
in the comp. They meet at both ends of every run.

Audit of the easing generator against the curves motion designers expect
from AE's graph editor, and the changes made to close the gaps while
keeping the Lissajous figure as the generator.

## What the generator is

Every easing is one arc of a Lissajous figure (`ratio X : ratio Y`,
`phase`), read one of two ways:

- **Speed graph** (AE's default editor view): the arc is the velocity
  curve, integrated into position. Time runs at the figure's own trace
  rate — the oscilloscope reading.
- **Value graph**: the figure is read literally as a graph — time is the
  projected x-coordinate. This is what keeps `1:1` exactly linear and
  gives lobed figures their overshoot character.

Two treatments shape the source arc:

- **Strength** — AE keyframe influence: the speed profile raised to a
  power, concentrating travel.
- **Decay** — damping envelope: swings around the target shrink, so lobed
  figures settle instead of returning to the start.

## Findings and fixes

| Finding | Standard behavior (AE/CSS) | Before | Fix |
| --- | --- | --- | --- |
| In-out arch skewed (speed peak at ~75%, midpoint 0.35) | Easy-ease is symmetric: midpoint 0.5 | Time axis used projected x, warping the lobe | Speed read now samples at constant trace rate — the 1:2 arch is exactly `sin(πp)` |
| Ease ramps had nonstandard shape | `sin(πp/2)` / `1 − cos(πp/2)` family | Same x-warp | Same fix — ramps are exact sine-in/out at strength 0 |
| Bounce returned fully to start | Bounces settle with shrinking swings | Raw 1:3 lobe swings to 0 mid-flight | Decay envelope (`1 + (e−1)e^{−kp}`) |
| Motion parked early vs. the time cursor | Eased moves span the full keyframe interval | Spring LUT settled at ~40% of its window | Dead-tail trim on the LUT |
| No ease-in | Trio in / out / in-out | Only out-flavored arcs | `reverse` time-mirror |

**Reference match (verified in tests):** the speed curve is the lobe AS
DRAWN on the figure — y across the lobe's x-sweep — so the marked arc and
the graph are the same shape, skew included. At strength 0 the 1:1 ramps
are the exact quadratic family (EASE OUT ≡ `2p − p²`, EASE IN ≡ `p²`) and
the 1:2 arch peaks early (`2(1−p)√(2p−p²)`, peak ≈ 29%) — the figure's
own character rather than a symmetric textbook bell. STRENGTH (power up
to 6) pushes toward dramatic spiked lobes; ratios up to 12 reach wave and
elastic territory stock AE curves can't express.

## Preset map

| Preset | Figure | Read | Treatment |
| --- | --- | --- | --- |
| LINEAR | 1:1 @ 0° | value | — |
| EASE IN | 1:1 @ 0° | speed | reversed, strength 0.3 |
| EASE OUT | 1:1 @ 0° | speed | strength 0.3 |
| EASE IN-OUT | 1:2 @ 90° | speed | strength 0.35 |
| BOUNCE | 1:3 @ 0° | value | decay 0.55 |
| SPRING | 1:5 @ 0° | value | decay 0.5 |

Motion-system tokens (STANDARD / ENTER / EXIT / EMPHASIS) reuse the same
recipes and export together as CSS custom properties with a duration
scale.

## Display conventions

Everything renders in graph-editor orientation: the source panel plots
the arc as time × value (never the raw figure), ghosts the surrounding
oscillation behind it, and the main plot shows the shaped curve with the
raw source dashed beneath it whenever strength/decay are active.

The speed cursor sweeps **linear time** left-to-right (AE style). The
small dot on the curve is the **current speed** at that time. The large
ruler circle is the **current position** (integral of speed), and the
hash marks are dense **equal-time footprints** of that position — packed
where motion crawls, sparse through the whip.
