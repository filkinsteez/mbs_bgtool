/**
 * The color stage in GLSL: `vec3 colorStage(vec2 uv, vec3 radiance)` keeps each pixel's luminance and gives it the
 * hue of the color fields (two textures of four fields on the stage grid), weighted and added like overlapping light.
 * Bright-only colors turn into their darker neighbor (or neutral) as their light dims, and a warm color with a lighter
 * warm neighbor turns into it as its light grows (Orange-red's core goes Yellow, then white); where two colors far
 * apart in hue meet, the line goes pale in lit parts and dark in dim parts. Needs SAMPLE_GLSL and LUMA from the chunk
 * library, and uExposureScale from the engine.
 */
export const COLOR_STAGE_GLSL = /* glsl */ `
uniform sampler2D uMixFieldsA;
uniform sampler2D uMixFieldsB;
uniform int uMixCount;
uniform vec4 uMixColor[5];
uniform vec4 uMixNeighbor[5];
uniform vec4 uMixUpper[5];
uniform vec4 uMixField[5];
uniform int uMixFar;
uniform float uMixSharp;
uniform float uMixBridge;
uniform float uMixLift;
uniform float uMixDip;

float mixFieldValue(int index, vec4 a, vec4 b) {
  vec4 src = index < 4 ? a : b;
  int c = index < 4 ? index : index - 4;
  return c == 0 ? src.x : c == 1 ? src.y : c == 2 ? src.z : src.w;
}

vec3 mixUnit(vec3 c) { return c / max(c.r, max(c.g, max(c.b, 1e-6))); }

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
  float upper = uMixUpper[k].a;
  if (upper < 1.5) c = mixUnit(mix(c, uMixUpper[k].rgb, smoothstep(upper, upper + 0.15, L)));
  return c;
}

vec3 colorStage(vec2 uv, vec3 radiance) {
  vec3 rad = max(radiance, vec3(0.0));
  float y = dot(rad, LUMA);
  if (uMixCount <= 0 || y <= 1e-8) return radiance;
  float L = pow(y * uExposureScale, 1.0 / 3.0);
  vec4 fa = sampleSmooth4(uMixFieldsA, uv);
  vec4 fb = sampleSmooth4(uMixFieldsB, uv);
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
  // Each side keeps its own hue up to the meeting line (shares squared); two hues far apart meet through neutral.
  vec3 m = vec3(0.0);
  float s2 = 0.0;
  for (int k = 0; k < 5; k++) {
    if (k >= uMixCount) continue;
    p[k] /= s;
    s2 += p[k] * p[k];
    m += p[k] * p[k] * mixColorAt(k, L);
  }
  m /= max(s2, 1e-6);
  float b = 0.0;
  for (int i = 0; i < 5; i++) {
    for (int j = 0; j < 5; j++) {
      if (j <= i || j >= uMixCount) continue;
      if (((uMixFar >> (i * 5 + j)) & 1) == 0) continue;
      b += 4.0 * p[i] * p[j];
    }
  }
  b = min(b, 1.0);
  // Where the design is lit, far hues meet through a pale bridge, a little lighter. Where it is dim, each hue dims into
  // its own dark and the meeting line goes dark, so far hues never mix into mauve, indigo or teal.
  float lit = smoothstep(0.3, 0.55, L);
  float pale = b * b * lit;
  m = mix(m, vec3(1.0), uMixBridge * pale);
  float lift = L < 1.0 ? uMixLift * pale * (1.0 - L) : 0.0;
  // The pixel keeps the design's luminance, but no channel goes past the design's brightest channel there: Meta Blue
  // where the design was Yellow stays deep to mid instead of going white, and only light past full strength turns white.
  float v = max(rad.r, max(rad.g, rad.b));
  float scale = min(y / max(dot(m, LUMA), 1e-6), v / max(m.r, max(m.g, max(m.b, 1e-6))));
  return m * scale * pow((L + lift) / L, 3.0) * (1.0 - uMixDip * b * (1.0 - lit));
}
`
