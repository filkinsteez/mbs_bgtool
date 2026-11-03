// Measurements on Oklab planes at the analysis size (short side 720 px).
import { gauss } from './blur.mjs'
import { powerSpectrum, spectrumSlope } from './fft.mjs'

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length
const median = (a) => {
  const s = [...a].sort((x, y) => x - y)
  return s.length ? s[Math.floor(s.length / 2)] : NaN
}
const pct = (a, q) => {
  const s = [...a].sort((x, y) => x - y)
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN
}

/** Turning points of a 1D profile, ignoring wiggles smaller than tol; includes both ends. */
export function turningPoints(p, tol) {
  const n = p.length
  const turns = [0]
  let dir = 0
  let hi = 0
  let lo = 0
  let ext = 0
  for (let y = 1; y < n; y++) {
    if (dir === 0) {
      if (p[y] > p[hi]) hi = y
      if (p[y] < p[lo]) lo = y
      if (p[hi] - p[lo] > tol) {
        if (lo < hi) {
          if (lo > 0) turns.push(lo)
          dir = 1
          ext = hi
        } else {
          if (hi > 0) turns.push(hi)
          dir = -1
          ext = lo
        }
      }
      continue
    }
    if (dir === 1) {
      if (p[y] > p[ext]) ext = y
      else if (p[ext] - p[y] > tol) {
        turns.push(ext)
        dir = -1
        ext = y
      }
    } else {
      if (p[y] < p[ext]) ext = y
      else if (p[y] - p[ext] > tol) {
        turns.push(ext)
        dir = 1
        ext = y
      }
    }
  }
  if (dir !== 0 && turns[turns.length - 1] !== ext) turns.push(ext)
  if (turns[turns.length - 1] !== n - 1) turns.push(n - 1)
  return turns
}

/** The vertical profile (mean of each row) and the residual after removing it. */
export function rowResidual(P, w, h) {
  const prof = new Float32Array(h)
  for (let y = 0; y < h; y++) {
    let s = 0
    for (let x = 0; x < w; x++) s += P[y * w + x]
    prof[y] = s / w
  }
  const res = new Float32Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) res[y * w + x] = P[y * w + x] - prof[y]
  return { prof, res }
}

const variance = (P) => {
  const m = mean(P)
  let s = 0
  for (const v of P) s += (v - m) ** 2
  return s / P.length
}

/**
 * Share of the variance a 1D vertical profile explains, in L and in a,b together.
 * Measured after a 4 px blur so print texture and grain don't count.
 */
export function profileShare(lab) {
  const { w, h } = lab
  const out = {}
  let tot = 0
  let resid = 0
  for (const k of ['L', 'A', 'B']) {
    const P = gauss(lab[k], w, h, 4)
    const { res } = rowResidual(P, w, h)
    const v = variance(P)
    const r = variance(res)
    if (k === 'L') out.L = 1 - r / v
    else {
      tot += v
      resid += r
    }
  }
  out.ab = 1 - resid / tot
  return out
}

/**
 * RMS of the band-pass layers of the 2D part (row profile removed), per octave.
 * sigmas in pixels at the analysis size. L in Oklab L, C as the length of the (a, b) change.
 */
export function octaveEnergy(lab, sigmas = [2, 4, 8, 16, 32, 64, 128]) {
  const { w, h } = lab
  const res = {}
  for (const k of ['L', 'A', 'B']) res[k] = rowResidual(lab[k], w, h).res
  const G = {}
  for (const k of ['L', 'A', 'B']) G[k] = sigmas.map((s) => gauss(res[k], w, h, s))
  const L = []
  const C = []
  for (let i = 0; i + 1 < sigmas.length; i++) {
    let sl = 0
    let sc = 0
    for (let p = 0; p < w * h; p++) {
      const dl = G.L[i][p] - G.L[i + 1][p]
      const da = G.A[i][p] - G.A[i + 1][p]
      const db = G.B[i][p] - G.B[i + 1][p]
      sl += dl * dl
      sc += da * da + db * db
    }
    L.push(Math.sqrt(sl / (w * h)))
    C.push(Math.sqrt(sc / (w * h)))
  }
  // everything coarser than the last sigma
  let sl = 0
  let sc = 0
  const last = sigmas.length - 1
  for (let p = 0; p < w * h; p++) {
    sl += G.L[last][p] ** 2
    sc += G.A[last][p] ** 2 + G.B[last][p] ** 2
  }
  return { sigmas, L, C, coarseL: Math.sqrt(sl / (w * h)), coarseC: Math.sqrt(sc / (w * h)) }
}

