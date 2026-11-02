import { describe, expect, it } from 'vitest'
import { linearToSrgb } from '../color/srgb'
import { falloffProfile } from './falloff'
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

/** A bright vertical line on black with an exponential glow of the given length (short-side units). */
function glowLine(size: number, length: number, gain = 1) {
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.abs(x + 0.5 - size / 2) / size
      const value = d < 0.004 ? 0.9 : gain * 0.05 * Math.exp(-d / length)
      const byte = Math.round(linearToSrgb(Math.min(1, value)) * 255)
      data.set([byte, byte, byte, 255], (y * size + x) * 4)
    }
  }
  return { width: size, height: size, data }
}

describe('falloff profile', () => {
  it('measures the glow length and the render/target ratio outward from the light', () => {
    const target = glowLine(800, 0.02)
    const same = falloffProfile(target, target, null)
    for (const ratio of same.ratio) expect(ratio).toBeCloseTo(1, 6)
    expect(same.length.target).toBeGreaterThan(0.016)
    expect(same.length.target).toBeLessThan(0.024)
    const longer = falloffProfile(target, glowLine(800, 0.03), null)
    expect(longer.length.render as number).toBeGreaterThan(longer.length.target as number)
    expect(longer.ratio[3] as number).toBeGreaterThan(longer.ratio[0] as number)
    const brighter = falloffProfile(target, glowLine(800, 0.02, 2), null)
    expect(brighter.ratio[1] as number).toBeGreaterThan(1.7)
  })
})

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
