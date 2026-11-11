import { MEET_GLSL } from '../engine/meet'
import { DIM_TURN, PAIR_GAP, PAIR_PRESENT, PAIR_THIN, PAIR_WIDTH } from './stageSolve'

/**
 * How much lighter than its grid cell a pixel is (a thin bright line in a dim cell) where a dark color starts and
 * finishes dropping out on the pixel's own light (soft blend).
 */
const LINE_LIGHTER = [0.04, 0.12] as const

/** The light (cube root of luminance before the tone curve; shown, about Oklab L 0.065 to 0.125) over which the soft blend's color comes in from neutral. */
const NEAR_BLACK = [0.045, 0.085] as const

/**
 * Oklab hue gap (degrees) over which two neighbours' colors at a pixel's light count as turned far apart, from none to
 * all: Yellow dimmed into Orange-red beside Cyan is 160 degrees or more from it, and the short way round is no longer
 * the way through green, so there the pair meets as far hues do.
 */
const NEIGHBOUR_TURNED = [135, 160] as const
/** Oklab chroma over lightness under which a color is too near grey to steer the hue of a neighbours' hand-over (Ice). */
const NEIGHBOUR_HUEFUL = [0.01, 0.04] as const

/**
 * The color stage in GLSL: `vec3 colorStage(vec2 uv, vec3 radiance)` keeps each pixel's luminance and gives it
 * the colors of the color fields (two textures of four fields on the stage grid, one per color), weighted and added like
 * overlapping light. Each color is shown the way the engine draws a light of it at that lightness (its ramp, measured
 * from the tone curve: Meta Blue runs navy, Meta Blue, a lighter blue, white), so a color keeps its own hue from dim to
 * bright and goes white only where the design does. Yellow dims like fire into Orange-red; light colors (Cyan, Lime,
 * Ice, Tan) go only where the design is about as light, dark colors only where it is as dim. Where two colors far
 * apart in hue meet, the line goes neutral; in a look colored by its parts it goes white and its light rises along that
 * thin line (the meeting lines, owner 2026-11-10), so the meeting reads lighter, not grey. Needs LUMA, sampleSmooth4
 * and bsplineWeights from the chunk library, and uExposureScale from the engine.
 */
