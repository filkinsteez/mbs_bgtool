// Images as { w, h, data: Float32Array(w * h * 3) } in display-linear RGB.
import sharp from 'sharp'
import { decode8, linearToSrgb } from './color.mjs'
import { hash3, unit } from './noise.mjs'

export async function readLinear(path) {
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const out = new Float32Array(info.width * info.height * 3)
  for (let i = 0; i < out.length; i++) out[i] = decode8(data[i])
  return { w: info.width, h: info.height, data: out }
}

/** Exact sRGB encode, TPDF dither of about +-1 LSB (as the engine's output pass), 8-bit. */
export function encode8(img, seed = 1) {
  const { w, h, data } = img
  const out = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      for (let c = 0; c < 3; c++) {
        const v = Math.min(1, Math.max(0, data[i + c]))
        const s = linearToSrgb(v) * 255
        const t = unit(hash3(x, y, seed * 3 + c)) + unit(hash3(x, y, seed * 3 + c + 101)) - 1
        const edge = Math.min(Math.min(1, Math.max(0, s / 0.5)), 1 - Math.min(1, Math.max(0, (s - 254.5) / 0.5)))
        const u = unit(hash3(x, y, seed * 3 + c)) - 0.5
        const d = s + (edge * t + (1 - edge) * u)
        out[i + c] = Math.min(255, Math.max(0, Math.floor(d + 0.5)))
      }
    }
  }
  return out
}

export async function writeImage(img, path, seed = 1) {
  const buf = encode8(img, seed)
  await sharp(buf, { raw: { width: img.w, height: img.h, channels: 3 } }).png().toFile(path)
  return buf
}

export function decodeBuffer(buf, w, h) {
  const data = new Float32Array(w * h * 3)
  for (let i = 0; i < data.length; i++) data[i] = decode8(buf[i])
  return { w, h, data }
}

export const cloneImage = (img) => ({ w: img.w, h: img.h, data: new Float32Array(img.data) })
