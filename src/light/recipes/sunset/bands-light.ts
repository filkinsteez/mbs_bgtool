import { linearToOklch, oklchToLinear } from '../../color/oklab'
import type { Rgb } from '../../color/srgb'

const luminance = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

/**
 * Light that pales a color toward white in its own hue, scaled to luminance 1:
 * what takes the color at three quarters of its strength to its own hue about
 * 0.25 Oklab L lighter. Warm light added to Meta Blue reads lavender; this
 * light first takes the blue to pale blue, as a dusk sky passes through a
 * near-neutral bridge on its way to the glow.
 */
export function paleLight(color: Rgb): Rgb {
  const [L, C, h] = linearToOklch(color)
  const pale = oklchToLinear([Math.min(0.95, L + 0.25), C * 0.45, h])
  const w: Rgb = [Math.max(0, pale[0] - 0.75 * color[0]), Math.max(0, pale[1] - 0.75 * color[1]), Math.max(0, pale[2] - 0.75 * color[2])]
  const y = luminance(w)
  return y > 1e-6 ? [w[0] / y, w[1] / y, w[2] / y] : [1, 1, 1]
}

/** A light warm color: red through yellow (Oklab hue at most 110° or at least 330°) with some chroma, lighter than mid grey. Dark plums and browns are bases, not warm light. */
export function isWarm(color: Rgb): boolean {
  const [L, C, h] = linearToOklch(color)
  return L > 0.5 && C > 0.04 && (h <= 110 || h >= 330)
}

/** A color that can be an image's light: light, with a hue from orange-red through yellow to lime. */
export function isLightColor(color: Rgb): boolean {
  const [L, C, h] = linearToOklch(color)
  return L > 0.6 && C > 0.04 && h >= 25 && h <= 135
}

/**
 * Whether light of one color can spill into the other without making a color
 * outside the pack: hues within 50 degrees (Meta Blue and Cyan, Steel and
 * Slate), or one or both near grey or white. Tan or Lime light on Forest is
 * olive, so a dark color's low chroma does not count as grey.
 */
export function closeHues(a: Rgb, b: Rgb): boolean {
  const [, ca, ha] = linearToOklch(a)
  const [, cb, hb] = linearToOklch(b)
  if ((ca < 0.04 && cb < 0.04) || ca < 0.02 || cb < 0.02) return true
  const d = Math.abs(ha - hb) % 360
  return (d > 180 ? 360 - d : d) <= 50
}

/**
 * Whether two colors meeting in a light transition mix into a color outside the
 * pack: two hues far apart (Cyan and Orange-red go pink, Meta Blue and Tan
 * lavender, Meta Blue and Lime grey), or a strong blue against near-white
 * (Meta Blue and Ice go lavender).
 */
export function needsBridge(a: Rgb, b: Rgb): boolean {
  const [, ca, ha] = linearToOklch(a)
  const [, cb, hb] = linearToOklch(b)
  if (ca > 0.06 && cb > 0.06) {
    const d = Math.abs(ha - hb) % 360
    return (d > 180 ? 360 - d : d) > 60
  }
  return (ca > 0.1 && cb < 0.02) || (cb > 0.1 && ca < 0.02)
}

/**
 * The pale light that fills the gap where two colors far apart meet (the
 * shader fades the color above out before the color below comes in, so they
 * never mix): lighter than both sides and close to neutral, yellow cream next
 * to a warm or light color (hue at least 80, since Orange-red lightened by a
 * neutral light goes salmon pink and by a cream light peach), pale sky blue
 * between cool colors.
 */
export function bridgeLight(above: Rgb, below: Rgb): Rgb {
  const [La] = linearToOklch(above)
  const [Lb] = linearToOklch(below)
  const warm = [above, below].filter((c) => isWarm(c) || isLightColor(c))
  return warm.length
    ? oklchToLinear([Math.min(0.94, Math.max(La, Lb) + 0.1), 0.06, Math.max(80, linearToOklch(warm[0])[2])])
    : oklchToLinear([Math.min(0.93, Math.max(La, Lb) + 0.03), 0.06, 245])
}