/** Spectrum of the 2D part of L and its slope over two frequency ranges (cycles per short side). */
export function residualSpectrum(lab) {
  const { w, h } = lab
  const { res } = rowResidual(lab.L, w, h)
  const sp = powerSpectrum(res, w, h, 36)
  return { sp, slopeMid: spectrumSlope(sp, 2, 16), slopeFine: spectrumSlope(sp, 16, 64) }
}

/**
 * Share of the frame that is flat: the lightness gradient (after a 12 px blur), in L per
 * short side, is below each threshold. Also the share where hue barely changes.
 */
export function flatness(lab, thresholds = [0.05, 0.1]) {
  const { w, h } = lab
  const short = Math.min(w, h)
  const G = { L: gauss(lab.L, w, h, 12), A: gauss(lab.A, w, h, 12), B: gauss(lab.B, w, h, 12) }
  const gl = []
  const gc = []
  for (let y = 1; y < h - 1; y += 2) {
    for (let x = 1; x < w - 1; x += 2) {
      const i = y * w + x
      const lx = (G.L[i + 1] - G.L[i - 1]) / 2
      const ly = (G.L[i + w] - G.L[i - w]) / 2
      const ax = (G.A[i + 1] - G.A[i - 1]) / 2
      const ay = (G.A[i + w] - G.A[i - w]) / 2
      const bx = (G.B[i + 1] - G.B[i - 1]) / 2
      const by = (G.B[i + w] - G.B[i - w]) / 2
      gl.push(Math.hypot(lx, ly) * short)
      gc.push(Math.sqrt(ax * ax + ay * ay + bx * bx + by * by) * short)
    }
  }
  const out = {}
  for (const t of thresholds) {
    out[`L<${t}`] = gl.filter((g) => g < t).length / gl.length
    out[`Lab<${t}`] = gl.filter((g, i) => g < t && gc[i] < t).length / gl.length
  }
  return out
}

/**
 * Edges down each column: where the smoothed L profile changes by more than minContrast
 * between two turning points. For each: position, 10-90 and 25-75 widths (px), contrast.
 */
export function columnEdges(lab, { step = 6, minContrast = 0.06, smooth = 3 } = {}) {
  const { w, h } = lab
  const L = gauss(lab.L, w, h, smooth)
  const edges = []
  for (let x = Math.floor(step / 2); x < w; x += step) {
    const p = new Float32Array(h)
    for (let y = 0; y < h; y++) p[y] = L[y * w + x]
    const turns = turningPoints(p, minContrast / 3)
    for (let k = 0; k + 1 < turns.length; k++) {
      const a = turns[k]
      const b = turns[k + 1]
      const va = p[a]
      const vb = p[b]
      const c = vb - va
      if (Math.abs(c) < minContrast) continue
      // skip runs that touch the frame edge (the plateau is outside the frame)
      if (a === 0 || b === h - 1) continue
      const cross = (f) => {
        const t = va + f * c
        for (let y = a; y < b; y++) {
          const u = p[y]
          const v = p[y + 1]
          if ((u - t) * (v - t) <= 0 && u !== v) return y + (t - u) / (v - u)
        }
        return NaN
      }
      const y10 = cross(0.1)
      const y25 = cross(0.25)
      const y50 = cross(0.5)
      const y75 = cross(0.75)
      const y90 = cross(0.9)
      const w1090 = Math.abs(y90 - y10)
      const w2575 = Math.abs(y75 - y25)
      if (!(w2575 > 0.5)) continue
      edges.push({ x, y: y50, w1090, w2575, ratio: w1090 / w2575, contrast: c, run: b - a })
    }
  }
  return edges
}

export function edgeSummary(edges, short) {
  const strong = edges.filter((e) => Math.abs(e.contrast) >= 0.1)
  return {
    count: strong.length,
    ratioMedian: median(strong.map((e) => e.ratio)),
    ratioP25: pct(
      strong.map((e) => e.ratio),
      0.25,
    ),
    ratioP75: pct(
      strong.map((e) => e.ratio),
      0.75,
    ),
    w1090P10: pct(
      strong.map((e) => e.w1090 / short),
      0.1,
    ),
    w1090Median: median(strong.map((e) => e.w1090 / short)),
    w1090P90: pct(
      strong.map((e) => e.w1090 / short),
      0.9,
    ),
  }
}

/**
 * Links column edges into tracks that cross most of the frame; returns tracks as
 * arrays of {x, y, w1090}, sorted by mean y.
 */
