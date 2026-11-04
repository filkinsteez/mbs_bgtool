// A small WebGL2 runner for the prototype: uploads a frame, builds the per-cell source the engine's filter chain
// would bind (each texel the mean of 4 x 4 samples over its cell), runs the ASCII stage, encodes and dithers.
// Texture rows are top-down throughout, like the engine's output targets.
import { CHUNK_LIBRARY, GLSL_HEADER } from '../../src/light/engine/glsl'
import { ASCII_GLSL, ASCII_GLYPHS_GLSL, LINE_EM, ADVANCE_EM, asciiGrid, asciiUniforms, type Knobs, type Ramp } from './filter'

const VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

const SOURCE_SHADER =
  GLSL_HEADER +
  CHUNK_LIBRARY +
  /* glsl */ `
uniform sampler2D uFrame;
uniform vec2 uFrameSize;
uniform ivec2 uGrid;
out vec4 fragColor;
void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  vec2 cellPx = uFrameSize / vec2(uGrid);
  vec3 sum = vec3(0.0);
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      vec2 p = (vec2(cell) + (vec2(float(i), float(j)) + 0.5) / 4.0) * cellPx;
      sum += srgbToLinear(texelFetch(uFrame, ivec2(floor(p)), 0).rgb);
    }
  }
  fragColor = vec4(sum / 16.0, 1.0);
}
`

// Same TPDF dither as the engine's output pass.
const DITHER = /* glsl */ `
vec3 ditherOut(vec3 encoded, ivec2 px) {
  uvec3 a = hashKey(ivec3(px, uSeed + 9001));
  uvec3 b = pcg3d(a ^ uvec3(0x9E3779B9u, 0x85EBCA6Bu, 0xC2B2AE35u));
  vec3 u = unitFromUint(a);
  vec3 triangular = u + unitFromUint(b) - 1.0;
  vec3 v = encoded * 255.0;
  vec3 edge = min(saturate(v / 0.5), 1.0 - saturate((v - 254.5) / 0.5));
  return encoded + mix(u - 0.5, triangular, edge) / 255.0;
}
`

const OUTPUT_SHADER =
  GLSL_HEADER +
  CHUNK_LIBRARY +
  /* glsl */ `
uniform sampler2D uFrame;
uniform int uSeed;
uniform bool uFilter;
out vec4 fragColor;
` +
  ASCII_GLSL +
  DITHER +
  /* glsl */ `
void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  vec3 display = srgbToLinear(texelFetch(uFrame, px, 0).rgb);
  if (uFilter) display = saturate(filterAscii(display, px, 1.0));
  vec3 encoded = ditherOut(linearToSrgb(display), px);
  fragColor = vec4(floor(saturate(encoded) * 255.0 + 0.5) / 255.0, 1.0);
}
`

// Glyphs in cells laid side by side, ink in all channels; y up inside each cell (for ink sums and glyph sheets).
const GLYPH_SHADER =
  GLSL_HEADER +
  CHUNK_LIBRARY +
  ASCII_GLYPHS_GLSL +
  /* glsl */ `
uniform vec2 uCell;
uniform float uEm;
uniform float uBaselineFromBottom;
uniform int uGlyphs[10];
out vec4 fragColor;
void main() {
  vec2 p = gl_FragCoord.xy;
  int slot = int(floor(p.x / uCell.x));
  vec2 local = p - vec2(float(slot) * uCell.x, 0.0);
  vec2 q = vec2(local.x - 0.5 * uCell.x, local.y - uBaselineFromBottom) / uEm;
  float ink = asciiInk(uGlyphs[min(slot, 9)], q, 1.0 / uEm);
  fragColor = vec4(vec3(1.0 - ink), 1.0);
}
`

interface Compiled {
  program: WebGLProgram
  uniforms: Map<string, { location: WebGLUniformLocation; type: number }>
}

type Uniform = number | boolean | readonly number[]

export class Runner {
  readonly gl: WebGL2RenderingContext
  private readonly vao: WebGLVertexArrayObject
  private readonly vertex: WebGLShader
  private readonly cache = new Map<string, Compiled>()

