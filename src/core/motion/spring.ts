// The motion system's easing family is a damped harmonic oscillator:
//   x'' = -ω²(x - 1) - 2ζω x'
// The Lissajous curve is an undamped 2D oscillator; this is its damped 1D
// sibling — one sine family drives both the structure and the motion.
// ζ ≥ 1 gives smooth eases, ζ < 1 overshoots into spring/bounce territory.

import { META_ASPECT, META_HARMONICS, META_PHASE } from '@/core/lissajous/equation'

export type SpringParams = {
  stiffness: number // ω (rad/s)
  damping: number // ζ
  initialVelocity: number // in target-distances per second, normalized
}

// An arc of a Lissajous figure can be read two ways, matching AE's two
// graph editors:
//   position — the arc IS the value graph (y over the x-sweep)
//   velocity — the arc IS the speed graph (an arch = ease speed bump);
//              integrating it gives the position curve
export type EasingRead = 'position' | 'velocity'

export type MotionRecipe = {
  ratioX: number
  ratioY: number
  phase: number
  read: EasingRead
  reverse?: boolean // time-mirror: turns an ease-out ramp into an ease-in
  strength?: number // 0..1 — AE-style influence: powers the speed profile
  decay?: number // 0..1 — damping envelope: oscillations settle into the
  // target instead of swinging all the way back (fixes bounce/spring)
  lobe?: number // index into enumerateLobes(); -1/undefined = auto-pick
  half?: 'full' | 'rise' | 'fall' // take one side of the arc, split at its peak
  shape?: FigureShape // smooth warp of the y-oscillation; neutral = classic
}

// THE FIGURE DESIGN SPACE: the classic Lissajous is one point in a
// continuous family of smooth warps of the y-oscillation. The legacy
// Meta-inspired centerline is another point; it is not logo geometry.
// Every warp is C-infinity, preserves bilateral symmetry and the single
// closed loop, and — crucially — keeps y's zeros EXACTLY at u = mπ, the
// same as pure sine, so lobe cutting, halves and the speed-curve
// machinery stay analytic and stable across the whole space.
//
//   waist    0..1  — v = u + w·sin(2u): the wave rushes through its
//                    zeros (narrow crossover) and lingers at its peaks
//                    (flat, full lobes).
//   bias    −1..1  — v = v − β·sin(v): pulls both extrema toward (or
//                    away from) the crossing, tilting the lobes' mass.
//   lean    −1..1  — v = v − λ·sin(v)·(1+cos v)/2: the same pull applied
//                    to the TOP half only — the humps lean independently
//                    of the bottoms.
//   cross   −1..1  — y = sin(v) + c·sin²(v/2): lifts (or drops) the
//                    figure-eight's crossing while both caps stay pinned
//                    at zero — the vertical asymmetry of the Meta mark.
//   fullness 0..1  — soft saturation (tanh): flattens the arcs, fills
//                    the loops.
//   morph    0..1  — blends the base oscillation from the pure sine
//                    toward the Meta profile (a fixed 3-harmonic Fourier
//                    signature fitted to the mark). 0 = classic, 1 = Meta;
//                    every other dial composes on top at any blend.
// All parameter warps are monotone (clamped ranges), so the loop stays
// single and closed, curvature stays continuous, and the speed machinery
// stays stable across the whole space.
export type FigureShape = {
  waist: number
  fullness: number
  bias: number
  lean: number
  cross: number
  morph?: number
}

export const CLASSIC_SHAPE: FigureShape = { waist: 0, fullness: 0, bias: 0, lean: 0, cross: 0, morph: 0 }
// The legacy centerline was fitted numerically from the former 20x14 asset
// (rasterized, then per-column ribbon midpoints for
// the body plus per-row midpoints around the outer caps) and a 3-harmonic
// profile least-squares fitted as point-to-curve distance. The decisive
// parameter is PHASE ≈ 108.6° — the mark's lobes are tilted — plus the
// harmonic signature below (raised crossing, full round bottoms, slightly
// peaked tops). Weighted mean fit distance ≈ 0.7% of the half-width.
// META_ASPECT is the drawing's height/width at the fitted point.
export const META_SHAPE: FigureShape = { waist: 0, fullness: 0, bias: 0, lean: 0, cross: 0, morph: 1 }
// META_ASPECT/META_PHASE live in core/lissajous/equation so the layout grid,
// the path lab and this motion lab all warp to one Meta definition.
export { META_ASPECT, META_PHASE }

// The Meta profile: y(v) = sin v + Σ harmonics, 2π-periodic, so bilateral
// symmetry, the single closed loop and the lobe machinery all survive.
const META_H = META_HARMONICS

const isNeutralShape = (s?: FigureShape) =>
  !s ||
  (s.waist === 0 &&
    s.fullness === 0 &&
    s.bias === 0 &&
    (s.lean ?? 0) === 0 &&
    (s.cross ?? 0) === 0 &&
    (s.morph ?? 0) === 0)

export function shapeY(shape: FigureShape | undefined, u: number): number {
  if (isNeutralShape(shape)) return Math.sin(u)
  const s = shape as FigureShape
  const w = 0.45 * Math.max(0, Math.min(1, s.waist))
  let v = u + w * Math.sin(2 * u)
  const beta = 0.55 * Math.max(-1, Math.min(1, s.bias))
  if (beta) v = v - beta * Math.sin(v)
  const lam = 0.55 * Math.max(-1, Math.min(1, s.lean ?? 0))
  if (lam) v = v - (lam * Math.sin(v) * (1 + Math.cos(v))) / 2
  let y = Math.sin(v)
  const m = Math.max(0, Math.min(1, s.morph ?? 0))
  if (m > 0) {
    y +=
      m *
      (META_H.b0 +
        META_H.a2 * Math.sin(2 * v) +
        META_H.a3 * Math.sin(3 * v) +
        META_H.b1 * Math.cos(v) +
        META_H.b2 * Math.cos(2 * v) +
        META_H.b3 * Math.cos(3 * v))
  }
  const c = 0.5 * Math.max(-1, Math.min(1, s.cross ?? 0))
  const sh = Math.sin(v / 2)
  y += c * sh * sh
  const kf = 2.2 * Math.max(0, Math.min(1, s.fullness))
  if (kf > 0.02) y = Math.tanh(kf * y) / Math.tanh(kf)
  return y
}

