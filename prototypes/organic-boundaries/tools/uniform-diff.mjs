// Computes the three Sunset looks' shader uniforms with the current boundary.ts
// and with another version of it (from a copy of the looks' folder), for every
// pack, both formats, several seeds and each control at four values, and reports
// the largest difference. Also counts the cases with a silhouette edge (dark far
// side), so it is clear that path was compared too.
// node tools/uniform-diff.mjs <other boundary.ts> [seeds, default 1-8]

import path from 'node:path'
import { startHarness } from '../../../scripts/light/lib/harness.mjs'
import { COPY_URL, FORMATS, LOOKS, lookCases, makeLookCopy } from './look-copy.mjs'

const other = path.resolve(process.argv[2])
const seedCount = Number(process.argv[3] ?? 8)
makeLookCopy(other)

const harness = await startHarness()
const { composeScene } = await harness.ssr('/src/light/compose.ts')
const { getPack } = await harness.ssr('/src/light/color/packs.ts')
const { resolveScene, recipeContext } = await harness.ssr('/src/light/engine/resolve.ts')

const numbers = (value) => [value].flat(Infinity).filter((x) => typeof x === 'number')
for (const [look, file, exp] of LOOKS) {
  let compared = 0
  let withDark = 0
  let worst = 0
  let worstAt = ''
  try {
    const now = (await harness.ssr('/src/light/recipes/sunset/' + file))[exp]
    const then = (await harness.ssr(COPY_URL + file))[exp]
    for (const pack of ['bold', 'elemental', 'atmospheric']) {
      for (const [format, w, h] of FORMATS) {
        for (let seed = 1; seed <= seedCount; seed++) {
          for (const [control, value] of lookCases()) {
            const controls = { intensity: 0.5, softness: 0.5, mood: 0.5, ...(control === 'default' ? {} : { [control]: value }) }
            const scene = composeScene(now, { pack: getPack(pack), controls, seed, aspect: w / h })
            const a = now.uniforms(recipeContext(resolveScene(now, scene), w / h))
            const b = then.uniforms(recipeContext(resolveScene(then, scene), w / h))
            const dark = numbers(a.uBndDark ?? [])
            if (dark.some((k, i) => i % 4 === 0 && k > 0)) withDark++
            for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
              const x = numbers(a[name])
              const y = numbers(b[name])
              const d = x.length !== y.length ? Infinity : Math.max(0, ...x.map((v, i) => Math.abs(v - y[i])))
              if (d > worst) {
                worst = d
                worstAt = `${name} in ${pack} ${format} seed ${seed} ${control} ${value}`
              }
            }
            compared++
          }
        }
      }
    }
    console.log(`${look}: ${compared} cases (${withDark} with a silhouette edge), largest uniform difference ${worst}${worst > 0 ? ` (${worstAt})` : ''}`)
  } catch (error) {
    console.log(`${look}: could not run (${error.message})`)
  }
}
await harness.close()
