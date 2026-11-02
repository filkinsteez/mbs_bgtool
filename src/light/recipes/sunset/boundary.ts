/**
 * Shared boundary model for the Sunset recipes (ramp, bands, blooms) and the
 * soft sides of Contour glows. Measured and prototyped in
 * prototypes/organic-boundaries (README there).
 *
 * A recipe gives, per pixel, a coordinate along its boundaries `a` and a base
 * coordinate across them `s0`, both in short-side units, with s0 increasing
 * from the first color to the last. The model moves the boundaries:
 *
 *   D(a, s0) = G(a) * E(s0) * M(a) * clip(cS * (S(a) - mean) + cI * I(a, v(s0)))
 *
 * - S: 1D noise along the boundary, the same for every boundary.
 * - I: 2D noise stretched along the boundary; v is s0 (distance mode) or the
 *   number of transitions passed (ramp mode), so isolines inside one transition
 *   move together and the next transition gets its own shape.
 * - M: makes the waviness come and go along the boundary.
 * - E: amplitude down the ramp, through knots.
 * - clip: c * tanh(x / c); no rare deep dips, flat stretches between rises.
 * - G: fold guard along the boundary. It is 1 except where the field would be
 *   too steep, so only that part of the frame is calmed.
 *
 * `calibrateBoundary` runs once per render on the CPU. It scales each term to
 * the requested wander for this seed and frame, lowers the wander on very
 * wide transitions, and sets G from the steepest slope found on a grid.
 * It returns the shader uniforms and a CPU copy of the same field. The same
 * parameters, aspect and seed always give the same uniforms.
 *
 * In the shader, prepend BOUNDARY_GLSL to the recipe fragment. It uses the
 * engine's gradientNoise from the chunk library and defines its own names
 * only (boundary*, uBnd*).
 */

// ---------------------------------------------------------------- noise

const TAU = 6.283185307179586

// pcg3d (Jarzynski and Olano 2020), first component, as the engine's hash.ts.
function pcg3dX(a: number, b: number, c: number): number {
  let x = (Math.imul(a, 1664525) + 1013904223) >>> 0
  let y = (Math.imul(b, 1664525) + 1013904223) >>> 0
  let z = (Math.imul(c, 1664525) + 1013904223) >>> 0
  x = (x + Math.imul(y, z)) >>> 0
  y = (y + Math.imul(z, x)) >>> 0
  z = (z + Math.imul(x, y)) >>> 0
  x = (x ^ (x >>> 16)) >>> 0
  y = (y ^ (y >>> 16)) >>> 0
  z = (z ^ (z >>> 16)) >>> 0
  x = (x + Math.imul(y, z)) >>> 0
  return x
}

/** The engine's `hash1(ivec2 cell, int seed)` in [0, 1). */
export function hash1(cx: number, cy: number, seed: number): number {
  return (pcg3dX((cx + 1048576) | 0, (cy + 1048576) | 0, (seed + 1048576) | 0) >>> 8) * (1 / 16777216)
}

const quintic = (f: number) => f * f * f * (f * (f * 6 - 15) + 10)

/** The engine's `gradientNoise(vec2 p, int seed)`, roughly in [-1, 1]. */
export function gradientNoise(px: number, py: number, seed: number): number {
  const ix = Math.floor(px)
  const iy = Math.floor(py)
  const fx = px - ix
  const fy = py - iy
  const ux = quintic(fx)
  const uy = quintic(fy)
  const a00 = hash1(ix, iy, seed) * TAU
  const a10 = hash1(ix + 1, iy, seed) * TAU
  const a01 = hash1(ix, iy + 1, seed) * TAU
  const a11 = hash1(ix + 1, iy + 1, seed) * TAU
  const n00 = Math.cos(a00) * fx + Math.sin(a00) * fy
  const n10 = Math.cos(a10) * (fx - 1) + Math.sin(a10) * fy
  const n01 = Math.cos(a01) * fx + Math.sin(a01) * (fy - 1)
  const n11 = Math.cos(a11) * (fx - 1) + Math.sin(a11) * (fy - 1)
  const nx0 = n00 + (n10 - n00) * ux
  const nx1 = n01 + (n11 - n01) * ux
  return 1.41421356 * (nx0 + (nx1 - nx0) * uy)
}

