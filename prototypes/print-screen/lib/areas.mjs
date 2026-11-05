// The poster's four color areas, and the window of our frames nearest to each in color.
import sharp from 'sharp'

export const POSTER_FILE = new URL('../../../public/references/awe/sunset/sunset-film-poster-bands-full.png', import.meta.url).pathname

/** Size of the crops on the sheet, which is also the window matched in color. Each fits inside its poster band. */
export const CROP = { width: 352, height: 144 }

/** Name, the crop's left and top on the poster, and the band measured for strength and direction ([x, y, w, h]). */
export const POSTER_AREAS = [
  { name: 'red', crop: [304, 963], band: [64, 960, 832, 150] },
  { name: 'near black', crop: [304, 118], band: [64, 110, 832, 160] },
  { name: 'blue', crop: [304, 443], band: [64, 410, 832, 210] },
  { name: 'grey', crop: [304, 653], band: [64, 630, 832, 190] },
]

/** Our poster-sized frames (render.mjs) and their seeds, searched for the window nearest in color to each area. */
export const OUR_FRAMES = [
  { name: 'bands-bold-s2', seed: 2 },
  { name: 'bands-atmospheric-s8-i0', seed: 8 },
  { name: 'bands-atmospheric-s7', seed: 7 },
  { name: 'bands-atmospheric-s7-i25', seed: 7 },
]

export async function loadImage(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data: new Uint8Array(data) }
}

/** OUR_FRAMES as { name, seed, image } from `dir` (render.mjs's output). */
export async function loadFrames(dir) {
  return Promise.all(OUR_FRAMES.map(async (f) => ({ ...f, image: await loadImage(`${dir}${f.name}.png`) })))
}

const SRGB_TO_LINEAR = Array.from({ length: 256 }, (_, v) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
})

function oklab(image, i) {
  const r = SRGB_TO_LINEAR[image.data[i]]
  const g = SRGB_TO_LINEAR[image.data[i + 1]]
  const b = SRGB_TO_LINEAR[image.data[i + 2]]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}

/** Mean of each pixel's Oklab color over a rect, and the spread (std) of its L. */
export function meanOklab(image, x0, y0, w, h = w) {
  const sum = [0, 0, 0]
  let l2 = 0
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const c = oklab(image, (y * image.width + x) * 4)
      sum[0] += c[0]
      sum[1] += c[1]
      sum[2] += c[2]
      l2 += c[0] * c[0]
    }
  }
  const n = w * h
  const mean = sum.map((v) => v / n)
  return Object.assign(mean, { stdL: Math.sqrt(Math.max(0, l2 / n - mean[0] * mean[0])) })
}

/** Mean Oklab color of an area's crop on the poster. */
export function posterTarget(poster, area) {
  return meanOklab(poster, area.crop[0], area.crop[1], CROP.width, CROP.height)
}

/**
 * The CROP-sized window of any of `frames` ({ name, image }) nearest to `target` in mean Oklab color, counting the
 * window's own spread of L as distance too, so a dark window with a bright rim in it doesn't pass for an even one.
 * `d` is that distance, `deltaE` the color difference alone.
 */
export function nearestWindow(frames, target, step = 8) {
  const { width: w, height: h } = CROP
  let best = null
  for (const frame of frames) {
    const { width: fw, height: fh } = frame.image
    // Summed-area tables of L, a, b and L^2.
    const tables = Array.from({ length: 4 }, () => new Float64Array((fw + 1) * (fh + 1)))
    for (let y = 0; y < fh; y++) {
      const row = [0, 0, 0, 0]
      for (let x = 0; x < fw; x++) {
        const c = oklab(frame.image, (y * fw + x) * 4)
        const values = [c[0], c[1], c[2], c[0] * c[0]]
        for (let k = 0; k < 4; k++) {
          row[k] += values[k]
          tables[k][(y + 1) * (fw + 1) + x + 1] = tables[k][y * (fw + 1) + x + 1] + row[k]
        }
      }
    }
    const area = (k, x, y) => {
      const t = tables[k]
      return (t[(y + h) * (fw + 1) + x + w] - t[y * (fw + 1) + x + w] - t[(y + h) * (fw + 1) + x] + t[y * (fw + 1) + x]) / (w * h)
    }
    for (let y = 0; y + h <= fh; y += step) {
      for (let x = 0; x + w <= fw; x += step) {
        const c = [area(0, x, y), area(1, x, y), area(2, x, y)]
        const stdL = Math.sqrt(Math.max(0, area(3, x, y) - c[0] * c[0]))
        const deltaE = Math.hypot(c[0] - target[0], c[1] - target[1], c[2] - target[2])
        const d = Math.hypot(deltaE, stdL)
        if (!best || d < best.d) best = { x, y, d, deltaE, stdL, c, frame }
      }
    }
  }
  return best
}

/** An RGBA image cut to `[x, y, w, h]`. */
export function cropImage(image, [x0, y0, w, h]) {
  const data = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) data.set(image.data.subarray(((y0 + y) * image.width + x0) * 4, ((y0 + y) * image.width + x0 + w) * 4), y * w * 4)
  return { width: w, height: h, data }
}

/** A rect of `w` x `h` centred on a window, inside the frame, for measuring strength and direction on our frames. */
export function aroundWindow(window, image, w = 384, h = 256) {
  const x = Math.max(0, Math.min(image.width - w, Math.round(window.x + CROP.width / 2 - w / 2)))
  const y = Math.max(0, Math.min(image.height - h, Math.round(window.y + CROP.height / 2 - h / 2)))
  return [x, y, w, h]
}
