import { describe, expect, it } from 'vitest'
import { linearToSrgb } from '../color/srgb'
import { blur } from './image'
import { buildMask } from './mask'
import { bandingScore, compareImages } from './metrics'

function ramp(width: number, height: number, dither: boolean) {
  const data = new Uint8Array(width * height * 4)
  let seed = 12345
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = linearToSrgb(0.004 + (0.02 * x) / width) * 255
      const noise = dither ? random() + random() - 1 : 0
      const byte = Math.max(0, Math.min(255, Math.round(v + noise)))
      data.set([byte, byte, byte, 255], (y * width + x) * 4)
    }
  }
  return { width, height, data }
}

describe('banding score', () => {
  it('is near 1 for an undithered slow ramp and near 0 with TPDF dither', () => {
    const mask = new Uint8Array(1024 * 32).fill(1)
    expect(bandingScore(ramp(1024, 32, false), mask)).toBeGreaterThan(0.8)
    expect(bandingScore(ramp(1024, 32, true), mask)).toBeLessThan(0.02)
  })
})

describe('mask', () => {
  it('drops rounded corners and ignore rects', () => {
    const mask = buildMask(100, 80, [{ kind: 'text', rect: [10, 10, 20, 5] }], 12)
    expect(mask[0]).toBe(0)
    expect(mask[99]).toBe(0)
    expect(mask[79 * 100]).toBe(0)
    expect(mask[50 * 100 + 50]).toBe(1)
    expect(mask[12 * 100 + 15]).toBe(0)
  })
})

describe('compare', () => {
  it('gives zero error for identical images and a positive error for a shifted color', () => {
    const a = ramp(64, 48, false)
    const mask = buildMask(64, 48, [], 0)
    expect(compareImages(a, a, mask).metrics.deltaE.max).toBe(0)
    const b = { ...a, data: a.data.map((v, i) => (i % 4 === 0 ? Math.min(255, v + 30) : v)) }
    expect(compareImages(a, b, mask).metrics.deltaE.mean).toBeGreaterThan(0.02)
  })

  it('blur keeps a flat field flat', () => {
    const flat = { width: 20, height: 10, channels: 3, data: new Float32Array(600).fill(0.25) }
    for (const v of blur(flat, 2).data) expect(v).toBeCloseTo(0.25, 6)
  })
})
