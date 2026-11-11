import { describe, expect, it } from 'vitest'
import { compare, MEET, mapsOf, meetingLines, meetingMask, meetMask } from '../scripts/light/lib/design-maps.mjs'

type RGB = [number, number, number]

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
const META_BLUE: RGB = [0, 100, 224]
const YELLOW: RGB = [255, 214, 30]
const CYAN: RGB = [31, 205, 240]

const linear = (v: number) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)
const encode = (v: number) => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055))
const toward = (c: RGB, t: number) => c.map((v) => encode(linear(v) + (1 - linear(v)) * t))

// Each pixel's color from color(x, y), lifted toward white (in linear light) by lift(x, y).
function frame(color: (x: number) => RGB, lift: (x: number, y: number) => number) {
  const rgb = new Uint8Array(W * H * 3)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) rgb.set(toward(color(x), lift(x, y)), 3 * (y * W + x))
  return rgb
}
// Meta Blue on the left half and `right` on the right.
const halves = (right: RGB) => (x: number) => (x < W / 2 ? META_BLUE : right)

// The pair judged as same-design.mjs judges it, with both frames' meeting lines, and strictly.
function judge(a: Uint8Array, b: Uint8Array) {
  const mask = meetMask([meetingLines(BOLD, a, W, H), meetingLines(BOLD, b, W, H)], W, H)
  return { masked: compare(mapsOf(a, W, H), mapsOf(b, W, H), LIMITS, mask), strict: compare(mapsOf(a, W, H), mapsOf(b, W, H), LIMITS) }
}

describe('same design: meeting lines of far-apart colors', () => {
  const plain = frame(halves(YELLOW), () => 0)

  it('allows a thin lighter seam where Meta Blue meets Yellow', () => {
    // Four columns at the meeting lifted by up to 0.145 in Oklab lightness.
    const seam = frame(halves(YELLOW), (x) => (Math.abs(x - (W / 2 - 0.5)) <= 1.5 ? 0.3 : 0))
    const r = judge(plain, seam)
    expect(r.masked.differs).toBe(false)
    expect(r.masked.allowed).toBeGreaterThan(0)
    expect(r.masked.layout).toBeLessThan(r.strict.layout)
  })

  it('still fails a broad lighter patch away from the meeting', () => {
    const patch = frame(halves(YELLOW), (x, y) => (x >= 8 && x < 48 && y >= 12 && y < 60 ? 0.6 : 0))
    expect(judge(plain, patch).masked.differs).toBe(true)
  })

  it('finds no meeting line between near hues', () => {
    expect(meetingMask(BOLD, frame(halves(CYAN), () => 0), W, H).some((v: number) => v > 0)).toBe(false)
    expect(MEET.hue).toBeGreaterThan(44)
  })

  it('keeps a broad patch failing in a frame full of meetings, since the mask stops at its cap', () => {
    // Stripes 6 px wide of a dim Meta Blue and a dim Orange-red, so every pixel is near a meeting. In a broad patch the
    // blue is lifted by up to 0.1 in Oklab lightness, which makes it lighter than the orange there.
    const stripes = (x: number): RGB => (Math.floor(x / 6) % 2 === 0 ? [0, 60, 140] : [160, 46, 0])
    const full = frame(stripes, () => 0)
    const patch = frame(stripes, (x, y) => (x >= 16 && x < 112 && y >= 12 && y < 60 && Math.floor(x / 6) % 2 === 0 ? 0.06 : 0))
    expect(meetingMask(BOLD, full, W, H).reduce((s: number, v: number) => s + v, 0)).toBeLessThanOrEqual(MEET.cap * W * H)
    expect(judge(full, patch).masked.differs).toBe(true)
    // Without the cap the meetings would mask the whole frame and the patch would pass.
    const cap = MEET.cap
    try {
      MEET.cap = 1
      expect(judge(full, patch).masked.differs).toBe(false)
    } finally {
      MEET.cap = cap
    }
  })
})
