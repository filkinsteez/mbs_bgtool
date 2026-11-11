import { MEET_GLSL } from '../engine/meet'
import { DIM_TURN, PAIR_GAP, PAIR_PRESENT, PAIR_THIN, PAIR_WIDTH } from './stageSolve'

/**
 * How much lighter than its grid cell a pixel is (a thin bright line in a dim cell) where a dark color starts and
 * finishes dropping out on the pixel's own light (soft blend).
 */
const LINE_LIGHTER = [0.04, 0.12] as const

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
uniform float uMixSharp;
uniform float uMixBridge;
uniform float uMixNarrow;
uniform float uMixSoft;
uniform vec2 uMixBridgeSize;

const int MIX_RAMP_STEPS = 32;

// The meeting lines on the stage grid (in the ramp texture below its five rows: the spill in red, the dark lines in
// green), read with the same cubic B-spline as the fields (sampleSmooth4), from 16 texels.
vec2 mixBridgeAt(vec2 uv) {
  if (uMixBridgeSize.x < 0.5) return vec2(0.0);
  vec2 st = uv * uMixBridgeSize - 0.5;
  vec2 f = fract(st);
  ivec2 base = ivec2(floor(st)) - 1;
  vec4 wx = bsplineWeights(f.x);
  vec4 wy = bsplineWeights(f.y);
  ivec2 last = ivec2(uMixBridgeSize) - 1;
  vec2 sum = vec2(0.0);
  for (int j = 0; j < 4; j++) {
    int y = clamp(base.y + j, 0, last.y);
    vec2 row = vec2(0.0);
    for (int i = 0; i < 4; i++) row += wx[i] * texelFetch(uMixRamps, ivec2(clamp(base.x + i, 0, last.x), 5 + y), 0).rg;
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

vec3 colorStage(vec2 uv, vec3 radiance) {
  vec3 rad = max(radiance, vec3(0.0));
  float y = dot(rad, LUMA);
  if (uMixCount <= 0 || y <= 1e-8) return radiance;
  float yE = y * uExposureScale;
  vec4 fa = sampleSmooth4(uMixFieldsA, uv);
  vec4 fb = sampleSmooth4(uMixFieldsB, uv);
  // On a meeting line of two far hues, every color's share meets softly (meetColors5): in light enough for a white
  // middle to read as white (meetBridgeLit) through white, and the light rises (meetBridgeLight); in dim light, where a
  // lifted middle would still read grey, each color dims toward its own dark shade and they meet near black
  // (meetDarkLight), so there is no dark line where the picture is lit. A light color meeting a dark color far from it
  // in hue (the second line) only ever takes the dark half.
  vec2 lines = mixBridgeAt(uv);
  float line = lines.x;
  float lit = meetBridgeLit(yE);
  float bridge = line * lit;
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
        if (((uMixFar >> (i * 5 + j)) & 1) == 0) continue;
        far += 4.0 * p[i] * p[j] / (s * s);
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
  }
  // Each side keeps its own color up to the meeting line (shares squared); with the soft blend (uMixSoft) the
  // shares already say how gradually one color changes into the next, and are drawn as they are.
  vec3 m = vec3(0.0);
  float s2 = 0.0;
  float pp = 0.0;
  for (int k = 0; k < 5; k++) {
    if (k >= uMixCount) continue;
    p[k] /= s;
    float q = uMixSoft > 0.5 ? p[k] : p[k] * p[k];
    s2 += q;
    pp += p[k] * p[k];
    m += q * mixColorAt(k, L, yE, near[k]);
  }
  m /= max(s2, 1e-6);
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
  m = mix(m, vec3(1.0), uMixBridge * b * b * (uMixSoft > 0.5 ? smoothstep(0.45, 0.75, L) : 1.0));
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
  // The design's luminance, whatever the colors and the mix, so the light and dark layout never moves; only a meeting
  // line's light rises (in light) or dims (in dim light).
  return m / max(dot(m, LUMA), 1e-6) * y * meetBridgeLight(yE, bridge) / max(yE, 1e-8) * yDark / max(yE, 1e-8);
}
`
