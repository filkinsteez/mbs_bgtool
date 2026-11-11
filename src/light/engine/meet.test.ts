import { describe, expect, it } from 'vitest'
import { linearToOklch } from '../color/oklab'
import { hexToLinear } from '../color/srgb'
import { MEET_BRIDGE_TO, MEET_BRIDGE_WIDTH, MEET_SHARPNESS, MEET_SHARPNESS_DIM, meetApart, meetBridge, meetBridgeLight, meetColor, meetColors, meetLight, meetSharpness } from './meet'

const luminance = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
const unit = (c: readonly number[]) => c.map((v) => v / luminance(c))
const hueGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)
const color = (hex: string) => hexToLinear(hex)

describe('where two lights meet', () => {
  it('adds the light: the meeting has the luminance of both lights together', () => {
    for (const [a, b] of [['#0064E0', '#FFD61E'], ['#FFD61E', '#FF4F00'], ['#1FCDF0', '#FF4F00'], ['#D6F26C', '#4A0A3C']]) {
      for (const [la, lb] of [[0.3, 0.3], [1, 0.2], [0.05, 0.8]]) {
        const added = la * luminance(color(a)) + lb * luminance(color(b))
        expect(luminance(meetLight(color(a), la, color(b), lb)), `${a} ${b}`).toBeCloseTo(added, 9)
      }
    }
  })

  it('mixes near hues as plain light', () => {
    const yellow = color('#FFD61E')
    const orange = color('#FF4F00')
    // Yellow and Orange-red sit just at the 45-degree edge, so they blend almost entirely as plain light.
    expect(meetApart(unit(yellow), unit(orange))).toBeLessThan(0.01)
    const plain = unit(yellow.map((v, i) => 0.3 * v + 0.7 * orange[i]))
    meetColor(yellow, 0.3, orange, 0.7).forEach((v, i) => expect(Math.abs(v - plain[i])).toBeLessThan(0.02))
    const cyan = color('#1FCDF0')
    const blue = color('#0064E0')
    expect(meetApart(unit(cyan), unit(blue))).toBe(0)
    const cool = unit(cyan.map((v, i) => 0.6 * v + 0.4 * blue[i]))
    meetColor(cyan, 0.6, blue, 0.4).forEach((v, i) => expect(v).toBeCloseTo(cool[i], 9))
  })

  it('crosses far hues through the brighter color and white, never a third hue or grey', () => {
    const pairs = [
      ['#0064E0', '#FF4F00'],
      ['#1FCDF0', '#FF4F00'],
      ['#0064E0', '#FFD61E'],
      ['#1FCDF0', '#FFD61E'],
      ['#0064E0', '#D6F26C'],
      ['#0F3D33', '#4A0A3C'],
    ]
    // A warm color (red to orange) pales through yellow, as the tone curve whitens it: its allowed hues run from its
    // own toward 95 degrees.
    const onPath = (hue: number, own: number) => {
      const warm = own >= 330 || own <= 85
      const span = (95 - own + 360) % 360
      return hueGap(hue, own) < 15 || (warm && (hue - own + 360) % 360 <= span + 10)
    }
    for (const [a, b] of pairs) {
      const ha = linearToOklch(color(a))[2]
      const hb = linearToOklch(color(b))[2]
      for (let k = 0; k <= 100; k++) {
        const t = k / 100
        const out = meetColor(color(a), 1 - t, color(b), t)
        const [, chroma, hue] = linearToOklch(out)
        // Every colored step is on one of the two colors' paths; a step with little color is near white (luminance 1).
        if (chroma >= 0.03) expect(onPath(hue, ha) || onPath(hue, hb), `${a} ${b} at ${t}: ${hue.toFixed(0)}`).toBe(true)
        expect(linearToOklch(out)[0], `${a} ${b} at ${t}`).toBeGreaterThan(0.95)
      }
    }
    // No pink or magenta between Meta Blue and Orange-red, no green between Cyan and Yellow.
    for (let k = 0; k <= 100; k++) {
      const [, c1, h1] = linearToOklch(meetColor(color('#0064E0'), 1 - k / 100, color('#FF4F00'), k / 100))
      if (c1 >= 0.03) expect(h1 > 25 && h1 < 290, `Meta Blue and Orange-red at ${k / 100}: ${h1.toFixed(0)}`).toBe(true)
      const [, c2, h2] = linearToOklch(meetColor(color('#1FCDF0'), 1 - k / 100, color('#FFD61E'), k / 100))
      if (c2 >= 0.03) expect(h2 < 125 || h2 > 180, `Cyan and Yellow at ${k / 100}: ${h2.toFixed(0)}`).toBe(true)
    }
  })

  it('lets the brighter color lead at the same light, and is white where both give the same light', () => {
    const blue = color('#0064E0')
    const yellow = color('#FFD61E')
    expect(hueGap(linearToOklch(meetColor(blue, 0.5, yellow, 0.5))[2], linearToOklch(yellow)[2])).toBeLessThan(10)
    const even = luminance(yellow) / (luminance(yellow) + luminance(blue))
    meetColor(blue, even, yellow, 1 - even).forEach((v) => expect(v).toBeCloseTo(1, 9))
  })

  it('hands over narrowly in dim light, where white would read as grey', () => {
    expect(meetSharpness(0.02)).toBe(MEET_SHARPNESS_DIM)
    expect(meetSharpness(0.8)).toBe(MEET_SHARPNESS)
    const blue = color('#0064E0')
    const orange = color('#FF4F00')
    const whiteWidth = (sharp: number) => {
      let n = 0
      for (let k = 0; k <= 1000; k++) if (linearToOklch(meetColor(blue, 1 - k / 1000, orange, k / 1000, sharp))[1] < 0.03) n++
      return n / 1000
    }
    expect(whiteWidth(MEET_SHARPNESS_DIM)).toBeLessThan(0.6 * whiteWidth(MEET_SHARPNESS))
  })

  it('bridges along the line where two fields are equal, over the set width, and only where both are present', () => {
    expect(meetBridge(0.6, 0.6, 2)).toBeCloseTo(1, 9)
    // One width from the line (the difference over its slope), a Gaussian's value at one sigma.
    expect(meetBridge(0.6 + 2 * MEET_BRIDGE_WIDTH, 0.6, 2)).toBeCloseTo(Math.exp(-0.5), 9)
    expect(meetBridge(0.5, 0.6, 2)).toBeCloseTo(meetBridge(0.6, 0.5, 2), 12)
    expect(meetBridge(0.8, 0, 2)).toBe(0)
    expect(meetBridge(0.05, 0.05, 2)).toBe(0)
    // Two parts overlapping broadly (their difference small but changing slowly) get no wide bridge off the line.
    expect(meetBridge(0.62, 0.58, 0.2)).toBeLessThan(0.01)
    // The middle goes up to MEET_BRIDGE_TO, by at most twice the light, and light already that bright gets none.
    expect(meetBridgeLight(0.3, 0)).toBe(0.3)
    expect(meetBridgeLight(0.6, 1)).toBeCloseTo(MEET_BRIDGE_TO, 12)
    expect(meetBridgeLight(0.2, 1)).toBeCloseTo(0.4, 12)
    expect(meetBridgeLight(0.85, 1)).toBe(0.85)
  })

  it('lifts a crossfade between far hues softly, so its middle is lighter than both sides and near white', () => {
    const blue = color('#0064E0')
    const yellow = color('#FFD61E')
    const y = 0.25
    // Two fields crossfading over half a short side (slope of their difference: 4 per short side).
    let last = 0
    let largest = 0
    let middle = { lift: 0, x: 0 }
    for (let k = 0; k <= 1000; k++) {
      const x = k / 1000
      const fa = Math.min(1, Math.max(0, 1.5 - 2 * x))
      const lift = meetBridge(fa, 1 - fa, 4)
      largest = Math.max(largest, Math.abs(lift - last))
      last = lift
      if (lift > middle.lift) middle = { lift, x }
    }
    expect(largest).toBeLessThan(0.03)
    expect(middle.x).toBeCloseTo(0.5, 2)
    // As the color stage uses it: colors at luminance 1 weighed by their fields, so the white middle of the hand-over
    // is where the fields are equal, which is where the bridge's light is.
    const shown = meetColor(unit(blue), 0.5, unit(yellow), 0.5).map((v) => v * meetBridgeLight(y, meetBridge(0.5, 0.5, 4)))
    expect(luminance(shown)).toBeCloseTo(2 * y, 9)
    expect(linearToOklch(shown)[1]).toBeLessThan(0.02)
  })

  it('meets several colors smoothly: whole where one holds every share, white where far hues share evenly', () => {
    const blue = unit(color('#0064E0'))
    const yellow = unit(color('#FFD61E'))
    const orange = unit(color('#FF4F00'))
    const cyan = unit(color('#1FCDF0'))
    meetColors([blue, yellow, orange], [1, 0, 0]).forEach((v, i) => expect(v).toBeCloseTo(blue[i], 9))
    expect(linearToOklch(meetColors([blue, yellow], [0.5, 0.5]))[1]).toBeLessThan(0.01)
    const lime = unit(color('#D6F26C'))
    expect(linearToOklch(meetColors([cyan, orange, lime], [1 / 3, 1 / 3, 1 / 3]))[1]).toBeLessThan(0.03)
    // Near hues mix as plain light.
    const cool = cyan.map((v, i) => 0.6 * v + 0.4 * blue[i])
    meetColors([cyan, blue], [0.6, 0.4]).forEach((v, i) => expect(v).toBeCloseTo(cool[i], 9))
    // Where two lesser shares cross (Yellow and Orange-red under Meta Blue), nothing jumps.
    let last = meetColors([blue, yellow, orange], [0.55, 0.3, 0.15])
    let path = 0
    let largest = 0
    for (let k = 1; k <= 1000; k++) {
      const t = k / 1000
      const now = meetColors([blue, yellow, orange], [0.55, 0.3 - 0.15 * t, 0.15 + 0.15 * t])
      const step = Math.hypot(now[0] - last[0], now[1] - last[1], now[2] - last[2])
      path += step
      largest = Math.max(largest, step)
      last = now
    }
    expect(largest).toBeLessThan(Math.max(0.05 * path, 1e-3))
  })

  it('changes smoothly along a crossfade, with no jump where the lead passes', () => {
    for (const [a, b] of [['#0064E0', '#FF4F00'], ['#1FCDF0', '#FFD61E'], ['#0064E0', '#D6F26C']]) {
      // A jump would put a large part of the whole path into one step; here no 0.1 % step carries more than 5 %.
      let last = meetColor(color(a), 1, color(b), 0)
      let path = 0
      let largest = 0
      for (let k = 1; k <= 1000; k++) {
        const t = k / 1000
        const now = meetColor(color(a), 1 - t, color(b), t)
        const step = Math.hypot(now[0] - last[0], now[1] - last[1], now[2] - last[2])
        path += step
        largest = Math.max(largest, step)
        last = now
      }
      expect(largest / path, `${a} ${b}`).toBeLessThan(0.05)
      meetColor(color(a), 0, color(b), 1).forEach((v, i) => expect(v).toBeCloseTo(unit(color(b))[i], 9))
    }
  })
})
