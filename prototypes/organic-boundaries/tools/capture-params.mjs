// The params, aspect and seed each Sunset look passes to calibrateBoundary while
// Softness, Horizon and Intensity are dragged (as speed-check.mjs drags them), for
// Bold and Elemental at 16:9 and 9:16, plus other seeds and packs at the defaults.
// The looks run from a copy of their folder (tools/look-copy.mjs) whose boundary.ts
// passes each call on to the real one and notes it down.
// node tools/capture-params.mjs out/params.json

import fs from 'node:fs'
import path from 'node:path'
import { startHarness } from '../../../scripts/light/lib/harness.mjs'
import { PROTO } from '../lib/refs.mjs'
import { COPY_URL, makeLookCopy } from './look-copy.mjs'

const out = process.argv[2]
const recorder = path.join(PROTO, 'out/recording-boundary.ts')
fs.writeFileSync(
  recorder,
  `import { calibrateBoundary as calibrate } from '/src/light/recipes/sunset/boundary.ts'
export * from '/src/light/recipes/sunset/boundary.ts'
export function calibrateBoundary(params, aspect, seed) {
  globalThis.__boundaryRecord?.push({ params: JSON.parse(JSON.stringify(params)), aspect, seed })
  return calibrate(params, aspect, seed)
}
`,
)
makeLookCopy(recorder)
const harness = await startHarness()
const { composeScene } = await harness.ssr('/src/light/compose.ts')
const { getPack } = await harness.ssr('/src/light/color/packs.ts')
const { resolveScene, recipeContext } = await harness.ssr('/src/light/engine/resolve.ts')
const looks = [
  ['ramp', (await harness.ssr(COPY_URL + 'ramp.ts')).sunsetRamp],
  ['bands', (await harness.ssr(COPY_URL + 'bands.ts')).sunsetBands],
  ['blooms', (await harness.ssr(COPY_URL + 'blooms.ts')).sunsetBlooms],
]
const all = []
for (const [name, recipe] of looks) {
  const run = (pack, controls, seed, aspect, tag) => {
    globalThis.__boundaryRecord = []
    const scene = composeScene(recipe, { pack: getPack(pack), controls, seed, aspect })
    recipe.uniforms(recipeContext(resolveScene(recipe, scene), aspect))
    for (const call of globalThis.__boundaryRecord) all.push({ look: name, tag, ...call })
  }
  for (const aspect of [16 / 9, 9 / 16]) {
    for (const pack of ['bold', 'elemental']) {
      for (const control of ['softness', 'mood', 'intensity']) {
        for (let k = 0; k <= 30; k++) {
          const v = 0.2 + (0.6 * k) / 30
          run(pack, { intensity: 0.5, softness: 0.5, mood: 0.5, [control]: v }, 1, aspect, `${pack} ${control} ${v.toFixed(2)}`)
        }
      }
    }
    for (const pack of ['bold', 'elemental', 'atmospheric']) for (let seed = 2; seed <= 6; seed++) run(pack, { intensity: 0.5, softness: 0.5, mood: 0.5 }, seed, aspect, `${pack} seed ${seed}`)
  }
}
globalThis.__boundaryRecord = undefined
fs.writeFileSync(out, JSON.stringify(all))
const counts = {}
for (const c of all) counts[c.look] = (counts[c.look] ?? 0) + 1
console.log(`${all.length} calls captured`, counts)
await harness.close()
