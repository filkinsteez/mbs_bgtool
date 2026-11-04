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
const TEXTURE_FORMATS: readonly TextureFormat[] = ['rgba16f', 'rgba8']

export interface Target {
  readonly width: number
  readonly height: number
  readonly format: TextureFormat
  readonly texture: WebGLTexture
  readonly framebuffer: WebGLFramebuffer
  /** A second image the same size, written by fragment output location 1 when this target is drawn to. */
  readonly second?: Target
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

/** Free targets stay pooled for this many renders after their last use, within this many bytes. */
const POOL_RENDERS = 2
const POOL_BYTES = 256 * 1024 * 1024

/** KHR_parallel_shader_compile: whether a program has finished compiling and linking, answered without waiting. */
const COMPLETION_STATUS_KHR = 0x91b1

/** A program whose compile and link have been issued and not yet checked. */
interface PendingProgram {
  readonly program: WebGLProgram
  readonly fragment: WebGLShader
}

/** Stands in for a program still compiling during a render that doesn't wait; draws with it are skipped. */
const UNREADY: Program = { program: null as unknown as WebGLProgram, uniforms: new Map() }

/** Owns one WebGL2 context: programs, render targets and fullscreen-triangle draws. */
export class Gpu {
  readonly gl: WebGL2RenderingContext
  readonly canvas: AnyCanvas
  /** KHR_parallel_shader_compile: programs compile on the driver's threads and can be checked without waiting. */
  readonly compilesInBackground: boolean
  private readonly programs = new Map<string, Program>()
  private readonly pending = new Map<string, PendingProgram>()
  /** During a render that doesn't wait for compiles: the programs it found still compiling. */
  private unfinished: string[] | null = null
  private readonly vertexShader: WebGLShader
  private readonly vao: WebGLVertexArrayObject
  /** Oldest release first. */
  private readonly freeTargets: Target[] = []
  private readonly liveTargets = new Set<Target>()
  private readonly releasedAt = new Map<Target, number>()
  /** Target formats whose framebuffers have been checked once; the check waits for the GPU, so it isn't repeated. */
  private readonly checkedFormats = new Set<string>()
  private renders = 0
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
    this.compilesInBackground = gl.getExtension('KHR_parallel_shader_compile') !== null
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
    // Checked now, while the GPU is idle; later the check would wait behind whatever the GPU is drawing.
    for (const format of TEXTURE_FORMATS) {
      try {
        this.destroyTarget(this.createPair(1, 1, format))
      } catch {
        // Left unchecked: a target of this format checks again, and throws, when it is made.
      }
    }
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

  /**
   * Compiles (once per source) a fragment shader drawn over a fullscreen triangle, and waits for it. Inside
   * `withoutWaiting`, a program still compiling is left to finish in the background instead: the render gets a
   * stand-in and draws nothing more.
   */
  program(fragmentSource: string): Program {
    const cached = this.programs.get(fragmentSource)
    if (cached) return cached
    const pending = this.pending.get(fragmentSource) ?? this.start(fragmentSource)
    if (this.unfinished && this.compilesInBackground && !this.isDone(pending)) {
      this.unfinished.push(fragmentSource)
      return UNREADY
    }
    return this.finish(fragmentSource, pending)
  }

  /** Starts compiling these programs without waiting for them. Without KHR_parallel_shader_compile it does nothing. */
  prepare(fragmentSources: Iterable<string>): void {
    if (!this.compilesInBackground) return
    for (const source of fragmentSources) if (!this.programs.has(source) && !this.pending.has(source)) this.start(source)
  }

  /** Whether these programs have finished compiling. Always true without the extension, where they compile when drawn. */
  compiled(fragmentSources: readonly string[]): boolean {
    if (!this.compilesInBackground) return true
    return fragmentSources.every((source) => {
      if (this.programs.has(source)) return true
      const pending = this.pending.get(source)
      return pending !== undefined && this.isDone(pending)
    })
  }