type FigureParams = {
  frequencyX: number
  frequencyY: number
  phase: number
  shape?: FigureShape
}

// A lobe's SPEED is its height above its own BASELINE, and the baseline is
// the lobe's chord — the straight line joining its two endpoints. Speed
// then vanishes at both ends by construction and never flips sign mid-arc,
// so the arc as drawn is the speed graph, cusp-free.
//
// When the lobe's endpoints are level (every untilted figure) the chord IS
// the y = 0 line and this reduces exactly to |y| — the classic reading,
// unchanged. When they are not (the Meta mark, whose crossing rides above
// its caps) it is the same arch, read along its own baseline.
//
// A STRAIGHT lobe is the exception: its chord lies on the curve, so the
// height is identically zero. A straight arc has no arch to read, and the
// figure's own y is the speed — that is what makes 1:1 at phase 0, the
// line y = x, the quadratic ease.
type LobeSpeed = {
  at: (t: number) => number // signed height above the baseline
  baseAt: (x: number) => number // the baseline itself, in curve space
}

function lobeSpeedFn(
  a: number, b: number, phase: number, shape: FigureShape | undefined,
  t0: number, t1: number,
): LobeSpeed {
  const x0 = Math.sin(a * t0 + phase)
  const x1 = Math.sin(a * t1 + phase)
  const y0 = shapeY(shape, b * t0)
  const y1 = shapeY(shape, b * t1)
  const dx = x1 - x0 || 1e-9
  const baseAt = (x: number) => y0 + ((y1 - y0) * (x - x0)) / dx
  const at = (t: number) => shapeY(shape, b * t) - baseAt(Math.sin(a * t + phase))

  for (let i = 1; i < 16; i++) {
    if (Math.abs(at(t0 + (i / 16) * (t1 - t0))) > 1e-9) return { at, baseAt }
  }
  // straight: fall back to the drawing's own baseline
  return { at: (t) => shapeY(shape, b * t), baseAt: () => 0 }
}

// The figure's SELF-INTERSECTIONS: parameters where the curve passes back
// through a point it has already drawn — the waist of the ∞, where the
// eye says one lobe ends and the next begins.
//
// x(t1) = x(t2) forces the two parameters onto one of two families:
//   same phase:     t2 = t1 + 2πk/a
//   mirrored phase: t2 = (π - 2φ + 2πk)/a - t1
// Imposing y(t1) = y(t2) on each leaves a 1-D root find, so the crossings
// come out analytically-seeded and exact rather than from a polyline
// intersection sweep. A retraced figure (every point doubled, e.g. 1:2 at
// phase 0) makes the difference identically zero — there is no isolated
// crossing, and the caller falls back to y's zeros.
export function figureCrossings(params: FigureParams): number[] {
  const a = Math.max(1, Math.round(params.frequencyX))
  const b = Math.max(1, Math.round(params.frequencyY))
  const phase = params.phase
  const shape = params.shape
  const TAU = Math.PI * 2
  const X = (t: number) => Math.sin(a * t + phase)
  const Y = (t: number) => shapeY(shape, b * t)

  const found: number[] = []
  const add = (t1: number, t2: number) => {
    const u1 = ((t1 % TAU) + TAU) % TAU
    const u2 = ((t2 % TAU) + TAU) % TAU
    const apart = Math.abs(u1 - u2)
    if (apart < 1e-6 || Math.abs(apart - TAU) < 1e-6) return // same parameter
    if (Math.abs(X(u1) - X(u2)) > 1e-5 || Math.abs(Y(u1) - Y(u2)) > 1e-5) return
    if (!found.some((o) => Math.abs(o - u1) < 1e-4)) found.push(u1)
  }

  const scanFamily = (t2of: (t: number) => number) => {
    const g = (t: number) => Y(t2of(t)) - Y(t)
    const N = 720
    const gs = new Float64Array(N + 1)
    let gmax = 0
    for (let i = 0; i <= N; i++) {
      gs[i] = g((i / N) * TAU)
      gmax = Math.max(gmax, Math.abs(gs[i]))
    }
    // g ≡ 0 means this family maps the figure onto ITSELF: the curve is
    // retraced (1:1 at phase 0 is the line y = x, drawn twice), so every
    // point is "shared" and none is an isolated crossing. Bail out before
    // float noise around zero manufactures sign changes.
    if (gmax < 1e-6) return
    for (let i = 1; i <= N; i++) {
      const pg = gs[i - 1]
      const gg = gs[i]
      if ((pg < 0 && gg >= 0) || (pg > 0 && gg <= 0)) {
        let lo = ((i - 1) / N) * TAU
        let hi = (i / N) * TAU
        let glo = pg
        for (let k = 0; k < 60; k++) {
          const mid = (lo + hi) / 2
          const gm = g(mid)
          if (glo < 0 === gm < 0) { lo = mid; glo = gm } else hi = mid
        }
        const r = (lo + hi) / 2
        add(r, t2of(r))
      }
    }
  }

  for (let k = 1; k < a; k++) scanFamily((t) => t + (TAU * k) / a)
  for (let k = 0; k < a; k++) scanFamily((t) => (Math.PI - 2 * phase + TAU * k) / a - t)

  return found.sort((p, q) => p - q)
}

