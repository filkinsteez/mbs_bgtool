// The lightness maps the same-design check compares (scripts/light/same-design.mjs; README, "Same design"), the
// comparison, and the thin lines where two far-apart pack colors meet, where the light may rise by a different
// amount in each pack (owner, 2026-11-10 9:50 PM; AGENTS.md 8ed6a2a).
import { LIN, rulesFor, sharesOf } from './color-read.mjs'

export const MAPS = {
  // In the rank map, lightness steps under this (Oklab L) count as equal, so a dark base's faint gradient and the
  // render's dither stay one level instead of spreading over the whole range.
  rankStep: 0.06,
  // The light map stretches each frame's lightness from its darkest 2% (0) to its brightest 0.5% (1).
  stretch: [0.02, 0.995],
}

// A meeting line: a pixel whose window (`window` of the short side to each side, wide enough to see both colors
// across a white middle) holds two pack colors `hue` degrees or more apart (far hues, as in
// src/light/engine/meet.ts) as its two largest, the smaller at least `near` of the larger and at least 2 pixels. The
// mask reaches `reach` of the short side from those pixels (the engine's bridge, a Gaussian of sigma 0.03 of the
// short side, out to two sigma). On it two frames may differ by up to `allow` in Oklab lightness; everywhere else
// the comparison is as strict as before. Set in compare round 33: a window of 0.06 and a reach of 0.07 masked up to
// half of a Sunrise frame where colors blend over wide zones.
export const MEET = { hue: 90, window: 0.03, near: 0.3, reach: 0.06, allow: 0.15 }

function blur(src, w, h, sigma) {
  const r = Math.ceil(3 * sigma)
  const k = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)))
  const sum = k.reduce((a, b) => a + b, 0)
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let i = -r; i <= r; i++) s += k[i + r] * src[y * w + Math.min(w - 1, Math.max(0, x + i))]
      tmp[y * w + x] = s / sum
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let i = -r; i <= r; i++) s += k[i + r] * tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x]
      out[y * w + x] = s / sum
    }
  }
  return out
}

// Each pixel's lightness as its rank in its own frame (0 darkest, 1 brightest). Two pixels count as equal when their
// lightness differs by less than `step`, as fully ordered from `step` apart, and in proportion between.
function softRank(L, step) {
  const NB = 1000
  const hist = new Float64Array(NB)
  const bin = (v) => Math.min(NB - 1, Math.max(0, Math.floor(v * NB)))
  for (const v of L) hist[bin(v)]++
  const below = new Float64Array(NB + 1)
  for (let b = 0; b < NB; b++) below[b + 1] = below[b] + hist[b]
  const half = Math.max(1, Math.round((step * NB) / 2))
  const table = new Float32Array(NB)
  for (let b = 0; b < NB; b++) {
    let s = below[Math.max(0, b - half)]
    for (let c = Math.max(0, b - half); c <= Math.min(NB - 1, b + half); c++) s += hist[c] * Math.min(1, Math.max(0, (b - c) / (2 * half) + 0.5))
    table[b] = s / L.length
  }
  return Float32Array.from(L, (v) => table[bin(v)])
}

// A frame's maps from its RGB (w x h, 3 bytes a pixel): its blurred Oklab lightness, the rank map, how lit each
// pixel is (stretched), and the light map.
export function mapsOf(rgb, w, h) {
  const n = w * h
  const L = new Float32Array(n)
  for (let p = 0; p < n; p++) {
    const [r, g, b] = [LIN[rgb[3 * p]], LIN[rgb[3 * p + 1]], LIN[rgb[3 * p + 2]]]
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    L[p] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  }
  const Lb = blur(L, w, h, 1)
  const sorted = Float32Array.from(Lb).sort()
  const [lo, hi] = MAPS.stretch.map((q) => sorted[Math.floor(q * (n - 1))])
  const lit = Lb.map((v) => Math.min(1, Math.max(0, (v - lo) / Math.max(0.02, hi - lo))))
  return { w, h, L: Lb, rank: softRank(Lb, MAPS.rankStep), lit, light: blur(lit, w, h, 1.5) }
}