  /**
   * Runs `render` without waiting for shader compiles (KHR_parallel_shader_compile): a program still compiling is
   * started or left running, and from then on nothing is drawn. Returns `render`'s value and the programs still
   * compiling (none: the render is complete). Without the extension `render` runs as usual and compiles as it goes.
   */
  withoutWaiting<T>(render: () => T): { value: T; unfinished: string[] } {
    if (!this.compilesInBackground) return { value: render(), unfinished: [] }
    const unfinished: string[] = []
    this.unfinished = unfinished
    try {
      return { value: render(), unfinished }
    } finally {
      this.unfinished = null
    }
  }

  /** Inside `withoutWaiting`, once a program was found still compiling: nothing more is drawn. */
  get waiting(): boolean {
    return (this.unfinished?.length ?? 0) > 0
  }

  /** Programs compiled or compiling on this context. */
  get programCount(): number {
    return this.programs.size + this.pending.size
  }

  /** Programs checked and ready to draw with. */
  get finishedPrograms(): number {
    return this.programs.size
  }

  /** A fence after everything issued so far; `signaled` tells, without waiting, when the GPU has done all of it. */
  fence(): WebGLSync {
    const gl = this.gl
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
    if (!sync) throw new LightEngineError('Could not create a fence.')
    gl.flush()
    return sync
  }

  /** Whether the GPU has passed this fence; deletes it once it has. A lost context counts as passed. */
  signaled(sync: WebGLSync): boolean {
    const gl = this.gl
    if (this.isLost) return true
    if (gl.getSyncParameter(sync, gl.SYNC_STATUS) !== gl.SIGNALED) return false
    gl.deleteSync(sync)
    return true
  }

  private start(fragmentSource: string): PendingProgram {
    const gl = this.gl
    const fragment = gl.createShader(gl.FRAGMENT_SHADER)
    const program = gl.createProgram()
    if (!fragment || !program) throw new LightEngineError('Could not create a program.')
    gl.shaderSource(fragment, fragmentSource)
    gl.compileShader(fragment)
    gl.attachShader(program, this.vertexShader)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    const pending = { program, fragment }
    this.pending.set(fragmentSource, pending)
    return pending
  }

  private isDone(pending: PendingProgram): boolean {
    return this.gl.getProgramParameter(pending.program, COMPLETION_STATUS_KHR) === true
  }

  /** Checks a started program (waiting for it if it is still compiling) and keeps it with its uniforms. */
  private finish(fragmentSource: string, { program, fragment }: PendingProgram): Program {
    const gl = this.gl
    this.pending.delete(fragmentSource)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const compiled = gl.getShaderParameter(fragment, gl.COMPILE_STATUS)
      const log = (compiled ? gl.getProgramInfoLog(program) : gl.getShaderInfoLog(fragment)) ?? ''
      gl.deleteShader(fragment)
      gl.deleteProgram(program)
      throw new LightEngineError(compiled ? `Program link failed: ${log}` : `Shader compile failed:\n${log}\n${numberLines(fragmentSource, log)}`)
    }
    gl.deleteShader(fragment)
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

  /** A render target from the pool; with `images` 2 it also has a `second` image for output location 1. */
  acquire(width: number, height: number, format: TextureFormat = 'rgba16f', images: 1 | 2 = 1): Target {
    const w = Math.max(1, Math.round(width))
    const h = Math.max(1, Math.round(height))
    const index = this.freeTargets.findIndex(
      (t) => t.width === w && t.height === h && t.format === format && (t.second ? 2 : 1) === images,
    )
    if (index >= 0) {
      const [target] = this.freeTargets.splice(index, 1)
      this.liveTargets.add(target)
      return target
    }
    const target = images === 2 ? this.createPair(w, h, format) : this.createTarget(w, h, format)
    this.liveTargets.add(target)
    return target
  }

  release(target: Target | null | undefined): void {
    if (!target || !this.liveTargets.has(target)) return
    this.liveTargets.delete(target)
    this.freeTargets.push(target)
    this.releasedAt.set(target, this.renders)
  }

