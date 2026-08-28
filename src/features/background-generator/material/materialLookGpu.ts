import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js'
import type { LookId } from '@/core/lab/looks'
import { resolveLookColorPlan } from '@/core/lab/colorDirection'
import type { BackgroundRecipeV2 } from '../recipe'

export const MATERIAL_GPU_LOOK_INDEX: Partial<Record<LookId, number>> = {
  frame: 0,
  pixels: 1,
  scanlines: 1,
  streams: 4,
  brushwork: 2,
  beads: 3,
  quilt: 3,
  weave: 3,
  marks: 4,
  trails: 4,
}

export const MAX_MATERIAL_GPU_PALETTE_COLORS = 16

const DEFAULT_BLUE = '#0064E0'

export type MaterialGpuFrameOptions = {
  exportResolution?: readonly [number, number]
  phase?: number
}

export type MaterialGpuMetrics = {
  geometries: number
  textures: number
  programs: number
  calls: number
  triangles: number
  width: number
  height: number
  phase: number
}

export type MaterialGpuPalette = {
  colors: string[]
  weights: number[]
  ground: string
  ink: string
}

type MaterialLookUniforms = {
  tDiffuse: THREE.IUniform<THREE.Texture | null>
  tDepth: THREE.IUniform<THREE.DepthTexture | null>
  uResolution: THREE.IUniform<THREE.Vector2>
  uViewportResolution: THREE.IUniform<THREE.Vector2>
  uExportResolution: THREE.IUniform<THREE.Vector2>
  uAspect: THREE.IUniform<number>
  uLook: THREE.IUniform<number>
  uPalette: THREE.IUniform<THREE.Color[]>
  uPaletteWeights: THREE.IUniform<Float32Array>
  uPaletteCount: THREE.IUniform<number>
  uGroundColor: THREE.IUniform<THREE.Color>
  uInkColor: THREE.IUniform<THREE.Color>
  uSeed: THREE.IUniform<number>
  uComplexity: THREE.IUniform<number>
  uMotionAmount: THREE.IUniform<number>
  uEnergy: THREE.IUniform<number>
  uLoopPhase: THREE.IUniform<number>
  uCameraNear: THREE.IUniform<number>
  uCameraFar: THREE.IUniform<number>
}

type ShaderErrorHandler = (
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  program: WebGLProgram,
  vertexShader: WebGLShader,
  fragmentShader: WebGLShader,
) => void

type RendererShaderDebug = {
  checkShaderErrors: boolean
  onShaderError?: ShaderErrorHandler
}

