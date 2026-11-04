// CPU versions of the Pixel filter variants. Each takes a display-linear image (after the tone curve, max channel
// <= 1) and returns a new one. Cell sizes are fractions of the short side, so every output size gets the same grid.
//
// The LED variants keep the light where it was:
//   L_j     = tent-weighted mean of the image around LED j (the tent T has radius one cell, and the tents of all
//             LEDs add up to 1 everywhere, so every bit of light goes to some LED)
//   out(x)  = img(x) (1 - sum_j a_j T(x - c_j)) + sum_j a_j L_j D(x - c_j)
// with D the LED's dot (integral = cell area). The light an LED shows is exactly the light it took, so the image's
// mean is unchanged at the scale of a cell. a_j is how much of its footprint the LED takes over (0 = the image as it
// was, 1 = all LED). It is limited so the dot's peak never pushes a channel past 1.
import { hash3, unit } from './image.mjs'

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const tent = (u) => Math.max(0, 1 - Math.abs(u))

/** Dot profiles in cell units (u = offset / pitch). */
export const SHAPES = {
  round: { reach: 1.5, g: (ux, uy) => Math.exp(-(ux * ux + uy * uy) / (2 * 0.27 * 0.27)) },
  softround: { reach: 1.5, g: (ux, uy) => Math.exp(-(ux * ux + uy * uy) / (2 * 0.34 * 0.34)) },
  disc: { reach: 1, g: (ux, uy) => smoothstep(0.5, 0.26, Math.hypot(ux, uy)) },
  square: {
    reach: 1,
    g: (ux, uy) => smoothstep(0.5, 0.24, Math.sqrt(Math.sqrt(ux ** 4 + uy ** 4))),
  },
  tile: { reach: 1, g: (ux, uy) => smoothstep(0.5, 0.4, Math.abs(ux)) * smoothstep(0.5, 0.4, Math.abs(uy)) },
}

/** An LED with bloom: a small rounded-square core (weight `core`) on a wide gaussian glow. */
export function coreGlow(core, coreS, glowS) {
  const key = `cg${core}-${coreS}-${glowS}`
  if (!SHAPES[key]) {
    // Each part normalized to unit integral, so `core` is the core's share of the light.
    const gc = (ux, uy) => Math.exp(-(ux ** 4 + uy ** 4) / (2 * coreS ** 4))
    const gg = (ux, uy) => Math.exp(-(ux * ux + uy * uy) / (2 * glowS * glowS))
    const ic = integral(gc, 2)
    const ig = 2 * Math.PI * glowS * glowS
    SHAPES[key] = { reach: 3, g: (ux, uy) => (core * gc(ux, uy)) / ic + ((1 - core) * gg(ux, uy)) / ig }
  }
  return key
}

function integral(g, R) {
  const n = 64
  let s = 0
  for (let j = -R * n; j < R * n; j++) for (let i = -R * n; i < R * n; i++) s += g((i + 0.5) / n, (j + 0.5) / n)
  return s / (n * n)
}

/** A flat pattern (no LED structure): only the snap shows. */
SHAPES.none = { reach: 0, g: () => 1 }

/** A super-gaussian dot: exp(-(|x|^n + |y|^n) / (2 s^n)); n = 2 is round, n = 4 a soft rounded square. */
export function superGauss(n, s) {
  const key = `sg${n}-${s}`
  if (!SHAPES[key]) SHAPES[key] = { reach: 2, g: (ux, uy) => Math.exp(-(Math.abs(ux) ** n + Math.abs(uy) ** n) / (2 * s ** n)) }
  return key
}

const STATS = new Map()

/** Normalization G = integral of g over the plane, and the min and max of the summed dots over a cell. */
export function shapeStats(shape) {
  if (!STATS.has(shape)) STATS.set(shape, computeStats(shape))
  return STATS.get(shape)
}

