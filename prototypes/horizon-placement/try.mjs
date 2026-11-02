// Quick look at a few sketches while tuning: node prototypes/horizon-placement/try.mjs -> out/try.png
import { writeFileSync } from 'node:fs'
import { encode, renderScene } from './lib/scene.mjs'
import { layout, tileFromRaw } from './lib/sheet.mjs'

const W = Number(process.env.W ?? 480)
const H = Number(process.env.H ?? 270)
const yellow = { light: '#FFD61E' }
const specs = [
  { pack: 'bold', horizon: 0.5, below: 'water', sunX: 0.72, seed: 3, roles: yellow },
  { pack: 'bold', horizon: 0.3, below: 'water', sunX: 0.72, seed: 3, roles: yellow },
  { pack: 'bold', horizon: 0.5, below: 'water', sunX: 0.72, seed: 3, roles: { ...yellow, water: ['#1FCDF0', 0.12] } },
  { pack: 'bold', horizon: 0.3, below: 'water', sunX: 0.72, seed: 3, roles: { ...yellow, water: ['#FF4F00', 0.25] } },
  { pack: 'bold', horizon: 0.5, below: 'bank', sunX: 0.72, seed: 3 },
  { pack: 'atmospheric', horizon: 0.5, below: 'bank', sunX: 0.6, seed: 9 },
  { pack: 'elemental', horizon: 0.5, below: 'water', sunX: 0.3, seed: 5 },
  { pack: 'bold', horizon: 0.7, below: 'water', sunX: 0.72, seed: 3 },
]
const tiles = []
for (const s of specs) {
  const buf = encode(renderScene(s, W, H), W, H)
  tiles.push({ buf: await tileFromRaw(buf, W, H), label: `${s.pack} ${s.below} ${s.horizon} ${s.roles ? JSON.stringify(s.roles) : ''}` })
}
const out = new URL('./out/try.png', import.meta.url).pathname
writeFileSync(out, await layout([{ tiles: tiles.slice(0, 4) }, { tiles: tiles.slice(4) }]))
console.log(out)
