import { linearToOklch } from '../../color/oklab'
import type { Rgb } from '../../color/srgb'
import { toneCurve } from '../../engine/output'

const luma = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

/** Upper bound of the solved strength; pairs that need more than this to reach the lighter end get this much. */
const MAX_BRIDGE = 2.5

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** A light warm color: red through yellow (Oklab hue at most 110° or at least 330°) with some chroma, lighter than mid grey. Dark plums and browns are bases, not warm light. */
export function isWarm(color: Rgb): boolean {
  const [L, C, h] = linearToOklch(color)
  return L > 0.5 && C > 0.04 && (h <= 110 || h >= 330)
}

/** A pale member of a color's light family (Beer-Lambert power p < 1), scaled to luminance 1. */
export function paleTint(color: Rgb, p = 0.12): Rgb {
  const m = Math.max(color[0], color[1], color[2], 1e-6)
  const r = color.map((v) => Math.max(v / m, 0.004) ** p)
  const y = luma(r)
  return [r[0] / y, r[1] / y, r[2] / y]
}

/** Oklab hues from magenta through pink to red: a blend that lands there between two ends that aren't, invents a pink. */
const isPinkHue = (h: number) => h >= 290 || h <= 25

function bridgeGates(a: Rgb, b: Rgb): { distant: number; olive: number; pink: number } {
  const [, ca, ha] = linearToOklch(a)
  const [, cb, hb] = linearToOklch(b)
  const half = Math.sin(((hb - ha) * Math.PI) / 360)
  const distant = smoothstep(0.2, 0.6, half * half * smoothstep(0.03, 0.08, Math.min(ca, cb)))
  const blend = (t: number) => linearToOklch([0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t))
  const muddy = (t: number) => {
    const [lm, cm, hm] = blend(t)
    return hm > 40 && hm < 140 ? smoothstep(0.11, 0.06, cm) * smoothstep(0.78, 0.6, lm) : 0
  }
  const olive = Math.max(muddy(0.25), muddy(0.5), muddy(0.75)) * smoothstep(0.03, 0.06, Math.max(ca, cb))
  const pinkAt = (t: number) => {
    const [, cm, hm] = blend(t)
    return isPinkHue(hm) ? smoothstep(0.03, 0.07, cm) : 0
  }
  const pink = isPinkHue(ha) || isPinkHue(hb) ? 0 : Math.max(pinkAt(0.3), pinkAt(0.5), pinkAt(0.7))
  return { distant, olive, pink }
}

/**
 * How much pale light to add where `a` and `b` blend so the middle of the
 * blend, after the tone curve, is as light as the lighter end. Only blends
 * that would go grey (distant hues) or olive, khaki or brown (a dim warm
 * middle) get it; near hues and grey pairs get none.
 */
export function bridgeStrength(a: Rgb, b: Rgb, haze: Rgb, gain = 1): number {
  const { distant, olive, pink } = bridgeGates(a, b)
  const gate = Math.max(distant, olive, pink)
  if (gate === 0) return 0
  const lit = (c: Rgb, k: number) => linearToOklch(toneCurve(c.map((v) => v * k)))[0]
  // A blend that would turn pink is lifted a little above the lighter end, so it reads pale instead.
  const target = Math.max(lit(a, Math.min(gain, 1)), lit(b, Math.min(gain, 1))) + 0.05 * pink
  const mid = [0, 1, 2].map((i) => ((a[i] + b[i]) / 2) * gain)
  const level = Math.sqrt(luma(a) * luma(b)) * gain
  if (linearToOklch(toneCurve(mid))[0] >= target) return 0
  let lo = 0
  let hi = MAX_BRIDGE
  for (let i = 0; i < 40; i++) {
    const k = (lo + hi) / 2
    const out = toneCurve(mid.map((v, j) => v + k * level * haze[j]))
    if (linearToOklch(out)[0] < target) lo = k
    else hi = k
  }
  return gate * ((lo + hi) / 2)
}

/**
 * Light that brings the middle of the blend from `a` to `b` to the palest
 * tint of `warm`, lighter than the lighter end: cyan and orange-red light add
 * up to near-white with a little peach. Nominal units; the lightness is
 * solved at the daylight gain.
 */
function whiteningLight(a: Rgb, b: Rgb, warm: Rgb, gain: number): Rgb {
  const tint = paleTint(warm, 0.05)
  const mid = [0, 1, 2].map((i) => (a[i] + b[i]) / 2)
  const lit = (c: Rgb, k: number) => linearToOklch(toneCurve(c.map((v) => v * k)))[0]
  const target = Math.min(0.95, Math.max(lit(a, Math.min(gain, 1)), lit(b, Math.min(gain, 1))) + 0.1)
  // The least level of the tint that covers the middle in every channel, so no channel has to be taken away.
  const floor = Math.max(...mid.map((v, i) => v / tint[i]))
  let lo = 0
  let hi = MAX_BRIDGE * 4
  for (let i = 0; i < 40; i++) {
    const k = (lo + hi) / 2
    if (lit(tint, k * gain) < target) lo = k
    else hi = k
  }
  const level = Math.max(floor, (lo + hi) / 2)
  return [0, 1, 2].map((i) => Math.max(0, level * tint[i] - mid[i])) as Rgb
}

/**
 * Pale light for the blend from `under` to `own`: at each end it is the pale
 * member of that end's own light family, so a blend from Meta Blue to a warm
 * glow passes through pale cyan-white and then cream, not lavender. Returns the
 * light at the `under` end and at the `own` end (linear RGB, already scaled by
 * the solved strength and the pair's nominal light level; the shader applies
 * the daylight gain); the shader mixes the two by the blend weight.
 */
export function bridgeEnds(under: Rgb, own: Rgb, scale: number, gain = 1): [Rgb, Rgb] {
  if (scale <= 0) return [[0, 0, 0], [0, 0, 0]]
  const { distant, olive, pink } = bridgeGates(under, own)
  const lighter = luma(own) > luma(under) ? own : under
  const warmer = isWarm(own) ? own : isWarm(under) ? under : lighter
  // A crossing whose middle would turn pink gets the light that makes it near-white with a little of the warm color.
  if (pink > 0.5 && pink >= olive) {
    const light = whiteningLight(under, own, warmer, gain)
    const k = scale * pink
    const end: Rgb = [light[0] * k, light[1] * k, light[2] * k]
    return [end, end]
  }
  // A crossing that would go olive or khaki gets only the lighter color's pale light at both ends.
  const single = olive > distant ? lighter : null
  const lo = paleTint(single ?? under)
  const hi = paleTint(single ?? own)
  const mid = [0, 1, 2].map((i) => (lo[i] + hi[i]) / 2)
  const y = luma(mid)
  const haze: Rgb = [mid[0] / y, mid[1] / y, mid[2] / y]
  const amount = scale * bridgeStrength(under, own, haze, gain) * Math.sqrt(luma(under) * luma(own))
  const end = (t: Rgb): Rgb => [(t[0] / y) * amount, (t[1] / y) * amount, (t[2] / y) * amount]
  return [end(lo), end(hi)]
}
