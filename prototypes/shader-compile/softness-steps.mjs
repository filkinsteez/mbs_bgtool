// Fine Softness sweep of one look, pack and seed through the harness at the control sweep's size (320x180 at 2x):
// each step's mean change (8-bit values) and how many times its neighbours' it is, plus the scatter blur widths
// the scene asks for. Usage: node softness-steps.mjs --look contour.halo --pack atmospheric --seed 3
//   [--from 0.07] [--to 0.11] [--step 0.001] [--size 320x180] [--ss 2] [--root <repo>]
import path from 'node:path'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []),
)
const root = args.root ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const { startHarness } = await import(path.join(root, 'scripts/light/lib/harness.mjs'))
const look = args.look ?? 'contour.halo'
const pack = args.pack ?? 'atmospheric'
const seed = Number(args.seed ?? 3)
const from = Number(args.from ?? 0.07)
const to = Number(args.to ?? 0.11)
const step = Number(args.step ?? 0.001)
const [width, height] = (args.size ?? '320x180').split('x').map(Number)
const supersample = Number(args.ss ?? 2)

// The control sweep's block measure: frames averaged down 2x, Oklab ΔE per pixel, the worst 10x10 block's mean.
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const oklab = (r, g, b) => {
  const [lr, lg, lb] = [r, g, b].map((v) => toLinear(v / 255))
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}
function worstBlock(a, b) {
  const hw = width / 2
  const hh = height / 2
  const at = (img, x, y) => [0, 1, 2].map((c) => (img[(2 * y * width + 2 * x) * 4 + c] + img[(2 * y * width + 2 * x + 1) * 4 + c] + img[((2 * y + 1) * width + 2 * x) * 4 + c] + img[((2 * y + 1) * width + 2 * x + 1) * 4 + c]) / 4)
  let worst = { value: 0, x: 0, y: 0 }
  for (let by = 0; by < hh; by += 10) {
    for (let bx = 0; bx < hw; bx += 10) {
      let sum = 0
      let n = 0
      for (let y = by; y < Math.min(by + 10, hh); y++) {
        for (let x = bx; x < Math.min(bx + 10, hw); x++) {
          const p = oklab(...at(a, x, y))
          const q = oklab(...at(b, x, y))
          sum += Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
          n++
        }
      }
      if (sum / n > worst.value) worst = { value: sum / n, x: bx, y: by }
    }
  }
  return worst
}

const harness = await startHarness()
const rows = []
try {
  const { buildScene } = await harness.ssr('/src/tool/controls.ts')
  const { getPack } = await harness.ssr('/src/light/color/packs.ts')
  const { getRecipe } = await harness.ssr('/src/light/recipes/index.ts')
  const { recipeContext, resolveScene } = await harness.ssr('/src/light/engine/resolve.ts')
  const recipe = getRecipe(look)
  let previous = null
  for (let i = 0; from + i * step <= to + 1e-9; i++) {
    const softness = Number((from + i * step).toFixed(6))
    const scene = { ...buildScene(look, getPack(pack), seed, { intensity: 0.5, softness, mood: 0.5 }, width / height), recipe: look }
    const ctx = recipeContext(resolveScene(recipe, scene), width / height)
    const radii = (recipe.scatter ?? []).map((blur) => blur.radius(ctx))
    const image = await harness.render({ scene, width, height, supersample })
    if (previous) {
      let sum = 0
      for (let p = 0; p < image.data.length; p += 4) for (let c = 0; c < 3; c++) sum += Math.abs(image.data[p + c] - previous.data[p + c])
      rows.push({ softness, mean: sum / ((image.data.length / 4) * 3), radii, block: worstBlock(image.data, previous.data) })
    }
    previous = image
  }
} finally {
  await harness.close()
}
for (const [i, row] of rows.entries()) {
  const near = rows.filter((_, j) => j !== i && Math.abs(j - i) <= 3).map((r) => r.mean).sort((a, b) => a - b)
  row.ratio = row.mean / Math.max(1e-9, near[Math.floor(near.length / 2)])
}
console.log(`${look} ${pack} seed ${seed}, ${width}x${height}@${supersample}, Softness ${from}..${to} step ${step}`)
// The shared working size runScatter picks (scatter.ts: MIN_BLUR_PIXELS 4, short sides 256..1024, at most the render's).
const renderShort = Math.min(width, height) * supersample
const working = (radii) => {
  const positive = radii.filter((r) => r > 0)
  const smallest = positive.length ? Math.min(...positive) : 1
  return Math.min(renderShort, Math.min(1024, Math.max(256, Math.ceil(4 / smallest))))
}
for (const row of rows) {
  const mark = row.ratio > 1.8 ? '  <--' : ''
  const short = working(row.radii)
  console.log(`  ${(row.softness - step).toFixed(3)}-${row.softness.toFixed(3)}: mean ${row.mean.toFixed(4)} (${row.ratio.toFixed(2)}x)  worst block ${row.block.value.toFixed(4)} at (${row.block.x},${row.block.y})  old working side ${short}${mark}`)
}
