// CPU study of tone curves above max channel 1: renders soft glows (gaussian dots and lines) and ramps in
// the 12 pack colors through the old engine curve and each alternative, side by side, into artifacts/tone-study/.
// `engine` repeats the constants of src/light/engine/output.ts; keep them in step when the curve changes.
// Usage: node scripts/light/tone-study.mjs [--curves old,engine,...] [--out dir]
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { list, parseArgs } from './lib/args.mjs'
import { composeRow, savePng, zoom } from './lib/images.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = parseArgs()
const outDir = path.resolve(ROOT, typeof args.out === 'string' ? args.out : 'artifacts/tone-study')

const LUMA = [0.2126, 0.7152, 0.0722]
const lum = (c) => LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2]
const smoothstep = (edge, x) => {
  const t = Math.min(1, Math.max(0, x / edge))
  return t * t * (3 - 2 * t)
}
const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const toSrgb = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)
const hexToLinear = (hex) => [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255))
const toHex = (c) => '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, toSrgb(Math.max(0, v)))) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()

function oklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}
function fromOklab([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}
const lch = (c) => {
  const [L, a, b] = oklab(c)
  return [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360]
}

// ---------------------------------------------------------------------------
// Curves. Each maps scene-linear rgb to display-linear rgb, identity while max <= 1.

/** The engine curve before this study: straight Oklab line to white at constant hue, exponential rate. */
function oklabPath(lab, s) {
  const L = lab[0] + (1 - lab[0]) * s
  const a = lab[1] * (1 - s)
  const b = lab[2] * (1 - s)
  let rgb = fromOklab([L, a, b])
  if (Math.max(...rgb) > 1) {
    let lo = 0
    let hi = 1
    for (let i = 0; i < 20; i++) {
      const mid = 0.5 * (lo + hi)
      if (Math.max(...fromOklab([L, a * mid, b * mid])) > 1) hi = mid
      else lo = mid
    }
    rgb = fromOklab([L, a * lo, b * lo])
  }
  return rgb.map((v) => Math.max(0, v))
}

function oklabCurve(shoulder) {
  return (c) => {
    c = c.map((v) => Math.max(0, v))
    const m = Math.max(...c)
    if (m <= 1) return c
    const h = c.map((v) => v / m)
    const lab = oklab(h)
    if (lab[0] >= 0.9999) return [1, 1, 1]
    const y = lum(h)
    const eps = 1e-3
    const k = y / Math.max((lum(oklabPath(lab, eps)) - y) / eps, 1e-4)
    return oklabPath(lab, shoulder(m - 1, k)).map((v) => Math.min(1, v))
  }
}

const expShoulder = (x, k) => 1 - Math.exp(-x * k)
const powShoulder = (n) => (x, k) => 1 - (1 + (x * k) / n) ** -n

/**
 * Camera-like path: each channel closes its gap to 1 at its own rate, so the brighter of the two lower
 * channels fills first (orange-red -> orange -> yellow -> white; blue -> azure -> pale cyan -> white).
 * Rates come from the channel's own light plus a little crosstalk from the others (x[j][i]: how much of
 * channel i's light channel j sees). One overall rate keeps the luminance slope continuous at m = 1.
 * `approach` turns the path parameter into per-channel closing: 'exp' (fast) or a power law (slower tail).
 */
function cameraCurve({ x, delta = 0.05, approach = 'exp', n = 2, whiten = 0, tie = 0 }) {
  return (c) => {
    c = c.map((v) => Math.max(0, v))
    const m = Math.max(...c)
    if (m <= 1) return c
    const r = c.map((v) => v / m)
    const base = [0, 1, 2].map((j) => r[j] + [0, 1, 2].reduce((sum, i) => sum + (i === j ? 0 : x[j][i] * r[i]), 0))
    const w = base.map((b, j) => b / (1 - r[j] + delta))
    // `tie`: within this gap of the largest, a channel's share blends toward the pair's mean share at the band edge.
    const top = r.indexOf(1)
    const near = (j) => (tie > 0 && j !== top ? 1 - smoothstep(tie, 1 - r[j]) : 0)
    const pair = (j) => 0.5 * (LUMA[j] * base[j] + LUMA[top] * base[top]) * (tie / (tie + delta))
    const slope = [0, 1, 2].reduce((sum, j) => (j === top ? sum : sum + (1 - near(j)) * LUMA[j] * (1 - r[j]) * w[j] + near(j) * pair(j)), 0)
    const k = lum(r) / Math.max(slope, 1e-6)
    const t = approach === 'exp' ? k * (m - 1) : n * Math.log(1 + (k * (m - 1)) / n)
    // The whiten term has zero slope at m = 1, so it leaves the knee alone and only closes the slow channels far above it.
    const late = whiten * (m - 1) * (m - 1)
    return r.map((rj, j) => 1 - (1 - rj) * Math.exp(-t * w[j] - late))
  }
}

/** Lottes-style crosstalk path from the research notes: lerp to white in a pow(ratio, 1/s) space. */
function lottesCurve(s) {
  return (c) => {
    c = c.map((v) => Math.max(0, v))
    const m = Math.max(...c)
    if (m <= 1) return c
    const r = c.map((v) => v / m)
    const rs = r.map((v) => v ** (1 / s))
    const rf = r.map((v) => Math.max(v, 1e-6))
    const slope = [0, 1, 2].reduce((sum, j) => sum + LUMA[j] * s * rf[j] ** ((s - 1) / s) * (1 - rf[j] ** (1 / s)), 0)
    const k = Math.min(50, Math.max(0.05, lum(r) / Math.max(slope, 1e-4)))
    const wt = 1 - Math.exp(-k * (m - 1))
    return rs.map((v) => (v + (1 - v) * wt) ** s)
  }
}

const X_CAMERA = [
  [0, 0.12, 0.06],
  [0.15, 0, 0.12],
  [0.02, 0.1, 0],
]
const X_CAMERA_SOFT = [
  [0, 0.16, 0.16],
  [0.18, 0, 0.16],
  [0.05, 0.14, 0],
]

const X_BLUE_HOLD = [
  [0, 0.12, 0.22],
  [0.15, 0, 0.25],
  [0.02, 0.1, 0],
]
// Red sees green strongly, so blues that carry some green (Meta Blue) keep their hue longer, while pure blue still
// fills green before red and drifts toward cyan instead of violet.
const X_RED_SEES_GREEN = [
  [0, 0.8, 0.16],
  [0.15, 0, 0.3],
  [0.02, 0.15, 0],
]

const CURVES = {
  old: { label: 'old: Oklab constant hue', fn: oklabCurve(expShoulder) },
  'oklab-pow2': { label: 'Oklab constant hue, slower tail', fn: oklabCurve(powShoulder(2)) },
  camera: { label: 'camera, exp', fn: cameraCurve({ x: X_CAMERA }) },
  'camera-pow2': { label: 'camera, slower tail', fn: cameraCurve({ x: X_CAMERA, approach: 'pow', n: 2 }) },
  'camera-soft': { label: 'camera, more crosstalk', fn: cameraCurve({ x: X_CAMERA_SOFT, approach: 'pow', n: 2 }) },
  'camera-w': { label: 'camera, late whitening 0.005', fn: cameraCurve({ x: X_CAMERA, whiten: 0.005 }) },
  'camera-bw': { label: 'camera, blue held, late whitening 0.005', fn: cameraCurve({ x: X_BLUE_HOLD, whiten: 0.005 }) },
  'camera-bw2': { label: 'camera, blue held, late whitening 0.01', fn: cameraCurve({ x: X_BLUE_HOLD, whiten: 0.01 }) },
  engine: { label: 'engine: camera, red sees green, late whitening 0.005', fn: cameraCurve({ x: X_RED_SEES_GREEN, whiten: 0.005, tie: 0.05 }) },
  lottes2: { label: 'Lottes s=2', fn: lottesCurve(2) },
  lottes3: { label: 'Lottes s=3', fn: lottesCurve(3) },
}

// ---------------------------------------------------------------------------
// Images

const PACK_HEXES = {
  bold: ['#0064E0', '#1FCDF0', '#FFD61E', '#FF4F00'],
  elemental: ['#0064E0', '#D6F26C', '#0F3D33', '#B8996E', '#4A0A3C'],
  atmospheric: ['#0064E0', '#F2F4F7', '#6A7788', '#384753', '#1C2B33'],
}
const ALL_HEXES = [...new Set(Object.values(PACK_HEXES).flat())]
const GLOW_GAINS = [1.5, 3, 8]
const CELL = 56

/** Radiance of one cell: a gaussian dot or a vertical gaussian line with soft ends, peak `gain` x the color. */
function glowCell(kind, gain) {
  const out = new Float32Array(CELL * CELL)
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const dx = x + 0.5 - CELL / 2
      const dy = y + 0.5 - CELL / 2
      if (kind === 'dot') out[y * CELL + x] = gain * Math.exp(-(dx * dx + dy * dy) / (2 * 8 * 8))
      else {
        const along = Math.abs(dy) / (CELL / 2 - 4)
        const ends = along < 0.6 ? 1 : Math.exp(-(((along - 0.6) / 0.18) ** 2))
        out[y * CELL + x] = gain * ends * Math.exp(-(dx * dx) / (2 * 5 * 5))
      }
    }
  }
  return out
}

