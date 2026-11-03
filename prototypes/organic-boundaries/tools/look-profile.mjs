// CPU profile of one look's uniforms() during a drag, split by source file.
// node --cpu-prof --cpu-prof-dir=<dir> tools/look-profile.mjs <ramp|bands|blooms> [16x9|9x16]
// then: node tools/look-profile.mjs --read <dir> [functions]
// (functions: split by function and line instead of by file)

import fs from 'node:fs'

if (process.argv[2] === '--read') {
  const dir = process.argv[3]
  const file = fs.readdirSync(dir).filter((n) => n.endsWith('.cpuprofile')).map((n) => `${dir}/${n}`).sort().pop()
  const p = JSON.parse(fs.readFileSync(file, 'utf8'))
  const byId = new Map(p.nodes.map((n) => [n.id, n]))
  const parent = new Map()
  for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id)
  // time inside the drag loop only: samples whose stack passes through `drag`
  const inDrag = (id) => {
    for (let k = id; k !== undefined; k = parent.get(k)) if (byId.get(k).callFrame.functionName === 'drag') return true
    return false
  }
  const byFile = new Map()
  let total = 0
  for (let i = 0; i < p.samples.length; i++) {
    if (!inDrag(p.samples[i])) continue
    const cf = byId.get(p.samples[i]).callFrame
    const file = cf.url.split('/').pop()
    const key = process.argv[4] === 'functions' ? `${cf.functionName || '(anonymous)'} ${file}:${cf.lineNumber + 1}` : file || cf.functionName || '(native)'
    byFile.set(key, (byFile.get(key) ?? 0) + (p.timeDeltas[i] ?? 0))
    total += p.timeDeltas[i] ?? 0
  }
  for (const [k, v] of [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${((100 * v) / total).toFixed(1).padStart(5)}%  ${(v / 1000).toFixed(0).padStart(6)} ms  ${k}`)
  process.exit(0)
}

const { startHarness } = await import('../../../scripts/light/lib/harness.mjs')
const [look, format = '16x9'] = process.argv.slice(2)
const files = { ramp: ['/src/light/recipes/sunset/ramp.ts', 'sunsetRamp'], bands: ['/src/light/recipes/sunset/bands.ts', 'sunsetBands'], blooms: ['/src/light/recipes/sunset/blooms.ts', 'sunsetBlooms'] }
const harness = await startHarness()
const { composeScene } = await harness.ssr('/src/light/compose.ts')
const { getPack } = await harness.ssr('/src/light/color/packs.ts')
const { resolveScene, recipeContext } = await harness.ssr('/src/light/engine/resolve.ts')
const recipe = (await harness.ssr(files[look][0]))[files[look][1]]
const aspect = format === '16x9' ? 16 / 9 : 9 / 16
const contexts = []
for (const control of ['softness', 'mood', 'intensity']) {
  for (let k = 0; k <= 30; k++) {
    const scene = composeScene(recipe, { pack: getPack('bold'), controls: { intensity: 0.5, softness: 0.5, mood: 0.5, [control]: 0.2 + (0.6 * k) / 30 }, seed: 1, aspect })
    contexts.push(recipeContext(resolveScene(recipe, scene), aspect))
  }
}
function drag() {
  for (const ctx of contexts) recipe.uniforms(ctx)
}
drag()
await harness.close()
