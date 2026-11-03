// CPU versions of the proposed filters. Each takes a display-linear image (after the
// tone curve, max <= 1), a strength 0..1 and the seed, and returns a new image. Sizes
// are fractions of the short side, so every output size gets the same look.
import { linearToOklab, oklabToLinear } from './color.mjs'
import { CELL_COLS, CELL_ROWS, RAMP, glyphInk } from './font.mjs'
import { gaussianBlur } from './measure.mjs'
import { bspline4, cellValue, hash3, normalCdf, unit } from './noise.mjs'

const clamp01 = (v) => Math.min(1, Math.max(0, v))
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const mix = (a, b, t) => a + (b - a) * t
const copy = (img) => ({ w: img.w, h: img.h, data: new Float32Array(img.data) })

/** Unit-variance noise of blob sigma `sigma` px over the whole image: B-spline lattice (>= 0.6 px) or per-pixel. */
export function noiseField(w, h, sigma, seed) {
  const out = new Float32Array(w * h)
  if (sigma < 0.6) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = cellValue(x, y, seed)
    return out
  }
  const f = 0.577 / sigma
  const nx = Math.ceil(w * f) + 5
  const ny = Math.ceil(h * f) + 5
  const lattice = new Float32Array(nx * ny)
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) lattice[j * nx + i] = cellValue(i - 1, j - 1, seed)
  const colCell = new Int32Array(w)
  const colW = new Float32Array(w * 4)
  const colN = new Float32Array(w)
  for (let x = 0; x < w; x++) {
    const u = (x + 0.5) * f
    const c = Math.floor(u)
    const wx = bspline4(u - c)
    colCell[x] = c
    colW.set(wx, x * 4)
    colN[x] = wx[0] ** 2 + wx[1] ** 2 + wx[2] ** 2 + wx[3] ** 2
  }
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) * f
    const cy = Math.floor(v)
    const wy = bspline4(v - cy)
    const ny2 = wy[0] ** 2 + wy[1] ** 2 + wy[2] ** 2 + wy[3] ** 2
    for (let x = 0; x < w; x++) {
      const cx = colCell[x]
      let sum = 0
      for (let j = 0; j < 4; j++) {
        const row = (cy + j) * nx + cx
        sum += wy[j] * (colW[x * 4] * lattice[row] + colW[x * 4 + 1] * lattice[row + 1] + colW[x * 4 + 2] * lattice[row + 2] + colW[x * 4 + 3] * lattice[row + 3])
      }
      out[y * w + x] = sum / Math.sqrt(colN[x] * ny2)
    }
  }
  return out
}

