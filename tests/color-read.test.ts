import { describe, expect, it } from 'vitest'
import { BLUE_LIGHT, blueLight, rulesFor, sharesOf } from '../scripts/light/lib/color-read.mjs'

const bold = rulesFor({
  colors: [
    { name: 'Meta Blue', hex: '#0064E0' },
    { name: 'Cyan', hex: '#1FCDF0' },
    { name: 'Yellow', hex: '#FFD61E' },
    { name: 'Orange-red', hex: '#FF4F00' },
  ],
})
const W = 120
const H = 80
const CORE_X = 60
// Oklab lightness 0.82 and chroma 0.06, both read as `other`: at hue 275, 16 degrees from Meta Blue's 259, like the
// core of a Contour line at 320 px (compare round 32); at hue 300, a pale violet.
const PALE_NEAR_BLUE: [number, number, number] = [184, 194, 236]
const PALE_VIOLET: [number, number, number] = [202, 188, 230]
const YELLOW: [number, number, number] = [255, 214, 30]

const encode = (v: number) => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055))

// A vertical band of Meta Blue light on black, brightening toward a 1 px core of the given color.
function line(core: [number, number, number]) {
  const rgb = new Uint8Array(W * H * 3)
  for (let y = 0; y < H; y++)
    for (let x = 30; x <= CORE_X; x++) {
      const k = 0.25 + 1.05 * ((x - 30) / (CORE_X - 31)) ** 2
      rgb.set(x === CORE_X ? core : [0, encode(0.127 * k), encode(Math.min(1, 0.745 * k))], 3 * (y * W + x))
    }
  return rgb
}

function read(core: [number, number, number]) {
  const rgb = line(core)
  const labels = sharesOf(bold, rgb, W * H, true).labels ?? []
  return { core: labels[CORE_X], glow: labels[CORE_X - 1], borrowed: blueLight(bold, rgb, W, H, labels)?.borrowed }
}

describe('blueLight', () => {
  it("counts a pale core near Meta Blue's hue as Meta Blue's own light, not borrowed", () => {
    const r = read(PALE_NEAR_BLUE)
    expect(r.core).toBe('other')
    expect(r.glow).toBe('Meta Blue')
    expect(r.borrowed).toBeLessThan(BLUE_LIGHT.borrowed)
  })

  it('still counts a lighter pale violet or another pack color beside the brightest Meta Blue as borrowed', () => {
    for (const core of [PALE_VIOLET, YELLOW]) expect(read(core).borrowed).toBeGreaterThanOrEqual(BLUE_LIGHT.borrowed)
  })
})
