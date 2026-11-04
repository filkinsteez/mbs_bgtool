// Grain strength 0..1 in 0.01 steps on Ramp, Bands and Halo (Bold, seed 3, controls at 0.5) at 960x540, 2x: the mean
// Oklab ΔE of each step at full resolution and how many times the median of the 12 steps around it it is (the control
// sweep's rule flags 4 times). Usage: node prototypes/grain-amount/sweep.mjs [--root <repo copy>]
import path from 'node:path'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []),
)
const root = args.root ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const { startHarness } = await import(path.join(root, 'scripts/light/lib/harness.mjs'))
const [width, height] = [960, 540]
const LOOKS = ['sunset.ramp', 'sunset.bands', 'contour.halo']

const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const LUT = Array.from({ length: 256 }, (_, v) => lin(v / 255))
function oklab(data) {
  const out = new Float32Array((data.length / 4) * 3)
  for (let p = 0, q = 0; p < data.length; p += 4, q += 3) {
    const [r, g, b] = [LUT[data[p]], LUT[data[p + 1]], LUT[data[p + 2]]]
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    out[q] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
    out[q + 1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
    out[q + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  }
  return out
}
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

const harness = await startHarness()
try {
  const { buildScene } = await harness.ssr('/src/tool/controls.ts')
  const { getPack } = await harness.ssr('/src/light/color/packs.ts')
  for (const look of LOOKS) {
    const scene = { ...buildScene(look, getPack('bold'), 3, { intensity: 0.5, softness: 0.5, mood: 0.5 }, width / height), recipe: look }
    const steps = []
    let previous = null
    for (let i = 0; i <= 100; i++) {
      const image = await harness.render({ scene: { ...scene, output: { ...scene.output, grain: i / 100 } }, width, height, supersample: 2 })
      const lab = oklab(image.data)
      if (previous) {
        let sum = 0
        for (let q = 0; q < lab.length; q += 3) sum += Math.hypot(lab[q] - previous[q], lab[q + 1] - previous[q + 1], lab[q + 2] - previous[q + 2])
        steps.push(sum / (lab.length / 3))
      }
      previous = lab
    }
    const ratios = steps.map((step, i) => step / median(steps.filter((_, j) => j !== i && Math.abs(j - i) <= 6)))
    const worst = ratios.reduce((best, r, i) => (r > ratios[best] ? i : best), 0)
    const at = (from) => steps.slice(from, from + 10).reduce((a, b) => a + b, 0)
    console.log(
      `${look.padEnd(14)} largest step ${steps[worst].toFixed(5)} at ${(worst / 100).toFixed(2)}-${((worst + 1) / 100).toFixed(2)}, ${ratios[worst].toFixed(2)}x the steps around it; ` +
        `steps over 4x: ${ratios.filter((r) => r >= 4).length}; change per 0.1: ${[0, 10, 20, 30, 40, 50, 60, 70, 80, 90].map((f) => at(f).toFixed(4)).join(' ')}`,
    )
  }
} finally {
  await harness.close()
}
