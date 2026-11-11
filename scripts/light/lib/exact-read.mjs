// Exact pack colors: which pack color each pixel of a frame reads as, exactly (scripts/light/exact-colors.mjs).
//
// A pixel reads as a pack color when it sits within EXACT.near in Oklab a, b, at its own lightness, of that color's
// own line. Below the hex the line is the color's dim path (the engine's dimPaths); above it, the hex's hue with chroma
// between the straight line to white and the hex's own (the tone curve holds chroma longer than the straight line),
// up to EXACT.ramp of the way to white. Further up it reads as that color, pale. A soft blend of two pack colors near
// in hue (their far-apartness by the meeting rule under EXACT.nearApart) counts for both, split by how much light each
// brings, as the owner lets near hues mix as light. The rest is off-pack: thin meeting lines between two far-apart
// colors, other thin off-pack areas, and wide off-pack areas.
import { LIN, oklab } from './color-read.mjs'

export const EXACT = {
  near: 0.03, // Oklab a, b distance from a color's line
  ramp: 1 / 3, // exact up to this fraction of the way from the hex to white; pale beyond
  black: 0.12, // Oklab L below which a pixel counts as black
  nearApart: 0.5, // two colors whose far-apartness by the meeting rule is under this blend as light
  blendSteps: 32, // blend fractions tried between two near colors
  thin: 0.006, // off-pack areas narrower than about twice this share of the short side are thin
  around: 0.02, // a thin off-pack pixel is a meeting line when two far-apart colors read within this share of the short side
}

const luminance = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
const toLinear = (hex) => [1, 3, 5].map((i) => LIN[parseInt(hex.slice(i, i + 2), 16)])

/**
 * Reading rules for a pack. paths: each color's dim path as [L, C, h] points from the color itself down (the engine's
 * dimPaths). apart(a, b): how far apart two colors at luminance 1 are by the meeting rule, 0 to 1.
 */
export function exactRules(pack, paths, apart) {
  // A dim path that reaches another pack color stops there: below it the light reads as that color (dim Cyan turns into
  // Meta Blue, dim Yellow into Orange-red).
  const own = paths.map((path) => path[0])
  const colors = pack.colors.map((c, k) => {
    const lin = toLinear(c.hex)
    const y = luminance(lin)
    const reach = paths[k].findIndex((pt, i) => i > 0 && own.some((o, j) => j !== k && o.every((v, q) => Math.abs(v - pt[q]) < 1e-6)))
    return { name: c.name, hex: c.hex, unit: lin.map((v) => v / y), path: paths[k], stopL: reach > 0 ? paths[k][reach][0] : -1 }
  })
  const near = []
  const far = []
  for (let i = 0; i < colors.length; i++)
    for (let j = i + 1; j < colors.length; j++) {
      if (apart(colors[i].unit, colors[j].unit) >= EXACT.nearApart) {
        far.push([i, j])
        continue
      }
      // Light from both, t of it from i; a, b per unit of L, since more or less of the same light scales L, a, b alike.
      const steps = []
      for (let s = 1; s < EXACT.blendSteps; s++) {
        const t = s / EXACT.blendSteps
        const [L, a, b] = oklab(colors[i].unit.map((v, q) => t * v + (1 - t) * colors[j].unit[q]))
        steps.push([t, a / L, b / L])
      }
      near.push({ i, j, steps })
    }
  return { colors, near, far }
}

// The color's expected a, b at lightness L (a, b: the pixel's), and whether that point is past EXACT.ramp to white.
function expected(path, L, a, b) {
  const [L0, C0, h0] = path[0]
  if (L >= L0) {
    const t = (L - L0) / Math.max(1 - L0, 1e-6)
    if (t > 1) return null
    const h = (h0 * Math.PI) / 180
    const along = a * Math.cos(h) + b * Math.sin(h)
    const C = Math.min(Math.max(along, C0 * (1 - t)), C0)
    return [C * Math.cos(h), C * Math.sin(h), t > EXACT.ramp]
  }
  for (let i = 0; i + 1 < path.length; i++) {
    const [La, Ca, ha] = path[i]
    const [Lb, Cb, hb] = path[i + 1]
    if (L <= La && L >= Lb) {
      const u = La > Lb ? (La - L) / (La - Lb) : 0
      const C = Ca + (Cb - Ca) * u
      const h = ((ha + (hb - ha) * u) * Math.PI) / 180
      return [C * Math.cos(h), C * Math.sin(h), false]
    }
  }
  const [Ll, Cl, hl] = path[path.length - 1]
  const C = (Cl * L) / Math.max(Ll, 1e-6)
  const h = (hl * Math.PI) / 180
  return [C * Math.cos(h), C * Math.sin(h), false]
}

