import { describe, expect, it } from 'vitest'
import { getPack, HUE_ORDER } from '@/light/color/packs'
import { dimPaths } from '@/light/engine/dimPath'
import { meetApart, meetHueApart } from '@/light/engine/meet'
import { LIN, oklab, rulesFor, sharesOf } from '../scripts/light/lib/color-read.mjs'
import { exactRead, exactRules } from '../scripts/light/lib/exact-read.mjs'

type PackId = 'bold' | 'elemental' | 'atmospheric'
const N = 200

const labOf = (hex: string): number[] => {
  const [r, g, b] = [1, 3, 5].map((i) => LIN[parseInt(hex.slice(i, i + 2), 16)])
  return oklab([r, g, b])
}
const toByte = (v: number) => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)))
function srgb(L: number, a: number, b: number): number[] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map(toByte)
}
// A strip from one hex to another in Oklab: lightness and chroma move evenly, the hue the short way round.
function strip(from: string, to: string): Uint8Array {
  const [L0, a0, b0] = labOf(from)
  const [L1, a1, b1] = labOf(to)
  const [C0, C1] = [Math.hypot(a0, b0), Math.hypot(a1, b1)]
  const h0 = Math.atan2(b0, a0)
  const turn = ((((Math.atan2(b1, a1) - h0) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI
  const out = new Uint8Array(3 * N)
  for (let p = 0; p < N; p++) {
    const u = p / (N - 1)
    const C = C0 + (C1 - C0) * u
    const h = h0 + turn * u
    out.set(srgb(L0 + (L1 - L0) * u, C * Math.cos(h), C * Math.sin(h)), 3 * p)
  }
  return out
}
const hexOf = (id: PackId, name: string) => getPack(id).colors.find((c) => c.name === name)!.hex
const grey = () => new Uint8Array(3 * N).fill(128)
const apart = (a: number[], b: number[]) => Math.max(meetApart(a, b), meetHueApart(a, b))

describe('the shares reading (color-shares, palette-check)', () => {
  const shares = (id: PackId, rgb: Uint8Array, order = true) => sharesOf(rulesFor(getPack(id), order ? [...HUE_ORDER[id]] : []), rgb, N).shares

  it('counts Cyan through green into Yellow for both colors, each by where it sits', () => {
    const rgb = strip(hexOf('bold', 'Cyan'), hexOf('bold', 'Yellow'))
    const s = shares('bold', rgb)
    expect(s.other).toBeLessThan(0.05)
    expect(s.Cyan).toBeGreaterThan(0.4)
    expect(s.Yellow).toBeGreaterThan(0.4)
    expect(shares('bold', rgb, false).other).toBeGreaterThan(0.3)
  })

  it('counts Meta Blue through indigo into Plum for both colors', () => {
    const s = shares('elemental', strip(hexOf('elemental', 'Meta Blue'), hexOf('elemental', 'Plum')))
    expect(s.other).toBeLessThan(0.05)
    expect(s['Meta Blue']).toBeGreaterThan(0.35)
    expect(s.Plum).toBeGreaterThan(0.35)
  })

  it('leaves a Tan to Plum blend that turns brown, and grey, off the pack colors', () => {
    expect(shares('elemental', strip(hexOf('elemental', 'Tan'), hexOf('elemental', 'Plum'))).other).toBeGreaterThan(0.25)
    expect(shares('bold', grey()).grey).toBe(1)
  })
})

describe('the exact-color reading (exact-colors, drag-colors)', () => {
  const read = (id: PackId, rgb: Uint8Array, order = true) => {
    const pack = getPack(id)
    const r = exactRead(exactRules(pack, dimPaths(pack.colors.map((c) => c.hex)), apart, order ? [...HUE_ORDER[id]] : []), rgb, N, 1, 3)
    return { ...r, off: r.lines + r.thinOther + r.wide }
  }

  it('counts Cyan through green into Yellow for both colors, each by where it sits', () => {
    const rgb = strip(hexOf('bold', 'Cyan'), hexOf('bold', 'Yellow'))
    const r = read('bold', rgb)
    expect(r.off).toBeLessThan(0.05)
    expect(r.exact.Cyan).toBeGreaterThan(0.35)
    expect(r.exact.Yellow).toBeGreaterThan(0.35)
    expect(read('bold', rgb, false).off).toBeGreaterThan(0.3)
  })

  it('counts Meta Blue through indigo into Plum for both colors', () => {
    const r = read('elemental', strip(hexOf('elemental', 'Meta Blue'), hexOf('elemental', 'Plum')))
    expect(r.off).toBeLessThan(0.05)
    expect(r.exact['Meta Blue']).toBeGreaterThan(0.35)
    expect(r.exact.Plum).toBeGreaterThan(0.35)
  })

  it('leaves a Tan to Plum blend that turns brown, and grey, off the pack colors', () => {
    expect(read('elemental', strip(hexOf('elemental', 'Tan'), hexOf('elemental', 'Plum'))).off).toBeGreaterThan(0.25)
    expect(read('bold', grey()).off).toBe(1)
  })
})