const CELLS = [
  ...GLOW_GAINS.map((gain) => ({ kind: 'dot', gain, field: glowCell('dot', gain) })),
  ...GLOW_GAINS.map((gain) => ({ kind: 'line', gain, field: glowCell('line', gain) })),
]

function glowSheet(curve, hexes) {
  const width = CELLS.length * CELL
  const height = hexes.length * CELL
  const data = new Uint8Array(width * height * 4)
  hexes.forEach((hex, row) => {
    const color = hexToLinear(hex)
    CELLS.forEach((cell, column) => {
      for (let y = 0; y < CELL; y++) {
        for (let x = 0; x < CELL; x++) {
          const v = cell.field[y * CELL + x]
          const out = curve(color.map((c) => c * v))
          const i = ((row * CELL + y) * width + column * CELL + x) * 4
          for (let k = 0; k < 3; k++) data[i + k] = Math.round(Math.min(1, Math.max(0, toSrgb(out[k]))) * 255)
          data[i + 3] = 255
        }
      }
    })
  })
  return { width, height, data }
}

const RAMP_WIDTH = 640
const RAMP_HEIGHT = 22
const RAMP_MAX = 16

/** Ramps 0 -> 16x per color with intensity 16 u^2, so 1x sits at a quarter of the width. */
function rampSheet(curve, hexes) {
  const width = RAMP_WIDTH
  const height = hexes.length * RAMP_HEIGHT
  const data = new Uint8Array(width * height * 4)
  hexes.forEach((hex, row) => {
    const color = hexToLinear(hex)
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width
      const out = curve(color.map((c) => c * RAMP_MAX * u * u))
      const bytes = out.map((v) => Math.round(Math.min(1, Math.max(0, toSrgb(v))) * 255))
      for (let y = 0; y < RAMP_HEIGHT - 3; y++) {
        const i = ((row * RAMP_HEIGHT + y) * width + x) * 4
        data[i] = bytes[0]
        data[i + 1] = bytes[1]
        data[i + 2] = bytes[2]
        data[i + 3] = 255
      }
    }
    for (let y = RAMP_HEIGHT - 3; y < RAMP_HEIGHT; y++) for (let x = 0; x < width; x++) data[((row * RAMP_HEIGHT + y) * width + x) * 4 + 3] = 255
  })
  return { width, height, data }
}

