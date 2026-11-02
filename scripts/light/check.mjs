// Engine checks in the real browser. Writes images to artifacts/light-check/ and prints a pass/fail table.
// Usage: node scripts/light/check.mjs [--only hex,determinism,resolution,banding,tone,export,lens] [--out dir]
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { list, parseArgs } from './lib/args.mjs'
import { ROOT, startHarness } from './lib/harness.mjs'
import { composeRow, cropRgba, resizeRgba, savePng, zoom } from './lib/images.mjs'

const args = parseArgs()
const only = new Set(list(args.only))
const outDir = path.resolve(ROOT, typeof args.out === 'string' ? args.out : 'artifacts/light-check')
const wanted = (name) => only.size === 0 || only.has(name)
const results = []
const record = (name, pass, detail) => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`)
}

const started = Date.now()
const harness = await startHarness()
try {
  await mkdir(outDir, { recursive: true })
  const { PACKS } = await harness.ssr('/src/light/color/packs.ts')
  const { hexToBytes, hexToLinear, linearToSrgb } = await harness.ssr('/src/light/color/srgb.ts')
  const { toneCurve } = await harness.ssr('/src/light/engine/output.ts')
  const { compareImages, bandingScore, buildMask } = await harness.ssr('/src/light/audit/index.ts')
  const { linearToOklch } = await harness.ssr('/src/light/color/oklab.ts')
  const noLens = { bloom: 0, halation: 0 }

  if (wanted('hex')) {
    const hexes = [...new Set(PACKS.flatMap((pack) => pack.colors.map((c) => c.hex)))]
    const swatches = []
    let exact = 0
    let exactWithBloom = 0
    let worstDitherMean = 0
    for (const hex of hexes) {
      const expected = hexToBytes(hex)
      const plain = await harness.render({ scene: { program: 'test.flat', colors: [hex], lens: noLens, output: { grain: 0 } }, width: 96, height: 64, dither: false })
      const bloomed = await harness.render({ scene: { program: 'test.flat', colors: [hex], lens: { bloom: 0.5, bloomRadius: 0.6 }, output: { grain: 0 } }, width: 96, height: 64, dither: false })
      const dithered = await harness.render({ scene: { program: 'test.flat', colors: [hex], lens: noLens, output: { grain: 0 } }, width: 256, height: 256, dither: true })
      const allEqual = (image) => {
        for (let i = 0; i < image.data.length; i += 4) {
          if (image.data[i] !== expected[0] || image.data[i + 1] !== expected[1] || image.data[i + 2] !== expected[2]) return false
        }
        return true
      }
      if (allEqual(plain)) exact++
      if (allEqual(bloomed)) exactWithBloom++
      const sums = [0, 0, 0]
      for (let i = 0; i < dithered.data.length; i += 4) for (let k = 0; k < 3; k++) sums[k] += dithered.data[i + k]
      const n = dithered.data.length / 4
      for (let k = 0; k < 3; k++) worstDitherMean = Math.max(worstDitherMean, Math.abs(sums[k] / n - expected[k]))
      swatches.push({ image: plain, caption: hex })
    }
    await composeRow(path.join(outDir, 'hex-swatches.png'), swatches)
    record('hex exact (dither, grain, lens off)', exact === hexes.length, `${exact}/${hexes.length} pack colors exact`)
    record('hex exact with bloom 0.5 (energy-conserving)', exactWithBloom === hexes.length, `${exactWithBloom}/${hexes.length} exact`)
    record('hex mean with dither on', worstDitherMean <= 0.5, `worst channel mean off by ${worstDitherMean.toFixed(3)} code values`)
  }

  if (wanted('determinism')) {
    const scenes = [
      { recipe: 'sunset.ramp', seed: 7 },
      { recipe: 'contour.rim', seed: 3, output: { grain: 0.02 } },
      { program: 'test.post', seed: 5 },
    ]
    let identical = 0
    for (const scene of scenes) {
      const first = await harness.render({ scene, width: 925, height: 1002 })
      await harness.render({ scene: { recipe: 'contour.halo', seed: 99 }, width: 640, height: 480 })
      const second = await harness.render({ scene, width: 925, height: 1002 })
      if (Buffer.compare(first.data, second.data) === 0) identical++
    }
    record('same scene twice gives identical pixels', identical === scenes.length, `${identical}/${scenes.length} scenes identical (incl. grain and a post pass)`)
  }

  if (wanted('resolution')) {
    const scenes = [
      { name: 'sunset.ramp', scene: { recipe: 'sunset.ramp', seed: 2 } },
      { name: 'sunset.bands', scene: { recipe: 'sunset.bands', seed: 2 } },
      { name: 'contour.rim', scene: { recipe: 'contour.rim', seed: 2 } },
      { name: 'contour.halo', scene: { recipe: 'contour.halo', seed: 2, params: { rings: 3 } } },
      { name: 'test.post', scene: { program: 'test.post', seed: 2 } },
    ]
    const small = { width: 925, height: 1002 }
    const large = { width: Math.round((3840 * 925) / 1002), height: 3840 }
    const rows = []
    let ok = true
    for (const { name, scene } of scenes) {
      const a = await harness.render({ scene: { ...scene, output: { grain: 0 } }, ...small })
      const big = await harness.render({ scene: { ...scene, output: { grain: 0 } }, ...large })
      const b = await resizeRgba(big, small.width, small.height, 'lanczos3')
      const mask = buildMask(small.width, small.height, [], 0)
      const { metrics } = compareImages(a, b, mask)
      const pass = metrics.deltaE.mean < 0.004 && metrics.deltaE.p95 < 0.01
      ok &&= pass
      rows.push(`${name} mean ${metrics.deltaE.mean.toFixed(4)} p95 ${metrics.deltaE.p95.toFixed(4)} (4K render ${big.ms.toFixed(0)} ms)`)
      if (name === 'contour.rim' || name === 'test.post') {
        await composeRow(path.join(outDir, `resolution-${name}.png`), [
          { image: a, caption: `${name} at 925 px` },
          { image: b, caption: `${name} at ${large.width}x${large.height}, downsampled` },
        ])
      }
    }
    record('925 px and 3840 px renders match after downsampling', ok, rows.join('; '))
  }

  if (wanted('banding')) {
    const size = { width: 3840, height: 2160 }
    const scene = { program: 'test.ramp', colors: ['#0B0F14', '#1C2B33'], lens: noLens, output: { grain: 0 } }
    const on = await harness.render({ scene, ...size, dither: true })
    const off = await harness.render({ scene, ...size, dither: false })
    const runs = (image) => {
      let longest = 0
      let total = 0
      let count = 0
      for (let y = 0; y < image.height; y++) {
        for (let k = 0; k < 3; k++) {
          let run = 1
          for (let x = 1; x < image.width; x++) {
            const same = image.data[(y * image.width + x) * 4 + k] === image.data[(y * image.width + x - 1) * 4 + k]
            if (same) run++
            if (!same || x === image.width - 1) {
              longest = Math.max(longest, run)
              total += run
              count++
              run = 1
            }
          }
        }
      }
      return { longest, mean: total / count }
    }
    const from = hexToLinear('#0B0F14')
    const to = hexToLinear('#1C2B33')
    const columnError = (image) => {
      let worst = 0
      for (let x = 0; x < image.width; x++) {
        const u = (x + 0.5) / image.width
        for (let k = 0; k < 3; k++) {
          let sum = 0
          for (let y = 0; y < image.height; y++) sum += image.data[(y * image.width + x) * 4 + k]
          const ideal = linearToSrgb(from[k] + (to[k] - from[k]) * u) * 255
          worst = Math.max(worst, Math.abs(sum / image.height - ideal))
        }
      }
      return worst
    }
    const mask = new Uint8Array(size.width * size.height).fill(1)
    const runsOn = runs(on)
    const runsOff = runs(off)
    const errorOn = columnError(on)
    const errorOff = columnError(off)
    const scoreOn = bandingScore(on, mask)
    const scoreOff = bandingScore(off, mask)
    const crop = { left: 1800, top: 1000, width: 240, height: 120 }
    const cropOn = await cropRgba(on, crop.left, crop.top, crop.width, crop.height)
    const cropOff = await cropRgba(off, crop.left, crop.top, crop.width, crop.height)
    await composeRow(path.join(outDir, 'banding-crop.png'), [
      { image: await zoom(cropOn, 4), caption: 'dither on, 4x' },
      { image: await zoom(cropOn, 4, 8), caption: 'dither on, 4x, contrast x8' },
      { image: await zoom(cropOff, 4, 8), caption: 'dither off, 4x, contrast x8' },
    ])
    await savePng(path.join(outDir, 'banding-ramp-4k.png'), on)
    record(
      '4K dark ramp #0B0F14 -> #1C2B33 has no banding',
      scoreOn < 0.02 && errorOn < 0.1,
      `dither on: banding score ${scoreOn.toFixed(4)}, longest run ${runsOn.longest} px, mean run ${runsOn.mean.toFixed(2)} px, column-mean error ${errorOn.toFixed(3)}; ` +
        `dither off: score ${scoreOff.toFixed(3)}, longest run ${runsOff.longest} px, column-mean error ${errorOff.toFixed(3)}`,
    )
  }

  if (wanted('tone')) {
    const size = { width: 1600, height: 1000 }
    const image = await harness.render({ scene: { program: 'test.tone', lens: noLens }, ...size })
    await savePng(path.join(outDir, 'tone-curve.png'), image)
    // 1x so each pixel is one sample of the curve (at 2x the resolve filter averages across the knee).
    const plain = await harness.render({ scene: { program: 'test.tone', lens: noLens }, ...size, dither: false, supersample: 1 })
    const { TONE_COLOR_LIST, TONE_RAMP_MAX } = await harness.ssr('/scripts/light/harness/testPrograms.ts')
    let monotonic = true
    let worstGpu = 0
    let worstHueStep = 0
    let worstHueDrift = 0
    let worstSlopeRatio = 0
    const rampsEnd = 0.72
    TONE_COLOR_LIST.forEach((hex, index) => {
      const linear = hexToLinear(hex)
      const y = Math.floor(((index + 0.44) / TONE_COLOR_LIST.length) * rampsEnd * size.height)
      let previous = -1
      let previousHue = null
      const nominal = linearToOklch(linear)
      for (let x = 0; x < size.width; x++) {
        const i = (y * size.width + x) * 4
        const bytes = [plain.data[i], plain.data[i + 1], plain.data[i + 2]]
        const lum = 0.2126 * bytes[0] + 0.7152 * bytes[1] + 0.0722 * bytes[2]
        if (lum < previous - 1.0) monotonic = false
        previous = Math.max(previous, lum)
        const u = (x + 0.5) / size.width
        const intensity = TONE_RAMP_MAX * u * u
        const expected = toneCurve(linear.map((v) => v * intensity)).map((v) => Math.round(Math.min(1, Math.max(0, linearToSrgb(v))) * 255))
        for (let k = 0; k < 3; k++) worstGpu = Math.max(worstGpu, Math.abs(expected[k] - bytes[k]))
        const lch = linearToOklch(toneCurve(linear.map((v) => v * intensity)))
        if (lch[1] > 0.03 && previousHue !== null) {
          const step = Math.abs(((lch[2] - previousHue + 540) % 360) - 180)
          worstHueStep = Math.max(worstHueStep, step)
        }
        if (lch[1] > 0.03 && nominal[1] > 0.03 && intensity > 1) {
          worstHueDrift = Math.max(worstHueDrift, Math.abs(((lch[2] - nominal[2] + 540) % 360) - 180))
        }
        previousHue = lch[1] > 0.03 ? lch[2] : null
      }
      // Luminance slope just below and just above the start of compression (max channel = 1), from the CPU twin.
      const m = Math.max(...linear)
      const lumAt = (scale) => {
        const out = toneCurve(linear.map((v) => (v / m) * scale))
        return 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2]
      }
      const h = 1e-4
      const below = (lumAt(1) - lumAt(1 - h)) / h
      const above = (lumAt(1 + h) - lumAt(1)) / h
      if (below > 1e-6) worstSlopeRatio = Math.max(worstSlopeRatio, Math.abs(above / below - 1))
    })
    record('tone curve: luminance never falls along a ramp', monotonic, 'all ramps 0 -> 16x checked on the 8-bit output')
    record('tone curve: GPU output matches the CPU curve', worstGpu <= 2, `worst channel difference ${worstGpu} code values`)
    record('tone curve: luminance slope continuous where compression starts', worstSlopeRatio < 0.01, `worst slope mismatch ${(worstSlopeRatio * 100).toFixed(2)} %`)
    record(
      'tone curve: hue holds on the way to white',
      worstHueStep < 1 && worstHueDrift < 2,
      `largest hue step between neighboring columns ${worstHueStep.toFixed(2)} deg; largest drift from the nominal hue ${worstHueDrift.toFixed(2)} deg`,
    )
    const crop = await cropRgba(image, 300, 0, 400, Math.round(rampsEnd * size.height))
    await savePng(path.join(outDir, 'tone-curve-onset-zoom.png'), await zoom(crop, 2))
  }

  if (wanted('export')) {
    const preset = { id: 'check', pack: 'bold', scene: { recipe: 'contour.halo', seed: 4, colors: [], params: { rings: 2 }, lens: {}, output: {} } }
    const result = await harness.call('exportPng', preset, { aspect: '16:9' }, 'export')
    const png = harness.takeUpload('export')
    const meta = await sharp(png).metadata()
    const exported = { width: meta.width, height: meta.height, data: (await sharp(png).ensureAlpha().raw().toBuffer()) }
    const preview = await harness.render({ scene: preset.scene, width: 960, height: 540, supersample: 2 })
    const small = await resizeRgba(exported, 960, 540, 'lanczos3')
    const { metrics } = compareImages(preview, small, buildMask(960, 540, [], 0))
    await composeRow(path.join(outDir, 'export-vs-preview.png'), [
      { image: preview, caption: 'preview 960x540' },
      { image: small, caption: `${result.fileName}, downsampled` },
    ])
    const ok = meta.format === 'png' && meta.width === 3840 && meta.height === 2160 && result.fileName === 'contour.halo-bold-16x9-seed4.png' && metrics.deltaE.mean < 0.004
    record(
      'export: 16:9 PNG at 3840x2160 matches the preview',
      ok,
      `${result.fileName} ${meta.width}x${meta.height} ${meta.format}, ${(png.length / 1e6).toFixed(1)} MB in ${(result.ms / 1000).toFixed(2)} s; vs preview mean ${metrics.deltaE.mean.toFixed(4)} p95 ${metrics.deltaE.p95.toFixed(4)}`,
    )
  }

  if (wanted('lens')) {
    const size = { width: 1200, height: 800 }
    const off = await harness.render({ scene: { program: 'test.lens', lens: noLens }, ...size })
    const bloom = await harness.render({ scene: { program: 'test.lens', lens: { bloom: 0.25, bloomRadius: 0.55, bloomWidth: 1.6 } }, ...size })
    const halation = await harness.render({ scene: { program: 'test.lens', lens: { bloom: 0, halation: 0.8, halationThreshold: 0.9, halationRadius: 0.05 } }, ...size })
    const both = await harness.render({
      scene: { program: 'test.lens', lens: { bloom: 0.25, bloomRadius: 0.55, bloomWidth: 1.6, halation: 0.8, halationThreshold: 0.9, halationRadius: 0.05 } },
      ...size,
    })
    await composeRow(path.join(outDir, 'lens.png'), [
      { image: off, caption: 'lens off' },
      { image: bloom, caption: 'bloom 0.25' },
      { image: halation, caption: 'halation 0.8' },
      { image: both, caption: 'both' },
    ])
    // Energy: on a dim scene (nothing above 1) bloom must not change the mean linear light.
    const dim = { program: 'test.lens', params: { gain: 0.2 } }
    const dimOff = await harness.render({ scene: { ...dim, lens: noLens }, ...size, dither: false })
    const dimBloom = await harness.render({ scene: { ...dim, lens: { bloom: 0.6, bloomRadius: 0.5 } }, ...size, dither: false })
    const meanLinear = (image) => {
      let sum = 0
      for (let i = 0; i < image.data.length; i += 4) {
        sum += 0.2126 * hexToLinear([image.data[i], image.data[i + 1], image.data[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join(''))[0]
        sum += 0.7152 * hexToLinear([image.data[i], image.data[i + 1], image.data[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join(''))[1]
        sum += 0.0722 * hexToLinear([image.data[i], image.data[i + 1], image.data[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join(''))[2]
      }
      return sum / (image.data.length / 4)
    }
    const before = meanLinear(dimOff)
    const after = meanLinear(dimBloom)
    record('bloom keeps total light on a dim scene', Math.abs(after / before - 1) < 0.02, `mean linear luminance ${before.toFixed(5)} -> ${after.toFixed(5)} (${((after / before - 1) * 100).toFixed(2)} %)`)
    record('lens images written', true, path.relative(ROOT, path.join(outDir, 'lens.png')))
  }
} finally {
  await harness.close()
}

const failed = results.filter((r) => !r.pass)
await writeFile(path.join(outDir, 'report.json'), JSON.stringify({ seconds: (Date.now() - started) / 1000, results }, null, 2))
console.log(`\n${results.length - failed.length}/${results.length} passed in ${((Date.now() - started) / 1000).toFixed(1)} s; images in ${path.relative(ROOT, outDir)}/`)
process.exitCode = failed.length ? 1 : 0