  constructor() {
    const canvas = new OffscreenCanvas(1, 1)
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false })
    if (!gl) throw new Error('no WebGL2')
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('no EXT_color_buffer_float')
    this.gl = gl
    this.vertex = this.compile(gl.VERTEX_SHADER, VERTEX)
    this.vao = gl.createVertexArray() as WebGLVertexArrayObject
    gl.pixelStorei(gl.PACK_ALIGNMENT, 1)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  }

  private compile(type: number, source: string): WebGLShader {
    const gl = this.gl
    const shader = gl.createShader(type) as WebGLShader
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? ''
      const lines = source.split('\n')
      const near = [...log.matchAll(/ERROR: \d+:(\d+)/g)].map((m) => Number(m[1]))
      const context = near.map((n) => lines.slice(Math.max(0, n - 3), n + 2).map((l, i) => `${n - 2 + i}| ${l}`).join('\n')).join('\n---\n')
      throw new Error(`shader compile failed:\n${log}\n${context}`)
    }
    return shader
  }

  program(fragment: string): Compiled {
    const cached = this.cache.get(fragment)
    if (cached) return cached
    const gl = this.gl
    const program = gl.createProgram() as WebGLProgram
    gl.attachShader(program, this.vertex)
    gl.attachShader(program, this.compile(gl.FRAGMENT_SHADER, fragment))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`link failed: ${gl.getProgramInfoLog(program)}`)
    const uniforms = new Map<string, { location: WebGLUniformLocation; type: number }>()
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(program, i)
      if (!info) continue
      const location = gl.getUniformLocation(program, info.name)
      if (!location) continue
      uniforms.set(info.name.replace(/\[0\]$/, ''), { location, type: info.type })
    }
    const compiled = { program, uniforms }
    this.cache.set(fragment, compiled)
    return compiled
  }

  texture(width: number, height: number, format: 'rgba8' | 'rgba16f', data: Uint8Array | null = null): WebGLTexture {
    const gl = this.gl
    const texture = gl.createTexture() as WebGLTexture
    gl.bindTexture(gl.TEXTURE_2D, texture)
    if (format === 'rgba8') gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data)
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return texture
  }

  draw(fragment: string, target: WebGLTexture, width: number, height: number, uniforms: Record<string, Uniform>, textures: Record<string, WebGLTexture>): void {
    const gl = this.gl
    const { program, uniforms: info } = this.program(fragment)
    const framebuffer = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0)
    gl.viewport(0, 0, width, height)
    gl.useProgram(program)
    let unit = 0
    for (const [name, texture] of Object.entries(textures)) {
      const u = info.get(name)
      if (!u) continue
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.uniform1i(u.location, unit++)
    }
    for (const [name, value] of Object.entries(uniforms)) {
      const u = info.get(name)
      if (!u) continue
      const list = typeof value === 'number' || typeof value === 'boolean' ? [Number(value)] : [...value]
      switch (u.type) {
        case gl.FLOAT:
          gl.uniform1fv(u.location, list)
          break
        case gl.FLOAT_VEC2:
          gl.uniform2fv(u.location, list)
          break
        case gl.FLOAT_VEC3:
          gl.uniform3fv(u.location, list)
          break
        case gl.FLOAT_VEC4:
          gl.uniform4fv(u.location, list)
          break
        case gl.INT:
        case gl.BOOL:
          gl.uniform1iv(u.location, list.map(Math.round))
          break
        case gl.INT_VEC2:
          gl.uniform2iv(u.location, list.map(Math.round))
          break
        default:
          throw new Error(`uniform ${name}: type 0x${u.type.toString(16)} not handled`)
      }
    }
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.deleteFramebuffer(framebuffer)
  }

  read(texture: WebGLTexture, width: number, height: number): Uint8Array {
    const gl = this.gl
    const framebuffer = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    const out = new Uint8Array(width * height * 4)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, out)
    gl.deleteFramebuffer(framebuffer)
    return out
  }

  /** Glyphs (ids) side by side at em px per em; white paper, black ink; rows come back bottom-up. */
  glyphs(ids: number[], em: number, cellW = ADVANCE_EM * em, cellH = LINE_EM * em, baselineFromBottom = 0.42 * em) {
    const width = Math.round(cellW * ids.length)
    const height = Math.round(cellH)
    const target = this.texture(width, height, 'rgba8')
    const slots = [...ids, ...Array(10 - ids.length).fill(0)]
    this.draw(GLYPH_SHADER, target, width, height, { uCell: [cellW, cellH], uEm: em, uBaselineFromBottom: baselineFromBottom, uGlyphs: slots }, {})
    const data = this.read(target, width, height)
    this.gl.deleteTexture(target)
    return { width, height, data }
  }

  /** Ink share of a 0.6 x 1.3 em cell for glyphs 0..9, measured at 512 px per em. */
  coverage(): number[] {
    const em = 512
    const { width, height, data } = this.glyphs([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], em)
    const cellW = width / 10
    const sums = new Array(10).fill(0)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) sums[Math.min(9, Math.floor(x / cellW))] += 1 - data[(y * width + x) * 4] / 255
    }
    return sums.map((s) => s / (cellW * height))
  }

  /** Runs the stage over an RGBA8 frame (top row first) and returns RGBA8 (top row first). */
  ascii(frame: { width: number; height: number; data: Uint8Array }, strength: number, seed: number, knobs: Knobs, ramp: Ramp, filter = true) {
    const { width, height } = frame
    const grid = asciiGrid(frame, knobs.rowsOnShort)
    const frameTexture = this.texture(width, height, 'rgba8', frame.data)
    const cells = this.texture(grid.cols, grid.rows, 'rgba16f')
    this.draw(SOURCE_SHADER, cells, grid.cols, grid.rows, { uFrameSize: [width, height], uGrid: [grid.cols, grid.rows] }, { uFrame: frameTexture })
    const out = this.texture(width, height, 'rgba8')
    const uniforms = { ...asciiUniforms(strength, { width, height, seed }, knobs, ramp), uSeed: seed, uFilter: filter }
    this.draw(OUTPUT_SHADER, out, width, height, uniforms, { uFrame: frameTexture, uAsciiCells: cells })
    const data = this.read(out, width, height)
    for (const t of [frameTexture, cells, out]) this.gl.deleteTexture(t)
    return { width, height, data, grid }
  }
}
