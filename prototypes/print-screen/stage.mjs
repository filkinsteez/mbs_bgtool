// The print screen as a stage of the engine's output filter chain (same math as lib/screen.mjs). Prototype only:
// the engine does not register it. It would need an output setting of its own (`output.print`) and an entry in
// OUTPUT_FILTERS (src/light/engine/filters/index.ts).
import { fitSpotRank, screenFrame, SCREEN } from './lib/screen.mjs'

export const PRINT_SCREEN_GLSL = /* glsl */ `
uniform float uPrintAmp;    // strength x amp x fade, in Oklab L
uniform float uPrintPitch;  // screen period in output pixels
uniform vec2 uPrintDir;     // cos and sin of the screen angle (x right, y down)
uniform vec4 uPrintShape;   // cross, edge, wobble, jitter
uniform vec4 uPrintNoise;   // noise share, noise share in light ink, paper L, ink L
uniform vec4 uPrintRank;    // odd polynomial of the spot rank: s, s^3, s^5, s^7

uint printHash(int x, int y, int seed) {
  uint h = (uint(x) * 0x27d4eb2du) ^ (uint(y) * 0x165667b1u) ^ (uint(seed) * 0x9e3779b1u);
  h ^= h >> 16u;
  h *= 0x7feb352du;
  h ^= h >> 15u;
  h *= 0x846ca68bu;
  h ^= h >> 16u;
  return h;
}
float printUnit(int x, int y, int seed) { return float(printHash(x, y, seed)) / 4294967296.0; }

float printValueNoise(vec2 p, int seed) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 s = f * f * (3.0 - 2.0 * f);
  int xi = int(i.x);
  int yi = int(i.y);
  float a = printUnit(xi, yi, seed);
  float b = printUnit(xi + 1, yi, seed);
  float c = printUnit(xi, yi + 1, seed);
  float d = printUnit(xi + 1, yi + 1, seed);
  return (a + (b - a) * s.x + (c - a) * s.y + (a - b - c + d) * s.x * s.y) * 2.0 - 1.0;
}

// Rank of a spot value within its cell: uniform on 0..1 over a cell, so ink covers exactly the coverage.
float printRank(float s) {
  s = clamp(s, -1.0, 1.0);
  float s2 = s * s;
  return clamp(0.5 + s * (uPrintRank.x + s2 * (uPrintRank.y + s2 * (uPrintRank.z + s2 * uPrintRank.w))), 0.0, 1.0);
}

// Mean of smoothstep(a, b, t) for t uniform on 0..1.
float printInkMean(float a, float b) {
  float x0 = clamp(-a / (b - a), 0.0, 1.0);
  float x1 = clamp((1.0 - a) / (b - a), 0.0, 1.0);
  float g0 = x0 * x0 * x0 - 0.5 * x0 * x0 * x0 * x0;
  float g1 = x1 * x1 * x1 - 0.5 * x1 * x1 * x1 * x1;
  return (b - a) * (g1 - g0) + max(0.0, 1.0 - max(b, 0.0));
}

// Ink minus its cell's mean ink at a point in output pixels, for coverage c.
float printDelta(vec2 p, float c) {
  vec2 q = p / uPrintPitch;
  float u = q.x * uPrintDir.x + q.y * uPrintDir.y;
  float v = -q.x * uPrintDir.y + q.y * uPrintDir.x;
  float du = uPrintShape.z * printValueNoise(vec2(u, v) / 6.0, uSeed);
  float dv = uPrintShape.z * printValueNoise(vec2(u, v) / 6.0 + vec2(37.2, 11.7), uSeed + 1);
  u += du;
  v += dv;
  float jitter = uPrintShape.w * (2.0 * printUnit(int(floor(u)), int(floor(v)), uSeed + 2) - 1.0) * min(1.0, 4.0 * c * (1.0 - c));
  float cj = clamp(c + jitter, 0.0, 1.0);
  float cross = uPrintShape.x;
  float s = (cos(6.283185307 * u) + cross * cos(6.283185307 * v)) / (1.0 + cross);
  float a = 1.0 - cj - uPrintShape.y;
  float b = 1.0 - cj + uPrintShape.y;
  return smoothstep(a, b, printRank(s)) - printInkMean(a, b);
}

// A soft halftone in the frame's own ink: lightness only, the cell mean kept, clean at paper white and black.
vec3 filterPrintScreen(vec3 display, ivec2 px, float weight) {
  if (uPrintAmp <= 0.0) return display;
  vec3 lab = linearToOklab(display);
  float c = clamp((uPrintNoise.z - lab.x) / (uPrintNoise.z - uPrintNoise.w), 0.0, 1.0);
  vec2 p = vec2(px);
  float delta = 0.25 * (printDelta(p + vec2(0.25, 0.25), c) + printDelta(p + vec2(0.75, 0.25), c) +
                        printDelta(p + vec2(0.25, 0.75), c) + printDelta(p + vec2(0.75, 0.75), c));
  float grain = (printUnit(px.x, px.y, uSeed + 3) + printUnit(px.x, px.y, uSeed + 4) + printUnit(px.x, px.y, uSeed + 5) - 1.5) * 2.0;
  float share = mix(uPrintNoise.x, uPrintNoise.y, smoothstep(0.5, 0.72, lab.x));
  float swing = (1.0 - share) * delta + share * 0.5 * sqrt(c * (1.0 - c)) * grain;
  lab.x -= uPrintAmp * swing;
  return saturate(oklabToLinear(lab));
}
`

/** The stage's uniforms at a strength (0..1) and output size. */
export function printScreenUniforms(strength, { width, height, seed }, params = SCREEN) {
  const frame = screenFrame(width, height, seed, params)
  return {
    uPrintAmp: strength * params.amp * frame.fade,
    uPrintPitch: frame.pitchPx,
    uPrintDir: [frame.cos, frame.sin],
    uPrintShape: [params.cross, params.edge, params.wobble, params.jitter],
    uPrintNoise: [params.noise, params.lightNoise, params.paper, params.ink],
    uPrintRank: fitSpotRank(params.cross).coefficients,
  }
}

/** In the shape of the engine's OutputFilter (src/light/engine/filters/types.ts). */
export const PRINT_SCREEN_FILTER = {
  key: 'print',
  glsl: PRINT_SCREEN_GLSL,
  apply: 'filterPrintScreen',
  uniforms: (strength, frame) => printScreenUniforms(strength, frame),
}
