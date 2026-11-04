// The poster's texture strength per band, in the grain measurement's units (scripts/light/lib/grain.mjs).
import sharp from 'sharp'
import { measureGrain } from '../../scripts/light/lib/grain.mjs'

const root = new URL('../../', import.meta.url).pathname
const file = process.argv[2] ?? `${root}public/references/awe/sunset/sunset-film-poster-bands-full.png`
const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const w = info.width
const crop = (y0, y1) => {
  const x0 = 64
  const cw = w - 128
  const out = new Uint8Array(cw * (y1 - y0) * 4)
  for (let y = y0; y < y1; y++) out.set(data.subarray((y * w + x0) * 4, (y * w + x0 + cw) * 4), (y - y0) * cw * 4)
  return { width: cw, height: y1 - y0, data: out }
}
const pct = (v) => (v * 100).toFixed(2)
for (const [name, y0, y1] of [
  ['top red', 0, 90],
  ['near black', 110, 270],
  ['plum', 270, 390],
  ['blue', 410, 620],
  ['grey', 630, 820],
  ['warm grey', 820, 960],
  ['red', 965, 1080],
]) {
  const m = measureGrain(crop(y0, y1), { hpSigma: 0.0065 * w, minBin: 300 })
  console.log(
    `${name.padEnd(11)} L ${m.meanL.toFixed(2)}: L std ${pct(m.stdL)} %, luma ${m.stdY.toFixed(2)} code values, half width ${m.acfHalf.toFixed(2)} px, high-frequency share ${m.spectrum ? m.spectrum.highShare.toFixed(2) : '-'}, mono ${m.mono.toFixed(2)}, skew ${m.skew.toFixed(2)}, measured ${(m.usedShare * 100).toFixed(0)} %`,
  )
}