export function trackEdges(edges, w, { maxJump = 14, minSpan = 0.75 } = {}) {
  const byX = new Map()
  for (const e of edges) {
    if (!byX.has(e.x)) byX.set(e.x, [])
    byX.get(e.x).push(e)
  }
  const xs = [...byX.keys()].sort((a, b) => a - b)
  const open = []
  const done = []
  for (const x of xs) {
    const col = byX.get(x)
    const used = new Set()
    for (const t of open) {
      const last = t[t.length - 1]
      let best = null
      let bd = Infinity
      for (const e of col) {
        if (used.has(e) || Math.sign(e.contrast) !== Math.sign(last.contrast)) continue
        const d = Math.abs(e.y - last.y)
        if (d < bd) {
          bd = d
          best = e
        }
      }
      if (best && bd <= maxJump) {
        t.push(best)
        used.add(best)
      } else t.closed = true
    }
    for (let i = open.length - 1; i >= 0; i--) if (open[i].closed) done.push(...open.splice(i, 1))
    for (const e of col) if (!used.has(e)) open.push([e])
  }
  done.push(...open)
  const tracks = done.filter((t) => t.length >= 2 && (t[t.length - 1].x - t[0].x) / w >= minSpan)
  tracks.sort((a, b) => mean(a.map((e) => e.y)) - mean(b.map((e) => e.y)))
  return tracks
}

const detrend = (xs, ys) => {
  const mx = mean(xs)
  const my = mean(ys)
  let sxy = 0
  let sxx = 0
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my)
    sxx += (xs[i] - mx) ** 2
  }
  const k = sxx > 0 ? sxy / sxx : 0
  return ys.map((y, i) => y - my - k * (xs[i] - mx))
}

/** Per track: wiggle RMS and width range; between neighbours: correlation of detrended shapes. */
export function trackStats(tracks, short) {
  const per = tracks.map((t) => {
    const xs = t.map((e) => e.x)
    const ys = t.map((e) => e.y)
    const d = detrend(xs, ys)
    const ws = t.map((e) => e.w1090)
    return {
      y: mean(ys) / short,
      wiggle: Math.sqrt(mean(d.map((v) => v * v))) / short,
      widthMin: Math.min(...ws) / short,
      widthMax: Math.max(...ws) / short,
      widthMedian: median(ws) / short,
      contrast: mean(t.map((e) => e.contrast)),
    }
  })
  const corr = []
  for (let i = 0; i + 1 < tracks.length; i++) {
    const a = new Map(tracks[i].map((e) => [e.x, e.y]))
    const xs = []
    const ya = []
    const yb = []
    for (const e of tracks[i + 1]) {
      if (!a.has(e.x)) continue
      xs.push(e.x)
      ya.push(a.get(e.x))
      yb.push(e.y)
    }
    if (xs.length < 10) continue
    const da = detrend(xs, ya)
    const db = detrend(xs, yb)
    const sa = Math.sqrt(mean(da.map((v) => v * v)))
    const sb = Math.sqrt(mean(db.map((v) => v * v)))
    const c = sa > 0 && sb > 0 ? mean(da.map((v, k) => v * db[k])) / (sa * sb) : 0
    // gap between the two edges: how much it changes across the frame (band thickness)
    const gaps = xs.map((_, k) => yb[k] - ya[k])
    const gm = mean(gaps)
    corr.push({ corr: c, gapMean: gm / short, gapCv: Math.sqrt(mean(gaps.map((g) => (g - gm) ** 2))) / Math.max(1e-6, gm) })
  }
  return { per, corr }
}

/** Gradient energy along x over along y of the 2D part of L after a blur of `sigma` px. */
export function anisotropy(lab, sigma = 16) {
  const { w, h } = lab
  const { res } = rowResidual(lab.L, w, h)
  const G = gauss(res, w, h, sigma)
  const full = gauss(lab.L, w, h, sigma)
  let ex = 0
  let ey = 0
  let fx = 0
  let fy = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      ex += ((G[i + 1] - G[i - 1]) / 2) ** 2
      ey += ((G[i + w] - G[i - w]) / 2) ** 2
      fx += ((full[i + 1] - full[i - 1]) / 2) ** 2
      fy += ((full[i + w] - full[i - w]) / 2) ** 2
    }
  }
  return { residualXY: ex / ey, fullXY: fx / fy }
}

/** Vertical lightness profile over the middle 60% of the width: turning points and contrasts. */
export function valueStructure(lab, minStep = 0.06) {
  const { w, h } = lab
  const L = gauss(lab.L, w, h, 8)
  const p = []
  for (let y = 0; y < h; y++) {
    let s = 0
    let n = 0
    for (let x = Math.floor(0.2 * w); x < Math.ceil(0.8 * w); x++) {
      s += L[y * w + x]
      n++
    }
    p.push(s / n)
  }
  const turns = turningPoints(p, minStep)
  const levels = turns.map((y) => +p[y].toFixed(3))
  const steps = levels.slice(1).map((v, i) => +(v - levels[i]).toFixed(3))
  const all = Array.from(L)
  return { levels, steps, reversals: Math.max(0, turns.length - 2), range: +(pct(all, 0.95) - pct(all, 0.05)).toFixed(3) }
}
