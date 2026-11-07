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
 * so the blend passes through near neutral before the blue. With `raise`
 * below 1 green goes only that share of the way (peach-cream).
 */
export function bridgeTint(c: Rgb, raise = 1): Rgb {
  const [r, g, b] = paleTint(c)
  const t: Rgb = [r, g + (Math.max(g, r) - g) * raise, b]
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
export function skyPaleTint(sky: Rgb, toward?: Rgb, share = 0): Rgb {
  const [L, C, h] = linearToOklch(sky)
  // With `toward` (a pack's own pale sky color, such as Cyan) the pale light turns `share` of the way to its hue, so
  // the sky's pale side reads as that pack's.
  const turn = toward ? share * (((linearToOklch(toward)[2] - h + 540) % 360) - 180) : 0
  const pale = oklchToLinear([Math.min(0.95, L + 0.25 + 0.05 * share), C * (0.45 + 0.2 * share), h + turn])
  const w: Rgb = [Math.max(0, pale[0] - 0.75 * sky[0]), Math.max(0, pale[1] - 0.75 * sky[1]), Math.max(0, pale[2] - 0.75 * sky[2])]
  const y = luminance(w)
  return y > 1e-6 ? [w[0] / y, w[1] / y, w[2] / y] : [1, 1, 1]
}

/** The same light after a longer path: powers above 1 of its unit-peak color, so a dimmer warm light goes amber, not olive. */
export function deepen(c: Rgb, power: number): Rgb {
  const m = Math.max(c[0], c[1], c[2], 1e-6)
  return [m * (c[0] / m) ** power, m * (c[1] / m) ** power, m * (c[2] / m) ** power]
}

/** Weakest channel over strongest of a pale light's deep member. */
const DEEP_FLOOR = 0.25
/** A saturated light's deep member is this power of it: the longer path near the horizon. */
const DEEP_MIN_POWER = 1.3
const DEEP_MAX_POWER = 16

/**
 * The deeper, more saturated member of a light's own family: a power of its
 * unit-peak color, so its strongest channel stays and the light is not dimmed
 * in it. A pale light deepens until its weakest channel is DEEP_FLOOR of its
 * strongest (pink-white to coral, Ice to blue); a saturated one (Yellow,
 * Orange-red) goes a little deeper, as light low in the sky does.
 */
export function deepMember(c: Rgb): Rgb {
  const m = Math.max(c[0], c[1], c[2], 1e-6)
  const q = Math.min(c[0], c[1], c[2]) / m
  if (q > 0.9999) return [c[0], c[1], c[2]]
  const toFloor = q > DEEP_FLOOR ? Math.log(DEEP_FLOOR) / Math.log(q) : 1
  return deepen(c, Math.min(DEEP_MAX_POWER, Math.max(DEEP_MIN_POWER, toFloor)))
}

/** Oklab chroma above the least a bridge can reach that it settles for when it cannot reach its limit. */
const NEUTRAL_MARGIN = 0.005
/** Oklab chroma over the limit across which a bridge's chroma limit comes in. */
const NEUTRAL_EDGE = 0.02

/** Where f is least on [lo, hi], by golden-section search (f has one minimum there). */
function goldenSearch(f: (x: number) => number, lo: number, hi: number): number {
  let a = lo
  let b = hi
  for (let i = 0; i < 40; i++) {
    const x = a + (b - a) * 0.382
    const y = a + (b - a) * 0.618
    if (f(x) < f(y)) b = y
    else a = x
  }
  return 0.5 * (a + b)
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
 * How far a glow's light is from the deepened sky, 0..1: 1 for light that
 * would grey it (a hue far from the deep area's, or near-neutral light), 0
 * for light of the deep area's own hue, which only deepens its color. Far
 * light follows the sky's darker top. The deep area's color is the sky three
 * quarters of the way to the deep color.
 */
export function deepFade(sky: Rgb, deep: Rgb, glow: Rgb): number {
  return otherHue([0.25 * sky[0] + 0.75 * deep[0], 0.25 * sky[1] + 0.75 * deep[1], 0.25 * sky[2] + 0.75 * deep[2]], glow)
}

/**
 * 1 for light that would turn a colored ground's hue as it lightens it (a far
 * hue, or near-neutral light such as Ice or white over Meta Blue), 0 for light
 * of the ground's own hue (Cyan over Meta Blue mostly keeps its own color).
 */
export function otherHue(ground: Rgb, glow: Rgb): number {
  const [, cb, hb] = linearToOklch(ground)
  const [, cg, hg] = linearToOklch(glow)
  return 1 - Math.max(0, Math.cos(((hg - hb) * Math.PI) / 180)) * smoothstep(0.03, 0.08, cg) * smoothstep(0.01, 0.03, cb)
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
 * curve reaches the lighter side's Oklab L, at least `minL` and at most
 * `maxL`, and, where it can, has Oklab chroma at most `maxC`: a bridge between
 * blue and warm light is near neutral (Orange-red and blue alone make pink).
 * Pairs of near hues or with a grey end get none, so their own blend is left
 * alone.
 */
export function bridgeAmount(sky: Rgb, glow: Rgb, tint: Rgb, haze: number, maxL = Infinity, minL = 0, maxC = Infinity): number {
  const la = linearToOklch(sky)[0]
  const lb = linearToOklch(glow)[0]
  const gate = bridgeGate(sky, glow)
  if (gate === 0) return 0
  const k = balancePoint(haze)
  const mid: Rgb = [k * (sky[0] + glow[0]), k * (sky[1] + glow[1]), k * (sky[2] + glow[2])]
  const target = Math.min(Math.max(la, lb, minL), maxL)
  const lch = (amount: number) => linearToOklch(toneCurve(mid.map((v, i) => v + amount * tint[i])))
  // Smallest amount that reaches the target lightness.
  let forLight = 0
  if (lch(0)[0] < target) {
    let lo = 0
    let hi = 2
    for (let i = 0; i < 32; i++) {
      const amount = 0.5 * (lo + hi)
      if (lch(amount)[0] < target) lo = amount
      else hi = amount
    }
    forLight = 0.5 * (lo + hi)
  }
  // The amount past the chroma's peak where it comes down to maxC, or to NEUTRAL_MARGIN above the least chroma it
  // can reach where that is more than maxC. Adding pale light first raises the chroma, and near its least the chroma
  // barely changes over a wide range of amounts, so the limit comes in gradually as the peak rises NEUTRAL_EDGE
  // above the aim. Switched on at once, when the blend without pale light passed maxC, it made the amount jump
  // between neighbouring control steps.
  let forNeutral = 0
  if (Number.isFinite(maxC)) {
    const least = goldenSearch((amount) => lch(amount)[1], 0, 2)
    const goal = Math.max(maxC, lch(least)[1] + NEUTRAL_MARGIN)
    const peak = goldenSearch((amount) => -lch(amount)[1], 0, least)
    const over = smoothstep(0, NEUTRAL_EDGE, lch(peak)[1] - goal)
    if (over > 0) {
      let below = peak
      let above = least
      for (let i = 0; i < 32; i++) {
        const amount = 0.5 * (below + above)
        if (lch(amount)[1] > goal) below = amount
        else above = amount
      }
      forNeutral = over * 0.5 * (below + above)
    }
  }
  return gate * Math.max(forLight, forNeutral)
}