// Every harvestable lobe of a figure: FULL ARCHES — the x-monotone
// half-periods (cut at the caps, x's extrema) subdivided at the figure's
// self-intersections, so a lobe runs exactly from cap to crossing, the
// way the eye reads it. Ordered left→right by their position on the
// figure so clicking feels spatial.
export type Lobe = { t0: number; t1: number }

export function enumerateLobes(params: FigureParams): Lobe[] {
  const a = Math.max(1, Math.round(params.frequencyX))
  const b = Math.max(1, Math.round(params.frequencyY))
  const phase = params.phase
  const shape = params.shape
  const TAU = Math.PI * 2
  const out: Lobe[] = []
  const crossings = figureCrossings(params)

  for (let k = 0; k < a; k++) {
    for (const [u0, u1] of [
      [Math.PI / 2 + TAU * k, (3 * Math.PI) / 2 + TAU * k], // falling (top) first
      [-Math.PI / 2 + TAU * k, Math.PI / 2 + TAU * k], // rising
    ]) {
      const q0 = (u0 - phase) / a
      const q1 = (u1 - phase) / a
      const cuts: number[] = [q0]
      // subdivide at the crossings that fall inside this window
      for (const c of crossings) {
        for (let m = -2; m <= 2; m++) {
          const t = c + TAU * m
          if (t > q0 + 1e-9 && t < q1 - 1e-9) cuts.push(t)
        }
      }
      if (cuts.length === 1) {
        // no crossing here (a retraced or open figure): fall back to y's
        // zeros, found numerically so the whole design space works
        const scan = 96
        let py = shapeY(shape, b * q0)
        for (let i = 1; i <= scan; i++) {
          const t = q0 + (i / scan) * (q1 - q0)
          const y = shapeY(shape, b * t)
          if ((py < 0 && y >= 0) || (py > 0 && y <= 0)) {
            let lo2 = q0 + ((i - 1) / scan) * (q1 - q0)
            let hi2 = t
            for (let bi = 0; bi < 45; bi++) {
              const mid = (lo2 + hi2) / 2
              const ym = shapeY(shape, b * mid)
              if ((py < 0 && ym >= 0) || (py > 0 && ym <= 0)) hi2 = mid
              else lo2 = mid
            }
            const tz = (lo2 + hi2) / 2
            if (tz > q0 + 1e-9 && tz < q1 - 1e-9) cuts.push(tz)
          }
          py = y
        }
      }
      cuts.push(q1)
      cuts.sort((p1, p2) => p1 - p2)
      for (let c = 0; c + 1 < cuts.length; c++) {
        const t0 = cuts[c]
        const t1 = cuts[c + 1]
        if (t1 - t0 < 1e-3) continue
        // skip near-silent slivers: no height above their own baseline
        const { at } = lobeSpeedFn(a, b, phase, shape, t0, t1)
        let peak = 0
        for (let i = 0; i <= 16; i++) {
          peak = Math.max(peak, Math.abs(at(t0 + (i / 16) * (t1 - t0))))
        }
        if (peak < 0.05) continue
        out.push({ t0, t1 })
      }
    }
  }

  const midX = (l: Lobe) => Math.sin(a * ((l.t0 + l.t1) / 2) + phase)
  return out.sort((l1, l2) => midX(l1) - midX(l2))
}

// A lobe that hangs below the figure's waist. Top lobes read as travel
// arches; bottom lobes read as SETTLES — selecting one applies the heavy
// decay envelope (the whip-and-glide), which is what a mass dropping
// into rest looks like. The distinction is the lobe's mean height.
export function lobeIsBottom(params: FigureParams, lobe: Lobe): boolean {
  const b = Math.max(1, Math.round(params.frequencyY))
  const probes = 32
  let sum = 0
  for (let i = 0; i <= probes; i++) {
    sum += shapeY(params.shape, b * (lobe.t0 + (i / probes) * (lobe.t1 - lobe.t0)))
  }
  return sum / (probes + 1) < -0.05
}

export type MotionPreset = MotionRecipe & { id: string; label: string }

// Family members read as easings — the traditional AE set, all from the
// figure family. The in-out arch is a full lobe; the ramps take one side
// of the CIRCLE's top arch (1:1 at 90°), split at its speed peak —
// rise accelerates (ease-in), fall decelerates (ease-out). Bounce/spring
// are lobed figures with a damping envelope so they settle instead of
// swinging fully back. The only straight-line figure is LINEAR, where a
// straight line honestly means no easing.
export const MOTION_PRESETS: MotionPreset[] = [
  { id: 'linear', label: 'LINEAR', ratioX: 1, ratioY: 1, phase: 0, read: 'position' },
  // presets carry NO treatment: what you see marked on the figure is
  // exactly what plays — strength/decay are explicit dials on top
  { id: 'ease-in', label: 'EASE IN', ratioX: 1, ratioY: 1, phase: Math.PI / 2, read: 'velocity', half: 'rise' },
  { id: 'ease-out', label: 'EASE OUT', ratioX: 1, ratioY: 1, phase: Math.PI / 2, read: 'velocity', half: 'fall' },
  { id: 'ease-in-out', label: 'EASE IN-OUT', ratioX: 1, ratioY: 2, phase: Math.PI / 2, read: 'velocity' },
  { id: 'bounce', label: 'BOUNCE', ratioX: 1, ratioY: 3, phase: 0, read: 'position', decay: 0.55 },
  { id: 'spring', label: 'SPRING', ratioX: 1, ratioY: 5, phase: 0, read: 'position', decay: 0.5 },
]