/**
 * How one pixel reads, from its Oklab L, a, b: { kind: 'black' | 'exact' | 'pale' | 'blend' | 'other' }, with k (the
 * color) for exact and pale, and i, j, t (t of the light from i) for a blend.
 */
export function readPixel(rules, L, a, b) {
  if (L < EXACT.black) return { kind: 'black' }
  let best = -1
  let bestD = EXACT.near
  let pale = false
  for (let k = 0; k < rules.colors.length; k++) {
    if (L <= rules.colors[k].stopL) continue
    const e = expected(rules.colors[k].path, L, a, b)
    if (!e) continue
    const d = Math.hypot(a - e[0], b - e[1])
    if (d <= bestD) {
      best = k
      bestD = d
      pale = e[2]
    }
  }
  if (best >= 0) return { kind: pale ? 'pale' : 'exact', k: best }
  let blend = null
  bestD = EXACT.near
  for (const p of rules.near)
    for (const [t, ax, bx] of p.steps) {
      const d = Math.hypot(a - L * ax, b - L * bx)
      if (d <= bestD) {
        bestD = d
        blend = { kind: 'blend', i: p.i, j: p.j, t }
      }
    }
  return blend ?? { kind: 'other' }
}

function integral(mask, w, h) {
  const s = new Int32Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      row += mask[y * w + x]
      s[(y + 1) * (w + 1) + x + 1] = s[y * (w + 1) + x + 1] + row
    }
  }
  return s
}
function boxSum(s, w, h, x, y, r) {
  const x0 = Math.max(0, x - r)
  const y0 = Math.max(0, y - r)
  const x1 = Math.min(w, x + r + 1)
  const y1 = Math.min(h, y + r + 1)
  return s[y1 * (w + 1) + x1] - s[y0 * (w + 1) + x1] - s[y1 * (w + 1) + x0] + s[y0 * (w + 1) + x0]
}

/**
 * Reads a frame (8-bit sRGB, `channels` per pixel). Shares of the frame: exact and pale per color name (a blend split
 * between its two colors counts as exact), black, and off-pack split into lines (thin, between two far-apart colors),
 * thinOther and wide. With wantMap, also map: per pixel the color index read (exact, pale or the blend's larger
 * side), -1 black, -2 off-pack.
 */
export function exactRead(rules, rgb, width, height, channels = 3, wantMap = false) {
  const n = width * height
  const names = rules.colors.map((c) => c.name)
  const exact = new Float64Array(names.length)
  const pale = new Float64Array(names.length)
  const reads = new Int8Array(n)
  const off = new Uint8Array(n)
  let black = 0
  for (let p = 0; p < n; p++) {
    const o = p * channels
    const [L, a, b] = oklab([LIN[rgb[o]], LIN[rgb[o + 1]], LIN[rgb[o + 2]]])
    const r = readPixel(rules, L, a, b)
    if (r.kind === 'black') {
      black++
      reads[p] = -1
    } else if (r.kind === 'exact') {
      exact[r.k]++
      reads[p] = r.k
    } else if (r.kind === 'pale') {
      pale[r.k]++
      reads[p] = r.k
    } else if (r.kind === 'blend') {
      exact[r.i] += r.t
      exact[r.j] += 1 - r.t
      reads[p] = r.t >= 0.5 ? r.i : r.j
    } else {
      off[p] = 1
      reads[p] = -2
    }
  }
  // Off-pack areas that survive an opening (erode, then grow back) at this radius are wide; the rest are thin.
  const short = Math.min(width, height)
  const rThin = Math.max(1, Math.round(EXACT.thin * short))
  const offSum = integral(off, width, height)
  const eroded = new Uint8Array(n)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - rThin)
      const y0 = Math.max(0, y - rThin)
      const area = (Math.min(width, x + rThin + 1) - x0) * (Math.min(height, y + rThin + 1) - y0)
      if (boxSum(offSum, width, height, x, y, rThin) === area) eroded[y * width + x] = 1
    }
  const erodedSum = integral(eroded, width, height)
  const rAround = Math.max(1, Math.round(EXACT.around * short))
  const colorSums = rules.colors.map((_, k) => integral(Uint8Array.from(reads, (v) => (v === k ? 1 : 0)), width, height))
  let wide = 0
  let lines = 0
  let thinOther = 0
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      if (!off[p]) continue
      if (boxSum(erodedSum, width, height, x, y, rThin) > 0) {
        wide++
        continue
      }
      const present = colorSums.map((s) => boxSum(s, width, height, x, y, rAround) > 0)
      if (rules.far.some(([i, j]) => present[i] && present[j])) lines++
      else thinOther++
    }
  const share = (arr) => Object.fromEntries(names.map((name, k) => [name, arr[k] / n]))
  const result = { exact: share(exact), pale: share(pale), black: black / n, lines: lines / n, thinOther: thinOther / n, wide: wide / n }
  if (wantMap) result.map = reads
  return result
}