/** RMS of gradientNoise (measured in prototypes/organic-boundaries/tools). */
export const NOISE_RMS = 0.3052
/** Steepest slope of gradientNoise per lattice unit, over its RMS. */
export const NOISE_SLOPE_MAX = 9.476

// ---------------------------------------------------------------- parameters

/** One transition between two colors: its position on s0 and its 10-90 width. */
export interface BoundaryTransition {
  at: number
  width: number
}

export interface BoundaryParams {
  /**
   * Requested wander, [s0, spread] knots: the standard deviation of a boundary's
   * position across the calibration window, in short-side units. Smooth between
   * knots, flat beyond the first and last. At most 8 knots.
   */
  wander: ReadonlyArray<readonly [number, number]>
  /** Share of the wander's variance that every boundary has in common, 0..1. */
  share?: number
  /** Lattice size of the shared term along the boundary, short-side units. */
  sharedScale?: number
  /** Lattice size of the 2D term along the boundary, short-side units. */
  scale?: number
  /** `ramp`: the 2D term's vertical coordinate is the number of transitions passed; `distance`: it is s0. */
  vertical?: 'ramp' | 'distance'
  /** Vertical lattice size of the 2D term: in transitions (ramp) or short-side units (distance). */
  ly?: number
  /** Octaves along the boundary (each twice as fine) and their gain. */
  octaves?: 1 | 2 | 3
  gain?: number
  /** Soft clip in spreads; 0 is off. */
  clip?: number
  /** How much the waviness comes and goes along the boundary, and over what length. */
  alongMod?: { amount: number; scale: number }
  /**
   * Softness that changes slowly along each boundary: exp(amount * noise). For
   * transitions wider than `wRef` the amount shrinks as wRef / width, because how
   * far a soft ramp's tail reaches scales with its width.
   */
  soft?: { amount: number; scale: number; ly: number; wRef?: number }
  /** Fine feather of each boundary, as a share of its width (a print look). */
  feather?: { amount: number; scale: number; ly: number }
  /**
   * `coordinate`: every isoline follows s = s0 + D(a, s0) (ramps, blooms).
   * `edges`: transition j moves as a whole by D(a, at_j) (bands), so nothing can
   * fold inside a transition.
   */
  mode?: 'coordinate' | 'edges'
  /** The recipe's transitions, in order; needed for ramp mode, edge mode and the wide-transition rule. At most 16. */
  transitions?: ReadonlyArray<BoundaryTransition>
  /** Edge mode: neighbouring edges stay at least this share of their mean width apart. */
  minGap?: number
  /** Coordinate mode: dD/ds0 stays at or above -slopeBudget, so t stays monotone. */
  slopeBudget?: number
  /** Width of the calibration window, centered on the frame, short-side units (at least the frame width). */
  calWidth?: number
  /**
   * Transitions wider than this get proportionally less wander (wideWidth / width),
   * so a wide sky ramp is not shifted up and down in columns. 0 turns it off.
   */
  wideWidth?: number
  /** Range of s0 over the frame; defaults to the frame height centered on 0. */
  range?: readonly [number, number]
}

export const BOUNDARY_DEFAULTS = {
  share: 0.35,
  sharedScale: 0.45,
  scale: 0.4,
  vertical: 'ramp' as 'ramp' | 'distance',
  ly: 2,
  octaves: 2 as 1 | 2 | 3,
  gain: 0.25,
  clip: 1.3,
  alongMod: { amount: 0.2, scale: 0.9 },
  soft: { amount: 0.15, scale: 0.5, ly: 0.25, wRef: 0.08 },
  feather: { amount: 0, scale: 0.03, ly: 2 },
  mode: 'coordinate' as 'coordinate' | 'edges',
  minGap: 0.35,
  slopeBudget: 0.75,
  calWidth: 1.2,
  wideWidth: 0.25,
}

export const BOUNDARY_MAX_KNOTS = 8
export const BOUNDARY_MAX_TRANSITIONS = 16
export const BOUNDARY_GUARD_SAMPLES = 16

