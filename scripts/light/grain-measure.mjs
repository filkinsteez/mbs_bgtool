// Grain measurement for reference images and renders, with the same code for both (lib/grain.mjs).
// Usage:
//   node scripts/light/grain-measure.mjs --refs [--out dir]
//   node scripts/light/grain-measure.mjs --renders [--only ramp,preview,riso,scenes,checks] [--out dir] [--looks ramp,beam,...] [--seed 1]
//   node scripts/light/grain-measure.mjs --sheets [--out dir]
//   node scripts/light/grain-measure.mjs --file <png> [--rect x,y,w,h] [--hp px] [--label name]
// --refs writes refs.json and refs.md; --renders writes renders.json, renders.md and crops/ (from the working tree,
// through the engine harness); --sheets puts the crops side by side with the reference crops. Default out:
// artifacts/grain/measure.
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { list, parseArgs } from './lib/args.mjs'
import { grainSummary, measureGrain } from './lib/grain.mjs'
import { ROOT, startHarness } from './lib/harness.mjs'
import { cropRgba, loadRgba, raw, resizeRgba } from './lib/images.mjs'

const args = parseArgs(process.argv.slice(2))
const outDir = path.resolve(ROOT, args.out ?? 'artifacts/grain/measure')
const cropDir = path.join(outDir, 'crops')

const AWE = path.join(ROOT, 'public/references/awe')
const FIGMA = path.join(ROOT, 'artifacts/grain/figma')
const SCAN = path.join(ROOT, 'prototypes/grain-study/out/raw/41-26-raw1.png')
const PRESETS = path.join(ROOT, 'src/light/presets/references')
const NO_LENS = { bloom: 0, halation: 0 }
const PACKS = ['bold', 'elemental', 'atmospheric']
const ALL_LOOKS = ['sunset.ramp', 'sunset.bands', 'sunset.blooms', 'contour.rim', 'contour.halo', 'contour.beam', 'contour.streaks']
/** One look per mood for the sheets. */
const SHEET_LOOKS = { sunset: 'sunset.ramp', contour: 'contour.beam' }
const SIZES = { '1080p': [1920, 1080], '4K': [3840, 2160] }
const CROP = { '1080p': 256, '4K': 384 }
const RISO = ['sunset-green-riso', 'sunset-blue-riso', 'sunset-pink-riso']

async function manifestEntry(id) {
  const manifest = JSON.parse(await readFile(path.join(AWE, 'manifest.json'), 'utf8'))
  return manifest.references.find((ref) => ref.id === id)
}

/** The references with visible texture, a no-grain sky and photo for scale, and the deck's Grain tile at 1x, 2x, 4x. */
async function referenceList() {
  const refs = []
  for (const id of [...RISO, 'sunset-film-poster-bands', 'sunset-sky-peach', 'contour-iridescent-rings']) {
    const ref = await manifestEntry(id)
    if (!ref) continue
    refs.push({ label: id, file: path.join(AWE, ref.file), rects: (ref.ignore ?? []).map((r) => r.rect), note: `${ref.width}x${ref.height} moodboard tile` })
  }
  if (existsSync(SCAN)) refs.push({ label: 'riso scan (41:26 source, own pixels)', file: SCAN, rects: [], note: '567x1134 scan behind the three riso tiles' })
  for (const scale of [1, 2, 4]) {
    const file = path.join(FIGMA, `44-271-grain-tile-${scale}x.png`)
    if (existsSync(file)) refs.push({ label: `deck Grain tile ${scale}x`, file, rects: [], note: `Figma node 44:271 exported at ${scale}x` })
  }
  const photo = path.join(FIGMA, '44-271-raw-1.png')
  if (existsSync(photo)) refs.push({ label: 'deck Grain tile photo, no effect', file: photo, rects: [], note: '1200x1575 source photo of 44:271' })
  return refs
}

const pct = (v) => (v == null || !Number.isFinite(v) ? '-' : (v * 100).toFixed(2))

export const TABLE_HEAD = [
  '| Image | Size | L std % | Luma std (code values) | Shadows L % | Mids L % | Highlights L % | Half width px | Half width per 1000 of short side | High-frequency share | Mono | Skew | Dark specks % | Flat 8-bit runs % |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
]

