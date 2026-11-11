/**
 * Where two lights meet: one rule for the looks, the color stage and the engine's glow (coordinator, 2026-11-10
 * 8:45 PM).
 *
 * - Lights add: meetLight's luminance is the two lights' luminance added, so where two overlap the meeting is lighter
 *   than either alone.
 * - Near hues (within 45 degrees round white) mix as plain light: the luminance-weighted mix of their colors.
 * - Far hues (90 degrees or more) never average into a third color. The light that gives more light here leads,
 *   counted as its luminance times how bright its own color is as a light, so Yellow leads over Meta Blue at the same
 *   light. Its color goes toward white as the other light catches up and is white where the two give the same; past
 *   that the other color leads. A crossfade between far hues runs from one color through the brighter one's pale tint
 *   and white into the other, never through grey, magenta or olive. Between 45 and 90 degrees the two rules blend.
 *
 * Each light is its color at full strength (linear RGB; a pack hex in linear light, so the rule can tell which color is
 * brighter) and how much of it reaches the pixel (0 to 1, or any amount): its light here is the color times the
 * amount, and the lead goes by that light's luminance. A caller that keeps its own luminance (the color stage, a look
 * that designs lightness apart from hue) takes meetColor, which is at luminance 1, and scales it; a caller whose
 * lights add takes meetLight, whose luminance is the two lights' luminance added.
 */
import type { Rgb } from '../color/srgb'

/** How sharply the lead passes from one far hue to the other: each light's share counts to this power. */
export const MEET_SHARPNESS = 4
/**
 * Where a meeting is not light, the white where far hues hand over would read as grey, so there the hand-over is
 * narrower, which also makes it a crisper edge: the sharpness for a meeting whose displayed luminance is y runs from
 * MEET_SHARPNESS_DIM at MEET_DIM[0] and below (OKLab L 0.67) to MEET_SHARPNESS at MEET_DIM[1] and above (L 0.91)
 * (meetSharpness). A look that makes its meetings lighter (overlapping lights add) gets soft, light hand-overs.
 */
export const MEET_SHARPNESS_DIM = 24
export const MEET_DIM = [0.3, 0.75] as const

/** The hand-over's sharpness for a meeting shown at luminance y (after exposure). */
export function meetSharpness(y: number): number {
  const t = Math.min(1, Math.max(0, (y - MEET_DIM[0]) / (MEET_DIM[1] - MEET_DIM[0])))
  return MEET_SHARPNESS_DIM + (MEET_SHARPNESS - MEET_SHARPNESS_DIM) * t * t * (3 - 2 * t)
}

const LUMA = [0.2126, 0.7152, 0.0722] as const
const luminanceOf = (c: readonly number[]) => LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2]

/** How far apart two colors at luminance 1 are in hue round white: 0 within 45 degrees, 1 from 90 degrees. */
export function meetApart(a: readonly number[], b: readonly number[]): number {
  const ca = a.map((v) => v - 1)
  const cb = b.map((v) => v - 1)
  const na = Math.hypot(ca[0], ca[1], ca[2])
  const nb = Math.hypot(cb[0], cb[1], cb[2])
  if (na < 1e-3 || nb < 1e-3) return 0
  const t = Math.min(1, Math.max(0, (ca[0] * cb[0] + ca[1] * cb[1] + ca[2] * cb[2]) / (na * nb) / 0.7))
  return 1 - t * t * (3 - 2 * t)
}

/**
 * The color where light `la` of color `ca` meets light `lb` of color `cb`, at luminance 1 (CPU twin of the GLSL
 * meetColor). `sharp` sets how narrow the hand-over between far hues is.
 */
export function meetColor(ca: readonly number[], la: number, cb: readonly number[], lb: number, sharp = MEET_SHARPNESS): Rgb {
  const ya = luminanceOf(ca)
  const yb = luminanceOf(cb)
  if (yb <= 1e-9) return (ya <= 1e-9 ? [1, 1, 1] : ca.map((v) => v / ya)) as Rgb
  if (ya <= 1e-9) return cb.map((v) => v / yb) as Rgb
  const ua = ca.map((v) => v / ya)
  const ub = cb.map((v) => v / yb)
  const ra = Math.max(la, 0) * ya
  const rb = Math.max(lb, 0) * yb
  if (ra + rb <= 0) return ua.map((v, i) => 0.5 * (v + ub[i])) as Rgb
  const plain = ua.map((v, i) => (ra * v + rb * ub[i]) / (ra + rb))
  const apart = meetApart(ua, ub)
  if (apart <= 0) return plain as Rgb
  const top = Math.max(ra, rb)
  const qa = (ra / top) ** sharp
  const qb = (rb / top) ** sharp
  const lead = qa / (qa + qb)
  const d = (2 * lead - 1) * (2 * lead - 1)
  const tint = meetTint(lead >= 0.5 ? ua : ub, d)
  return plain.map((v, i) => v + (tint[i] - v) * apart) as Rgb
}