function computeStats(shape) {
  const { g, reach } = SHAPES[shape]
  const n = 64
  let G = 0
  const R = Math.ceil(reach) + 1
  for (let j = -R * n; j < R * n; j++) for (let i = -R * n; i < R * n; i++) G += g((i + 0.5) / n, (j + 0.5) / n)
  G /= n * n
  let max = 0
  let min = Infinity
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const ux = (i + 0.5) / n - 0.5
      const uy = (j + 0.5) / n - 0.5
      let s = 0
      for (let b = -R; b <= R; b++) for (let a = -R; a <= R; a++) s += g(ux - a, uy - b)
      s /= G
      max = Math.max(max, s)
      min = Math.min(min, s)
    }
  }
  return { G, max, min }
}

function grid(w, h, cells) {
  const short = Math.min(w, h)
  const p = short / cells
  // The frame centre sits on a cell corner, so the grid is the same at every size and symmetric in the frame.
  const i0 = Math.floor(-w / 2 / p) - 2
  const i1 = Math.ceil(w / 2 / p) + 1
  const j0 = Math.floor(-h / 2 / p) - 2
  const j1 = Math.ceil(h / 2 / p) + 1
  return { p, i0, i1, j0, j1, nx: i1 - i0 + 1, ny: j1 - j0 + 1, cx: (i) => w / 2 + (i + 0.5) * p, cy: (j) => h / 2 + (j + 0.5) * p }
}

/** Per LED: tent-weighted mean color and tent-weighted peak channel. */
export function ledValues(img, cells) {
  const { w, h, data } = img
  const G = grid(w, h, cells)
  const mean = new Float32Array(G.nx * G.ny * 3)
  const peak = new Float32Array(G.nx * G.ny)
  for (let j = G.j0; j <= G.j1; j++) {
    const cy = G.cy(j)
    const ya = Math.max(0, Math.floor(cy - G.p))
    const yb = Math.min(h - 1, Math.ceil(cy + G.p))
    for (let i = G.i0; i <= G.i1; i++) {
      const cx = G.cx(i)
      const xa = Math.max(0, Math.floor(cx - G.p))
      const xb = Math.min(w - 1, Math.ceil(cx + G.p))
      let r = 0
      let g = 0
      let b = 0
      let ws = 0
      let pk = 0
      for (let y = ya; y <= yb; y++) {
        const ty = tent((y + 0.5 - cy) / G.p)
        if (ty <= 0) continue
        for (let x = xa; x <= xb; x++) {
          const t = ty * tent((x + 0.5 - cx) / G.p)
          if (t <= 0) continue
          const k = (y * w + x) * 3
          r += t * data[k]
          g += t * data[k + 1]
          b += t * data[k + 2]
          ws += t
          pk = Math.max(pk, t * Math.max(data[k], data[k + 1], data[k + 2]))
        }
      }
      const n = (j - G.j0) * G.nx + (i - G.i0)
      if (ws > 0) {
        mean[n * 3] = r / ws
        mean[n * 3 + 1] = g / ws
        mean[n * 3 + 2] = b / ws
      }
      peak[n] = pk
    }
  }
  return { G, mean, peak }
}

/**
 * LED wall. opts:
 *   cells     LEDs on the short side
 *   amount    target a (0..1): how much of each footprint the LEDs take over
 *   shape     key of SHAPES
 *   limitBy   'mean' (the LED's own color limits its dot) or 'peak' (the brightest pixel near it does, so hot cores
 *             stay as they were)
 *   perChannel each channel gets its own limit (saturated colors keep dots in their other channels)
 *   jitter    per-LED gain variation (standard deviation), seeded
 */
