// Drag colors: whether a drag keeps the pack colors a frame shows (coordinator, 2026-11-11 7:29 AM, compare round 37).
// A drag moves the light and keeps the picture's colors: the pack colors a seed shows at the default view are still
// there under any drag. Each frame is read at the default view with the exact-color reading (lib/exact-read.mjs), then
// under the palette check's test drags and a grid of light positions. A drag loses a color when the default view shows
// it (SHOWN of the frame or more) and the drag doesn't; it makes the frame one color when the default view shows two
// colors or more and the drag one or none (lib/drag-colors.mjs). Usage: scripts/light/README.md, "Drag colors".
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { list, parseArgs } from './lib/args.mjs'
import { mixByName } from './lib/color-read.mjs'
import { compareDrag, gridDrags, SHOWN, TEST_DRAGS, worstCases } from './lib/drag-colors.mjs'
import { exactRead, exactRules } from './lib/exact-read.mjs'
import { ROOT, startHarness } from './lib/harness.mjs'
import { runMixSet, stagesArg } from './lib/stage-args.mjs'

const args = parseArgs()
const mixSetCode = runMixSet(args, import.meta.url)
if (mixSetCode !== null) process.exit(mixSetCode)
const looks = list(args.look).length ? list(args.look) : ['sunset.merged', 'contour.merged', 'rush.split']
const packIds = list(args.packs ?? args.pack).length ? list(args.packs ?? args.pack) : ['bold', 'elemental', 'atmospheric']
const seeds = list(args.seeds ?? '1-8').flatMap((part) => {
  const [a, b] = part.split('-').map(Number)
  return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a]
})
const formats = list(args.formats ?? args.format).length ? list(args.formats ?? args.format).map((f) => f.replace(':', 'x')) : ['16x9', '9x16']
const stages = stagesArg(args, ['on', 'off'])
const mixName = typeof args.mix === 'string' ? args.mix : 'default'
const grid = Number(args.grid ?? 3)
const sheetCount = Number(args.sheet ?? 4)
const LONG = Number(args.size ?? 480)
const outDir = path.resolve(typeof args.out === 'string' ? args.out : path.join(ROOT, 'artifacts', 'drag-colors', new Date().toTimeString().slice(0, 8).replace(/:/g, '')))
const drags = [...TEST_DRAGS, ...gridDrags(grid)]
const pct = (v) => (100 * v).toFixed(1)
const sizeOf = (format) => {
  const [fw, fh] = format.split('x').map(Number)
  return fw >= fh ? [LONG, Math.round((LONG * fh) / fw)] : [Math.round((LONG * fw) / fh), LONG]
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const text = (s, w, size, color = '#ddd') => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${size + 6}"><text x="2" y="${size + 1}" font-family="Helvetica" font-size="${size}" fill="${color}">${esc(s)}</text></svg>`)

const harness = await startHarness()
const frames = []
const started = Date.now()
try {
  const { getPack, HUE_ORDER } = await harness.ssr('/src/light/color/packs.ts')
  const tool = await harness.ssr('/src/tool/controls.ts')
  const { getRecipe } = await harness.ssr('/src/light/recipes/index.ts')
  const { dimPaths } = await harness.ssr('/src/light/engine/dimPath.ts')
  const { meetApart, meetHueApart } = await harness.ssr('/src/light/engine/meet.ts')
  const stage = await harness.ssr('/src/light/color/stage.ts')
  const mixes = await harness.ssr('/src/light/color/mix.ts')
  const apart = (a, b) => Math.max(meetApart(a, b), meetHueApart(a, b))
  const rules = Object.fromEntries(packIds.map((id) => [id, exactRules(getPack(id), dimPaths(getPack(id).colors.map((c) => c.hex)), apart, HUE_ORDER?.[id] ?? [])]))

  // The scene the tool draws for a frame and a drag (none: the default view), stage off or on.
  const sceneOf = (f, drag) => {
    const pack = getPack(f.pack)
    const on = f.stage === 'on'
    const drawn = on ? getPack(stage.COLOR_DESIGN_PACK) : pack
    const [fw, fh] = f.format.split('x').map(Number)
    const base = { intensity: 0.5, softness: 0.5, mood: 0.5, ...(tool.FIXED_CONTROLS?.[getRecipe(f.look).mood] ?? {}) }
    const controls = drag ? tool.controlsForDrag(f.look, drawn, f.seed, base, fw / fh, tool.clampDrag(drag)) : base
    const built = tool.buildScene(f.look, drawn, f.seed, controls, fw / fh)
    return on ? stage.withColorMix(built, pack, mixByName(mixes, pack, mixName)) : built
  }
  const renderOf = async (f, drag) => {
    const [w, h] = sizeOf(f.format)
    return (await harness.render({ scene: sceneOf(f, drag), width: w, height: h, supersample: 2 })).data
  }
  const readOf = async (f, drag) => {
    const [w, h] = sizeOf(f.format)
    return exactRead(rules[f.pack], await renderOf(f, drag), w, h, 4).exact
  }

  for (const look of looks) {
    for (const s of stages)
      for (const packId of packIds)
        for (const format of formats)
          for (const seed of seeds) {
            const f = { look, pack: packId, seed, format, stage: s }
            const exact = await readOf(f, null)
            const results = []
            for (const d of drags) {
              const after = await readOf(f, d)
              results.push({ name: d.name, from: d.from, to: d.to, exact: after, ...compareDrag(exact, after) })
            }
            frames.push({ ...f, exact, shown: Object.keys(exact).filter((n) => exact[n] >= SHOWN), drags: results })
          }
    const set = frames.filter((f) => f.look === look)
    console.log(`${look}: ${set.reduce((n, f) => n + f.drags.filter((d) => d.lost.length).length, 0)} of ${set.length * drags.length} drags lose a color, ${set.reduce((n, f) => n + f.drags.filter((d) => d.oneColor).length, 0)} make the frame one color`)
  }

  // The worst cases per stage, the default view beside the drag, with the drag's line drawn on it.
  for (const s of stages) {
    const worst = worstCases(
      frames.filter((f) => f.stage === s),
      sheetCount,
    )
    if (!worst.length) continue
    const W = 2 * LONG + 24
    const comp = [{ input: text(`Drag colors, stage ${s}: the ${worst.length} worst drags, one per frame; left the default view, right the drag (line from the dot)`, W, 13, '#fff'), left: 8, top: 4 }]
    let top = 26
    for (const { frame: f, drag } of worst) {
      const [w, h] = sizeOf(f.format)
      const toPng = async (data) => sharp(data, { raw: { width: w, height: h, channels: 4 } }).removeAlpha().png().toBuffer()
      const before = await toPng(await renderOf(f, null))
      const line = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><line x1="${drag.from[0] * w}" y1="${drag.from[1] * h}" x2="${drag.to[0] * w}" y2="${drag.to[1] * h}" stroke="#fff" stroke-width="2" stroke-dasharray="6 4"/><circle cx="${drag.from[0] * w}" cy="${drag.from[1] * h}" r="6" fill="none" stroke="#fff" stroke-width="2"/></svg>`
      const after = await sharp(await toPng(await renderOf(f, drag))).composite([{ input: Buffer.from(line) }]).png().toBuffer()
      const shownAt = (exact) => Object.keys(exact).map((n) => `${n} ${pct(exact[n])}`).join(', ')
      comp.push(
        { input: text(`${f.look} ${f.pack} s${f.seed} ${f.format.replace('x', ':')}, drag ${drag.name} (${drag.from.join(',')} to ${drag.to.join(',')}): ${drag.oneColor ? 'one color; ' : ''}lost ${drag.lost.map((c) => `${c.name} ${pct(c.before)}% to ${pct(c.after)}%`).join(', ')}`, W, 12, '#ffcf9a'), left: 8, top },
        { input: text(`default: ${shownAt(f.exact)}`, w + 8, 11, '#bbb'), left: 8, top: top + 17 },
        { input: text(`drag: ${shownAt(drag.exact)}`, w + 8, 11, '#bbb'), left: w + 16, top: top + 17 },
        { input: before, left: 8, top: top + 34 },
        { input: after, left: w + 16, top: top + 34 },
      )
      top += h + 44
    }
    await fs.mkdir(outDir, { recursive: true })
    await sharp({ create: { width: W, height: top, channels: 3, background: '#161616' } }).composite(comp).jpeg({ quality: 85 }).toFile(path.join(outDir, `worst-${s}.jpg`))
  }
} finally {
  await harness.close()
}

const seconds = Math.round((Date.now() - started) / 1000)
await fs.mkdir(outDir, { recursive: true })
await fs.writeFile(path.join(outDir, 'drag.json'), JSON.stringify({ shown: SHOWN, mix: mixName, size: LONG, drags, frames }, null, 1))
await fs.writeFile(path.join(outDir, 'summary.md'), summaryOf())
const lossy = frames.reduce((n, f) => n + f.drags.filter((d) => d.lost.length).length, 0)
console.log(`${frames.length} frames, ${frames.length * drags.length} drags in ${seconds} s; ${lossy} lose a color; summary: ${path.relative(process.cwd(), path.join(outDir, 'summary.md'))}`)
if (lossy) process.exitCode = 1

function summaryOf() {
  const lines = [
    '# Drag colors',
    '',
    `Looks ${looks.join(', ')}; packs ${packIds.join(', ')}; seeds ${seeds[0]}-${seeds.at(-1)}; ${formats.map((f) => f.replace('x', ':')).join(' and ')}; stage ${stages.join(' and ')}${stages.includes('on') ? ` (mix ${mixName})` : ''}; ${LONG} px on the long side; ${drags.length} drags a frame (the test drags and a ${grid} by ${grid} grid); ${frames.length} frames in ${seconds} s. A color is shown at ${pct(SHOWN)}% of the frame or more (exact share, lib/exact-read.mjs). A drag loses a color the default view shows and it doesn't; it makes the frame one color when the default view shows two colors or more and the drag one or none.`,
    '',
    '| Look | Pack | Stage | Drags | Lose a color | One color | Colors lost (drags) |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (const look of looks)
    for (const packId of packIds)
      for (const s of stages) {
        const set = frames.filter((f) => f.look === look && f.pack === packId && f.stage === s)
        if (!set.length) continue
        const all = set.flatMap((f) => f.drags)
        const byColor = {}
        for (const d of all) for (const c of d.lost) byColor[c.name] = (byColor[c.name] ?? 0) + 1
        lines.push(`| ${look} | ${packId} | ${s} | ${all.length} | ${all.filter((d) => d.lost.length).length} | ${all.filter((d) => d.oneColor).length} | ${Object.entries(byColor).map(([n, k]) => `${n} ${k}`).join(', ') || 'none'} |`)
      }
  lines.push('', '## By drag', '', `Drags that lose a color, of ${seeds.length * formats.length * packIds.length} frames per look and stage.`, '', `| Drag | From | To | ${looks.flatMap((l) => stages.map((s) => `${l} ${s}`)).join(' | ')} |`, `| --- | --- | --- | ${looks.flatMap(() => stages.map(() => '---')).join(' | ')} |`)
  for (const d of drags) {
    const cells = looks.flatMap((l) => stages.map((s) => frames.filter((f) => f.look === l && f.stage === s && f.drags.find((x) => x.name === d.name)?.lost.length).length))
    lines.push(`| ${d.name} | ${d.from.join(', ')} | ${d.to.join(', ')} | ${cells.join(' | ')} |`)
  }
  lines.push('', '## Worst seeds', '', 'Per look and stage, the pack and seed whose drags lose the most (both formats): drags that lose a color, and the mean share of the frame the lost colors give up in those drags.', '')
  for (const look of looks)
    for (const s of stages) {
      const rows = []
      for (const packId of packIds)
        for (const seed of seeds) {
          const set = frames.filter((f) => f.look === look && f.stage === s && f.pack === packId && f.seed === seed)
          const ds = set.flatMap((f) => f.drags.filter((d) => d.lost.length))
          if (ds.length) rows.push({ packId, seed, n: ds.length, of: set.length * drags.length, loss: ds.reduce((x, d) => x + d.loss, 0) / ds.length })
        }
      rows.sort((a, b) => b.n - a.n || b.loss - a.loss)
      lines.push(`- ${look}, stage ${s}: ${rows.slice(0, 5).map((r) => `${r.packId} s${r.seed} ${r.n} of ${r.of} (${pct(r.loss)}%)`).join('; ') || 'none'}`)
    }
  lines.push('', '## Drags that lose a color', '')
  for (const f of frames) {
    const bad = f.drags.filter((d) => d.lost.length || d.oneColor)
    if (!bad.length) continue
    lines.push(`- ${f.look} ${f.pack} s${f.seed} ${f.format.replace('x', ':')} stage ${f.stage} (shows ${f.shown.map((n) => `${n} ${pct(f.exact[n])}`).join(', ')}): ${bad.map((d) => `${d.name}${d.oneColor ? ' one color' : ''} loses ${d.lost.map((c) => `${c.name} to ${pct(c.after)}`).join(', ')}`).join('; ')}`)
  }
  return `${lines.join('\n')}\n`
}
