// Owner-rule checks on the prototype renders.
// - seams: down 23 columns, within 1.5 lens radii of each boundary, lightness never drops
//   more than 0.02 Oklab L below the darker of the two band middles (a darker bridge is mud);
// - thickness: thinnest band, and thinnest band darker than both neighbours, in lens radii;
// - exact hexes: in the flat variant ('plainb'), the middle of every band wider than the
//   lens is the band's exact pack hex;
// - parallel edges: correlation of the detrended shapes of neighbouring boundaries, and how
//   much the gap between them changes across the frame;
// - softest edge: the narrowest 10-90 edge width in the render against the lens floor 1.37 R.
// node prototypes/organic-principle/checks.mjs
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { HERE } from './lib/targets.mjs'
import { composeScene } from './lib/scene.mjs'
import { loadLinear, toOklab } from './lib/image.mjs'
import { gauss } from './lib/blur.mjs'
import { columnEdges } from './lib/measure.mjs'
import { oklch } from './lib/color.mjs'
import { hexToLinear } from './lib/color.mjs'

const oklchL = (hex) => oklch(hexToLinear(hex))[0]

const packs = ['bold', 'elemental', 'atmospheric']
const seeds = [3, 7, 12]
const formats = ['16x9', '9x16']
const rows = []

const pearson = (a, b) => {
  const n = a.length
  const ma = a.reduce((s, v) => s + v, 0) / n
  const mb = b.reduce((s, v) => s + v, 0) / n
  let sab = 0
  let saa = 0
  let sbb = 0
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb)
    saa += (a[i] - ma) ** 2
    sbb += (b[i] - mb) ** 2
  }
  return sab / Math.sqrt(saa * sbb)
}
const detrend = (xs, ys) => {
  const n = xs.length
  const mx = xs.reduce((s, v) => s + v, 0) / n
  const my = ys.reduce((s, v) => s + v, 0) / n
  let sxy = 0
  let sxx = 0
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my)
    sxx += (xs[i] - mx) ** 2
  }
  return ys.map((y, i) => y - my - (sxy / sxx) * (xs[i] - mx))
}