function tableRows(entries) {
  const band = (b) => (b ? pct(b.stdL) : '-')
  return entries.map(
    ({ label, m }) =>
      `| ${label} | ${m.width}x${m.height} | ${pct(m.stdL)} | ${m.stdY.toFixed(2)} | ${band(m.bands.shadows)} | ${band(m.bands.mids)} | ${band(m.bands.highlights)} | ${m.acfHalf.toFixed(2)} | ${(m.acfHalfShort * 1000).toFixed(2)} | ${m.spectrum ? m.spectrum.highShare.toFixed(2) : '-'} | ${m.mono.toFixed(2)} | ${m.skew.toFixed(2)} | ${pct(m.darkSpecks)} | ${pct(m.flatRuns)} |`,
  )
}

function binTable(entries) {
  const head = ['| Image | ' + Array.from({ length: 10 }, (_, k) => `L ${(k / 10).toFixed(1)}-${((k + 1) / 10).toFixed(1)}`).join(' | ') + ' |', '| --- |' + ' --- |'.repeat(10)]
  const rows = entries.map(({ label, m }) => `| ${label} | ` + Array.from({ length: 10 }, (_, k) => pct(m.bins.find((b) => Math.abs(b.lo - k / 10) < 1e-6)?.stdL)).join(' | ') + ' |')
  return [...head, ...rows]
}

function strip(m) {
  const { mask, lowL, ...rest } = m
  return rest
}

async function measureRefs() {
  const entries = []
  for (const ref of await referenceList()) {
    const m = measureGrain(await loadRgba(ref.file), { rects: ref.rects })
    entries.push({ label: ref.label, note: ref.note, m })
    console.log(`== ${ref.label} (${ref.note})\n${grainSummary(m)}`)
  }
  await mkdir(outDir, { recursive: true })
  await writeFile(path.join(outDir, 'refs.json'), JSON.stringify(entries.map((e) => ({ ...e, m: strip(e.m) })), null, 1))
  await writeFile(path.join(outDir, 'refs.md'), [...TABLE_HEAD, ...tableRows(entries), '', 'L std % by blurred lightness:', '', ...binTable(entries)].join('\n') + '\n')
  console.log(`wrote ${path.relative(ROOT, outDir)}/refs.json and refs.md`)
}

async function measureFile() {
  let image = await loadRgba(path.resolve(args.file))
  if (args.rect) {
    const [x, y, w, h] = String(args.rect).split(',').map(Number)
    image = await cropRgba(image, x, y, w, h)
  }
  const m = measureGrain(image, { hpSigma: args.hp ? Number(args.hp) : undefined })
  console.log(`== ${args.label ?? path.basename(args.file)}\n${grainSummary(m)}`)
}

/** A square window (size `size`) inside the measured area, as near a mean lightness of 0.6 as possible. */
function pickWindow(m, size) {
  const { width: w, height: h, mask, lowL } = m
  let best = null
  const step = Math.max(16, Math.round(size / 4))
  for (let y0 = 0; y0 + size <= h; y0 += step) {
    for (let x0 = 0; x0 + size <= w; x0 += step) {
      let inside = 0
      let level = 0
      let count = 0
      for (let y = y0; y < y0 + size; y += 8) {
        for (let x = x0; x < x0 + size; x += 8) {
          inside += mask[y * w + x]
          level += lowL[y * w + x]
          count++
        }
      }
      const score = inside / count - Math.abs(level / count - 0.6)
      if (!best || score > best.score) best = { x: x0, y: y0, score }
    }
  }
  return best
}

async function saveCrop(name, image, window, size) {
  await mkdir(cropDir, { recursive: true })
  const crop = await cropRgba(image, window.x, window.y, size, size)
  await raw(crop).png({ compressionLevel: 3 }).toFile(path.join(cropDir, `${name}.png`))
}

function correlationOf(a, b, mask) {
  let sa = 0
  let sb = 0
  let n = 0
  for (let i = 0; i < a.length; i++) {
    if (!mask[i]) continue
    sa += a[i]
    sb += b[i]
    n++
  }
  const ma = sa / n
  const mb = sb / n
  let ab = 0
  let aa = 0
  let bb = 0
  for (let i = 0; i < a.length; i++) {
    if (!mask[i]) continue
    ab += (a[i] - ma) * (b[i] - mb)
    aa += (a[i] - ma) ** 2
    bb += (b[i] - mb) ** 2
  }
  return ab / Math.sqrt(aa * bb)
}

