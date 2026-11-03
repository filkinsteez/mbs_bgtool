/**
 * Shared boundary model for the Sunset recipes (ramp, bands, blooms) and the
 * soft sides of Contour glows. Measured and prototyped in
 * prototypes/organic-boundaries (README there).
 *
 * A recipe gives, per pixel, a coordinate along its boundaries `a` and a base
 * coordinate across them `s0`, both in short-side units, with s0 increasing
 * from the first color to the last. The model moves the boundaries:
 *
 *   D(a, s0) = G(a) * E(s0) * F(s0) * M(a) * clip(cS * (S(a) - mean) + cI * I(a, v(s0)))
 *
 * - S: 1D noise along the boundary, the same for every boundary.
 * - I: 2D noise stretched along the boundary; v is s0 (distance mode) or the
 *   number of transitions passed (ramp mode), so isolines inside one transition
 *   move together and the next transition gets its own shape.
 * - M: makes the waviness come and go along the boundary.
 * - E: amplitude down the ramp, through knots.
 * - F: amplitude per transition, lowered where its bumps would be too steep.
 * - clip: c * tanh(x / c); no rare deep dips, flat stretches between rises.
 * - G: fold guard along the boundary. It is 1 except where the field would be
 *   too steep, so only that part of the frame is calmed, and it changes slowly
 *   along the boundary so it never cuts a shape out of it.
 *
 * An edge whose far side is much darker (a light sky over a dark ground) reads
 * as a silhouette if it has sharp crests or short bumps. Such a transition
 * (`contrast`) moves as one piece, loses most of its short waves, is softer at
 * its crests and is held to a gentler steepest slope.
 *
 * `calibrateBoundary` runs once per render on the CPU. It scales each term to
 * the requested wander for this seed and frame, lowers the wander on very
 * wide transitions, lowers each transition's amplitude until its bumps in the
 * frame are long enough, and sets G from the steepest slope found on a grid.
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

// The calibration reads the same few thousand noise cells many times, and a slider
// drag reads them again for every new set of params. Each cell's four corner
// gradients are kept per seed, so the noise below is gradientNoise to the last bit
// without its hashes and trigonometry.
const CELL_LIMIT = 400_000
let cells = new Map<number, Float64Array>()

function cellCorners(ix: number, iy: number, seed: number): Float64Array {
  const a00 = hash1(ix, iy, seed) * TAU
  const a10 = hash1(ix + 1, iy, seed) * TAU
  const a01 = hash1(ix, iy + 1, seed) * TAU
  const a11 = hash1(ix + 1, iy + 1, seed) * TAU
  return Float64Array.of(Math.cos(a00), Math.sin(a00), Math.cos(a10), Math.sin(a10), Math.cos(a01), Math.sin(a01), Math.cos(a11), Math.sin(a11))
}

function cellOf(ix: number, iy: number, seed: number): Float64Array {
  if (ix < -32768 || ix > 32767 || iy < -32768 || iy > 32767 || seed < 0 || seed > 1048575) return cellCorners(ix, iy, seed)
  const key = seed * 4294967296 + (ix + 32768) * 65536 + (iy + 32768)
  let c = cells.get(key)
  if (c === undefined) {
    c = cellCorners(ix, iy, seed)
    if (cells.size >= CELL_LIMIT) cells = new Map()
    cells.set(key, c)
  }
  return c
}

function cornersNoise(c: Float64Array, fx: number, fy: number, ux: number, uy: number): number {
  const n00 = c[0] * fx + c[1] * fy
  const n10 = c[2] * (fx - 1) + c[3] * fy
  const n01 = c[4] * fx + c[5] * (fy - 1)
  const n11 = c[6] * (fx - 1) + c[7] * (fy - 1)
  const nx0 = n00 + (n10 - n00) * ux
  const nx1 = n01 + (n11 - n01) * ux
  return 1.41421356 * (nx0 + (nx1 - nx0) * uy)
}

/** gradientNoise, with each cell's corner gradients cached. */
function noise(px: number, py: number, seed: number): number {
  const ix = Math.floor(px)
  const iy = Math.floor(py)
  const fx = px - ix
  const fy = py - iy
  return cornersNoise(cellOf(ix, iy, seed), fx, fy, quintic(fx), quintic(fy))
}

/**
 * gradientNoise at one fixed px for any py: the x part is worked out once, and for
 * the last cell its corners' x products (the first terms of cornersNoise's sums).
 */
class NoiseColumn {
  private readonly seed: number
  private readonly ix: number
  private readonly fx: number
  private readonly ux: number
  private iy = NaN
  private c: Float64Array = new Float64Array(8)
  private x00 = 0
  private x10 = 0
  private x01 = 0
  private x11 = 0
  constructor(px: number, seed: number) {
    this.seed = seed
    this.ix = Math.floor(px)
    this.fx = px - this.ix
    this.ux = quintic(this.fx)
  }
  at(py: number): number {
    const iy = Math.floor(py)
    return this.atCell(iy, py - iy, quintic(py - iy))
  }
  /** The same, with the row's cell, offset in it and fade already worked out. */
  atCell(iy: number, fy: number, uy: number): number {
    if (iy !== this.iy) {
      this.iy = iy
      const c = (this.c = cellOf(this.ix, iy, this.seed))
      this.x00 = c[0] * this.fx
      this.x10 = c[2] * (this.fx - 1)
      this.x01 = c[4] * this.fx
      this.x11 = c[6] * (this.fx - 1)
    }
    const c = this.c
    const n00 = this.x00 + c[1] * fy
    const n10 = this.x10 + c[3] * fy
    const n01 = this.x01 + c[5] * (fy - 1)
    const n11 = this.x11 + c[7] * (fy - 1)
    const nx0 = n00 + (n10 - n00) * this.ux
    const nx1 = n01 + (n11 - n01) * this.ux
    return 1.41421356 * (nx0 + (nx1 - nx0) * uy)
  }
}

// ---------------------------------------------------------------- parameters

