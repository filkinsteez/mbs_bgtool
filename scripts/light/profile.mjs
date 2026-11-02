// Where a recipe's render time goes, stage by stage, split into engine passes and the recipe's own shader.
// Usage: node scripts/light/profile.mjs [--recipe <id>[,<id>...]] [--pack bold] [--seed 3] [--size 1920x1080] [--ss 1]
//          [--runs 5] [--defaults] [--json <file>] [--save <dir>] [--against <dir>]
// Scenes come from each recipe's compose (pack, default controls 0.5, the frame's aspect) unless --defaults or the
// recipe has no compose; then the recipe defaults with the seed.
// --save writes a 1080p 1x preview and a 4K 2x export of each scene (no grain, no dither); --against compares new
// renders with ones saved earlier, so a speedup can be checked for changes to the image. Both report preview vs export.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { list, parseArgs, parseSize } from './lib/args.mjs'
import { ROOT, startHarness } from './lib/harness.mjs'
import { loadRgba, resizeRgba, savePng } from './lib/images.mjs'

const args = parseArgs()
const size = args.size ? parseSize(args.size) : { width: 1920, height: 1080 }
const supersample = args.ss ? Number(args.ss) : 1
const runs = args.runs ? Number(args.runs) : 5
const seed = args.seed ? Number(args.seed) : 3
const pack = typeof args.pack === 'string' ? args.pack : 'bold'
const saveDir = typeof args.save === 'string' ? path.resolve(ROOT, args.save) : null
const againstDir = typeof args.against === 'string' ? path.resolve(ROOT, args.against) : null

const harness = await startHarness()
try {
  const info = await harness.info()
  const { compareImages, buildMask } = await harness.ssr('/src/light/audit/index.ts')
  const deltaE = (a, b) => compareImages(a, b, buildMask(a.width, a.height, [], 0)).metrics.deltaE
  const format = (d) => `mean ${d.mean.toFixed(4)} p95 ${d.p95.toFixed(4)}`
  if (saveDir) await mkdir(saveDir, { recursive: true })
  const ids = list(args.recipe).length ? list(args.recipe) : info.recipes.map((r) => r.id)
  const results = {}
  for (const id of ids) {
    if (info.recipeErrors[id]) {
      console.log(`${id}: did not load: ${info.recipeErrors[id].split('\n')[0]}`)
      continue
    }
    let scene = { recipe: id, seed }
    let source = `defaults, seed ${seed}`
    let tag = 'defaults'
    if (!args.defaults) {
      try {
        scene = await harness.call('compose', id, pack, { intensity: 0.5, softness: 0.5, mood: 0.5 }, seed, size.width / size.height)
        source = `compose, ${pack}, controls 0.5, seed ${seed}`
        tag = `compose-${pack}`
      } catch {
        // No compose: keep the defaults.
      }
    }
    const result = await harness.call('profile', { scene, ...size, supersample, runs })
    results[id] = { source, ...result }
    const stages = [...new Set([...Object.keys(result.stages), ...Object.keys(result.stub.stages)])]
    const sum = (values) => values.reduce((a, b) => a + b, 0)
    console.log(
      `\n${id} (${source}) at ${size.width}x${size.height} ${supersample}x: ${result.total.toFixed(1)} ms single, ${result.burst.toFixed(1)} ms back to back; ` +
        `engine alone ${result.stub.total.toFixed(1)} / ${result.stub.burst.toFixed(1)} ms`,
    )
    console.log(`  ${'stage'.padEnd(22)} ${'total'.padStart(7)} ${'engine'.padStart(7)} ${'recipe'.padStart(7)}`)
    for (const stage of stages) {
      const total = result.stages[stage] ?? 0
      const engine = result.stub.stages[stage] ?? 0
      console.log(`  ${stage.padEnd(22)} ${total.toFixed(2).padStart(7)} ${engine.toFixed(2).padStart(7)} ${(total - engine).toFixed(2).padStart(7)}`)
    }
    const profiledTotal = sum(Object.values(result.stages))
    const profiledEngine = sum(Object.values(result.stub.stages))
    console.log(`  ${'(stages, profiled)'.padEnd(22)} ${profiledTotal.toFixed(2).padStart(7)} ${profiledEngine.toFixed(2).padStart(7)} ${(profiledTotal - profiledEngine).toFixed(2).padStart(7)}`)

    if (saveDir || againstDir) {
      const still = { ...scene, output: { ...(scene.output ?? {}), grain: 0 } }
      const preview = await harness.render({ scene: still, width: 1920, height: 1080, supersample: 1, dither: false })
      const exported = await harness.render({ scene: still, width: 3840, height: 2160, supersample: 2, dither: false })
      const match = deltaE(preview, await resizeRgba(exported, 1920, 1080, 'lanczos3'))
      results[id].previewVsExport = match
      console.log(`  1080p 1x preview vs 4K 2x export: ${format(match)}`)
      const files = { preview: `${id}-${tag}-1080p.png`, exported: `${id}-${tag}-4k.png` }
      if (saveDir) {
        await savePng(path.join(saveDir, files.preview), preview)
        await savePng(path.join(saveDir, files.exported), exported)
      }
      if (againstDir) {
        const before = { preview: await loadRgba(path.join(againstDir, files.preview)), exported: await loadRgba(path.join(againstDir, files.exported)) }
        const previewChange = deltaE(before.preview, preview)
        const exportChange = deltaE(before.exported, exported)
        results[id].change = { preview: previewChange, exported: exportChange }
        console.log(`  against ${path.relative(ROOT, againstDir)}: preview ${format(previewChange)}; 4K export ${format(exportChange)}`)
      }
    }
  }
  if (typeof args.json === 'string') await writeFile(path.resolve(ROOT, args.json), JSON.stringify(results, null, 2))
} finally {
  await harness.close()
}
