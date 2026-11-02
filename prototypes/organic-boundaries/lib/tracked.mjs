// Ramp coordinate for frames whose color path passes the same colors twice (a
// light band between a blue sky and a blue ground, a glow above a dim blue
// ground). Each column is walked from the top; a pixel is projected only onto the
// part of the path from t - back onward (t of the pixel above it), so t cannot
// jump back to the sky's end of the path, but can always reach the ground's.
// A real fold still shows: t steps back by up to `back` per pixel. The first
// pixel of a column searches the first `start` of the path (the top of the frame
// is where the path starts).

import { linearToOklab } from './color.mjs'

export function projectTracked(img, path, opts = {}) {
  const back = opts.back ?? 0.05
  const ahead = opts.ahead ?? 1
  const start = opts.start ?? 0.15
  const { w, h } = img
  const n = path.bins
  const P = path.lab
  const t = path.t
  const wL = path.wL ?? 1
  const seg = []
  for (let k = 0; k < n - 1; k++) {
    const d = [(P[k + 1][0] - P[k][0]) * wL, P[k + 1][1] - P[k][1], P[k + 1][2] - P[k][2]]
    seg.push({ d, d2: d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1e-12 })
  }
  // first segment whose end reaches tv, last segment whose start is at most tv
  const first = (tv) => {
    let a = 0
    let b = n - 2
    while (a < b) {
      const m = (a + b) >> 1
      if (t[m + 1] >= tv) b = m
      else a = m + 1
    }
    return a
  }
  const last = (tv) => {
    let a = 0
    let b = n - 2
    while (a < b) {
      const m = (a + b + 1) >> 1
      if (t[m] <= tv) a = m
      else b = m - 1
    }
    return a
  }
  const out = new Float32Array(w * h)
  const dist = new Float32Array(w * h)
  for (let x = 0; x < w; x++) {
    let prev = null
    for (let y = 0; y < h; y++) {
      const i = y * w + x
      const lab = linearToOklab(img.ch[0][i], img.ch[1][i], img.ch[2][i])
      const k0 = prev === null ? 0 : first(prev - back)
      const k1 = prev === null ? Math.max(0, Math.round(start * n) - 1) : last(prev + ahead)
      let best = Infinity
      let bt = prev ?? 0
      for (let k = k0; k <= k1; k++) {
        const q = [(lab[0] - P[k][0]) * wL, lab[1] - P[k][1], lab[2] - P[k][2]]
        const { d, d2 } = seg[k]
        let u = (q[0] * d[0] + q[1] * d[1] + q[2] * d[2]) / d2
        if (u < 0) u = 0
        else if (u > 1) u = 1
        const e = (q[0] - u * d[0]) ** 2 + (q[1] - u * d[1]) ** 2 + (q[2] - u * d[2]) ** 2
        if (e < best) {
          best = e
          bt = t[k] + u * (t[k + 1] - t[k])
        }
      }
      out[i] = bt
      dist[i] = Math.sqrt(best)
      prev = bt
    }
  }
  return { w, h, t: out, dist }
}
