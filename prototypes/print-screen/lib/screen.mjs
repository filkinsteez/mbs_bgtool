// Print screen: a soft halftone dot screen in the frame's own ink, on Oklab lightness only.
// CPU reference of the stage; stage.mjs has the same math in GLSL for the engine's output filter chain.
//
// Per output pixel, after the tone curve (display-linear in, display-linear out):
//   c   = ink coverage from lightness: 0 at paper white (L 0.97), 1 at full ink (L 0.12)
//   T   = rank of the spot function within its cell (uniform 0..1 over a cell), from screen coordinates that are
//         rotated by `angle`, scaled to `pitch` of the short side and slowly warped by seeded value noise
//   ink = smoothstep(1 - c' - edge, 1 - c' + edge, T), c' = c with a small per-dot jitter; the cell mean of ink is c
//   L'  = L - strength * amp * (ink - c')
// So the mean lightness of a cell stays L, the hue and chroma stay the frame's own, dots grow from the cell
// centers in light ink, meet as a checker at half coverage and become light holes in dark ink, and paper white and
// black stay clean.

export const SCREEN = {
  /** Screen period as a share of the short side: the poster's 4.7 px at 960 px. */
  pitch: 0.0049,
  /** Wave angle in degrees, x right and y down: the poster's main peak (dashes in rows rising to the right at 39 deg). */
  angle: 51,
  /** Weight of the second screen direction: 1 is round dots, lower is dashes along the rows. */
  cross: 0.45,
  /** Lightness swing at strength 1 (Oklab L). The residual is about amp x sqrt(c (1 - c)) at sharp edges. */
  amp: 0.058,
  /** Dot edge width in coverage units; wider is softer. */
  edge: 0.3,
  /** Warp of the screen in cells, over about 6 cells, so rows waver and dashes vary in length. */
  wobble: 0.3,
  /** Dot-to-dot coverage jitter. */
  jitter: 0.15,
  /** Share of the swing that is fine noise in the same ink instead of screen (the poster's scan and paper). */
  noise: 0.35,
  /** The noise share in light ink (L 0.72 and up), where the poster's texture is finer than its dashes. */
  lightNoise: 0.75,
  /** Lightness of paper white and full ink for the coverage. */
  paper: 0.97,
  ink: 0.12,
}

// Fraction of a cell where the spot function (cos 2 pi u + k cos 2 pi v) / (1 + k) is below s, for s in [-1, 1].
const CDF_SIZE = 1024
const spotCdfs = new Map()
function spotCdf(k) {
  const cached = spotCdfs.get(k)
  if (cached) return cached
  const n = 512
  const values = new Float64Array(n * n)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) values[j * n + i] = (Math.cos((2 * Math.PI * (i + 0.5)) / n) + k * Math.cos((2 * Math.PI * (j + 0.5)) / n)) / (1 + k)
  }
  values.sort()
  const cdf = new Float64Array(CDF_SIZE + 1)
  let m = 0
  for (let t = 0; t <= CDF_SIZE; t++) {
    const s = -1 + (2 * t) / CDF_SIZE
    while (m < values.length && values[m] <= s) m++
    cdf[t] = m / values.length
  }
  spotCdfs.set(k, cdf)
  return cdf
}

/** Rank of a spot value within its cell, uniform on 0..1 over a cell. */
export function spotRank(s, k = SCREEN.cross) {
  const cdf = spotCdf(k)
  const x = ((Math.min(1, Math.max(-1, s)) + 1) / 2) * CDF_SIZE
  const i = Math.min(CDF_SIZE - 1, Math.floor(x))
  return cdf[i] + (cdf[i + 1] - cdf[i]) * (x - i)
}