/** Uniform 0..1 thresholds that clump at blob sigma `sigma` px (per-pixel below 0.6 px). */
export function thresholdField(w, h, sigma, seed) {
  if (sigma < 0.6) {
    const out = new Float32Array(w * h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = unit(hash3(x, y, seed))
    return out
  }
  return noiseField(w, h, sigma, seed).map(normalCdf)
}

// ---------------------------------------------------------------- Grain
// A port of src/light/engine/grain.ts (prototypes/grain-study): mono grain on Oklab L.

const OCTAVES = [0.5, 1, 2, 8]
const FILM = { amp: 0.015, size: 0.0005, weights: [0.35, 0.85, 0.35, 0], shadowEnd: 0.25, highlightCut: 0.5, inkBoost: 0 }
const RISO_END = { amp: 0.016, size: 0.0011, weights: [0.1, 0.6, 0.72, 0.12], shadowEnd: 0.2, highlightCut: 0, inkBoost: 0.9 }

export function grainParams(s) {
  const toRiso = smoothstep(0.6, 1, s)
  return {
    amp: mix(FILM.amp * Math.min(s / 0.6, 1), RISO_END.amp, toRiso),
    size: mix(FILM.size, RISO_END.size, toRiso),
    weights: FILM.weights.map((w, k) => mix(w, RISO_END.weights[k], toRiso)),
    shadowEnd: mix(FILM.shadowEnd, RISO_END.shadowEnd, toRiso),
    highlightCut: mix(FILM.highlightCut, RISO_END.highlightCut, toRiso),
    inkBoost: mix(FILM.inkBoost, RISO_END.inkBoost, toRiso),
  }
}

function grainAmplitude(p, L) {
  const shadow = smoothstep(0, p.shadowEnd, L)
  const highlight = 1 - p.highlightCut * smoothstep(0.5, 1, L)
  const ink = 1 + p.inkBoost * (0.5 - smoothstep(0.45, 0.85, L))
  return p.amp * shadow * highlight * ink
}

export function grainField(w, h, p, seed) {
  const short = Math.min(w, h)
  const sigmas = OCTAVES.map((rel) => rel * p.size * short)
  const norm = Math.sqrt(p.weights.reduce((s, x) => s + x * x, 0)) || 1
  const weights = p.weights.map((wk, k) => (wk * Math.sqrt(1 / (1 + 1 / (4 * Math.PI * sigmas[k] ** 2)))) / norm)
  const field = new Float32Array(w * h)
  for (let k = 0; k < 4; k++) {
    if (weights[k] <= 0) continue
    const n = noiseField(w, h, sigmas[k], seed * 131 + k * 7919 + 1048576)
    for (let i = 0; i < field.length; i++) field[i] += weights[k] * n[i]
  }
  return field
}

/** Grain: L' = L + amp(L) G(x) in Oklab; a and b unchanged. Zero mean in L. */
export function grain(img, s, seed = 1, params = grainParams(s)) {
  if (s <= 0 || params.amp <= 0) return copy(img)
  const { w, h, data } = img
  const field = grainField(w, h, params, seed)
  const out = new Float32Array(data.length)
  for (let i = 0, p = 0; p < field.length; p++, i += 3) {
    const lab = linearToOklab(data[i], data[i + 1], data[i + 2])
    lab[0] += grainAmplitude(params, lab[0]) * field[p]
    const rgb = oklabToLinear(lab[0], lab[1], lab[2])
    out[i] = clamp01(rgb[0])
    out[i + 1] = clamp01(rgb[1])
    out[i + 2] = clamp01(rgb[2])
  }
  return { w, h, data: out }
}

// ---------------------------------------------------------------- Riso
// Default (contrast 0): the riso end of the grain at every strength, amplitude times
// strength, so 1 is the measured riso prints. With contrast > 0 a two-level dot screen
// is added first (kept for the comparison sheet; it reads as pattern, see README):
// each pixel prints as paper white and its own ink on the line from white through the
// pixel colour: D = 1 - C (linear), coverage q, ink = 1 - D t with q t = 1, so
// q * ink + (1 - q) * paper = C exactly. Ink is at most `inkCap` times the pixel's own
// density. Strength blends between the pixel and its two-level print.

export function risoGrainParams(s) {
  return { ...RISO_END, amp: RISO_END.amp * s }
}

export function riso(img, s, seed = 1, opt = {}) {
  const { dotRel = 0.0006, contrast = 0, inkCap = 3, smoothPx = 1.2 } = opt
  if (s <= 0) return copy(img)
  if (contrast <= 0) return grain(img, s, seed + 7, risoGrainParams(s))
  const { w, h, data } = img
  const short = Math.min(w, h)
  // The shader reads float colour; the 8-bit screenshot has dither noise that would tint the ink near white.
  const smooth = gaussianBlur(img, smoothPx).data
  const threshold = thresholdField(w, h, dotRel * short, seed * 977 + 31)
  const k = s * contrast
  const out = new Float32Array(data.length)
  for (let i = 0, p = 0; p < w * h; p++, i += 3) {
    const d0 = clamp01(1 - smooth[i])
    const d1 = clamp01(1 - smooth[i + 1])
    const d2 = clamp01(1 - smooth[i + 2])
    const m = Math.max(d0, d1, d2)
    if (m < 1e-4) {
      out[i] = data[i]
      out[i + 1] = data[i + 1]
      out[i + 2] = data[i + 2]
      continue
    }
    const t = Math.min(1 / m, inkCap)
    const inked = threshold[p] < 1 / t
    const tt = inked ? t : 0
    out[i] = clamp01(data[i] + k * (1 - d0 * tt - smooth[i]))
    out[i + 1] = clamp01(data[i + 1] + k * (1 - d1 * tt - smooth[i + 1]))
    out[i + 2] = clamp01(data[i + 2] + k * (1 - d2 * tt - smooth[i + 2]))
  }
  return grain({ w, h, data: out }, s, seed + 7, risoGrainParams(s))
}

// ---------------------------------------------------------------- Cells (ASCII and Pixel)
// The frame is cut into cells sized by the short side. In each cell a mask M (a glyph
// or an LED spot, coverage g) splits the light into a lit part (x k) and a dim part
// (x d), with the areas weighted so the cell's mean light is unchanged. Strength sets d.
// The lit part can only rise until a channel reaches 1 (k <= 1 / peak); where it would
// pass that, d rises instead, so light bleeds through in the brightest cells.
// ASCII: in dark cells the glyph is lit (coverage >= peak, so it can carry the light);
// in bright cells the glyph is the dim part and the background is lit (coverage <= 1 - peak).
// So glyph density follows the light both ways and the text never needs light it does not have.

/** Factors for a cell: mask coverage g, lit part is the mask (litMask) or the rest, peak channel P. */
function cellFactors(g, litMask, P, dTarget) {
  const kMax = 1 / Math.max(P, 1e-6)
  const litArea = litMask ? g : 1 - g
  let d = dTarget
  let k = (1 - (1 - litArea) * d) / litArea
  if (k > kMax) {
    k = kMax
    d = (1 - litArea * k) / (1 - litArea)
  }
  return litMask ? { inMask: k, outMask: d } : { inMask: d, outMask: k }
}

/**
 * Glyph for a cell with peak channel P. The ideal coverage is P for a lit glyph and 1 - P
 * for a dim one; it is dithered between the two nearest glyphs by the cell's random
 * threshold u, so neighbouring rows mix glyphs instead of lining up in bands. Below
 * `floor` (linear) glyphs thin out (threshold u2) and stop, so a near-black base stays clean.
 */
function pickGlyph(P, floor, u, u2) {
  const lit = RAMP.slice(1)
  if (u2 >= smoothstep(floor / 3, floor, P)) return null
  const densest = lit[lit.length - 1].coverage
  const litMask = P <= densest
  const want = litMask ? P : 1 - P
  if (!litMask && want < lit[0].coverage * u) return null
  const i = lit.findIndex((gl) => gl.coverage >= want)
  if (i <= 0) return { glyph: lit[i < 0 ? lit.length - 1 : 0], litMask }
  const lo = lit[i - 1]
  const hi = lit[i]
  const t = (want - lo.coverage) / (hi.coverage - lo.coverage)
  return { glyph: u < t ? hi : lo, litMask }
}

export function cells(img, s, opt) {
  const { mode, rows, seed = 1, aspect = mode === 'ascii' ? CELL_COLS / CELL_ROWS : 1, flat = mode === 'led', dMin = 0.15, floor = 0.03, spot = 0.3 } = opt
  if (s <= 0) return copy(img)
  const { w, h, data } = img
  const short = Math.min(w, h)
  const ch = short / rows
  const cw = ch * aspect
  const ncols = Math.ceil(w / cw) + 1
  const nrows = Math.ceil(h / ch) + 1
  const x0 = (w - ncols * cw) / 2
  const y0 = (h - nrows * ch) / 2
  const dS = 1 - s * (1 - dMin)
  const out = new Float32Array(data.length)
  const SUB = 3
  // A pixel belongs to the cell its centre falls in; edges are computed once so neighbours share them.
  const edgeX = (i) => Math.min(w, Math.max(0, Math.ceil(x0 + i * cw - 0.5)))
  const edgeY = (j) => Math.min(h, Math.max(0, Math.ceil(y0 + j * ch - 0.5)))
  for (let cj = 0; cj < nrows; cj++) {
    const top = y0 + cj * ch
    const ya = edgeY(cj)
    const yb = edgeY(cj + 1)
    for (let ci = 0; ci < ncols; ci++) {
      const left = x0 + ci * cw
      const xa = edgeX(ci)
      const xb = edgeX(ci + 1)
      if (xa >= xb || ya >= yb) continue
      let r = 0
      let g = 0
      let b = 0
      let peak = 0
      for (let y = ya; y < yb; y++) {
        for (let x = xa; x < xb; x++) {
          const i = (y * w + x) * 3
          r += data[i]
          g += data[i + 1]
          b += data[i + 2]
          peak = Math.max(peak, data[i], data[i + 1], data[i + 2])
        }
      }
      const n = (xb - xa) * (yb - ya)
      const mean = [r / n, g / n, b / n]
      const lit = flat ? Math.max(mean[0], mean[1], mean[2]) : peak
      const mask = new Float32Array(n)
      let pick = { glyph: null, litMask: true }
      if (mode === 'ascii') {
        pick = pickGlyph(lit, floor, unit(hash3(ci, cj, seed * 7 + 3)), unit(hash3(ci, cj, seed * 7 + 5)))
        if (!pick) {
          for (let y = ya; y < yb; y++) {
            for (let x = xa; x < xb; x++) {
              const i = (y * w + x) * 3
              for (let c = 0; c < 3; c++) out[i + c] = flat ? mean[c] : data[i + c]
            }
          }
          continue
        }
      }
      const glyph = pick.glyph
      let cover = 0
      for (let y = ya, p = 0; y < yb; y++) {
        for (let x = xa; x < xb; x++, p++) {
          let m = 0
          if (mode === 'ascii') {
            for (let sy = 0; sy < SUB; sy++) {
              for (let sx = 0; sx < SUB; sx++) {
                const fx = ((x + (sx + 0.5) / SUB - left) / cw) * CELL_COLS
                const fy = ((y + (sy + 0.5) / SUB - top) / ch) * CELL_ROWS
                m += glyphInk(glyph, fx, fy)
              }
            }
            m /= SUB * SUB
          } else {
            const dx = (x + 0.5 - (left + cw / 2)) / ch
            const dy = (y + 0.5 - (top + ch / 2)) / ch
            m = Math.exp(-(dx * dx + dy * dy) / (2 * spot * spot))
          }
          mask[p] = m
          cover += m
        }
      }
      cover /= n
      // Contrast fades in above the glyph floor too, so cells with and without glyphs meet without a step.
      const dCell = mode === 'ascii' ? 1 - (1 - dS) * smoothstep(floor / 3, 4 * floor, lit) : dS
      let fac = { inMask: 1, outMask: 1 }
      if (cover > 1e-6 && cover < 1 - 1e-6) fac = cellFactors(cover, pick.litMask, lit, dCell)
      for (let y = ya, p = 0; y < yb; y++) {
        for (let x = xa; x < xb; x++, p++) {
          const i = (y * w + x) * 3
          const f = fac.outMask + (fac.inMask - fac.outMask) * mask[p]
          for (let c = 0; c < 3; c++) out[i + c] = clamp01((flat ? mean[c] : data[i + c]) * f)
        }
      }
    }
  }
  return { w, h, data: out }
}

export const ascii = (img, s, seed = 1, opt = {}) => cells(img, s, { mode: 'ascii', rows: 64, dMin: 0.3, seed, ...opt })
export const pixel = (img, s, seed = 1, opt = {}) => cells(img, s, { mode: 'led', rows: 72, dMin: 0.35, flat: false, seed, ...opt })

export const FILTERS = { grain, riso, ascii, pixel }
