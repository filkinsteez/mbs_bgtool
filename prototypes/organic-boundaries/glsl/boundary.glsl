// Shared boundary model, GLSL ES 3.0. Needs the engine's HASH_GLSL and
// NOISE_GLSL (gradientNoise). Mirrors lib/boundary.mjs; the CPU computes every
// calibrated number below once per render (see README, "CPU calibration").
// Lengths are in frame heights. a = along the boundary, s0 = base coordinate
// across the boundaries (increasing from the first color to the last).

#define B_MAX_KNOTS 8
#define B_MAX_EDGES 16

uniform int   uBSeed;
uniform vec4  uBShared;   // x: cS (calibrated), y: 1 / sharedScale, z: frame mean of S, w: octaves
uniform vec4  uBWarp;     // x: cI (calibrated), y: 1 / scale, z: 1 / ly, w: octaves
uniform float uBGain;     // octave gain, 0.25-0.4
uniform float uBClip;     // soft clip in spreads, 1.3 (0 = off)
uniform vec2  uBMod;      // x: amount (0.2-0.3), y: 1 / scale
uniform int   uBKnotCount;
uniform float uBKnotS0[B_MAX_KNOTS];   // envelope knot positions (s0)
uniform float uBKnotAmp[B_MAX_KNOTS];  // calibrated amplitudes, fold guard applied
uniform vec4  uBSoft;     // x: amount, y: 1 / scale, z: 1 / ly, w: wRef (0 = off)
uniform vec3  uBFeather;  // x: amp (guarded), y: 1 / scale, z: ly in widths
uniform float uBEdgeFactor[B_MAX_EDGES]; // edge mode: per-edge guard factors

const float B_NOISE_RMS = 0.3052;

float bEnvelope(float s0) {
  if (s0 <= uBKnotS0[0]) return uBKnotAmp[0];
  for (int i = 0; i + 1 < B_MAX_KNOTS; i++) {
    if (i + 1 >= uBKnotCount) break;
    if (s0 <= uBKnotS0[i + 1]) {
      float t = (s0 - uBKnotS0[i]) / (uBKnotS0[i + 1] - uBKnotS0[i]);
      return mix(uBKnotAmp[i], uBKnotAmp[i + 1], smoothstep(0.0, 1.0, t));
    }
  }
  return uBKnotAmp[uBKnotCount - 1];
}

// 1D noise along the boundary, the same for every boundary.
float bShared(float a) {
  float sum = 0.0;
  float amp = 1.0;
  float f = uBShared.y;
  for (int o = 0; o < 3; o++) {
    if (float(o) >= uBShared.w) break;
    sum += amp * gradientNoise(vec2(a * f + 0.37 + 2.9 * float(o), 0.5 + 4.0 * float(o)), uBSeed);
    amp *= uBGain;
    f *= 2.0;
  }
  return sum / B_NOISE_RMS - uBShared.z;
}

// 2D noise stretched along the boundary; v is the vertical noise coordinate:
// s0 (distance mode) or the number of transitions passed (ramp mode).
float bWarp2D(float a, float v) {
  float sum = 0.0;
  float amp = 1.0;
  vec2 f = uBWarp.yz;
  for (int o = 0; o < 3; o++) {
    if (float(o) >= uBWarp.w) break;
    vec2 q = vec2(a * f.x + 1.7 * float(o) + 0.13, v * f.y + 3.3 * float(o) + 0.71);
    sum += amp * gradientNoise(q, uBSeed + 131 * (o + 1));
    amp *= uBGain;
    f *= vec2(2.0, 1.5);
  }
  return sum / B_NOISE_RMS;
}

float bMod(float a) {
  if (uBMod.x <= 0.0) return 1.0;
  float n = clamp(gradientNoise(vec2(a * uBMod.y + 0.31, 7.5), uBSeed + 977) / B_NOISE_RMS, -2.5, 2.5);
  return max(0.0, 1.0 + uBMod.x * n);
}

// Displacement of the across coordinate: s = s0 + boundaryWarp(a, s0, v).
float boundaryWarp(float a, float s0, float v) {
  float d = uBShared.x * bShared(a) + uBWarp.x * bWarp2D(a, v);
  if (uBClip > 0.0) d = uBClip * tanh(d / uBClip);
  return bEnvelope(s0) * bMod(a) * d;
}

// Edge mode (bands): edge j at base position m moves as a whole.
float boundaryEdge(float a, int j, float m, float v) {
  return uBEdgeFactor[j] * boundaryWarp(a, m, v);
}

// Softness multiplier for the boundary at base position m with width w.
float boundarySoft(float a, float m, float w) {
  if (uBSoft.x <= 0.0) return 1.0;
  float amt = (uBSoft.w > 0.0 && w > uBSoft.w) ? uBSoft.x * uBSoft.w / w : uBSoft.x;
  float n = clamp(gradientNoise(vec2(a * uBSoft.y + 5.1, m * uBSoft.z + 2.3), uBSeed + 577) / B_NOISE_RMS, -2.5, 2.5);
  return exp(amt * n);
}

// Fine feather of boundary j (base m, width w), in s units; acts only within
// about one width of the boundary because it moves the boundary, not the plateau.
float boundaryFeather(float a, float s, float m, float w, int j) {
  if (uBFeather.x <= 0.0) return 0.0;
  vec2 q = vec2(a * uBFeather.y + 9.7 + 3.3 * float(j), (s - m) / (uBFeather.z * w) + 4.1);
  return uBFeather.x * w * gradientNoise(q, uBSeed + 733 + 17 * j) / B_NOISE_RMS;
}

// 10-90 width w: logistic step whose 10% and 90% points are w apart.
float bStep(float x) { return 1.0 / (1.0 + exp(-4.39444915 * x)); }

// Ramp mode vertical coordinate: number of (unwarped) transitions passed.
float bRampV(float s0, float stopAt[B_MAX_EDGES], float stopWidth[B_MAX_EDGES], int count) {
  float v = 0.0;
  for (int j = 0; j < B_MAX_EDGES; j++) {
    if (j >= count) break;
    v += bStep((s0 - stopAt[j]) / stopWidth[j]);
  }
  return v;
}