// ---------------------------------------------------------------- the field

interface Resolved {
  share: number
  sharedScale: number
  scale: number
  vertical: 'ramp' | 'distance'
  ly: number
  octaves: number
  gain: number
  clip: number
  modAmount: number
  modScale: number
  soft: { amount: number; scale: number; ly: number; wRef: number }
  feather: { amount: number; scale: number; ly: number }
  mode: 'coordinate' | 'edges'
  transitions: BoundaryTransition[]
  minGap: number
  slopeBudget: number
  calWidth: number
  wideWidth: number
}

function resolve(p: BoundaryParams): Resolved {
  const d = BOUNDARY_DEFAULTS
  const transitions = (p.transitions ?? []).slice(0, BOUNDARY_MAX_TRANSITIONS).map((t) => ({ at: t.at, width: Math.max(1e-4, t.width) }))
  const vertical = (p.vertical ?? d.vertical) === 'ramp' && transitions.length > 0 ? 'ramp' : 'distance'
  return {
    share: Math.min(1, Math.max(0, p.share ?? d.share)),
    sharedScale: Math.max(1e-3, p.sharedScale ?? d.sharedScale),
    scale: Math.max(1e-3, p.scale ?? d.scale),
    vertical,
    ly: Math.max(1e-3, p.ly ?? (vertical === 'distance' ? 0.25 : d.ly)),
    octaves: Math.min(3, Math.max(1, Math.round(p.octaves ?? d.octaves))),
    gain: p.gain ?? d.gain,
    clip: Math.max(0, p.clip ?? d.clip),
    modAmount: Math.max(0, p.alongMod?.amount ?? d.alongMod.amount),
    modScale: Math.max(1e-3, p.alongMod?.scale ?? d.alongMod.scale),
    soft: { ...d.soft, ...(p.soft ?? {}) },
    feather: { ...d.feather, ...(p.feather ?? {}) },
    mode: p.mode ?? d.mode,
    transitions,
    minGap: p.minGap ?? d.minGap,
    slopeBudget: p.slopeBudget ?? d.slopeBudget,
    calWidth: p.calWidth ?? d.calWidth,
    wideWidth: p.wideWidth ?? d.wideWidth,
  }
}

const RISE = 4.394449154672439 // logistic rate that makes 10% to 90% one unit wide
const step = (x: number) => 1 / (1 + Math.exp(Math.min(60, Math.max(-60, -RISE * x))))
const smoothstep01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x))

function envelopeAt(knots: ReadonlyArray<readonly [number, number]>, s0: number): number {
  if (knots.length === 0) return 0
  if (s0 <= knots[0][0]) return knots[0][1]
  for (let i = 0; i + 1 < knots.length; i++) {
    const [x0, v0] = knots[i]
    const [x1, v1] = knots[i + 1]
    if (s0 <= x1) return v0 + (v1 - v0) * smoothstep01((s0 - x0) / Math.max(1e-9, x1 - x0))
  }
  return knots[knots.length - 1][1]
}

// Catmull-Rom through evenly spaced samples over [from, to], clamped to [0, 1]; the shader does the same.
function guardAt(samples: readonly number[], from: number, to: number, a: number): number {
  const n = samples.length
  const x = Math.min(n - 1, Math.max(0, ((a - from) / Math.max(1e-9, to - from)) * (n - 1)))
  const i = Math.min(n - 2, Math.floor(x))
  const t = x - i
  const p0 = samples[Math.max(0, i - 1)]
  const p1 = samples[i]
  const p2 = samples[i + 1]
  const p3 = samples[Math.min(n - 1, i + 2)]
  const v = 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t)
  return Math.min(1, Math.max(0, v))
}

interface Terms {
  S: (a: number) => number
  I: (a: number, v: number) => number
  M: (a: number) => number
  v: (s0: number) => number
}