/** Odd polynomial fit of spotRank(s) - 0.5 in s, for the GLSL version (coefficients of s, s^3, s^5, s^7). */
export function fitSpotRank(cross = SCREEN.cross) {
  const rows = []
  for (let t = 0; t <= 400; t++) {
    const s = -1 + (2 * t) / 400
    rows.push([s, spotRank(s, cross) - 0.5])
  }
  // Least squares on [s, s^3, s^5, s^7].
  const k = 4
  const ata = Array.from({ length: k }, () => new Float64Array(k))
  const atb = new Float64Array(k)
  for (const [s, y] of rows) {
    const basis = [s, s ** 3, s ** 5, s ** 7]
    for (let i = 0; i < k; i++) {
      atb[i] += basis[i] * y
      for (let j = 0; j < k; j++) ata[i][j] += basis[i] * basis[j]
    }
  }
  // Gaussian elimination.
  for (let i = 0; i < k; i++) {
    let p = i
    for (let r = i + 1; r < k; r++) if (Math.abs(ata[r][i]) > Math.abs(ata[p][i])) p = r
    ;[ata[i], ata[p]] = [ata[p], ata[i]]
    ;[atb[i], atb[p]] = [atb[p], atb[i]]
    for (let r = i + 1; r < k; r++) {
      const f = ata[r][i] / ata[i][i]
      for (let c = i; c < k; c++) ata[r][c] -= f * ata[i][c]
      atb[r] -= f * atb[i]
    }
  }
  const x = new Float64Array(k)
  for (let i = k - 1; i >= 0; i--) {
    let s = atb[i]
    for (let c = i + 1; c < k; c++) s -= ata[i][c] * x[c]
    x[i] = s / ata[i][i]
  }
  let worst = 0
  for (const [s, y] of rows) worst = Math.max(worst, Math.abs(x[0] * s + x[1] * s ** 3 + x[2] * s ** 5 + x[3] * s ** 7 - y))
  return { coefficients: Array.from(x), worst }
}

// Integer hash (lowbias32) for seeded noise and jitter.
function hash(x, y, seed) {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0
  h ^= h >>> 16
  h = Math.imul(h, 0x7feb352d) >>> 0
  h ^= h >>> 15
  h = Math.imul(h, 0x846ca68b) >>> 0
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

function valueNoise(x, y, seed) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const fx = x - xi
  const fy = y - yi
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const a = hash(xi, yi, seed)
  const b = hash(xi + 1, yi, seed)
  const c = hash(xi, yi + 1, seed)
  const d = hash(xi + 1, yi + 1, seed)
  return (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * 2 - 1
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Mean of smoothstep(a, b, t) for t uniform on [0, 1]: the cell's mean ink, also where the soft edge leaves 0..1. */
export function inkMean(a, b) {
  const G = (x) => x * x * x - (x * x * x * x) / 2
  const clampUnit = (x) => Math.min(1, Math.max(0, x))
  const x0 = clampUnit((0 - a) / (b - a))
  const x1 = clampUnit((1 - a) / (b - a))
  return (b - a) * (G(x1) - G(x0)) + Math.max(0, 1 - Math.max(b, 0))
}

/** Ink (0..1) at a point of the frame in output pixels, for coverage c, and the cell's mean ink. */
function inkAt(x, y, c, frame) {
  const { pitchPx, cos, sin, edge, wobble, jitter, cross, seed } = frame
  const px = x / pitchPx
  const py = y / pitchPx
  let u = px * cos + py * sin
  let v = -px * sin + py * cos
  if (wobble > 0) {
    const du = wobble * valueNoise(u / 6, v / 6, seed)
    const dv = wobble * valueNoise(u / 6 + 37.2, v / 6 + 11.7, seed + 1)
    u += du
    v += dv
  }
  const cu = Math.floor(u)
  const cv = Math.floor(v)
  const cj = Math.min(1, Math.max(0, c + jitter * (2 * hash(cu, cv, seed + 2) - 1) * Math.min(1, 4 * c * (1 - c))))
  const s = (Math.cos(2 * Math.PI * u) + cross * Math.cos(2 * Math.PI * v)) / (1 + cross)
  const t = polyRank(s, frame.rank)
  const a = 1 - cj - edge
  const b = 1 - cj + edge
  return { ink: smoothstep(a, b, t), coverage: inkMean(a, b) }
}

/** The GLSL version's rank: the odd polynomial fit of spotRank, clamped. */
function polyRank(s, [k1, k3, k5, k7]) {
  const x = Math.min(1, Math.max(-1, s))
  const x2 = x * x
  return Math.min(1, Math.max(0, 0.5 + x * (k1 + x2 * (k3 + x2 * (k5 + x2 * k7)))))
}

/** Per-frame values: the screen period in output pixels and the fade for screens too fine to draw. */
export function screenFrame(width, height, seed, params = SCREEN) {
  const pitchPx = params.pitch * Math.min(width, height)
  const rad = (params.angle * Math.PI) / 180
  return {
    pitchPx,
    cos: Math.cos(rad),
    sin: Math.sin(rad),
    edge: params.edge,
    wobble: params.wobble,
    jitter: params.jitter,
    cross: params.cross,
    rank: fitSpotRank(params.cross).coefficients,
    seed,
    fade: smoothstep(2.2, 3.6, pitchPx),
  }
}

const SRGB_TO_LINEAR = Array.from({ length: 256 }, (_, v) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
})
const linearToSrgb = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)

