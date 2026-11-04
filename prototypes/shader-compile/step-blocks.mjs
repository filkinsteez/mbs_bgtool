// Where one control step changes the image most: renders a look at two Softness values (the control sweep's size,
// 320x180 at 2x) and prints the 10x10 blocks with the largest mean change (8-bit values), and writes a 4x diff map.
// Usage: node step-blocks.mjs --look contour.halo --pack bold --seed 4 --a 0.02 --b 0.03 [--root <repo>] [--out f.png]
import path from 'node:path'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []),
)
const root = args.root ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const { startHarness } = await import(path.join(root, 'scripts/light/lib/harness.mjs'))
const sharp = (await import(path.join(root, 'node_modules/sharp/lib/index.js'))).default
const [width, height, supersample] = [320, 180, 2]
const harness = await startHarness()
let images
try {
  const { buildScene } = await harness.ssr('/src/tool/controls.ts')
  const { getPack } = await harness.ssr('/src/light/color/packs.ts')
  const look = args.look ?? 'contour.halo'
  images = []
  for (const softness of [Number(args.a), Number(args.b)]) {
    const scene = { ...buildScene(look, getPack(args.pack ?? 'bold'), Number(args.seed ?? 4), { intensity: 0.5, softness, mood: 0.5 }, width / height), recipe: look }
    images.push((await harness.render({ scene, width, height, supersample })).data)
  }
} finally {
  await harness.close()
}
const [a, b] = images
const diff = new Uint8Array(width * height)
const blocks = []
for (let by = 0; by < height; by += 10) {
  for (let bx = 0; bx < width; bx += 10) {
    let sum = 0
    for (let y = by; y < by + 10; y++) {
      for (let x = bx; x < bx + 10; x++) {
        const p = (y * width + x) * 4
        const d = (Math.abs(a[p] - b[p]) + Math.abs(a[p + 1] - b[p + 1]) + Math.abs(a[p + 2] - b[p + 2])) / 3
        diff[y * width + x] = Math.min(255, Math.round(d * 40))
        sum += d
      }
    }
    blocks.push({ x: bx, y: by, mean: sum / 100 })
  }
}
blocks.sort((p, q) => q.mean - p.mean)
console.log(`largest block changes: ${blocks.slice(0, 6).map((k) => `(${k.x},${k.y}) ${k.mean.toFixed(2)}`).join(', ')}; median block ${blocks[Math.floor(blocks.length / 2)].mean.toFixed(3)}`)

// The control sweep's measure: frames averaged down 2x (to 160x90), Oklab ΔE per pixel, 10x10 blocks.
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const oklab = (rgb) => {
  const [r, g, bl] = rgb.map((v) => toLinear(v / 255))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}
const half = (img, x, y) => [0, 1, 2].map((c) => (img[((2 * y) * width + 2 * x) * 4 + c] + img[((2 * y) * width + 2 * x + 1) * 4 + c] + img[((2 * y + 1) * width + 2 * x) * 4 + c] + img[((2 * y + 1) * width + 2 * x + 1) * 4 + c]) / 4)
const labBlocks = []
for (let by = 0; by < height / 2; by += 10) {
  for (let bx = 0; bx < width / 2; bx += 10) {
    let sum = 0
    for (let y = by; y < Math.min(by + 10, height / 2); y++) {
      for (let x = bx; x < bx + 10; x++) {
        const p = oklab(half(a, x, y))
        const q = oklab(half(b, x, y))
        sum += Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
      }
    }
    labBlocks.push({ x: bx, y: by, mean: sum / (10 * Math.min(10, height / 2 - by)) })
  }
}
labBlocks.sort((p, q) => q.mean - p.mean)
console.log(`Oklab blocks at 160x90: ${labBlocks.slice(0, 4).map((k) => `(${k.x},${k.y}) ${k.mean.toFixed(4)}`).join(', ')}`)
if (args.out) await sharp(diff, { raw: { width, height, channels: 1 } }).resize(width * 2, height * 2, { kernel: 'nearest' }).png().toFile(args.out)