export const COLOR_STAGE_GLSL = /* glsl */ `
${MEET_GLSL}
uniform sampler2D uMixFieldsA;
uniform sampler2D uMixFieldsB;
uniform sampler2D uMixRamps;
uniform int uMixCount;
uniform vec4 uMixColor[5];
uniform vec4 uMixTurn[5];
uniform vec4 uMixField[5];
uniform int uMixFar;
uniform int uMixNbr;
uniform float uMixSharp;
uniform float uMixBridge;
uniform float uMixNarrow;
uniform float uMixSoft;
uniform vec2 uMixBridgeSize;
uniform float uMixSwatch;
uniform vec4 uMixSwatchAt[5];
uniform vec4 uMixBody[5];
uniform vec4 uMixTone;
uniform float uMixToneTop;

const int MIX_RAMP_STEPS = 32;

// The meeting lines on the stage grid (in the ramp texture below its five rows: the spill in red, the dark lines in
// green, the bright meetings' lift in blue), read with the same cubic B-spline as the fields (sampleSmooth4), from 16
// texels.
vec3 mixBridgeAt(vec2 uv) {
  if (uMixBridgeSize.x < 0.5) return vec3(0.0);
  vec2 st = uv * uMixBridgeSize - 0.5;
  vec2 f = fract(st);
  ivec2 base = ivec2(floor(st)) - 1;
  vec4 wx = bsplineWeights(f.x);
  vec4 wy = bsplineWeights(f.y);
  ivec2 last = ivec2(uMixBridgeSize) - 1;
  vec3 sum = vec3(0.0);
  for (int j = 0; j < 4; j++) {
    int y = clamp(base.y + j, 0, last.y);
    vec3 row = vec3(0.0);
    for (int i = 0; i < 4; i++) row += wx[i] * texelFetch(uMixRamps, ivec2(clamp(base.x + i, 0, last.x), 5 + y), 0).rgb;
    sum += wy[j] * row;
  }
  return sum;
}

float mixFieldValue(int index, vec4 a, vec4 b) {
  vec4 src = index < 4 ? a : b;
  int c = index < 4 ? index : index - 4;
  return c == 0 ? src.x : c == 1 ? src.y : c == 2 ? src.z : src.w;
}

// A dark color fades out above its edge, a light color below it, over the lightness its fade gives (uMixTurn.zw).
float mixMask(int k, float L) {
  float kind = uMixColor[k].a;
  float edge = uMixTurn[k].y;
  if (kind > 2.5) return 1.0 - smoothstep(edge - uMixTurn[k].w, edge + uMixTurn[k].z, L);
  if (kind > 1.5) return smoothstep(edge - uMixTurn[k].w, edge + uMixTurn[k].z, L);
  return 1.0;
}

// The color the engine shows for a light of color k at luminance y (after exposure), at luminance 1.
vec3 mixRamp(int k, float y) {
  float x = pow(clamp(y, 0.0, 1.0), 1.0 / 3.0) * float(MIX_RAMP_STEPS - 1);
  int i = int(floor(x));
  int j = min(i + 1, MIX_RAMP_STEPS - 1);
  vec3 c = mix(texelFetch(uMixRamps, ivec2(i, k), 0).rgb, texelFetch(uMixRamps, ivec2(j, k), 0).rgb, x - float(i));
  return c / max(dot(c, LUMA), 1e-6);
}

// A color that dims into its neighbor turns into it below its edge; a light color with a dim end (Lime's Forest) does so
// only where that dim end is present (near, 0 to 1), over the wide turn DIM_TURN.
vec3 mixColorAt(int k, float L, float y, float near) {
  vec3 c = mixRamp(k, y);
  if (uMixTurn[k].x < -0.5) return c;
  float edge = uMixTurn[k].y;
  float t = 0.0;
  if (uMixColor[k].a > 0.5 && uMixColor[k].a < 1.5) t = 1.0 - smoothstep(edge - uMixTurn[k].w, edge + uMixTurn[k].z, L);
  else if (uMixColor[k].a > 1.5 && uMixColor[k].a < 2.5) t = near * (1.0 - smoothstep(edge - ${DIM_TURN[1].toFixed(4)}, edge + ${DIM_TURN[0].toFixed(4)}, L));
  return mix(c, mixRamp(int(uMixTurn[k].x + 0.5), y), t);
}

// A color's Oklab hue (radians) and its chroma over its lightness (how far from grey it is at any light).
vec2 mixHueSat(vec3 c) {
  vec3 lab = meetOklab(c);
  return vec2(atan(lab.z, lab.y), length(lab.yz) / max(lab.x, 1e-4));
}

// The signed hue turn (radians) from hue a to hue b, the short way round.
float mixTurn(float a, float b) {
  return mod(b - a + ${(3 * Math.PI).toFixed(8)}, ${(2 * Math.PI).toFixed(8)}) - ${Math.PI.toFixed(8)};
}

// How much colors i and j count as far apart at this pixel: a far pair (uMixFar) all; a pair of neighbours in the hue
// order only where their colors at this light have turned far apart (NEIGHBOUR_TURNED).
float mixPairFar(int i, int j, vec2 hs[5]) {
  if (((uMixFar >> (i * 5 + j)) & 1) == 1) return 1.0;
  if (((uMixNbr >> (i * 5 + j)) & 1) == 0) return 0.0;
  float hueful = smoothstep(${NEIGHBOUR_HUEFUL[0].toFixed(4)}, ${NEIGHBOUR_HUEFUL[1].toFixed(4)}, min(hs[i].y, hs[j].y));
  return hueful * smoothstep(radians(${NEIGHBOUR_TURNED[0].toFixed(1)}), radians(${NEIGHBOUR_TURNED[1].toFixed(1)}), abs(mixTurn(hs[i].x, hs[j].x)));
}

// Neighbours in the pack's hue order hand over through the hue between them (owner, 2026-11-11: Cyan through green
// into Yellow, Meta Blue through indigo into Plum). Each pair of neighbours sharing the pixel gives its own middle: the
// two colors' Oklab lightness and chroma averaged by their shares, and the hue turned the short way from one to the
// other by the same shares, so the middle keeps its color at the picture's own lightness instead of going grey-green
// or brown as a mix in linear light does. A near-grey color (Ice) barely steers the hue, so Meta Blue fades into Ice in
// its own hue. Colors that are not neighbours never steer a middle. The middles are averaged by how much each pair
// shares the pixel and take as much of the pixel as the neighbours' share of all the pair weights; the rest keeps the
// plain mix. Every weight changes smoothly with the shares, so no line forms where one color overtakes another.
// Returns a color at luminance 1.
vec3 mixNeighbours(vec3 plain, vec3 c[5], vec2 hs[5], float q[5]) {
  vec3 plainUnit = plain / max(dot(plain, LUMA), 1e-6);
  if (uMixNbr == 0) return plainUnit;
  float close = 0.0;
  float pairs = 0.0;
  vec3 lab = vec3(0.0);
  float chroma = 0.0;
  for (int i = 0; i < 5; i++) {
    if (i >= uMixCount) continue;
    for (int j = 0; j < 5; j++) {
      if (j <= i || j >= uMixCount) continue;
      float w = q[i] * q[j];
      pairs += w;
      if (((uMixNbr >> (i * 5 + j)) & 1) == 0) continue;
      w *= 1.0 - mixPairFar(i, j, hs);
      if (w <= 1e-12) continue;
      close += w;
      float a = q[j] / max(q[i] + q[j], 1e-12);
      vec3 li = meetOklab(c[i]);
      vec3 lj = meetOklab(c[j]);
      float si = (1.0 - a) * smoothstep(0.0, ${NEIGHBOUR_HUEFUL[1].toFixed(4)}, hs[i].y);
      float sj = a * smoothstep(0.0, ${NEIGHBOUR_HUEFUL[1].toFixed(4)}, hs[j].y);
      float hue = hs[i].x + (si + sj > 1e-9 ? sj / (si + sj) : a) * mixTurn(hs[i].x, hs[j].x);
      float cm = mix(length(li.yz), length(lj.yz), a);
      lab += w * vec3(mix(li.x, lj.x, a), cm * cos(hue), cm * sin(hue));
      chroma += w * cm;
    }
  }
  if (close <= 1e-12) return plainUnit;
  lab /= close;
  float len = length(lab.yz);
  if (len > 1e-6) lab.yz *= (chroma / close) / len;
  vec3 polar = max(meetFromOklab(lab), vec3(0.0));
  return mix(plainUnit, polar / max(dot(polar, LUMA), 1e-6), clamp(close / max(pairs, 1e-12), 0.0, 1.0));
}

// A look colored by its parts (owner, 2026-11-11 2:37 PM): each color shows near its own swatch (uMixSwatchAt: Oklab
// lightness and luminance) across its area, and keeps some of the design's light there (uMixBody, coordinator
// 3:12 PM): from the design lightness x it shows at its swatch, and brighter design light takes it lighter by up to y
// (Oklab L), one to one at first. Under x it fades to black with the design's own falloff, at the design's own
// lightness at the outer edge and lighter or darker toward its swatch nearer x. The light takes a
// color toward white in the design's brightest part (uMixTone.zw, at most uMixToneTop of the way), along the color's
// own ramp, so each color reads as its swatch with the design's depth in it. Neighbours in the hue order hand over
// through the hue between them (mixNeighbours). Returns radiance.
vec3 colorSwatch(vec2 uv, float yE) {
  vec4 fa = sampleSmooth4(uMixFieldsA, uv);
  vec4 fb = sampleSmooth4(uMixFieldsB, uv);
  float Ld = pow(yE, 1.0 / 3.0);
  float high = uMixToneTop * smoothstep(uMixTone.z, uMixTone.w, Ld);
  vec3 own[5];
  vec2 hs[5];
  float q[5];
  float s = 0.0;
  for (int k = 0; k < 5; k++) {
    own[k] = vec3(1.0);
    hs[k] = vec2(0.0);
    q[k] = 0.0;
    if (k >= uMixCount) continue;
    q[k] = max(mixFieldValue(int(uMixField[k].x + 0.5), fa, fb), 0.0);
    s += q[k];
  }
  float ys[5];
  for (int k = 0; k < 5; k++) {
    ys[k] = 0.0;
    if (k >= uMixCount) continue;
    q[k] = s > 1e-9 ? q[k] / s : 1.0 / float(uMixCount);
    float L0 = max(uMixSwatchAt[k].x, 1e-4);
    vec4 body = uMixBody[k];
    float reach = max(body.y, 1e-4);
    float from = max(body.x, 1e-4);
    float Lk = Ld < from ? Ld * pow(L0 / from, Ld / from) : L0 + reach * tanh((Ld - from) / reach);
    Lk += high * (1.0 - Lk);
    ys[k] = uMixSwatchAt[k].y * pow(max(Lk, 0.0) / L0, 3.0);
    own[k] = mixRamp(k, ys[k]);
    hs[k] = mixHueSat(own[k]);
  }
  // Two colors far apart in hue (not neighbours) that share a pixel would mix into mauve or grey: their shares sharpen
  // there, so they meet along a narrow soft line.
  float far = 0.0;
  for (int i = 0; i < 5; i++) {
    for (int j = 0; j < 5; j++) {
      if (j <= i || j >= uMixCount) continue;
      far += 4.0 * q[i] * q[j] * mixPairFar(i, j, hs);
    }
  }
  float g = 1.0 + 3.0 * smoothstep(0.05, 0.3, min(far, 1.0));
  float t = 0.0;
  for (int k = 0; k < 5; k++) {
    if (k >= uMixCount) continue;
    q[k] = pow(q[k], g);
    t += q[k];
  }
  vec3 plain = vec3(0.0);
  float y = 0.0;
  for (int k = 0; k < 5; k++) {
    if (k >= uMixCount) continue;
    q[k] /= max(t, 1e-9);
    plain += q[k] * own[k];
    y += q[k] * ys[k];
  }
  return mixNeighbours(plain, own, hs, q) * y / max(uExposureScale, 1e-8);
}

vec3 colorStage(vec2 uv, vec3 radiance) {
  vec3 rad = max(radiance, vec3(0.0));
  float y = dot(rad, LUMA);
  if (uMixCount <= 0 || y <= 1e-8) return radiance;
  float yE = y * uExposureScale;
  if (uMixSwatch > 0.5) return colorSwatch(uv, yE);
  vec4 fa = sampleSmooth4(uMixFieldsA, uv);
  vec4 fb = sampleSmooth4(uMixFieldsB, uv);
  // On a meeting line of two far hues, every color's share meets softly (meetColors5): in light enough for a white
  // middle to read as white (meetBridgeLit) through white, and the light rises (meetBridgeLight); in dim light, where a
  // lifted middle would still read grey, each color dims toward its own dark shade and they meet near black
  // (meetDarkLight), so there is no dark line where the picture is lit. A light color meeting a dark color far from it
  // in hue (the second line) only ever takes the dark half. A bright meeting's light rises at least to the lighter
  // color's (the third line), without whitening the colors further. With the soft blend the rise and the whitening
  // follow the pixel's own split between far hues (below), never a band's body.
  vec3 lines = mixBridgeAt(uv);
  float line = lines.x;
  float lit = meetBridgeLit(yE);
  float bridge = line * lit;
  float rise = max(bridge, lines.z * lit);
  float onLine = smoothstep(0.0, 1.0, bridge);
  float dark = max(line, lines.y) * (1.0 - lit);
  float onDark = smoothstep(0.0, 1.0, dark);
  float yDark = meetDarkLight(yE, dark);
  // With the soft blend the lightness masks key on the light as the picture shows it: the pixel's own light and the
  // glow the lens adds round brighter light (fb.y), so a dark color stays where the picture is dim.
  float L = pow(uMixSoft > 0.5 ? yE + max(fb.y, 0.0) : yE, 1.0 / 3.0);
  float p[5];
  float s = 0.0;
  float bestValue = -1.0;
  int best = 0;
  // With the soft blend, where a light color that fades out below its own lightness and a dark color are both
  // present, and their fades nearly meet or the light crosses the gap between them in a thin strip (fb.z: how much
  // the light changes per grid cell), their masks meet at the lightness between the fades (pairedMasks in
  // stageSolve), so they hand over directly along the light with no strip of a third color.
  float pairMask[5];
  float near[5];
  for (int k = 0; k < 5; k++) {
    pairMask[k] = 0.0;
    near[k] = 0.0;
  }
  if (uMixSoft > 0.5) {
    for (int j = 0; j < 5; j++) {
      if (j >= uMixCount || uMixColor[j].a < 1.5 || uMixColor[j].a > 2.5) continue;
      // A light color with a dim end keeps its light down its falloff where the dim end is present.
      if (uMixTurn[j].x > -0.5) {
        int n = int(uMixTurn[j].x + 0.5);
        near[j] = smoothstep(${PAIR_PRESENT[0].toFixed(4)}, ${PAIR_PRESENT[1].toFixed(4)}, mixFieldValue(int(uMixField[n].x + 0.5), fa, fb));
        pairMask[j] = near[j];
      }
      float low = uMixTurn[j].y - uMixTurn[j].w;
      float presentJ = smoothstep(${PAIR_PRESENT[0].toFixed(4)}, ${PAIR_PRESENT[1].toFixed(4)}, mixFieldValue(int(uMixField[j].x + 0.5), fa, fb));
      for (int k = 0; k < 5; k++) {
        if (k >= uMixCount || uMixColor[k].a < 2.5) continue;
        float high = uMixTurn[k].y + uMixTurn[k].z;
        float pair = low - high <= ${PAIR_GAP.toFixed(4)} ? 1.0 : 1.0 - smoothstep(${PAIR_THIN[0].toFixed(4)}, ${PAIR_THIN[1].toFixed(4)}, (low - high) / max(fb.z, 1e-4));
        if (pair <= 0.0) continue;
        float presentK = smoothstep(${PAIR_PRESENT[0].toFixed(4)}, ${PAIR_PRESENT[1].toFixed(4)}, mixFieldValue(int(uMixField[k].x + 0.5), fa, fb));
        float at = 0.5 * (low + high);
        float above = smoothstep(at - ${PAIR_WIDTH.toFixed(4)}, at + ${PAIR_WIDTH.toFixed(4)}, L);
        pairMask[j] = max(pairMask[j], pair * presentK * above);
        pairMask[k] = max(pairMask[k], pair * presentJ * (1.0 - above));
      }
    }
  }
  // Each color as it shows at this light, and its hue, for neighbours' hand-over (mixNeighbours, mixPairFar).
  vec3 own[5];
  vec2 hs[5];
  for (int k = 0; k < 5; k++) {
    own[k] = vec3(1.0);
    hs[k] = vec2(0.0);
    if (k >= uMixCount) continue;
    own[k] = mixColorAt(k, L, yE, near[k]);
    hs[k] = mixHueSat(own[k]);
  }
  for (int k = 0; k < 5; k++) {
    p[k] = 0.0;
    if (k >= uMixCount) continue;
    // The soft blend's shares already keep each color to its lightness on the grid; here a color only drops out
    // where it can't show at all (a thin bright line in a dim cell), so its own share isn't thinned.
    float mask = max(mixMask(k, L), pairMask[k]);
    // A dark color drops out on a pixel's own light only where the pixel is much lighter than its grid cell (fb.w: a
    // thin bright line in a dim cell). Elsewhere its share already follows the cell's light, which falls off smoothly,
    // so it meets a light in a soft, rounded blend, not in a V along the ridge of light a line makes.
    if (uMixSoft > 0.5 && uMixColor[k].a > 2.5) mask = mix(1.0, mask, smoothstep(${LINE_LIGHTER[0].toFixed(4)}, ${LINE_LIGHTER[1].toFixed(4)}, L - fb.w));
    float f = max(mixFieldValue(int(uMixField[k].x + 0.5), fa, fb), 0.0) * (uMixSoft > 0.5 ? smoothstep(0.0, 0.25, mask) : mask);
    if (f > bestValue) {
      bestValue = f;
      best = k;
    }
    p[k] = pow(max(uMixField[k].y * f, 0.0), uMixSharp);
    s += p[k];
  }
  if (s <= 1e-30) {
    for (int k = 0; k < 5; k++) p[k] = k == best ? 1.0 : 0.0;
    s = 1.0;
  }
  // With the soft blend, two far hues sharing a pixel at mid lightness or in pale light would mix into grey, lavender
  // or pink: their shares sharpen there, so that meeting stays narrow and a warm band keeps its color up to it. Near
  // black, at white and between near hues it stays soft.
  if (uMixSoft > 0.5) {
    float far = 0.0;
    for (int i = 0; i < 5; i++) {
      for (int j = 0; j < 5; j++) {
        if (j <= i || j >= uMixCount) continue;
        far += 4.0 * p[i] * p[j] / (s * s) * mixPairFar(i, j, hs);
      }
    }
    float mid = smoothstep(0.25, 0.4, L) * (1.0 - smoothstep(0.65, 0.9, L));
    float g = 1.0 + (1.0 - max(onLine, onDark)) * mid * smoothstep(0.05, 0.3, min(far, 1.0));
    float t = 0.0;
    for (int k = 0; k < 5; k++) {
      if (k >= uMixCount) continue;
      p[k] = pow(p[k] / s, g);
      t += p[k];
    }
    s = max(t, 1e-30);
    // Where two far hues share the pixel (4 pi pj), the lighter color's light spills over the darker one: each color's
    // share counts by its own brightness, as much as the two overlap, so across the overlap the lighter color holds
    // most of it and fades into the darker one, with no white line and no lift along the meeting.
    float split = 0.0;
    for (int i = 0; i < 5; i++) {
      for (int j = 0; j < 5; j++) {
        if (j <= i || j >= uMixCount) continue;
        if (uMixColor[i].a > 2.5 || uMixColor[j].a > 2.5) continue;
        split += 4.0 * p[i] * p[j] / (s * s) * mixPairFar(i, j, hs);
      }
    }
    float spill = min(split, 1.0);
    float u = 0.0;
    for (int k = 0; k < 5; k++) {
      if (k >= uMixCount) continue;
      p[k] *= mix(1.0, uMixField[k].z, spill);
      u += p[k];
    }
    s = max(u, 1e-30);
    bridge = 0.0;
    rise = 0.0;
    onLine = 0.0;
  }
  // Each side keeps its own color up to the meeting line (shares squared); with the soft blend (uMixSoft) the
  // shares already say how gradually one color changes into the next, and are drawn as they are.
  vec3 m = vec3(0.0);
  float s2 = 0.0;
  float pp = 0.0;
  float qk[5];
  for (int k = 0; k < 5; k++) {
    qk[k] = 0.0;
    if (k >= uMixCount) continue;
    p[k] /= s;
    float q = uMixSoft > 0.5 ? p[k] : p[k] * p[k];
    s2 += q;
    pp += p[k] * p[k];
    qk[k] = q;
    m += q * own[k];
  }
  m /= max(s2, 1e-6);
  m = mixNeighbours(m, own, hs, qk);
  // In a look colored by its parts (uMixNarrow) the neutral line where far hues meet is narrower (shares squared).
  float b = 0.0;
  for (int i = 0; i < 5; i++) {
    for (int j = 0; j < 5; j++) {
      if (j <= i || j >= uMixCount) continue;
      if (((uMixFar >> (i * 5 + j)) & 1) == 0) continue;
      b += uMixNarrow > 0.5 ? 4.0 * p[i] * p[i] * p[j] * p[j] / max(pp * pp, 1e-12) : 4.0 * p[i] * p[j];
    }
  }
  b = min(b, 1.0);
  // Far hues meet through neutral along a narrow line, so they never mix into mauve, indigo or teal.
  // With the soft blend the line whitens only where the design is light; in the dim it would read as a grey line.
  if (uMixSoft < 0.5) m = mix(m, vec3(1.0), uMixBridge * b * b);
  if (onLine > 0.0 || onDark > 0.0) {
    // On a dark line each color is taken at the dimmed light, so it follows its own dim path (its ramp and turn).
    float yAt = mix(yE, yDark, onDark);
    float LAt = pow(uMixSoft > 0.5 ? yAt + max(fb.y, 0.0) : yAt, 1.0 / 3.0);
    vec3 cs[5];
    float qs[5];
    for (int k = 0; k < 5; k++) {
      cs[k] = k < uMixCount ? mixColorAt(k, LAt, yAt, near[k]) : vec3(1.0);
      qs[k] = k < uMixCount ? (uMixSoft > 0.5 ? p[k] : p[k] * p[k]) : 0.0;
    }
    vec3 met = meetColors5(cs, qs, uMixCount, 1.5);
    m = mix(m / max(dot(m, LUMA), 1e-6), met / max(dot(met, LUMA), 1e-6), max(onLine, onDark));
  }
  // With the soft blend, in the last few 8-bit levels above black, where no hue can be seen, the color goes to neutral,
  // so a dark color's tiny share can't flip a dim room's last levels between navy and plum as a part moves.
  if (uMixSoft > 0.5) m = mix(vec3(1.0), m / max(dot(m, LUMA), 1e-6), smoothstep(${NEAR_BLACK[0].toFixed(4)}, ${NEAR_BLACK[1].toFixed(4)}, pow(yE, 1.0 / 3.0)));
  // The design's luminance, whatever the colors and the mix, so the light and dark layout never moves; only a meeting
  // line's light rises (in light) or dims (in dim light).
  return m / max(dot(m, LUMA), 1e-6) * y * meetBridgeLight(yE, rise) / max(yE, 1e-8) * yDark / max(yE, 1e-8);
}
`