/** Green channel minus its 9 x 9 box mean, as a residual for correlation checks. */
function fineResidual(image) {
  const { width: w, height: h, data } = image
  const g = new Float32Array(w * h)
  for (let i = 0; i < g.length; i++) g[i] = data[i * 4 + 1]
  const out = new Float32Array(w * h)
  const r = 4
  for (let y = r; y < h - r; y++) {
    for (let x = r; x < w - r; x++) {
      let s = 0
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) s += g[(y + dy) * w + x + dx]
      out[y * w + x] = g[y * w + x] - s / 81
    }
  }
  return out
}

async function measureRenders() {
  const harness = await startHarness()
  const results = { ramp: [], previewExport: [], riso: [], scenes: [], checks: {} }
  const lookIds = list(args.looks).length ? list(args.looks).map((l) => (l.includes('.') ? l : ALL_LOOKS.find((id) => id.endsWith(`.${l}`)))) : ALL_LOOKS
  const seed = Number(args.seed ?? 1)
  const only = new Set(list(args.only))
  const part = (name) => only.size === 0 || only.has(name)
  const log = (line) => console.log(line)
  try {
    // 1. Grain against lightness and clump size: a black-to-white ramp in linear light.
    const ramp = { program: 'test.ramp', colors: ['#000000', '#FFFFFF'], lens: NO_LENS, seed }
    for (const [sizeName, [width, height]] of part('ramp') ? Object.entries(SIZES) : []) {
      let mask = null
      for (const grain of [0, 0.5, 1]) {
        const image = await harness.render({ scene: { ...ramp, output: { grain } }, width, height })
        const m = measureGrain(image, { mask })
        mask ??= m.mask
        results.ramp.push({ label: `ramp ${sizeName} grain ${grain}`, m: strip(m) })
        log(`== ramp ${sizeName} grain ${grain}\n${grainSummary(m)}`)
      }
    }

    // 2. Preview against export at the same viewing size: 960x540 render vs the 4K render shrunk to 960x540.
    for (const grain of part('preview') ? [0.5, 1] : []) {
      const scene = { program: 'test.flat', colors: ['#7A8CA0'], lens: NO_LENS, seed, output: { grain } }
      const preview = measureGrain(await harness.render({ scene, width: 960, height: 540 }))
      const big = await harness.render({ scene, width: 3840, height: 2160 })
      const shrunk = measureGrain(await resizeRgba(big, 960, 540, 'lanczos3'))
      const full = measureGrain(big)
      results.previewExport.push({ grain, preview: preview.stdL, exportShrunk: shrunk.stdL, export: full.stdL, previewHalf: preview.acfHalf, exportHalf: full.acfHalf })
      log(`preview vs export, grain ${grain}: preview ${pct(preview.stdL)} %, 4K shrunk ${pct(shrunk.stdL)} %, 4K at 1:1 ${pct(full.stdL)} %`)
    }

    // 3. Riso prints: the reference presets at the tile size, with their ink weight and with weight 1 (the tool's filter).
    for (const id of part('riso') ? RISO : []) {
      const ref = await manifestEntry(id)
      const preset = JSON.parse(await readFile(path.join(PRESETS, `${id}.json`), 'utf8'))
      const rects = (ref.ignore ?? []).map((r) => r.rect)
      // Print and renders by the same rule: each with its own edge mask, since the print has no copy without grain.
      const target = await loadRgba(path.join(AWE, ref.file))
      const tm = measureGrain(target, { rects })
      const withInk = await harness.render({ scene: preset.scene, width: ref.width, height: ref.height })
      const flatWeight = await harness.render({ scene: { ...preset.scene, params: { ...preset.scene.params, grainInk: [0, 1] } }, width: ref.width, height: ref.height })
      const im = measureGrain(withInk, { rects })
      const fm = measureGrain(flatWeight, { rects })
      results.riso.push({ id, target: strip(tm), preset: strip(im), weight1: strip(fm) })
      log(`== ${id}: target / preset with ink weight / strength 1 everywhere\n${grainSummary(tm)}\n--\n${grainSummary(im)}\n--\n${grainSummary(fm)}`)
      const window = pickWindow(tm, 160)
      await saveCrop(`riso-${id}-target`, target, window, 160)
      await saveCrop(`riso-${id}-preset`, withInk, window, 160)
      await saveCrop(`riso-${id}-weight1`, flatWeight, window, 160)
    }

    // 4. Every look and pack at 1080p and 4K: grain 0, 0.5 and 1, crops of one look per mood for the sheets.
    const sheetLooks = new Set(Object.values(SHEET_LOOKS))
    results.skipped = []
    for (const look of part('scenes') ? lookIds : []) {
      for (const pack of PACKS) {
        let scene
        try {
          scene = await harness.call('compose', look, pack, { intensity: 0.5, softness: 0.5, mood: 0.5 }, seed, 16 / 9)
        } catch (error) {
          // A recipe file can be mid-edit by its owner; skip that look and say so.
          results.skipped.push(`${look} ${pack}: ${String(error.message ?? error).split('\n')[0]}`)
          log(`skipped ${look} ${pack}: it did not load`)
          continue
        }
        for (const [sizeName, [width, height]] of Object.entries(SIZES)) {
          const grains = sheetLooks.has(look) ? [0, 0.5, 1] : sizeName === '4K' ? [0, 0.5] : []
          let window = null
          let mask = null
          for (const grain of grains) {
            const image = await harness.render({ scene: { ...scene, output: { ...scene.output, grain } }, width, height })
            const m = measureGrain(image, { mask })
            mask ??= m.mask
            if (!window) window = pickWindow(m, CROP[sizeName])
            results.scenes.push({ look, pack, size: sizeName, grain, m: strip(m) })
            log(`== ${look} ${pack} ${sizeName} grain ${grain}: ${pct(m.stdL)} % L, half width ${m.acfHalf.toFixed(2)} px, flat runs ${pct(m.flatRuns)} %`)
            if (sheetLooks.has(look)) await saveCrop(`${look}-${pack}-${sizeName}-g${grain}`, image, window, CROP[sizeName])
          }
        }
      }
    }

    if (part('checks')) await runChecks(harness, results, seed, log)
  } finally {
    await harness.close()
  }
  await writeRenders(results)
}

