import type { Field } from '@/core/lab/field'
import type { LookColorPlan } from '@/core/lab/colorDirection'
import type { LookId } from '@/core/lab/looks'
import { bakeMetaSdf } from './sdfTexture'
import { getGpuLabContext } from './context'
import { lookSystemForId, systemIndex } from './lookSystems'
import { GPU_NOISE_GLSL } from './noise.glsl'
import { GPU_OKLAB_GLSL } from './oklab.glsl'
import { GPU_SDF_GLSL } from './sdf.glsl'

const MAX_PALETTE = 16

type RenderOptions = {
  id: LookId
  width: number
  height: number
  seed: number
  complexity: number
  palette: readonly string[]
  colorPlan?: LookColorPlan
  influence: Field
  sourceSample?: (x: number, y: number) => readonly [number, number, number] | null
  motionPhase: number
  motionAmount: number
  motionEnergy: number
}

const VERTEX_SHADER = `#version 300 es
precision highp float;
in vec2 aPosition;
out vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform vec2 uResolution;
uniform float uSeed;
uniform float uComplexity;
uniform float uMotionPhase;
uniform float uMotionAmount;
uniform float uMotionEnergy;
uniform int uSystem;
uniform int uPass;
uniform sampler2D uInfluence;
uniform sampler2D uSource;
uniform sampler2D uPrev;
uniform vec3 uPalette[${MAX_PALETTE}];
uniform float uPaletteWeights[${MAX_PALETTE}];
uniform int uPaletteCount;
uniform vec3 uGround;
uniform vec3 uInk;

${GPU_NOISE_GLSL}
${GPU_OKLAB_GLSL}
${GPU_SDF_GLSL}

float sat(float v) { return clamp(v, 0.0, 1.0); }

vec3 paletteAt(float t) {
  float total = 0.0;
  for (int i = 0; i < ${MAX_PALETTE}; i++) {
    if (i >= uPaletteCount) break;
    total += max(0.0001, uPaletteWeights[i]);
  }
  float target = fract(t) * max(0.0001, total);
  float cursor = 0.0;
  vec3 selected = uPalette[0];
  for (int i = 0; i < ${MAX_PALETTE}; i++) {
    if (i >= uPaletteCount) break;
    float w = max(0.0001, uPaletteWeights[i]);
    if (target >= cursor && target <= cursor + w) {
      float local = sat((target - cursor) / w);
      vec3 nextColor = i + 1 < uPaletteCount ? uPalette[i + 1] : uPalette[0];
      selected = oklabMix(uPalette[i], nextColor, smoothstep(0.2, 0.95, local));
    }
    cursor += w;
  }
  return selected;
}

vec2 rotate2d(vec2 p, float a) {
  float s = sin(a);
  float c = cos(a);
  return mat2(c, -s, s, c) * p;
}

float halftone(vec2 uv, float angle, float scale, float amount) {
  vec2 p = rotate2d((uv - 0.5) * uResolution / max(1.0, scale), angle);
  vec2 f = fract(p) - 0.5;
  float dotMask = 1.0 - smoothstep(0.05, 0.48, length(f));
  return mix(1.0, dotMask, amount);
}

void main() {
  vec2 aspect = vec2(uResolution.x / max(uResolution.y, 1.0), 1.0);
  vec2 p = (vUv - 0.5) * aspect;
  vec4 influenceSample = texture(uInfluence, vUv);
  float signedDistance = signedDistanceFromInfluence(influenceSample);
  float influence = sat(influenceSample.b);
  vec3 source = texture(uSource, vUv).rgb;
  vec2 loopOffset = loopNoiseOffset(fract(uMotionPhase), uMotionEnergy) * (0.4 + 0.6 * uMotionAmount);
  vec2 warped = domainWarp(p * (2.2 + 3.1 * uComplexity) + loopOffset + uSeed * 0.001);
  float n = fbm(warped * 1.7 + vec2(uSeed * 0.002, -uSeed * 0.003));
  vec2 curl = normalize(curlNoise(warped + loopOffset * 0.5) + vec2(0.001));
  float flow = 0.5 + 0.5 * dot(curl, normalize(vec2(0.7, 0.35)));
  float bandA = sdfOffsetCurve(signedDistance, 0.0, 0.18 + 0.22 * (1.0 - uComplexity));
  float bandB = sdfOffsetCurve(signedDistance, 0.28, 0.14 + 0.18 * (1.0 - uComplexity));

  if (uPass == 0) {
    float structure = 0.0;
    if (uSystem == 0) {
      structure = sat(0.28 + bandA * 0.38 + bandB * 0.24 + n * 0.42 + influence * 0.26);
    } else if (uSystem == 1) {
      float cell = 16.0 + uComplexity * 72.0;
      vec2 grid = floor(vUv * cell);
      float g = hash21(grid + uSeed * 0.01);
      structure = sat(0.24 + g * 0.42 + influence * 0.32 + bandA * 0.22 + n * 0.34);
    } else if (uSystem == 2) {
      float screen = halftone(vUv, 0.17 + hash11(uSeed) * 0.5, 3.5 + uComplexity * 5.0, 1.0);
      structure = sat(0.2 + (1.0 - screen) * 0.45 + bandA * 0.24 + influence * 0.27 + n * 0.36);
    } else if (uSystem == 3) {
      float lattice = abs(fract((warped.x + warped.y * 0.7) * (10.0 + uComplexity * 20.0)) - 0.5);
      lattice = 1.0 - smoothstep(0.12, 0.28, lattice);
      structure = sat(0.22 + lattice * 0.4 + influence * 0.25 + bandA * 0.2 + n * 0.44);
    } else {
      float advection = sin((warped.y + flow * 0.2) * (16.0 + uComplexity * 42.0));
      float wake = 1.0 - smoothstep(0.62, 0.98, abs(advection));
      structure = sat(0.24 + wake * 0.42 + influence * 0.28 + bandA * 0.22 + n * 0.4);
    }
    outColor = vec4(structure, sat(abs(signedDistance)), influence, flow);
    return;
  }

  vec4 base = texture(uPrev, vUv);
  if (uPass == 1) {
    float structure = base.r;
    float flowVal = base.a;
    float colorIndex = n * 0.45 + structure * 0.28 + flowVal * 0.16 + vUv.x * 0.08 + vUv.y * 0.11;
    vec3 field = paletteAt(colorIndex);
    vec3 body = oklabMix(uGround, field, sat(0.34 + structure * 0.66));
    vec3 sourceTint = oklabMix(body, source, influence * 0.22);
    outColor = vec4(sourceTint, 1.0);
    return;
  }

  if (uPass == 2) {
    vec2 px = 1.0 / max(uResolution, vec2(1.0));
    vec3 c = base.rgb * 0.32;
    c += texture(uPrev, vUv + vec2(px.x, 0.0)).rgb * 0.17;
    c += texture(uPrev, vUv - vec2(px.x, 0.0)).rgb * 0.17;
    c += texture(uPrev, vUv + vec2(0.0, px.y)).rgb * 0.17;
    c += texture(uPrev, vUv - vec2(0.0, px.y)).rgb * 0.17;
    float edgeGlow = sat(base.r + base.g + base.b - c.r - c.g - c.b) * 0.9;
    vec3 halated = c + edgeGlow * 0.08 * uInk;
    outColor = vec4(halated, 1.0);
    return;
  }

  vec3 color = base.rgb;
  float grain = hash21(gl_FragCoord.xy + vec2(uSeed, uSeed * 0.37)) - 0.5;
  float dither = hash21(floor(gl_FragCoord.xy * 0.5) + vec2(uSeed * 0.11, 0.0)) - 0.5;
  float printA = halftone(vUv, 0.21, 2.0 + uComplexity * 6.0, 0.28);
  float printB = halftone(vUv + vec2(0.0015, -0.0015), -0.47, 2.3 + uComplexity * 7.5, 0.22);
  color *= (0.72 + printA * 0.28) * (0.74 + printB * 0.26);
  color += grain * (0.012 + uComplexity * 0.01);
  color += dither * 0.006;
  color = floor(color * 255.0) / 255.0;
  outColor = vec4(max(color, 0.0), 1.0);
}
`