export function led(img, opts) {
  const { cells = 54, amount = 1, shape = 'round', limitBy = 'mean', perChannel = false, jitter = 0, seed = 1 } = opts
  const { w, h, data } = img
  if (amount <= 0) return { w, h, data: new Float32Array(data) }
  const { G, mean, peak } = ledValues(img, cells)
  const S = shapeStats(shape)
  const { g, reach } = SHAPES[shape]
  const over = S.max - 1
  // a per LED and channel.
  const A = new Float32Array(G.nx * G.ny * 3)
  const L = new Float32Array(mean)
  for (let n = 0; n < G.nx * G.ny; n++) {
    if (jitter > 0) {
      const i = (n % G.nx) + G.i0
      const j = Math.floor(n / G.nx) + G.j0
      const u = unit(hash3(i, j, seed * 7919 + 17)) + unit(hash3(i, j, seed * 7919 + 29)) + unit(hash3(i, j, seed * 7919 + 43))
      const k = 1 + jitter * (u - 1.5) * 2
      for (let c = 0; c < 3; c++) L[n * 3 + c] *= k
    }
    const m = Math.max(L[n * 3], L[n * 3 + 1], L[n * 3 + 2])
    // With limitBy 'peak' the LED's color is judged as bright as the brightest pixel it covers.
    const scale = limitBy === 'peak' && m > 0 ? Math.max(1, peak[n] / m) : 1
    for (let c = 0; c < 3; c++) {
      const v = (perChannel ? L[n * 3 + c] : m) * scale
      const lim = v > 0 ? (1 / v - 1) / over : Infinity
      A[n * 3 + c] = Math.max(0, Math.min(amount, lim))
    }
  }
  const out = new Float32Array(data.length)
  const R = Math.ceil(reach)
  for (let y = 0; y < h; y++) {
    const fy = (y + 0.5 - h / 2) / G.p - 0.5
    const jc = Math.round(fy)
    for (let x = 0; x < w; x++) {
      const fx = (x + 0.5 - w / 2) / G.p - 0.5
      const ic = Math.round(fx)
      let b0 = 0
      let b1 = 0
      let b2 = 0
      let d0 = 0
      let d1 = 0
      let d2 = 0
      for (let j = jc - R; j <= jc + R; j++) {
        const uy = fy - j
        for (let i = ic - R; i <= ic + R; i++) {
          const ux = fx - i
          const n = (j - G.j0) * G.nx + (i - G.i0)
          const a0 = A[n * 3]
          const a1 = A[n * 3 + 1]
          const a2 = A[n * 3 + 2]
          if (a0 + a1 + a2 <= 0) continue
          const t = tent(ux) * tent(uy)
          b0 += a0 * t
          b1 += a1 * t
          b2 += a2 * t
          const dz = g(ux, uy) / S.G
          if (dz > 0) {
            d0 += a0 * L[n * 3] * dz
            d1 += a1 * L[n * 3 + 1] * dz
            d2 += a2 * L[n * 3 + 2] * dz
          }
        }
      }
      const k = (y * w + x) * 3
      out[k] = Math.min(1, Math.max(0, data[k] * (1 - b0) + d0))
      out[k + 1] = Math.min(1, Math.max(0, data[k + 1] * (1 - b1) + d1))
      out[k + 2] = Math.min(1, Math.max(0, data[k + 2] * (1 - b2) + d2))
    }
  }
  return { w, h, data: out }
}

/**
 * Snap weights: w(t) = 1 - h(|t|) on [-1, 1], h(t) = t^q / (t^q + (1 - t)^q). Since h(t) + h(1 - t) = 1 the weights
 * of all LEDs add up to 1 everywhere. q = 1 is the tent (bilinear: smooth); larger q gives each LED a flat middle
 * and a narrower blend into its neighbours (q -> infinity: flat cells).
 */
export function snapWeight(t, q) {
  const a = Math.abs(t)
  if (a >= 1) return 0
  if (q === 1) return 1 - a
  const x = a ** q
  return 1 - x / (x + (1 - a) ** q)
}