function terms(r: Resolved, seed: number): Terms {
  return {
    S(a) {
      let sum = 0
      let amp = 1
      let f = 1 / r.sharedScale
      for (let o = 0; o < r.octaves; o++) {
        sum += amp * gradientNoise(a * f + 0.37 + 2.9 * o, 0.5 + 4 * o, seed)
        amp *= r.gain
        f *= 2
      }
      return sum / NOISE_RMS
    },
    I(a, v) {
      let sum = 0
      let amp = 1
      let fx = 1 / r.scale
      let fy = 1 / r.ly
      for (let o = 0; o < r.octaves; o++) {
        sum += amp * gradientNoise(a * fx + 1.7 * o + 0.13, v * fy + 3.3 * o + 0.71, seed + 131 * (o + 1))
        amp *= r.gain
        fx *= 2
        fy *= 1.5
      }
      return sum / NOISE_RMS
    },
    M(a) {
      if (r.modAmount <= 0) return 1
      const n = Math.min(2.5, Math.max(-2.5, gradientNoise(a / r.modScale + 0.31, 7.5, seed + 977) / NOISE_RMS))
      return Math.max(0, 1 + r.modAmount * n)
    },
    v(s0) {
      if (r.vertical !== 'ramp') return s0
      let v = 0
      for (const t of r.transitions) v += step((s0 - t.at) / t.width)
      return v
    },
  }
}

/** The calibrated field on the CPU: the same numbers the shader computes. */
export interface BoundaryField {
  /** Coordinate mode: the move of the base coordinate, s = s0 + warp(a, s0). */
  warp(a: number, s0: number): number
  /** Edge mode: the move of transition j. */
  edge(a: number, j: number): number
  /** Softness multiplier of transition j, or of a boundary at m with width w. */
  soft(a: number, j: number): number
  softAt(a: number, m: number, w: number): number
  /** Fine feather of transition j at coordinate s, in s units. */
  feather(a: number, s: number, j: number): number
  /** Vertical noise coordinate. */
  v(s0: number): number
  /** The fold guard along the boundary. */
  guard(a: number): number
}

export interface BoundaryCalibration {
  /** Uniforms for BOUNDARY_GLSL (flat arrays, as the engine takes them). */
  uniforms: Record<string, number | number[]>
  field: BoundaryField
  report: {
    /** Requested and realized wander per knot over the frame width, after the wide-transition rule and the guard. */
    requested: number[]
    realized: number[]
    /** Lowest value of the guard along the boundary, and the share of the frame width where it is below 0.95. */
    guardMin: number
    guardShare: number
    /** Steepest negative dD/ds0 after the guard (coordinate mode), or the smallest edge gap over its need (edge mode). */
    worst: number
  }
}

const NA = 128 // columns of the calibration grids
const NS = 256 // rows of the slope grid

/**
 * Calibrates the boundary model for one frame and seed. `aspect` is width /
 * height; lengths are in short-side units, so the frame is aspect x 1 (landscape)
 * or 1 x 1 / aspect (portrait), centered on 0.
 */
