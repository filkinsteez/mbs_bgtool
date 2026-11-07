// Moved copies (report only; SHARED.md, 2026-11-07): pairs of frames that are the same picture moved, scaled a little
// or mirrored, which the palette check's seed measure doesn't call alike because it compares frames as they sit. It
// reads a palette-check output folder run with --all-renders (palette.json and renders/) and compares every pair of
// frames of one look in the same pack, format and view (the default light or one test drag); with --across also the
// pairs across the looks of one mood in the folder. See scripts/light/README.md, "Moved copies".
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import sharp from 'sharp'
import { parseArgs } from './lib/args.mjs'

// Structure, the number a pair is judged by: Oklab L at 80x45 (45x80 for 9:16) blurred by 1 px, each frame's L less
// its mean over the overlap, the summed difference over the summed size of both: 0 when the light and dark places
// match, whatever the exposure, 1 when they are unrelated. It is taken after the best move of the second frame onto
// the first: shifts up to SHIFT of the frame each way, the SCALES, and mirrored left to right (in Contour also top to
// bottom, and both; a Sunset sky stays on top). The overlap must be OVERLAP of the frame and hold MASS of each frame's
// structure (its L's distance from its own mean, so a dark ground counts as much as a light). The search runs on 20x12
// maps and refines the best three moves at 40x23, then the best three of those at 80x45, where a thin line keeps its
// shape. A pair is a moved copy when its structure after the move is `--structure` or less and the seed measure's
// colors are `--colors` or less, while unmoved the seed measure's layout (40x23, each frame's darkest level taken off
// up to L 0.35) is over `--layout`, so the check doesn't already call it alike. Set by eye in compare round 18
// (artifacts/compare/rounds/18/moved/): up to 0.25 the pairs are the same picture moved (Bands' blue band over haze
// shifted, Halo's arc moved or turned, Beam's shafts under a drag, the Contour top-edge glow high above), from 0.3
// mostly not; Rim's thin lines are the weakest case (two lines 15 to 20 degrees apart can match at 0.22).
const LIMITS = { structure: 0.25, colors: 0.15, layout: 0.2 }
const SHIFT = 0.4
const SCALES = [1 / 1.15, 1, 1.15]
const OVERLAP = 0.6
const MASS = 0.8
const FLAT = 0.01 // a frame whose L is on average this close to its mean has no structure to move
const BASE_L = 0.35
const MIRRORS = { sunset: ['none', 'x'], contour: ['none', 'x', 'y', 'xy'] }
const MAPS = { coarse: { '16x9': [20, 12], '9x16': [12, 20] }, fine: { '16x9': [40, 23], '9x16': [23, 40] }, detail: { '16x9': [80, 45], '9x16': [45, 80] } }
const VIEWS = ['default', 'owner', 'mirror', 'above', 'side']
const VIEW_NAMES = { default: 'default light', owner: "owner's line", mirror: 'its mirror', above: 'high above', side: 'sideways' }