const meetOklab = (c: readonly number[]) => {
  const cbrt = (v: number) => Math.sign(v) * Math.abs(v) ** (1 / 3)
  const l = cbrt(0.4122214708 * c[0] + 0.5363325363 * c[1] + 0.0514459929 * c[2])
  const m = cbrt(0.2119034982 * c[0] + 0.6806995451 * c[1] + 0.1073969566 * c[2])
  const s = cbrt(0.0883024619 * c[0] + 0.2817188376 * c[1] + 0.6299787005 * c[2])
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}

const meetFromOklab = ([L, a, b]: readonly number[]) => {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
}

/**
 * Reds and oranges pale through yellow, as the tone curve whitens them (a red that kept its hue would pale through
 * pink): the OKLCh hue band (hue plus 30 degrees, as the tone curve's TONE_FIRE) where the tint turns toward
 * MEET_PALE_YELLOW, and the hue it turns to (degrees).
 */
const MEET_FIRE = [0, 30, 85, 115] as const
const MEET_PALE_YELLOW = 95

const meetSmooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * A color at luminance 1 tinted toward white: `d` of its color is kept (1 the color, 0 white). Mixed in OKLab, so a
 * cool color's tint keeps its hue (mixed in linear light, a blue's tint turns violet); a red or orange turns toward
 * yellow as it pales. Brought back to luminance 1.
 */
