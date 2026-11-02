import { linearToOklch, oklchToLinear } from '../../color/oklab'
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

/**
 * Bridge light for a glow: its pale tint with green raised to at least its
 * red, scaled to luminance 1. Blue sky plus peach or yellow light is short of
 * green, which shows as a lavender ring; this pale yellow-white fills that,
 * so the blend passes through near neutral before the blue.
 */
export function bridgeTint(c: Rgb): Rgb {
  const [r, g, b] = paleTint(c)
  const t: Rgb = [r, Math.max(g, r), b]
  const y = luminance(t)
  return [t[0] / y, t[1] / y, t[2] / y]
}

/**
 * Light that pales the sky without turning its hue, scaled to luminance 1.
 * White added to Meta Blue in linear light reads lavender (Oklab hue 272
 * against 259); this is the light that takes a sky at three quarters of its
 * strength to its own hue about 0.25 Oklab L lighter, which for Meta Blue is
 * a pale yellow-green white.
 */
export function skyPaleTint(sky: Rgb): Rgb {
  const [L, C, h] = linearToOklch(sky)
  const pale = oklchToLinear([Math.min(0.95, L + 0.25), C * 0.45, h])
  const w: Rgb = [Math.max(0, pale[0] - 0.75 * sky[0]), Math.max(0, pale[1] - 0.75 * sky[1]), Math.max(0, pale[2] - 0.75 * sky[2])]
  const y = luminance(w)
  return y > 1e-6 ? [w[0] / y, w[1] / y, w[2] / y] : [1, 1, 1]
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
 * How much a glow's light fades over the deepened sky, 0..1: 1 for light
 * that would grey it (a hue far from the deep area's, or near-neutral
 * light), 0 for light of the deep area's own hue, which only deepens its
 * color. The deep area's color is the sky three quarters of the way to the
 * deep color.
 */
export function deepFade(sky: Rgb, deep: Rgb, glow: Rgb): number {
  const area: Rgb = [0.25 * sky[0] + 0.75 * deep[0], 0.25 * sky[1] + 0.75 * deep[1], 0.25 * sky[2] + 0.75 * deep[2]]
  const [, ca, ha] = linearToOklch(area)
  const [, cg, hg] = linearToOklch(glow)
  const same = Math.max(0, Math.cos(((hg - ha) * Math.PI) / 180)) * smoothstep(0.03, 0.08, cg) * smoothstep(0.01, 0.03, ca)
  return 1 - same
}

/** 1 for a glow whose hue is far from the sky's and both have color, 0 for near hues or a grey end. */
export function bridgeGate(sky: Rgb, glow: Rgb): number {
  const [, ca, ha] = linearToOklch(sky)
  const [, cb, hb] = linearToOklch(glow)
  const half = Math.sin(((hb - ha) * Math.PI) / 360)
  return smoothstep(0.2, 0.6, half * half * smoothstep(0.03, 0.08, Math.min(ca, cb)))
}

/**
 * Amount of pale light (times `tint`) added where a glow meets the sky. It is
 * solved so that where the two weigh the same, the result after the tone
 * curve reaches the lighter side's Oklab L, or `maxL` if that is lower. Pairs
 * of near hues or with a grey end get none, so their own blend is left alone.
 */
export function bridgeAmount(sky: Rgb, glow: Rgb, tint: Rgb, haze: number, maxL = Infinity): number {
  const la = linearToOklch(sky)[0]
  const lb = linearToOklch(glow)[0]
  const gate = bridgeGate(sky, glow)
  if (gate === 0) return 0
  const k = balancePoint(haze)
  const mid: Rgb = [k * (sky[0] + glow[0]), k * (sky[1] + glow[1]), k * (sky[2] + glow[2])]
  const target = Math.min(Math.max(la, lb), maxL)
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
