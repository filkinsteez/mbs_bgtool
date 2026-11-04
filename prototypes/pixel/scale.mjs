// Do preview and export show the same cells? Renders frames at the export size and at smaller sizes, shrinks the
// export to each smaller size in linear light and reports the Oklab distance to the smaller render, for the frame
// without filters (the engine's own difference) and with Pixel. Writes a sheet per frame: the preview, the export
// shrunk to the preview's size, and a 1:1 crop of the export.
//
//   node prototypes/pixel/scale.mjs [--frames blooms-bold-s1,rim-bold-s1] [--export 3840x2160] [--sizes 960x540,1920x1080]
//     [--strength 1]
import fs from 'node:fs/promises'
import path from 'node:path'
import { list, parseArgs, parseSize } from '../../scripts/light/lib/args.mjs'
import { ROOT } from '../../scripts/light/lib/harness.mjs'
import { openPixelPage } from './lib/engine.mjs'
import { busiestWindow, crop, fromRgba, oklabDistance, shrink, toSharp } from './lib/image.mjs'
import { CAPTION, captioned, grid } from './lib/sheet.mjs'

const args = parseArgs(process.argv.slice(2))
const or = (values, fallback) => (values.length > 0 ? values : fallback)
const frames = or(list(args.frames), ['blooms-bold-s1', 'beam-elemental-s1', 'rim-bold-s1', 'streaks-atmospheric-s1'])
const big = parseSize(typeof args.export === 'string' ? args.export : '3840x2160')
const sizes = or(list(args.sizes), ['960x540', '1920x1080']).map(parseSize)
const strength = Number(args.strength ?? 1)
const outDir = path.join(ROOT, 'prototypes/pixel/out/scale')
await fs.mkdir(outDir, { recursive: true })

const f4 = (v) => v.toFixed(4)
const page = await openPixelPage()
const report = []
try {
  for (const frame of frames) {
    const [, look, pack, seed] = /^(\w+)-(\w+)-s(\d+)$/.exec(frame)
    const renders = []
    for (const size of [big, ...sizes]) {
      const { scene, failure } = await page.compose(look, pack, Number(seed), size.width, size.height)
      if (!scene) throw new Error(`${frame}: ${failure}`)
      const { input, outputs } = await page.render(scene, size.width, size.height, [strength], `scale-${frame}-${size.width}`)
      renders.push({ size, input: fromRgba(input, size.width, size.height), output: fromRgba(outputs.get(strength), size.width, size.height) })
    }
    const [exported, ...smaller] = renders
    const row = []
    for (const { size, input, output } of smaller) {
      const factor = big.width / size.width
      const plain = oklabDistance(shrink(exported.input, factor).data, input.data)
      const pixel = oklabDistance(shrink(exported.output, factor).data, output.data)
      report.push(
        `${frame}  ${big.width}x${big.height} shrunk ${factor}x vs ${size.width}x${size.height}: ` +
          `without filters mean ${f4(plain.mean)} p95 ${f4(plain.p95)}; Pixel at ${strength} mean ${f4(pixel.mean)} p95 ${f4(pixel.p95)} max ${f4(pixel.max)}`,
      )
      console.log(report.at(-1))
    }
    const preview = smaller[0]
    const factor = big.width / preview.size.width
    const w = preview.size.width
    const h = preview.size.height
    row.push(await captioned(await toSharp(preview.output).png().toBuffer(), `preview ${w}x${h}, 1:1`, w, h))
    row.push(await captioned(await toSharp(shrink(exported.output, factor)).png().toBuffer(), `export ${big.width}x${big.height} shrunk ${factor}x`, w, h))
    const [x0, y0] = busiestWindow(exported.input, w, h)
    row.push(await captioned(await toSharp(crop(exported.output, x0, y0, w, h)).png().toBuffer(), `export 1:1 crop at (${x0}, ${y0})`, w, h))
    await grid([row], { width: w, height: h + CAPTION }, { file: path.join(outDir, `${frame}.jpg`), title: `${frame}, Pixel at strength ${strength}: preview against export` })
  }
} finally {
  await page.close()
}
await fs.writeFile(path.join(outDir, 'report.txt'), `${report.join('\n')}\n`)
console.log(`wrote ${path.relative(ROOT, outDir)}`)
