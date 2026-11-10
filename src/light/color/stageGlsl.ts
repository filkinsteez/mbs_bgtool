/**
 * The color stage in GLSL: `vec3 colorStage(vec2 uv, vec3 radiance)` keeps each pixel's luminance exactly and gives it
 * the colors of the color fields (two textures of four fields on the stage grid, one per color), weighted and added like
 * overlapping light. Each color is shown the way the engine draws a light of it at that lightness (its ramp, measured
 * from the tone curve: Meta Blue runs navy, Meta Blue, a lighter blue, white), so a color keeps its own hue from dim to
 * bright and goes white only where the design does. Yellow dims like fire into Orange-red; light colors (Cyan, Lime,
 * Ice, Tan) go only where the design is about as light, dark colors only where it is as dim. Where two colors far
 * apart in hue meet, the line goes neutral. Needs LUMA and sampleSmooth4 from the chunk library, and uExposureScale
 * from the engine.
 */
export const COLOR_STAGE_GLSL = /* glsl */ `
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

const int MIX_RAMP_STEPS = 32;

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

vec3 mixColorAt(int k, float L, float y) {
  vec3 c = mixRamp(k, y);
  if (uMixColor[k].a > 0.5 && uMixColor[k].a < 1.5 && uMixTurn[k].x > -0.5) {
    float edge = uMixTurn[k].y;
    float t = 1.0 - smoothstep(edge - uMixTurn[k].w, edge + uMixTurn[k].z, L);
    c = mix(c, mixRamp(int(uMixTurn[k].x + 0.5), y), t);
  }
  return c;
}

vec3 colorStage(vec2 uv, vec3 radiance) {
  vec3 rad = max(radiance, vec3(0.0));
  float y = dot(rad, LUMA);
  if (uMixCount <= 0 || y <= 1e-8) return radiance;
  float yE = y * uExposureScale;
  float L = pow(yE, 1.0 / 3.0);
  vec4 fa = sampleSmooth4(uMixFieldsA, uv);
  vec4 fb = sampleSmooth4(uMixFieldsB, uv);
  float p[5];
  float s = 0.0;
  float bestValue = -1.0;
  int best = 0;
  for (int k = 0; k < 5; k++) {
    p[k] = 0.0;
    if (k >= uMixCount) continue;
    // The soft blend's shares already keep each color to its lightness on the grid; here a color only drops out
    // where it can't show at all (a thin bright line in a dim cell), so its own share isn't thinned.
    float mask = mixMask(k, L);
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
  // With the soft blend, two far hues sharing a pixel at mid lightness would mix into grey, lavender or pink: their
  // shares sharpen there, so that meeting stays narrow. Near black, toward white and between near hues it stays soft.
  if (uMixSoft > 0.5) {
    float far = 0.0;
    for (int i = 0; i < 5; i++) {
      for (int j = 0; j < 5; j++) {
        if (j <= i || j >= uMixCount) continue;
        if (((uMixFar >> (i * 5 + j)) & 1) == 0) continue;
        far += 4.0 * p[i] * p[j] / (s * s);
      }
    }
    float mid = smoothstep(0.25, 0.4, L) * (1.0 - smoothstep(0.6, 0.75, L));
    float g = 1.0 + mid * smoothstep(0.05, 0.3, min(far, 1.0));
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
    m += q * mixColorAt(k, L, yE);
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
  // The design's luminance exactly, whatever the colors and the mix, so the light and dark layout never moves.
  return m / max(dot(m, LUMA), 1e-6) * y;
}
`