async function runChecks(harness, results, seed, log) {
  {
    // 5. Same seed, same grain; another seed, unrelated grain; no repeat across the frame (lags of 16 to 512 px).
    const flat = (s) => ({ program: 'test.flat', colors: ['#808080'], lens: NO_LENS, seed: s, output: { grain: 0.5 } })
    const a = await harness.render({ scene: flat(1), width: 3840, height: 2160 })
    const a2 = await harness.render({ scene: flat(1), width: 3840, height: 2160 })
    const b = await harness.render({ scene: flat(2), width: 3840, height: 2160 })
    const identical = Buffer.compare(Buffer.from(a.data), Buffer.from(a2.data)) === 0
    const ra = fineResidual(a)
    const rb = fineResidual(b)
    const ones = new Uint8Array(ra.length).fill(1)
    const seedCorrelation = correlationOf(ra, rb, ones)
    let worstLag = 0
    let worstLagValue = 0
    for (const lag of [16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512]) {
      for (const [dx, dy] of [
        [lag, 0],
        [0, lag],
      ]) {
        const shifted = new Float32Array(ra.length)
        const valid = new Uint8Array(ra.length)
        for (let y = 0; y + dy < 2160; y++) {
          for (let x = 0; x + dx < 3840; x++) {
            shifted[y * 3840 + x] = ra[(y + dy) * 3840 + x + dx]
            valid[y * 3840 + x] = 1
          }
        }
        const r = Math.abs(correlationOf(ra, shifted, valid))
        if (r > worstLagValue) {
          worstLagValue = r
          worstLag = `${dx},${dy}`
        }
      }
    }
    results.checks.seed = { identical, seedCorrelation, worstLag, worstLagValue }
    log(`same seed identical: ${identical}; seed 1 vs 2 correlation ${seedCorrelation.toFixed(4)}; largest correlation at a shift of 16-512 px: ${worstLagValue.toFixed(4)} (${worstLag})`)

    // 6. Banding on a long dark ramp at 4K (Contour's falloffs): no dither, dither only, and grain.
    for (const [grain, dither] of [
      [0, false],
      [0, true],
      [0.5, true],
      [1, true],
    ]) {
      const m = measureGrain(await harness.render({ scene: { program: 'test.ramp', colors: ['#000000', '#1C2B33'], lens: NO_LENS, seed, output: { grain } }, width: 3840, height: 2160, dither }))
      const key = `darkRamp${grain}${dither ? '' : 'NoDither'}`
      results.checks[key] = { grain, dither, flatRuns: m.flatRuns, stdL: m.stdL, stdY: m.stdY }
      log(`dark ramp 4K grain ${grain}${dither ? '' : ', no dither'}: flat 8-bit runs ${pct(m.flatRuns)} %, L std ${pct(m.stdL)} %, luma ${m.stdY.toFixed(2)} code values`)
    }
  }
}