/** One transition between two colors: its position on s0 and its 10-90 width. */
export interface BoundaryTransition {
  at: number
  width: number
  /**
   * How much darker the far side is: (Y before - Y after) / the larger of the
   * two, from the linear luminance of the colors on each side (see
   * `boundaryContrast`). Positive when the color after the transition (larger
   * s0, a ground under a sky) is darker. From 0.3 to 0.8 the transition is
   * treated more and more as a silhouette edge (see the module comment);
   * negative values change nothing. Default 0.
   */
  contrast?: number
}

export interface BoundaryParams {
  /**
   * Requested wander, [s0, spread] knots: the standard deviation of a boundary's
   * position across the calibration window, in short-side units. Smooth between
   * knots, flat beyond the first and last. At most 8 knots. The bump rule and
   * the fold guard can lower it; `report` gives what each frame gets.
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
  /** The recipe's transitions, in order of `at`; needed for ramp mode, edge mode and the per-transition rules. At most 16. */
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

/**
 * How long the bumps of every transition's 50% line must be, measured in the
 * frame (calibrateBoundary lowers the transition's amplitude until they are):
 * - `aspect`: the audit's bump aspect, main wavelength over 2 sqrt(2) times the
 *   wiggle RMS, for lines wiggling more than 0.3% of the frame height (the
 *   audit's band is 10; this leaves room for measuring from pixels);
 * - `flank`: every single rise or fall between turning points, 2 x run / rise;
 * - `steep`, `steepDark`: pi / steepest slope (a sine's bump aspect at its
 *   steepest point), for any edge and for an edge whose far side is much darker.
 */
export const BOUNDARY_BUMPS = { aspect: 12, flank: 10, steep: 5, steepDark: 10 }

/** `BoundaryTransition.contrast` from the linear luminance of the colors before and after a transition. */
export function boundaryContrast(lumBefore: number, lumAfter: number): number {
  const m = Math.max(lumBefore, lumAfter)
  return m > 0 ? (lumBefore - lumAfter) / m : 0
}

// Silhouette edges: the color after the edge is darker (a ground under a sky).
// Strength k grows from contrast 0.3 to 0.8. Within DARK_ZONE widths of the edge
// (less if a neighbour is close) the boundary follows the same noise stretched
// (1 + DARK_STRETCH k) times along the edge, with 1 - DARK_DETAIL k of its finer
// octaves, read at the edge's own row: longer waves, and the edge moves as one
// piece. The change back to the usual field happens over one more width, in the
// flat color beside it. Its softness noise is calmed by DARK_SOFT_CALM k and its
// width grows by exp(DARK_CREST k (crest - mean)), the crest height in spreads.
const DARK_FROM = 0.3
const DARK_FULL = 0.8
const DARK_ZONE = 1.2
const DARK_STRETCH = 0.4
const DARK_DETAIL = 0.7
const DARK_SOFT_CALM = 0.65
const DARK_CREST = 0.24
const AUDIT_WIGGLE = 0.003 // the audit measures bump aspect above 0.3% of the frame height wiggle
const FLANK_RISE = 0.002 // rises below 0.2% of the frame height are not bumps
const GUARD_REACH = 0.6 // the guard dips no narrower than this share of the lattice on either side

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
  transitions: Array<{ at: number; width: number; contrast: number }>
  minGap: number
  slopeBudget: number
  calWidth: number
  wideWidth: number
}

