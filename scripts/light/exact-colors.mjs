// Exact pack colors in the tool's looks, stage off and on (coordinator, 2026-11-11, round 20). For each frame and pack
// color: the share of the frame that reads as that exact color (a soft blend of two near-hue colors split between
// them), the share that reads as it pale (more than a third of the way to white), and the off-pack share split into
// thin meeting lines between far-apart colors, other thin areas and wide areas (lib/exact-read.mjs has the rules).
//
//   node scripts/light/exact-colors.mjs [--look sunset.merged,contour.merged,rush.split]
//     [--packs bold,elemental,atmospheric] [--seeds 1-8] [--formats 16x9,9x16] [--stage on|off|on,off] [--mix default]
//     [--out dir]
//
// Writes <out>/summary.md (a line per frame, then a table per look, pack and stage) and <out>/exact.json. As the app
// draws by default (lib/stage-args.mjs): the stage on, each pack's colors from the color stage at the mix --mix
// (default: the default mix). --stage off or on,off adds the look in each pack without the stage, for comparisons.
import fs from 'node:fs/promises'
import path from 'node:path'
import { list, parseArgs } from './lib/args.mjs'
import { mixByName } from './lib/color-read.mjs'
import { EXACT, exactRead, exactRules } from './lib/exact-read.mjs'
import { ROOT, startHarness } from './lib/harness.mjs'
import { runMixSet, stagesArg } from './lib/stage-args.mjs'

const args = parseArgs()
const mixSetCode = runMixSet(args, import.meta.url)
if (mixSetCode !== null) process.exit(mixSetCode)
const looks = list(args.look).length ? list(args.look) : ['sunset.merged', 'contour.merged', 'rush.split']
const packIds = list(args.packs).length ? list(args.packs) : ['primary', 'bold', 'elemental', 'atmospheric']
const seeds = list(args.seeds ?? '1-8').flatMap((part) => {
  const [a, b] = part.split('-').map(Number)
  return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a]
})
const formats = list(args.formats).length ? list(args.formats) : ['16x9', '9x16']
const stages = stagesArg(args)
const mixName = typeof args.mix === 'string' ? args.mix : 'default'
const outDir = path.resolve(typeof args.out === 'string' ? args.out : path.join(ROOT, 'artifacts', 'exact-colors', new Date().toTimeString().slice(0, 8).replace(/:/g, '')))
const RENDER = { '16x9': { width: 640, height: 360 }, '9x16': { width: 360, height: 640 } }
const controls = { intensity: 0.5, softness: 0.5, mood: 0.5 }
const pct = (v) => (100 * v).toFixed(1)

const harness = await startHarness()
try {
  const { getPack, HUE_ORDER } = await harness.ssr('/src/light/color/packs.ts')
  const { buildScene } = await harness.ssr('/src/tool/controls.ts')
  const { EXPORT_SIZES } = await harness.ssr('/src/light/engine/frame.ts')
  const { dimPaths } = await harness.ssr('/src/light/engine/dimPath.ts')
  const { meetApart, meetHueApart } = await harness.ssr('/src/light/engine/meet.ts')
  const stage = stages.includes('on') ? await harness.ssr('/src/light/color/stage.ts') : null
  const mixes = stage ? await harness.ssr('/src/light/color/mix.ts') : null
  const apart = (a, b) => Math.max(meetApart(a, b), meetHueApart(a, b))
  const rules = Object.fromEntries(
    packIds.map((id) => {
      const pack = getPack(id)
      return [id, exactRules(pack, dimPaths(pack.colors.map((c) => c.hex)), apart, HUE_ORDER?.[id] ?? [])]
    }),
  )

  const frames = []
  const started = Date.now()
  for (const look of looks)
    for (const s of stages)
      for (const packId of packIds)
        for (const format of formats)
          for (const seed of seeds) {
            const pack = getPack(packId)
            const exportSize = EXPORT_SIZES[format.replace('x', ':')]
            const on = s === 'on'
            const built = buildScene(look, getPack(on ? stage.COLOR_DESIGN_PACK : packId), seed, controls, exportSize.width / exportSize.height)
            const scene = on ? stage.withColorMix(built, pack, mixByName(mixes, pack, mixName)) : built
            const image = await harness.render({ scene, ...RENDER[format], supersample: 2 })
            const read = exactRead(rules[packId], image.data, image.width, image.height, 4)
            frames.push({ id: `${look.replace('.', '-')}-${packId}-s${seed}-${format}-${s}`, look, pack: packId, seed, format, stage: s, ...read })
          }

  const line = (f) =>
    `- ${f.id}: ${Object.keys(f.exact)
      .map((name) => `${name} ${pct(f.exact[name])} (pale ${pct(f.pale[name])})`)
      .join(', ')}; meeting lines ${pct(f.lines)}, other thin ${pct(f.thinOther)}, wide off-pack ${pct(f.wide)}, black ${pct(f.black)}`
  const table = [
    '| look | pack | stage | frames | exact share of each color, mean % (frames under 1%) | pale share of each color, mean % | pale | meeting lines | other thin | wide off-pack |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ]
  const summary = {}
  for (const look of looks)
    for (const packId of packIds)
      for (const s of stages) {
        const group = frames.filter((f) => f.look === look && f.pack === packId && f.stage === s)
        if (!group.length) continue
        const mean = (get) => group.reduce((sum, f) => sum + get(f), 0) / group.length
        const names = Object.keys(group[0].exact)
        const row = {
          frames: group.length,
          exact: Object.fromEntries(names.map((name) => [name, mean((f) => f.exact[name])])),
          under: Object.fromEntries(names.map((name) => [name, group.filter((f) => f.exact[name] < 0.01).length])),
          pale: Object.fromEntries(names.map((name) => [name, mean((f) => f.pale[name])])),
          paleTotal: mean((f) => Object.values(f.pale).reduce((x, v) => x + v, 0)),
          lines: mean((f) => f.lines),
          thinOther: mean((f) => f.thinOther),
          wide: mean((f) => f.wide),
        }
        summary[`${look} | ${packId} | ${s}`] = row
        table.push(
          `| ${look} | ${packId} | ${s} | ${row.frames} | ${names.map((name) => `${name} ${pct(row.exact[name])} (${row.under[name]})`).join(', ')} | ${names.map((name) => `${name} ${pct(row.pale[name])}`).join(', ')} | ${pct(row.paleTotal)} | ${pct(row.lines)} | ${pct(row.thinOther)} | ${pct(row.wide)} |`,
        )
      }
  const md = [
    `# Exact pack colors`,
    '',
    `Looks ${looks.join(', ')}; packs ${packIds.join(', ')}; seeds ${seeds[0]}-${seeds[seeds.length - 1]}; formats ${formats.join(', ')}; stage ${stages.join(' and ')}${stages.includes('on') ? ` (mix ${mixName})` : ''}; ${frames.length} frames in ${Math.round((Date.now() - started) / 1000)} s. Rules: lib/exact-read.mjs (EXACT ${JSON.stringify(EXACT)}).`,
    '',
    table.join('\n'),
    '',
    '## Frames',
    '',
    ...frames.map(line),
    '',
  ].join('\n')
  await fs.mkdir(outDir, { recursive: true })
  await fs.writeFile(path.join(outDir, 'summary.md'), md)
  await fs.writeFile(path.join(outDir, 'exact.json'), JSON.stringify({ exact: EXACT, summary, frames }, null, 1))
  console.log(table.join('\n'))
  console.log(`summary: ${path.relative(process.cwd(), path.join(outDir, 'summary.md'))}`)
} finally {
  await harness.close()
}