/** Per LED: the snap-weighted mean color. */
function snapValues(img, G, q) {
  const { w, h, data } = img
  const mean = new Float32Array(G.nx * G.ny * 3)
  for (let j = G.j0; j <= G.j1; j++) {
    const cy = G.cy(j)
    const ya = Math.max(0, Math.floor(cy - G.p))
    const yb = Math.min(h - 1, Math.ceil(cy + G.p))
    for (let i = G.i0; i <= G.i1; i++) {
      const cx = G.cx(i)
      const xa = Math.max(0, Math.floor(cx - G.p))
      const xb = Math.min(w - 1, Math.ceil(cx + G.p))
      let r = 0
      let g = 0
      let b = 0
      let ws = 0
      for (let y = ya; y <= yb; y++) {
        const wy = snapWeight((y + 0.5 - cy) / G.p, q)
        if (wy <= 0) continue
        for (let x = xa; x <= xb; x++) {
          const t = wy * snapWeight((x + 0.5 - cx) / G.p, q)
          if (t <= 0) continue
          const k = (y * w + x) * 3
          r += t * data[k]
          g += t * data[k + 1]
          b += t * data[k + 2]
          ws += t
        }
      }
      const n = (j - G.j0) * G.nx + (i - G.i0)
      if (ws > 0) {
        mean[n * 3] = r / ws
        mean[n * 3 + 1] = g / ws
        mean[n * 3 + 2] = b / ws
      }
    }
  }
  return mean
}

/**
 * LED wall, second form: snap, then an LED pattern.
 *   base(x) = (1 - amount) img(x) + amount sum_j L_j W_j(x)        (W_j: snap weights, L_j: W_j-weighted means)
 *   out(x)  = base(x) (1 + c(x) (S(x) - 1))                          (S: summed dots, mean 1 over a cell)
 *   c(x)    = min(contrast, (1 / max channel of base(x) - 1) / (S_max - 1))
 * The snap keeps the image's light exactly (the weights add up to 1); the pattern keeps it up to how much base
 * changes inside one cell. c follows base pixel by pixel, so where it is limited it changes smoothly, with no seams
 * on the cell grid; thin bright lines that survive in base (amount < 1) are left as they are.
 */
export function led2(img, opts) {
  const { cells = 54, amount = 1, q = 2, shape = 'round', contrast = 1, jitter = 0, seed = 1 } = opts
  const { w, h, data } = img
  const G = grid(w, h, cells)
  const L = snapValues(img, G, q)
  if (jitter > 0) {
    for (let n = 0; n < G.nx * G.ny; n++) {
      const i = (n % G.nx) + G.i0
      const j = Math.floor(n / G.nx) + G.j0
      const u = unit(hash3(i, j, seed * 7919 + 17)) + unit(hash3(i, j, seed * 7919 + 29)) + unit(hash3(i, j, seed * 7919 + 43))
      const k = 1 + jitter * (u - 1.5) * 2
      for (let c = 0; c < 3; c++) L[n * 3 + c] *= k
    }
  }
  const flat = shape === 'none'
  const S = flat ? { G: 1, max: 1, min: 1 } : shapeStats(shape)
  const { g, reach } = SHAPES[shape]
  const R = Math.ceil(reach)
  const over = Math.max(S.max - 1, 1e-6)
  const out = new Float32Array(data.length)
  for (let y = 0; y < h; y++) {
    const fy = (y + 0.5 - h / 2) / G.p - 0.5
    const jc = Math.round(fy)
    for (let x = 0; x < w; x++) {
      const fx = (x + 0.5 - w / 2) / G.p - 0.5
      const ic = Math.round(fx)
      let s0 = 0
      let s1 = 0
      let s2 = 0
      for (let j = jc - 1; j <= jc + 1; j++) {
        const wy = snapWeight(fy - j, q)
        if (wy <= 0) continue
        for (let i = ic - 1; i <= ic + 1; i++) {
          const t = wy * snapWeight(fx - i, q)
          if (t <= 0) continue
          const n = (j - G.j0) * G.nx + (i - G.i0)
          s0 += t * L[n * 3]
          s1 += t * L[n * 3 + 1]
          s2 += t * L[n * 3 + 2]
        }
      }
      let pat = 1
      if (!flat) {
        pat = 0
        for (let j = jc - R; j <= jc + R; j++) for (let i = ic - R; i <= ic + R; i++) pat += g(fx - i, fy - j)
        pat /= S.G
      }
      const k = (y * w + x) * 3
      const b0 = data[k] + amount * (s0 - data[k])
      const b1 = data[k + 1] + amount * (s1 - data[k + 1])
      const b2 = data[k + 2] + amount * (s2 - data[k + 2])
      const m = Math.max(b0, b1, b2)
      const c = Math.max(0, Math.min(contrast, m > 0 ? (1 / m - 1) / over : contrast))
      const f = 1 + c * (pat - 1)
      out[k] = Math.min(1, Math.max(0, b0 * f))
      out[k + 1] = Math.min(1, Math.max(0, b1 * f))
      out[k + 2] = Math.min(1, Math.max(0, b2 * f))
    }
  }
  return { w, h, data: out }
}

