import { describe, expect, it } from 'vitest'
import { getPack } from '@/light/color/packs'
import { BLUE_LIGHT, blendSharesOf, blueLight, LIN, oklab, rulesFor, sharesOf } from '../scripts/light/lib/color-read.mjs'

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

describe('near-black in the shares (compare round 41)', () => {
  const linearOf = (hex: string) => [1, 3, 5].map((i) => LIN[parseInt(hex.slice(i, i + 2), 16)])
  const hexOf = (packId: 'bold' | 'elemental' | 'atmospheric', name: string) => getPack(packId).colors.find((c) => c.name === name)!.hex
  // The hex's own color dimmed in linear light to Oklab lightness L.
  const dim = (hex: string, L: number) => {
    const [r, g, b] = linearOf(hex)
    const k = (L / oklab([r, g, b])[0]) ** 3
    return [r, g, b].map((v) => encode(v * k))
  }
  const bytes = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  // A frame of two halves, left and right.
  const halves = (left: number[], right: number[]) => {
    const rgb = new Uint8Array(W * H * 3)
    for (let p = 0; p < W * H; p++) rgb.set(p % W < W / 2 ? left : right, 3 * p)
    return rgb
  }
  const boldRules = rulesFor(getPack('bold'))

  it('counts a color dimmed toward black for less, down to nothing at L 0.15', () => {
    const cyan = bytes(hexOf('bold', 'Cyan'))
    const at = (L: number) => {
      const rgb = halves(cyan, dim(hexOf('bold', 'Meta Blue'), L))
      const r = sharesOf(boldRules, rgb, W * H, true)
      expect(r.labels?.[W - 1]).toBe('Meta Blue')
      return r
    }
    expect(at(0.45).shares['Meta Blue']).toBeCloseTo(0.5, 2)
    const navy = at(0.25)
    expect(navy.shares['Meta Blue']).toBeCloseTo(1 / 3, 1)
    expect(navy.shares.Cyan).toBeCloseTo(2 / 3, 1)
    expect(navy.lit).toBe(1)
    expect(at(0.16).shares['Meta Blue']).toBeLessThan(0.03)
  })

  it('counts each hex fully, the dark ones (Forest, Plum) too', () => {
    const rules = rulesFor(getPack('elemental'))
    for (const dark of ['Forest', 'Plum']) {
      const s = sharesOf(rules, halves(bytes(hexOf('elemental', 'Lime')), bytes(hexOf('elemental', dark))), W * H).shares
      expect(s[dark]).toBeCloseTo(0.5, 2)
    }
  })

  it("counts Atmospheric's greys fully, Near-black darker than its hex too", () => {
    const rules = rulesFor(getPack('atmospheric'))
    const r = sharesOf(rules, halves(bytes(hexOf('atmospheric', 'Ice')), dim(hexOf('atmospheric', 'Near-black'), 0.2)), W * H, true)
    expect(r.labels?.[W - 1]).toBe('Near-black')
    expect(r.shares['Near-black']).toBeCloseTo(0.5, 2)
  })

  it('leaves black under L 0.15 out of the shares, in every pack', () => {
    const r = sharesOf(boldRules, halves([0, 0, 0], bytes(hexOf('bold', 'Cyan'))), W * H)
    expect(r.lit).toBeCloseTo(0.5, 2)
    expect(r.shares.Cyan).toBeCloseTo(1, 2)
  })

  it('weighs the blend-aware reading the same way', () => {
    const rgb = halves(bytes(hexOf('bold', 'Cyan')), dim(hexOf('bold', 'Meta Blue'), 0.25))
    const labels = sharesOf(boldRules, rgb, W * H, true).labels ?? []
    expect(blendSharesOf(boldRules, rgb, W, H, labels).shares['Meta Blue']).toBeCloseTo(1 / 3, 1)
  })
})
