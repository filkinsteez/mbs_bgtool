// The ASCII slider as density (rows on the short side, 13 at 0, 26 at 0.5, 52 at 1). Renders through the engine's
// chain from a copy of src/light at HEAD with the working tree's ASCII files on top, and writes:
//   out/density/sheet-full.jpg    Ramp, Halo, Beam at 0, 0.25, 0.5, 0.75, 1 (1920 x 1080 frames, shown 480 wide)
//   out/density/sheet-crops.jpg   the same at 1:1 (1080p), with the Figma tile at its own 26 rows
//   out/density/sheet-4k.jpg      1:1 crops of the 4K export at 0 and 1
//   out/density/sweep.json        change per 0.01 step of a 0..1 sweep (960 x 540), and where the row count steps
// The chain leaves a stage out at exactly 0, so 0 renders as 0.0001 (13 rows).
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { OUT, ROOT, startPrototype } from './lib/server.mjs'

const LOOKS = [
  { name: 'ramp-bold-s1', recipe: 'sunset.ramp', pack: 'bold', seed: 1, crop: [1100, 700] },
  { name: 'halo-elemental-s2', recipe: 'contour.halo', pack: 'elemental', seed: 2, crop: [1150, 640] },
  { name: 'beam-atmospheric-s1', recipe: 'contour.beam', pack: 'atmospheric', seed: 1, crop: [640, 300] },
]
const DENSITIES = [0, 0.25, 0.5, 0.75, 1]
const rowsAt = (d) => Math.round(13 * 4 ** Math.min(1, Math.max(0, d)))
const dir = path.join(OUT, 'density')
fs.mkdirSync(dir, { recursive: true })

async function caption(input, width, text) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="24"><rect width="100%" height="100%" fill="#111"/><text x="6" y="17" font-family="Menlo" font-size="13" fill="#ddd">${text}</text></svg>`
  const meta = await sharp(input).metadata()
  return sharp({ create: { width, height: meta.height + 24, channels: 3, background: '#111' } })
    .composite([
      { input: Buffer.from(svg), left: 0, top: 0 },
      { input: await sharp(input).png().toBuffer(), left: 0, top: 24 },
    ])
    .png()
    .toBuffer()
}

async function grid(cells, columns, cellW, gap = 6) {
  const metas = await Promise.all(cells.map((c) => sharp(c).metadata()))
  const rowH = Math.max(...metas.map((m) => m.height))
  const rows = Math.ceil(cells.length / columns)
  return sharp({ create: { width: columns * cellW + (columns - 1) * gap, height: rows * rowH + (rows - 1) * gap, channels: 3, background: '#000' } })
    .composite(cells.map((input, i) => ({ input, left: (i % columns) * (cellW + gap), top: Math.floor(i / columns) * (rowH + gap) })))
    .png()
    .toBuffer()
}

const proto = await startPrototype()
try {
  const compiled = await proto.call('compileEnginePass')
  if (!compiled.ok) throw new Error(`output pass with ASCII does not compile:\n${compiled.log}`)

  const render = async (look, width, height, density) => {
    const key = proto.nextKey('density')
    await proto.call('renderFrame', { ...look, width, height, supersample: 2, output: { ascii: Math.max(density, 1e-4) }, key })
    return sharp(proto.take(key), { raw: { width, height, channels: 4 } }).removeAlpha().png().toBuffer()
  }

  const CW = 480
  const CH = 300
  const tile = await sharp(path.join(ROOT, 'artifacts/ascii/figma/44-275-ascii-tile-4x.png'))
    .flatten({ background: '#fff' })
    .resize({ width: Math.round((2176 * (1080 / 26)) / 67.6) })
    .png()
    .toBuffer()
  const tileMeta = await sharp(tile).metadata()
  const tileCrop = await caption(await sharp(tile).extract({ left: 20, top: tileMeta.height - CH - 10, width: CW, height: CH }).png().toBuffer(), CW, 'Figma 44:275 at 1080p (26 rows)')

  const full = []
  const crops = []
  for (const look of LOOKS) {
    for (const d of DENSITIES) {
      const png = await render(look, 1920, 1080, d)
      full.push(await caption(await sharp(png).resize({ width: CW }).png().toBuffer(), CW, `${look.name} ${d} (${rowsAt(d)} rows)`))
      const [x, y] = look.crop
      crops.push(await caption(await sharp(png).extract({ left: x, top: y, width: CW, height: CH }).png().toBuffer(), CW, `${look.name} ${d} (${rowsAt(d)} rows) 1:1`))
    }
  }
  await sharp(await grid(full, 5, CW)).jpeg({ quality: 86 }).toFile(path.join(dir, 'sheet-full.jpg'))
  await sharp(await grid([tileCrop, ...Array(4).fill(await sharp({ create: { width: CW, height: CH + 24, channels: 3, background: '#000' } }).png().toBuffer()), ...crops], 5, CW))
    .jpeg({ quality: 88 })
    .toFile(path.join(dir, 'sheet-crops.jpg'))

  // 4K export, 1:1, at both ends: the coarsest and the densest must still read, the densest must stay legible.
  const big = []
  for (const look of LOOKS.slice(0, 2)) {
    for (const d of [0, 1]) {
      const png = await render(look, 3840, 2160, d)
      const [x, y] = look.crop
      big.push(await caption(await sharp(png).extract({ left: 2 * x, top: 2 * y, width: CW * 2, height: CH * 2 }).png().toBuffer(), CW * 2, `${look.name} ${d} (${rowsAt(d)} rows), 4K export 1:1`))
    }
  }
  await sharp(await grid(big, 2, CW * 2)).jpeg({ quality: 88 }).toFile(path.join(dir, 'sheet-4k.jpg'))

  // Sweep: change per 0.01 step; between whole row counts there should be none.
  const sweep = {}
  for (const look of LOOKS) {
    const changes = await proto.call('sweep', { recipe: look.recipe, pack: look.pack, seed: look.seed, control: 'ascii', ascii: 0, width: 960, height: 540, steps: 100 })
    const steps = changes.map((change, i) => ({ from: i / 100, to: (i + 1) / 100, rows: [rowsAt(i / 100), rowsAt((i + 1) / 100)], change }))
    const rowSteps = steps.filter((s) => s.rows[0] !== s.rows[1])
    const flat = steps.filter((s) => s.rows[0] === s.rows[1])
    sweep[look.name] = {
      rowSteps: rowSteps.length,
      rowStepChange: { min: Math.min(...rowSteps.map((s) => s.change)), median: rowSteps.map((s) => s.change).sort((a, b) => a - b)[Math.floor(rowSteps.length / 2)], max: Math.max(...rowSteps.map((s) => s.change)) },
      largestChangeWithoutARowStep: Math.max(0, ...flat.map((s) => s.change)),
      steps,
    }
    const r = sweep[look.name]
    console.log(
      `${look.name}: ${r.rowSteps} row steps, change per row step min ${r.rowStepChange.min.toFixed(4)} median ${r.rowStepChange.median.toFixed(4)} max ${r.rowStepChange.max.toFixed(4)}; largest change without a row step ${r.largestChangeWithoutARowStep.toExponential(2)}`,
    )
  }
  fs.writeFileSync(path.join(dir, 'sweep.json'), JSON.stringify(sweep, null, 1))
  console.log('wrote', dir)
} finally {
  await proto.close()
}