// The derived motion system: named roles a brand actually uses, each a
// family member. One figure family → grid, texture, type, and motion.
//   standard — the arch: speed rises and falls, the symmetric move
//   enter    — decelerate into place (speed ramp down)
//   exit     — accelerate away (speed ramp up)
//   emphasis — the 1:3 swing, for attention
// The easing library derived from ONE figure: every card is an arc of
// the figure currently on the panel — its distinct arches, the ramps
// split from the picked arch, strength pushes, and (when the figure's
// value read isn't degenerate) the position read with its settle
// variant. Change the figure, the whole vocabulary changes with it.
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI']

export function figureLibrary(
  ratioX: number,
  ratioY: number,
  phase: number,
  lobe = -1,
): { family: string; variants: MotionPreset[] }[] {
  const base = { ratioX, ratioY, phase, read: 'velocity' as EasingRead }
  const params = { frequencyX: ratioX, frequencyY: ratioY, phase }
  const rows: { family: string; variants: MotionPreset[] }[] = []

  // distinct full arches (overlapping draws dedupe to one card)
  const seen = new Set<string>()
  const arches: MotionPreset[] = []
  const lobes = enumerateLobes(params)
  for (let i = 0; i < lobes.length && arches.length < 6; i++) {
    const e = lissajousEasing({ ...base, lobe: i })
    const sig = [0.2, 0.35, 0.5, 0.65, 0.8].map((t) => evalEase(e.lut, t).toFixed(2)).join(',')
    if (seen.has(sig)) continue
    seen.add(sig)
    arches.push({ ...base, id: `arch-${i}`, label: `ARCH ${ROMAN[arches.length]}`, lobe: i, half: 'full' })
  }
  if (arches.length) rows.push({ family: 'ARCHES', variants: arches })

  // the picked arch split at its peak, and run backwards
  rows.push({
    family: 'RAMPS',
    variants: [
      { ...base, id: 'ramp-rise', label: 'RISE', lobe, half: 'rise' },
      { ...base, id: 'ramp-fall', label: 'FALL', lobe, half: 'fall' },
      { ...base, id: 'ramp-reverse', label: 'REVERSED', lobe, half: 'full', reverse: true },
    ],
  })

  // strength escalation on the picked arch
  rows.push({
    family: 'PUSH',
    variants: [
      { ...base, id: 'push-1', label: '+35', lobe, half: 'full', strength: 0.35 },
      { ...base, id: 'push-2', label: '+70', lobe, half: 'full', strength: 0.7 },
    ],
  })

  // the same figure read as a value graph, when that read isn't degenerate;
  // if it swings past the target, decay gives the settling spring
  const value = curveArcEasing(params)
  if (value.frame) {
    const variants: MotionPreset[] = [
      { ...base, read: 'position', id: 'value-1', label: 'AS DRAWN' },
      { ...base, read: 'position', id: 'value-2', label: 'REVERSED', reverse: true },
    ]
    let swings = 0
    let dir = 0
    for (let i = 1; i < value.lut.length; i++) {
      const d = Math.sign(value.lut[i] - value.lut[i - 1])
      if (d !== 0 && d !== dir) {
        if (dir !== 0) swings++
        dir = d
      }
    }
    if (swings >= 2) {
      variants.push({ ...base, read: 'position', id: 'value-settled', label: 'SETTLED', decay: 0.55 })
    }
    rows.push({ family: 'VALUE', variants })
  }

  return rows
}

export const MOTION_TOKENS: MotionPreset[] = [
  { id: 'standard', label: 'STANDARD', ratioX: 1, ratioY: 2, phase: Math.PI / 2, read: 'velocity', strength: 0.35 },
  { id: 'enter', label: 'ENTER', ratioX: 1, ratioY: 1, phase: Math.PI / 2, read: 'velocity', half: 'fall', strength: 0.3 },
  { id: 'exit', label: 'EXIT', ratioX: 1, ratioY: 1, phase: Math.PI / 2, read: 'velocity', half: 'rise', strength: 0.3 },
  { id: 'emphasis', label: 'EMPHASIS', ratioX: 1, ratioY: 3, phase: 0, read: 'position', decay: 0.55 },
]

export const LUT_SIZE = 240

// Simulate to settle, then resample onto a fixed-size LUT over
// normalized time [0, 1]. stiffness <= 0 is the LINEAR bypass.
export function springLUT(params: SpringParams, size = LUT_SIZE): Float32Array {
  const lut = new Float32Array(size)
  const omega = params.stiffness

  if (omega <= 0) {
    for (let i = 0; i < size; i++) lut[i] = i / (size - 1)
    return lut
  }

  const zeta = Math.max(0.05, params.damping)
  // settle time from the SLOWEST decay rate: ζω when underdamped, the slow
  // pole ω(ζ − √(ζ²−1)) when overdamped. 7 ≈ ln(100) plus headroom for the
  // (1 + ωt) polynomial factor at critical damping.
  const slowRate = omega * (zeta - Math.sqrt(Math.max(0, zeta * zeta - 1)))
  const settleT = Math.min(10, Math.max(0.15, 7 / Math.max(0.01, slowRate)))

  const steps = 4096
  const dt = settleT / steps
  const xs = new Float64Array(steps + 1)
  let x = 0
  let v = params.initialVelocity * omega // scale velocity to the system
  xs[0] = 0
  for (let i = 1; i <= steps; i++) {
    // semi-implicit Euler — stable for stiff springs at this dt
    const a = -omega * omega * (x - 1) - 2 * zeta * omega * v
    v += a * dt
    x += v * dt
    xs[i] = x
  }

  // Trim the dead tail: normalize the timeline to where motion actually
  // ends (last time the spring is >1% away from target). Without this an
  // ease finishes ~40% in and the object parks while the clock runs on —
  // an eased move should occupy its full duration, like an AE keyframe pair.
  let lastActive = steps
  for (let i = steps; i >= 1; i--) {
    if (Math.abs(xs[i] - 1) > 0.01) {
      lastActive = i
      break
    }
  }
  const end = Math.min(steps, Math.ceil(lastActive * 1.08)) // soft landing margin

  for (let i = 0; i < size; i++) {
    const f = (i / (size - 1)) * end
    const i0 = Math.floor(f)
    const t = f - i0
    lut[i] = xs[i0] * (1 - t) + xs[Math.min(steps, i0 + 1)] * t
  }
  lut[size - 1] = 1 // land exactly
  return lut
}

