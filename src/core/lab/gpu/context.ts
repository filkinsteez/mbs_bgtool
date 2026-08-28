type FramebufferEntry = {
  key: string
  width: number
  height: number
  texture: WebGLTexture
  framebuffer: WebGLFramebuffer
}

export class GpuLabContext {
  readonly canvas: HTMLCanvasElement
  readonly gl: WebGL2RenderingContext
  private readonly framebuffers = new Map<string, FramebufferEntry>()
  private lost = false

  constructor() {
    this.canvas = document.createElement('canvas')
    const context = this.canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    })
    if (!context) throw new Error('WebGL2 unavailable for V2 renderer')
    this.gl = context
    this.canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault()
      this.lost = true
    })
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false
      this.disposeFramebuffers()
    })
  }

  isContextLost(): boolean {
    return this.lost || this.gl.isContextLost()
  }

  setSize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width))
    const h = Math.max(1, Math.round(height))
    if (this.canvas.width === w && this.canvas.height === h) return
    this.canvas.width = w
    this.canvas.height = h
    this.gl.viewport(0, 0, w, h)
  }

  acquireFramebuffer(key: string, width: number, height: number): FramebufferEntry {
    const w = Math.max(1, Math.round(width))
    const h = Math.max(1, Math.round(height))
    const existing = this.framebuffers.get(key)
    if (existing && existing.width === w && existing.height === h) return existing
    if (existing) this.deleteFramebuffer(existing)

    const texture = this.gl.createTexture()
    const framebuffer = this.gl.createFramebuffer()
    if (!texture || !framebuffer) {
      throw new Error('Failed to allocate framebuffer resources')
    }
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture)
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR)
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR)
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE)
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE)
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      w,
      h,
      0,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      null,
    )
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer)
    this.gl.framebufferTexture2D(
      this.gl.FRAMEBUFFER,
      this.gl.COLOR_ATTACHMENT0,
      this.gl.TEXTURE_2D,
      texture,
      0,
    )
    const status = this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER)
    if (status !== this.gl.FRAMEBUFFER_COMPLETE) {
      this.gl.deleteFramebuffer(framebuffer)
      this.gl.deleteTexture(texture)
      throw new Error(`Incomplete framebuffer: ${status}`)
    }
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null)
    const entry: FramebufferEntry = { key, width: w, height: h, texture, framebuffer }
    this.framebuffers.set(key, entry)
    return entry
  }

  disposeFramebuffers(): void {
    for (const entry of this.framebuffers.values()) this.deleteFramebuffer(entry)
    this.framebuffers.clear()
  }

  dispose(): void {
    this.disposeFramebuffers()
  }

  private deleteFramebuffer(entry: FramebufferEntry): void {
    this.gl.deleteFramebuffer(entry.framebuffer)
    this.gl.deleteTexture(entry.texture)
  }
}

let sharedGpuLabContext: GpuLabContext | null = null

export function getGpuLabContext(): GpuLabContext {
  if (!sharedGpuLabContext) sharedGpuLabContext = new GpuLabContext()
  return sharedGpuLabContext
}
