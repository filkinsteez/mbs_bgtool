import { describe, expect, it } from 'vitest'
import { EXACT, exactRead, exactRules, readPixel } from '../scripts/light/lib/exact-read.mjs'
import { oklab, LIN } from '../scripts/light/lib/color-read.mjs'
import { dimPaths } from '../src/light/engine/dimPath'
import { meetApart, meetHueApart } from '../src/light/engine/meet'

const bold = {
  colors: [
    { name: 'Meta Blue', hex: '#0064E0' },
    { name: 'Cyan', hex: '#1FCDF0' },
    { name: 'Yellow', hex: '#FFD61E' },
    { name: 'Orange-red', hex: '#FF4F00' },
  ],
}
const apart = (a: number[], b: number[]) => Math.max(meetApart(a, b), meetHueApart(a, b))
const rules = exactRules(bold, dimPaths(bold.colors.map((c) => c.hex)), apart)
const lin = (hex: string) => [1, 3, 5].map((i) => LIN[parseInt(hex.slice(i, i + 2), 16)])
const toSrgb = (v: number) => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)))
const read = (rgbLinear: number[]) => {
  const [L, a, b] = oklab(rgbLinear as [number, number, number])
  return readPixel(rules, L, a, b)
}

describe('exact pack colors', () => {
  it('reads each hex as itself, and its dimmer light as a pack color', () => {
    bold.colors.forEach((c, k) => expect(read(lin(c.hex))).toMatchObject({ kind: 'exact', k }))
    expect(read(lin('#0064E0').map((v) => v * 0.4))).toMatchObject({ kind: 'exact', k: 0 })
    expect(read(lin('#FF4F00').map((v) => v * 0.6))).toMatchObject({ kind: 'exact', k: 3 })
    // Dim Cyan that keeps its own hue, where the dim path turns it toward Meta Blue, reads as a blend of the two.
    expect(['exact', 'blend']).toContain(read(lin('#1FCDF0').map((v) => v * 0.6)).kind)
    // Yellow dimmed at its own hue (olive) is off its dim path, which turns it toward Orange-red.
    expect(read(lin('#FFD61E').map((v) => v * 0.4))).toMatchObject({ kind: 'other' })
  })

  it('counts a blend of two near hues for both and a mix of far-apart hues as off-pack', () => {
    const blue = lin('#0064E0')
    const cyan = lin('#1FCDF0')
    const yb = 0.2126 * blue[0] + 0.7152 * blue[1] + 0.0722 * blue[2]
    const yc = 0.2126 * cyan[0] + 0.7152 * cyan[1] + 0.0722 * cyan[2]
    // About Cyan's own lightness, where neither color's own line reaches the blend's hue.
    const half = blue.map((v, i) => (0.5 * v) / yb + (0.5 * cyan[i]) / yc).map((v) => v * 0.45)
    expect(read(half)).toMatchObject({ kind: 'blend', i: 0, j: 1 })
    expect(rules.far).toContainEqual([0, 3])
    const red = lin('#FF4F00')
    const pink = red.map((v, i) => 0.5 * v + 0.5 * blue[i])
    expect(read(pink)).toMatchObject({ kind: 'other' })
  })

  it('reads a color far toward white as pale', () => {
    const blue = lin('#0064E0')
    const pale = blue.map((v) => 0.25 * v + 0.75 * 0.9)
    expect(read(pale)).toMatchObject({ kind: 'pale', k: 0 })
  })

  it("reads Atmospheric's light greys as its colors, not as another color's pale", () => {
    const atmospheric = {
      colors: [
        { name: 'Meta Blue', hex: '#0064E0' },
        { name: 'Ice', hex: '#F2F4F7' },
        { name: 'Steel', hex: '#6A7788' },
        { name: 'Slate', hex: '#384753' },
        { name: 'Near-black', hex: '#1C2B33' },
      ],
    }
    const greys = exactRules(atmospheric, dimPaths(atmospheric.colors.map((c) => c.hex)), apart)
    for (const hex of ['#D9DDE2', '#C4C9D0', '#B0B6BE', '#8A939E']) {
      const [L, a, b] = oklab(lin(hex) as [number, number, number])
      expect(['exact', 'blend'], hex).toContain(readPixel(greys, L, a, b).kind)
    }
    // A pale blue reads as Ice or as Meta Blue and Ice mixing as light (near in hue); in Bold, without Ice, it is pale
    // Meta Blue.
    const [L, a, b] = oklab(lin('#D5E2FA') as [number, number, number])
    expect(['exact', 'blend']).toContain(readPixel(greys, L, a, b).kind)
    expect(readPixel(rules, L, a, b)).toMatchObject({ kind: 'pale', k: 0 })
  })

  it('tells a thin line between far-apart colors from a wide off-pack area', () => {
    const W = 200
    const H = 100
    const frame = (mid: (x: number) => number[]) => {
      const px = new Uint8Array(W * H * 3)
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const c = mid(x).map(toSrgb)
          px.set(c, 3 * (y * W + x))
        }
      return px
    }
    const blue = lin('#0064E0')
    const red = lin('#FF4F00')
    const pink = red.map((v, i) => 0.5 * v + 0.5 * blue[i])
    const thin = exactRead(rules, frame((x) => (x < 99 ? blue : x > 100 ? red : pink)), W, H)
    expect(thin.lines).toBeGreaterThan(0.009)
    expect(thin.wide).toBe(0)
    const wide = exactRead(rules, frame((x) => (x < 60 ? blue : x > 140 ? red : pink)), W, H)
    expect(wide.wide).toBeGreaterThan(0.3)
    expect(wide.exact['Meta Blue']).toBeGreaterThan(0.25)
    expect(EXACT.ramp).toBeCloseTo(1 / 3)
  })
})
