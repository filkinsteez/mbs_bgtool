// The print screen as a stage of the engine's output filter chain (same math as lib/screen.mjs). Prototype only:
// the engine does not register it. It would need an output setting of its own (`output.print`) and an entry in
// OUTPUT_FILTERS (src/light/engine/filters/index.ts).
import { screenAmp, screenFrame, SCREEN } from './lib/screen.mjs'

export const PRINT_SCREEN_GLSL = /* glsl */ `
uniform float uPrintAmp;      // lightness swing in Oklab L (amount x amp x fade on small frames); 0 is off
uniform vec4 uPrintMesh;      // phase per output pixel of the main wave (xy) and the second wave (zw)
uniform vec4 uPrintFine;      // phase per output pixel of the fine dots (xy); coverage gamma; fade of the fine dots
uniform vec4 uPrintShape;     // second wave's weight, dot edge, dot jitter, lightness where the fine dots start
uniform vec4 uPrintWarp;      // mesh warp in cells, 1 / its size in cells, fine dots' warp, lightness where they take over
uniform vec4 uPrintMottle;    // 1 / size of the two mottle noises in px, their weights over the noise's std
uniform vec4 uPrintNoise;     // mottle's share of the swing with the mesh, paper L, ink L, its share with the fine dots
uniform vec4 uPrintRankMesh;  // odd polynomial of the mesh's spot rank: s, s^3, s^5, s^7
uniform vec4 uPrintRankFine;  // the same for the round fine dots

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
float printRank(float s, vec4 k) {
  s = clamp(s, -1.0, 1.0);
  float s2 = s * s;
  return clamp(0.5 + s * (k.x + s2 * (k.y + s2 * (k.z + s2 * k.w))), 0.0, 1.0);
}

// Mean of smoothstep(a, b, t) for t uniform on 0..1.
float printInkMean(float a, float b) {
  float x0 = clamp(-a / (b - a), 0.0, 1.0);
  float x1 = clamp((1.0 - a) / (b - a), 0.0, 1.0);
  float g0 = x0 * x0 * x0 - 0.5 * x0 * x0 * x0 * x0;
  float g1 = x1 * x1 * x1 - 0.5 * x1 * x1 * x1 * x1;
  return (b - a) * (g1 - g0) + max(0.0, 1.0 - max(b, 0.0));
}

// Halftone ink minus its cell's mean, for wave phases u, v (warped), spot weight k and coverage c.
float printHalftone(float u, float v, float k, vec4 rank, float c, int seed) {
  float jitter = uPrintShape.z * (2.0 * printUnit(int(floor(u)), int(floor(v)), seed) - 1.0) * min(1.0, 4.0 * c * (1.0 - c));
  float cj = clamp(c + jitter, 0.0, 1.0);
  float s = (cos(6.283185307 * u) + k * cos(6.283185307 * v)) / (1.0 + k);
  float a = 1.0 - cj - uPrintShape.y;
  float b = 1.0 - cj + uPrintShape.y;
  return smoothstep(a, b, printRank(s, rank)) - printInkMean(a, b);
}

// The mesh: two waves, each warped by short noise so rows break up every few cells.
float printMesh(vec2 p, float c) {
  float u = dot(p, uPrintMesh.xy);
  float v = dot(p, uPrintMesh.zw);
  vec2 q = vec2(u, v) * uPrintWarp.y;
  float du = uPrintWarp.x * printValueNoise(q, uSeed);
  float dv = uPrintWarp.x * printValueNoise(q + vec2(37.2, 11.7), uSeed + 1);
  return printHalftone(u + du, v + dv, uPrintShape.x, uPrintRankMesh, c, uSeed + 2);
}

// Round two-pixel dots at the fine angle and 90 deg on, for light ink.
float printFine(vec2 p, float c) {
  float u = dot(p, uPrintFine.xy);
  float v = dot(p, vec2(-uPrintFine.y, uPrintFine.x));
  vec2 q = vec2(u, v) / 3.0;
  float du = uPrintWarp.z * printValueNoise(q, uSeed + 5);
  float dv = uPrintWarp.z * printValueNoise(q + vec2(19.1, 5.3), uSeed + 6);
  return printHalftone(u + du, v + dv, 1.0, uPrintRankFine, c, uSeed + 7);
}

// A soft halftone mesh and mottle in the frame's own ink: lightness only, the cell mean kept, clean at paper white
// and black.
vec3 filterPrintScreen(vec3 display, ivec2 px, float weight) {
  if (uPrintAmp <= 0.0) return display;
  vec3 lab = linearToOklab(display);
  float c = clamp((uPrintNoise.y - lab.x) / (uPrintNoise.y - uPrintNoise.z), 0.0, 1.0);
  // No dots at paper white or at full ink, so both stay exact.
  float ends = smoothstep(0.0, 0.06, c) * smoothstep(0.0, 0.06, 1.0 - c);
  if (ends <= 0.0) return display;
  float wf = smoothstep(uPrintShape.w, uPrintWarp.w, lab.x);
  float cg = pow(c, uPrintFine.z);
  vec2 p = vec2(px);
  float delta = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 q = p + vec2((i == 1 || i == 3) ? 0.75 : 0.25, i >= 2 ? 0.75 : 0.25);
    float mesh = wf < 1.0 ? printMesh(q, cg) : 0.0;
    float fine = wf > 0.0 ? printFine(q, cg) : 0.0;
    delta += 0.25 * ((1.0 - wf) * mesh + wf * uPrintFine.w * fine);
  }
  float mottle = uPrintMottle.z * printValueNoise(p * uPrintMottle.x, uSeed + 3) + uPrintMottle.w * printValueNoise(p * uPrintMottle.y, uSeed + 4);
  float share = mix(uPrintNoise.x, uPrintNoise.w, wf);
  float swing = ends * ((1.0 - share) * delta + share * 0.5 * sqrt(cg * (1.0 - cg)) * mottle);
  lab.x -= uPrintAmp * swing;
  return saturate(oklabToLinear(lab));
}
`

/** The stage's uniforms at a strength (0..1) and output size. */
export function printScreenUniforms(strength, { width, height, seed }, params = SCREEN) {
  const f = screenFrame(width, height, seed, params)
  return {
    uPrintAmp: screenAmp(strength, params) * f.fadeMesh,
    uPrintMesh: [f.dir1[0] / f.pitch1, f.dir1[1] / f.pitch1, f.dir2[0] / f.pitch2, f.dir2[1] / f.pitch2],
    uPrintFine: [f.dirF[0] / f.pitchF, f.dirF[1] / f.pitchF, params.coverageGamma, f.fadeFine],
    uPrintShape: [f.weight2, f.edge, f.jitter, params.lightLo],
    uPrintWarp: [f.warp, 1 / f.warpScale, f.fineWarp, params.lightHi],
    uPrintMottle: [1 / f.mottle1, 1 / f.mottle2, params.mottleW1 / f.mottleNorm, params.mottleW2 / f.mottleNorm],
    uPrintNoise: [params.noise, params.paper, params.ink, params.noiseLight],
    uPrintRankMesh: f.rankMesh,
    uPrintRankFine: f.rankFine,
  }
}

/** In the shape of the engine's OutputFilter (src/light/engine/filters/types.ts). */
export const PRINT_SCREEN_FILTER = {
  key: 'print',
  glsl: PRINT_SCREEN_GLSL,
  apply: 'filterPrintScreen',
  uniforms: (strength, frame) => printScreenUniforms(strength, frame),
}