function resolve(p: BoundaryParams): Resolved {
  const d = BOUNDARY_DEFAULTS
  const transitions = (p.transitions ?? []).slice(0, BOUNDARY_MAX_TRANSITIONS).map((t) => ({
    at: t.at,
    width: Math.max(1e-4, t.width),
    contrast: Math.min(1, Math.max(-1, t.contrast ?? 0)),
  }))
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
const smoothstep = (e0: number, e1: number, x: number) => smoothstep01((x - e0) / (e1 - e0))
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

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

interface Dark {
  /** 0..1: how much this transition is treated as a silhouette edge. */
  k: number
  /** Half-height of the zone where the boundary follows the edge's own long wave. */
  zone: number
}

function darkEdges(tr: Resolved['transitions']): Dark[] {
  return tr.map((t, j) => {
    const k = clamp01((t.contrast - DARK_FROM) / (DARK_FULL - DARK_FROM))
    const up = j > 0 ? t.at - tr[j - 1].at : Infinity
    const down = j + 1 < tr.length ? tr[j + 1].at - t.at : Infinity
    return { k, zone: Math.max(1e-4, Math.min(DARK_ZONE * t.width, 0.45 * Math.min(up, down))) }
  })
}

interface Terms {
  /** `detail` weighs the octaves after the first (1: all of them). */
  S: (a: number, detail?: number) => number
  I: (a: number, v: number, detail?: number) => number
  M: (a: number) => number
  v: (s0: number) => number
}

function terms(r: Resolved, seed: number): Terms {
  return {
    S(a, detail = 1) {
      let sum = 0
      let amp = 1
      let f = 1 / r.sharedScale
      for (let o = 0; o < r.octaves; o++) {
        sum += amp * (o === 0 ? 1 : detail) * noise(a * f + 0.37 + 2.9 * o, 0.5 + 4 * o, seed)
        amp *= r.gain
        f *= 2
      }
      return sum / NOISE_RMS
    },
    I(a, v, detail = 1) {
      let sum = 0
      let amp = 1
      let fx = 1 / r.scale
      let fy = 1 / r.ly
      for (let o = 0; o < r.octaves; o++) {
        sum += amp * (o === 0 ? 1 : detail) * noise(a * fx + 1.7 * o + 0.13, v * fy + 3.3 * o + 0.71, seed + 131 * (o + 1))
        amp *= r.gain
        fx *= 2
        fy *= 1.5
      }
      return sum / NOISE_RMS
    },
    M(a) {
      if (r.modAmount <= 0) return 1
      const n = Math.min(2.5, Math.max(-2.5, noise(a / r.modScale + 0.31, 7.5, seed + 977) / NOISE_RMS))
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

// ---------------------------------------------------------------- bump measures

// Sample positions in -1..1, their powers and the DCT's cosines for a line of n
// samples, worked out once per n.
interface LineTables {
  xs: number[]
  powers: number[][]
  cosines: Float64Array
}
const lineTables = new Map<number, LineTables>()
function tablesFor(n: number): LineTables {
  let t = lineTables.get(n)
  if (!t) {
    const xs = Array.from({ length: n }, (_, i) => ((i + 0.5) / n) * 2 - 1)
    const cosines = new Float64Array(64 * n)
    for (let k = 0; k < Math.min(64, n); k++) for (let i = 0; i < n; i++) cosines[k * n + i] = Math.cos((Math.PI * k * (i + 0.5)) / n)
    t = { xs, powers: xs.map((x) => [x ** 0, x ** 1, x ** 2]), cosines }
    lineTables.set(n, t)
  }
  return t
}

function polyfit(xs: readonly number[], ys: readonly number[], degree: number, powers?: readonly number[][]): number[] {
  const n = degree + 1
  const M = Array.from({ length: n }, () => new Array<number>(n + 1).fill(0))
  for (let i = 0; i < xs.length; i++) {
    const p = powers ? powers[i] : Array.from({ length: n }, (_, k) => xs[i] ** k)
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) M[r][c] += p[r] * p[c]
      M[r][n] += p[r] * ys[i]
    }
  }
  for (let c = 0; c < n; c++) {
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c] / M[c][c]
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  return Array.from({ length: n }, (_, k) => M[k][n] / M[k][k])
}

// DCT-II component with the largest amplitude, from kMin up.
function dominantK(v: readonly number[], kMin: number): number {
  const n = v.length
  const cosines = tablesFor(n).cosines
  let best = kMin
  let bestAmp = -1
  for (let k = kMin; k < Math.min(64, n); k++) {
    let s = 0
    for (let i = 0; i < n; i++) s += v[i] * cosines[k * n + i]
    if (Math.abs(s) > bestAmp) {
      bestAmp = Math.abs(s)
      best = k
    }
  }
  return best
}

/** Bump numbers of one boundary line, y(a) sampled evenly across the frame (short-side units). */
export interface BoundaryBumps {
  /** The audit's bump aspect: main wavelength / (2 sqrt 2 wiggle RMS); Infinity below 0.3% of the frame height wiggle. */
  aspect: number
  /** The steepest single rise or fall between turning points: 2 run / rise. */
  flank: number
  /** pi / steepest slope. */
  steep: number
}

export function boundaryBumps(y: readonly number[], span: number, frameHeight: number): BoundaryBumps {
  const n = y.length
  const { xs, powers } = tablesFor(n)
  const lin = polyfit(xs, y, 1, powers)
  const quad = polyfit(xs, y, 2, powers)
  const detr = y.map((v, i) => v - lin[0] - lin[1] * xs[i])
  const resid = y.map((v, i) => v - quad[0] - quad[1] * xs[i] - quad[2] * xs[i] * xs[i])
  const sigma = Math.sqrt(resid.reduce((s, v) => s + v * v, 0) / n)
  let aspect = Infinity
  if (sigma > AUDIT_WIGGLE * frameHeight) {
    const k = Math.max(dominantK(detr, 2), dominantK(resid, 1))
    aspect = (2 * span) / k / (2 * Math.SQRT2 * sigma)
  }
  // flank and steepest slope on the line smoothed over about 1% of the width
  const s = y.map((_, i) => 0.25 * y[Math.max(0, i - 1)] + 0.5 * y[i] + 0.25 * y[Math.min(n - 1, i + 1)])
  const dx = span / n
  let steepest = 0
  for (let i = 1; i < n; i++) steepest = Math.max(steepest, Math.abs(s[i] - s[i - 1]) / dx)
  const tol = FLANK_RISE * frameHeight
  const turns = [0]
  let dir = 0
  let ext = 0
  for (let i = 1; i < n; i++) {
    if (dir >= 0 && s[i] > s[ext]) ext = i
    else if (dir <= 0 && s[i] < s[ext]) ext = i
    if (dir >= 0 && s[ext] - s[i] > tol) {
      if (turns[turns.length - 1] !== ext) turns.push(ext)
      dir = -1
      ext = i
    } else if (dir <= 0 && s[i] - s[ext] > tol) {
      if (turns[turns.length - 1] !== ext) turns.push(ext)
      dir = 1
      ext = i
    }
  }
  if (turns[turns.length - 1] !== n - 1) turns.push(n - 1)
  let flank = Infinity
  for (let k = 0; k + 1 < turns.length; k++) {
    const rise = Math.abs(s[turns[k + 1]] - s[turns[k]])
    if (rise >= tol) flank = Math.min(flank, (2 * (turns[k + 1] - turns[k]) * dx) / rise)
  }
  return { aspect, flank, steep: steepest > 0 ? Math.PI / steepest : Infinity }
}

// ---------------------------------------------------------------- calibration

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
    /** Requested and realized wander per knot over the frame width, after the wide-transition rule, the bump rule and the guard. */
    requested: number[]
    realized: number[]
    /** Lowest value of the guard along the boundary, and the share of the frame width where it is below 0.95. */
    guardMin: number
    guardShare: number
    /** Steepest negative dD/ds0 after the guard (coordinate mode), or the smallest edge gap over its need (edge mode). */
    worst: number
    /** Amplitude scale per transition from the bump rule (1: untouched). */
    scale: number[]
    /** Lowest bump numbers over the transitions' 50% lines in the frame (see BOUNDARY_BUMPS). */
    bumps: BoundaryBumps
  }
}

const NA = 128 // columns of the calibration grids
const NS = 256 // rows of the slope grid
const NB = 160 // columns of the bump measure

/**
 * Calibrates the boundary model for one frame and seed. `aspect` is width /
 * height; lengths are in short-side units, so the frame is aspect x 1 (landscape)
 * or 1 x 1 / aspect (portrait), centered on 0.
 */