// Structure over the overlap of A and B moved by (dx, dy): B's pixel at (x - dx, y - dy) lands on A's (x, y). Infinity
// when the overlap is too small or leaves out too much of either frame's structure.
function structure(a, b, w, h, dx, dy, A, B) {
  const [x0, x1, y0, y1] = [Math.max(0, dx), Math.min(w, w + dx), Math.max(0, dy), Math.min(h, h + dy)]
  let [sa, sb, ca, cb, ov] = [0, 0, 0, 0, 0]
  for (let y = y0; y < y1; y++) {
    const rb = (y - dy) * w - dx
    for (let x = x0; x < x1; x++) {
      const vb = b[rb + x]
      if (vb !== vb) continue
      const va = a[y * w + x]
      sa += va
      sb += vb
      ca += Math.abs(va - A.mean)
      cb += Math.abs(vb - B.mean)
      ov++
    }
  }
  if (ov < OVERLAP * w * h || ca < MASS * A.dev || cb < MASS * B.dev) return Infinity
  const [ma, mb] = [sa / ov, sb / ov]
  let [num, den] = [0, 0]
  for (let y = y0; y < y1; y++) {
    const rb = (y - dy) * w - dx
    for (let x = x0; x < x1; x++) {
      const vb = b[rb + x]
      if (vb !== vb) continue
      const da = a[y * w + x] - ma
      const db = vb - mb
      num += Math.abs(da - db)
      den += Math.abs(da) + Math.abs(db)
    }
  }
  return den > 0 ? num / den : 0
}
// The palette check's seed layout, unmoved.
function layout(a, b) {
  const la = Math.min(Math.min(...a), BASE_L)
  const lb = Math.min(Math.min(...b), BASE_L)
  let [num, den] = [0, 0]
  for (let p = 0; p < a.length; p++) {
    num += Math.abs(a[p] - la - (b[p] - lb))
    den += a[p] - la + (b[p] - lb)
  }
  return den ? num / den : 0
}
// A map's mean and summed distance from it, over its pixels inside the frame (NaN outside).
function spread(m) {
  let [s, n] = [0, 0]
  for (const v of m) {
    if (v !== v) continue
    s += v
    n++
  }
  const mean = n ? s / n : 0
  let dev = 0
  for (const v of m) if (v === v) dev += Math.abs(v - mean)
  return { mean, dev, n }
}
// A map mirrored and scaled about its center, sampled bilinearly; NaN where it falls outside the frame.
function transform(m, w, h, mirror, scale) {
  const out = new Float32Array(w * h)
  const [cx, cy] = [(w - 1) / 2, (h - 1) / 2]
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let u = cx + (x - cx) / scale
      let v = cy + (y - cy) / scale
      if (mirror.includes('x')) u = w - 1 - u
      if (mirror.includes('y')) v = h - 1 - v
      if (u < -0.5 || u > w - 0.5 || v < -0.5 || v > h - 0.5) {
        out[y * w + x] = NaN
        continue
      }
      const [uu, vv] = [Math.min(w - 1, Math.max(0, u)), Math.min(h - 1, Math.max(0, v))]
      const [xa, ya] = [Math.floor(uu), Math.floor(vv)]
      const [xb, yb] = [Math.min(w - 1, xa + 1), Math.min(h - 1, ya + 1)]
      const [fx, fy] = [uu - xa, vv - ya]
      out[y * w + x] = (m[ya * w + xa] * (1 - fx) + m[ya * w + xb] * fx) * (1 - fy) + (m[yb * w + xa] * (1 - fx) + m[yb * w + xb] * fx) * fy
    }
  }
  return out
}
// The best move of frame b onto each of its partners, from the 20x12 search down to the 80x45 refinement.
function search(frames, b, partners) {
  const B = frames[b]
  const size = (level) => MAPS[level][B.format]
  const variants = []
  for (const mirror of MIRRORS[B.mood]) {
    for (const scale of SCALES) {
      const v = { mirror, scale }
      for (const level of Object.keys(MAPS)) {
        v[level] = transform(B[level], ...size(level), mirror, scale)
        v[`${level}Spread`] = spread(v[level])
      }
      variants.push(v)
    }
  }
  const identity = variants.findIndex((v) => v.mirror === 'none' && v.scale === 1)
  // The best `keep` moves at one level from the given candidates, each tried at (dx, dy) plus or minus the reach.
  const refine = (A, level, candidates, [reachX, reachY], keep) => {
    const [w, h] = size(level)
    const found = []
    for (const c of candidates) {
      const v = variants[c.vi]
      for (let dy = c.dy - reachY; dy <= c.dy + reachY; dy++) {
        for (let dx = c.dx - reachX; dx <= c.dx + reachX; dx++) {
          if ((1 - Math.abs(dx) / w) * (1 - Math.abs(dy) / h) < OVERLAP) continue
          const d = structure(A[level], v[level], w, h, dx, dy, A[`${level}Spread`], v[`${level}Spread`])
          if (d < Infinity) found.push({ d, vi: c.vi, dx, dy })
        }
      }
    }
    return found.sort((p, q) => p.d - q.d).slice(0, keep)
  }
  const scaleTo = (c, from, to) => ({ ...c, dx: Math.round((c.dx * size(to)[0]) / size(from)[0]), dy: Math.round((c.dy * size(to)[1]) / size(from)[1]) })
  const results = []
  for (const a of partners) {
    const A = frames[a]
    if (A.detailSpread.dev < FLAT * A.detailSpread.n || B.detailSpread.dev < FLAT * B.detailSpread.n) continue
    const [cw, ch] = size('coarse')
    const start = variants.map((v, vi) => ({ vi, dx: 0, dy: 0 }))
    const coarse = refine(A, 'coarse', start, [Math.floor(SHIFT * cw), Math.floor(SHIFT * ch)], 3)
    const fine = refine(A, 'fine', coarse.map((c) => scaleTo(c, 'coarse', 'fine')), [1, 1], 3)
    const [dw, dh] = size('detail')
    const unmoved = structure(A.detail, variants[identity].detail, dw, dh, 0, 0, A.detailSpread, variants[identity].detailSpread)
    const best = [{ d: unmoved, vi: identity, dx: 0, dy: 0 }, ...refine(A, 'detail', fine.map((c) => scaleTo(c, 'fine', 'detail')), [1, 1], 1)].sort((p, q) => p.d - q.d)[0]
    const v = variants[best.vi]
    results.push({ a, b, layout: layout(A.fine, B.fine), unmoved, moved: best.d, mirror: v.mirror, scale: v.scale, dx: best.dx / dw, dy: best.dy / dh })
  }
  return results
}