// The meeting lines of far-apart colors in a frame drawn in `pack` (its RGB at the maps' size), as a 0/1 mask.
export function meetingMask(pack, rgb, w, h) {
  const rules = rulesFor(pack)
  const { labels } = sharesOf(rules, rgb, w * h, true)
  const colors = rules.chromatic
  const K = colors.length
  const index = new Map(colors.map((c, k) => [c.name, k]))
  const far = colors.map((c) => colors.map((o) => Math.abs(((c.h0 - o.h0 + 540) % 360) - 180) >= MEET.hue))
  const W = w + 1
  // Per color, a summed-area table of its pixels, so any window's count is four lookups.
  const sat = Array.from({ length: K }, () => new Int32Array(W * (h + 1)))
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const k = index.get(labels[y * w + x])
      for (let c = 0; c < K; c++) sat[c][(y + 1) * W + x + 1] = sat[c][y * W + x + 1] + sat[c][(y + 1) * W + x] - sat[c][y * W + x] + (k === c ? 1 : 0)
    }
  const box = (t, x0, y0, x1, y1) => t[(y1 + 1) * W + x1 + 1] - t[y0 * W + x1 + 1] - t[(y1 + 1) * W + x0] + t[y0 * W + x0]
  const short = Math.min(w, h)
  const r = Math.max(1, Math.round(MEET.window * short))
  const line = new Int32Array(W * (h + 1))
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [x0, y0, x1, y1] = [Math.max(0, x - r), Math.max(0, y - r), Math.min(w - 1, x + r), Math.min(h - 1, y + r)]
      let [a, b] = [-1, -1]
      const counts = sat.map((t) => box(t, x0, y0, x1, y1))
      for (let c = 0; c < K; c++) {
        if (a < 0 || counts[c] > counts[a]) [a, b] = [c, a]
        else if (b < 0 || counts[c] > counts[b]) b = c
      }
      const on = b >= 0 && far[a][b] && counts[b] >= 2 && counts[b] >= MEET.near * counts[a]
      line[(y + 1) * W + x + 1] = line[y * W + x + 1] + line[(y + 1) * W + x] - line[y * W + x] + (on ? 1 : 0)
    }
  const reach = Math.max(1, Math.round(MEET.reach * short))
  const mask = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) if (box(line, Math.max(0, x - reach), Math.max(0, y - reach), Math.min(w - 1, x + reach), Math.min(h - 1, y + reach)) > 0) mask[y * w + x] = 1
  return mask
}

// layout: how far each pixel's rank moves, counted by how lit the pixel is in the brighter of the two frames, so a
// dark base both frames share counts little and a lit shape that moves counts fully. light: one minus the
// correlation of the two light maps, 0 when one is a brighter or dimmer copy of the other. Pixels on `mask` (meeting
// lines of far-apart colors) whose lightness differs by `MEET.allow` or less are left out of both; `allowed` counts
// them.
export function compare(a, b, limits, mask) {
  const n = a.rank.length
  const keep = new Uint8Array(n).fill(1)
  let allowed = 0
  if (mask)
    for (let p = 0; p < n; p++)
      if (mask[p] && Math.abs(a.L[p] - b.L[p]) <= MEET.allow) {
        keep[p] = 0
        allowed++
      }
  const kept = n - allowed
  let [d, s] = [0, 0]
  let [ma, mb] = [0, 0]
  for (let p = 0; p < n; p++) {
    if (!keep[p]) continue
    const w = Math.max(a.lit[p], b.lit[p])
    d += w * Math.abs(a.rank[p] - b.rank[p])
    s += w
    ma += a.light[p]
    mb += b.light[p]
  }
  ;[ma, mb] = [ma / kept, mb / kept]
  let [sab, saa, sbb] = [0, 0, 0]
  for (let p = 0; p < n; p++) {
    if (!keep[p]) continue
    sab += (a.light[p] - ma) * (b.light[p] - mb)
    saa += (a.light[p] - ma) ** 2
    sbb += (b.light[p] - mb) ** 2
  }
  const flat = (v) => v / kept < 1e-4
  const corr = flat(saa) && flat(sbb) ? 1 : flat(saa) || flat(sbb) ? 0 : sab / Math.sqrt(saa * sbb)
  const m = { layout: +(s > 0 ? d / s : 0).toFixed(3), light: +(1 - corr).toFixed(3) }
  const score = Math.max(m.layout / limits.layout, m.light / limits.light)
  return { ...m, differs: m.layout > limits.layout || m.light > limits.light, score: +score.toFixed(3), allowed }
}
