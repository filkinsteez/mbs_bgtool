// Prints display-linear values along a row of a frame, before and after the filter, to check the LED shape.
//
//   node prototypes/pixel/probe.mjs --frame beam-elemental-s1 --row 585 --from 630 --to 735 [--strength 1]
import path from 'node:path'
import { parseArgs } from '../../scripts/light/lib/args.mjs'
import { loadLinear } from './lib/image.mjs'
import { led3 } from './lib/pixel.mjs'
import { pixelSettings } from './sets.mjs'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const args = parseArgs(process.argv.slice(2))
const frame = String(args.frame ?? 'beam-elemental-s1')
const row = Number(args.row ?? 585)
const from = Number(args.from ?? 630)
const to = Number(args.to ?? 735)
const step = Number(args.step ?? 3)
const strength = Number(args.strength ?? 1)
const img = await loadLinear(path.join(HERE, 'out', 'frames', `${frame}-1920x1080.png`))
const parts = {
  out: led3(img, pixelSettings(strength)),
  flat: led3(img, pixelSettings(strength, { halo: 0, contrast: 0 })),
  led: led3(img, pixelSettings(strength, { halo: 0 })),
  glow: led3(img, pixelSettings(strength, { halo: 1 })),
}
const fmt = (d, x) => {
  const k = (row * img.w + x) * 3
  return [d[k], d[k + 1], d[k + 2]].map((v) => v.toFixed(3)).join(' ')
}
console.log(`x     image               flat                led                 glow                out`)
for (let x = from; x <= to; x += step) {
  console.log(`${String(x).padEnd(5)} ${fmt(img.data, x)}   ${fmt(parts.flat.data, x)}   ${fmt(parts.led.data, x)}   ${fmt(parts.glow.data, x)}   ${fmt(parts.out.data, x)}`)
}
