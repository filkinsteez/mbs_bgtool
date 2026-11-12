import { describe, expect, it } from 'vitest'
import { linearToOklab } from './oklab'
import { HUE_ORDER, PACKS } from './packs'
import { RAMPS, rampAtLuminance, rampFor, rampOklab, rampSteps } from './ramps'
import { hexToLinear } from './srgb'

const luminance = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

describe('pack color ramps', () => {
  const colors = PACKS.flatMap((pack) => pack.colors.map((color) => ({ ...color, pack: pack.id })))

  it('every pack color has a ramp through its own hex at its own lightness', () => {
    for (const color of colors) {
      const ramp = rampFor(color.hex, color.pack)
      expect(ramp, color.name).toBeDefined()
      const [L, a, b] = linearToOklab(hexToLinear(color.hex))
      const shade = rampOklab(ramp!, L)
      expect(Math.hypot(shade[1] - a, shade[2] - b), color.name).toBeLessThan(0.003)
    }
  })

  it('runs from black to white, lighter at every step', () => {
    for (const color of colors) {
      const ramp = rampFor(color.hex, color.pack)!
      let last = -1
      for (let L = 0; L <= 1.0001; L += 0.02) {
        const y = luminance(rampAtLuminance(ramp, Math.max(0, Math.min(1, L)) ** 3))
        expect(y, `${color.name} at ${L.toFixed(2)}`).toBeGreaterThanOrEqual(last - 1e-6)
        last = y
      }
      const steps = rampSteps(ramp, 32)
      expect([steps[93], steps[94], steps[95]].map((v) => Number(v.toFixed(3))), color.name).toEqual([1, 1, 1])
    }
  })

  it("gives Primary its own Near-black, which deepens toward slate blue, and leaves Atmospheric's teal grey as it was", () => {
    expect(rampFor('#1C2B33', 'atmospheric')).toBe(RAMPS['#1C2B33'])
    expect(rampFor('#1C2B33')).toBe(RAMPS['#1C2B33'])
    const primary = rampFor('#1C2B33', 'primary')!
    expect(primary).not.toBe(RAMPS['#1C2B33'])
    for (const L of [0.45, 0.6, 0.75]) {
      const [, a, b] = rampOklab(primary, L)
      const hue = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
      expect(hue, `hue at ${L}`).toBeGreaterThan(240)
      expect(hue, `hue at ${L}`).toBeLessThan(262)
    }
  })

  it('keeps hue neighbours apart at the same lightness in Bold and Elemental', () => {
    for (const pack of PACKS.filter((p) => p.id !== 'atmospheric')) {
      const order = HUE_ORDER[pack.id]
      for (let i = 1; i < order.length; i++) {
        const [x, y] = [order[i - 1], order[i]].map((name) => rampFor(pack.colors.find((c) => c.name === name)!.hex, pack.id)!)
        for (let L = 0.3; L <= 0.9001; L += 0.05) {
          const [p, q] = [rampOklab(x, L), rampOklab(y, L)]
          expect(Math.hypot(p[1] - q[1], p[2] - q[2]), `${order[i - 1]} and ${order[i]} at ${L.toFixed(2)}`).toBeGreaterThan(0.04)
        }
      }
    }
  })
})