const MATERIAL_LOOK_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// One pass handles all ten Looks so switching Looks never recompiles shaders or
// reallocates render targets. The depth attachment is the source mask: every
// model-conditioned echo, trail, cell, and stroke is sampled from the actual
// transformed OBJ silhouette. The live lit scene remains in the final mix.
const MATERIAL_LOOK_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  #define MAX_PALETTE 16
  #define TAU 6.28318530718

  varying vec2 vUv;

  uniform sampler2D tDiffuse;
  uniform sampler2D tDepth;
  uniform vec2 uResolution;
  uniform vec2 uViewportResolution;
  uniform vec2 uExportResolution;
  uniform float uAspect;
  uniform int uLook;
  uniform vec3 uPalette[MAX_PALETTE];
  uniform float uPaletteWeights[MAX_PALETTE];
  uniform int uPaletteCount;
  uniform vec3 uGroundColor;
  uniform vec3 uInkColor;
  uniform float uSeed;
  uniform float uComplexity;
  uniform float uMotionAmount;
  uniform float uEnergy;
  uniform float uLoopPhase;
  uniform float uCameraNear;
  uniform float uCameraFar;

  float saturate(float value) {
    return clamp(value, 0.0, 1.0);
  }

  float hash12(vec2 point) {
    vec3 p3 = fract(vec3(point.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33 + uSeed * 0.00013);
    return fract((p3.x + p3.y) * p3.z);
  }

  float valueNoise(vec2 point) {
    vec2 cell = floor(point);
    vec2 local = fract(point);
    vec2 smoothLocal = local * local * (3.0 - 2.0 * local);
    return mix(
      mix(hash12(cell), hash12(cell + vec2(1.0, 0.0)), smoothLocal.x),
      mix(hash12(cell + vec2(0.0, 1.0)), hash12(cell + vec2(1.0)), smoothLocal.x),
      smoothLocal.y
    );
  }

  float fbm(vec2 point) {
    float result = valueNoise(point) * 0.58;
    result += valueNoise(point * 2.03 + vec2(7.7, -3.1)) * 0.27;
    result += valueNoise(point * 4.11 + vec2(-2.8, 8.4)) * 0.15 * uComplexity;
    return result;
  }

  mat2 rotate2d(float angle) {
    float sine = sin(angle);
    float cosine = cos(angle);
    return mat2(cosine, -sine, sine, cosine);
  }

  vec3 paletteAt(float amount) {
    float total = 0.0;
    for (int index = 0; index < MAX_PALETTE; index++) {
      if (index >= uPaletteCount) break;
      total += max(uPaletteWeights[index], 0.0001);
    }
    float target = fract(amount) * max(total, 0.0001);
    float cursor = 0.0;
    vec3 selected = uPalette[0];
    for (int index = 0; index < MAX_PALETTE; index++) {
      if (index >= uPaletteCount) break;
      float weight = max(uPaletteWeights[index], 0.0001);
      float local = saturate((target - cursor) / weight);
      vec3 nextColor = index + 1 < uPaletteCount
        ? uPalette[index + 1]
        : uPalette[0];
      if (target >= cursor && target <= cursor + weight) {
        selected = mix(uPalette[index], nextColor, smoothstep(0.72, 1.0, local));
      }
      cursor += weight;
    }
    return selected;
  }

  float maskAt(vec2 uv) {
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
    return step(texture2D(tDepth, uv).r, 0.999999);
  }

  float softMaskAt(vec2 uv) {
    vec2 texel = 1.0 / max(uResolution, vec2(1.0));
    float mask = maskAt(uv) * 4.0;
    mask += maskAt(uv + vec2(texel.x, 0.0));
    mask += maskAt(uv - vec2(texel.x, 0.0));
    mask += maskAt(uv + vec2(0.0, texel.y));
    mask += maskAt(uv - vec2(0.0, texel.y));
    return mask / 8.0;
  }

  float sourceEcho(vec2 uv, vec2 direction, float spread, float bend) {
    float result = softMaskAt(uv);
    float weight = 0.72;
    for (int index = 1; index <= 10; index++) {
      float stepIndex = float(index);
      float distanceAlong = spread * stepIndex;
      vec2 curvedDirection = rotate2d(bend * stepIndex) * direction;
      float forward = maskAt(uv - curvedDirection * distanceAlong);
      float backward = maskAt(uv + curvedDirection * distanceAlong * 0.48);
      result += (forward + backward * 0.42) * weight;
      weight *= 0.72;
    }
    return saturate(result * 0.34);
  }

  float lineBand(float coordinate, float frequency, float width) {
    float line = abs(fract(coordinate * frequency) - 0.5);
    return 1.0 - smoothstep(width, width + 0.08, line);
  }

  float circleMark(vec2 local, float radius) {
    return 1.0 - smoothstep(radius, radius + 0.08, length(local));
  }

  void main() {
    vec4 raw = texture2D(tDiffuse, vUv);
    vec2 texel = 1.0 / max(uResolution, vec2(1.0));
    float centerDepth = texture2D(tDepth, vUv).r;
    float modelMask = softMaskAt(vUv);
    float depthX = texture2D(tDepth, vUv + vec2(texel.x, 0.0)).r
      - texture2D(tDepth, vUv - vec2(texel.x, 0.0)).r;
    float depthY = texture2D(tDepth, vUv + vec2(0.0, texel.y)).r
      - texture2D(tDepth, vUv - vec2(0.0, texel.y)).r;
    float depthEdge = saturate(length(vec2(depthX, depthY)) * 180.0);
    float viewDepth = mix(uCameraNear, uCameraFar, centerDepth);
    float depthShade = modelMask * saturate(
      0.35 + (uCameraFar - viewDepth) / max(uCameraFar - uCameraNear, 0.0001) * 0.65
    );
    vec3 normalHint = normalize(vec3(-depthX * 320.0, -depthY * 320.0, 1.0));

    vec2 aspectScale = vec2(max(uAspect, 0.0001), 1.0);
    vec2 point = (vUv - 0.5) * aspectScale;
    float phase = fract(uLoopPhase);
    float theta = phase * TAU;
    float harmonic2 = sin(theta * 2.0 + uSeed * 0.017);
    float harmonic3 = cos(theta * 3.0 - uSeed * 0.011);
    vec2 motionOffset = uMotionAmount * vec2(
      sin(theta + uSeed * 0.021) + harmonic3 * 0.24 * uEnergy,
      cos(theta + uSeed * 0.013) + harmonic2 * 0.3 * uEnergy
    ) * (0.012 + 0.02 * uEnergy);
    vec2 animatedUv = vUv + motionOffset;
    vec2 animatedPoint = point + motionOffset * aspectScale;

    // Both resolutions are explicit because preview and export share this
    // shader. Structure is normalized to the frame, not the device pixel grid.
    vec2 activeResolution = mix(
      max(uViewportResolution, vec2(1.0)),
      max(uExportResolution, vec2(1.0)),
      step(1.0, uExportResolution.x)
    );
    float resolutionScale = min(activeResolution.x, activeResolution.y)
      / max(min(uResolution.x, uResolution.y), 1.0);

    float seedAngle = hash12(vec2(uSeed, 9.17)) * TAU;
    vec2 flowDirection = normalize(
      rotate2d(seedAngle + harmonic2 * uMotionAmount * 0.12)
      * vec2(1.0, 0.34 + 0.18 * uEnergy)
    );
    float echo = sourceEcho(
      animatedUv,
      flowDirection / aspectScale,
      (0.006 + 0.002 * uComplexity) * resolutionScale,
      0.012 * harmonic3 * uMotionAmount
    );
    float noiseField = fbm(animatedPoint * (3.1 + uComplexity * 2.6) + uSeed * 0.003);
    float rawLuma = dot(raw.rgb, vec3(0.2126, 0.7152, 0.0722));

    float structure = 0.0;
    float accent = 0.0;
    float sourceField = echo;
    vec3 treatment = paletteAt(noiseField + uSeed * 0.001);

    if (uLook == 0) {
      // Frame: asymmetric edge rails and broad fields, with rails deflected
      // by the real model rather than a centered badge.
      float railX = lineBand(vUv.x + noiseField * 0.025, 3.0 + uComplexity * 3.0, 0.27);
      float railY = lineBand(vUv.y - noiseField * 0.018, 2.0 + uComplexity * 2.0, 0.31);
      float perimeter = smoothstep(0.08, 0.0, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));
      structure = saturate(railX * 0.32 + railY * 0.24 + perimeter * 0.52 + echo * 0.74);
      accent = saturate(depthEdge + echo * (0.35 + uComplexity * 0.35));
      treatment = paletteAt(vUv.x * 0.42 + vUv.y * 0.27 + noiseField * 0.28);
    } else if (uLook == 1) {
      // Pixels: the source mask and beauty buffer are sampled on the same
      // cells, so camera and transform changes move the pixel event.
      float cells = 18.0 + uComplexity * 54.0;
      vec2 cellUv = (floor(animatedUv * cells) + 0.5) / cells;
      float cellSource = maskAt(cellUv);
      float cellHash = hash12(floor(animatedUv * cells));
      float fineCells = cells * 2.0;
      float fine = step(0.72, hash12(floor(animatedUv * fineCells))) * uComplexity;
      structure = saturate(0.26 + cellHash * 0.44 + cellSource * 0.74 + fine * 0.23);
      sourceField = max(echo, cellSource);
      accent = cellSource * (0.45 + 0.45 * cellHash);
      treatment = paletteAt(cellHash + cellSource * 0.31);
    } else if (uLook == 2) {
      float frequency = 58.0 + uComplexity * 150.0;
      float warp = (noiseField - 0.5) * (0.018 + 0.025 * uComplexity) + echo * 0.025;
      float scan = lineBand(animatedUv.y + warp, frequency, 0.31);
      float fineScan = lineBand(animatedUv.y - warp * 0.5, frequency * 1.91, 0.39) * uComplexity;
      structure = saturate(scan * 0.72 + fineScan * 0.25 + echo * 0.54);
      accent = saturate(depthEdge + echo * scan);
      treatment = paletteAt(animatedUv.y * 2.0 + noiseField * 0.2 + harmonic2 * uMotionAmount * 0.03);
    } else if (uLook == 3) {
      vec2 streamPoint = rotate2d(seedAngle * 0.35) * animatedPoint;
      float wave = sin(
        streamPoint.y * (31.0 + uComplexity * 27.0)
        + fbm(streamPoint * 4.0) * (5.0 + uComplexity * 7.0)
        + theta
      );
      float stream = smoothstep(0.6, 0.96, abs(wave));
      float narrow = smoothstep(0.76, 0.99, abs(sin(
        streamPoint.y * (67.0 + uComplexity * 41.0) - theta * 2.0
      ))) * uComplexity;
      structure = saturate(stream * 0.64 + narrow * 0.28 + echo * 0.68);
      accent = saturate(echo * stream + depthEdge);
      treatment = paletteAt(streamPoint.x * 0.45 + noiseField * 0.42);
    } else if (uLook == 4) {
      vec2 brushPoint = rotate2d(-0.62 + seedAngle * 0.12) * animatedPoint;
      float rows = 24.0 + uComplexity * 38.0;
      vec2 brushCell = vec2(brushPoint.x * (7.0 + uComplexity * 7.0), brushPoint.y * rows);
      vec2 local = fract(brushCell) - 0.5;
      float stroke = (1.0 - smoothstep(0.08, 0.24, abs(local.y)))
        * (1.0 - smoothstep(0.28, 0.49, abs(local.x)));
      stroke *= step(0.17, hash12(floor(brushCell)));
      float bristle = lineBand(brushPoint.y + noiseField * 0.012, rows * 2.7, 0.4) * uComplexity;
      structure = saturate(stroke * 0.7 + bristle * 0.18 + echo * 0.62);
      accent = saturate(stroke * echo + depthEdge);
      treatment = paletteAt(hash12(floor(brushCell)) + noiseField * 0.2);
    } else if (uLook == 5) {
      float cells = 20.0 + uComplexity * 42.0;
      vec2 cell = floor(animatedUv * cells);
      vec2 local = fract(animatedUv * cells) - 0.5;
      float random = hash12(cell);
      float bead = circleMark(local, 0.18 + random * 0.16);
      float smallBead = circleMark(fract(animatedUv * cells * 2.0) - 0.5, 0.12) * uComplexity;
      float cellSource = maskAt((cell + 0.5) / cells);
      structure = saturate(bead * (0.45 + random * 0.35) + smallBead * 0.2 + echo * 0.42);
      sourceField = max(echo, cellSource * bead);
      accent = saturate(cellSource * bead + depthEdge);
      treatment = paletteAt(random + cellSource * 0.28);
    } else if (uLook == 6) {
      float cells = 8.0 + uComplexity * 20.0;
      vec2 quiltPoint = animatedUv * cells;
      vec2 cell = floor(quiltPoint);
      vec2 local = fract(quiltPoint);
      float diagonal = step(local.x, local.y);
      float patchValue = hash12(cell + diagonal * vec2(13.0, 7.0));
      float seam = smoothstep(0.1, 0.0, min(
        min(local.x, 1.0 - local.x),
        min(local.y, 1.0 - local.y)
      ));
      float innerSeam = smoothstep(0.055, 0.0, abs(local.x - local.y)) * uComplexity;
      structure = saturate(0.32 + patchValue * 0.42 + seam * 0.2 + innerSeam * 0.18 + echo * 0.4);
      accent = saturate((seam + innerSeam) * echo + depthEdge);
      treatment = paletteAt(patchValue + diagonal * 0.17);
    } else if (uLook == 7) {
      float threads = 45.0 + uComplexity * 82.0;
      float warpThread = lineBand(animatedUv.x + noiseField * 0.006, threads, 0.37);
      float weftThread = lineBand(animatedUv.y - noiseField * 0.006, threads * 0.82, 0.37);
      float overUnder = step(0.5, fract(
        floor(animatedUv.x * threads) + floor(animatedUv.y * threads * 0.82)
      ) * 0.5);
      float weave = mix(warpThread, weftThread, overUnder);
      float fine = warpThread * weftThread * uComplexity;
      structure = saturate(weave * 0.64 + fine * 0.24 + echo * 0.45);
      accent = saturate(weave * echo + depthEdge);
      treatment = paletteAt(overUnder * 0.39 + noiseField * 0.48);
    } else if (uLook == 8) {
      float cells = 16.0 + uComplexity * 36.0;
      vec2 markPoint = animatedUv * cells;
      vec2 cell = floor(markPoint);
      vec2 local = rotate2d(hash12(cell) * TAU) * (fract(markPoint) - 0.5);
      float slash = (1.0 - smoothstep(0.035, 0.12, abs(local.y)))
        * (1.0 - smoothstep(0.24, 0.48, abs(local.x)));
      float crossMark = slash + (
        1.0 - smoothstep(0.035, 0.1, abs(local.x))
      ) * (1.0 - smoothstep(0.2, 0.42, abs(local.y))) * uComplexity;
      float present = step(0.52 - uComplexity * 0.25, hash12(cell + 4.2));
      float mark = saturate(crossMark) * present;
      structure = saturate(mark * 0.72 + echo * 0.58 + noiseField * 0.13);
      accent = saturate(mark * echo + depthEdge);
      treatment = paletteAt(hash12(cell + 11.0));
    } else {
      // Trails directly repeat both the actual source mask and lit source
      // color along a seeded flow. No fallback/canonical mark is generated.
      vec3 trailColor = raw.rgb;
      float trailMask = modelMask;
      float trailWeight = 0.68;
      for (int index = 1; index <= 12; index++) {
        float stepIndex = float(index);
        vec2 offset = flowDirection / aspectScale
          * stepIndex * (0.007 + 0.004 * uComplexity);
        offset += vec2(0.0, sin(stepIndex * 0.72 + theta * 2.0))
          * uMotionAmount * (0.001 + 0.002 * uEnergy);
        float sampledMask = maskAt(vUv - offset);
        trailMask += sampledMask * trailWeight;
        trailColor += texture2D(tDiffuse, clamp(vUv - offset, 0.0, 1.0)).rgb
          * sampledMask * trailWeight;
        trailWeight *= 0.79;
      }
      sourceField = saturate(trailMask * 0.28);
      structure = saturate(sourceField * 0.92 + noiseField * 0.18);
      accent = saturate(sourceField + depthEdge);
      treatment = mix(
        paletteAt(noiseField + animatedUv.x * 0.4),
        trailColor / max(trailMask, 1.0),
        saturate(sourceField * 0.58)
      );
    }

    // Complexity only adds secondary/fine structure. The base event remains
    // intact at every setting.
    float micro = lineBand(
      noiseField + animatedUv.x * 0.31 - animatedUv.y * 0.23,
      7.0 + uComplexity * 9.0,
      0.42
    ) * uComplexity;
    structure = saturate(structure + micro * 0.14);

    vec3 quietGround = mix(raw.rgb, uGroundColor, 0.72);
    vec3 background = mix(quietGround, treatment, 0.16 + structure * 0.66);
    background = mix(background, uInkColor, accent * 0.18);

    // Preserve lighting, material response, and curvature on the model. The
    // palette treatment rides its luminance and pseudo-normal instead of
    // flattening the object into a logo-shaped color patch.
    vec3 litTint = paletteAt(
      rawLuma * 0.54
      + dot(normalHint.xy, vec2(0.17, -0.11))
      + noiseField * 0.22
      + depthShade * 0.13
    );
    vec3 shadedTint = litTint * (0.34 + rawLuma * 1.18);
    float modelTreatment = 0.2 + structure * 0.2 + uComplexity * 0.08;
    vec3 litModel = mix(raw.rgb, shadedTint, modelTreatment);
    litModel += normalHint.z * depthShade * uInkColor * 0.035;
    litModel = mix(litModel, uInkColor, depthEdge * 0.18);
    vec3 finalColor = mix(background, litModel, saturate(modelMask * 1.12));
    finalColor = mix(finalColor, treatment, sourceField * (1.0 - modelMask) * 0.16);

    float dither = hash12(gl_FragCoord.xy + floor(uSeed)) - 0.5;
    finalColor += dither * (0.002 + uComplexity * 0.0025);
    gl_FragColor = vec4(max(finalColor, vec3(0.0)), max(raw.a, 1.0));
  }