export function calibrateBoundary(params: BoundaryParams, aspect: number, seed: number): BoundaryCalibration {
  const r = resolve(params)
  const seedInt = Math.round(seed) | 0
  const T = terms(r, seedInt)
  const halfW = 0.5 * Math.max(aspect, 1)
  const halfH = 0.5 * Math.max(1 / aspect, 1)
  const [sMin, sMax] = params.range ?? [-halfH, halfH]
  const columns = Array.from({ length: NA }, (_, i) => -halfW + (2 * halfW * (i + 0.5)) / NA)
  // The calibration window is at least calWidth wide, centered on the frame, so a
  // tall frame shows the middle of the same pattern instead of a squeezed copy.
  const halfCal = Math.max(halfW, r.calWidth / 2)
  const window = Array.from({ length: NA }, (_, i) => -halfCal + (2 * halfCal * (i + 0.5)) / NA)
  const spread = (f: (a: number) => number, at: readonly number[]) => {
    const v = at.map(f)
    const m = v.reduce((s, x) => s + x, 0) / v.length
    return { mean: m, sd: Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length) }
  }

  // 1. unit spread of each term over the window
  const sharedStats = spread(T.S, window)
  let iVar = 0
  let rows = 0
  for (let j = 0; j < 32; j++) {
    const s0 = sMin + ((sMax - sMin) * (j + 0.5)) / 32
    iVar += spread((a) => T.I(a, T.v(s0)), window).sd ** 2
    rows++
  }
  const cS = Math.sqrt(r.share) / Math.max(0.33, sharedStats.sd)
  const cI = Math.sqrt(1 - r.share) / Math.max(0.33, Math.sqrt(iVar / rows))
  const sMean = sharedStats.mean
  const clip = r.clip > 0 ? (x: number) => r.clip * Math.tanh(x / r.clip) : (x: number) => x
  const raw = (a: number, v: number) => T.M(a) * clip(cS * (T.S(a) - sMean) + cI * T.I(a, v))

  // 2. knots: the request, lowered on very wide transitions, then scaled so the
  // window shows that spread
  const wideFactor = (s0: number) => {
    if (!(r.wideWidth > 0) || r.transitions.length === 0) return 1
    let near = r.transitions[0]
    for (const t of r.transitions) if (Math.abs(s0 - t.at) / t.width < Math.abs(s0 - near.at) / near.width) near = t
    return Math.min(1, r.wideWidth / near.width)
  }
  const wanted = params.wander.slice(0, BOUNDARY_MAX_KNOTS).map(([s0, sd]) => [s0, Math.max(0, sd) * wideFactor(s0)] as [number, number])
  wanted.sort((x, y) => x[0] - y[0])
  const knots = wanted.map(([s0, sd]) => {
    const got = spread((a) => raw(a, T.v(s0)), window).sd
    return [s0, got > 1e-9 ? sd / got : 0] as [number, number]
  })
  const E = (s0: number) => envelopeAt(knots, s0)

  // 3. guard along the boundary: how much each column must be calmed
  const need = new Array<number>(NA).fill(1)
  if (r.mode === 'edges') {
    // neighbouring edges keep at least minGap of their mean width between them
    const edges = r.transitions
    for (let j = 0; j + 1 < edges.length; j++) {
      const e0 = edges[j]
      const e1 = edges[j + 1]
      const gap0 = e1.at - e0.at
      const minGap = (r.minGap * (e0.width + e1.width)) / 2
      for (let i = 0; i < NA; i++) {
        const a = columns[i]
        const closing = E(e0.at) * raw(a, T.v(e0.at)) - E(e1.at) * raw(a, T.v(e1.at))
        if (closing > 0 && gap0 - closing < minGap) need[i] = Math.min(need[i], Math.max(0, (gap0 - minGap) / closing))
      }
    }
  } else {
    // the steepest negative dD/ds0 in each column stays at or above -0.9 * slopeBudget
    const ds = (sMax - sMin) / NS
    for (let i = 0; i < NA; i++) {
      const a = columns[i]
      let prev = E(sMin) * raw(a, T.v(sMin))
      let lowest = 0
      for (let k = 1; k <= NS; k++) {
        const s0 = sMin + k * ds
        const d = E(s0) * raw(a, T.v(s0))
        lowest = Math.min(lowest, (d - prev) / ds)
        prev = d
      }
      if (-lowest > 0.9 * r.slopeBudget) need[i] = (0.9 * r.slopeBudget) / -lowest
    }
  }
  const G = BOUNDARY_GUARD_SAMPLES
  const sampleAt = (k: number) => -halfW + (2 * halfW * k) / (G - 1)
  const spacing = (2 * halfW) / (G - 1)
  const samples = Array.from({ length: G }, (_, k) => {
    let m = 1
    for (let i = 0; i < NA; i++) if (Math.abs(columns[i] - sampleAt(k)) <= spacing) m = Math.min(m, need[i])
    return m
  })
  // the smooth curve through the samples can overshoot between them; lower the
  // samples around any column it exceeds until it holds everywhere
  for (let iter = 0; iter < 40; iter++) {
    let ok = true
    for (let i = 0; i < NA; i++) {
      const g = guardAt(samples, -halfW, halfW, columns[i])
      if (g <= need[i] * 1.0001) continue
      ok = false
      const x = ((columns[i] + halfW) / (2 * halfW)) * (G - 1)
      const k0 = Math.max(0, Math.floor(x) - 1)
      const k1 = Math.min(G - 1, Math.ceil(x) + 1)
      for (let k = k0; k <= k1; k++) samples[k] *= Math.max(0.5, (need[i] / g) * 0.98)
    }
    if (ok) break
  }
  const guard = (a: number) => guardAt(samples, -halfW, halfW, a)

  // 4. feather: its slope is amount * 9.5 / ly whatever the width; keep it under 0.5
  const featherWorst = (Math.abs(r.feather.amount) * NOISE_SLOPE_MAX) / Math.max(1e-6, r.feather.ly)
  const featherAmount = featherWorst > 0.5 ? (r.feather.amount * 0.5) / featherWorst : r.feather.amount

  const softAt = (a: number, m: number, w: number) => {
    if (!(r.soft.amount > 0)) return 1
    const amount = r.soft.wRef > 0 && w > r.soft.wRef ? (r.soft.amount * r.soft.wRef) / w : r.soft.amount
    const n = Math.min(2.5, Math.max(-2.5, gradientNoise(a / r.soft.scale + 5.1, m / r.soft.ly + 2.3, seedInt + 577) / NOISE_RMS))
    return Math.exp(amount * n)
  }
  const transitionV = r.transitions.map((t) => T.v(t.at))
  const field: BoundaryField = {
    warp: (a, s0) => guard(a) * E(s0) * raw(a, T.v(s0)),
    edge: (a, j) => guard(a) * E(r.transitions[j].at) * raw(a, transitionV[j]),
    soft: (a, j) => softAt(a, r.transitions[j].at, r.transitions[j].width),
    softAt,
    feather(a, s, j) {
      if (!(featherAmount > 0)) return 0
      const t = r.transitions[j]
      const n = gradientNoise(a / r.feather.scale + 9.7 + 3.3 * j, (s - t.at) / (r.feather.ly * t.width) + 4.1, seedInt + 733 + 17 * j) / NOISE_RMS
      return featherAmount * t.width * n
    },
    v: T.v,
    guard,
  }

  // report
  const realized = wanted.map(([s0]) => spread((a) => field.warp(a, s0), columns).sd)
  let worst = 0
  if (r.mode === 'edges') {
    worst = Infinity
    for (let j = 0; j + 1 < r.transitions.length; j++) {
      const minGap = (r.minGap * (r.transitions[j].width + r.transitions[j + 1].width)) / 2
      for (const a of columns) worst = Math.min(worst, (r.transitions[j + 1].at + field.edge(a, j + 1) - r.transitions[j].at - field.edge(a, j)) / minGap)
    }
    if (!Number.isFinite(worst)) worst = 0
  } else {
    const ds = (sMax - sMin) / NS
    for (const a of columns) {
      let prev = field.warp(a, sMin)
      for (let k = 1; k <= NS; k++) {
        const d = field.warp(a, sMin + k * ds)
        worst = Math.min(worst, (d - prev) / ds)
        prev = d
      }
    }
  }
  const guardValues = columns.map(guard)

  const knotsFlat = Array.from({ length: BOUNDARY_MAX_KNOTS }, (_, k) => knots[Math.min(k, knots.length - 1)] ?? [0, 0]).flat()
  const trans = Array.from({ length: BOUNDARY_MAX_TRANSITIONS }, (_, j) => {
    const t = r.transitions[j]
    return t ? [t.at, t.width, transitionV[j], 0] : [0, 1, 0, 0]
  }).flat()
  return {
    uniforms: {
      uBndSeed: seedInt,
      uBndShared: [cS, 1 / r.sharedScale, sMean, r.octaves],
      uBndWarp: [cI, 1 / r.scale, 1 / r.ly, r.octaves],
      uBndShape: [r.gain, r.clip, r.modAmount, 1 / r.modScale],
      uBndKnotCount: knots.length,
      uBndKnots: knotsFlat,
      uBndGuard: samples.slice(),
      uBndGuardSpan: [-halfW, halfW],
      uBndSoft: [r.soft.amount, 1 / r.soft.scale, 1 / r.soft.ly, r.soft.wRef],
      uBndFeather: [featherAmount, 1 / r.feather.scale, r.feather.ly],
      uBndTransCount: r.transitions.length,
      uBndTrans: trans,
      uBndVertical: r.vertical === 'ramp' ? 1 : 0,
    },
    field,
    report: {
      requested: wanted.map(([, sd]) => sd),
      realized,
      guardMin: Math.min(...guardValues),
      guardShare: guardValues.filter((g) => g < 0.95).length / guardValues.length,
      worst,
    },
  }
}

