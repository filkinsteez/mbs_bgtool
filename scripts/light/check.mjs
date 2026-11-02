// Engine checks in the real browser. Writes images to artifacts/light-check/ and prints a pass/fail table.
// Usage: node scripts/light/check.mjs [--only hex,determinism,resolution,banding,tone,grain,scatter,context,export,lens] [--out dir]
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { list, parseArgs } from './lib/args.mjs'
import { ROOT, startHarness } from './lib/harness.mjs'
import { composeRow, cropRgba, loadRgba, resizeRgba, savePng, zoom } from './lib/images.mjs'
import { loadReferences } from './lib/references.mjs'

const args = parseArgs()
const only = new Set(list(args.only))
const outDir = path.resolve(ROOT, typeof args.out === 'string' ? args.out : 'artifacts/light-check')
const wanted = (name) => only.size === 0 || only.has(name)
const results = []
const record = (name, pass, detail) => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`)
}

const SRGB_TO_LINEAR = Array.from({ length: 256 }, (_, v) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
})

function oklabLightness(image, linearToOklab) {
  const out = new Float32Array(image.width * image.height)
  for (let p = 0; p < out.length; p++) {
    out[p] = linearToOklab([SRGB_TO_LINEAR[image.data[p * 4]], SRGB_TO_LINEAR[image.data[p * 4 + 1]], SRGB_TO_LINEAR[image.data[p * 4 + 2]]])[0]
  }
  return out
}

/** Standard deviation of values minus their (2r+1)^2 box mean, over pixels whose whole box is inside. */
function highpassStd(values, width, height, r) {
  let sum = 0
  let sum2 = 0
  let n = 0
  for (let y = r; y < height - r; y++) {
    for (let x = r; x < width - r; x++) {
      let box = 0
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) box += values[(y + dy) * width + x + dx]
      const d = values[y * width + x] - box / ((2 * r + 1) * (2 * r + 1))
      sum += d
      sum2 += d * d
      n++
    }
  }
  const mean = sum / n
  return Math.sqrt(Math.max(0, sum2 / n - mean * mean))
}

/** The size x size window with the lowest mean luma (densest ink), on a 20 px grid, clear of ignore rects. */
function darkestWindow(image, size, ignore) {
  let best = { left: 0, top: 0, luma: Infinity }
  for (let top = 0; top + size <= image.height; top += 20) {
    for (let left = 0; left + size <= image.width; left += 20) {
      const overlaps = ignore.some(({ rect: [x, y, w, h] }) => left < x + w && left + size > x && top < y + h && top + size > y)
      if (overlaps) continue
      let sum = 0
      for (let y = top; y < top + size; y += 4) {
        for (let x = left; x < left + size; x += 4) {
          const i = (y * image.width + x) * 4
          sum += 0.2126 * image.data[i] + 0.7152 * image.data[i + 1] + 0.0722 * image.data[i + 2]
        }
      }
      if (sum < best.luma) best = { left, top, luma: sum }
    }
  }
  return best
}

const started = Date.now()
const harness = await startHarness()
try {
  await mkdir(outDir, { recursive: true })
  const { PACKS } = await harness.ssr('/src/light/color/packs.ts')
  const { hexToBytes, hexToLinear, linearToSrgb } = await harness.ssr('/src/light/color/srgb.ts')
  const { toneCurve } = await harness.ssr('/src/light/engine/output.ts')
  const { compareImages, bandingScore, buildMask } = await harness.ssr('/src/light/audit/index.ts')
  const { linearToOklch, linearToOklab } = await harness.ssr('/src/light/color/oklab.ts')
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
      const bloomed = await harness.render({
        scene: { program: 'test.flat', colors: [hex], lens: { bloom: 0.5, bloomRadius: 0.6, halation: 1 }, output: { grain: 0 } },
        width: 96,
        height: 64,
        dither: false,
      })
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
    record('hex exact with bloom 0.5 and halation 1', exactWithBloom === hexes.length, `${exactWithBloom}/${hexes.length} exact`)
    record('hex mean with dither on', worstDitherMean <= 0.5, `worst channel mean off by ${worstDitherMean.toFixed(3)} code values`)
  }

  if (wanted('determinism')) {
    const scenes = [
      { recipe: 'sunset.ramp', seed: 7 },
      { recipe: 'contour.rim', seed: 3, output: { grain: 0.5 } },
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
      { name: 'test.scatter', scene: { program: 'test.scatter', seed: 2 } },
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
      if (name === 'contour.rim' || name === 'test.post' || name === 'test.scatter') {
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
    const { TONE_COLOR_LIST, TONE_RAMP_MAX, GLOW_GRID } = await harness.ssr('/scripts/light/harness/testPrograms.ts')
    const hueDiff = (a, b) => ((a - b + 540) % 360) - 180
    const warm = new Set(['#FF4F00', '#FFD61E', '#B8996E', '#FF0000'])
    const blue = new Set(['#0064E0', '#6A7788', '#384753', '#1C2B33', '#0000FF'])
    let monotonic = true
    let worstGpu = 0
    let worstHueStep = 0
    let warmBackward = 0
    let warmEnd = Infinity
    let blueTowardViolet = -Infinity
    let worstSlopeRatio = 0
    const rampsEnd = 0.72
    TONE_COLOR_LIST.forEach((hex, index) => {
      const linear = hexToLinear(hex)
      const y = Math.floor(((index + 0.44) / TONE_COLOR_LIST.length) * rampsEnd * size.height)
      let previous = -1
      let previousHue = null
      let lastWarmHue = null
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
        if (lch[1] > 0.05 && previousHue !== null) worstHueStep = Math.max(worstHueStep, Math.abs(hueDiff(lch[2], previousHue)))
        previousHue = lch[1] > 0.05 ? lch[2] : null
        if (lch[1] > 0.03 && intensity * Math.max(...linear) > 1) {
          if (warm.has(hex)) {
            if (lastWarmHue !== null) warmBackward = Math.max(warmBackward, hueDiff(lastWarmHue, lch[2]))
            lastWarmHue = lch[2]
          }
          if (blue.has(hex)) blueTowardViolet = Math.max(blueTowardViolet, hueDiff(lch[2], nominal[2]))
        }
      }
      if (warm.has(hex) && lastWarmHue !== null) warmEnd = Math.min(warmEnd, lastWarmHue)
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
      'tone curve: warm light whitens through yellow, blue through cyan-white, hue moves smoothly',
      worstHueStep < 1 && warmBackward < 0.5 && warmEnd > 85 && blueTowardViolet < 8,
      `largest hue step between neighboring columns ${worstHueStep.toFixed(2)} deg; warm hues never step back toward pink by more than ${warmBackward.toFixed(2)} deg and reach ${warmEnd.toFixed(0)} deg or more; ` +
        `blues move toward violet by at most ${blueTowardViolet.toFixed(2)} deg`,
    )
    const crop = await cropRgba(image, 300, 0, 400, Math.round(rampsEnd * size.height))
    await savePng(path.join(outDir, 'tone-curve-onset-zoom.png'), await zoom(crop, 2))
    const glows = await harness.render({ scene: { program: 'test.glows', lens: noLens }, width: GLOW_GRID.columns * 64, height: GLOW_GRID.rows * 64 })
    await savePng(path.join(outDir, 'tone-glows.png'), await zoom(glows, 2))
    record('tone glows written', true, `${path.relative(ROOT, path.join(outDir, 'tone-glows.png'))}: gaussian dots and lines at 1.5x, 3x, 8x per pack color, 2x zoom`)
  }

  if (wanted('scatter')) {
    const flat = await harness.render({ scene: { program: 'test.scatter.flat', lens: noLens, output: { grain: 0 } }, width: 160, height: 90, dither: false })
    const expected = [0.4, 0.4, 0.4].map((v) => Math.round(linearToSrgb(v) * 255))
    let matching = 0
    for (let i = 0; i < flat.data.length; i += 4) {
      if (flat.data[i] === expected[0] && flat.data[i + 1] === expected[1] && flat.data[i + 2] === expected[2]) matching++
    }
    const pixels = flat.data.length / 4
    record(
      'scatter: combine gets the radiance blur, then the aux blur',
      matching === pixels,
      `flat fields: ${matching}/${pixels} pixels at the expected ${expected.join(',')} (0.5 radiance + 0.5 blurred radiance + 0.25 blurred aux)`,
    )
    const size = { width: 900, height: 900 }
    const off = await harness.render({ scene: { program: 'test.scatter', params: { amount: 0 }, lens: noLens }, ...size, dither: false })
    const on = await harness.render({ scene: { program: 'test.scatter', lens: noLens }, ...size, dither: false })
    const wide = await harness.render({ scene: { program: 'test.scatter', params: { radius: 0.15 }, lens: noLens }, ...size, dither: false })
    await composeRow(path.join(outDir, 'scatter.png'), [
      { image: off, caption: 'two rims, no scatter' },
      { image: on, caption: 'each disc catches the other rim, blur 0.06' },
      { image: wide, caption: 'blur 0.15' },
    ])
    const at = (image, x, y) => [0, 1, 2].map((k) => image.data[(y * size.width + x) * 4 + k])
    const outsideSame = at(off, 20, 20).join() === at(on, 20, 20).join()
    const insideB = at(on, 540, 630)
    const insideBOff = at(off, 540, 630)
    record(
      'scatter: light lands only inside the discs',
      outsideSame && insideB[0] > insideBOff[0] + 10,
      `outside both discs ${at(on, 20, 20).join(',')} with and without scatter; inside disc B ${insideBOff.join(',')} -> ${insideB.join(',')}; images in scatter.png`,
    )
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

  if (wanted('grain')) {
    // Oklab L of grey pixels is the cube root of linear light.
    const decode = Array.from({ length: 256 }, (_, v) => Math.cbrt(hexToLinear(`#${v.toString(16).padStart(2, '0').repeat(3)}`)[0]))
    const lightnessStd = (image) => {
      let sum = 0
      let sum2 = 0
      const n = image.data.length / 4
      for (let i = 0; i < image.data.length; i += 4) {
        const L = decode[image.data[i + 1]]
        sum += L
        sum2 += L * L
      }
      const mean = sum / n
      return Math.sqrt(Math.max(0, sum2 / n - mean * mean))
    }
    const grey = (grain, size, dither = false) =>
      harness.render({ scene: { program: 'test.flat', colors: ['#555555'], lens: noLens, output: { grain } }, ...size, dither })
    const export4k = await grey(0.5, { width: 3840, height: 2160 })
    const preview = await grey(0.5, { width: 960, height: 540 })
    const shrunk = await resizeRgba(export4k, 960, 540, 'lanczos3')
    const std4k = lightnessStd(export4k)
    const stdPreview = lightnessStd(preview)
    const stdShrunk = lightnessStd(shrunk)
    const riso4k = lightnessStd(await grey(1, { width: 3840, height: 2160 }))
    record(
      'grain: strength 0.5 is about 1.25 % Oklab L at mid-tones, sized to the picture',
      Math.abs(std4k - 0.012) < 0.0015 && Math.abs(stdShrunk / stdPreview - 1) < 0.15,
      `L 0.45 grey: std ${(std4k * 100).toFixed(2)} % at 3840x2160, ${(stdPreview * 100).toFixed(2)} % at 960x540, ${(stdShrunk * 100).toFixed(2)} % for the 4K render shrunk to 960x540; strength 1: ${(riso4k * 100).toFixed(2)} %`,
    )
    const black = await harness.render({ scene: { program: 'test.flat', colors: ['#000000'], lens: noLens, output: { grain: 1 } }, width: 640, height: 360 })
    record('grain: black stays exact black at strength 1 with dither', black.data.every((v, i) => i % 4 === 3 || v === 0), 'every pixel 0,0,0')

    const ramp = { program: 'test.ramp', colors: ['#000000', '#FFFFFF'], lens: noLens }
    for (const grain of [0.5, 1]) {
      const image = await harness.render({ scene: { ...ramp, output: { grain } }, width: 1920, height: 1080 })
      const panels = []
      for (const [left, name] of [[0, 'black end'], [800, 'middle'], [1600, 'white end']]) {
        panels.push({ image: await zoom(await cropRgba(image, left, 480, 320, 160), 2), caption: `grain ${grain}, ${name} of a black-white ramp, 2x` })
      }
      await composeRow(path.join(outDir, `grain-strength-${grain}.png`), panels)
    }

    // The grain filter alone: a flat field of each riso crop's mean color at strength 1, next to the target crop.
    const { references } = await loadReferences(harness)
    const riso = references.filter((ref) => ref.id.endsWith('-riso'))
    const rows = []
    for (const ref of riso) {
      const target = await loadRgba(ref.file)
      const crop = darkestWindow(target, 160, ref.ignore)
      const targetCrop = await cropRgba(target, crop.left, crop.top, 160, 160)
      const mean = [0, 1, 2].map((k) => {
        let sum = 0
        for (let i = k; i < targetCrop.data.length; i += 4) sum += hexToLinear(`#${targetCrop.data[i].toString(16).padStart(2, '0').repeat(3)}`)[0]
        return linearToSrgb(sum / (targetCrop.data.length / 4))
      })
      const hex = `#${mean.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`
      const scene = { program: 'test.flat', colors: [hex], lens: noLens, output: { grain: 1 } }
      const render = await harness.render({ scene, width: ref.width, height: ref.height })
      const scale = 3840 / Math.max(ref.width, ref.height)
      const size = Math.round(160 * scale)
      const big = await harness.render({ scene, width: Math.round(ref.width * scale), height: Math.round(ref.height * scale) })
      const bigCrop = await cropRgba(big, Math.round(crop.left * scale), Math.round(crop.top * scale), size, size)
      await composeRow(path.join(outDir, `grain-${ref.id}.png`), [
        { image: await zoom(targetCrop, 3), caption: `${ref.id} 1:1, shown 3x` },
        { image: await zoom(await cropRgba(render, crop.left, crop.top, 160, 160), 3), caption: `grain 1 on ${hex} at ${ref.width} px, 3x` },
        { image: await resizeRgba(targetCrop, size, size, 'lanczos3'), caption: 'target enlarged to 4K' },
        { image: bigCrop, caption: `grain 1 at ${big.width}x${big.height}, 1:1` },
      ])
      const renderCrop = await cropRgba(render, crop.left, crop.top, 160, 160)
      const fine = (image) => (highpassStd(oklabLightness(image, linearToOklab), image.width, image.height, 3) * 100).toFixed(2)
      rows.push(`${ref.id} on ${hex}: fine Oklab L std target ${fine(targetCrop)} %, render ${fine(renderCrop)} %`)
    }
    record('grain images written', true, `grain-strength-0.5.png, grain-strength-1.png; ${riso.map((ref) => `grain-${ref.id}.png`).join(', ')}; ${rows.join('; ')}`)
  }

  if (wanted('context')) {
    const outcomes = await harness.call('contextLoss', { recipe: 'contour.halo', seed: 1 })
    const lost = Object.values(outcomes).every((message) => message.startsWith('WebGL context lost'))
    record(
      'lost context: readPixels, render and a new renderer on that canvas throw "WebGL context lost"',
      lost,
      Object.entries(outcomes).map(([call, message]) => `${call}: ${message}`).join('; '),
    )
    const timing = await harness.call('measure', { scene: { recipe: 'sunset.ramp', seed: 3 }, width: 1920, height: 1080, supersample: 1 })
    record(
      'measure: render waits for the GPU when asked',
      timing.measuredFlag && timing.measured >= timing.issued * 0.5,
      `1920x1080 at 1x: ${timing.issued.toFixed(2)} ms to issue, ${timing.measured.toFixed(2)} ms with measure`,
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

    // Halation: only light above nominal feeds it, and bright surroundings suppress it.
    const halSize = { width: 640, height: 360 }
    const halLens = { bloom: 0, halation: 1, halationRadius: 0.05 }
    const halScene = (params, lens) => ({ program: 'test.halation', params, lens })
    const halRender = (params, lens) => harness.render({ scene: halScene(params, lens), ...halSize, dither: false })
    const addedLight = (on, off) => {
      let sum = 0
      for (let i = 0; i < on.data.length; i += 4) {
        for (let k = 0; k < 3; k++) sum += SRGB_TO_LINEAR[on.data[i + k]] - SRGB_TO_LINEAR[off.data[i + k]]
      }
      return sum / (on.data.length / 4)
    }
    const nominalOff = await halRender({ gain: 1 }, noLens)
    const nominalOn = await halRender({ gain: 1 }, halLens)
    const hotOff = await halRender({ gain: 4 }, noLens)
    const hotOn = await halRender({ gain: 4 }, halLens)
    const brightOff = await halRender({ gain: 4, background: 0.6 }, noLens)
    const brightOn = await halRender({ gain: 4, background: 0.6 }, halLens)
    let nominalDiff = 0
    for (let i = 0; i < nominalOn.data.length; i++) nominalDiff = Math.max(nominalDiff, Math.abs(nominalOn.data[i] - nominalOff.data[i]))
    const onBlack = addedLight(hotOn, hotOff)
    const onBright = addedLight(brightOn, brightOff)
    await composeRow(path.join(outDir, 'lens-halation.png'), [
      { image: hotOff, caption: '4x nominal on black, halation off' },
      { image: hotOn, caption: '4x on black, halation 1' },
      { image: nominalOn, caption: 'nominal (max channel 1) on black, halation 1' },
      { image: brightOn, caption: '4x on a bright background, halation 1' },
    ])
    record(
      'halation: only from light above nominal, held back on bright surroundings',
      nominalDiff === 0 && onBlack > 0.002 && onBright < onBlack * 0.3,
      `nominal light: largest change ${nominalDiff} code values; 4x light adds ${onBlack.toFixed(4)} mean linear light on black, ${onBright.toFixed(4)} (${((onBright / onBlack) * 100).toFixed(0)} %) on a bright background; images in lens-halation.png`,
    )
    record('lens images written', true, path.relative(ROOT, path.join(outDir, 'lens.png')))
  }
} finally {
  await harness.close()
}

const failed = results.filter((r) => !r.pass)
await writeFile(path.join(outDir, 'report.json'), JSON.stringify({ seconds: (Date.now() - started) / 1000, results }, null, 2))
console.log(`\n${results.length - failed.length}/${results.length} passed in ${((Date.now() - started) / 1000).toFixed(1)} s; images in ${path.relative(ROOT, outDir)}/`)
process.exitCode = failed.length ? 1 : 0