/** A rounded-square tile: 1 inside half-size r, 0 outside r + soft, superellipse corners of exponent n. */
export function roundedTile(r, soft, n = 4) {
  const key = `tile${r}-${soft}-${n}`
  if (!SHAPES[key]) {
    SHAPES[key] = {
      reach: 1,
      g: (ux, uy) => smoothstep(r + soft / 2, r - soft / 2, (Math.abs(ux) ** n + Math.abs(uy) ** n) ** (1 / n)),
    }
  }
  return key
}

/**
 * The grid the engine's frame source gives: `cells` on the short side and a whole number across the long side, so
 * the cells fill the frame edge to edge (they are square to within half a cell over the long side).
 */
export function cellGrid(w, h, cells) {
  const long = Math.max(1, Math.round((cells * Math.max(w, h)) / Math.min(w, h)))
  const nx = w >= h ? long : cells
  const ny = w >= h ? cells : long
  return { nx, ny, px: w / nx, py: h / ny }
}

function bilinear(img, x, y) {
  const { w, h, data } = img
  const fx = Math.min(w - 1, Math.max(0, x - 0.5))
  const fy = Math.min(h - 1, Math.max(0, y - 0.5))
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const x1 = Math.min(w - 1, x0 + 1)
  const y1 = Math.min(h - 1, y0 + 1)
  const ax = fx - x0
  const ay = fy - y0
  const out = [0, 0, 0]
  for (let c = 0; c < 3; c++) {
    const top = data[(y0 * w + x0) * 3 + c] * (1 - ax) + data[(y0 * w + x1) * 3 + c] * ax
    const bottom = data[(y1 * w + x0) * 3 + c] * (1 - ax) + data[(y1 * w + x1) * 3 + c] * ax
    out[c] = top * (1 - ay) + bottom * ay
  }
  return out
}

/**
 * Mean color of each cell. samples = 0: every pixel of the cell. samples = s: s x s point samples per cell, as the
 * engine's frame source takes them (it draws the frame at s samples per texel and averages).
 */
export function cellMeans(img, G, samples = 0) {
  const { w, h, data } = img
  const M = new Float32Array(G.nx * G.ny * 3)
  if (samples > 0) {
    for (let j = 0; j < G.ny; j++) {
      for (let i = 0; i < G.nx; i++) {
        const c = (j * G.nx + i) * 3
        for (let b = 0; b < samples; b++) {
          for (let a = 0; a < samples; a++) {
            const v = bilinear(img, (i + (a + 0.5) / samples) * G.px, (j + (b + 0.5) / samples) * G.py)
            M[c] += v[0]
            M[c + 1] += v[1]
            M[c + 2] += v[2]
          }
        }
        for (let k = 0; k < 3; k++) M[c + k] /= samples * samples
      }
    }
    return M
  }
  const n = new Float32Array(G.nx * G.ny)
  for (let y = 0; y < h; y++) {
    const j = Math.min(G.ny - 1, Math.floor((y + 0.5) / G.py))
    for (let x = 0; x < w; x++) {
      const i = Math.min(G.nx - 1, Math.floor((x + 0.5) / G.px))
      const c = j * G.nx + i
      const k = (y * w + x) * 3
      M[c * 3] += data[k]
      M[c * 3 + 1] += data[k + 1]
      M[c * 3 + 2] += data[k + 2]
      n[c]++
    }
  }
  for (let c = 0; c < n.length; c++) for (let k = 0; k < 3; k++) M[c * 3 + k] /= Math.max(1, n[c])
  return M
}