function parseHex(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '').trim()
  const value = normalized.length === 6 ? normalized : '0064E0'
  return [
    Number.parseInt(value.slice(0, 2), 16) / 255,
    Number.parseInt(value.slice(2, 4), 16) / 255,
    Number.parseInt(value.slice(4, 6), 16) / 255,
  ]
}

type ProgramState = {
  program: WebGLProgram
  quad: WebGLBuffer
  uniforms: Record<string, WebGLUniformLocation | null>
}

let state: ProgramState | null = null
let influenceTexture: WebGLTexture | null = null
let sourceTexture: WebGLTexture | null = null

function buildProgram(gl: WebGL2RenderingContext): ProgramState {
  const compile = (kind: number, source: string) => {
    const shader = gl.createShader(kind)
    if (!shader) throw new Error('Shader allocation failed')
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) ?? 'Shader compile failed'
      gl.deleteShader(shader)
      throw new Error(message)
    }
    return shader
  }
  const vs = compile(gl.VERTEX_SHADER, VERTEX_SHADER)
  const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  const program = gl.createProgram()
  if (!program) throw new Error('Program allocation failed')
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.bindAttribLocation(program, 0, 'aPosition')
  gl.linkProgram(program)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? 'Program link failed')
  }
  const quad = gl.createBuffer()
  if (!quad) throw new Error('Quad buffer allocation failed')
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,
    1, -1,
    -1, 1,
    1, 1,
  ]), gl.STATIC_DRAW)
  const uniforms = Object.fromEntries([
    'uResolution', 'uSeed', 'uComplexity', 'uMotionPhase', 'uMotionAmount',
    'uMotionEnergy', 'uSystem', 'uPass', 'uInfluence', 'uSource', 'uPrev',
    'uPalette', 'uPaletteWeights', 'uPaletteCount', 'uGround', 'uInk',
  ].map((name) => [name, gl.getUniformLocation(program, name)]))
  return { program, quad, uniforms }
}