export function calibrateBoundary(params: BoundaryParams, aspect: number, seed: number): BoundaryCalibration {
  const r = resolve(params)
  const seedInt = Math.round(seed) | 0
  const tr = r.transitions
  const nT = tr.length
  const dark = darkEdges(tr)
  const T = terms(r, seedInt)
  const halfW = 0.5 * Math.max(aspect, 1)
  const halfH = 0.5 * Math.max(1 / aspect, 1)
  const frameHeight = 2 * halfH
  const [sMin, sMax] = params.range ?? [-halfH, halfH]
  const clip = r.clip > 0 ? (x: number) => r.clip * Math.tanh(x / r.clip) : (x: number) => x
  const transitionV = tr.map((t) => T.v(t.at))
  const G = BOUNDARY_GUARD_SAMPLES

  // What the field is made of. `rules` below sets it; the field keeps only this, so
  // the grids and tables the rules use are freed once they are done.
  let cS = 0
  let cI = 0
  let sMean = 0
  let knots: [number, number][] = []
  const scale = new Array<number>(nT).fill(1)
  let samples = new Array<number>(G).fill(1)
  const crestScale = new Array<number>(nT).fill(0)
  const crestMean = new Array<number>(nT).fill(0)

  const E = (s0: number) => envelopeAt(knots, s0)
  const scaleAt = (s0: number) => {
    if (nT === 0) return 1
    if (s0 <= tr[0].at) return scale[0]
    for (let j = 0; j + 1 < nT; j++) {
      if (s0 <= tr[j + 1].at) return scale[j] + (scale[j + 1] - scale[j]) * smoothstep01((s0 - tr[j].at) / Math.max(1e-9, tr[j + 1].at - tr[j].at))
    }
    return scale[nT - 1]
  }
  const guard = (a: number) => guardAt(samples, -halfW, halfW, a)
  // the silhouette edge whose zone s0 is in (the strongest one), and how far in; into
  // darkW and darkJ, so the many calls make no garbage
  let darkW = 0
  let darkJ = -1
  const darkInto = (s0: number) => {
    darkW = 0
    darkJ = -1
    for (let j = 0; j < nT; j++) {
      if (!(dark[j].k > 0)) continue
      const o = dark[j].k * (1 - smoothstep(dark[j].zone, dark[j].zone + tr[j].width, Math.abs(s0 - tr[j].at)))
      if (o > darkW) {
        darkW = o
        darkJ = j
      }
    }
  }
  const raw = (a: number, v: number, detail = 1) => T.M(a) * clip(cS * (T.S(a, detail) - sMean) + cI * T.I(a, v, detail))
  // the edge's own long wave: the same noise stretched along it, at its own row
  const pieceRaw = (a: number, jd: number) => raw(a / (1 + DARK_STRETCH * dark[jd].k), transitionV[jd], 1 - DARK_DETAIL * dark[jd].k)
  // The move at s0 with noise row v, before the guard. In a silhouette edge's zone
  // it blends toward that edge's long wave at the edge's own amplitude, so the
  // whole edge moves as one piece.
  const move = (a: number, s0: number, v: number) => {
    const d = E(s0) * scaleAt(s0) * raw(a, v)
    darkInto(s0)
    const w = darkW
    const jd = darkJ
    if (jd < 0) return d
    return d + (E(tr[jd].at) * scale[jd] * pieceRaw(a, jd) - d) * w
  }
  const edgeMove = (a: number, j: number) => guard(a) * move(a, tr[j].at, transitionV[j])
  const warp = (a: number, s0: number) => guard(a) * move(a, s0, T.v(s0))
  const softNoise = (a: number, m: number, w: number, calm: number) => {
    if (!(r.soft.amount > 0)) return 1
    const amount = r.soft.wRef > 0 && w > r.soft.wRef ? (r.soft.amount * r.soft.wRef) / w : r.soft.amount
    const n = Math.min(2.5, Math.max(-2.5, noise(a / r.soft.scale + 5.1, m / r.soft.ly + 2.3, seedInt + 577) / NOISE_RMS))
    return Math.exp(amount * calm * n)
  }
  const softFor = (a: number, j: number) => {
    const k = dark[j].k
    const s = softNoise(a, tr[j].at, tr[j].width, 1 - DARK_SOFT_CALM * k)
    if (!(k > 0)) return s
    const crest = Math.min(2.5, Math.max(0, crestScale[j] * edgeMove(a, j)))
    return s * Math.exp(DARK_CREST * k * (crest - crestMean[j]))
  }

  const { wanted, realized, worst, guardValues, bumps } = rules()

  // 5. feather: its slope is amount * 9.5 / ly whatever the width; keep it under 0.5
  const featherWorst = (Math.abs(r.feather.amount) * NOISE_SLOPE_MAX) / Math.max(1e-6, r.feather.ly)
  const featherAmount = featherWorst > 0.5 ? (r.feather.amount * 0.5) / featherWorst : r.feather.amount

  const field: BoundaryField = {
    warp,
    edge: edgeMove,
    soft: softFor,
    softAt: (a, m, w) => softNoise(a, m, w, 1),
    feather(a, s, j) {
      if (!(featherAmount > 0)) return 0
      const t = tr[j]
      const n = noise(a / r.feather.scale + 9.7 + 3.3 * j, (s - t.at) / (r.feather.ly * t.width) + 4.1, seedInt + 733 + 17 * j) / NOISE_RMS
      return featherAmount * t.width * n
    },
    v: T.v,
    guard,
  }

  const knotsFlat = Array.from({ length: BOUNDARY_MAX_KNOTS }, (_, k) => knots[Math.min(k, knots.length - 1)] ?? [0, 0]).flat()
  const trans = Array.from({ length: BOUNDARY_MAX_TRANSITIONS }, (_, j) => {
    const t = tr[j]
    return t ? [t.at, t.width, transitionV[j], scale[j]] : [0, 1, 0, 1]
  }).flat()
  const darkFlat = Array.from({ length: BOUNDARY_MAX_TRANSITIONS }, (_, j) => (tr[j] ? [dark[j].k, dark[j].zone, crestScale[j], crestMean[j]] : [0, 1, 0, 0])).flat()
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
      uBndTransCount: nT,
      uBndTrans: trans,
      uBndDark: darkFlat,
      uBndVertical: r.vertical === 'ramp' ? 1 : 0,
    },
    field,
    report: {
      requested: wanted.map(([, sd]) => sd),
      realized,
      guardMin: Math.min(...guardValues),
      guardShare: guardValues.filter((g) => g < 0.95).length / guardValues.length,
      worst,
      scale: scale.slice(),
      bumps,
    },
  }

  // Steps 1 to 4 and the report's numbers, on columns and grids that live only here.
  function rules() {
    const columns = Array.from({ length: NA }, (_, i) => -halfW + (2 * halfW * (i + 0.5)) / NA)
    const bumpColumns = Array.from({ length: NB }, (_, i) => -halfW + (2 * halfW * (i + 0.5)) / NB)
    // The calibration window is at least calWidth wide, centered on the frame, so a
    // tall frame shows the middle of the same pattern instead of a squeezed copy.
    const halfCal = Math.max(halfW, r.calWidth / 2)
    const window = Array.from({ length: NA }, (_, i) => -halfCal + (2 * halfCal * (i + 0.5)) / NA)
    const spreadOf = (v: readonly number[]) => {
      const m = v.reduce((s, x) => s + x, 0) / v.length
      return { mean: m, sd: Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length) }
    }

    // The three sets of columns the rules read, each column with its shared and
    // along terms and one noise column per octave of the 2D term: the same values as
    // T.S, T.M and T.I, worked out once per column instead of at every row.
    const columnsOf = (at: readonly number[]) =>
      at.map((a) => {
        const I: NoiseColumn[] = []
        let fx = 1 / r.scale
        for (let o = 0; o < r.octaves; o++) {
          I.push(new NoiseColumn(a * fx + 1.7 * o + 0.13, seedInt + 131 * (o + 1)))
          fx *= 2
        }
        return { a, S: T.S(a), M: T.M(a), I }
      })
    const windowCols = columnsOf(window)
    const frameCols = columnsOf(columns)
    const bumpCols = columnsOf(bumpColumns)
    type Col = (typeof frameCols)[number]
    // each octave's amplitude, vertical frequency and offset, made as T.I makes them
    const octaves = r.octaves
    const amps: number[] = []
    const fys: number[] = []
    const rowOffsets: number[] = []
    for (let o = 0, amp = 1, fy = 1 / r.ly; o < octaves; o++, amp *= r.gain, fy *= 1.5) {
      amps.push(amp)
      fys.push(fy)
      rowOffsets.push(3.3 * o)
    }
    const iAt = (col: Col, v: number) => {
      let sum = 0
      for (let o = 0; o < octaves; o++) sum += amps[o] * col.I[o].at(v * fys[o] + rowOffsets[o] + 0.71)
      return sum / NOISE_RMS
    }
    const clipAt = r.clip

    // 1. unit spread of each term over the window
    const sharedStats = spreadOf(windowCols.map((c) => c.S))
    let iVar = 0
    let rows = 0
    for (let j = 0; j < 32; j++) {
      const v = T.v(sMin + ((sMax - sMin) * (j + 0.5)) / 32)
      iVar += spreadOf(windowCols.map((c) => iAt(c, v))).sd ** 2
      rows++
    }
    cS = Math.sqrt(r.share) / Math.max(0.33, sharedStats.sd)
    cI = Math.sqrt(1 - r.share) / Math.max(0.33, Math.sqrt(iVar / rows))
    sMean = sharedStats.mean
    const rawCol = (col: Col, v: number) => {
      const x = cS * (col.S - sMean) + cI * iAt(col, v)
      return col.M * (clipAt > 0 ? clipAt * Math.tanh(x / clipAt) : x)
    }
    // the silhouette edges' long waves per column of a set
    const piecesOf = (cols: Col[]) => tr.map((_, j) => (dark[j].k > 0 ? cols.map((c) => pieceRaw(c.a, j)) : null))
    const windowPieces = piecesOf(windowCols)
    const framePieces = piecesOf(frameCols)
    const bumpPieces = piecesOf(bumpCols)
    // unit-amplitude field for the knot calibration, on the window's columns
    const rawAtCol = (i: number, s0: number) => {
      darkInto(s0)
      const w = darkW
      const jd = darkJ
      const d = rawCol(windowCols[i], T.v(s0))
      return jd < 0 ? d : d + (windowPieces[jd]![i] - d) * w
    }

    // 2. knots: the request, lowered on very wide transitions, then scaled so the
    // window shows that spread
    const wideFactor = (s0: number) => {
      if (!(r.wideWidth > 0) || nT === 0) return 1
      let near = tr[0]
      for (const t of tr) if (Math.abs(s0 - t.at) / t.width < Math.abs(s0 - near.at) / near.width) near = t
      return Math.min(1, r.wideWidth / near.width)
    }
    const wanted = params.wander.slice(0, BOUNDARY_MAX_KNOTS).map(([s0, sd]) => [s0, Math.max(0, sd) * wideFactor(s0)] as [number, number])
    wanted.sort((x, y) => x[0] - y[0])
    knots = wanted.map(([s0, sd]) => {
      const got = spreadOf(windowCols.map((_, i) => rawAtCol(i, s0))).sd
      return [s0, got > 1e-9 ? sd / got : 0] as [number, number]
    })

    // the guard at the frame's and the bump measure's columns, and a count that goes up
    // whenever the amplitudes or the guard change (lines measured before are then stale)
    let state = 0
    let guardFrame = columns.map(guard)
    let guardBump = bumpColumns.map(guard)
    const setGuard = (next: number[]) => {
      if (next.every((v, k) => v === samples[k])) return
      samples = next
      guardFrame = columns.map(guard)
      guardBump = bumpColumns.map(guard)
      state++
    }
    // each silhouette edge's amplitude E(at) * scale, for the current state
    const pieceAmp = new Float64Array(nT)
    let pieceAmpState = -1
    const pieceAmps = () => {
      if (pieceAmpState !== state) {
        for (let j = 0; j < nT; j++) pieceAmp[j] = E(tr[j].at) * scale[j]
        pieceAmpState = state
      }
      return pieceAmp
    }
    // the move on a set's column i
    const moveCol = (cols: Col[], pieces: Array<number[] | null>, i: number, s0: number, v: number) => {
      const d = E(s0) * scaleAt(s0) * rawCol(cols[i], v)
      darkInto(s0)
      const w = darkW
      const jd = darkJ
      if (jd < 0) return d
      return d + (pieceAmps()[jd] * pieces[jd]![i] - d) * w
    }
    const edgeFrame = (i: number, j: number) => guardFrame[i] * moveCol(frameCols, framePieces, i, tr[j].at, transitionV[j])
    const warpFrame = (i: number, s0: number) => guardFrame[i] * moveCol(frameCols, framePieces, i, s0, T.v(s0))
    const warpBump = (i: number, s0: number) => guardBump[i] * moveCol(bumpCols, bumpPieces, i, s0, T.v(s0))
    // crest of a silhouette edge: how far its dark side reaches into the light side, in spreads
    const updateCrests = () => {
      for (let j = 0; j < nT; j++) {
        if (!(dark[j].k > 0)) continue
        const d = columns.map((_, i) => edgeFrame(i, j))
        const m = d.reduce((s, x) => s + x, 0) / d.length
        const sd = Math.sqrt(d.reduce((s, x) => s + (x - m) ** 2, 0) / d.length)
        // coordinate mode: the edge sits at at - D, so a positive D lifts it; edge mode: at + D
        const toward = (r.mode === 'edges' ? -1 : 1) * Math.sign(tr[j].contrast)
        crestScale[j] = sd > 1e-9 ? toward / sd : 0
        crestMean[j] = d.reduce((s, x) => s + Math.min(2.5, Math.max(0, crestScale[j] * x)), 0) / d.length
      }
    }
    // the 50% line of transition j (or the line through knot k when there are no transitions) across the frame
    const isoline = (i: number, level: number) => {
      let s0 = level
      // twelve steps; once a step returns the same value, so would every later one
      for (let it = 0; it < 12; it++) {
        const next = level - warpBump(i, s0)
        if (next === s0) break
        s0 = next
      }
      if (Math.abs(s0 + warpBump(i, s0) - level) < 1e-6) return s0
      let lo = level - 0.5
      let hi = level + 0.5
      for (let it = 0; it < 40; it++) {
        const mid = (lo + hi) / 2
        if (mid + warpBump(i, mid) < level) lo = mid
        else hi = mid
      }
      return (lo + hi) / 2
    }
    const edgeBump = (i: number, j: number) => guardBump[i] * moveCol(bumpCols, bumpPieces, i, tr[j].at, transitionV[j])
    const lineOf = (j: number) => bumpColumns.map((_, i) => (r.mode === 'edges' ? tr[j].at + edgeBump(i, j) : isoline(i, tr[j].at)))
    const knotLine = (k: number) => bumpColumns.map((_, i) => isoline(i, knots[k][0]))
    // a line is measured again only when the amplitudes or the guard changed since
    const measured = new Map<number, { state: number; bumps: BoundaryBumps }>()
    const measure = (key: number, lineAt: () => number[]) => {
      const hit = measured.get(key)
      if (hit && hit.state === state) return hit.bumps
      const bumps = boundaryBumps(lineAt(), 2 * halfW, frameHeight)
      measured.set(key, { state, bumps })
      return bumps
    }
    const transitionBumps = (j: number) => measure(j, () => lineOf(j))
    const knotBumps = (k: number) => measure(-1 - k, () => knotLine(k))
    const steepFor = (j: number) => BOUNDARY_BUMPS.steep + (BOUNDARY_BUMPS.steepDark - BOUNDARY_BUMPS.steep) * dark[j].k
    const need = (b: BoundaryBumps, steep: number) => Math.min(1, b.aspect / BOUNDARY_BUMPS.aspect, b.flank / BOUNDARY_BUMPS.flank, b.steep / steep)

    // 3. the fold guard: how much each column must be calmed for the current amplitudes
    const envGrid = Array.from({ length: NS + 1 }, (_, k) => sMin + ((sMax - sMin) * k) / NS)
    const darkWGrid = new Float64Array(NS + 1)
    const darkJGrid = new Int32Array(NS + 1)
    envGrid.forEach((s0, k) => {
      darkInto(s0)
      darkWGrid[k] = darkW
      darkJGrid[k] = darkJ
    })
    const vGrid = envGrid.map((s0) => T.v(s0))
    // rawCol on the grid; a row's noise cell, offset and fade are the same in every column
    const regularGrid =
      r.mode === 'edges'
        ? null
        : (() => {
            const rowsOf = Array.from({ length: octaves }, (_, o) => {
              const iy = new Float64Array(NS + 1)
              const fy = new Float64Array(NS + 1)
              const uy = new Float64Array(NS + 1)
              for (let k = 0; k <= NS; k++) {
                const py = vGrid[k] * fys[o] + rowOffsets[o] + 0.71
                iy[k] = Math.floor(py)
                fy[k] = py - iy[k]
                uy[k] = quintic(fy[k])
              }
              return { iy, fy, uy }
            })
            // one octave down the whole column at a time: the same sums, added in the same order
            const sum = new Float64Array(NS + 1)
            return frameCols.map((c) => {
              sum.fill(0)
              for (let o = 0; o < octaves; o++) {
                const q = rowsOf[o]
                const col = c.I[o]
                const amp = amps[o]
                for (let k = 0; k <= NS; k++) sum[k] += amp * col.atCell(q.iy[k], q.fy[k], q.uy[k])
              }
              const row = new Float64Array(NS + 1)
              const base = cS * (c.S - sMean)
              for (let k = 0; k <= NS; k++) {
                const x = base + cI * (sum[k] / NOISE_RMS)
                row[k] = c.M * (clipAt > 0 ? clipAt * Math.tanh(x / clipAt) : x)
              }
              return row
            })
          })()
    // the move on the grid, before the guard, for the current amplitudes, into one buffer
    const moved = new Float64Array(NS + 1)
    const moveGrid = (i: number, amp: Float64Array) => {
      const row = regularGrid![i]
      const pa = pieceAmps()
      for (let k = 0; k <= NS; k++) {
        const d = amp[k] * row[k]
        const jd = darkJGrid[k]
        moved[k] = jd < 0 ? d : d + (pa[jd] * framePieces[jd]![i] - d) * darkWGrid[k]
      }
      return moved
    }
    const ampGrid = () => Float64Array.from(envGrid, (s0) => E(s0) * scaleAt(s0))
    const foldGuard = (): number[] => {
      const needCol = new Array<number>(NA).fill(1)
      if (r.mode === 'edges') {
        // neighbouring edges keep at least minGap of their mean width between them
        for (let j = 0; j + 1 < nT; j++) {
          const e0 = tr[j]
          const e1 = tr[j + 1]
          const gap0 = e1.at - e0.at
          const minGap = (r.minGap * (e0.width + e1.width)) / 2
          for (let i = 0; i < NA; i++) {
            const closing = moveCol(frameCols, framePieces, i, e0.at, transitionV[j]) - moveCol(frameCols, framePieces, i, e1.at, transitionV[j + 1])
            if (closing > 0 && gap0 - closing < minGap) needCol[i] = Math.min(needCol[i], Math.max(0, (gap0 - minGap) / closing))
          }
        }
      } else {
        // the steepest negative dD/ds0 in each column stays at or above -0.9 * slopeBudget
        const ds = (sMax - sMin) / NS
        const amp = ampGrid()
        for (let i = 0; i < NA; i++) {
          const g = moveGrid(i, amp)
          let lowest = 0
          for (let k = 1; k <= NS; k++) lowest = Math.min(lowest, (g[k] - g[k - 1]) / ds)
          if (-lowest > 0.9 * r.slopeBudget) needCol[i] = (0.9 * r.slopeBudget) / -lowest
        }
      }
      // each sample takes the lowest need within GUARD_REACH lattices, so the guard
      // only dips over a stretch as long as a wave and never cuts out a single bump
      const sampleAt = (k: number) => -halfW + (2 * halfW * k) / (G - 1)
      const reach = Math.max((2 * halfW) / (G - 1), GUARD_REACH * r.scale)
      const s = Array.from({ length: G }, (_, k) => {
        let m = 1
        for (let i = 0; i < NA; i++) if (Math.abs(columns[i] - sampleAt(k)) <= reach) m = Math.min(m, needCol[i])
        return m
      })
      // the smooth curve through the samples can overshoot between them; lower the
      // samples around any column it exceeds until it holds everywhere
      for (let iter = 0; iter < 40; iter++) {
        let ok = true
        for (let i = 0; i < NA; i++) {
          const g = guardAt(s, -halfW, halfW, columns[i])
          if (g <= needCol[i] * 1.0001) continue
          ok = false
          const x = ((columns[i] + halfW) / (2 * halfW)) * (G - 1)
          const k0 = Math.max(0, Math.floor(x) - 1)
          const k1 = Math.min(G - 1, Math.ceil(x) + 1)
          for (let k = k0; k <= k1; k++) s[k] *= Math.max(0.5, (needCol[i] / g) * 0.98)
        }
        if (ok) break
      }
      return s
    }

    // 4. the bump rule and the guard, until both hold: lower each transition's
    // amplitude until its 50% line's bumps are long enough in the frame, then
    // recompute the guard for the new amplitudes
    const knotScale = new Array<number>(knots.length).fill(1)
    for (let round = 0; round < 4; round++) {
      let lowered = false
      for (let pass = 0; pass < 6; pass++) {
        let changed = false
        if (nT > 0) {
          for (let j = 0; j < nT; j++) {
            const f = need(transitionBumps(j), steepFor(j))
            if (f < 0.999) {
              scale[j] *= f * 0.97
              state++
              changed = true
            }
          }
        } else {
          knotScale.fill(1)
          for (let k = 0; k < knots.length; k++) {
            if (knots[k][0] < sMin || knots[k][0] > sMax) continue
            const f = need(knotBumps(k), BOUNDARY_BUMPS.steep)
            if (f < 0.999) {
              knotScale[k] = f * 0.97
              changed = true
            }
          }
          if (changed) {
            knots.forEach((kn, k) => (kn[1] *= knotScale[k]))
            state++
          }
        }
        if (!changed) break
        lowered = true
      }
      const next = foldGuard()
      const shifted = next.some((v, k) => Math.abs(v - samples[k]) > 0.005)
      setGuard(next)
      if (!shifted && !lowered && round > 0) break
    }
    updateCrests()

    // the report's numbers
    const realized = wanted.map(([s0]) => spreadOf(columns.map((_, i) => warpFrame(i, s0))).sd)
    let worst = 0
    if (r.mode === 'edges') {
      worst = Infinity
      for (let j = 0; j + 1 < nT; j++) {
        const minGap = (r.minGap * (tr[j].width + tr[j + 1].width)) / 2
        for (let i = 0; i < NA; i++) worst = Math.min(worst, (tr[j + 1].at + edgeFrame(i, j + 1) - tr[j].at - edgeFrame(i, j)) / minGap)
      }
      if (!Number.isFinite(worst)) worst = 0
    } else {
      const ds = (sMax - sMin) / NS
      const amp = ampGrid()
      for (let i = 0; i < NA; i++) {
        const g = guardFrame[i]
        const m = moveGrid(i, amp)
        for (let k = 1; k <= NS; k++) worst = Math.min(worst, (g * (m[k] - m[k - 1])) / ds)
      }
    }
    const lineBumps = nT > 0 ? tr.map((_, j) => transitionBumps(j)) : knots.map((_, k) => knotBumps(k))
    const bumps = lineBumps.reduce((m, b) => ({ aspect: Math.min(m.aspect, b.aspect), flank: Math.min(m.flank, b.flank), steep: Math.min(m.steep, b.steep) }), {
      aspect: Infinity,
      flank: Infinity,
      steep: Infinity,
    })
    return { wanted, realized, worst, guardValues: guardFrame, bumps }
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
uniform vec4 uBndTrans[BND_TRANS];      // per transition: position, 10-90 width, its noise row, amplitude scale
uniform vec4 uBndDark[BND_TRANS];       // per transition: silhouette strength, half-height of its long-wave zone, crest scale, crest mean
uniform int uBndVertical;         // 1: the noise row counts transitions passed; 0: it is s0