const bspline = (t) => [(1 - t) ** 3 / 6, (3 * t ** 3 - 6 * t ** 2 + 4) / 6, (-3 * t ** 3 + 3 * t ** 2 + 3 * t + 1) / 6, t ** 3 / 6]

/**
 * LED wall, third form, built from cell means the way the GPU pass gets them:
 *   flat(x) = sum over the 2 x 2 nearest cells of M_j w_q(x)        (each cell flat, blending into its neighbour
 *                                                                    over a band whose width falls as q grows)
 *   led(x)  = flat(x) (1 + c(x) (S(x) - 1))                          (S: LED shape summed over cells, mean 1 a cell)
 *             where that would push a channel past 1, the gain is cut to fit and the rest of the light is added as
 *             white, so the luminance is kept (bright LEDs whiten, as on camera)
 *   c(x)    = contrast, fading out as the luminance of flat(x) goes from `fadeFrom` to 1 (near-white light blooms
 *             over the gaps, as an overexposed LED wall does on camera)
 *   glow(x) = cubic B-spline through the cell means                  (the share of the light a lens spreads over
 *                                                                    the neighbours)
 *   out(x)  = img(x) + amount ((1 - halo) led(x) + halo glow(x) - img(x))
 */
export function led3(img, opts) {
  const { cells = 36, q = 8, shape = 'none', contrast = 0, halo = 0, amount = 1, samples = 0, fadeFrom = 2 } = opts
  const { w, h, data } = img
  const G = cellGrid(w, h, cells)
  const M = cellMeans(img, G, samples)
  const flatShape = shape === 'none' || contrast <= 0
  const S = flatShape ? { G: 1, max: 1, min: 1 } : shapeStats(shape)
  const g = flatShape ? null : SHAPES[shape].g
  const R = flatShape ? 0 : Math.ceil(SHAPES[shape].reach)
  const at = (i, j, c) => M[(Math.min(G.ny - 1, Math.max(0, j)) * G.nx + Math.min(G.nx - 1, Math.max(0, i))) * 3 + c]
  const hq = (t) => {
    if (q === 1) return t
    const a = t ** q
    return a / (a + (1 - t) ** q)
  }
  const out = new Float32Array(data.length)
  for (let y = 0; y < h; y++) {
    const fy = (y + 0.5) / G.py - 0.5
    const j0 = Math.floor(fy)
    const ty = fy - j0
    const wy1 = hq(ty)
    const by = bspline(ty)
    const vy = fy - Math.round(fy)
    for (let x = 0; x < w; x++) {
      const fx = (x + 0.5) / G.px - 0.5
      const i0 = Math.floor(fx)
      const tx = fx - i0
      const wx1 = hq(tx)
      const bx = bspline(tx)
      const ux = fx - Math.round(fx)
      let pat = 1
      if (!flatShape) {
        pat = 0
        for (let b = -R; b <= R; b++) for (let a = -R; a <= R; a++) pat += g(ux - a, vy - b)
        pat /= S.G
      }
      const k = (y * w + x) * 3
      const fl = [0, 0, 0]
      const gl = [0, 0, 0]
      for (let c = 0; c < 3; c++) {
        const top = at(i0, j0, c) * (1 - wx1) + at(i0 + 1, j0, c) * wx1
        const bottom = at(i0, j0 + 1, c) * (1 - wx1) + at(i0 + 1, j0 + 1, c) * wx1
        fl[c] = top * (1 - wy1) + bottom * wy1
        if (halo > 0) {
          let s = 0
          for (let b = 0; b < 4; b++) {
            let r = 0
            for (let a = 0; a < 4; a++) r += bx[a] * at(i0 - 1 + a, j0 - 1 + b, c)
            s += by[b] * r
          }
          gl[c] = s
        }
      }
      const Y = 0.2126 * fl[0] + 0.7152 * fl[1] + 0.0722 * fl[2]
      const cx = fadeFrom < 1 ? contrast * (1 - smoothstep(fadeFrom, 1, Y)) : contrast
      let f = 1 + cx * (pat - 1)
      let white = 0
      if (f > 1) {
        const m = Math.max(fl[0], fl[1], fl[2])
        const fit = m > 0 ? Math.min(f, 1 / m) : f
        white = fit * Y < 1 ? Math.min(1, ((f - fit) * Y) / (1 - fit * Y)) : 0
        f = fit
      }
      for (let c = 0; c < 3; c++) {
        const lit = fl[c] * f
        const full = (1 - halo) * (lit + white * (1 - lit)) + halo * gl[c]
        out[k + c] = Math.min(1, Math.max(0, data[k + c] + amount * (full - data[k + c])))
      }
    }
  }
  return { w, h, data: out }
}