export function evalEase(lut: Float32Array, t: number): number {
  const clamped = Math.max(0, Math.min(1, t))
  const f = clamped * (lut.length - 1)
  const i = Math.floor(f)
  const frac = f - i
  return lut[i] * (1 - frac) + lut[Math.min(lut.length - 1, i + 1)] * frac
}

// Normalized velocity profile (peak = 1) for the plot's ghost fill.
export function velocityOf(lut: Float32Array): Float32Array {
  const out = new Float32Array(lut.length)
  let peak = 1e-6
  for (let i = 1; i < lut.length; i++) {
    out[i] = lut[i] - lut[i - 1]
    if (Math.abs(out[i]) > peak) peak = Math.abs(out[i])
  }
  out[0] = out[1]
  for (let i = 0; i < out.length; i++) out[i] /= peak
  return out
}

export function overshootOf(lut: Float32Array): number {
  let max = 0
  for (let i = 0; i < lut.length; i++) if (lut[i] > max) max = lut[i]
  return Math.max(0, max - 1)
}

// Easing taken directly FROM the figure: pick the arc of the Lissajous
// where the x-oscillation rises through its full sweep (x is the time
// axis), and read the y-oscillation over that window as position. The
// easing curve IS a lobe of the figure — same arc, drawn as a graph.
// Different ratios and phases give the arc a different character.
// Maps figure space into the arc's graph frame so the UI can ghost the
// rest of the figure behind the arc. Time is ALWAYS the projected
// x-coordinate: the arc as drawn IS the curve — what you see marked on
// the figure is exactly what the speed graph shows.
// y0/y1 are the arc's BASELINE at x0/x1 — the chord the speed is measured
// from. For the position read (and any untilted figure) the baseline is
// flat, y1 === y0, and the frame is a plain offset+scale.
export type ArcFrame = { x0: number; x1: number; y0: number; y1: number; yScale: number }

export type CurveArcEasing = {
  lut: Float32Array
  // the chosen arc in unit space [-1,1]², for highlighting on the figure
  arcUnit: { x: number; y: number }[]
  // curve parameter per normalized-time step, for the synced tracer
  tAtP: Float32Array
  frame: ArcFrame | null // null for degenerate fallbacks
}

export function curveArcEasing(
  params: { frequencyX: number; frequencyY: number; phase: number; shape?: FigureShape },
  size = LUT_SIZE,
): CurveArcEasing {
  const a = Math.max(1, Math.round(params.frequencyX))
  const b = Math.max(1, Math.round(params.frequencyY))
  const phase = params.phase
  const shape = params.shape
  const TAU = Math.PI * 2

  // candidate windows: x = sin(a·t + φ) rises −1 → +1 on each of these
  let bestT0 = 0
  let bestT1 = Math.PI / a
  let bestDy = 0
  for (let k = 0; k < a; k++) {
    const t0 = (-Math.PI / 2 - phase + TAU * k) / a
    const t1 = t0 + Math.PI / a
    const dy = shapeY(shape, b * t1) - shapeY(shape, b * t0)
    if (Math.abs(dy) > Math.abs(bestDy)) {
      bestDy = dy
      bestT0 = t0
      bestT1 = t1
    }
  }

  if (Math.abs(bestDy) < 0.2) {
    // symmetric figure: full windows return to their start. Try QUARTER
    // windows — the top half of the figure, halved. The circle's quarters
    // are exactly the classic circ arcs (√(1−t²) family).
    for (let k = 0; k < a; k++) {
      for (const [u0, u1] of [
        [-Math.PI / 2 + TAU * k, TAU * k],
        [TAU * k, Math.PI / 2 + TAU * k],
      ]) {
        const t0 = (u0 - phase) / a
        const t1 = (u1 - phase) / a
        const dy = shapeY(shape, b * t1) - shapeY(shape, b * t0)
        if (Math.abs(dy) > Math.abs(bestDy) + 1e-9) {
          bestDy = dy
          bestT0 = t0
          bestT1 = t1
        }
      }
    }
  }

  const lut = new Float32Array(size)
  const tAtP = new Float32Array(size)
  const arcUnit: { x: number; y: number }[] = []

  if (Math.abs(bestDy) < 0.2) {
    // fully degenerate (e.g. 1:2 at phase 0) — fall back to the
    // y-oscillation's rising half-period: a plain sine ease.
    const t0 = -Math.PI / (2 * b)
    const t1 = Math.PI / (2 * b)
    for (let i = 0; i < size; i++) {
      const p = i / (size - 1)
      const t = t0 + p * (t1 - t0)
      lut[i] = (1 - Math.cos(Math.PI * p)) / 2
      tAtP[i] = t
      arcUnit.push({ x: Math.sin(a * t + phase), y: shapeY(shape, b * t) })
    }
    lut[size - 1] = 1
    return { lut, arcUnit, tAtP, frame: null }
  }

  // time axis = normalized x; sample the window finely, then resample the
  // (x, y) pairs onto a uniform time grid
  const t0 = bestT0
  const t1 = bestT1
  const fine = 1024
  const xs = new Float64Array(fine + 1)
  const ys = new Float64Array(fine + 1)
  const ts = new Float64Array(fine + 1)
  for (let i = 0; i <= fine; i++) {
    const t = t0 + (i / fine) * (t1 - t0)
    ts[i] = t
    xs[i] = Math.sin(a * t + phase)
    ys[i] = shapeY(shape, b * t)
  }
  const xStart = xs[0]
  const xEnd = xs[fine]
  const xSpan = xEnd - xStart || 1e-9
  for (let i = 0; i <= fine; i++) xs[i] = (xs[i] - xStart) / xSpan // 0..1, monotone
  const y0 = ys[0]
  const yScale = bestDy

  let j = 0
  for (let i = 0; i < size; i++) {
    const p = i / (size - 1)
    while (j < fine - 1 && xs[j + 1] < p) j++
    const span = xs[j + 1] - xs[j] || 1e-9
    const f = Math.max(0, Math.min(1, (p - xs[j]) / span))
    lut[i] = (ys[j] * (1 - f) + ys[j + 1] * f - y0) / yScale
    tAtP[i] = ts[j] * (1 - f) + ts[j + 1] * f
  }
  lut[0] = 0
  lut[size - 1] = 1

  const arcStep = Math.max(1, Math.floor(fine / 160))
  for (let i = 0; i <= fine; i += arcStep) {
    arcUnit.push({ x: Math.sin(a * ts[i] + phase), y: shapeY(shape, b * ts[i]) })
  }

  return { lut, arcUnit, tAtP, frame: { x0: xStart, x1: xEnd, y0, y1: y0, yScale } }
}

