import { LightRenderer, type Scene } from '@/light'

const SETTLE_MS = 250
/** A settled 2x render slower than this stops settled 2x renders at that size. */
const SLOW_SETTLE_MS = 300

/**
 * Draws scenes on one canvas with one long-lived renderer. Updates are
 * coalesced to one 1x render per animation frame; once updates stop for
 * SETTLE_MS the frame is drawn again at 2x. Each render waits for the GPU and
 * writes its time to the canvas data attributes (`fastMs`, `settledMs`).
 */
export class PreviewLoop {
  private readonly renderer: LightRenderer
  private readonly pixel = new Uint8Array(4)
  private readonly slowSizes = new Set<string>()
  private scene: Scene | null = null
  private width = 0
  private height = 0
  private frames = 0
  private frame = 0
  private settleTimer: ReturnType<typeof setTimeout> | undefined
  private paused = false
  private lost = false
  private readonly handleLost = () => {
    this.lost = true
    this.cancel()
    this.onLost()
  }

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onLost: () => void,
  ) {
    this.renderer = new LightRenderer(canvas)
    canvas.addEventListener('webglcontextlost', this.handleLost)
  }

  update(scene: Scene, width: number, height: number): void {
    this.scene = scene
    this.width = width
    this.height = height
    this.schedule()
  }

  setPaused(paused: boolean): void {
    this.paused = paused
    if (paused) this.cancel()
    else this.schedule()
  }

  dispose(): void {
    this.cancel()
    this.canvas.removeEventListener('webglcontextlost', this.handleLost)
    this.renderer.dispose()
  }

  private schedule(): void {
    if (this.paused || this.lost || !this.scene || this.width < 1 || this.height < 1) return
    clearTimeout(this.settleTimer)
    this.settleTimer = undefined
    delete this.canvas.dataset.settled
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      if (!this.draw(1)) return
      this.settleTimer = setTimeout(() => {
        this.settleTimer = undefined
        if (!this.slowSizes.has(this.sizeKey())) this.draw(2)
        this.canvas.dataset.settled = 'true'
      }, SETTLE_MS)
    })
  }

  private cancel(): void {
    if (this.frame) cancelAnimationFrame(this.frame)
    this.frame = 0
    clearTimeout(this.settleTimer)
    this.settleTimer = undefined
  }

  private sizeKey(): string {
    return `${this.width}x${this.height}`
  }

  private draw(supersample: 1 | 2): boolean {
    const scene = this.scene
    if (!scene || this.lost || this.renderer.gpu.isLost) return false
    const start = performance.now()
    try {
      this.renderer.render(scene, { width: this.width, height: this.height, supersample, present: true })
      const gl = this.renderer.gpu.gl
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.pixel)
    } catch (error) {
      console.error('Preview render failed', error)
      return false
    }
    const ms = performance.now() - start
    if (supersample === 2 && ms > SLOW_SETTLE_MS) this.slowSizes.add(this.sizeKey())
    this.frames++
    this.canvas.dataset.frame = String(this.frames)
    this.canvas.dataset.supersample = String(supersample)
    this.canvas.dataset.renderSize = this.sizeKey()
    this.canvas.dataset[supersample === 2 ? 'settledMs' : 'fastMs'] = ms.toFixed(1)
    return true
  }
}
