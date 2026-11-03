// What a drag step costs in the tool's preview with the current boundary.ts and
// with another version of it: each step of a Softness, Horizon and Intensity drag
// (0.2 to 0.8 in 31 steps, Bold, seed 1) is composed and rendered at 1x through the
// engine at the tool's preview size (a 1440 x 900 window at device pixel ratio 2),
// waiting for the GPU, with the two versions in turn. The render time includes the
// look's uniforms, as the preview's does.
// node tools/preview-ab.mjs <other boundary.ts> [--out file.json]

import fs from 'node:fs'
import path from 'node:path'
import { startHarness } from '../../../scripts/light/lib/harness.mjs'
import { COPY_URL, LOOKS, makeLookCopy } from './look-copy.mjs'

const other = path.resolve(process.argv[2])
const outAt = process.argv.indexOf('--out')
const out = outAt > 0 ? process.argv[outAt + 1] : null
const SIZES = [
  ['16x9', 2152, 1210],
  ['9x16', 940, 1672],
]
const CONTROLS = [
  ['softness', 'Softness'],
  ['mood', 'Horizon'],
  ['intensity', 'Intensity'],
]
const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '-')
const quantile = (v, p) => {
  const s = v.slice().sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]
}
makeLookCopy(other)
const harness = await startHarness()
const results = {}
for (const [look, file, exp] of LOOKS) {
  for (const [format, w, h] of SIZES) {
    for (const [control, name] of CONTROLS) {
      // Sent as a string: this code runs in the page.
      const times = await harness.page.evaluate(`(async ({ file, exp, control, w, h, copy }) => {
        const { ProgramRenderer } = await import('/src/light/engine/programRenderer.ts')
        const { composeScene } = await import('/src/light/compose.ts')
        const { getPack } = await import('/src/light/color/packs.ts')
        const versions = [['now', (await import('/src/light/recipes/sunset/' + file))[exp]], ['then', (await import(copy + file))[exp]]]
        const renderer = new ProgramRenderer(document.createElement('canvas'))
        const times = { now: [], then: [] }
        for (let k = 0; k <= 30; k++) {
          const controls = { intensity: 0.5, softness: 0.5, mood: 0.5, [control]: 0.2 + (0.6 * k) / 30 }
          for (const [tag, program] of k % 2 ? versions.slice().reverse() : versions) {
            const scene = composeScene(program, { pack: getPack('bold'), controls, seed: 1, aspect: w / h })
            times[tag].push(renderer.renderProgram(program, scene, { width: w, height: h, supersample: 1, measure: true }).ms)
          }
        }
        renderer.dispose()
        return times
      })(${JSON.stringify({ file, exp, control, w, h, copy: COPY_URL })})`)
      const entry = {}
      for (const tag of ['now', 'then']) {
        const drag = times[tag].slice(1)
        entry[tag] = { median: quantile(drag, 0.5), p95: quantile(drag, 0.95), max: Math.max(...drag) }
      }
      results[`${look} ${format} ${name}`] = entry
      const text = (s) => `median ${f(s.median)} ms, 95% ${f(s.p95)} ms, worst ${f(s.max)} ms`
      console.log(`${look.padEnd(6)} ${format} ${name.padEnd(9)} per step: ${text(entry.now)}   |   other library: ${text(entry.then)}`)
    }
  }
}
if (out) fs.writeFileSync(out, JSON.stringify(results, null, 1))
await harness.close()
