// Engine checks in the real browser. Writes images to artifacts/light-check/ and prints a pass/fail table.
// Usage: node scripts/light/check.mjs [--only hex,determinism,resolution,banding,tone,grain,scatter,speed,context,export,aspect,lens] [--out dir]
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
/** A check that could not run because a recipe it needs did not load (usually mid-edit by its owner). */
const skip = (name, detail) => {
  results.push({ name, pass: true, skipped: true, detail })
  console.log(`SKIP  ${name}  ${detail}`)
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
  const { hexToBytes, hexToLinear, linearToSrgb, srgbToLinear } = await harness.ssr('/src/light/color/srgb.ts')
  const { toneCurve, TONE_TIE_BAND } = await harness.ssr('/src/light/engine/output.ts')
  const { compareImages, bandingScore, buildMask } = await harness.ssr('/src/light/audit/index.ts')
  const { linearToOklch, linearToOklab } = await harness.ssr('/src/light/color/oklab.ts')
  const noLens = { bloom: 0, halation: 0 }
  const { recipeErrors } = await harness.info()
  const loads = (scene) => !scene.recipe || !recipeErrors[scene.recipe]
  const notLoaded = (scenes) => [...new Set(scenes.filter((scene) => !loads(scene)).map((scene) => scene.recipe))]
  for (const [recipe, message] of Object.entries(recipeErrors)) console.log(`note  ${recipe} did not load: ${message.split('\n')[0]}`)

  if (wanted('hex')) {
    const hexes = [...new Set(PACKS.flatMap((pack) => pack.colors.map((c) => c.hex)))]
    const swatches = []
    let exact = 0
    let exactWithBloom = 0
    let exactWithToe = 0
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
      const toed = await harness.render({ scene: { program: 'test.flat', colors: [hex], lens: noLens, output: { grain: 0, toe: 1 } }, width: 96, height: 64, dither: false })
      const allEqual = (image) => {
        for (let i = 0; i < image.data.length; i += 4) {
          if (image.data[i] !== expected[0] || image.data[i + 1] !== expected[1] || image.data[i + 2] !== expected[2]) return false
        }
        return true
      }
      if (allEqual(plain)) exact++
      if (allEqual(bloomed)) exactWithBloom++
      if (allEqual(toed)) exactWithToe++
      const sums = [0, 0, 0]
      for (let i = 0; i < dithered.data.length; i += 4) for (let k = 0; k < 3; k++) sums[k] += dithered.data[i + k]
      const n = dithered.data.length / 4
      for (let k = 0; k < 3; k++) worstDitherMean = Math.max(worstDitherMean, Math.abs(sums[k] / n - expected[k]))
      swatches.push({ image: plain, caption: hex })
    }
    await composeRow(path.join(outDir, 'hex-swatches.png'), swatches)
    record('hex exact (dither, grain, lens off)', exact === hexes.length, `${exact}/${hexes.length} pack colors exact`)
    record('hex exact with bloom 0.5 and halation 1', exactWithBloom === hexes.length, `${exactWithBloom}/${hexes.length} exact`)
    record('hex exact with the paper toe at 1 (slot colors pre-inverted)', exactWithToe === hexes.length, `${exactWithToe}/${hexes.length} exact`)
    record('hex mean with dither on', worstDitherMean <= 0.5, `worst channel mean off by ${worstDitherMean.toFixed(3)} code values`)
  }

  if (wanted('determinism')) {
    const all = [
      { recipe: 'sunset.ramp', seed: 7 },
      { recipe: 'contour.rim', seed: 3, output: { grain: 0.5 } },
      { program: 'test.post', seed: 5 },
      { program: 'test.scatter', seed: 4, output: { grain: 0.5 } },
    ]
    const scenes = all.filter(loads)
    let identical = 0
    for (const scene of scenes) {
      const first = await harness.render({ scene, width: 925, height: 1002 })
      await harness.render({ scene: { program: 'test.halation', seed: 99, lens: { halation: 1, bloom: 0.2 } }, width: 640, height: 480 })
      const second = await harness.render({ scene, width: 925, height: 1002 })
      if (Buffer.compare(first.data, second.data) === 0) identical++
    }
    const skipped = notLoaded(all)
    record(
      'same scene twice gives identical pixels',
      identical === scenes.length,
      `${identical}/${scenes.length} scenes identical (incl. grain, a post pass and scatter)${skipped.length ? `; not loaded: ${skipped.join(', ')}` : ''}`,
    )
  }

  if (wanted('resolution')) {
    // Test programs check the engine; recipes are listed separately because their owners change them.
    const programs = [
      { name: 'test.post', scene: { program: 'test.post', seed: 2 } },
      { name: 'test.scatter', scene: { program: 'test.scatter', seed: 2 } },
      { name: 'test.halation', scene: { program: 'test.halation', seed: 2, lens: { halation: 1, bloom: 0.15 } } },
      { name: 'test.glows', scene: { program: 'test.glows', seed: 2, lens: { bloom: 0.1 } } },
    ]
    const recipeScenes = [
      { name: 'sunset.ramp', scene: { recipe: 'sunset.ramp', seed: 2 } },
      { name: 'sunset.bands', scene: { recipe: 'sunset.bands', seed: 2 } },
      { name: 'contour.rim', scene: { recipe: 'contour.rim', seed: 2 } },
      { name: 'contour.halo', scene: { recipe: 'contour.halo', seed: 2 } },
    ]
    const small = { width: 925, height: 1002 }
    const large = { width: Math.round((3840 * 925) / 1002), height: 3840 }
    const compareSizes = async (list) => {
      const rows = []
      let ok = true
      for (const { name, scene } of list.filter((entry) => loads(entry.scene))) {
        // Dither off: a shrunk 4K render is rounded to 8 bits again after its dither averages out, which turns a
        // glow of a fraction of a code value into 0, and near black Oklab reads that as a large difference.
        const a = await harness.render({ scene: { ...scene, output: { grain: 0 } }, ...small, dither: false })
        const big = await harness.render({ scene: { ...scene, output: { grain: 0 } }, ...large, dither: false })
        const b = await resizeRgba(big, small.width, small.height, 'lanczos3')
        const mask = buildMask(small.width, small.height, [], 0)
        const { metrics } = compareImages(a, b, mask)
        ok &&= metrics.deltaE.mean < 0.004 && metrics.deltaE.p95 < 0.01
        rows.push(`${name} mean ${metrics.deltaE.mean.toFixed(4)} p95 ${metrics.deltaE.p95.toFixed(4)} (4K render ${big.ms.toFixed(0)} ms)`)
        if (name === 'contour.rim' || name === 'test.post' || name === 'test.scatter') {
          await composeRow(path.join(outDir, `resolution-${name}.png`), [
            { image: a, caption: `${name} at 925 px` },
            { image: b, caption: `${name} at ${large.width}x${large.height}, downsampled` },
          ])
        }
      }
      return { ok, rows }
    }
    const engineRun = await compareSizes(programs)
    record('925 px and 3840 px renders match after downsampling (test programs)', engineRun.ok, engineRun.rows.join('; '))
    const recipeRun = await compareSizes(recipeScenes)
    const skipped = notLoaded(recipeScenes.map((entry) => entry.scene))
    record(
      '925 px and 3840 px renders match after downsampling (recipes as they are now)',
      recipeRun.ok,
      `${recipeRun.rows.join('; ')}${skipped.length ? `; not loaded: ${skipped.join(', ')}` : ''}`,
    )
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
    const { TONE_COLOR_LIST, TONE_RAMP_MAX, GLOW_GRID, TIE_GLOW_GRID } = await harness.ssr('/scripts/light/harness/testPrograms.ts')
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
    const nearTies = []
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
      const nearestTie = linear.map((v) => 1 - v / m).sort((a, b) => a - b)[1]
      if (nearestTie < TONE_TIE_BAND) nearTies.push(hex)
      else if (below > 1e-6) worstSlopeRatio = Math.max(worstSlopeRatio, Math.abs(above / below - 1))
    })
    record('tone curve: luminance never falls along a ramp', monotonic, 'all ramps 0 -> 16x checked on the 8-bit output')
    record('tone curve: GPU output matches the CPU curve', worstGpu <= 2, `worst channel difference ${worstGpu} code values`)
    record(
      'tone curve: luminance slope continuous where compression starts',
      worstSlopeRatio < 0.01,
      `worst slope mismatch ${(worstSlopeRatio * 100).toFixed(2)} %; not held within ${TONE_TIE_BAND * 100} % of a tie for the largest channel: ${nearTies.join(', ')}`,
    )
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

    // Through every tie of two channels for the largest: the second passes the first (ratio 0.85 to 1 / 0.85 in
    // 0.25 % steps, the largest held at m) at several intensities and third-channel levels. A ridge is a jump.
    const names = ['R', 'G', 'B']
    let worstTieStep = 0
    let worstTieAt = ''
    for (const [a, b] of [[0, 1], [1, 2], [0, 2]]) {
      const third = 3 - a - b
      for (const level of [0, 0.2, 0.43, 0.7, 0.95]) {
        for (const m of [1.02, 1.1, 1.25, 1.5, 2, 3, 5, 8]) {
          let previous = null
          for (let step = -65; step <= 65; step++) {
            const q = Math.exp(step * 0.0025)
            const c = [0, 0, 0]
            c[a] = m * Math.min(1, 1 / q)
            c[b] = m * Math.min(1, q)
            c[third] = m * level
            const bytes = toneCurve(c).map((v) => Math.round(Math.min(1, Math.max(0, linearToSrgb(v))) * 255))
            if (previous) {
              const jump = Math.max(...bytes.map((v, k) => Math.abs(v - previous[k])))
              if (jump > worstTieStep) {
                worstTieStep = jump
                worstTieAt = `${names[a]}/${names[b]} tie, ${names[third]} at ${level} of the largest, ${m}x: ${previous.join(',')} -> ${bytes.join(',')}`
              }
            }
            previous = bytes
          }
        }
      }
    }
    record('tone curve: no jump where two channels tie for the largest', worstTieStep <= 3, `largest change between 0.25 % steps ${worstTieStep} code values (${worstTieAt})`)
    const ties = await harness.render({ scene: { program: 'test.toneties', lens: noLens }, width: TIE_GLOW_GRID.columns * 200, height: TIE_GLOW_GRID.rows * 200 })
    await savePng(path.join(outDir, 'tone-ties.png'), ties)
    record(
      'tone tie glows written',
      true,
      `${path.relative(ROOT, path.join(outDir, 'tone-ties.png'))}: Yellow, then Yellow over Cyan and over Meta Blue, then the same for Orange-red, at 1.5x, 3x, 8x`,
    )
  }

  if (wanted('scatter')) {
    const flat = await harness.render({ scene: { program: 'test.scatter.flat', lens: noLens, output: { grain: 0 } }, width: 160, height: 90, dither: false })
    const expected = [0.4, 0.4, 0.4].map((v) => Math.round(linearToSrgb(v) * 255))
    let matching = 0
    const found = new Map()
    for (let i = 0; i < flat.data.length; i += 4) {
      if (flat.data[i] === expected[0] && flat.data[i + 1] === expected[1] && flat.data[i + 2] === expected[2]) matching++
      const value = `${flat.data[i]},${flat.data[i + 1]},${flat.data[i + 2]}`
      found.set(value, (found.get(value) ?? 0) + 1)
    }
    const pixels = flat.data.length / 4
    const common = [...found.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([value, n]) => `${value} x${n}`)
    record(
      'scatter: combine gets the radiance blur, then the aux blur',
      matching === pixels,
      `flat fields: ${matching}/${pixels} pixels at the expected ${expected.join(',')} (0.5 radiance + 0.5 blurred radiance + 0.25 blurred aux)` +
        (matching === pixels ? '' : `; most common ${common.join(', ')}`),
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
    // An unblurred scatter source at a size the recipe picks: a slow smooth layer rendered once at 128 px, read back in combine.
    const still = { lens: noLens, output: { grain: 0 } }
    const cacheSize = { width: 925, height: 1002 }
    const cached = await harness.render({ scene: { program: 'test.cache', ...still }, ...cacheSize, dither: false })
    const direct = await harness.render({ scene: { program: 'test.cache.direct', ...still }, ...cacheSize, dither: false })
    const cachedLarge = await harness.render({ scene: { program: 'test.cache', ...still }, width: 3546, height: 3840, dither: false })
    const cacheMask = buildMask(cacheSize.width, cacheSize.height, [], 0)
    const vsDirect = compareImages(direct, cached, cacheMask).metrics.deltaE
    const vsLarge = compareImages(cached, await resizeRgba(cachedLarge, cacheSize.width, cacheSize.height, 'lanczos3'), cacheMask).metrics.deltaE
    const timing = {}
    for (const program of ['test.cache', 'test.cache.direct']) {
      timing[program] = (await harness.call('profile', { scene: { program, ...still }, width: 1920, height: 1080, supersample: 1, runs: 3 })).burst
    }
    await composeRow(path.join(outDir, 'scatter-cache.png'), [
      { image: direct, caption: 'slow layer at every pixel' },
      { image: cached, caption: 'from a 128 px cache' },
    ])
    record(
      'scatter cache: an unblurred source at the size the recipe picks gives back the layer, the same at every output size',
      vsDirect.mean < 0.002 && vsLarge.mean < 0.001,
      `128 px cache vs every pixel: mean ${vsDirect.mean.toFixed(4)} p95 ${vsDirect.p95.toFixed(4)}; 925 px vs 3840 px shrunk: mean ${vsLarge.mean.toFixed(4)}; ` +
        `1920x1080 1x back to back: ${timing['test.cache.direct'].toFixed(1)} ms at every pixel, ${timing['test.cache'].toFixed(1)} ms cached; images in scatter-cache.png`,
    )
  }

  if (wanted('export') && Object.keys(recipeErrors).length > 0) {
    skip('export: 16:9 PNG at 3840x2160 matches the preview', `the export path loads every recipe, and ${Object.keys(recipeErrors).join(', ')} did not load`)
  } else if (wanted('export')) {
    const preset = { id: 'check', pack: 'bold', scene: { recipe: 'sunset.ramp', seed: 4, colors: [], params: {}, lens: {}, output: {} } }
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
    const ok = meta.format === 'png' && meta.width === 3840 && meta.height === 2160 && result.fileName === 'sunset.ramp-bold-16x9-seed4.png' && metrics.deltaE.mean < 0.004
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

    // Per-pixel grain weight from the recipe, on the direct path and through a post pass: right half at weight 0.25.
    const fine = (image) => highpassStd(oklabLightness(image, linearToOklab), image.width, image.height, 3)
    const halves = []
    for (const program of ['test.grainweight', 'test.grainweight.post']) {
      const image = await harness.render({ scene: { program, lens: noLens, output: { grain: 0.5 } }, width: 1920, height: 1080, dither: false })
      const left = fine(await cropRgba(image, 240, 300, 480, 480))
      const right = fine(await cropRgba(image, 1200, 300, 480, 480))
      halves.push({ program, left, right })
    }
    record(
      'grain: a recipe weight of 0.25 gives a quarter of the grain, also through post passes',
      halves.every(({ left, right }) => Math.abs(right / left - 0.25) < 0.04),
      halves.map(({ program, left, right }) => `${program}: fine L std ${(left * 100).toFixed(2)} % at weight 1, ${(right * 100).toFixed(2)} % at 0.25`).join('; '),
    )

    // Riso crops: a flat field of each crop's mean color at strength 1, weighted the way a riso recipe can weight its
    // ink: by how much the ink darkens the paper, saturate((L paper - L ink) / 0.5) with paper at L 0.95.
    const { references } = await loadReferences(harness)
    const riso = references.filter((ref) => ref.id.endsWith('-riso'))
    const rows = []
    let within = 0
    for (const ref of riso) {
      const target = await loadRgba(ref.file)
      const crop = darkestWindow(target, 160, ref.ignore)
      const targetCrop = await cropRgba(target, crop.left, crop.top, 160, 160)
      const meanLinear = [0, 1, 2].map((k) => {
        let sum = 0
        for (let i = k; i < targetCrop.data.length; i += 4) sum += SRGB_TO_LINEAR[targetCrop.data[i]]
        return sum / (targetCrop.data.length / 4)
      })
      const mean = meanLinear.map((v) => linearToSrgb(v))
      const hex = `#${mean.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`
      const inkL = linearToOklab(meanLinear)[0]
      const weight = Math.min(1, Math.max(0, (0.95 - inkL) / 0.5))
      const scene = { program: 'test.grainweight', colors: [hex], params: { left: weight, right: weight }, lens: noLens, output: { grain: 1 } }
      const render = await harness.render({ scene, width: ref.width, height: ref.height })
      const scale = 3840 / Math.max(ref.width, ref.height)
      const size = Math.round(160 * scale)
      const big = await harness.render({ scene, width: Math.round(ref.width * scale), height: Math.round(ref.height * scale) })
      const bigCrop = await cropRgba(big, Math.round(crop.left * scale), Math.round(crop.top * scale), size, size)
      await composeRow(path.join(outDir, `grain-${ref.id}.png`), [
        { image: await zoom(targetCrop, 3), caption: `${ref.id} 1:1, shown 3x` },
        { image: await zoom(await cropRgba(render, crop.left, crop.top, 160, 160), 3), caption: `grain 1, weight ${weight.toFixed(2)}, on ${hex} at ${ref.width} px, 3x` },
        { image: await resizeRgba(targetCrop, size, size, 'lanczos3'), caption: 'target enlarged to 4K' },
        { image: bigCrop, caption: `the same at ${big.width}x${big.height}, 1:1` },
      ])
      const renderCrop = await cropRgba(render, crop.left, crop.top, 160, 160)
      const targetStd = fine(targetCrop)
      const renderStd = fine(renderCrop)
      if (Math.abs(renderStd / targetStd - 1) <= 0.2) within++
      rows.push(`${ref.id} (ink L ${inkL.toFixed(2)}, weight ${weight.toFixed(2)}): fine Oklab L std target ${(targetStd * 100).toFixed(2)} %, render ${(renderStd * 100).toFixed(2)} % (${(((renderStd / targetStd) - 1) * 100).toFixed(0)} %)`)
    }
    record('grain: riso crops within 20 % of their prints with an ink weight', within === riso.length, rows.join('; '))
    record('grain images written', true, `grain-strength-0.5.png, grain-strength-1.png; ${riso.map((ref) => `grain-${ref.id}.png`).join(', ')}`)
  }

  if (wanted('speed')) {
    // radianceScale 0.5 on smooth recipes: time at 1080p 1x, look against full resolution, preview against 4K export.
    const smoothScenes = [
      { recipe: 'sunset.ramp', seed: 3 },
      { recipe: 'sunset.blooms', seed: 3 },
      { recipe: 'contour.beam', seed: 3 },
    ]
    const usable = smoothScenes.filter(loads)
    const median = async (request) => {
      const runs = []
      for (let i = 0; i < 3; i++) runs.push((await harness.call('measure', request)).measured)
      return runs.sort((a, b) => a - b)[1]
    }
    const rows = []
    let ok = usable.length > 0
    for (const base of usable) {
      const scene = { ...base, output: { grain: 0 } }
      const fullMs = await median({ scene, width: 1920, height: 1080, supersample: 1 })
      const halfMs = await median({ scene, width: 1920, height: 1080, supersample: 1, radianceScale: 0.5 })
      const full = await harness.render({ scene, width: 960, height: 540, dither: false })
      const preview = await harness.render({ scene, width: 960, height: 540, dither: false, radianceScale: 0.5 })
      const big = await harness.render({ scene, width: 3840, height: 2160, dither: false, radianceScale: 0.5 })
      const shrunk = await resizeRgba(big, 960, 540, 'lanczos3')
      const look = compareImages(full, preview, buildMask(960, 540, [], 0)).metrics.deltaE
      const match = compareImages(preview, shrunk, buildMask(960, 540, [], 0)).metrics.deltaE
      ok &&= look.p95 < 0.004 && match.mean < 0.004 && match.p95 < 0.01
      rows.push(
        `${base.recipe}: ${fullMs.toFixed(1)} -> ${halfMs.toFixed(1)} ms at 1920x1080 1x; vs full resolution p95 ${look.p95.toFixed(4)}; preview vs 4K export mean ${match.mean.toFixed(4)} p95 ${match.p95.toFixed(4)}`,
      )
    }
    const skipped = notLoaded(smoothScenes)
    if (usable.length === 0) skip('radianceScale 0.5: faster, same look, preview matches 4K export', `not loaded: ${skipped.join(', ')}`)
    else record('radianceScale 0.5: faster, same look, preview matches 4K export', ok, `${rows.join('; ')}${skipped.length ? `; not loaded: ${skipped.join(', ')}` : ''}`)
  }

  if (wanted('context')) {
    const outcomes = await harness.call('contextLoss', { program: 'test.lens', seed: 1 })
    const lost = Object.values(outcomes).every((message) => message.startsWith('WebGL context lost'))
    record(
      'lost context: readPixels, render and a new renderer on that canvas throw "WebGL context lost"',
      lost,
      Object.entries(outcomes).map(([call, message]) => `${call}: ${message}`).join('; '),
    )
    const timing = await harness.call('measure', { scene: { program: 'test.scatter', seed: 3 }, width: 1920, height: 1080, supersample: 1 })
    record(
      'measure: render waits for the GPU when asked',
      timing.measuredFlag && timing.measured >= timing.issued * 0.5,
      `1920x1080 at 1x: ${timing.issued.toFixed(2)} ms to issue, ${timing.measured.toFixed(2)} ms with measure`,
    )
  }

  if (wanted('aspect')) {
    // Preview sizes as the tool makes them (the format fitted in whole pixels) next to export sizes, and a reference
    // frame that is no format.
    const frames = [
      { name: '16:9 export', width: 3840, height: 2160, expected: 3840 / 2160 },
      { name: '16:9 preview', width: 1597, height: 898, expected: 3840 / 2160 },
      { name: '9:16 preview', width: 506, height: 899, expected: 2160 / 3840 },
      { name: '1:1 preview', width: 897, height: 898, expected: 1 },
      { name: '4:5 export', width: 3072, height: 3840, expected: 3072 / 3840 },
      { name: '4:5 preview', width: 717, height: 897, expected: 3072 / 3840 },
      { name: 'reference', width: 925, height: 1002, expected: 925 / 1002 },
    ]
    const seen = await harness.call('aspectProbe', frames.map(({ width, height }) => ({ width, height })))
    const rows = frames.map((frame, i) => {
      const values = Object.values(seen[i]).flat()
      const ok = values.length === 4 && values.every((value) => value === frame.expected)
      return { ok, text: `${frame.name} ${frame.width}x${frame.height}: ${[...new Set(values)].map((v) => v.toFixed(6)).join(', ')}${ok ? '' : ` (want ${frame.expected.toFixed(6)} in all 4)`}` }
    })
    record(
      "frame aspect: uniforms, radianceScale, post passes and scatter radii get the format's exact aspect at preview and export sizes",
      rows.every((row) => row.ok),
      rows.map((row) => row.text).join('; '),
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

    // Halation: fed by each channel's own light above nominal after exposure (red in full, green 0.3, blue 0).
    const halSize = { width: 480, height: 270 }
    const halLens = { bloom: 0, halation: 1, halationRadius: 0.05 }
    const halPair = async (params, output = {}) => {
      const scene = { program: 'test.halation', params, output }
      const off = await harness.render({ scene: { ...scene, lens: noLens }, ...halSize, dither: false })
      const on = await harness.render({ scene: { ...scene, lens: halLens }, ...halSize, dither: false })
      const added = [0, 0, 0]
      let largest = 0
      for (let i = 0; i < on.data.length; i += 4) {
        for (let k = 0; k < 3; k++) {
          added[k] += (SRGB_TO_LINEAR[on.data[i + k]] - SRGB_TO_LINEAR[off.data[i + k]]) / (on.data.length / 4)
          largest = Math.max(largest, Math.abs(on.data[i + k] - off.data[i + k]))
        }
      }
      return { off, on, added, largest }
    }
    const only = (light, gain) => ({ blue: 0, white: 0, orange: 0, [light]: gain })
    const blue4 = await halPair(only('blue', 4))
    const blue8 = await halPair(only('blue', 8))
    const white4 = await halPair(only('white', 4))
    const orange4 = await halPair(only('orange', 4))
    const nominal = await halPair({ blue: 1, white: 1, orange: 1 })
    const exposed = await halPair({ blue: 1, white: 1, orange: 1 }, { exposure: 2 })
    const all = await halPair({ blue: 4, white: 4, orange: 4 })
    const bright = await halPair({ blue: 4, white: 4, orange: 4, background: 0.6 })
    await composeRow(path.join(outDir, 'lens-halation.png'), [
      { image: all.off, caption: 'blue disk, white line, orange dot at 4x, halation off' },
      { image: all.on, caption: 'the same, halation 1' },
      { image: blue8.on, caption: 'blue disk alone at 8x, halation 1' },
    ])
    await composeRow(path.join(outDir, 'lens-halation-2.png'), [
      { image: nominal.on, caption: 'all at nominal, halation 1' },
      { image: exposed.on, caption: 'all at nominal with exposure +2, halation 1' },
      { image: bright.on, caption: 'all at 4x on a bright background, halation 1' },
    ])
    const fmt = (rgb) => rgb.map((v) => v.toFixed(5)).join(', ')
    record(
      'halation: blue lights at 4x and 8x make no warm halo',
      Math.max(...blue4.added, ...blue8.added) < 2e-5,
      `added linear light (R, G, B): 4x ${fmt(blue4.added)}; 8x ${fmt(blue8.added)}; images in lens-halation.png`,
    )
    record(
      'halation: white-hot and orange lights keep a red-orange halo',
      white4.added[0] > 1e-3 && white4.added[1] > 0 && white4.added[0] > 2 * white4.added[1] && orange4.added[0] > 5e-4,
      `added linear light (R, G, B): white 4x ${fmt(white4.added)}; orange 4x ${fmt(orange4.added)}`,
    )
    record(
      'halation: nothing from nominal light; exposure counts before the threshold',
      nominal.largest === 0 && exposed.added[0] > 1e-3,
      `nominal: largest change ${nominal.largest} code values; nominal with exposure +2 adds ${fmt(exposed.added)}; images in lens-halation-2.png`,
    )
    record(
      'halation: held back where the wide surroundings are bright',
      bright.added[0] < 0.6 * all.added[0],
      `added red light, the same lights at 4x: ${all.added[0].toFixed(5)} on black, ${bright.added[0].toFixed(5)} on a 0.6 grey background (${((bright.added[0] / all.added[0]) * 100).toFixed(0)} %)`,
    )
    record('lens images written', true, path.relative(ROOT, path.join(outDir, 'lens.png')))

    // Vignette: a flat grey at strength 1 keeps its center and falls to a quarter (two stops) in the corners.
    const grey = '#808080'
    const greyLinear = hexToLinear(grey)[0]
    const frame = { width: 960, height: 540 }
    const vignetted = await harness.render({ scene: { program: 'test.flat', colors: [grey], lens: { ...noLens, vignette: 1 }, output: { grain: 0 } }, ...frame, dither: false })
    const ratioAt = (x, y) => srgbToLinear(vignetted.data[(y * frame.width + x) * 4] / 255) / greyLinear
    const axes = [frame.width, frame.height].map((v) => v / Math.min(frame.width, frame.height))
    const expectedAt = (x, y) => {
      const q = [((2 * (x + 0.5)) / frame.width - 1) * axes[0], ((2 * (y + 0.5)) / frame.height - 1) * axes[1]]
      return (1 + (q[0] ** 2 + q[1] ** 2) / (axes[0] ** 2 + axes[1] ** 2)) ** -2
    }
    const points = [
      [frame.width / 2, frame.height / 2],
      [0, 0],
      [frame.width - 1, frame.height - 1],
      [frame.width / 2, 0],
      [0, frame.height / 2],
    ]
    const worstVignette = Math.max(...points.map(([x, y]) => Math.abs(ratioAt(x, y) / expectedAt(x, y) - 1)))
    let falls = true
    let previous = Infinity
    for (let t = 0; t <= 1; t += 0.01) {
      const value = vignetted.data[(Math.round((frame.height - 1) * (0.5 + 0.5 * t)) * frame.width + Math.round((frame.width - 1) * (0.5 + 0.5 * t))) * 4]
      if (value > previous) falls = false
      previous = value
    }
    const vignetteScene = { program: 'test.glows', lens: { ...noLens, vignette: 1 }, output: { grain: 0 } }
    const vignetteSmall = await harness.render({ scene: vignetteScene, width: 925, height: 1002, dither: false })
    const vignetteLarge = await harness.render({ scene: vignetteScene, width: 3546, height: 3840, dither: false })
    const vignetteMatch = compareImages(vignetteSmall, await resizeRgba(vignetteLarge, 925, 1002, 'lanczos3'), buildMask(925, 1002, [], 0)).metrics.deltaE
    record(
      'vignette: two stops in the corners at 1, the center untouched, a smooth fall, the same at every output size',
      worstVignette < 0.03 && Math.abs(ratioAt(points[0][0], points[0][1]) - 1) < 0.01 && falls && vignetteMatch.mean < 0.004,
      `flat ${grey} at 960x540: center ${ratioAt(...points[0]).toFixed(3)}, corners ${ratioAt(...points[1]).toFixed(3)} and ${ratioAt(...points[2]).toFixed(3)}, ` +
        `long-edge middle ${ratioAt(...points[3]).toFixed(3)}, short-edge middle ${ratioAt(...points[4]).toFixed(3)} of the grey (worst off the formula ${(worstVignette * 100).toFixed(1)} %); ` +
        `${falls ? 'falls without a step along the diagonal' : 'rises somewhere along the diagonal'}; 925 px vs 3840 px mean ${vignetteMatch.mean.toFixed(4)}`,
    )
    const vignetteRows = [{ scene: { program: 'test.flat', colors: [grey], output: { grain: 0 } }, label: `flat ${grey}` }]
    const rampScene = { recipe: 'sunset.ramp', seed: 3 }
    if (loads(rampScene)) vignetteRows.push({ scene: rampScene, label: 'sunset.ramp defaults' })
    for (const [index, { scene, label }] of vignetteRows.entries()) {
      const panels = []
      for (const vignette of [0, 0.5, 1]) {
        const image = await harness.render({ scene: { ...scene, lens: { ...(scene.lens ?? {}), vignette } }, width: 640, height: 360 })
        panels.push({ image, caption: `${label}, vignette ${vignette}` })
      }
      await composeRow(path.join(outDir, `lens-vignette-${index}.png`), panels)
    }
    record('vignette images written', true, `lens-vignette-0.png (flat grey), lens-vignette-1.png (sunset.ramp) at vignette 0, 0.5 and 1`)
  }
} finally {
  await harness.close()
}

const failed = results.filter((r) => !r.pass)
const skipped = results.filter((r) => r.skipped)
await writeFile(path.join(outDir, 'report.json'), JSON.stringify({ seconds: (Date.now() - started) / 1000, results }, null, 2))
console.log(
  `\n${results.length - failed.length - skipped.length}/${results.length} passed${skipped.length ? `, ${skipped.length} skipped` : ''} in ${((Date.now() - started) / 1000).toFixed(1)} s; images in ${path.relative(ROOT, outDir)}/`,
)
process.exitCode = failed.length ? 1 : 0
