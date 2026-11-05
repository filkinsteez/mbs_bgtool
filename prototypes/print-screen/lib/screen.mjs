// Print screen: a soft halftone mesh in the frame's own ink, on Oklab lightness only.
// CPU reference of the stage; stage.mjs has the same math in GLSL for the engine's output filter chain.
//
// Per output pixel, after the tone curve (display-linear in, display-linear out):
//   c     = ink coverage from lightness: 0 at paper white (L 0.97), 1 at full ink (L 0.12); dots and mottle use
//           c^1.5, so the texture is strongest at L 0.43, as on the poster
//   mesh  = a halftone of two waves, the poster's 4.7 px at 51 deg and 3.8 px at 16 deg (at 960 px), so the dots
//           form a mesh, not rows; each wave is warped by short seeded noise so no row lines up for more than a
//           few cells, and each dot's coverage is jittered
//   fine  = round two-pixel dots at 57 and 147 deg, which take over in light ink (L 0.45 to 0.62), as on the poster
//   ink   = smoothstep(1 - c' - edge, 1 - c' + edge, rank of the spot value); minus the cell's mean ink, so each
//           cell keeps its mean lightness
//   L'    = L - amount(strength) * amp * ends(c) * ((1 - share) * halftone + share * mottle * 0.5 sqrt(c (1 - c)))
//           where ends(c) fades the screen out within 6 % of paper white and of full ink, and the mottle's share is
//           0.68 with the mesh and 0.55 with the fine dots
// Hue and chroma stay the frame's own; paper white and black stay exact. Sizes are shares of the short side. The
// strength sets the amount only, as Grain's does: amount = strength^0.6, and 1 is the poster.

export const SCREEN = {
  /** The main wave: period as a share of the short side (4.7 px at 960) and angle (x right, y down). */
  pitch: 0.0049,
  angle: 51,
  /** The second wave of the mesh (3.8 px at 16 deg at 960) and its weight against the main wave. */
  pitch2: 0.00396,
  angle2: 16,
  weight2: 0.55,
  /** Light-ink dots: period (2.05 px at 960) and angle; the second direction is 90 deg on. */
  finePitch: 0.00214,
  fineAngle: 57,
  /** Lightness where the mesh hands over to the fine dots. */
  lightLo: 0.45,
  lightHi: 0.62,
  /** Dot edge width in coverage units; wider is softer. */
  edge: 0.3,
  /** Warp of each wave in cells, over `warpScale` cells, so rows break up every few cells. */
  warp: 0.42,
  warpScale: 2.5,
  fineWarp: 0.15,
  /** Dot-to-dot coverage jitter. */
  jitter: 0.2,
  /** Share of the swing that is broadband mottle in the same ink instead of halftone, with the mesh and with the fine dots. */
  noise: 0.68,
  noiseLight: 0.55,
  /** Mottle: value noise at two sizes (shares of the short side) and their weights. */
  mottle1: 0.0011,
  mottle2: 0.0026,
  mottleW1: 0.7,
  mottleW2: 0.5,
  /** Lightness swing at strength 1 (Oklab L): the poster's high-pass RMS in its four color areas (strength.mjs). */
  amp: 0.0977,
  /** The swing rises as strength^amountPower. */
  amountPower: 0.6,
  /** Lightness of paper white and full ink for the coverage. */
  paper: 0.97,
  ink: 0.12,
  /** Dots and mottle use coverage^coverageGamma, which puts the strongest texture at L 0.43, as on the poster. */
  coverageGamma: 1.5,
}

// Fraction of a cell where the spot function (cos 2 pi u + k cos 2 pi v) / (1 + k) is below s, for s in [-1, 1],
// with u and v uniform and independent (true for two waves that are not parallel).
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

/** Rank of a spot value, uniform on 0..1 over a cell (table). */
export function spotRank(s, k) {
  const cdf = spotCdf(k)
  const x = ((Math.min(1, Math.max(-1, s)) + 1) / 2) * CDF_SIZE
  const i = Math.min(CDF_SIZE - 1, Math.floor(x))
  return cdf[i] + (cdf[i + 1] - cdf[i]) * (x - i)
}

