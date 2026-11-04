// Renders the tool's scenes through the engine, runs the engine's output pass with the Pixel stage on them
// (prototypes/pixel/harness), and writes sheets: 1:1 crops at each strength, whole frames per look (three packs), and
// how far the GPU result is from the CPU prototype in 8-bit levels.
//
//   node prototypes/pixel/gpu.mjs [--looks ramp,rim] [--packs bold] [--seeds 1] [--size 1920x1080]
//     [--strengths 0.25,0.5,0.75,1] [--source frame|small] [--set gpu]
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { list, parseArgs, parseSize } from '../../scripts/light/lib/args.mjs'
import { ROOT } from '../../scripts/light/lib/harness.mjs'
import { LOOKS, openPixelPage } from './lib/engine.mjs'
import { busiestWindow, fromRgba, linearToSrgb, shrink, toSharp } from './lib/image.mjs'
import { led3 } from './lib/pixel.mjs'
import { CAPTION, captioned, grid } from './lib/sheet.mjs'
import { pixelSettings } from './sets.mjs'

const args = parseArgs(process.argv.slice(2))
const or = (values, fallback) => (values.length > 0 ? values : fallback)
const looks = or(list(args.looks), Object.keys(LOOKS))
const packs = or(list(args.packs), ['bold', 'elemental', 'atmospheric'])
const seeds = or(list(args.seeds), ['1']).map(Number)
const { width: W, height: H } = parseSize(typeof args.size === 'string' ? args.size : '1920x1080')
const strengths = or(list(args.strengths), ['0.25', '0.5', '0.75', '1']).map(Number)
const source = args.source === 'small' ? 'small' : 'frame'
const outDir = path.join(ROOT, 'prototypes/pixel/out', typeof args.set === 'string' ? args.set : 'gpu')
await fs.mkdir(outDir, { recursive: true })

const CW = Math.min(480, W)
const CH = Math.min(270, H)
const SHRINK = 3

/** 1:1 crop of 8-bit RGBA bytes as PNG, exactly as the engine wrote them. */
const cropPng = (rgba, x, y) =>
  sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).extract({ left: x, top: y, width: CW, height: CH }).removeAlpha().png().toBuffer()

/** Mean and 99th percentile of |GPU - CPU| in 8-bit sRGB levels. */
function levelsApart(gpuRgba, cpu) {
  const diffs = new Float32Array(W * H * 3)
  for (let i = 0; i < W * H; i++) {
    for (let c = 0; c < 3; c++) diffs[i * 3 + c] = Math.abs(gpuRgba[i * 4 + c] - linearToSrgb(Math.min(1, Math.max(0, cpu.data[i * 3 + c]))) * 255)
  }
  let sum = 0
  for (const d of diffs) sum += d
  const sorted = diffs.sort()
  return { mean: sum / diffs.length, p99: sorted[Math.floor(diffs.length * 0.99)] }
}

const page = await openPixelPage()
const report = []
try {
  for (const look of looks) {
    const fullRows = []
    for (const pack of packs) {
      for (const seed of seeds) {
        const name = `${look}-${pack}-s${seed}`
        const { scene, failure } = await page.compose(look, pack, seed, W, H)
        if (!scene) {
          report.push(`${name}  skipped: ${failure}`)
          console.log(report.at(-1))
          continue
        }
        const { ms, input: inputBytes, outputs } = await page.render(scene, W, H, strengths, `pixel-${name}`, source)
        const input = fromRgba(inputBytes, W, H)
        const checks = []
        for (const s of strengths.filter((v) => v === 0.5 || v === 1)) {
          const apart = levelsApart(outputs.get(s), led3(input, pixelSettings(s)))
          checks.push(`strength ${s}: mean ${apart.mean.toFixed(2)}, p99 ${apart.p99.toFixed(2)}`)
        }
        report.push(`${name}  ${ms.toFixed(0)} ms  GPU vs CPU in 8-bit levels, ${checks.join('; ')}`)
        console.log(report.at(-1))

        const [x0, y0] = busiestWindow(input, CW, CH)
        const tiles = [await captioned(await cropPng(inputBytes, x0, y0), 'off', CW, CH)]
        for (const s of strengths) tiles.push(await captioned(await cropPng(outputs.get(s), x0, y0), `strength ${s}`, CW, CH))
        const rows = []
        for (let i = 0; i < tiles.length; i += 3) rows.push(tiles.slice(i, i + 3))
        await grid(rows, { width: CW, height: CH + CAPTION }, { file: path.join(outDir, `${name}-crops.png`), title: `${name}, engine output pass, 1:1 crop at (${x0}, ${y0}) of ${W}x${H}` })

        const row = []
        for (const s of [0, 0.5, 1].filter((v) => v === 0 || outputs.has(v))) {
          const img = s === 0 ? input : fromRgba(outputs.get(s), W, H)
          row.push(await captioned(await toSharp(shrink(img, SHRINK)).png().toBuffer(), `${name}, ${s === 0 ? 'off' : `strength ${s}`}`, W / SHRINK, H / SHRINK))
        }
        fullRows.push(row)
      }
    }
    if (fullRows.length === 0) continue
    await grid(fullRows, { width: W / SHRINK, height: H / SHRINK + CAPTION }, { file: path.join(outDir, `${look}-frames.jpg`), title: `${look}: whole ${W}x${H} frames shrunk ${SHRINK}x in linear light, engine output pass` })
  }
} finally {
  await page.close()
}
await fs.writeFile(path.join(outDir, 'report.txt'), `${report.join('\n')}\n`)
console.log(`wrote ${path.relative(ROOT, outDir)}`)
