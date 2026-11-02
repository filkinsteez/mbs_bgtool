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

/** Red through yellow (Oklab hue at most 110° or at least 330°) with some chroma. */
export function isWarm(color: Rgb): boolean {
  const [, C, h] = linearToOklch(color)
  return C > 0.04 && (h <= 110 || h >= 330)
}

/** A pale member of a color's light family (Beer-Lambert power p < 1), scaled to luminance 1. */
export function paleTint(color: Rgb, p = 0.12): Rgb {
  const m = Math.max(color[0], color[1], color[2], 1e-6)
  const r = color.map((v) => Math.max(v / m, 0.004) ** p)
  const y = luma(r)
  return [r[0] / y, r[1] / y, r[2] / y]
}

/**
 * How much pale light to add where `a` and `b` blend so the middle of the
 * blend, after the tone curve, is as light as the lighter end. Only blends
 * that would go grey (distant hues) or olive, khaki or brown (a dim warm
 * middle) get it; near hues and grey pairs get none.
 */
export function bridgeStrength(a: Rgb, b: Rgb, haze: Rgb): number {
  const [la, ca, ha] = linearToOklch(a)
  const [lb, cb, hb] = linearToOklch(b)
  const half = Math.sin(((hb - ha) * Math.PI) / 360)
  const distant = smoothstep(0.2, 0.6, half * half * smoothstep(0.03, 0.08, Math.min(ca, cb)))
  const mix = (t: number) => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t)
  const muddy = (t: number) => {
    const [lm, cm, hm] = linearToOklch(mix(t))
    return hm > 40 && hm < 140 ? smoothstep(0.11, 0.06, cm) * smoothstep(0.78, 0.6, lm) : 0
  }
  const olive = Math.max(muddy(0.25), muddy(0.5), muddy(0.75)) * smoothstep(0.03, 0.06, Math.max(ca, cb))
  const gate = Math.max(distant, olive)
  if (gate === 0) return 0
  const mid = mix(0.5)
  const level = Math.sqrt(luma(a) * luma(b))
  const target = Math.max(la, lb)
  let lo = 0
  let hi = MAX_BRIDGE
  for (let i = 0; i < 40; i++) {
    const k = (lo + hi) / 2
    const lit = toneCurve(mid.map((v, j) => v + k * level * haze[j]))
    if (linearToOklch(lit)[0] < target) lo = k
    else hi = k
  }
  return gate * ((lo + hi) / 2)
}

/** Pale light (linear RGB) for bridgeLight(): haze * strength * level, where level is the geometric mean luminance of the two ends. */
export function bridgeLight(a: Rgb, b: Rgb, haze: Rgb, scale: number): Rgb {
  if (scale <= 0) return [0, 0, 0]
  const amount = scale * bridgeStrength(a, b, haze) * Math.sqrt(luma(a) * luma(b))
  return [haze[0] * amount, haze[1] * amount, haze[2] * amount]
}
