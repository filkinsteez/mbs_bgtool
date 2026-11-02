import { describe, expect, it } from 'vitest'
import { deltaEOk, linearToOklab, linearToOklch, oklabToLinear, oklchToLinear } from './oklab'
import { PACKS, getPack, packHexes } from './packs'
import {
  bytesToHex,
  hexToBytes,
  hexToLinear,
  linearToHex,
  linearToSrgb,
  normalizeHex,
  srgbToLinear,
  toByte,
} from './srgb'

describe('sRGB transfer', () => {
  it('round trips every 8-bit level exactly', () => {
    for (let k = 0; k < 256; k++) {
      expect(toByte(linearToSrgb(srgbToLinear(k / 255)))).toBe(k)
    }
  })

  it('uses the piecewise curve, not gamma 2.2', () => {
    expect(srgbToLinear(0.04045)).toBeCloseTo(0.04045 / 12.92, 12)
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214041140482232, 12)
    expect(linearToSrgb(0.0031308)).toBeCloseTo(0.0031308 * 12.92, 12)
    expect(linearToSrgb(0.18)).toBeCloseTo(0.461356129500442, 12)
    expect(srgbToLinear(1)).toBe(1)
    expect(linearToSrgb(0)).toBe(0)
  })

  it('round trips hex through linear for every level of every channel', () => {
    for (let k = 0; k < 256; k++) {
      for (const bytes of [
        [k, 0, 0],
        [0, k, 0],
        [0, 0, k],
        [k, 255 - k, (k * 7) % 256],
      ]) {
        const hex = bytesToHex(bytes)
        expect(linearToHex(hexToLinear(hex))).toBe(hex)
        expect(hexToBytes(hex)).toEqual(bytes)
      }
    }
  })

  it('parses short and lowercase hex', () => {
    expect(hexToBytes('#fff')).toEqual([255, 255, 255])
    expect(hexToBytes('0064e0')).toEqual([0, 100, 224])
    expect(normalizeHex('#0064e0')).toBe('#0064E0')
    expect(() => hexToBytes('#12345')).toThrow()
  })
})

describe('Oklab', () => {
  // Reference values for the sRGB primaries from Ottosson's matrices (also used by CSS Color 4).
  const cases: [number[], number[]][] = [
    [[1, 1, 1], [1, 0, 0]],
    [[1, 0, 0], [0.627955, 0.224863, 0.125846]],
    [[0, 1, 0], [0.86644, -0.233888, 0.179498]],
    [[0, 0, 1], [0.452014, -0.032457, -0.311528]],
    [[0.5, 0.5, 0.5], [0.793701, 0, 0]],
  ]

  it('matches reference values', () => {
    for (const [rgb, lab] of cases) {
      const out = linearToOklab(rgb)
      for (let i = 0; i < 3; i++) expect(out[i]).toBeCloseTo(lab[i], 5)
    }
  })

  it('inverts', () => {
    for (const rgb of [[0.2, 0.4, 0.9], [0.01, 0.002, 0.3], [1, 0.8, 0.1]]) {
      const back = oklabToLinear(linearToOklab(rgb))
      for (let i = 0; i < 3; i++) expect(back[i]).toBeCloseTo(rgb[i], 6)
      const viaLch = oklchToLinear(linearToOklch(rgb))
      for (let i = 0; i < 3; i++) expect(viaLch[i]).toBeCloseTo(rgb[i], 6)
    }
  })

  it('gives hue in degrees and deltaE as Euclidean distance', () => {
    const [, chroma, hue] = linearToOklch([0, 0, 1])
    expect(chroma).toBeCloseTo(Math.hypot(0.032457, 0.311528), 5)
    expect(hue).toBeGreaterThan(260)
    expect(hue).toBeLessThan(270)
    expect(deltaEOk([0.5, 0.1, 0], [0.5, 0.1, 0])).toBe(0)
    expect(deltaEOk([0, 0, 0], [0.3, 0.4, 0])).toBeCloseTo(0.5, 12)
  })
})

describe('packs', () => {
  it('match the color pack slide exactly, in order', () => {
    expect(PACKS.map((pack) => [pack.id, pack.name, pack.tagline])).toEqual([
      ['bold', 'Bold', 'Blue amplified'],
      ['elemental', 'Elemental', 'Blue contextualized'],
      ['atmospheric', 'Atmospheric', 'Blue distilled'],
    ])
    expect(getPack('bold').colors).toEqual([
      { name: 'Meta Blue', hex: '#0064E0' },
      { name: 'Cyan', hex: '#1FCDF0' },
      { name: 'Yellow', hex: '#FFD61E' },
      { name: 'Orange-red', hex: '#FF4F00' },
    ])
    expect(getPack('elemental').colors).toEqual([
      { name: 'Meta Blue', hex: '#0064E0' },
      { name: 'Lime', hex: '#D6F26C' },
      { name: 'Forest', hex: '#0F3D33' },
      { name: 'Tan', hex: '#B8996E' },
      { name: 'Plum', hex: '#4A0A3C' },
    ])
    expect(getPack('atmospheric').colors).toEqual([
      { name: 'Meta Blue', hex: '#0064E0' },
      { name: 'Ice', hex: '#F2F4F7' },
      { name: 'Steel', hex: '#6A7788' },
      { name: 'Slate', hex: '#384753' },
      { name: 'Near-black', hex: '#1C2B33' },
    ])
  })

  it('stores canonical uppercase hexes that survive the linear round trip', () => {
    for (const pack of PACKS) {
      for (const hex of packHexes(pack.id)) {
        expect(normalizeHex(hex)).toBe(hex)
        expect(linearToHex(hexToLinear(hex))).toBe(hex)
      }
    }
  })
})