/** The brief's words taken literally: every cell one flat color (its mean), mixed with the image by `amount`. */
export function mosaic(img, { cells = 54, amount = 1 } = {}) {
  const { w, h, data } = img
  const p = Math.min(w, h) / cells
  const cellOf = (v, size) => Math.floor((v + 0.5 - size / 2) / p)
  const sums = new Map()
  for (let y = 0; y < h; y++) {
    const cj = cellOf(y, h)
    for (let x = 0; x < w; x++) {
      const key = cellOf(x, w) * 100003 + cj
      const s = sums.get(key) ?? [0, 0, 0, 0]
      const k = (y * w + x) * 3
      s[0] += data[k]
      s[1] += data[k + 1]
      s[2] += data[k + 2]
      s[3]++
      sums.set(key, s)
    }
  }
  const out = new Float32Array(data.length)
  for (let y = 0; y < h; y++) {
    const cj = cellOf(y, h)
    for (let x = 0; x < w; x++) {
      const s = sums.get(cellOf(x, w) * 100003 + cj)
      const k = (y * w + x) * 3
      for (let c = 0; c < 3; c++) out[k + c] = data[k + c] + amount * (s[c] / s[3] - data[k + c])
    }
  }
  return { w, h, data: out }
}

/** The Figma stand-in (44:280) built literally: the image with light lines 2/24 of a cell wide, white at 60 % in sRGB. */
export function standIn(img, { cells = 18.33, amount = 1 } = {}) {
  const { w, h, data } = img
  const p = Math.min(w, h) / cells
  const lw = (2 / 24) * p
  const toS = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)
  const toL = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  const cover = (v) => {
    // Share of the pixel [v, v+1) covered by lines starting at k p and lw wide.
    let c = 0
    const k0 = Math.floor(v / p) - 1
    for (let k = k0; k <= k0 + 2; k++) c += Math.max(0, Math.min(v + 1, k * p + lw) - Math.max(v, k * p))
    return Math.min(1, c)
  }
  const out = new Float32Array(data.length)
  for (let y = 0; y < h; y++) {
    const cyv = cover(y)
    for (let x = 0; x < w; x++) {
      const m = 1 - (1 - cover(x)) * (1 - cyv)
      const k = (y * w + x) * 3
      for (let c = 0; c < 3; c++) out[k + c] = toL(toS(data[k + c]) + 0.6 * amount * m * (1 - toS(data[k + c])))
    }
  }
  return { w, h, data: out }
}
