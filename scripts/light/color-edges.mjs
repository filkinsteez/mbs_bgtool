// Color edges: where the color stage's colors break away from the light. Each frame is drawn as the tool draws it
// with colormix=1 (the design in the stage's design pack, the stage giving it the picked pack's colors at a mix), and
// once more without the stage: that render's lightness is the light the colors should follow. Four faults fail a
// frame: a firm color edge where the light is soft, a flat fill, a small dot of one color inside another, and a thin
// seam of one color between two others. With `--stage off` each frame is drawn as the tool draws it without
// colormix (the look in the picked pack), and the frame's own lightness is the light. A frame whose verdict flips when
// its picture moves by one 8-bit level is at the limit (lib/edge-limit.mjs): it is listed apart, left out of the fail
// counts, and with `--against <edges.json>` a change in it is not counted as a change. Usage and how the thresholds
// were set: scripts/light/README.md, "Color edges".
import { readFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { list, parseArgs } from './lib/args.mjs'
import { LIN, mixByName, oklab, rulesFor, sharesOf } from './lib/color-read.mjs'
import { atLimit, verdictChanges } from './lib/edge-limit.mjs'
import { startHarness } from './lib/harness.mjs'
import { stageArgs, stageText } from './lib/stage-args.mjs'

const LOOKS = ['sunset.ramp', 'sunset.bands', 'sunset.blooms', 'contour.rim', 'contour.halo', 'contour.beam', 'contour.streaks']
// The looks behind the tool's switches (sunrise=merged, contour=merged, rush=split); `merged` names all three.
const MERGED = ['sunset.merged', 'contour.merged', 'rush.split']
const PACK_IDS = ['bold', 'elemental', 'atmospheric']
// The palette check's test drags (palette-check.mjs DRAGS), in frame units as in the URL.
const DRAGS = {
  owner: { from: [1.011, 1.224], to: [-0.078, -0.067] },
  mirror: { from: [-0.011, 1.224], to: [1.078, -0.067] },
  above: { from: [0.5, -0.3], to: [0.5, -0.5] },
  side: { from: [0.9, 0.5], to: [0.1, 0.5] },
}
const FORMATS = { '16x9': [16, 9], '9x16': [9, 16], '1x1': [1, 1], '4x5': [4, 5] }
const RENDER_LONG = 480

// Lengths are shares of the frame's short side, areas shares of the frame. Set by eye: README, "Color edges".
const E = {
  // Oklab L below this is black: nothing is judged there.
  lit: 0.15,
  // Color is Oklab a and b over max(L, this) (chromaticity): a color dimmed in linear light keeps it, so the light's
  // own falloff is not a color change.
  chromaFloor: 0.2,
  // Half the window laid across an edge, where the color's and the light's change are measured.
  span: 0.08,
  // Firm color edge: the color changes by `change` or more across the window (and Oklab a and b by `visible` or more,
  // so dim colors don't count), over a width (the change divided by its steepest step) of `width` or less, and the
  // light changes over at least `softer` times that width there. Fails when one edge runs `length` or longer.
  firm: { change: 0.08, visible: 0.04, width: 0.05, softer: 3, length: 0.15 },
  // Flat fill: one connected area of one pack color over `area` of the frame whose Oklab lightness spreads (10th to
  // 90th percentile) under `spread`, with a median L of `lit` or more and a firm color edge along `firmBorder` or more
  // of its border. A dim room is dark, not a fill; a band of a smooth gradient that reads as one color has soft
  // borders. White light (L `white` and up) is left out.
  flat: { area: 0.03, spread: 0.12, lit: 0.35, firmBorder: 0.3, white: 0.95 },
  // Dot: one pack color's area of `min` to `max` of the frame, off the frame's edge, with `enclosed` or more of the ring
  // `ring` (shares of the short side) out from it on one other color. A white core (L `whiteL` and up, chroma under
  // `whiteC`) is the light's own, and so is a lighter color inside a later color of its own path (OWN_PATHS).
  dot: { min: 0.0005, max: 0.02, ring: [0.01, 0.025], enclosed: 0.85, whiteL: 0.9, whiteC: 0.04 },
  // Seam: a part of one color `thickness` thick or thinner and `length` or longer, with two other colors along it (each
  // `side` or more of its border), whose own color lies `own` or farther (Oklab) from any mix of the two. A light's hot
  // line inside a later color of its own path (OWN_PATHS) is the light's own, and so is a line where the light itself
  // is a line, lighter or darker along it by `lightLine` or more than on both sides (a rim's white-hot line), or steps
  // by `lightStep` or more from one side to the other (a colored fringe along that line).
  seam: { thickness: 0.015, length: 0.12, side: 0.2, own: 0.05, lightLine: 0.03, lightStep: 0.1 },
}
// Each pack color's own light path from light to dim, as the palette check's dim paths (T.dimPaths): a Yellow core
// inside Orange-red light, or Cyan inside Meta Blue, is one light, not a dot.
const OWN_PATHS = { bold: [['Yellow', 'Orange-red'], ['Cyan', 'Meta Blue']], elemental: [['Lime', 'Forest']], atmospheric: [['Ice', 'Steel', 'Slate', 'Near-black']] }
const onOwnPath = (packId, light, dim) => (OWN_PATHS[packId] ?? []).some((p) => p.indexOf(light) >= 0 && p.indexOf(light) < p.indexOf(dim))

const args = parseArgs()
const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '')
const outDir = path.resolve(typeof args.out === 'string' ? args.out : path.join('artifacts', 'color-edges', stamp))
const pct = (v, digits = 0) => `${(100 * v).toFixed(digits)}%`

