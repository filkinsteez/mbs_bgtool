import { linearToOklch } from '../../color/oklab'
import type { Rgb } from '../../color/srgb'
import { toneCurve } from '../../engine/output'

const LUMA: Rgb = [0.2126, 0.7152, 0.0722]
const luminance = (c: readonly number[]) => LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2]

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** A pale member of a light color's family (powers below 1 of its unit-peak color), scaled to luminance 1. */
export function paleTint(c: Rgb, power = 0.12): Rgb {
  const m = Math.max(c[0], c[1], c[2], 1e-6)
  const r = c.map((v) => Math.max(v / m, 0.004) ** power)
  const y = luminance(r)
  return [r[0] / y, r[1] / y, r[2] / y]
}

/** The same light after a longer path: powers above 1 of its unit-peak color, so a dimmer warm light goes amber, not olive. */
export function deepen(c: Rgb, power: number): Rgb {
  const m = Math.max(c[0], c[1], c[2], 1e-6)
  return [m * (c[0] / m) ** power, m * (c[1] / m) ** power, m * (c[2] / m) ** power]
}

/** Glow weight where the glow and the sky behind its haze weigh the same: k = exp(-haze k^2). */
function balancePoint(haze: number): number {
  let lo = 0
  let hi = 1
  for (let i = 0; i < 32; i++) {
    const k = 0.5 * (lo + hi)
    if (k - Math.exp(-haze * k * k) < 0) lo = k
    else hi = k
  }
  return 0.5 * (lo + hi)
}

/**
 * Amount of pale light (times `tint`) added where a glow meets the sky. It is
 * solved so that where the two weigh the same, the result after the tone
 * curve reaches the lighter side's Oklab L. Pairs of near hues or with a grey
 * end get none, so their own blend is left alone.
 */
export function bridgeAmount(sky: Rgb, glow: Rgb, tint: Rgb, haze: number): number {
  const [la, ca, ha] = linearToOklch(sky)
  const [lb, cb, hb] = linearToOklch(glow)
  const half = Math.sin(((hb - ha) * Math.PI) / 360)
  const gate = smoothstep(0.2, 0.6, half * half * smoothstep(0.03, 0.08, Math.min(ca, cb)))
  if (gate === 0) return 0
  const k = balancePoint(haze)
  const mid: Rgb = [k * (sky[0] + glow[0]), k * (sky[1] + glow[1]), k * (sky[2] + glow[2])]
  const target = Math.max(la, lb)
  const lightness = (amount: number) => linearToOklch(toneCurve(mid.map((v, i) => v + amount * tint[i])))[0]
  if (lightness(0) >= target) return 0
  let lo = 0
  let hi = 2
  for (let i = 0; i < 32; i++) {
    const amount = 0.5 * (lo + hi)
    if (lightness(amount) < target) lo = amount
    else hi = amount
  }
  return gate * 0.5 * (lo + hi)
}