function toOklab(r, g, b) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function fromOklab(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

/**
 * Applies the screen to an 8-bit render made without dither: decodes to display-linear, screens the lightness,
 * encodes and adds TPDF dither of about 1 code value (unless `dither` is false), as the engine's output pass does.
 * Returns RGBA8.
 */
export function applyScreen(image, strength, seed = 1, params = SCREEN, { dither = true } = {}) {
  const { width: w, height: h, data } = image
  const frame = screenFrame(w, h, seed, params)
  const out = new Uint8Array(w * h * 4)
  const amp = strength * params.amp * frame.fade
  const span = params.paper - params.ink
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const r = SRGB_TO_LINEAR[data[i]]
      const g = SRGB_TO_LINEAR[data[i + 1]]
      const b = SRGB_TO_LINEAR[data[i + 2]]
      let rgb = [r, g, b]
      if (amp > 0) {
        const lab = toOklab(r, g, b)
        const c = Math.min(1, Math.max(0, (params.paper - lab[0]) / span))
        // 2 x 2 samples per pixel, so a fine screen does not alias.
        let delta = 0
        for (const [dx, dy] of [
          [0.25, 0.25],
          [0.75, 0.25],
          [0.25, 0.75],
          [0.75, 0.75],
        ]) {
          const { ink, coverage } = inkAt(x + dx, y + dy, c, frame)
          delta += (ink - coverage) / 4
        }
        // Fine noise in the same ink: zero mean, the same lightness curve as the screen (sqrt of c (1 - c)).
        const grain = (hash(x, y, seed + 3) + hash(x, y, seed + 4) + hash(x, y, seed + 5) - 1.5) * 2
        const share = params.noise + (params.lightNoise - params.noise) * smoothstep(0.5, 0.72, lab[0])
        const swing = (1 - share) * delta + share * 0.5 * Math.sqrt(c * (1 - c)) * grain
        rgb = fromOklab(lab[0] - amp * swing, lab[1], lab[2]).map((v) => Math.min(1, Math.max(0, v)))
      }
      for (let k = 0; k < 3; k++) {
        const noise = dither ? hash(x, y, seed * 7 + k * 101 + 9001) + hash(x + 7919, y + 104729, seed * 7 + k * 101 + 9002) - 1 : 0
        const v = linearToSrgb(rgb[k]) * 255 + noise
        out[i + k] = Math.max(0, Math.min(255, Math.floor(v + 0.5)))
      }
      out[i + 3] = 255
    }
  }
  return { width: w, height: h, data: out }
}
