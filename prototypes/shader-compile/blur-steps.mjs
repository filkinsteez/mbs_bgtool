// Steps in a gaussian scatter blur as its radius grows: renders test.scatterlens.gauss (sharp bands through one
// gaussian scatter blur of 0.53 R, shown as the whole frame) at R from --from to --to in --step, and prints each
// step's mean and largest change (8-bit values) and how many times the median step it is.
// Usage: node blur-steps.mjs [--from 0.03] [--to 0.2] [--step 0.0005] [--size 960x540] [--ss 2] [--root <repo>] [--out f]
import { writeFileSync } from 'node:fs'
import path from 'node:path'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []),
)
const root = args.root ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const { startHarness } = await import(path.join(root, 'scripts/light/lib/harness.mjs'))
const from = Number(args.from ?? 0.03)
const to = Number(args.to ?? 0.2)
const step = Number(args.step ?? 0.0005)
const [width, height] = (args.size ?? '960x540').split('x').map(Number)
const supersample = Number(args.ss ?? 2)
const program = args.program ?? 'test.scatterlens.gauss'
const param = args.param ?? 'R'

const harness = await startHarness()
const rows = []
try {
  let previous = null
  for (let i = 0; from + i * step <= to + 1e-9; i++) {
    const R = Number((from + i * step).toFixed(6))
    const image = await harness.render({ scene: { program, seed: 1, colors: [], params: { [param]: R }, lens: {}, output: { grain: 0 } }, width, height, supersample, dither: false })
    if (previous) {
      let sum = 0
      let max = 0
      for (let p = 0; p < image.data.length; p += 4) {
        for (let c = 0; c < 3; c++) {
          const d = Math.abs(image.data[p + c] - previous.data[p + c])
          sum += d
          if (d > max) max = d
        }
      }
      rows.push({ R, mean: sum / ((image.data.length / 4) * 3), max })
    }
    previous = image
  }
} finally {
  await harness.close()
}
const sorted = rows.map((r) => r.mean).sort((a, b) => a - b)
const median = sorted[Math.floor(sorted.length / 2)]
for (const [i, row] of rows.entries()) {
  const near = rows.slice(Math.max(0, i - 3), i + 4).filter((_, j) => j !== Math.min(i, 3)).map((r) => r.mean)
  row.ratio = row.mean / Math.max(1e-9, near.sort((a, b) => a - b)[Math.floor(near.length / 2)])
}
const flagged = rows.filter((r) => r.ratio > 2)
console.log(`${program} ${width}x${height}@${supersample}, R ${from}..${to} step ${step}: ${rows.length} steps, median mean change ${median.toFixed(4)}`)
for (const r of flagged) console.log(`  R ${(r.R - step).toFixed(4)}-${r.R.toFixed(4)}: mean ${r.mean.toFixed(4)} (${r.ratio.toFixed(1)}x its neighbours), max ${r.max}`)
if (args.out) writeFileSync(args.out, JSON.stringify(rows, null, 1))
