import { describe, expect, it } from 'vitest'
import { compare, MEET, mapsOf, meetingMask } from '../scripts/light/lib/design-maps.mjs'

const BOLD = {
  colors: [
    { name: 'Meta Blue', hex: '#0064E0' },
    { name: 'Cyan', hex: '#1FCDF0' },
    { name: 'Yellow', hex: '#FFD61E' },
    { name: 'Orange-red', hex: '#FF4F00' },
  ],
}
const W = 128
const H = 72
// Contour's limits in same-design.mjs.
const LIMITS = { layout: 0.12, light: 0.21 }
const META_BLUE: [number, number, number] = [0, 100, 224]
const YELLOW: [number, number, number] = [255, 214, 30]
const CYAN: [number, number, number] = [31, 205, 240]

const linear = (v: number) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)
const encode = (v: number) => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055))

// Meta Blue on the left half and `right` on the right, each pixel lifted toward white (in linear light) by lift(x, y).
function frame(right: [number, number, number], lift: (x: number, y: number) => number) {
  const rgb = new Uint8Array(W * H * 3)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const t = lift(x, y)
      rgb.set((x < W / 2 ? META_BLUE : right).map((v) => encode(linear(v) + (1 - linear(v)) * t)), 3 * (y * W + x))
    }
  return rgb
}

function judge(a: Uint8Array, b: Uint8Array) {
  const mask = meetingMask(BOLD, a, W, H).map((v: number, p: number) => v | meetingMask(BOLD, b, W, H)[p])
  return { masked: compare(mapsOf(a, W, H), mapsOf(b, W, H), LIMITS, mask), strict: compare(mapsOf(a, W, H), mapsOf(b, W, H), LIMITS) }
}

describe('same design: meeting lines of far-apart colors', () => {
  const plain = frame(YELLOW, () => 0)

  it('allows a thin lighter seam where Meta Blue meets Yellow', () => {
    // Four columns at the meeting lifted by up to 0.145 in Oklab lightness.
    const seam = frame(YELLOW, (x) => (Math.abs(x - (W / 2 - 0.5)) <= 1.5 ? 0.3 : 0))
    const r = judge(plain, seam)
    expect(r.masked.differs).toBe(false)
    expect(r.masked.allowed).toBeGreaterThan(0)
    expect(r.masked.layout).toBeLessThan(r.strict.layout)
  })

  it('still fails a broad lighter patch away from the meeting', () => {
    const patch = frame(YELLOW, (x, y) => (x >= 8 && x < 48 && y >= 12 && y < 60 ? 0.6 : 0))
    expect(judge(plain, patch).masked.differs).toBe(true)
  })

  it('finds no meeting line between near hues', () => {
    expect(meetingMask(BOLD, frame(CYAN, () => 0), W, H).some((v: number) => v > 0)).toBe(false)
    expect(MEET.hue).toBeGreaterThan(44)
  })
})