// --- analysis ---

function box3(src, w, h) {
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) tmp[y * w + x] = (src[y * w + Math.max(0, x - 1)] + src[y * w + x] + src[y * w + Math.min(w - 1, x + 1)]) / 3
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) out[y * w + x] = (tmp[Math.max(0, y - 1) * w + x] + tmp[y * w + x] + tmp[Math.min(h - 1, y + 1) * w + x]) / 3
  return out
}

// Connected areas of pixels where `same(p, q)` holds between neighbours (8-connected), for pixels where `keep(p)`.
function components(w, h, keep, same) {
  const id = new Int32Array(w * h).fill(-1)
  const list = []
  const stack = []
  for (let s = 0; s < w * h; s++) {
    if (id[s] >= 0 || !keep(s)) continue
    const pixels = []
    id[s] = list.length
    stack.push(s)
    while (stack.length) {
      const p = stack.pop()
      pixels.push(p)
      const x = p % w
      const y = (p - x) / w
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const qx = x + dx
          const qy = y + dy
          if ((!dx && !dy) || qx < 0 || qy < 0 || qx >= w || qy >= h) continue
          const q = qy * w + qx
          if (id[q] < 0 && keep(q) && same(p, q)) {
            id[q] = list.length
            stack.push(q)
          }
        }
    }
    list.push(pixels)
  }
  return { id, list }
}

// Chamfer distance (1 and sqrt 2 steps) from the pixels where `seed(p)`, moving only between pixels where `same`.
function distance(w, h, seed, same) {
  const d = new Float32Array(w * h).fill(1e9)
  for (let p = 0; p < w * h; p++) if (seed(p)) d[p] = 1
  const step = (p, qx, qy, cost) => {
    if (qx < 0 || qy < 0 || qx >= w || qy >= h) return
    const q = qy * w + qx
    if (same(p, q) && d[q] + cost < d[p]) d[p] = d[q] + cost
  }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      step(p, x - 1, y, 1)
      step(p, x - 1, y - 1, Math.SQRT2)
      step(p, x, y - 1, 1)
      step(p, x + 1, y - 1, Math.SQRT2)
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const p = y * w + x
      step(p, x + 1, y, 1)
      step(p, x + 1, y + 1, Math.SQRT2)
      step(p, x, y + 1, 1)
      step(p, x - 1, y + 1, Math.SQRT2)
    }
  return d
}

// The labels along an area's border (4-neighbours outside it with another label), with their count, mean Oklab and
// mean light.
function borderOf(pixels, w, h, lab, L, A, B, Ld, skip) {
  const sides = new Map()
  let total = 0
  for (const p of pixels) {
    const x = p % w
    const y = (p - x) / w
    for (const [qx, qy] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue
      const q = qy * w + qx
      if (lab[q] === lab[p] || skip(q)) continue
      const s = sides.get(lab[q]) ?? { n: 0, L: 0, a: 0, b: 0, light: 0 }
      s.n++
      s.L += L[q]
      s.a += A[q]
      s.b += B[q]
      s.light += Ld[q]
      sides.set(lab[q], s)
      total++
    }
  }
  const ranked = [...sides.entries()].map(([label, s]) => ({ label, share: s.n / Math.max(1, total), lab: [s.L / s.n, s.a / s.n, s.b / s.n], light: s.light / s.n })).sort((x, y) => y.share - x.share)
  return { total, ranked }
}
const meanLab = (pixels, L, A, B) => {
  let l = 0
  let a = 0
  let b = 0
  for (const p of pixels) {
    l += L[p]
    a += A[p]
    b += B[p]
  }
  return [l / pixels.length, a / pixels.length, b / pixels.length]
}
// Oklab distance from `m` to the line of mixes between `u` and `v`.
function offMix(m, u, v) {
  const d = u.map((x, i) => v[i] - x)
  const len = d.reduce((s, x) => s + x * x, 0)
  const t = len ? Math.min(1, Math.max(0, m.reduce((s, x, i) => s + (x - u[i]) * d[i], 0) / len)) : 0
  return Math.hypot(...m.map((x, i) => x - (u[i] + t * d[i])))
}

