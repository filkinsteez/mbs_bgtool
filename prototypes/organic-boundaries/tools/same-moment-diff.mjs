// Renders the three Sunset looks with the current boundary.ts and with another
// version of it, in the same browser session and with the same look code, and
// reports the largest pixel difference. The other version runs from a copy of the
// looks' folder in out/ (the production files are not touched).
// node tools/same-moment-diff.mjs <other boundary.ts> [<out dir>]
// ONLY=<regex> renders only the cases whose key matches, e.g. ONLY=ramp-bold-16x9.
// SEEDS=1,2,3 picks the seeds (1 by default); the default frames of seed 1 are saved.

import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { startHarness } from '../../../scripts/light/lib/harness.mjs'
import { PROTO } from '../lib/refs.mjs'
import { COPY_URL, FORMATS, LOOKS, lookCases, makeLookCopy } from './look-copy.mjs'

const other = path.resolve(process.argv[2])
const outDir = path.resolve(process.argv[3] ?? path.join(PROTO, 'out/same-moment'))
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null
const seeds = (process.env.SEEDS ?? '1').split(',').map(Number)
makeLookCopy(other)
fs.mkdirSync(outDir, { recursive: true })

const harness = await startHarness()
let worst = 0
let total = 0
let differing = 0
for (const [look, file, exp] of LOOKS) {
  for (const pack of ['bold', 'elemental', 'atmospheric']) {
    for (const [format, w, h] of FORMATS) {
      for (const seed of seeds) {
        for (const [control, value] of lookCases()) {
          const controls = { intensity: 0.5, softness: 0.5, mood: 0.5, ...(control === 'default' ? {} : { [control]: value }) }
          const key = `${look}-${pack}-${format}-s${seed}-${control}-${value}`
          if (only && !only.test(key)) continue
          // Sent as a string: this code runs in the page.
          await harness.page.evaluate(`(async ({ file, exp, pack, controls, seed, w, h, key, copy }) => {
            const { ProgramRenderer } = await import('/src/light/engine/programRenderer.ts')
            const { composeScene } = await import('/src/light/compose.ts')
            const { getPack } = await import('/src/light/color/packs.ts')
            const now = (await import('/src/light/recipes/sunset/' + file))[exp]
            const then = (await import(copy + file))[exp]
            const scene = composeScene(now, { pack: getPack(pack), controls, seed, aspect: w / h })
            scene.output = { ...(scene.output ?? {}), grain: 0 }
            const renderer = new ProgramRenderer(document.createElement('canvas'))
            for (const [tag, program] of [['now', now], ['then', then]]) {
              renderer.renderProgram(program, scene, { width: w, height: h, supersample: 1, dither: false })
              await fetch('/__light/upload/' + key + '-' + tag, { method: 'POST', body: new Blob([renderer.readPixels()]) })
            }
            renderer.dispose()
          })(${JSON.stringify({ file, exp, pack, controls, seed, w, h, key, copy: COPY_URL })})`)
          const a = harness.takeUpload(`${key}-now`)
          const b = harness.takeUpload(`${key}-then`)
          let m = 0
          for (let i = 0; i < a.length; i++) if (i % 4 !== 3) m = Math.max(m, Math.abs(a[i] - b[i]))
          total++
          if (m > 0) {
            differing++
            console.log(`${key}: largest difference ${m}`)
          }
          worst = Math.max(worst, m)
          if (control === 'default' && seed === seeds[0]) {
            const rgb = Buffer.alloc(w * h * 3)
            for (let i = 0; i < w * h; i++) for (let q = 0; q < 3; q++) rgb[i * 3 + q] = a[i * 4 + q]
            await sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).png().toFile(path.join(outDir, `${key}.png`))
          }
        }
      }
    }
  }
}
console.log(`${total} frames rendered both ways: largest difference ${worst} code values, ${differing} frames differ at all`)
await harness.close()