const float BND_RMS = 0.3052;
const float BND_RISE = 4.394449154672439;
const float BND_STRETCH = ${DARK_STRETCH.toFixed(4)};
const float BND_DETAIL = ${DARK_DETAIL.toFixed(4)};
const float BND_SOFT_CALM = ${DARK_SOFT_CALM.toFixed(4)};
const float BND_CREST = ${DARK_CREST.toFixed(4)};

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

// Amplitude scale per transition, smooth between transitions.
float boundaryScale(float s0) {
  if (uBndTransCount <= 0) return 1.0;
  if (s0 <= uBndTrans[0].x) return uBndTrans[0].w;
  for (int j = 0; j + 1 < BND_TRANS; j++) {
    if (j + 1 >= uBndTransCount) break;
    vec4 t0 = uBndTrans[j];
    vec4 t1 = uBndTrans[j + 1];
    if (s0 <= t1.x) return mix(t0.w, t1.w, smoothstep(0.0, 1.0, (s0 - t0.x) / max(1e-9, t1.x - t0.x)));
  }
  return uBndTrans[uBndTransCount - 1].w;
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

// detail weighs the octaves after the first (1: all of them).
float boundaryShared(float a, float detail) {
  float sum = 0.0;
  float amp = 1.0;
  float f = uBndShared.y;
  for (int o = 0; o < 3; o++) {
    if (float(o) >= uBndShared.w) break;
    sum += amp * (o == 0 ? 1.0 : detail) * gradientNoise(vec2(a * f + 0.37 + 2.9 * float(o), 0.5 + 4.0 * float(o)), uBndSeed);
    amp *= uBndShape.x;
    f *= 2.0;
  }
  return sum / BND_RMS - uBndShared.z;
}

float boundaryNoise(float a, float v, float detail) {
  float sum = 0.0;
  float amp = 1.0;
  vec2 f = uBndWarp.yz;
  for (int o = 0; o < 3; o++) {
    if (float(o) >= uBndWarp.w) break;
    sum += amp * (o == 0 ? 1.0 : detail) * gradientNoise(vec2(a * f.x + 1.7 * float(o) + 0.13, v * f.y + 3.3 * float(o) + 0.71), uBndSeed + 131 * (o + 1));
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

float boundaryRaw(float a, float v, float detail) {
  float d = uBndShared.x * boundaryShared(a, detail) + uBndWarp.x * boundaryNoise(a, v, detail);
  if (uBndShape.y > 0.0) d = uBndShape.y * tanh(d / uBndShape.y);
  return boundaryAlong(a) * d;
}

// The move at s0 with noise row v, before the guard. In a silhouette edge's zone it
// blends toward that edge's own long wave (the same noise stretched along the edge,
// read at its own row) at the edge's own amplitude, so the whole edge moves as one piece.
float boundaryMove(float a, float s0, float v) {
  float d = boundaryEnvelope(s0) * boundaryScale(s0) * boundaryRaw(a, v, 1.0);
  float w = 0.0;
  int jd = -1;
  for (int j = 0; j < BND_TRANS; j++) {
    if (j >= uBndTransCount) break;
    vec4 dk = uBndDark[j];
    if (dk.x <= 0.0) continue;
    vec4 t = uBndTrans[j];
    float o = dk.x * (1.0 - smoothstep(dk.y, dk.y + t.y, abs(s0 - t.x)));
    if (o > w) {
      w = o;
      jd = j;
    }
  }
  if (jd < 0) return d;
  vec4 t = uBndTrans[jd];
  float k = uBndDark[jd].x;
  float piece = boundaryEnvelope(t.x) * t.w * boundaryRaw(a / (1.0 + BND_STRETCH * k), t.z, 1.0 - BND_DETAIL * k);
  return mix(d, piece, w);
}

// Coordinate mode: s = s0 + boundaryWarp(a, s0).
float boundaryWarp(float a, float s0) {
  return boundaryGuard(a) * boundaryMove(a, s0, boundaryV(s0));
}

// Edge mode: transition j sits at uBndTrans[j].x + boundaryEdge(a, j).
float boundaryEdge(float a, int j) {
  vec4 t = uBndTrans[j];
  return boundaryGuard(a) * boundaryMove(a, t.x, t.z);
}

float boundarySoftNoise(float a, float m, float w, float calm) {
  if (uBndSoft.x <= 0.0) return 1.0;
  float amount = (uBndSoft.w > 0.0 && w > uBndSoft.w) ? uBndSoft.x * uBndSoft.w / w : uBndSoft.x;
  float n = clamp(gradientNoise(vec2(a * uBndSoft.y + 5.1, m * uBndSoft.z + 2.3), uBndSeed + 577) / BND_RMS, -2.5, 2.5);
  return exp(amount * calm * n);
}

// Softness multiplier for a boundary at m with 10-90 width w.
float boundarySoftAt(float a, float m, float w) { return boundarySoftNoise(a, m, w, 1.0); }

// Softness multiplier of transition j; a silhouette edge is softer at its crests.
float boundarySoft(float a, int j) {
  vec4 t = uBndTrans[j];
  vec4 dk = uBndDark[j];
  float s = boundarySoftNoise(a, t.x, t.y, 1.0 - BND_SOFT_CALM * dk.x);
  if (dk.x <= 0.0) return s;
  float crest = clamp(dk.z * boundaryEdge(a, j), 0.0, 2.5);
  return s * exp(BND_CREST * dk.x * (crest - dk.w));
}

// Fine feather of transition j at coordinate s, in s units.
float boundaryFeather(float a, float s, int j) {
  if (uBndFeather.x <= 0.0) return 0.0;
  vec4 t = uBndTrans[j];
  vec2 q = vec2(a * uBndFeather.y + 9.7 + 3.3 * float(j), (s - t.x) / (uBndFeather.z * t.y) + 4.1);
  return uBndFeather.x * t.y * gradientNoise(q, uBndSeed + 733 + 17 * j) / BND_RMS;
}
`