// One frame: `rgb` the picture with the stage on, `lightRgb` the same frame without it (the light).
function analyse(rules, packId, rgb, lightRgb, w, h) {
  const n = w * h
  const short = Math.min(w, h)
  const L = new Float32Array(n)
  const A = new Float32Array(n)
  const B = new Float32Array(n)
  const Ld = new Float32Array(n)
  for (let p = 0; p < n; p++) {
    const [l, a, b] = oklab([LIN[rgb[3 * p]], LIN[rgb[3 * p + 1]], LIN[rgb[3 * p + 2]]])
    L[p] = l
    A[p] = a
    B[p] = b
    Ld[p] = oklab([LIN[lightRgb[3 * p]], LIN[lightRgb[3 * p + 1]], LIN[lightRgb[3 * p + 2]]])[0]
  }
  const { labels } = sharesOf(rules, rgb, n, true)
  const names = [...rules.colors.map((c) => c.name), 'grey', 'other', 'none']
  const NONE = names.length - 1
  const packCount = rules.colors.length
  const lab = Int8Array.from(labels, (k) => names.indexOf(k))
  const at = (arr, x, y) => arr[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))]
  let lit = 0
  for (let p = 0; p < n; p++) if (L[p] >= E.lit) lit++

  // Firm color edges.
  const qa = box3(Float32Array.from(A, (a, p) => a / Math.max(L[p], E.chromaFloor)), w, h)
  const qb = box3(Float32Array.from(B, (b, p) => b / Math.max(L[p], E.chromaFloor)), w, h)
  const Lb = box3(Ld, w, h)
  const Ab = box3(A, w, h)
  const Bb = box3(B, w, h)
  const span = Math.max(2, Math.round(E.span * short))
  const G = new Float32Array(n)
  const NX = new Float32Array(n)
  const NY = new Float32Array(n)
  const firm = new Uint8Array(n)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      if (L[p] < E.lit) continue
      const gxa = (at(qa, x + 1, y) - at(qa, x - 1, y)) / 2
      const gya = (at(qa, x, y + 1) - at(qa, x, y - 1)) / 2
      const gxb = (at(qb, x + 1, y) - at(qb, x - 1, y)) / 2
      const gyb = (at(qb, x, y + 1) - at(qb, x, y - 1)) / 2
      const g = Math.hypot(gxa, gya, gxb, gyb)
      G[p] = g
      if (g < 1e-4) continue
      const th = 0.5 * Math.atan2(2 * (gxa * gya + gxb * gyb), gxa * gxa + gxb * gxb - gya * gya - gyb * gyb)
      const nx = Math.cos(th)
      const ny = Math.sin(th)
      NX[p] = nx
      NY[p] = ny
      const x1 = Math.round(x + span * nx)
      const y1 = Math.round(y + span * ny)
      const x0 = Math.round(x - span * nx)
      const y0 = Math.round(y - span * ny)
      const change = Math.hypot(at(qa, x1, y1) - at(qa, x0, y0), at(qb, x1, y1) - at(qb, x0, y0))
      if (change < E.firm.change || Math.hypot(at(Ab, x1, y1) - at(Ab, x0, y0), at(Bb, x1, y1) - at(Bb, x0, y0)) < E.firm.visible) continue
      // Widths in pixels: a change over its steepest step. A light that changes by under 0.03 across the window is as
      // soft as the window is wide.
      const width = change / g
      const dL = Math.abs(at(Lb, x1, y1) - at(Lb, x0, y0))
      const gL = Math.abs(((at(Lb, x + 1, y) - at(Lb, x - 1, y)) * nx + (at(Lb, x, y + 1) - at(Lb, x, y - 1)) * ny) / 2)
      const lightWidth = dL < 0.03 ? 2 * span : Math.min(2 * span, dL / Math.max(gL, 1e-6))
      if (width <= E.firm.width * short && lightWidth >= E.firm.softer * width) firm[p] = 1
    }
  // The middle line of each firm edge (the steepest step across it), for its length.
  const middle = new Uint8Array(n)
  let firmCount = 0
  for (let p = 0; p < n; p++) {
    if (!firm[p]) continue
    firmCount++
    const x = p % w
    const y = (p - x) / w
    const ox = Math.round(NX[p])
    const oy = Math.round(NY[p])
    if (G[p] >= at(G, x + ox, y + oy) && G[p] > at(G, x - ox, y - oy)) middle[p] = 1
  }
  const edges = components(w, h, (p) => middle[p] === 1, () => true).list.map((px) => px.length / short).sort((a, b) => b - a)

  // Flat fills: whole areas of one pack color with little lightness in them, bordered by firm color edges.
  const quantile = (px, f) => {
    const v = Float32Array.from(px, (p) => L[p]).sort()
    return v[Math.floor(f * (v.length - 1))]
  }
  const nearFirm = new Uint8Array(n)
  for (let p = 0; p < n; p++) {
    if (!firm[p]) continue
    const x = p % w
    const y = (p - x) / w
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (x + dx >= 0 && x + dx < w && y + dy >= 0 && y + dy < h) nearFirm[p + dy * w + dx] = 1
  }
  const firmBorder = (px) => {
    let border = 0
    let firmCount = 0
    for (const p of px) {
      const x = p % w
      const y = (p - x) / w
      if (![[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(([qx, qy]) => qx >= 0 && qy >= 0 && qx < w && qy < h && lab[qy * w + qx] !== lab[p])) continue
      border++
      firmCount += nearFirm[p]
    }
    return border ? firmCount / border : 0
  }
  const flats = components(w, h, (p) => lab[p] < packCount && L[p] >= E.lit && L[p] < E.flat.white, (p, q) => lab[p] === lab[q])
    .list.filter((px) => px.length >= 0.005 * n)
    .map((px) => ({ pixels: px, label: names[lab[px[0]]], area: px.length / n, spread: quantile(px, 0.9) - quantile(px, 0.1), median: quantile(px, 0.5) }))
    .filter((f) => f.spread < E.flat.spread && f.median >= E.flat.lit)
    .map((f) => ({ ...f, firm: firmBorder(f.pixels) }))
    .filter((f) => f.firm >= E.flat.firmBorder)
    .sort((a, b) => b.area - a.area)

  // Dots: small areas of one pack color inside another, judged on a ring a little out from the area so a thin
  // blended edge round it doesn't hide what surrounds it.
  const areas = components(w, h, (p) => lab[p] < packCount, (p, q) => lab[p] === lab[q]).list
  const dots = []
  const [r0, r1] = E.dot.ring.map((r) => r * short)
  for (const px of areas) {
    const area = px.length / n
    if (area < E.dot.min || area > E.dot.max) continue
    if (px.some((p) => p % w === 0 || p % w === w - 1 || p < w || p >= n - w)) continue
    const mean = meanLab(px, L, A, B)
    if (mean[0] >= E.dot.whiteL && Math.hypot(mean[1], mean[2]) < E.dot.whiteC) continue
    const ring = new Map()
    let total = 0
    const xs = px.map((p) => p % w)
    const ys = px.map((p) => Math.floor(p / w))
    const pad = Math.ceil(r1)
    const [bx0, bx1, by0, by1] = [Math.max(0, Math.min(...xs) - pad), Math.min(w - 1, Math.max(...xs) + pad), Math.max(0, Math.min(...ys) - pad), Math.min(h - 1, Math.max(...ys) + pad)]
    const bw = bx1 - bx0 + 1
    const inDot = new Set(px)
    const local = distance(bw, by1 - by0 + 1, (i) => inDot.has((by0 + Math.floor(i / bw)) * w + bx0 + (i % bw)), () => true)
    for (let i = 0; i < local.length; i++) {
      if (local[i] - 1 <= r0 || local[i] - 1 > r1) continue
      const label = lab[(by0 + Math.floor(i / bw)) * w + bx0 + (i % bw)]
      ring.set(label, (ring.get(label) ?? 0) + 1)
      total++
    }
    const [top, count] = [...ring.entries()].sort((x, y) => y[1] - x[1])[0] ?? [NONE, 0]
    if (top === NONE || top === lab[px[0]] || count < E.dot.enclosed * total) continue
    if (onOwnPath(packId, names[lab[px[0]]], names[top])) continue
    dots.push({ pixels: px, label: names[lab[px[0]]], inside: names[top], area })
  }

  // Seams: thin parts of one label between two others.
  const sameLab = (p, q) => lab[p] === lab[q]
  const toEdge = distance(w, h, (p) => {
    const x = p % w
    const y = (p - x) / w
    return [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(([qx, qy]) => qx >= 0 && qy >= 0 && qx < w && qy < h && lab[qy * w + qx] !== lab[p])
  }, sameLab)
  const half = (E.seam.thickness * short) / 2
  const fromCore = distance(w, h, (p) => toEdge[p] > half + 0.5, sameLab)
  const thin = (p) => lab[p] !== NONE && fromCore[p] > half + 1
  const seams = []
  for (const px of components(w, h, thin, sameLab).list) {
    let deepest = 1
    for (const p of px) deepest = Math.max(deepest, toEdge[p])
    const length = px.length / Math.max(1, 2 * deepest - 1) / short
    if (length < E.seam.length) continue
    const { ranked } = borderOf(px, w, h, lab, L, A, B, Ld, (q) => lab[q] === NONE)
    const sides = ranked.filter((s) => s.share >= E.seam.side)
    if (sides.length < 2) continue
    if (sides.some((s) => onOwnPath(packId, names[lab[px[0]]], names[s.label]))) continue
    const light = px.reduce((s, p) => s + Ld[p], 0) / px.length
    const [lo, hi] = [Math.min(sides[0].light, sides[1].light), Math.max(sides[0].light, sides[1].light)]
    if (light > hi + E.seam.lightLine || light < lo - E.seam.lightLine || hi - lo >= E.seam.lightStep) continue
    const own = offMix(meanLab(px, L, A, B), sides[0].lab, sides[1].lab)
    if (own < E.seam.own) continue
    seams.push({ pixels: px, label: names[lab[px[0]]], between: [names[sides[0].label], names[sides[1].label]], length, own })
  }

  const reasons = []
  if ((edges[0] ?? 0) >= E.firm.length) reasons.push(`firm color edge: the longest runs ${pct(edges[0])} of the short side (firm edges on ${pct(firmCount / Math.max(1, lit), 1)} of the lit pixels)`)
  if (flats[0] && flats[0].area >= E.flat.area) reasons.push(`flat fill: ${flats[0].label} over ${pct(flats[0].area, 1)} of the frame, its lightness spreading ${flats[0].spread.toFixed(2)}`)
  if (dots.length) reasons.push(`dot: ${dots.map((d) => `${d.label} inside ${d.inside} (${pct(d.area, 2)})`).join(', ')}`)
  if (seams.length) reasons.push(`seam: ${seams.map((s) => `${s.label} between ${s.between.join(' and ')} (${pct(s.length)} of the short side long)`).join(', ')}`)
  return {
    measures: {
      firmShare: firmCount / Math.max(1, lit),
      longestEdge: edges[0] ?? 0,
      edges: edges.filter((e) => e >= 0.05).length,
      largestFlat: flats[0] ? { label: flats[0].label, area: flats[0].area, spread: flats[0].spread } : null,
      dots: dots.map(({ label, inside, area }) => ({ label, inside, area })),
      seams: seams.map(({ label, between, length, own }) => ({ label, between, length, own })),
    },
    reasons,
    maps: { firm, middle, flat: flats, dots, seams, Ld },
  }
}

// --- maps ---

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const text = (s, w, size, color = '#ddd') => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${size + 6}"><text x="2" y="${size + 1}" font-family="Helvetica" font-size="${size}" fill="${color}">${esc(s)}</text></svg>`)
const LEGEND = 'map: the picture in grey; red, firm color edges (bright red, their middle line); yellow, flat fills; magenta, dots; cyan, seams'

// The three panels of a frame: the picture, the light (the frame without the stage, in grey) and the map.
async function panels(rgb, result, w, h) {
  const n = w * h
  const light = Buffer.alloc(n * 3)
  const map = Buffer.alloc(n * 3)
  const { firm, middle, flat, dots, seams, Ld } = result.maps
  const paint = new Int8Array(n)
  for (const f of flat) for (const p of f.pixels) paint[p] = 1
  for (const d of dots) for (const p of d.pixels) paint[p] = 2
  for (const s of seams) for (const p of s.pixels) paint[p] = 3
  for (let p = 0; p < n; p++) {
    const v = Math.round(255 * Math.min(1, Math.max(0, Ld[p])))
    light.fill(v, 3 * p, 3 * p + 3)
    const grey = Math.round(20 + 0.45 * (0.3 * rgb[3 * p] + 0.59 * rgb[3 * p + 1] + 0.11 * rgb[3 * p + 2]))
    let c = [grey, grey, grey]
    if (paint[p] === 1) c = [Math.round(0.5 * grey + 128), Math.round(0.5 * grey + 110), Math.round(0.5 * grey)]
    if (firm[p]) c = [Math.round(0.4 * grey + 150), Math.round(0.4 * grey + 20), Math.round(0.4 * grey + 20)]
    if (middle[p]) c = [255, 40, 40]
    if (paint[p] === 2) c = [255, 0, 255]
    if (paint[p] === 3) c = [0, 230, 255]
    map.set(c, 3 * p)
  }
  const png = (buf) => sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer()
  return [await png(Buffer.from(rgb)), await png(light), await png(map)]
}

// One file per frame (--maps): the three panels at full size with the frame's verdict above.
async function frameMap(f, rgb, result, w, h, file) {
  const [pic, light, map] = await panels(rgb, result, w, h)
  const W = 3 * w + 16
  const lines = [`${f.look} ${f.pack} s${f.seed} ${f.format.replace('x', ':')} ${f.view}: ${result.reasons.length ? 'fails' : 'passes'}${f.atLimit ? ', at the limit' : ''}`, ...result.reasons, 'panels: the picture; the light (the frame without the color stage); ' + LEGEND]
  const comp = lines.map((s, i) => ({ input: text(s, W, 12, i === 0 && result.reasons.length ? '#ffb070' : '#ddd'), left: 6, top: 4 + 17 * i }))
  const top = 8 + 17 * lines.length
  comp.push({ input: pic, left: 4, top }, { input: light, left: w + 8, top }, { input: map, left: 2 * w + 12, top })
  await sharp({ create: { width: W, height: top + h + 4, channels: 3, background: '#161616' } }).composite(comp).jpeg({ quality: 85 }).toFile(file)
}

// Sheets of small panels, 24 frames a sheet.
async function drawSheet(items, file, title) {
  const W = 1300
  const comp = [{ input: text(title, W, 13, '#fff'), left: 8, top: 4 }, { input: text(LEGEND, W, 11, '#bbb'), left: 8, top: 22 }]
  let x = 8
  let top = 42
  let rowH = 0
  for (const it of items) {
    const th = it.h >= it.w ? 180 : 112
    const tw = Math.round((th * it.w) / it.h)
    const cellW = 3 * tw + 8
    if (x + cellW > W) {
      x = 8
      top += rowH
      rowH = 0
    }
    comp.push({ input: text(it.title, cellW, 11, it.reasons.length ? '#ffb070' : '#ddd'), left: x, top })
    for (const [i, buf] of it.panels.entries()) comp.push({ input: await sharp(buf).resize(tw, th, { fit: 'fill' }).png().toBuffer(), left: x + i * (tw + 4), top: top + 16 })
    const notes = it.reasons.map((r) => r.replace(/ \(firm edges on [^)]*\)/, '').slice(0, Math.floor(cellW / 5.4)))
    notes.forEach((s, i) => comp.push({ input: text(s, cellW, 10, '#ffcf9a'), left: x, top: top + 20 + th + 13 * i }))
    rowH = Math.max(rowH, th + 26 + 13 * Math.max(1, notes.length))
    x += cellW + 12
  }
  top += rowH
  await sharp({ create: { width: W, height: top + 6, channels: 3, background: '#161616' } }).composite(comp).jpeg({ quality: 80 }).toFile(file)
}

// --- main ---

const lookArg = list(args.look)
if (!lookArg.length) throw new Error('usage: color-edges.mjs --look <sunset.merged|contour.merged|rush.split|merged|all|...> [--pack bold,...] [--seeds 1-8] [--format 16x9,9x16] [--drag default,owner] [--mix default | --stage off] [--maps] [--against edges.json] [--out dir]')
const against = typeof args.against === 'string' ? { file: args.against, frames: JSON.parse(readFileSync(args.against, 'utf8')).frames } : null
const looks = [...new Set(lookArg.flatMap((l) => (l === 'all' ? LOOKS : l === 'merged' ? MERGED : [l.includes('.') ? l : LOOKS.find((id) => id.endsWith(`.${l}`)) ?? l])))]
for (const look of looks) if (!LOOKS.includes(look) && !MERGED.includes(look)) throw new Error(`Unknown look ${look}`)
const packIds = list(args.pack).length ? list(args.pack) : PACK_IDS
const seeds = list(args.seeds ?? '1-8').flatMap((part) => {
  const [a, b = a] = part.split('-').map(Number)
  return Array.from({ length: b - a + 1 }, (_, i) => a + i)
})
const formats = (list(args.format ?? args.formats).length ? list(args.format ?? args.formats) : ['16x9', '9x16']).map((f) => f.replace(':', 'x'))
const viewArg = list(args.drag ?? args.drags).map((v) => (v === 'none' ? 'default' : v))
const views = !viewArg.length ? ['default', 'owner'] : viewArg.includes('all') ? ['default', ...Object.keys(DRAGS)] : [...new Set(viewArg)]
for (const v of views) if (v !== 'default' && !(v in DRAGS)) throw new Error(`Unknown drag ${v}`)
const stageAsked = stageArgs(args)
const stageOff = !stageAsked.on
const mixName = stageAsked.mix ?? 'default'
const source = stageOff ? `${stageText(false)} (the look in each pack, judged against its own lightness)` : stageText(true, mixName)

await fs.mkdir(outDir, { recursive: true })
if (args.maps) await fs.mkdir(path.join(outDir, 'maps'), { recursive: true })
const harness = await startHarness()
const frames = []
const started = Date.now()
try {
  const { getPack } = await harness.ssr('/src/light/color/packs.ts')
  const tool = await harness.ssr('/src/tool/controls.ts')
  const { getRecipe } = await harness.ssr('/src/light/recipes/index.ts')
  const stage = await harness.ssr('/src/light/color/stage.ts')
  const mixes = await harness.ssr('/src/light/color/mix.ts')
  const design = getPack(stage.COLOR_DESIGN_PACK)
  for (const look of looks) {
    const items = []
    for (const packId of packIds) {
      const pack = getPack(packId)
      const rules = rulesFor(pack)
      const mix = mixByName(mixes, pack, mixName)
      if (!mix) continue
      for (const format of formats) {
        const [fw, fh] = FORMATS[format]
        const [w, h] = fw >= fh ? [RENDER_LONG, Math.round((RENDER_LONG * fh) / fw)] : [Math.round((RENDER_LONG * fw) / fh), RENDER_LONG]
        for (const view of views) {
          for (const seed of seeds) {
            const fixed = tool.FIXED_CONTROLS?.[getRecipe(look).mood] ?? {}
            const base = { intensity: 0.5, softness: 0.5, mood: 0.5, ...fixed }
            const drawn = stageOff ? pack : design
            const controls = view === 'default' ? base : tool.controlsForDrag(look, drawn, seed, base, fw / fh, tool.clampDrag(DRAGS[view]))
            const built = tool.buildScene(look, drawn, seed, controls, fw / fh)
            const scene = stageOff ? built : stage.withColorMix(built, pack, mix)
            const { colorMix: _, ...lightScene } = scene
            const rgbOf = async (s) => sharp((await harness.render({ scene: s, width: w, height: h, supersample: 2 })).data, { raw: { width: w, height: h, channels: 4 } }).removeAlpha().raw().toBuffer()
            const rgb = await rgbOf(scene)
            const lightRgb = stageOff ? rgb : await rgbOf(lightScene)
            const result = analyse(rules, packId, rgb, lightRgb, w, h)
            const limit = atLimit(rgb, w, result.reasons.length > 0, (pic) => analyse(rules, packId, pic, stageOff ? pic : lightRgb, w, h).reasons.length > 0)
            const f = { look, pack: packId, seed, format, view, reasons: result.reasons, atLimit: limit, ...result.measures }
            frames.push(f)
            const name = `${look.replace('.', '-')}-${packId}-s${seed}-${format}-${view}`
            if (args.maps) await frameMap(f, rgb, result, w, h, path.join(outDir, 'maps', `${name}.jpg`))
            items.push({ title: `${packId} s${seed} ${format.replace('x', ':')} ${view}${limit ? ', at the limit' : ''}`, panels: await panels(rgb, result, w, h), reasons: result.reasons, w, h })
          }
        }
      }
    }
    for (let i = 0; i < items.length; i += 24) await drawSheet(items.slice(i, i + 24), path.join(outDir, `${look.replace('.', '-')}-${String(i / 24 + 1).padStart(2, '0')}.jpg`), `${look}, ${source}: picture, light, map; orange title: fails`)
    const set = frames.filter((f) => f.look === look)
    console.log(`${look}: ${set.filter(failsClear).length} of ${set.length} fail, ${set.filter((f) => f.atLimit).length} more at the limit`)
  }
} finally {
  await harness.close()
}
const seconds = Math.round((Date.now() - started) / 1000)
const changes = against ? verdictChanges(frames, against.frames) : null
await fs.writeFile(path.join(outDir, 'edges.json'), JSON.stringify({ thresholds: E, stage: stageOff ? 'off' : 'on', mix: stageOff ? null : mixName, seeds, formats, views, frames, ...(changes ? { against: against.file, changes } : {}) }, null, 1))
await fs.writeFile(path.join(outDir, 'summary.md'), summaryOf(seconds))
console.log(`${frames.length} frames in ${seconds} s; ${frames.filter(failsClear).length} fail; ${frames.filter((f) => f.atLimit).length} at the limit, listed apart${changes ? `; against ${against.file}: ${changes.changed.length} changed, ${changes.atLimit.length} more at the limit` : ''}; summary: ${path.relative(process.cwd(), path.join(outDir, 'summary.md'))}`)
if (frames.some(failsClear)) process.exitCode = 1

// A frame that fails and is not at the limit: the frames the fail counts count.
function failsClear(f) {
  return f.reasons.length > 0 && !f.atLimit
}

function frameName(f) {
  return `${f.look} ${f.pack} s${f.seed} ${f.format.replace('x', ':')} ${f.view}`
}

// Per look and pack: frames failing, by reason, and the failing frames with their reasons; the frames at the limit
// apart; with --against, the frames whose verdict changed.
function summaryOf(seconds) {
  const KINDS = ['firm color edge', 'flat fill', 'dot', 'seam']
  const lines = [
    '# Color edges',
    '',
    `${source[0].toUpperCase()}${source.slice(1)}; seeds ${seeds[0]}-${seeds.at(-1)}; ${formats.map((f) => f.replace('x', ':')).join(' and ')}; ${views.join(' and ')}; ${frames.length} frames in ${seconds} s. At the limit: the frame's verdict flips when its picture moves by one 8-bit level; such frames are listed apart and left out of the fail counts.`,
    '',
    '| Look | Pack | Fail | At the limit | Firm color edge | Flat fill | Dot | Seam |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (const look of looks)
    for (const packId of packIds) {
      const set = frames.filter((f) => f.look === look && f.pack === packId)
      if (!set.length) continue
      const clear = set.filter(failsClear)
      const by = (kind) => clear.filter((f) => f.reasons.some((r) => r.startsWith(kind))).length
      lines.push(`| ${look} | ${packId} | ${clear.length} of ${set.length} | ${set.filter((f) => f.atLimit).length} | ${KINDS.map(by).join(' | ')} |`)
    }
  if (views.length > 1) {
    lines.push('', `| Look | Pack | ${views.map((v) => `Fail, ${v}`).join(' | ')} |`, `| --- | --- | ${views.map(() => '---').join(' | ')} |`)
    for (const look of looks)
      for (const packId of packIds) {
        const cells = views.map((v) => {
          const set = frames.filter((f) => f.look === look && f.pack === packId && f.view === v)
          return `${set.filter(failsClear).length} of ${set.length}`
        })
        if (frames.some((f) => f.look === look && f.pack === packId)) lines.push(`| ${look} | ${packId} | ${cells.join(' | ')} |`)
      }
  }
  lines.push('', '## Failing frames', '')
  for (const f of frames.filter(failsClear)) lines.push(`- ${frameName(f)}: ${f.reasons.join('; ')}`)
  lines.push('', '## At the limit', '')
  for (const f of frames.filter((x) => x.atLimit)) lines.push(`- ${frameName(f)}: ${f.reasons.length ? `fails as drawn: ${f.reasons.join('; ')}` : 'passes as drawn'}`)
  if (changes) {
    lines.push('', `## Against ${against.file}`, '', `${changes.changed.length} frames changed; ${changes.atLimit.length} more changed at the limit in one run or both, not counted.`, '')
    for (const c of changes.changed) lines.push(`- ${c.frame}: ${c.before} before, ${c.now} now`)
    if (changes.atLimit.length) lines.push('', 'At the limit, not counted:', '', ...changes.atLimit.map((c) => `- ${c.frame}: ${c.before} before, ${c.now} now`))
  }
  return `${lines.join('\n')}\n`
}
