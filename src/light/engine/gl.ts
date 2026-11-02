import type { UniformMap, UniformValue } from '../scene'

export class LightEngineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LightEngineError'
  }
}

/** A lost context draws nothing and reads back zeros, so every use of one throws with this message. */
export const CONTEXT_LOST_MESSAGE = 'WebGL context lost: create a new renderer on a new canvas.'

export type TextureFormat = 'rgba16f' | 'rgba8'

export interface Target {
  readonly width: number
  readonly height: number
  readonly format: TextureFormat
  readonly texture: WebGLTexture
  readonly framebuffer: WebGLFramebuffer
}

interface UniformInfo {
  location: WebGLUniformLocation
  type: number
  size: number
}

export interface Program {
  readonly program: WebGLProgram
  readonly uniforms: ReadonlyMap<string, UniformInfo>
}

export type Viewport = readonly [x: number, y: number, width: number, height: number]

export interface DrawOptions {
  uniforms?: UniformMap
  textures?: Record<string, Target>
  /** Defaults to the whole target. */
  viewport?: Viewport
}

const FULLSCREEN_VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas

/** Owns one WebGL2 context: programs, render targets and fullscreen-triangle draws. */
export class Gpu {
  readonly gl: WebGL2RenderingContext
  readonly canvas: AnyCanvas
  private readonly programs = new Map<string, Program>()
  private readonly vertexShader: WebGLShader
  private readonly vao: WebGLVertexArrayObject
  private readonly freeTargets: Target[] = []
  private readonly liveTargets = new Set<Target>()
  private lost = false

  constructor(canvas: AnyCanvas) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    }) as WebGL2RenderingContext | null
    if (!gl) throw new LightEngineError('WebGL2 is not available in this browser.')
    if (gl.isContextLost()) throw new LightEngineError(CONTEXT_LOST_MESSAGE)
    const floatTargets = gl.getExtension('EXT_color_buffer_float') ?? gl.getExtension('EXT_color_buffer_half_float')
    if (!floatTargets) {
      throw new LightEngineError(
        'This GPU cannot render to half-float textures (needs EXT_color_buffer_float or EXT_color_buffer_half_float).',
      )
    }
    this.gl = gl
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault()
      this.lost = true
    })
    this.vertexShader = this.compile(gl.VERTEX_SHADER, FULLSCREEN_VERTEX)
    const vao = gl.createVertexArray()
    if (!vao) throw new LightEngineError('Could not create a vertex array.')
    this.vao = vao
    gl.disable(gl.BLEND)
    gl.disable(gl.DEPTH_TEST)
    gl.pixelStorei(gl.PACK_ALIGNMENT, 1)
  }

  get isLost(): boolean {
    return this.lost || this.gl.isContextLost()
  }

  /** Throws if the context is lost or the GPU ran out of memory since the last call. Waits for the GPU, so call it once per export, not per frame. */
  checkErrors(): void {
    const error = this.gl.getError()
    if (this.isLost || error === this.gl.CONTEXT_LOST_WEBGL) throw new LightEngineError(CONTEXT_LOST_MESSAGE)
    if (error === this.gl.OUT_OF_MEMORY) throw new LightEngineError('The GPU ran out of memory for this render.')
  }

  /** Compiles (once per source) a fragment shader drawn over a fullscreen triangle. */
  program(fragmentSource: string): Program {
    const cached = this.programs.get(fragmentSource)
    if (cached) return cached
    const gl = this.gl
    const fragment = this.compile(gl.FRAGMENT_SHADER, fragmentSource)
    const program = gl.createProgram()
    if (!program) throw new LightEngineError('Could not create a program.')
    gl.attachShader(program, this.vertexShader)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    gl.deleteShader(fragment)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) ?? ''
      gl.deleteProgram(program)
      throw new LightEngineError(`Program link failed: ${log}`)
    }
    const uniforms = new Map<string, UniformInfo>()
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(program, i)
      if (!info) continue
      const location = gl.getUniformLocation(program, info.name)
      if (!location) continue
      const entry = { location, type: info.type, size: info.size }
      uniforms.set(info.name, entry)
      if (info.name.endsWith('[0]')) uniforms.set(info.name.slice(0, -3), entry)
    }
    const entry: Program = { program, uniforms }
    this.programs.set(fragmentSource, entry)
    return entry
  }

  acquire(width: number, height: number, format: TextureFormat = 'rgba16f'): Target {
    const w = Math.max(1, Math.round(width))
    const h = Math.max(1, Math.round(height))
    const index = this.freeTargets.findIndex((t) => t.width === w && t.height === h && t.format === format)
    if (index >= 0) {
      const [target] = this.freeTargets.splice(index, 1)
      this.liveTargets.add(target)
      return target
    }
    const target = this.createTarget(w, h, format)
    this.liveTargets.add(target)
    return target
  }

  release(target: Target | null | undefined): void {
    if (!target || !this.liveTargets.has(target)) return
    this.liveTargets.delete(target)
    this.freeTargets.push(target)
  }

  /** Frees pooled targets that are not in use. */
  trimPool(keep = 12): void {
    while (this.freeTargets.length > keep) {
      const target = this.freeTargets.shift()
      if (target) this.destroyTarget(target)
    }
  }

  draw(program: Program, target: Target | null, options: DrawOptions = {}): void {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.framebuffer : null)
    const viewport = options.viewport ?? [0, 0, target ? target.width : gl.drawingBufferWidth, target ? target.height : gl.drawingBufferHeight]
    gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3])
    gl.useProgram(program.program)
    const units: number[] = []
    let unit = 0
    for (const [name, texture] of Object.entries(options.textures ?? {})) {
      const info = program.uniforms.get(name)
      if (!info) continue
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, texture.texture)
      gl.uniform1i(info.location, unit)
      units.push(unit)
      unit++
    }
    for (const [name, value] of Object.entries(options.uniforms ?? {})) {
      const info = program.uniforms.get(name)
      if (info) setUniform(gl, info, value)
    }
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    for (const u of units) {
      gl.activeTexture(gl.TEXTURE0 + u)
      gl.bindTexture(gl.TEXTURE_2D, null)
    }
  }

  /** Reads an RGBA8 target. Rows come back in texture order (row 0 first). Throws if the context is lost before or during the read. */
  readPixels(target: Target, x = 0, y = 0, width = target.width, height = target.height): Uint8Array<ArrayBuffer> {
    if (target.format !== 'rgba8') throw new LightEngineError('readPixels expects an RGBA8 target.')
    if (this.isLost) throw new LightEngineError(CONTEXT_LOST_MESSAGE)
    const gl = this.gl
    const out = new Uint8Array(width * height * 4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer)
    gl.readPixels(x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, out)
    if (this.isLost) throw new LightEngineError(CONTEXT_LOST_MESSAGE)
    return out
  }

  /** Reads a half-float target as float32 RGBA. */
  readFloatPixels(target: Target): Float32Array {
    const gl = this.gl
    const out = new Float32Array(target.width * target.height * 4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer)
    gl.readPixels(0, 0, target.width, target.height, gl.RGBA, gl.FLOAT, out)
    return out
  }

  dispose(): void {
    const gl = this.gl
    for (const target of [...this.freeTargets, ...this.liveTargets]) this.destroyTarget(target)
    this.freeTargets.length = 0
    this.liveTargets.clear()
    for (const program of this.programs.values()) gl.deleteProgram(program.program)
    this.programs.clear()
    gl.deleteShader(this.vertexShader)
    gl.deleteVertexArray(this.vao)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  }

  private compile(type: number, source: string): WebGLShader {
    const gl = this.gl
    const shader = gl.createShader(type)
    if (!shader) throw new LightEngineError('Could not create a shader.')
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? ''
      gl.deleteShader(shader)
      throw new LightEngineError(`Shader compile failed:\n${log}\n${numberLines(source, log)}`)
    }
    return shader
  }

  private createTarget(width: number, height: number, format: TextureFormat): Target {
    const gl = this.gl
    const texture = gl.createTexture()
    const framebuffer = gl.createFramebuffer()
    if (!texture || !framebuffer) throw new LightEngineError('Could not create a render target.')
    gl.bindTexture(gl.TEXTURE_2D, texture)
    switch (format) {
      case 'rgba16f':
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null)
        break
      case 'rgba8':
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
        break
      default: {
        const unknown: never = format
        throw new LightEngineError(`Unknown texture format: ${String(unknown)}`)
      }
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
    gl.bindTexture(gl.TEXTURE_2D, null)
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteTexture(texture)
      gl.deleteFramebuffer(framebuffer)
      throw new LightEngineError(`Render target ${width}x${height} ${format} is incomplete (status ${status}).`)
    }
    return { width, height, format, texture, framebuffer }
  }

  private destroyTarget(target: Target): void {
    this.gl.deleteTexture(target.texture)
    this.gl.deleteFramebuffer(target.framebuffer)
  }
}