/** Hue path in numbers: hex and Oklab L, C, h at a few intensities. */
function huePath(curve, hex) {
  const color = hexToLinear(hex)
  return [1, 1.5, 2, 3, 4, 8, 16, 32]
    .map((gain) => {
      const out = curve(color.map((c) => c * gain))
      const [L, C, h] = lch(out)
      return `${gain}x ${toHex(out)} L${L.toFixed(2)} C${C.toFixed(3)} h${C > 0.01 ? h.toFixed(0) : '-'}`
    })
    .join(' | ')
}

/** Luminance slope just above / just below the knee, and the largest Oklab chroma slope jump. */
function kneeStats(curve, hex) {
  const color = hexToLinear(hex)
  const m = Math.max(...color)
  const at = (scale) => curve(color.map((v) => (v / m) * scale))
  const h = 1e-4
  const below = (lum(at(1)) - lum(at(1 - h))) / h
  const above = (lum(at(1 + h)) - lum(at(1)) ) / h
  const cBelow = (lch(at(1))[1] - lch(at(1 - h))[1]) / h
  const cAbove = (lch(at(1 + h))[1] - lch(at(1))[1]) / h
  return { slopeRatio: above / below, chromaBelow: cBelow, chromaAbove: cAbove }
}

const wanted = list(args.curves)
const names = wanted.length ? wanted : Object.keys(CURVES)
for (const name of names) if (!CURVES[name]) throw new Error(`Unknown curve ${name}`)

for (const name of names) {
  const curve = CURVES[name].fn
  console.log(`\n${name}: ${CURVES[name].label}`)
  for (const hex of ALL_HEXES) {
    const knee = kneeStats(curve, hex)
    console.log(`  ${hex} slope ${knee.slopeRatio.toFixed(3)} dC ${knee.chromaBelow.toFixed(3)} -> ${knee.chromaAbove.toFixed(3)} :: ${huePath(curve, hex)}`)
  }
}

for (const name of names) {
  if (name === 'old') continue
  for (const [pack, hexes] of Object.entries(PACK_HEXES)) {
    await composeRow(path.join(outDir, `glows-${pack}-${name}.png`), [
      { image: await zoom(glowSheet(CURVES.old.fn, hexes), 2), caption: `${CURVES.old.label}: dots, lines at 1.5x, 3x, 8x` },
      { image: await zoom(glowSheet(CURVES[name].fn, hexes), 2), caption: CURVES[name].label },
    ])
  }
  await composeRow(path.join(outDir, `ramps-${name}.png`), [
    { image: rampSheet(CURVES.old.fn, ALL_HEXES), caption: `${CURVES.old.label}: 0 -> 16x, 1x at 1/4` },
    { image: rampSheet(CURVES[name].fn, ALL_HEXES), caption: CURVES[name].label },
  ])
}
await savePng(path.join(outDir, 'ramps-old.png'), rampSheet(CURVES.old.fn, ALL_HEXES))
console.log(`\nimages in ${path.relative(ROOT, outDir)}/`)
