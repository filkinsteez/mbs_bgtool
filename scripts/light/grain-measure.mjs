// Grain measurement for reference images and renders, with the same code for both (lib/grain.mjs).
// Usage:
//   node scripts/light/grain-measure.mjs --refs [--out dir]
//   node scripts/light/grain-measure.mjs --file <png> [--rect x,y,w,h] [--hp px] [--label name]
// Writes <out>/refs.json and refs.md (default out: artifacts/grain/measure).
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from './lib/args.mjs'
import { grainSummary, measureGrain } from './lib/grain.mjs'
import { ROOT } from './lib/harness.mjs'
import { cropRgba, loadRgba } from './lib/images.mjs'

const args = parseArgs(process.argv.slice(2))
const outDir = path.resolve(ROOT, args.out ?? 'artifacts/grain/measure')

const AWE = path.join(ROOT, 'public/references/awe')
const FIGMA = path.join(ROOT, 'artifacts/grain/figma')
const SCAN = path.join(ROOT, 'prototypes/grain-study/out/raw/41-26-raw1.png')

async function manifestEntry(id) {
  const manifest = JSON.parse(await readFile(path.join(AWE, 'manifest.json'), 'utf8'))
  return manifest.references.find((ref) => ref.id === id)
}

/** The references with visible texture, a no-grain sky and photo for scale, and the deck's Grain tile at 1x, 2x, 4x. */
async function referenceList() {
  const list = []
  for (const id of ['sunset-green-riso', 'sunset-blue-riso', 'sunset-pink-riso', 'sunset-film-poster-bands', 'sunset-sky-peach', 'contour-iridescent-rings']) {
    const ref = await manifestEntry(id)
    if (!ref) continue
    list.push({ label: id, file: path.join(AWE, ref.file), rects: (ref.ignore ?? []).map((r) => r.rect), note: `${ref.width}x${ref.height} moodboard tile` })
  }
  if (existsSync(SCAN)) list.push({ label: 'riso scan (41:26 source, own pixels)', file: SCAN, rects: [], note: '567x1134 scan behind the three riso tiles' })
  for (const [scale, name] of [
    [1, '44-271-grain-tile-1x.png'],
    [2, '44-271-grain-tile-2x.png'],
    [4, '44-271-grain-tile-4x.png'],
  ]) {
    const file = path.join(FIGMA, name)
    if (existsSync(file)) list.push({ label: `deck Grain tile ${scale}x`, file, rects: [], note: `Figma node 44:271 exported at ${scale}x` })
  }
  const photo = path.join(FIGMA, '44-271-raw-1.png')
  if (existsSync(photo)) list.push({ label: 'deck Grain tile photo, no effect', file: photo, rects: [], note: '1200x1575 source photo of 44:271' })
  return list
}

function tableRows(entries) {
  const pct = (v) => (v == null || !Number.isFinite(v) ? '-' : (v * 100).toFixed(2))
  const band = (b) => (b ? pct(b.stdL) : '-')
  return entries.map(
    ({ label, m }) =>
      `| ${label} | ${m.width}x${m.height} | ${pct(m.stdL)} | ${m.stdY.toFixed(2)} | ${band(m.bands.shadows)} | ${band(m.bands.mids)} | ${band(m.bands.highlights)} | ${m.acfHalf.toFixed(2)} | ${(m.acfHalfShort * 1000).toFixed(2)} | ${m.spectrum ? m.spectrum.highShare.toFixed(2) : '-'} | ${m.mono.toFixed(2)} | ${m.skew.toFixed(2)} | ${pct(m.darkSpecks)} | ${pct(m.flatRuns)} |`,
  )
}

export const TABLE_HEAD = [
  '| Image | Size | L std % | Luma std (code values) | Shadows L % | Mids L % | Highlights L % | Half width px | Half width per 1000 of short side | High-frequency share | Mono | Skew | Dark specks % | Flat 8-bit runs % |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
]

function strip(m) {
  const { mask, ...rest } = m
  return rest
}

async function measureRefs() {
  const entries = []
  for (const ref of await referenceList()) {
    const image = await loadRgba(ref.file)
    const m = measureGrain(image, { rects: ref.rects })
    entries.push({ label: ref.label, note: ref.note, m })
    console.log(`== ${ref.label} (${ref.note})\n${grainSummary(m)}`)
  }
  await mkdir(outDir, { recursive: true })
  await writeFile(path.join(outDir, 'refs.json'), JSON.stringify(entries.map((e) => ({ ...e, m: strip(e.m) })), null, 1))
  await writeFile(path.join(outDir, 'refs.md'), [...TABLE_HEAD, ...tableRows(entries)].join('\n') + '\n')
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

if (args.file) await measureFile()
else if (args.refs) await measureRefs()
else console.log('Usage: --refs | --file <png> [--rect x,y,w,h] [--hp px]')