`

function normalizeHex(value: string, fallback = DEFAULT_BLUE): string {
  const match = value.trim().match(/^#?([0-9a-f]{6})$/i)
  return match ? `#${match[1].toUpperCase()}` : fallback
}

function relativeLuminance(hex: string): number {
  const color = new THREE.Color(normalizeHex(hex))
  return color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722
}

export function materialLookLoopPhase(timeMs: number, loopSeconds: number): number {
  const loopMs = Math.max(2000, loopSeconds * 1000)
  return ((timeMs % loopMs) + loopMs) % loopMs / loopMs
}

export function materialLookEnergy(speed: number): number {
  return THREE.MathUtils.clamp((speed - 0.1) / 1.9, 0, 1)
}

export function resolveMaterialGpuPalette(
  recipe: BackgroundRecipeV2,
): MaterialGpuPalette {
  const plan = resolveLookColorPlan({
    mix: recipe.palette.mix,
    ground: recipe.palette.ground,
    ink: recipe.palette.ink,
    lookId: recipe.look.id,
    complexity: recipe.look.detail,
  })
  const selected = plan.swatches.slice(0, MAX_MATERIAL_GPU_PALETTE_COLORS)
  const colors = selected.map((swatch) => normalizeHex(swatch.hex))
  const weights = selected.map((swatch) => swatch.weight)
  const ground = normalizeHex(recipe.palette.ground)
  const ink = normalizeHex(recipe.palette.ink)

  const ensureColor = (color: string, weight: number) => {
    if (colors.includes(color)) return
    if (colors.length >= MAX_MATERIAL_GPU_PALETTE_COLORS) {
      colors[colors.length - 1] = color
      weights[weights.length - 1] = weight
      return
    }
    colors.push(color)
    weights.push(weight)
  }

  ensureColor(ground, 0.2)
  ensureColor(ink, 0.2)
  if (!colors.length || colors.every((color) => relativeLuminance(color) < 0.002)) {
    const highlight = normalizeHex(recipe.material.highlightColor)
    ensureColor(relativeLuminance(highlight) >= 0.002 ? highlight : DEFAULT_BLUE, 0.25)
  }

  const total = weights.reduce((sum, weight) => sum + Math.max(weight, 0), 0) || 1
  return {
    colors,
    weights: weights.map((weight) => Math.max(weight, 0) / total),
    ground,
    ink,
  }
}