function setUniform(gl: WebGL2RenderingContext, info: UniformInfo, value: UniformValue): void {
  const { location, type } = info
  const list = typeof value === 'number' || typeof value === 'boolean' ? [Number(value)] : Array.from(value as ArrayLike<number>)
  switch (type) {
    case gl.FLOAT:
      gl.uniform1fv(location, list)
      return
    case gl.FLOAT_VEC2:
      gl.uniform2fv(location, list)
      return
    case gl.FLOAT_VEC3:
      gl.uniform3fv(location, list)
      return
    case gl.FLOAT_VEC4:
      gl.uniform4fv(location, list)
      return
    case gl.INT:
    case gl.BOOL:
    case gl.SAMPLER_2D:
      gl.uniform1iv(location, list.map(Math.round))
      return
    case gl.INT_VEC2:
    case gl.BOOL_VEC2:
      gl.uniform2iv(location, list.map(Math.round))
      return
    case gl.INT_VEC3:
    case gl.BOOL_VEC3:
      gl.uniform3iv(location, list.map(Math.round))
      return
    case gl.INT_VEC4:
    case gl.BOOL_VEC4:
      gl.uniform4iv(location, list.map(Math.round))
      return
    case gl.UNSIGNED_INT:
      gl.uniform1uiv(location, list.map((v) => Math.max(0, Math.round(v))))
      return
    case gl.FLOAT_MAT2:
      gl.uniformMatrix2fv(location, false, list)
      return
    case gl.FLOAT_MAT3:
      gl.uniformMatrix3fv(location, false, list)
      return
    case gl.FLOAT_MAT4:
      gl.uniformMatrix4fv(location, false, list)
      return
    default:
      throw new LightEngineError(`Unsupported uniform type 0x${type.toString(16)}`)
  }
}

function numberLines(source: string, log: string): string {
  const wanted = new Set<number>()
  for (const match of log.matchAll(/ERROR: \d+:(\d+)/g)) wanted.add(Number(match[1]))
  const lines = source.split('\n')
  return lines
    .map((line, i) => ({ n: i + 1, line }))
    .filter(({ n }) => wanted.size === 0 || [...wanted].some((w) => Math.abs(w - n) <= 2))
    .map(({ n, line }) => `${String(n).padStart(4)}| ${line}`)
    .join('\n')
}