function ensureTexture(gl: WebGL2RenderingContext, existing: WebGLTexture | null): WebGLTexture {
  if (existing) return existing
  const texture = gl.createTexture()
  if (!texture) throw new Error('Texture allocation failed')
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return texture
}

function buildInfluenceMap(width: number, height: number, influence: Field): Uint8Array {
  const { data: sdf } = bakeMetaSdf(width, height)
  const data = new Uint8Array(sdf)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      const amount = Math.max(0, Math.min(1, influence(x + 0.5, y + 0.5)))
      data[index + 2] = Math.round(amount * 255)
    }
  }
  return data
}

function buildSourceMap(
  width: number,
  height: number,
  sourceSample?: (x: number, y: number) => readonly [number, number, number] | null,
): Uint8Array {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      const sample = sourceSample?.(x + 0.5, y + 0.5)
      data[index] = sample?.[0] ?? 0
      data[index + 1] = sample?.[1] ?? 0
      data[index + 2] = sample?.[2] ?? 0
      data[index + 3] = 255
    }
  }
  return data
}

export function renderGpuFieldLook(
  context2d: CanvasRenderingContext2D,
  options: RenderOptions,
): boolean {
  const gpu = getGpuLabContext()
  if (gpu.isContextLost()) return false
  gpu.setSize(options.width, options.height)
  const gl = gpu.gl
  if (!state) state = buildProgram(gl)
  gl.useProgram(state.program)
  gl.bindBuffer(gl.ARRAY_BUFFER, state.quad)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

  influenceTexture = ensureTexture(gl, influenceTexture)
  sourceTexture = ensureTexture(gl, sourceTexture)
  const influenceMap = buildInfluenceMap(options.width, options.height, options.influence)
  const sourceMap = buildSourceMap(options.width, options.height, options.sourceSample)
  // WebGL expects the first unpacked row at the texture bottom by default.
  // Our CPU rasters are authored top-down in image space, so force Y-flip
  // on upload to keep the canonical Meta symbol orientation exact.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, influenceTexture)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, options.width, options.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, influenceMap)
  gl.activeTexture(gl.TEXTURE1)
  gl.bindTexture(gl.TEXTURE_2D, sourceTexture)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, options.width, options.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, sourceMap)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
  gl.uniform1i(state.uniforms.uInfluence, 0)
  gl.uniform1i(state.uniforms.uSource, 1)

  const ping = gpu.acquireFramebuffer('ping', options.width, options.height)
  const pong = gpu.acquireFramebuffer('pong', options.width, options.height)
  gl.uniform2f(state.uniforms.uResolution, options.width, options.height)
  gl.uniform1f(state.uniforms.uSeed, options.seed)
  gl.uniform1f(state.uniforms.uComplexity, Math.max(0, Math.min(1, options.complexity)))
  gl.uniform1f(state.uniforms.uMotionPhase, ((options.motionPhase % 1) + 1) % 1)
  gl.uniform1f(state.uniforms.uMotionAmount, Math.max(0, Math.min(1, options.motionAmount)))
  gl.uniform1f(state.uniforms.uMotionEnergy, Math.max(0, Math.min(1, options.motionEnergy)))
  gl.uniform1i(state.uniforms.uSystem, systemIndex(lookSystemForId(options.id)))

  const swatches = (options.colorPlan?.swatches ?? []).slice(0, MAX_PALETTE)
  const colors = (swatches.length ? swatches.map((item) => item.hex) : options.palette).slice(0, MAX_PALETTE)
  const weights = swatches.length
    ? swatches.map((item) => item.weight)
    : colors.map(() => 1 / Math.max(1, colors.length))
  const paletteArray = new Float32Array(MAX_PALETTE * 3)
  const weightArray = new Float32Array(MAX_PALETTE)
  for (let index = 0; index < MAX_PALETTE; index += 1) {
    const color = parseHex(colors[index] ?? colors[0] ?? '#0064E0')
    paletteArray[index * 3] = color[0]
    paletteArray[index * 3 + 1] = color[1]
    paletteArray[index * 3 + 2] = color[2]
    weightArray[index] = weights[index] ?? 0
  }
  gl.uniform3fv(state.uniforms.uPalette, paletteArray)
  gl.uniform1fv(state.uniforms.uPaletteWeights, weightArray)
  gl.uniform1i(state.uniforms.uPaletteCount, Math.max(1, Math.min(MAX_PALETTE, colors.length)))
  const fallbackGround = colors[colors.length - 1] ?? '#0B1325'
  const fallbackInk = colors[0] ?? '#F8FAFC'
  const ground = parseHex(
    options.colorPlan?.roles.ground != null
      ? swatches[options.colorPlan.roles.ground]?.hex ?? fallbackGround
      : fallbackGround,
  )
  const ink = parseHex(
    options.colorPlan?.roles.ink != null
      ? swatches[options.colorPlan.roles.ink]?.hex ?? fallbackInk
      : fallbackInk,
  )
  gl.uniform3f(state.uniforms.uGround, ground[0], ground[1], ground[2])
  gl.uniform3f(state.uniforms.uInk, ink[0], ink[1], ink[2])

  const drawPass = (pass: number, readTexture: WebGLTexture | null, target: WebGLFramebuffer | null) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target)
    gl.viewport(0, 0, options.width, options.height)
    gl.uniform1i(state!.uniforms.uPass, pass)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, readTexture)
    gl.uniform1i(state!.uniforms.uPrev, 2)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  drawPass(0, null, ping.framebuffer)
  drawPass(1, ping.texture, pong.framebuffer)
  drawPass(2, pong.texture, ping.framebuffer)
  drawPass(3, ping.texture, null)

  context2d.save()
  context2d.setTransform(1, 0, 0, 1, 0, 0)
  context2d.clearRect(0, 0, options.width, options.height)
  context2d.drawImage(gpu.canvas, 0, 0, options.width, options.height)
  context2d.restore()
  return true
}