if (!isMainThread) {
  const { frames, jobs } = workerData
  for (const f of frames) for (const level of Object.keys(MAPS)) f[`${level}Spread`] = spread(f[level])
  parentPort.postMessage(jobs.flatMap(({ b, partners }) => search(frames, b, partners)))
} else {
  const args = parseArgs()
  if (typeof args.from !== 'string') {
    console.error('Give --from <palette-check output folder run with --all-renders>; see scripts/light/README.md')
    process.exit(1)
  }
  const fromDir = path.resolve(args.from)
  const outDir = path.resolve(typeof args.out === 'string' ? args.out : path.join(fromDir, 'moved'))
  const limits = { structure: Number(args.structure ?? LIMITS.structure), colors: Number(args.colors ?? LIMITS.colors), layout: Number(args.layout ?? LIMITS.layout) }
  const across = Boolean(args.across)
  const started = Date.now()
  fs.mkdirSync(outDir, { recursive: true })
  const report = JSON.parse(fs.readFileSync(path.join(fromDir, 'palette.json'), 'utf8'))
  const lin = Float64Array.from({ length: 256 }, (_, v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4))
  const oklab = (r, g, b) => {
    const [R, G, B] = [lin[r], lin[g], lin[b]]
    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
    const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
    const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
  }
  // The palette check's colorFamilies (T.variety and HUE_FAMILIES there).
  const FAMILIES = [[55, 'red'], [105, 'yellow'], [190, 'green'], [290, 'blue'], [345, 'purple'], [360, 'red']]
  const colorFamilies = (lab) => {
    const mass = { red: 0, yellow: 0, green: 0, cyan: 0, blue: 0, purple: 0 }
    let lit = 0
    for (const [L, a, b] of lab) {
      if (L < 0.1) continue
      lit++
      const h = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
      const weight = Math.min(1, Math.max(0, (Math.hypot(a, b) - 0.035) / 0.035))
      const family = FAMILIES.find(([end]) => h < end)[1]
      if (family === 'blue') {
        const toBlue = Math.min(1, Math.max(0, (h - 215) / 40))
        mass.cyan += weight * (1 - toBlue)
        mass.blue += weight * toBlue
      } else mass[family] += weight
    }
    return Object.fromEntries(Object.entries(mass).map(([k, v]) => [k, lit ? v / lit : 0]))
  }
  const colorDistance = (a, b) => Object.keys(a).reduce((s, k) => s + Math.abs(a[k] - b[k]), 0) / 2
  // The frames that have a render, and their maps.
  const frames = []
  let missing = 0
  for (const [lookId, data] of Object.entries(report.looks)) {
    const [mood, look] = lookId.split('.')
    for (const f of data.frames) {
      const file = path.join(fromDir, 'renders', `${f.id}.png`)
      if (fs.existsSync(file)) frames.push({ id: f.id, look, mood, pack: f.pack, seed: f.seed, format: f.format, view: f.drag ?? 'default', file })
      else missing++
    }
  }
  if (missing) console.log(`${missing} frames have no render and are left out: run the palette check with --all-renders.`)
  const readMaps = async (f) => {
    const lab = async (level) => {
      const [w, h] = MAPS[level][f.format]
      const { data } = await sharp(f.file).removeAlpha().resize(w, h, { fit: 'fill' }).blur(level === 'coarse' ? 0.5 : 1).raw().toBuffer({ resolveWithObject: true })
      return Array.from({ length: w * h }, (_, p) => oklab(data[3 * p], data[3 * p + 1], data[3 * p + 2]))
    }
    const fine = await lab('fine')
    f.fine = Float32Array.from(fine, (x) => x[0])
    f.coarse = Float32Array.from(await lab('coarse'), (x) => x[0])
    f.detail = Float32Array.from(await lab('detail'), (x) => x[0])
    f.colors = colorFamilies(fine)
  }
  for (let i = 0; i < frames.length; i += 32) await Promise.all(frames.slice(i, i + 32).map(readMaps))
  // Pairs to search: one pack, format and view, one look (or, with --across, one mood), colors close enough.
  const groups = {}
  for (const [i, f] of frames.entries()) (groups[[across ? f.mood : f.look, f.pack, f.format, f.view].join('|')] ??= []).push(i)
  const partnersOf = new Map()
  let [compared, skipped] = [0, 0]
  for (const list of Object.values(groups)) {
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        if (colorDistance(frames[list[x]].colors, frames[list[y]].colors) > limits.colors) {
          skipped++
          continue
        }
        if (!partnersOf.has(list[y])) partnersOf.set(list[y], [])
        partnersOf.get(list[y]).push(list[x])
        compared++
      }
    }
  }
  const shared = frames.map((f) => ({ format: f.format, mood: f.mood, coarse: f.coarse, fine: f.fine, detail: f.detail }))
  const count = Math.max(1, Math.min(8, os.cpus().length - 2))
  const buckets = Array.from({ length: count }, () => [])
  let turn = 0
  for (const [b, partners] of [...partnersOf.entries()].sort((p, q) => q[1].length - p[1].length)) buckets[turn++ % count].push({ b, partners })
  const run = (jobs) =>
    new Promise((resolve, reject) => {
      const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { frames: shared, jobs } })
      worker.once('message', resolve)
      worker.once('error', reject)
    })
  const results = (await Promise.all(buckets.map(run))).flat()
  const pairs = []
  for (const r of results) {
    const [A, B] = [frames[r.a], frames[r.b]]
    if (r.layout <= limits.layout || r.moved > limits.structure) continue
    const moved = r.dx !== 0 || r.dy !== 0 || r.scale !== 1 || r.mirror !== 'none'
    pairs.push({
      verdict: moved ? 'moved copy' : 'same unmoved',
      looks: [A.look, B.look],
      mood: A.mood,
      pack: A.pack,
      format: A.format,
      view: A.view,
      seeds: [A.seed, B.seed],
      ids: [A.id, B.id],
      structure: +r.moved.toFixed(3),
      unmoved: +r.unmoved.toFixed(3),
      layout: +r.layout.toFixed(3),
      colors: +colorDistance(A.colors, B.colors).toFixed(3),
      move: { dx: +r.dx.toFixed(3), dy: +r.dy.toFixed(3), scale: +r.scale.toFixed(3), mirror: r.mirror },
    })
  }
  pairs.sort((p, q) => p.structure - q.structure)
  const seconds = Math.round((Date.now() - started) / 1000)
  fs.writeFileSync(path.join(outDir, 'moved.json'), JSON.stringify({ source: report.source, limits, compared, skipped, pairs }, null, 1))

  // moved.md: per look (and, with --across, per pair of looks) the moved copies at the run's first 8 seeds and at all
  // its seeds, by pack, format and view.
  const seedsOf = [...new Set(frames.map((f) => f.seed))].sort((x, y) => x - y)
  const [first, last] = [seedsOf[0], seedsOf[seedsOf.length - 1]]
  const early = Math.min(last, first + 7)
  const views = VIEWS.filter((v) => frames.some((f) => f.view === v))
  const inEarly = (p) => p.seeds.every((s) => s <= early)
  const moved = pairs.filter((p) => p.verdict === 'moved copy')
  const lines = [`# Moved copies: ${report.source}`, '', `${compared} pairs compared (seed colors within ${limits.colors}), ${skipped} left out for their colors, in ${seconds} s. A moved copy: structure ${limits.structure} or less after the best move (shift, size, mirror), while unmoved the seed layout is over ${limits.layout}, so the palette check doesn't call the pair alike. Counts per view: ${views.map((v) => VIEW_NAMES[v]).join(', ')}.`, '']
  const table = (title, list, rows) => {
    lines.push(`## ${title}`, '', `${list.filter(inEarly).length} moved copies at seeds ${first}-${early}, ${list.length} at seeds ${first}-${last}.`, '', `| Pack | Format | Seeds ${first}-${early} | Seeds ${first}-${last} |`, '| --- | --- | --- | --- |')
    for (const [pack, format] of rows) {
      const mine = list.filter((p) => p.pack === pack && p.format === format)
      const byView = (l) => views.map((v) => l.filter((p) => p.view === v).length).join(', ')
      lines.push(`| ${pack} | ${format === '9x16' ? '9:16' : '16:9'} | ${byView(mine.filter(inEarly))} | ${byView(mine)} |`)
    }
    lines.push('')
  }
  const rows = ['bold', 'elemental', 'atmospheric'].flatMap((pack) => ['16x9', '9x16'].map((format) => [pack, format])).filter(([pack, format]) => frames.some((f) => f.pack === pack && f.format === format))
  const looks = [...new Set(frames.map((f) => f.look))]
  for (const look of looks) table(look, moved.filter((p) => p.looks.every((l) => l === look)), rows)
  if (across) {
    for (const [i, x] of looks.entries()) {
      for (const y of looks.slice(i + 1)) {
        const list = moved.filter((p) => p.looks.includes(x) && p.looks.includes(y) && x !== y)
        if (frames.find((f) => f.look === x).mood === frames.find((f) => f.look === y).mood) table(`${x} / ${y}`, list, rows)
      }
    }
  }
  const unmovedCount = pairs.length - moved.length
  if (unmovedCount) lines.push(`${unmovedCount} pairs are as close without a move while the seed layout calls them apart (\`same unmoved\` in moved.json).`, '')
  fs.writeFileSync(path.join(outDir, 'moved.md'), `${lines.join('\n')}\n`)

  // Sheets per look: the pairs at the first 8 seeds and at all seeds (at most 48 a sheet: an even share per view,
  // spread from the closest to the limit), each as first, second, and second moved onto the first.
  const TH = 120
  const tileW = (format) => (format === '9x16' ? Math.round((TH * 9) / 16) : Math.round((TH * 16) / 9))
  const text = (s, w, size = 11, color = '#ddd') => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${size + 5}"><text x="2" y="${size + 1}" font-family="Helvetica" font-size="${size}" fill="${color}">${String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`)
  const tile = (id, w) => sharp(path.join(fromDir, 'renders', `${id}.png`)).removeAlpha().resize(w, TH, { fit: 'fill' }).raw().toBuffer()
  const png = (buf, w) => sharp(buf, { raw: { width: w, height: TH, channels: 3 } }).png().toBuffer()
  async function movedTile(p, w) {
    const src = await tile(p.ids[1], w)
    const out = Buffer.alloc(w * TH * 3, 48)
    const [cx, cy] = [(w - 1) / 2, (TH - 1) / 2]
    for (let y = 0; y < TH; y++) {
      for (let x = 0; x < w; x++) {
        let u = cx + (x - p.move.dx * w - cx) / p.move.scale
        let v = cy + (y - p.move.dy * TH - cy) / p.move.scale
        if (p.move.mirror.includes('x')) u = w - 1 - u
        if (p.move.mirror.includes('y')) v = TH - 1 - v
        if (u < 0 || v < 0 || u > w - 1 || v > TH - 1) continue
        const s = 3 * (Math.round(v) * w + Math.round(u))
        for (let c = 0; c < 3; c++) out[3 * (y * w + x) + c] = src[s + c]
      }
    }
    return png(out, w)
  }
  const describe = (p) => {
    const parts = []
    if (Math.abs(p.move.dx) >= 0.01) parts.push(`${Math.round(Math.abs(p.move.dx) * 100)}% ${p.move.dx > 0 ? 'right' : 'left'}`)
    if (Math.abs(p.move.dy) >= 0.01) parts.push(`${Math.round(Math.abs(p.move.dy) * 100)}% ${p.move.dy > 0 ? 'down' : 'up'}`)
    if (p.move.scale !== 1) parts.push(p.move.scale > 1 ? '1.15x bigger' : '1.15x smaller')
    if (p.move.mirror !== 'none') parts.push({ x: 'mirrored left to right', y: 'mirrored top to bottom', xy: 'turned half round' }[p.move.mirror])
    return `second moved ${parts.join(', ')}`
  }
  const sample = (all, max) => {
    if (all.length <= max) return all
    const out = []
    const perView = views.map((v) => all.filter((p) => p.view === v)).filter((l) => l.length)
    let room = max
    for (const [i, l] of perView.entries()) {
      const take = Math.min(l.length, Math.floor(room / (perView.length - i)))
      for (let k = 0; k < take; k++) out.push(l[Math.floor((k * l.length) / take)])
      room -= take
    }
    return out
  }
  const width = 2 * (3 * (tileW('16x9') + 6) + 24)
  for (const look of looks) {
    for (const upTo of [...new Set([early, last])]) {
      const all = moved.filter((p) => p.looks.every((l) => l === look) && p.seeds.every((s) => s <= upTo))
      const shown = sample(all, 48)
      const byView = views.map((v) => `${VIEW_NAMES[v]} ${all.filter((p) => p.view === v).length}`).join(', ')
      const comp = [{ input: text(`${look}: ${all.length} moved cop${all.length === 1 ? 'y' : 'ies'} at seeds ${first}-${upTo} (${byView})${all.length > shown.length ? `; ${shown.length} shown, an even sample per view from the closest` : ''}. First, second, second moved onto the first (grey: outside the second frame).`, width, 12, '#fff'), left: 8, top: 6 }]
      for (const [i, p] of shown.entries()) {
        const w = tileW(p.format)
        const left = 8 + (i % 2) * (width / 2)
        const top = 30 + Math.floor(i / 2) * (TH + 36)
        comp.push({ input: text(`s${p.seeds[0]} / s${p.seeds[1]} ${p.pack} ${p.format === '9x16' ? '9:16' : '16:9'}, ${VIEW_NAMES[p.view]}: structure ${p.unmoved} unmoved, ${p.structure} moved; seed layout ${p.layout}, colors ${p.colors}`, width / 2 - 10, 10, '#ccc'), left, top })
        comp.push({ input: text(describe(p), width / 2 - 10, 10, '#9ab'), left, top: top + 15 })
        comp.push({ input: await png(await tile(p.ids[0], w), w), left, top: top + 32 })
        comp.push({ input: await png(await tile(p.ids[1], w), w), left: left + w + 6, top: top + 32 })
        comp.push({ input: await movedTile(p, w), left: left + 2 * (w + 6), top: top + 32 })
      }
      const height = 40 + Math.max(1, Math.ceil(shown.length / 2)) * (TH + 36)
      const file = path.join(outDir, `moved-${look}-s${first}-${upTo}.jpg`)
      await sharp({ create: { width: width + 8, height, channels: 3, background: '#161616' } }).composite(comp).jpeg({ quality: 80 }).toFile(file)
    }
  }
  console.log(`${lines.slice(2).join('\n')}`)
  console.log(`moved copies: ${path.relative(process.cwd(), path.join(outDir, 'moved.md'))}, moved.json and ${looks.length * (early === last ? 1 : 2)} sheets (${Math.round((Date.now() - started) / 1000)} s)`)
}