for (const tag of ['pb', 'pr']) {
  for (const pack of packs) {
    for (const seed of seeds) {
      for (const format of formats) {
        const file = path.join(HERE, 'out/proto', `${tag}-${pack}-s${seed}-${format}.png`)
        if (!fs.existsSync(file)) continue
        const [a, b] = format.split('x').map(Number)
        const aspect = a / b
        const sc = composeScene({ pack, seed, aspect, layout: tag === 'pb' ? 'stack' : 'horizon' })
        const img = await loadLinear(file)
        const lab = toOklab(img)
        const { w, h } = lab
        const S = Math.min(w, h)
        const Rpx = sc.R * S
        // bridges: down each of 24 columns, between the middles of two neighbouring bands the
        // lightness never drops below the darker middle by more than 0.02 Oklab L
        const L = gauss(lab.L, w, h, 2)
        let seams = 0
        let worst = 0
        let checked = 0
        const mid = (i, x) => {
          const top = i === 0 ? 0 : sc.bands[i].boundary.y(x)
          const bottom = i + 1 < sc.bands.length ? sc.bands[i + 1].boundary.y(x) : sc.h
          return (top + bottom) / 2
        }
        for (let k = 1; k < 24; k++) {
          const xs0 = (k / 24 - 0.5) * sc.w
          const px = Math.round((k / 24) * w)
          for (let i = 0; i + 1 < sc.bands.length; i++) {
            const y0 = Math.max(0, Math.round(mid(i, xs0) * S))
            const y1 = Math.min(h - 1, Math.round(mid(i + 1, xs0) * S))
            if (y1 - y0 < 4) continue
            checked++
            // only a dip at the boundary is a seam; a darker patch inside a band is light varying
            const yb = sc.bands[i + 1].boundary.y(xs0) * S
            let lo = Infinity
            for (let y = y0; y <= y1; y++) if (Math.abs(y - yb) <= 1.5 * Rpx) lo = Math.min(lo, L[y * w + px])
            const dip = Math.min(L[y0 * w + px], L[y1 * w + px]) - lo
            if (dip > 0.02) {
              seams++
              worst = Math.max(worst, dip)
            }
          }
        }
        // thinnest band (lens radii) and the thinnest band darker than both neighbours
        const cols = Array.from({ length: 96 }, (_, q) => (-0.5 + (q + 0.5) / 96) * sc.w)
        let thinnest = Infinity
        let thinnestDark = Infinity
        for (let i = 1; i + 1 < sc.bands.length; i++) {
          const t = Math.min(...cols.map((x) => sc.bands[i + 1].boundary.y(x) - sc.bands[i].boundary.y(x))) / sc.R
          thinnest = Math.min(thinnest, t)
          const li = (j) => oklchL(sc.bands[j].hex)
          if (li(i) < Math.min(li(i - 1), li(i + 1)) - 0.1) thinnestDark = Math.min(thinnestDark, t)
        }
        // neighbouring boundaries: shape correlation and gap change
        const xs = Array.from({ length: 64 }, (_, i) => (-0.5 + (i + 0.5) / 64) * sc.w)
        const lines = sc.bands.slice(1).map((band) => xs.map((x) => band.boundary.y(x)))
        const corr = []
        const gapCv = []
        for (let i = 0; i + 1 < lines.length; i++) {
          corr.push(pearson(detrend(xs, lines[i]), detrend(xs, lines[i + 1])))
          const g = lines[i + 1].map((v, k) => v - lines[i][k])
          const gm = g.reduce((s, v) => s + v, 0) / g.length
          gapCv.push(Math.sqrt(g.reduce((s, v) => s + (v - gm) ** 2, 0) / g.length) / Math.abs(gm))
        }
        // softest edge
        const edges = columnEdges(lab).filter((e) => Math.abs(e.contrast) >= 0.1 && e.run >= 3 * Rpx)
        const widths = edges.map((e) => e.w1090).sort((p, q) => p - q)
        const p05 = widths.length ? widths[Math.floor(0.05 * widths.length)] : NaN
        rows.push({
          name: `${tag}-${pack}-s${seed}-${format}`,
          seams,
          checked,
          worstSeam: +worst.toFixed(3),
          thinnest: +thinnest.toFixed(2),
          thinnestDark: Number.isFinite(thinnestDark) ? +thinnestDark.toFixed(2) : null,
          corr: corr.map((c) => +c.toFixed(2)),
          gapCv: gapCv.map((c) => +c.toFixed(2)),
          softestEdgeOverFloor: +(p05 / (1.374 * Rpx)).toFixed(2),
        })
      }
    }
  }
}

// exact hexes in the flat variant
const hexRows = []
for (const pack of packs) {
  for (const seed of seeds) {
    for (const format of formats) {
      const file = path.join(HERE, 'out/proto', `plainb-${pack}-s${seed}-${format}.png`)
      if (!fs.existsSync(file)) continue
      const [a, b] = format.split('x').map(Number)
      const aspect = a / b
      const sc = composeScene({ pack, seed, aspect, layout: 'stack', variant: 'plain' })
      const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true })
      const S = Math.min(info.width, info.height)
      const out = []
      sc.bands.forEach((band, i) => {
        const top = i === 0 ? 0 : band.topBase
        const bottom = i + 1 < sc.bands.length ? sc.bands[i + 1].topBase : sc.h
        if (bottom - top < 2.2 * sc.R) return
        const y = Math.round(((top + bottom) / 2) * S)
        const x = Math.round(info.width / 2)
        const k = 3 * (y * info.width + x)
        const got = [data[k], data[k + 1], data[k + 2]]
        const want = [1, 3, 5].map((o) => parseInt(band.hex.slice(o, o + 2), 16))
        const scaled = band.gainBase !== 1
        out.push({ hex: band.hex, got: '#' + got.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase(), off: Math.max(...got.map((v, c) => Math.abs(v - want[c]))), lessLight: scaled })
      })
      hexRows.push({ name: `plainb-${pack}-s${seed}-${format}`, bands: out })
    }
  }
}

fs.writeFileSync(path.join(HERE, 'out/checks.json'), JSON.stringify({ rows, hexRows }, null, 1))
for (const r of rows) console.log(r.name.padEnd(30), 'dips', `${r.seams}/${r.checked}`, r.worstSeam, '| thinnest', r.thinnest, 'dark', r.thinnestDark, '| thickness cv', r.gapCv.join(','), '| softest/floor', r.softestEdgeOverFloor)
for (const r of hexRows) console.log(r.name.padEnd(30), r.bands.map((b) => `${b.hex}->${b.got} (${b.off}${b.lessLight ? ', less light' : ''})`).join(' '))