const rankFits = new Map()
/** Odd polynomial fit of spotRank(s) - 0.5 in s (coefficients of s, s^3, s^5, s^7), shared with the GLSL. */
export function fitSpotRank(k) {
  const cached = rankFits.get(k)
  if (cached) return cached
  const rows = []
  for (let t = 0; t <= 400; t++) {
    const s = -1 + (2 * t) / 400
    rows.push([s, spotRank(s, k) - 0.5])
  }
  const terms = 4
  const ata = Array.from({ length: terms }, () => new Float64Array(terms))
  const atb = new Float64Array(terms)
  for (const [s, y] of rows) {
    const basis = [s, s ** 3, s ** 5, s ** 7]
    for (let i = 0; i < terms; i++) {
      atb[i] += basis[i] * y
      for (let j = 0; j < terms; j++) ata[i][j] += basis[i] * basis[j]
    }
  }
  for (let i = 0; i < terms; i++) {
    let p = i
    for (let r = i + 1; r < terms; r++) if (Math.abs(ata[r][i]) > Math.abs(ata[p][i])) p = r
    ;[ata[i], ata[p]] = [ata[p], ata[i]]
    ;[atb[i], atb[p]] = [atb[p], atb[i]]
    for (let r = i + 1; r < terms; r++) {
      const f = ata[r][i] / ata[i][i]
      for (let c = i; c < terms; c++) ata[r][c] -= f * ata[i][c]
      atb[r] -= f * atb[i]
    }
  }
  const x = new Float64Array(terms)
  for (let i = terms - 1; i >= 0; i--) {
    let s = atb[i]
    for (let c = i + 1; c < terms; c++) s -= ata[i][c] * x[c]
    x[i] = s / ata[i][i]
  }
  let worst = 0
  for (const [s, y] of rows) worst = Math.max(worst, Math.abs(x[0] * s + x[1] * s ** 3 + x[2] * s ** 5 + x[3] * s ** 7 - y))
  const fit = { coefficients: Array.from(x), worst }
  rankFits.set(k, fit)
  return fit
}

function polyRank(s, [k1, k3, k5, k7]) {
  const x = Math.min(1, Math.max(-1, s))
  const x2 = x * x
  return Math.min(1, Math.max(0, 0.5 + x * (k1 + x2 * (k3 + x2 * (k5 + x2 * k7)))))
}