// Velocity read: the arc IS the speed graph (AE's default editor view).
// Candidate windows are full arches (see enumerateLobes); |y| over the
// window is speed. Scoring prefers arch-shaped speed (zero at both
// ends) — the traditional eased-keyframe speed bump. Position is the
// normalized integral, monotone by construction. `half` keeps one side
// of the arch, split at its speed peak — the classic ease ramps.
function arcVelocityEasing(
  params: { frequencyX: number; frequencyY: number; phase: number; shape?: FigureShape },
  size = LUT_SIZE,
  lobeIndex?: number,
  half?: 'full' | 'rise' | 'fall',
): CurveArcEasing & { speed: Float32Array } {
  const a = Math.max(1, Math.round(params.frequencyX))
  const b = Math.max(1, Math.round(params.frequencyY))
  const phase = params.phase
  const shape = params.shape

  // Harvest unit: a LOBE (see enumerateLobes) — single-signed, so the arc
  // as drawn IS the speed graph. A specific lobe can be requested by
  // index (figure-panel clicks); otherwise scoring prefers wide,
  // zero-ended, positive-y (top-half) lobes.
  const lobes = enumerateLobes(params)
  const halfW = Math.PI / a
  let bestT0 = 0
  let bestT1 = halfW

  if (lobeIndex !== undefined && lobeIndex >= 0 && lobeIndex < lobes.length) {
    bestT0 = lobes[lobeIndex].t0
    bestT1 = lobes[lobeIndex].t1
  } else {
    let bestScore = -Infinity
    for (const { t0, t1 } of lobes) {
      const { at } = lobeSpeedFn(a, b, phase, shape, t0, t1)
      let sumAbs = 0
      let sumSigned = 0
      const probes = 48
      for (let i = 0; i <= probes; i++) {
        const t = t0 + (i / probes) * (t1 - t0)
        sumAbs += Math.abs(at(t))
        sumSigned += shapeY(shape, b * t)
      }
      const mean = sumAbs / (probes + 1)
      const meanY = sumSigned / (probes + 1)
      // prefer arch-shaped speed (zero at both ends). A chord-based lobe
      // scores 0 here by construction; only a straight one can be penalized.
      const endPenalty = Math.abs(at(t0)) + Math.abs(at(t1))
      const widthFrac = (t1 - t0) / halfW
      // small rightmost bias settles mirror-symmetric ties deterministically
      const midX = Math.sin(a * ((t0 + t1) / 2) + phase)
      const score =
        mean * Math.sqrt(widthFrac) - 0.75 * endPenalty + 0.35 * meanY + 0.02 * midX
      if (score > bestScore + 1e-9) {
        bestScore = score
        bestT0 = t0
        bestT1 = t1
      }
    }
  }

  // time axis = the projected x across the window: the lobe AS DRAWN on
  // the figure IS the speed curve — the marked arc and the graph are the
  // same shape, skew and all. (1:1 ramps become the exact quadratic
  // family; the 1:2 arch peaks early, like the lobe does.)
  const fine = 1024
  const ts = new Float64Array(fine + 1)
  const xs = new Float64Array(fine + 1)
  const sp = new Float64Array(fine + 1)
  // speed = the lobe's height above its own baseline (== |y| when level)
  const lobeSpeed = lobeSpeedFn(a, b, phase, shape, bestT0, bestT1)
  for (let i = 0; i <= fine; i++) {
    const t = bestT0 + (i / fine) * (bestT1 - bestT0)
    ts[i] = t
    xs[i] = Math.sin(a * t + phase)
    sp[i] = Math.abs(lobeSpeed.at(t))
  }
  // orient by ascending screen-x: "read left to right" is literal, so a
  // falling window's samples get reversed rather than time-flipped
  if (xs[fine] < xs[0]) {
    for (let i = 0, k = fine; i < k; i++, k--) {
      const tx = xs[i]; xs[i] = xs[k]; xs[k] = tx
      const tsp = sp[i]; sp[i] = sp[k]; sp[k] = tsp
      const tt = ts[i]; ts[i] = ts[k]; ts[k] = tt
    }
  }

  // optionally keep one side of the arch, split at its speed peak:
  // 'fall' decelerates into place (ease-out), 'rise' accelerates (ease-in)
  let lo = 0
  let hi = fine
  if (half === 'rise' || half === 'fall') {
    let peakI = 0
    for (let i = 0; i <= fine; i++) if (sp[i] > sp[peakI]) peakI = i
    if (peakI > 3 && peakI < fine - 3) {
      if (half === 'fall') lo = peakI
      else hi = peakI
    }
  }

  const xStart = xs[lo]
  const xEnd = xs[hi]
  const xSpan = xEnd - xStart || 1e-9
  for (let i = lo; i <= hi; i++) xs[i] = (xs[i] - xStart) / xSpan // 0..1, monotone

  const speed = new Float32Array(size)
  const tAtP = new Float32Array(size)
  let j = lo
  for (let i = 0; i < size; i++) {
    const p = i / (size - 1)
    while (j < hi - 1 && xs[j + 1] < p) j++
    const span = xs[j + 1] - xs[j] || 1e-9
    const f = Math.max(0, Math.min(1, (p - xs[j]) / span))
    speed[i] = sp[j] * (1 - f) + sp[j + 1] * f
    tAtP[i] = ts[j] * (1 - f) + ts[j + 1] * f
  }

  // integrate speed → position, normalize to land at 1
  const lut = new Float32Array(size)
  for (let i = 1; i < size; i++) lut[i] = lut[i - 1] + (speed[i] + speed[i - 1]) / 2
  const total = lut[size - 1]
  if (total < 1e-3) {
    // degenerate (speed ~0 everywhere): smooth bell fallback
    for (let i = 0; i < size; i++) {
      const p = i / (size - 1)
      lut[i] = (1 - Math.cos(Math.PI * p)) / 2
      speed[i] = Math.sin(Math.PI * p)
    }
  } else {
    for (let i = 0; i < size; i++) lut[i] /= total
  }
  lut[0] = 0
  lut[size - 1] = 1

  // normalize speed display to peak 1
  let peak = 1e-6
  for (const v of speed) if (v > peak) peak = v
  for (let i = 0; i < size; i++) speed[i] /= peak

  // marked arc = exactly the harvested window (the sliced side when a
  // half is taken) — the figure highlight and the graph stay ONE drawing
  const arcUnit: { x: number; y: number }[] = []
  for (let i = 0; i <= 160; i++) {
    const t = ts[lo] + (i / 160) * (ts[hi] - ts[lo])
    arcUnit.push({ x: Math.sin(a * t + phase), y: shapeY(shape, b * t) })
  }

  // the frame's baseline is the lobe's own, sampled at the (possibly
  // half-sliced) ends — the same line, so the ghosted figure shears with
  // the arc and the two stay one drawing
  return {
    lut, arcUnit, tAtP, speed,
    frame: {
      x0: xStart, x1: xEnd,
      y0: lobeSpeed.baseAt(xStart), y1: lobeSpeed.baseAt(xEnd),
      yScale: peak,
    },
  }
}