function createUniforms(): MaterialLookUniforms {
  return {
    tDiffuse: { value: null },
    tDepth: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uViewportResolution: { value: new THREE.Vector2(1, 1) },
    uExportResolution: { value: new THREE.Vector2(0, 0) },
    uAspect: { value: 1 },
    uLook: { value: 0 },
    uPalette: {
      value: Array.from(
        { length: MAX_MATERIAL_GPU_PALETTE_COLORS },
        () => new THREE.Color(DEFAULT_BLUE),
      ),
    },
    uPaletteWeights: {
      value: new Float32Array(MAX_MATERIAL_GPU_PALETTE_COLORS),
    },
    uPaletteCount: { value: 1 },
    uGroundColor: { value: new THREE.Color(DEFAULT_BLUE) },
    uInkColor: { value: new THREE.Color('#FFFFFF') },
    uSeed: { value: 0 },
    uComplexity: { value: 0.5 },
    uMotionAmount: { value: 0 },
    uEnergy: { value: 0 },
    uLoopPhase: { value: 0 },
    uCameraNear: { value: 0.01 },
    uCameraFar: { value: 100 },
  }
}

class DepthAwareShaderPass extends ShaderPass {
  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    deltaTime: number,
    maskActive: boolean,
  ): void {
    const uniforms = this.uniforms as unknown as MaterialLookUniforms
    uniforms.tDepth.value = readBuffer.depthTexture
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive)
  }
}