// ---------------------------------------------------------------- shader

/**
 * The model for the shader. Needs the engine's chunk library (gradientNoise),
 * which the engine prepends to every recipe fragment. Set the uniforms from
 * `calibrateBoundary(...).uniforms`.
 *
 * - coordinate mode: `float s = s0 + boundaryWarp(a, s0);` then each transition j
 *   is `boundaryRise((s - at_j) / (width_j * boundarySoft(a, j)))`;
 * - edge mode: transition j sits at `at_j + boundaryEdge(a, j)`;
 * - `boundaryFeather(a, s, j)` adds a fine feather to transition j (print looks).
 */
export const BOUNDARY_GLSL = /* glsl */ `
#define BND_KNOTS ${BOUNDARY_MAX_KNOTS}
#define BND_GUARD ${BOUNDARY_GUARD_SAMPLES}
#define BND_TRANS ${BOUNDARY_MAX_TRANSITIONS}

uniform int uBndSeed;
uniform vec4 uBndShared;          // cS, 1 / shared lattice, frame mean of the shared noise, octaves
uniform vec4 uBndWarp;            // cI, 1 / lattice along, 1 / vertical lattice, octaves
uniform vec4 uBndShape;           // octave gain, soft clip (0: off), change along the boundary, 1 / its length
uniform int uBndKnotCount;
uniform vec2 uBndKnots[BND_KNOTS];      // amplitude knots down the ramp: s0, amplitude
uniform float uBndGuard[BND_GUARD];     // fold guard along the boundary, evenly spaced over uBndGuardSpan
uniform vec2 uBndGuardSpan;
uniform vec4 uBndSoft;            // amount, 1 / lattice along, 1 / vertical lattice, width above which the amount shrinks
uniform vec3 uBndFeather;         // amount, 1 / lattice along, height of its noise in widths
uniform int uBndTransCount;
uniform vec4 uBndTrans[BND_TRANS];      // per transition: position, 10-90 width, its noise row, 0
uniform int uBndVertical;         // 1: the noise row counts transitions passed; 0: it is s0

const float BND_RMS = 0.3052;
const float BND_RISE = 4.394449154672439;

// Logistic that rises from 10% to 90% over one unit.
float boundaryRise(float x) { return 1.0 / (1.0 + exp(clamp(-BND_RISE * x, -60.0, 60.0))); }

float boundaryEnvelope(float s0) {
  if (uBndKnotCount <= 0) return 0.0;
  if (s0 <= uBndKnots[0].x) return uBndKnots[0].y;
  for (int i = 0; i + 1 < BND_KNOTS; i++) {
    if (i + 1 >= uBndKnotCount) break;
    vec2 k0 = uBndKnots[i];
    vec2 k1 = uBndKnots[i + 1];
    if (s0 <= k1.x) return mix(k0.y, k1.y, smoothstep(0.0, 1.0, (s0 - k0.x) / max(1e-9, k1.x - k0.x)));
  }
  return uBndKnots[uBndKnotCount - 1].y;
}

float boundaryGuard(float a) {
  float x = clamp((a - uBndGuardSpan.x) / max(1e-9, uBndGuardSpan.y - uBndGuardSpan.x), 0.0, 1.0) * float(BND_GUARD - 1);
  int i = min(BND_GUARD - 2, int(floor(x)));
  float t = x - float(i);
  float p0 = uBndGuard[max(0, i - 1)];
  float p1 = uBndGuard[i];
  float p2 = uBndGuard[i + 1];
  float p3 = uBndGuard[min(BND_GUARD - 1, i + 2)];
  float v = 0.5 * (2.0 * p1 + (p2 - p0) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t * t + (3.0 * p1 - p0 - 3.0 * p2 + p3) * t * t * t);
  return clamp(v, 0.0, 1.0);
}

float boundaryShared(float a) {
  float sum = 0.0;
  float amp = 1.0;
  float f = uBndShared.y;
  for (int o = 0; o < 3; o++) {
    if (float(o) >= uBndShared.w) break;
    sum += amp * gradientNoise(vec2(a * f + 0.37 + 2.9 * float(o), 0.5 + 4.0 * float(o)), uBndSeed);
    amp *= uBndShape.x;
    f *= 2.0;
  }
  return sum / BND_RMS - uBndShared.z;
}

float boundaryNoise(float a, float v) {
  float sum = 0.0;
  float amp = 1.0;
  vec2 f = uBndWarp.yz;
  for (int o = 0; o < 3; o++) {
    if (float(o) >= uBndWarp.w) break;
    sum += amp * gradientNoise(vec2(a * f.x + 1.7 * float(o) + 0.13, v * f.y + 3.3 * float(o) + 0.71), uBndSeed + 131 * (o + 1));
    amp *= uBndShape.x;
    f *= vec2(2.0, 1.5);
  }
  return sum / BND_RMS;
}

float boundaryAlong(float a) {
  if (uBndShape.z <= 0.0) return 1.0;
  float n = clamp(gradientNoise(vec2(a * uBndShape.w + 0.31, 7.5), uBndSeed + 977) / BND_RMS, -2.5, 2.5);
  return max(0.0, 1.0 + uBndShape.z * n);
}

// Vertical noise coordinate: the number of transitions passed (ramp mode) or s0.
float boundaryV(float s0) {
  if (uBndVertical == 0) return s0;
  float v = 0.0;
  for (int j = 0; j < BND_TRANS; j++) {
    if (j >= uBndTransCount) break;
    v += boundaryRise((s0 - uBndTrans[j].x) / uBndTrans[j].y);
  }
  return v;
}

float boundaryRaw(float a, float v) {
  float d = uBndShared.x * boundaryShared(a) + uBndWarp.x * boundaryNoise(a, v);
  if (uBndShape.y > 0.0) d = uBndShape.y * tanh(d / uBndShape.y);
  return boundaryAlong(a) * d;
}

// Coordinate mode: s = s0 + boundaryWarp(a, s0).
float boundaryWarp(float a, float s0) {
  return boundaryGuard(a) * boundaryEnvelope(s0) * boundaryRaw(a, boundaryV(s0));
}

// Edge mode: transition j sits at uBndTrans[j].x + boundaryEdge(a, j).
float boundaryEdge(float a, int j) {
  vec4 t = uBndTrans[j];
  return boundaryGuard(a) * boundaryEnvelope(t.x) * boundaryRaw(a, t.z);
}

// Softness multiplier for a boundary at m with 10-90 width w.
float boundarySoftAt(float a, float m, float w) {
  if (uBndSoft.x <= 0.0) return 1.0;
  float amount = (uBndSoft.w > 0.0 && w > uBndSoft.w) ? uBndSoft.x * uBndSoft.w / w : uBndSoft.x;
  float n = clamp(gradientNoise(vec2(a * uBndSoft.y + 5.1, m * uBndSoft.z + 2.3), uBndSeed + 577) / BND_RMS, -2.5, 2.5);
  return exp(amount * n);
}

float boundarySoft(float a, int j) { return boundarySoftAt(a, uBndTrans[j].x, uBndTrans[j].y); }

// Fine feather of transition j at coordinate s, in s units.
float boundaryFeather(float a, float s, int j) {
  if (uBndFeather.x <= 0.0) return 0.0;
  vec4 t = uBndTrans[j];
  vec2 q = vec2(a * uBndFeather.y + 9.7 + 3.3 * float(j), (s - t.x) / (uBndFeather.z * t.y) + 4.1);
  return uBndFeather.x * t.y * gradientNoise(q, uBndSeed + 733 + 17 * j) / BND_RMS;
}
`