// AE-style influence: raise the (signed) speed profile to a power and
// re-integrate. >1 concentrates travel into the fast section — stronger
// ease. Endpoints re-normalized to land exactly 0→1.
export function applyStrength(lut: Float32Array, strength: number): Float32Array {
  if (strength <= 0.001) return lut
  // AE speed-graph influence. The position curve is the integral of a speed
  // graph, so "strength" simply sharpens that speed graph. Raise the
  // NORMALIZED speed to a power (>1): low speeds collapse toward a genuine
  // HOLD (zero stays zero — NO linear floor, so flat = truly stopped), while
  // the peak is preserved. Re-integrate to position and normalize 0→1.
  // Power scales smoothly with strength so the slider has a usable range
  // from a gentle sharpen to a hard hold→whip→settle.
  const n = lut.length
  const power = 1 + strength * 13

  const vel = new Float32Array(n)
  let peak = 1e-9
  for (let i = 1; i < n; i++) {
    vel[i] = lut[i] - lut[i - 1]
    const a = Math.abs(vel[i])
    if (a > peak) peak = a
  }

  const out = new Float32Array(n)
  for (let i = 1; i < n; i++) {
    const shaped = Math.pow(Math.abs(vel[i]) / peak, power)
    out[i] = out[i - 1] + Math.sign(vel[i]) * shaped
  }
  const start = out[0]
  const span = out[n - 1] - start
  if (Math.abs(span) < 1e-9) return lut
  for (let i = 0; i < n; i++) out[i] = (out[i] - start) / span
  out[0] = 0
  out[n - 1] = 1
  return out
}

// Damping envelope: swings around the target shrink exponentially, so a
// 1:3 "bounce" settles into place instead of returning all the way to the
// start. e'(p) = 1 + (e(p) − 1)·exp(−k·p); endpoints preserved.
export function applyDecay(lut: Float32Array, decay: number): Float32Array {
  if (decay <= 0.001) return lut
  const k = decay * 6
  const n = lut.length
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const p = i / (n - 1)
    out[i] = 1 + (lut[i] - 1) * Math.exp(-k * p)
  }
  out[0] = 0
  out[n - 1] = 1
  return out
}

