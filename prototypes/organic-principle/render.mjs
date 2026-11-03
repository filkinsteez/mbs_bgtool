// Renders the principle: seeded sharp scene -> one lens blur in linear light -> tone curve.
// node prototypes/organic-principle/render.mjs [--packs bold,elemental] [--seeds 3,7,12]
//   [--formats 16x9,9x16] [--variant principle|plain] [--lens disc|gauss] [--size 960]
//   [--softness 0.5] [--intensity 0.5] [--horizon 0.5] [--tag name] [--scene]
// Writes out/proto/<tag>-<pack>-s<seed>-<format>.png (and -scene.png with --scene).
import fs from 'node:fs'
import path from 'node:path'
import { HERE } from './lib/targets.mjs'
import { composeScene, rasterize } from './lib/scene.mjs'
import { lensBlur, gaussBlurLike, tone } from './lib/lens.mjs'
import { saveLinear } from './lib/image.mjs'

const args = process.argv.slice(2)
const opt = (k, d) => {
  const i = args.indexOf(k)
  return i >= 0 ? args[i + 1] : d
}
const packs = opt('--packs', 'bold,elemental,atmospheric').split(',')
const seeds = opt('--seeds', '3,7,12').split(',').map(Number)
const formats = opt('--formats', '16x9,9x16').split(',')
const variant = opt('--variant', 'principle')
const layout = opt('--layout', 'horizon')
const lens = opt('--lens', 'disc')
const size = Number(opt('--size', '960'))
const softness = Number(opt('--softness', '0.5'))
const intensity = Number(opt('--intensity', '0.5'))
const horizon = Number(opt('--horizon', '0.5'))
const stretch = Number(opt('--stretch', '1.1'))
const rim = Number(opt('--rim', '0.35'))
const tag = opt('--tag', variant === 'principle' && lens === 'disc' ? 'p' : `${variant}-${lens}`)
const keepScene = args.includes('--scene')
const outDir = path.join(HERE, opt('--out', 'out/proto'))
fs.mkdirSync(outDir, { recursive: true })

for (const pack of packs) {
  for (const seed of seeds) {
    for (const f of formats) {
      const [a, b] = f.split('x').map(Number)
      const aspect = a / b
      const W = aspect >= 1 ? size : Math.round(size * aspect)
      const H = aspect >= 1 ? Math.round(size / aspect) : size
      const t0 = Date.now()
      const sc = composeScene({ pack, seed, aspect, softness, intensity, horizon, variant, layout })
      const scene = rasterize(sc, W, H, 2)
      const Rpx = sc.R * Math.min(W, H)
      const blurred = lens === 'gauss' ? gaussBlurLike(scene, Rpx) : lens === 'none' ? scene : lensBlur(scene, Rpx, { rim, stretch })
      const out = tone(blurred)
      const name = `${tag}-${pack}-s${seed}-${f}`
      await saveLinear(out, path.join(outDir, `${name}.png`))
      if (keepScene) await saveLinear(tone(scene), path.join(outDir, `${name}-scene.png`))
      console.log(name, W, H, `R ${Rpx.toFixed(1)} px`, `${Date.now() - t0} ms`, JSON.stringify({ lights: sc.lights.map((l) => l.kind).join(','), dark: sc.bands.some((b) => b.darkMass), bands: sc.bands.map((b) => b.hex).join(' ') }))
    }
  }
}