export class MaterialLookGpuPipeline {
  private readonly composer: EffectComposer
  private readonly lookPass: DepthAwareShaderPass
  private readonly outputPass: OutputPass
  private readonly fxaaPass: ShaderPass
  private readonly uniforms: MaterialLookUniforms
  private readonly viewportResolution = new THREE.Vector2(1, 1)
  private readonly currentResolution = new THREE.Vector2(1, 1)
  private readonly shaderDebug: RendererShaderDebug
  private readonly previousShaderErrorHandler: ShaderErrorHandler | undefined
  private readonly shaderErrorHandler: ShaderErrorHandler
  private paletteKey = ''
  private width = 1
  private height = 1
  private pixelRatio = 1
  private lastPhase = 0
  private shaderErrorMessage: string | null = null
  private disposed = false

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    private readonly camera: THREE.OrthographicCamera,
  ) {
    this.shaderDebug = renderer.debug as unknown as RendererShaderDebug
    this.previousShaderErrorHandler = this.shaderDebug.onShaderError
    this.shaderErrorHandler = (gl, program, vertexShader, fragmentShader) => {
      const message = [
        gl.getProgramInfoLog(program),
        gl.getShaderInfoLog(vertexShader),
        gl.getShaderInfoLog(fragmentShader),
      ].filter(Boolean).join('\n')
      this.shaderErrorMessage = message || 'GPU Look shader failed to compile'
      this.previousShaderErrorHandler?.(gl, program, vertexShader, fragmentShader)
    }
    this.shaderDebug.checkShaderErrors = true
    this.shaderDebug.onShaderError = this.shaderErrorHandler

    const supportsHalfFloat = renderer.extensions.has('EXT_color_buffer_float')
    const depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType)
    depthTexture.format = THREE.DepthFormat
    depthTexture.minFilter = THREE.NearestFilter
    depthTexture.magFilter = THREE.NearestFilter
    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: supportsHalfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
      depthTexture,
    })
    target.texture.name = 'MaterialLookGpu.scene'

    this.composer = new EffectComposer(renderer, target)
    const uniforms = createUniforms()
    this.lookPass = new DepthAwareShaderPass({
      name: 'MaterialLookGpu',
      uniforms,
      vertexShader: MATERIAL_LOOK_VERTEX_SHADER,
      fragmentShader: MATERIAL_LOOK_FRAGMENT_SHADER,
    })
    this.uniforms = this.lookPass.uniforms as unknown as MaterialLookUniforms
    this.lookPass.material.toneMapped = false
    this.lookPass.material.depthTest = false
    this.lookPass.material.depthWrite = false
    this.outputPass = new OutputPass()
    this.fxaaPass = new ShaderPass(FXAAShader)
    this.fxaaPass.material.toneMapped = false

    this.composer.addPass(new RenderPass(scene, camera))
    this.composer.addPass(this.lookPass)
    this.composer.addPass(this.outputPass)
    this.composer.addPass(this.fxaaPass)
  }

  setSize(
    width: number,
    height: number,
    pixelRatio: number,
    kind: 'preview' | 'export' = 'preview',
  ): void {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    this.pixelRatio = Math.max(0.25, pixelRatio)
    this.currentResolution.set(
      Math.max(1, Math.round(this.width * this.pixelRatio)),
      Math.max(1, Math.round(this.height * this.pixelRatio)),
    )
    if (kind === 'preview') this.viewportResolution.copy(this.currentResolution)
    this.composer.setPixelRatio(this.pixelRatio)
    this.composer.setSize(this.width, this.height)
    this.uniforms.uResolution.value.copy(this.currentResolution)
    this.uniforms.uAspect.value = this.width / this.height
    const fxaaResolution = this.fxaaPass.uniforms.resolution.value as THREE.Vector2
    fxaaResolution.set(
      1 / this.currentResolution.x,
      1 / this.currentResolution.y,
    )
  }

  render(
    recipe: BackgroundRecipeV2,
    timeMs: number,
    options: MaterialGpuFrameOptions = {},
  ): void {
    if (this.disposed) throw new Error('GPU Look pipeline is disposed')
    if (this.renderer.getContext().isContextLost()) {
      throw new Error('WebGL context is lost')
    }

    const phase = options.phase === undefined
      ? materialLookLoopPhase(timeMs, recipe.motion.loopSeconds)
      : ((options.phase % 1) + 1) % 1
    const exportResolution = options.exportResolution
    this.lastPhase = phase
    this.uniforms.uResolution.value.copy(this.currentResolution)
    this.uniforms.uViewportResolution.value.copy(this.viewportResolution)
    this.uniforms.uExportResolution.value.set(
      exportResolution?.[0] ?? 0,
      exportResolution?.[1] ?? 0,
    )
    this.uniforms.uAspect.value = this.width / this.height
    this.uniforms.uLook.value = MATERIAL_GPU_LOOK_INDEX[recipe.look.id] ?? 0
    this.uniforms.uSeed.value = recipe.seed
    this.uniforms.uComplexity.value = THREE.MathUtils.clamp(recipe.look.detail, 0, 1)
    this.uniforms.uMotionAmount.value = recipe.motion.enabled
      ? THREE.MathUtils.clamp(recipe.motion.amount, 0, 1)
      : 0
    this.uniforms.uEnergy.value = materialLookEnergy(recipe.motion.speed)
    this.uniforms.uLoopPhase.value = phase
    this.uniforms.uCameraNear.value = this.camera.near
    this.uniforms.uCameraFar.value = this.camera.far
    this.updatePalette(recipe)
    this.composer.render(0)
    if (this.shaderErrorMessage) {
      throw new Error(this.shaderErrorMessage)
    }
  }

  getMetrics(): MaterialGpuMetrics {
    const info = this.renderer.info
    return {
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      calls: info.render.calls,
      triangles: info.render.triangles,
      width: this.currentResolution.x,
      height: this.currentResolution.y,
      phase: this.lastPhase,
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.shaderDebug.onShaderError === this.shaderErrorHandler) {
      this.shaderDebug.onShaderError = this.previousShaderErrorHandler
    }
    this.lookPass.dispose()
    this.outputPass.dispose()
    this.fxaaPass.dispose()
    this.composer.renderTarget1.depthTexture?.dispose()
    this.composer.renderTarget2.depthTexture?.dispose()
    this.composer.dispose()
  }

  private updatePalette(recipe: BackgroundRecipeV2): void {
    const paletteKey = JSON.stringify({
      look: recipe.look.id,
      detail: recipe.look.detail,
      mix: recipe.palette.mix,
      ground: recipe.palette.ground,
      ink: recipe.palette.ink,
      highlight: recipe.material.highlightColor,
    })
    if (paletteKey === this.paletteKey) return
    this.paletteKey = paletteKey

    const palette = resolveMaterialGpuPalette(recipe)
    this.uniforms.uPaletteCount.value = palette.colors.length
    this.uniforms.uGroundColor.value.set(palette.ground)
    this.uniforms.uInkColor.value.set(palette.ink)
    for (let index = 0; index < MAX_MATERIAL_GPU_PALETTE_COLORS; index += 1) {
      this.uniforms.uPalette.value[index].set(
        palette.colors[index] ?? palette.colors[0] ?? DEFAULT_BLUE,
      )
      this.uniforms.uPaletteWeights.value[index] = palette.weights[index] ?? 0
    }
  }
}