function meetTint(u: readonly number[], d: number): number[] {
  if (d >= 1) return [u[0], u[1], u[2]]
  const lab = meetOklab(u)
  const hue = Math.atan2(lab[2], lab[1])
  const deg = (((hue * 180) / Math.PI + 390) % 360 + 360) % 360
  const fire = meetSmooth(MEET_FIRE[0], MEET_FIRE[1], deg) * (1 - meetSmooth(MEET_FIRE[2], MEET_FIRE[3], deg))
  const toYellow = ((((MEET_PALE_YELLOW * Math.PI) / 180 - hue + 3 * Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI
  const turned = hue + toYellow * fire * (1 - d) ** 0.35
  const chroma = Math.hypot(lab[1], lab[2]) * d
  const mixed = meetFromOklab([1 + (lab[0] - 1) * d, chroma * Math.cos(turned), chroma * Math.sin(turned)]).map((v) => Math.max(v, 0))
  const y = luminanceOf(mixed)
  return y > 1e-9 ? mixed.map((v) => v / y) : [1, 1, 1]
}

/**
 * The light where two lights meet: meetColor at the luminance of the two lights added, ca la + cb lb (CPU twin of the
 * GLSL meetLight).
 */
export function meetLight(ca: readonly number[], la: number, cb: readonly number[], lb: number, sharp = MEET_SHARPNESS): Rgb {
  const total = Math.max(la, 0) * luminanceOf(ca) + Math.max(lb, 0) * luminanceOf(cb)
  return meetColor(ca, la, cb, lb, sharp).map((v) => v * total) as Rgb
}

/**
 * GLSL: `vec3 meetColor(vec3 ca, float la, vec3 cb, float lb, float sharp)`, `meetLight` (same arguments) and
 * `float meetSharpness(float y)`. A look and the color stage may both include it in one shader; the guard keeps one
 * copy.
 */
export const MEET_GLSL = /* glsl */ `
#ifndef MEET_RULE
#define MEET_RULE 1
float meetSharpness(float y) {
  return mix(${MEET_SHARPNESS_DIM.toFixed(1)}, ${MEET_SHARPNESS.toFixed(1)}, smoothstep(${MEET_DIM[0]}, ${MEET_DIM[1]}, y));
}

float meetApart(vec3 a, vec3 b) {
  vec3 ca = a - 1.0;
  vec3 cb = b - 1.0;
  float na = length(ca);
  float nb = length(cb);
  if (na < 1e-3 || nb < 1e-3) return 0.0;
  return 1.0 - smoothstep(0.0, 0.7, dot(ca, cb) / (na * nb));
}

vec3 meetOklab(vec3 c) {
  vec3 lms = vec3(dot(c, vec3(0.4122214708, 0.5363325363, 0.0514459929)), dot(c, vec3(0.2119034982, 0.6806995451, 0.1073969566)), dot(c, vec3(0.0883024619, 0.2817188376, 0.6299787005)));
  lms = sign(lms) * pow(abs(lms), vec3(1.0 / 3.0));
  return vec3(dot(lms, vec3(0.2104542553, 0.793617785, -0.0040720468)), dot(lms, vec3(1.9779984951, -2.428592205, 0.4505937099)), dot(lms, vec3(0.0259040371, 0.7827717662, -0.808675766)));
}

vec3 meetFromOklab(vec3 lab) {
  vec3 lms = vec3(dot(lab, vec3(1.0, 0.3963377774, 0.2158037573)), dot(lab, vec3(1.0, -0.1055613458, -0.0638541728)), dot(lab, vec3(1.0, -0.0894841775, -1.291485548)));
  lms = lms * lms * lms;
  return vec3(dot(lms, vec3(4.0767416621, -3.3077115913, 0.2309699292)), dot(lms, vec3(-1.2684380046, 2.6097574011, -0.3413193965)), dot(lms, vec3(-0.0041960863, -0.7034186147, 1.707614701)));
}

// A color at luminance 1 tinted toward white, d of its color kept, mixed in OKLab: a cool color keeps its hue, a red
// or orange turns toward yellow as it pales (meetTint in meet.ts).
vec3 meetTint(vec3 u, float d) {
  if (d >= 1.0) return u;
  vec3 lab = meetOklab(u);
  float hue = atan(lab.z, lab.y);
  float deg = mod(degrees(hue) + 390.0, 360.0);
  float fire = smoothstep(${MEET_FIRE[0].toFixed(1)}, ${MEET_FIRE[1].toFixed(1)}, deg) * (1.0 - smoothstep(${MEET_FIRE[2].toFixed(1)}, ${MEET_FIRE[3].toFixed(1)}, deg));
  float toYellow = mod(radians(${MEET_PALE_YELLOW.toFixed(1)}) - hue + ${(3 * Math.PI).toFixed(8)}, ${(2 * Math.PI).toFixed(8)}) - ${Math.PI.toFixed(8)};
  float turned = hue + toYellow * fire * pow(1.0 - d, 0.35);
  float chroma = length(lab.yz) * d;
  vec3 mixed = max(meetFromOklab(vec3(1.0 + (lab.x - 1.0) * d, chroma * cos(turned), chroma * sin(turned))), 0.0);
  float y = dot(mixed, vec3(${LUMA.join(', ')}));
  return y > 1e-9 ? mixed / y : vec3(1.0);
}

vec3 meetColor(vec3 ca, float la, vec3 cb, float lb, float sharp) {
  float ya = dot(ca, vec3(${LUMA.join(', ')}));
  float yb = dot(cb, vec3(${LUMA.join(', ')}));
  if (yb <= 1e-9) return ya <= 1e-9 ? vec3(1.0) : ca / ya;
  if (ya <= 1e-9) return cb / yb;
  vec3 ua = ca / ya;
  vec3 ub = cb / yb;
  float ra = max(la, 0.0) * ya;
  float rb = max(lb, 0.0) * yb;
  if (ra + rb <= 0.0) return 0.5 * (ua + ub);
  vec3 plain = (ra * ua + rb * ub) / (ra + rb);
  float apart = meetApart(ua, ub);
  if (apart <= 0.0) return plain;
  float top = max(ra, rb);
  float qa = pow(ra / top, sharp);
  float qb = pow(rb / top, sharp);
  float lead = qa / (qa + qb);
  float d = (2.0 * lead - 1.0) * (2.0 * lead - 1.0);
  return mix(plain, meetTint(lead >= 0.5 ? ua : ub, d), apart);
}

vec3 meetLight(vec3 ca, float la, vec3 cb, float lb, float sharp) {
  vec3 luma = vec3(${LUMA.join(', ')});
  return meetColor(ca, la, cb, lb, sharp) * (max(la, 0.0) * dot(ca, luma) + max(lb, 0.0) * dot(cb, luma));
}
#endif
`