// Integer hash (lowbias32), the same bits as printHash in the GLSL.
export function hash(x, y, seed) {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0
  h ^= h >>> 16
  h = Math.imul(h, 0x7feb352d) >>> 0
  h ^= h >>> 15
  h = Math.imul(h, 0x846ca68b) >>> 0
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

export function valueNoise(x, y, seed) {
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

/** Standard deviation of valueNoise over the plane (measured once), to give the mottle unit variance. */
const VALUE_NOISE_STD = (() => {
  let s = 0
  let s2 = 0
  const n = 200000
  for (let i = 0; i < n; i++) {
    const v = valueNoise((i % 997) * 0.731 + 0.13, Math.floor(i / 997) * 0.617 + 0.29, 12345)
    s += v
    s2 += v * v
  }
  return Math.sqrt(s2 / n - (s / n) ** 2)
})()

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

/** Halftone ink minus its cell's mean, for wave phases u, v (already warped), spot weight k and coverage c. */
function halftone(u, v, k, rank, c, edge, jitter, seed) {
  const cj = Math.min(1, Math.max(0, c + jitter * (2 * hash(Math.floor(u), Math.floor(v), seed) - 1) * Math.min(1, 4 * c * (1 - c))))
  const s = (Math.cos(2 * Math.PI * u) + k * Math.cos(2 * Math.PI * v)) / (1 + k)
  const a = 1 - cj - edge
  const b = 1 - cj + edge
  return smoothstep(a, b, polyRank(s, rank)) - inkMean(a, b)
}

function meshDelta(x, y, c, f) {
  let u = (x * f.dir1[0] + y * f.dir1[1]) / f.pitch1
  let v = (x * f.dir2[0] + y * f.dir2[1]) / f.pitch2
  const du = f.warp * valueNoise(u / f.warpScale, v / f.warpScale, f.seed)
  const dv = f.warp * valueNoise(u / f.warpScale + 37.2, v / f.warpScale + 11.7, f.seed + 1)
  u += du
  v += dv
  return halftone(u, v, f.weight2, f.rankMesh, c, f.edge, f.jitter, f.seed + 2)
}

function fineDelta(x, y, c, f) {
  let u = (x * f.dirF[0] + y * f.dirF[1]) / f.pitchF
  let v = (-x * f.dirF[1] + y * f.dirF[0]) / f.pitchF
  const du = f.fineWarp * valueNoise(u / 3, v / 3, f.seed + 5)
  const dv = f.fineWarp * valueNoise(u / 3 + 19.1, v / 3 + 5.3, f.seed + 6)
  u += du
  v += dv
  return halftone(u, v, 1, f.rankFine, c, f.edge, f.jitter, f.seed + 7)
}

/** Lightness swing for a strength 0..1: the strength sets the amount only. */
export function screenAmp(strength, params = SCREEN) {
  const s = Math.min(1, Math.max(0, Number.isFinite(strength) ? strength : 0))
  return params.amp * s ** params.amountPower
}

/**
 * Per-frame values: the waves in output pixels and the fades for screens too fine to draw. `fadeMesh` fades the whole
 * screen, mottle included, on small frames (thumbnails); `fadeFine` fades the fine dots on their own, earlier.
 */
export function screenFrame(width, height, seed, params = SCREEN) {
  const short = Math.min(width, height)
  const dir = (deg) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)]
  const pitch1 = params.pitch * short
  const pitchF = params.finePitch * short
  return {
    seed,
    pitch1,
    pitch2: params.pitch2 * short,
    pitchF,
    dir1: dir(params.angle),
    dir2: dir(params.angle2),
    dirF: dir(params.fineAngle),
    weight2: params.weight2,
    edge: params.edge,
    warp: params.warp,
    warpScale: params.warpScale,
    fineWarp: params.fineWarp,
    jitter: params.jitter,
    rankMesh: fitSpotRank(params.weight2).coefficients,
    rankFine: fitSpotRank(1).coefficients,
    fadeMesh: smoothstep(2.2, 3.6, pitch1),
    fadeFine: smoothstep(1.6, 2.4, pitchF),
    mottle1: Math.max(0.5, params.mottle1 * short),
    mottle2: Math.max(0.5, params.mottle2 * short),
    mottleNorm: VALUE_NOISE_STD * Math.hypot(params.mottleW1, params.mottleW2),
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

const SUBSAMPLES = [
  [0.25, 0.25],
  [0.75, 0.25],
  [0.25, 0.75],
  [0.75, 0.75],
]

/**
 * Applies the screen to an 8-bit render made without dither: decodes to display-linear, screens the lightness,
 * encodes and adds TPDF dither of about 1 code value (unless `dither` is false), as the engine's output pass does
 * (with its own hash, so only the undithered output matches the GPU's). Returns RGBA8.
 */
export function applyScreen(image, strength, seed = 1, params = SCREEN, { dither = true } = {}) {
  const { width: w, height: h, data } = image
  const f = screenFrame(w, h, seed, params)
  const out = new Uint8Array(w * h * 4)
  const amp = screenAmp(strength, params) * f.fadeMesh
  const span = params.paper - params.ink
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const r = SRGB_TO_LINEAR[data[i]]
      const g = SRGB_TO_LINEAR[data[i + 1]]
      const b = SRGB_TO_LINEAR[data[i + 2]]
      let rgb = [r, g, b]
      const lab = amp > 0 ? toOklab(r, g, b) : null
      const c = lab ? Math.min(1, Math.max(0, (params.paper - lab[0]) / span)) : 0
      // No dots at paper white or at full ink, so both stay exact.
      const ends = smoothstep(0, 0.06, c) * smoothstep(0, 0.06, 1 - c)
      if (ends > 0) {
        const wf = smoothstep(params.lightLo, params.lightHi, lab[0])
        const cg = c ** params.coverageGamma
        let delta = 0
        for (const [dx, dy] of SUBSAMPLES) {
          const mesh = wf < 1 ? meshDelta(x + dx, y + dy, cg, f) : 0
          const fine = wf > 0 ? fineDelta(x + dx, y + dy, cg, f) : 0
          delta += ((1 - wf) * mesh + wf * f.fadeFine * fine) / 4
        }
        const mottle = (params.mottleW1 * valueNoise(x / f.mottle1, y / f.mottle1, seed + 3) + params.mottleW2 * valueNoise(x / f.mottle2, y / f.mottle2, seed + 4)) / f.mottleNorm
        const share = params.noise + (params.noiseLight - params.noise) * wf
        const swing = ends * ((1 - share) * delta + share * 0.5 * Math.sqrt(cg * (1 - cg)) * mottle)
        rgb = fromOklab(lab[0] - amp * swing, lab[1], lab[2]).map((v) => Math.min(1, Math.max(0, v)))
      }
      for (let k = 0; k < 3; k++) {
        const v = linearToSrgb(rgb[k]) * 255
        let noise = 0
        if (dither) {
          // Within half a code value of 0 and 255 the noise blends to uniform +-0.5, so 0 and 255 stay exact.
          const u = hash(x, y, seed * 7 + k * 101 + 9001)
          const triangular = u + hash(x + 7919, y + 104729, seed * 7 + k * 101 + 9002) - 1
          const edge = Math.min(Math.min(1, Math.max(0, v / 0.5)), 1 - Math.min(1, Math.max(0, (v - 254.5) / 0.5)))
          noise = u - 0.5 + (triangular - (u - 0.5)) * edge
        }
        out[i + k] = Math.max(0, Math.min(255, Math.floor(v + noise + 0.5)))
      }
      out[i + 3] = 255
    }
  }
  return { width: w, height: h, data: out }
}
