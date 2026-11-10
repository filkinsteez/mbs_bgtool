/**
 * The color stage in GLSL: `vec3 colorStage(vec2 uv, vec3 radiance)` keeps each pixel's luminance and gives it the
 * hue of the color fields (two textures of four fields on the stage grid), weighted and added like overlapping light.
 * Bright-only colors turn into their darker neighbor (or neutral) as their light dims; where two colors far apart in
 * hue meet, the mix goes neutral and a little lighter along a narrow line. Needs SAMPLE_GLSL and LUMA from the
 * chunk library, and uExposureScale from the engine.
 */
export const COLOR_STAGE_GLSL = /* glsl */ `
uniform sampler2D uMixFieldsA;
uniform sampler2D uMixFieldsB;
uniform int uMixCount;
uniform vec4 uMixColor[5];
uniform vec4 uMixNeighbor[5];
uniform vec4 uMixField[5];
uniform vec4 uMixUpper[5];
uniform int uMixFar;
uniform float uMixSharp;
uniform float uMixBridge;
uniform float uMixLift;

float mixFieldValue(int index, vec4 a, vec4 b) {
  vec4 src = index < 4 ? a : b;
  int c = index < 4 ? index : index - 4;
  return c == 0 ? src.x : c == 1 ? src.y : c == 2 ? src.z : src.w;
}

vec3 mixUnit(vec3 c) { return c / max(dot(c, LUMA), 1e-6); }

float mixMask(int k, float L) {
  if (uMixColor[k].a < 2.5) return 1.0;
  float own = uMixNeighbor[k].a;
  return 1.0 - smoothstep(own - 0.12, own + 0.06, L);
}

vec3 mixColorAt(int k, float L) {
  vec3 c = uMixColor[k].rgb;
  float kind = uMixColor[k].a;
  if (kind > 0.5 && kind < 2.5) {
    float edge = uMixNeighbor[k].a;
    float t = 1.0 - smoothstep(edge - uMixField[k].w, edge + uMixField[k].z, L);
    c = mixUnit(mix(c, uMixNeighbor[k].rgb, t));
  }
  float from = uMixUpper[k].a;
  if (from < 1.5) c = mixUnit(mix(c, uMixUpper[k].rgb, smoothstep(from, from + 0.18, L)));
  return c;
}

vec3 colorStage(vec2 uv, vec3 radiance) {
  vec3 rad = max(radiance, vec3(0.0));
  float y = dot(rad, LUMA);
  if (uMixCount <= 0 || y <= 1e-8) return radiance;
  float L = pow(y * uExposureScale, 1.0 / 3.0);
  vec4 fa = sampleSmooth4(uMixFieldsA, uv);
  vec4 fb = sampleSmooth4(uMixFieldsB, uv);
  fa *= fa;
  fb *= fb;
  float p[5];
  float s = 0.0;
  float bestValue = -1.0;
  int best = 0;
  for (int k = 0; k < 5; k++) {
    p[k] = 0.0;
    if (k >= uMixCount) continue;
    float f = max(mixFieldValue(int(uMixField[k].x + 0.5), fa, fb), 0.0) * mixMask(k, L);
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
  vec3 m = vec3(0.0);
  for (int k = 0; k < 5; k++) {
    if (k >= uMixCount) continue;
    p[k] /= s;
    m += p[k] * mixColorAt(k, L);
  }
  float b = 0.0;
  for (int i = 0; i < 5; i++) {
    for (int j = 0; j < 5; j++) {
      if (j <= i || j >= uMixCount) continue;
      if (((uMixFar >> (i * 5 + j)) & 1) == 0) continue;
      b += 4.0 * p[i] * p[j];
    }
  }
  b = min(b, 1.0);
  // Only lit parts pale toward white between far hues; in dim parts that would read grey, and dim light there mixes.
  m = mix(m, vec3(1.0), uMixBridge * b * b * (3.0 - 2.0 * b) * smoothstep(0.3, 0.7, L));
  float lift = L < 1.0 ? uMixLift * b * (1.0 - L) * smoothstep(0.3, 0.6, L) : 0.0;
  return mixUnit(m) * y * pow((L + lift) / L, 3.0);
}
`