async function writeRenders(results) {
  await mkdir(outDir, { recursive: true })
  await writeFile(path.join(outDir, 'renders.json'), JSON.stringify(results, null, 1))
  const md = [
    '## Ramp, black to white',
    '',
    ...TABLE_HEAD,
    ...tableRows(results.ramp),
    '',
    ...binTable(results.ramp),
    '',
    '## Preview vs export (L std %)',
    '',
    '| Grain | 960x540 preview | 4K shrunk to 960x540 | 4K at 1:1 | Half width preview px | Half width 4K px |',
    '| --- | --- | --- | --- | --- | --- |',
    ...results.previewExport.map((r) => `| ${r.grain} | ${pct(r.preview)} | ${pct(r.exportShrunk)} | ${pct(r.export)} | ${r.previewHalf.toFixed(2)} | ${r.exportHalf.toFixed(2)} |`),
    '',
    '## Riso prints vs presets at the tile size',
    '',
    ...TABLE_HEAD,
    ...results.riso.flatMap((r) => tableRows([
      { label: `${r.id} print`, m: r.target },
      { label: `${r.id} preset (ink weight)`, m: r.preset },
      { label: `${r.id} preset, strength 1 everywhere`, m: r.weight1 },
    ])),
    '',
    '## Looks and packs',
    '',
    ...TABLE_HEAD,
    ...tableRows(results.scenes.map((s) => ({ label: `${s.look} ${s.pack} ${s.size} grain ${s.grain}`, m: s.m }))),
    '',
    '## Checks',
    '',
    ...(results.checks.seed
      ? [
          `- Same seed twice: ${results.checks.seed.identical ? 'identical' : 'different'}. Seed 1 vs seed 2 residual correlation ${results.checks.seed.seedCorrelation.toFixed(4)}. Largest residual correlation with itself shifted 16-512 px: ${results.checks.seed.worstLagValue.toFixed(4)} at ${results.checks.seed.worstLag}.`,
        ]
      : []),
    ...Object.values(results.checks)
      .filter((c) => 'flatRuns' in c)
      .map((c) => `- Dark ramp #000000 to #1C2B33 at 4K, grain ${c.grain}${c.dither ? '' : ', no dither'}: flat 8-bit runs ${pct(c.flatRuns)} %, luma std ${c.stdY.toFixed(2)} code values.`),
  ]
  await writeFile(path.join(outDir, 'renders.md'), md.join('\n') + '\n')
  console.log(`wrote ${path.relative(ROOT, outDir)}/renders.json, renders.md and crops/`)
}

// ---------------------------------------------------------------------------
// Sheets: 1:1 crops side by side, each with its own grain numbers, and a 3x zoom of its middle under it.

const ZOOM = 3
const GAP = 10
const CAPTION = 34

function escapeXml(text) {
  return String(text).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c])
}

function wrap(line, width, size) {
  const perLine = Math.max(10, Math.floor(width / (size * 0.55)))
  const out = []
  let current = ''
  for (const word of String(line).split(' ')) {
    if (current && current.length + word.length + 1 > perLine) {
      out.push(current)
      current = word
    } else current = current ? `${current} ${word}` : word
  }
  if (current) out.push(current)
  return out
}

