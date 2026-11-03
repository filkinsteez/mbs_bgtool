// What a slider drag costs in the three Sunset looks.
//
// node speed-check.mjs [--against <other boundary.ts>] [--seed n] [--out file.json]
//   Each look's uniforms() (what the tool calls when a control changes) for a drag
//   of Softness, Horizon and Intensity from 0.2 to 0.8 in 31 steps, Bold, seed 1 by
//   default, at 16:9 and 9:16. Every step is a new set of params, so the looks'
//   caches miss. With --against, the same drag also runs on a copy of the looks with
//   that boundary.ts, step by step in turn with the real ones, so both see the same
//   machine load.
// Whether a change to boundary.ts changes the pictures: tools/same-moment-diff.mjs.

import fs from 'node:fs'
import path from 'node:path'
import { startHarness } from '../../scripts/light/lib/harness.mjs'
import { COPY_URL, FORMATS, LOOKS, makeLookCopy } from './tools/look-copy.mjs'

const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : null
}
const against = arg('--against')
const seed = Number(arg('--seed') ?? 1)
const out = arg('--out')
const CONTROLS = ['softness', 'mood', 'intensity']
const NAMES = { softness: 'Softness', mood: 'Horizon', intensity: 'Intensity' }
const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '-')

if (against) makeLookCopy(path.resolve(against))
const harness = await startHarness()
const { composeScene } = await harness.ssr('/src/light/compose.ts')
const { getPack } = await harness.ssr('/src/light/color/packs.ts')
const { resolveScene, recipeContext } = await harness.ssr('/src/light/engine/resolve.ts')
const controlsAt = (control, value) => ({ intensity: 0.5, softness: 0.5, mood: 0.5, [control]: value })

// the first step can include the look's one-time work; the drag is the steps after it
const summary = (times) => {
  const drag = times.slice(1).sort((p, q) => p - q)
  return { median: drag[Math.floor(drag.length / 2)], max: drag[drag.length - 1], first: times[0] }
}
const results = {}
for (const [name, file, exp] of LOOKS) {
  const versions = [['now', (await harness.ssr('/src/light/recipes/sunset/' + file))[exp]]]
  if (against) versions.push(['then', (await harness.ssr(COPY_URL + file))[exp]])
  for (const [format, w, h] of FORMATS) {
    for (const control of CONTROLS) {
      const times = Object.fromEntries(versions.map(([tag]) => [tag, []]))
      for (let k = 0; k <= 30; k++) {
        const value = 0.2 + (0.6 * k) / 30
        // alternate which version goes first
        for (const [tag, recipe] of k % 2 ? versions.slice().reverse() : versions) {
          const scene = composeScene(recipe, { pack: getPack('bold'), controls: controlsAt(control, value), seed, aspect: w / h })
          const ctx = recipeContext(resolveScene(recipe, scene), w / h)
          const t0 = performance.now()
          recipe.uniforms(ctx)
          times[tag].push(performance.now() - t0)
        }
      }
      const entry = Object.fromEntries(Object.entries(times).map(([tag, t]) => [tag, summary(t)]))
      results[`${name} ${format} ${NAMES[control]}`] = entry
      const text = (s) => `median ${f(s.median)} ms, worst ${f(s.max)} ms (first ${f(s.first)} ms)`
      console.log(
        `${name.padEnd(6)} ${format} ${NAMES[control].padEnd(9)} per step: ${text(entry.now)}${entry.then ? `   |   other library: ${text(entry.then)}` : ''}`,
      )
    }
  }
}
if (out) fs.writeFileSync(out, JSON.stringify(results, null, 1))
await harness.close()