  /**
   * Call once at the end of each render. Frees pooled targets that the last
   * POOL_RENDERS renders did not use, and the oldest while the pool is over
   * POOL_BYTES. Creating a target waits for the GPU, so repeated renders of
   * one size reuse theirs.
   */
  trimPool(): void {
    this.renders++
    let bytes = 0
    for (let i = this.freeTargets.length - 1; i >= 0; i--) {
      const target = this.freeTargets[i]
      const size = targetBytes(target)
      if (this.renders - (this.releasedAt.get(target) ?? 0) > POOL_RENDERS || bytes + size > POOL_BYTES) {
        this.freeTargets.splice(i, 1)
        this.releasedAt.delete(target)
        this.destroyTarget(target)
      } else {
        bytes += size
      }
    }
  }

  draw(program: Program, target: Target | null, options: DrawOptions = {}): void {
    if (program === UNREADY || this.waiting) return
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.framebuffer : null)
    const width = target ? target.width : gl.drawingBufferWidth
    const height = target ? target.height : gl.drawingBufferHeight
    const viewport = options.viewport ?? [0, 0, width, height]
    // Nothing blends, so a draw over the whole target needs none of its old contents loaded.
    if (viewport[0] <= 0 && viewport[1] <= 0 && viewport[0] + viewport[2] >= width && viewport[1] + viewport[3] >= height) {
      gl.invalidateFramebuffer(gl.FRAMEBUFFER, !target ? [gl.COLOR] : target.second ? [gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1] : [gl.COLOR_ATTACHMENT0])
    }
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
    for (const { program, fragment } of this.pending.values()) {
      gl.deleteShader(fragment)
      gl.deleteProgram(program)
    }
    this.pending.clear()
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
    const status = this.checkOnce(format)
    gl.bindTexture(gl.TEXTURE_2D, null)
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteTexture(texture)
      gl.deleteFramebuffer(framebuffer)
      throw new LightEngineError(`Render target ${width}x${height} ${format} is incomplete (status ${status}).`)
    }
    return { width, height, format, texture, framebuffer }
  }

  /** Two images drawn together: `texture` takes output location 0, `second.texture` location 1. */
  private createPair(width: number, height: number, format: TextureFormat): Target {
    const gl = this.gl
    const first = this.createTarget(width, height, format)
    const second = this.createTarget(width, height, format)
    gl.bindFramebuffer(gl.FRAMEBUFFER, first.framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, second.texture, 0)
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1])
    const status = this.checkOnce(`${format} pair`)
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      this.destroyTarget(first)
      this.destroyTarget(second)
      throw new LightEngineError(`Render target pair ${width}x${height} ${format} is incomplete (status ${status}).`)
    }
    return { ...first, second }
  }

  /**
   * The bound framebuffer's status, checked for the first target of each kind only: completeness depends on the
   * format, and the check waits for the GPU, which in a preview stalls the page while the driver builds a program.
   */
  private checkOnce(kind: string): number {
    const gl = this.gl
    if (this.checkedFormats.has(kind)) return gl.FRAMEBUFFER_COMPLETE
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
    if (status === gl.FRAMEBUFFER_COMPLETE) this.checkedFormats.add(kind)
    return status
  }

  private destroyTarget(target: Target): void {
    this.gl.deleteTexture(target.texture)
    this.gl.deleteFramebuffer(target.framebuffer)
    if (target.second) this.destroyTarget(target.second)
  }
}

function targetBytes(target: Target): number {
  return target.width * target.height * (target.format === 'rgba16f' ? 8 : 4) * (target.second ? 2 : 1)
}

function setUniform(gl: WebGL2RenderingContext, info: UniformInfo, value: UniformValue): void {
  const { location, type } = info
  const list =
    typeof value === 'number' || typeof value === 'boolean' ? [Number(value)] : value instanceof Float32Array ? value : Array.from(value as ArrayLike<number>)
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
      gl.uniform1iv(location, Array.from(list, Math.round))
      return
    case gl.INT_VEC2:
    case gl.BOOL_VEC2:
      gl.uniform2iv(location, Array.from(list, Math.round))
      return
    case gl.INT_VEC3:
    case gl.BOOL_VEC3:
      gl.uniform3iv(location, Array.from(list, Math.round))
      return
    case gl.INT_VEC4:
    case gl.BOOL_VEC4:
      gl.uniform4iv(location, Array.from(list, Math.round))
      return
    case gl.UNSIGNED_INT:
      gl.uniform1uiv(location, Array.from(list, (v) => Math.max(0, Math.round(v))))
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