function textImage(rawLines, width, size = 13) {
  const lines = rawLines.flatMap((line) => wrap(line, width, size))
  const height = lines.length * (size + 4) + 4
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${lines
    .map((line, i) => `<text x="2" y="${(i + 1) * (size + 4) - 2}" fill="${i === 0 ? '#e0e0e0' : '#9a9a9a'}" font-family="Helvetica, Arial, sans-serif" font-size="${size}">${escapeXml(line)}</text>`)
    .join('')}</svg>`
  return { input: Buffer.from(svg), height }
}

/** A panel: the crop at 1:1, its 3x zoom (middle third) under it, and a caption with its grain numbers above. */
async function panel(image, title, pictureShort) {
  // Crops are picked inside the measured area already, so no edge mask here.
  const m = measureGrain(image, { hpSigma: 0.0065 * pictureShort, minBin: 200, structure: 0 })
  const side = image.width
  const z = Math.round(side / ZOOM)
  const middle = await cropRgba(image, Math.round((side - z) / 2), Math.round((image.height - z) / 2), z, z)
  const zoom = await resizeRgba(middle, z * ZOOM, z * ZOOM, 'nearest')
  return { image, zoom, lines: [title, `L ${pct(m.stdL)} %, ${m.stdY.toFixed(1)} code values, half width ${m.acfHalf.toFixed(1)} px`] }
}

async function composeSheet(file, title, rows) {
  const columns = Math.max(...rows.map((row) => row.panels.length))
  const side = Math.max(...rows.flatMap((row) => row.panels.map((p) => p.image.width)))
  const zoomSide = Math.max(...rows.flatMap((row) => row.panels.map((p) => p.zoom.width)))
  const rowTitle = 24
  const captionHeight = Math.max(CAPTION, ...rows.flatMap((row) => row.panels.map((p) => textImage(p.lines, Math.max(side, zoomSide), 12).height)))
  const rowHeight = rowTitle + captionHeight + side + GAP + zoomSide + GAP * 2
  const width = GAP + columns * (Math.max(side, zoomSide) + GAP)
  const height = 36 + rows.length * rowHeight
  const composites = [{ ...textImage([title], width, 16), left: GAP, top: 8 }]
  rows.forEach((row, r) => {
    const top = 36 + r * rowHeight
    composites.push({ ...textImage([row.title], width, 14), left: GAP, top })
    row.panels.forEach((p, c) => {
      const left = GAP + c * (Math.max(side, zoomSide) + GAP)
      composites.push({ ...textImage(p.lines, Math.max(side, zoomSide), 12), left, top: top + rowTitle })
      composites.push({ input: p.image.data, raw: { width: p.image.width, height: p.image.height, channels: 4 }, left, top: top + rowTitle + captionHeight })
      composites.push({ input: p.zoom.data, raw: { width: p.zoom.width, height: p.zoom.height, channels: 4 }, left, top: top + rowTitle + captionHeight + side + GAP })
    })
  })
  await mkdir(path.dirname(file), { recursive: true })
  await sharp({ create: { width, height, channels: 3, background: '#161616' } }).composite(composites).jpeg({ quality: 92 }).toFile(file)
  console.log(`wrote ${path.relative(ROOT, file)}`)
}

/** A window of a reference image in its measured area, as big as `size` px of a picture whose short side is `pictureShort`, enlarged to `size`. */
async function referenceCrop(image, rects, size, pictureShort) {
  const m = measureGrain(image, { rects })
  const short = Math.min(image.width, image.height)
  const native = Math.max(16, Math.round((size * short) / pictureShort))
  const window = pickWindow(m, native)
  const crop = await cropRgba(image, window.x, window.y, native, native)
  return native === size ? crop : resizeRgba(crop, size, size, 'lanczos3')
}

async function loadCrop(name) {
  return loadRgba(path.join(cropDir, `${name}.png`))
}

async function makeSheets() {
  const sheetDir = path.join(outDir, 'sheets')
  const risoImages = []
  for (const id of RISO) {
    const ref = await manifestEntry(id)
    risoImages.push({ id, image: await loadRgba(path.join(AWE, ref.file)), rects: (ref.ignore ?? []).map((r) => r.rect) })
  }
  const deck = await loadRgba(path.join(FIGMA, '44-271-grain-tile-1x.png'))
  const deckCrop = await cropRgba(deck, 144, 92, CROP['1080p'], CROP['1080p'])

  for (const [mood, look] of Object.entries(SHEET_LOOKS)) {
    for (const sizeName of ['4K', '1080p']) {
      const [, pictureShort] = SIZES[sizeName]
      const size = CROP[sizeName]
      const rows = []
      for (const [k, pack] of PACKS.entries()) {
        const riso = risoImages[k]
        const panels = []
        if (sizeName === '1080p') panels.push(await panel(deckCrop, 'Deck Grain tile (44:271) at 1x, 1:1', 440))
        panels.push(await panel(await referenceCrop(riso.image, riso.rects, size, pictureShort), `${riso.id}, enlarged to a ${pictureShort} px short side`, pictureShort))
        for (const grain of [0, 0.5, 1]) {
          const name = `${look}-${pack}-${sizeName}-g${grain}`
          if (!existsSync(path.join(cropDir, `${name}.png`))) continue
          panels.push(await panel(await loadCrop(name), `${look} ${pack}, ${sizeName} export, grain ${grain}`, pictureShort))
        }
        rows.push({ title: `${pack[0].toUpperCase()}${pack.slice(1)}`, panels })
      }
      await composeSheet(path.join(sheetDir, `${mood}-${sizeName}.jpg`), `${mood[0].toUpperCase()}${mood.slice(1)} (${look}) at ${sizeName}: 1:1 crops, 3x zoom of the middle below each`, rows)
    }
  }

  // The riso prints at their own size next to the riso presets: with the presets' ink weight, and at strength 1 everywhere.
  const risoRows = []
  for (const id of RISO) {
    const ref = await manifestEntry(id)
    const short = Math.min(ref.width, ref.height)
    risoRows.push({
      title: id,
      panels: [
        await panel(await loadCrop(`riso-${id}-target`), `${id} print, 1:1 at ${ref.width}x${ref.height}`, short),
        await panel(await loadCrop(`riso-${id}-preset`), 'reference preset, grain 1 with its ink weight', short),
        await panel(await loadCrop(`riso-${id}-weight1`), 'the same preset, grain 1 everywhere (the tool)', short),
      ],
    })
  }
  await composeSheet(path.join(sheetDir, 'riso-native.jpg'), 'Riso prints vs our grain at strength 1, the same picture size, 1:1', risoRows)

  // The deck's Grain tile exported at 1x, 2x and 4x: the same picture area, each at 1:1.
  const deckRows = [{ title: 'Deck Grain tile (Figma Noise effect)', panels: [] }]
  for (const scale of [1, 2, 4]) {
    const tile = await loadRgba(path.join(FIGMA, `44-271-grain-tile-${scale}x.png`))
    const span = Math.round(CROP['1080p'] / scale)
    const crop = await cropRgba(tile, 144 * scale, 92 * scale, span * scale, span * scale)
    deckRows[0].panels.push(await panel(crop.width === CROP['1080p'] ? crop : await resizeRgba(crop, CROP['1080p'], CROP['1080p'], 'nearest'), `exported at ${scale}x: ${span} px of the tile, 1:1`, 440 * scale))
  }
  const sky = `${SHEET_LOOKS.sunset}-bold-1080p`
  deckRows.push({
    title: 'Ours at 1080p, the size of the deck slide',
    panels: [
      await panel(await loadCrop(`${sky}-g0.5`), 'sunset.ramp bold, grain 0.5', 1080),
      await panel(await loadCrop(`${sky}-g1`), 'sunset.ramp bold, grain 1', 1080),
    ],
  })
  await composeSheet(path.join(sheetDir, 'deck-tile.jpg'), 'Figma Noise on the deck Grain tile at 1x, 2x and 4x, and our grain at 1080p', deckRows)
}

if (args.file) await measureFile()
else if (args.refs) await measureRefs()
else if (args.renders) await measureRenders()
else if (args.sheets) await makeSheets()
else console.log('Usage: --refs | --renders | --sheets | --file <png> [--rect x,y,w,h] [--hp px]')