// Trim a velocity-read position LUT's FROZEN tail. When strength
// concentrates the travel, the speed graph collapses to ~0 well before the
// end, so the integrated position reaches 1 early and then sits perfectly
// still — the object arrives before the timeline ends and parks, so the
// ruler circle hits the finish line while the time cursor is still
// sweeping. Detect a genuinely frozen tail (per-sample speed far below the
// peak, spanning a meaningful chunk of the timeline) and resample the
// active span [0, end] back onto [0, 1] so the move fills its full duration
// and lands at t=1 with the cursor. This is velocity-based, so a smooth
// ease-out that merely decelerates toward the target (speed small but the
// object still moving) is NOT clipped. No floor is introduced: zero speed
// stays a true hold, the dead span is simply removed. No-op when there is
// no frozen tail (e.g. strength 0).
function trimDeadTail(
  lut: Float32Array,
  tAtP: Float32Array,
): { lut: Float32Array; tAtP: Float32Array } {
  const n = lut.length
  let peak = 1e-9
  for (let i = 1; i < n; i++) {
    const v = Math.abs(lut[i] - lut[i - 1])
    if (v > peak) peak = v
  }
  const eps = peak * 0.005 // below this the object is effectively stopped
  let lastActive = n - 1
  for (let i = n - 1; i >= 1; i--) {
    if (Math.abs(lut[i] - lut[i - 1]) > eps) {
      lastActive = i
      break
    }
  }
  // only trim a SUBSTANTIAL frozen tail (>3% of the timeline); a smooth
  // ease-out's final sub-eps sample or two must be left untouched
  const minFrozen = Math.max(3, Math.floor(n * 0.03))
  if (n - 1 - lastActive < minFrozen) return { lut, tAtP }

  const end = lastActive
  const outL = new Float32Array(n)
  const outT = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const f = (i / (n - 1)) * end
    const i0 = Math.floor(f)
    const frac = f - i0
    const i1 = Math.min(n - 1, i0 + 1)
    outL[i] = lut[i0] * (1 - frac) + lut[i1] * frac
    outT[i] = tAtP[i0] * (1 - frac) + tAtP[i1] * frac
  }
  // Rescale so the trimmed curve reaches exactly 1 at the end. Snapping the
  // last sample to 1 instead would inject a one-sample velocity spike — the
  // little tail uptick on the speed graph. The dropped frozen tail carried
  // only a sliver of travel, so this stays a smooth, monotone settle.
  const reach = outL[n - 1]
  if (reach > 1e-6) {
    for (let i = 0; i < n; i++) outL[i] /= reach
  }
  outL[0] = 0
  outL[n - 1] = 1
  return { lut: outL, tAtP: outT }
}

// One entry point: figure → read → mirror → strength → decay.
// rawLut/rawSpeed are the pre-shaping source (post-mirror) so the UI can
// show the arc it came from next to the curve it became.
export function lissajousEasing(
  recipe: MotionRecipe,
  size = LUT_SIZE,
): CurveArcEasing & { speed?: Float32Array; rawLut: Float32Array; rawSpeed?: Float32Array } {
  const params = {
    frequencyX: recipe.ratioX,
    frequencyY: recipe.ratioY,
    phase: recipe.phase,
    shape: recipe.shape,
  }
  const raw: CurveArcEasing & { speed?: Float32Array } =
    recipe.read === 'velocity'
      ? arcVelocityEasing(params, size, recipe.lobe, recipe.half)
      : curveArcEasing(params, size)

  let lut = raw.lut
  let tAtP = raw.tAtP
  let speed = raw.speed

  if (recipe.reverse) {
    const n = lut.length
    const rl = new Float32Array(n)
    const rt = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      rl[i] = 1 - lut[n - 1 - i]
      rt[i] = tAtP[n - 1 - i] // tracer runs the same arc backwards
    }
    lut = rl
    tAtP = rt
    if (speed) {
      const rs = new Float32Array(n)
      for (let i = 0; i < n; i++) rs[i] = speed[n - 1 - i]
      speed = rs
    }
  }

  const rawLut = lut
  const rawSpeed = speed

  const shaped = applyDecay(applyStrength(lut, recipe.strength ?? 0), recipe.decay ?? 0)
  if (shaped !== lut) {
    lut = shaped
  }

  // Velocity read is the integral of a speed graph: trim the dead tail so
  // the concentrated move lands at t=1 with the time cursor instead of
  // arriving early and parking.
  if (recipe.read === 'velocity') {
    const trimmed = trimDeadTail(lut, tAtP)
    lut = trimmed.lut
    tAtP = trimmed.tAtP
  }

  if (lut !== rawLut) {
    // speed display must match what actually plays
    speed = velocityOf(lut)
  }

  return { lut, tAtP, arcUnit: raw.arcUnit, speed, rawLut, rawSpeed, frame: raw.frame }
}

// Full motion-system export: the four role tokens + a duration scale,
// as CSS custom properties ready to paste into a stylesheet.
export function cssMotionSystem(baseDurationMs: number): string {
  const lines = [':root {']
  for (const token of MOTION_TOKENS) {
    lines.push(`  --ease-${token.id}: ${toCssLinear(lissajousEasing(token).lut)};`)
  }
  lines.push(`  --duration-quick: ${Math.round(baseDurationMs * 0.45)}ms;`)
  lines.push(`  --duration-base: ${Math.round(baseDurationMs)}ms;`)
  lines.push(`  --duration-slow: ${Math.round(baseDurationMs * 1.8)}ms;`)
  lines.push('}')
  return lines.join('\n')
}

// CSS `linear()` easing token — the LUT verbatim, usable anywhere.
export function toCssLinear(lut: Float32Array, stops = 24): string {
  const parts: string[] = []
  for (let i = 0; i < stops; i++) {
    const t = i / (stops - 1)
    parts.push(`${+evalEase(lut, t).toFixed(4)} ${Math.round(t * 100)}%`)
  }
  return `linear(${parts.join(', ')})`
}
