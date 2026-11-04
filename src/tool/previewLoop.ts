import { LightRenderer, RECIPE_IDS, type OutputSettings, type RecipeId, type Scene } from '@/light'
import { TOOL_FILTERS } from './filterControl'

const SETTLE_MS = 250
/** A settled 2x render slower than this stops settled 2x renders at that size. */
const SLOW_SETTLE_MS = 300
/** The render that has the driver build a look's programs for drawing before the look is shown. */
const WARM_SIZE = { width: 96, height: 54 }

type Step = 'done' | 'waiting' | 'failed'

/** A frame issued to the GPU and not yet on the canvas. */
interface InFlight {
  /** Until the GPU has finished the frame; null after. */
  sync: WebGLSync | null
  start: number
  supersample: 1 | 2
  size: string
  version: number
  /** Some of its programs were drawn for the first time, so its time includes the driver building them. */
  fresh: boolean
  /** Its GPU time, when the browser can measure it. */
  timer: WebGLQuery | null
}

/** A finished frame whose GPU time the GPU hasn't reported yet. */
interface Timing {
  query: WebGLQuery
  supersample: 1 | 2
}

/** A look, with or without a filter, drawn once at a tiny size in idle time. */
interface WarmItem {
  recipe: RecipeId
  output: Partial<OutputSettings>
}

/** The item being compiled and built for drawing in idle time. */
interface Warming extends WarmItem {
  sources: readonly string[]
  /** Until the GPU has finished its last draw. */
  sync: WebGLSync | null
  /** That draw was complete, so the item is done once the GPU has finished it. */
  drawn: boolean
}

const whenIdle = (callback: () => void): number =>
  typeof requestIdleCallback === 'function' ? requestIdleCallback(callback) : window.setTimeout(callback, 100)

const cancelIdle = (handle: number): void => {
  if (typeof cancelIdleCallback === 'function') cancelIdleCallback(handle)
  else clearTimeout(handle)
}

/**
 * Draws scenes on one canvas with one long-lived renderer. Updates are
 * coalesced to one 1x render per animation frame; once updates stop for
 * SETTLE_MS the frame is drawn again at 2x and the canvas gets
 * `data-settled` once the GPU has finished it.
 *
 * Nothing here waits for the GPU, so the page keeps responding. A render
 * doesn't wait for shader compiles (with KHR_parallel_shader_compile): while a
 * look's programs compile, the last frame stays on the canvas. One frame is in
 * flight at a time, and a fence tells on a later animation frame when the GPU
 * has finished it; then it is presented, and its times go to the canvas data
 * attributes (`fastMs`, `settledMs`, `fastGpuMs`, `settledGpuMs`; see
 * `record`). After the first settled frame, the shown look with each filter and
 * then every other look compile and get drawn once at a tiny size in idle time,
 * one at a time, so the driver has built them before they are shown.
 */
export class PreviewLoop {
  private readonly renderer: LightRenderer
  private readonly slowSizes = new Set<string>()
  private scene: Scene | null = null
  private width = 0
  private height = 0
  private version = 0
  private frames = 0
  private inFlight: InFlight | null = null
  /** After a render that stopped at a program still compiling: until the GPU has finished what it did draw. */
  private partial: WebGLSync | null = null
  private compiling: readonly string[] = []
  private fastFrame = 0
  private settleFrame = 0
  private settleTimer: ReturnType<typeof setTimeout> | undefined
  private idle = 0
  private warmQueue: WarmItem[] | null = null
  private warming: Warming | null = null
  private timing: Timing | null = null
  private timingFrame = 0
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
    this.version++
    this.schedule()
  }

  setPaused(paused: boolean): void {
    this.paused = paused
    if (paused) this.cancel()
    else this.schedule()
  }

  dispose(): void {
    this.cancel()
    if (this.idle) cancelIdle(this.idle)
    this.idle = 0
    if (this.timingFrame) cancelAnimationFrame(this.timingFrame)
    this.timingFrame = 0
    this.warmQueue = null
    this.canvas.removeEventListener('webglcontextlost', this.handleLost)
    this.renderer.dispose()
  }

  private schedule(): void {
    if (this.paused || this.lost || !this.scene || this.width < 1 || this.height < 1) return
    this.cancelSettle()
    delete this.canvas.dataset.settled
    if (this.fastFrame) return
    this.fastFrame = requestAnimationFrame(() => this.drawFast())
  }

  private drawFast(): void {
    this.fastFrame = 0
    const step = this.step(1)
    if (step === 'waiting') this.fastFrame = requestAnimationFrame(() => this.drawFast())
    else if (step === 'done') this.settleTimer = setTimeout(() => this.drawSettled(), SETTLE_MS)
  }

  private drawSettled(): void {
    this.settleTimer = undefined
    this.settleFrame = 0
    if (!this.slowSizes.has(this.sizeKey())) {
      const step = this.step(2)
      if (step === 'waiting') {
        this.settleFrame = requestAnimationFrame(() => this.drawSettled())
        return
      }
      if (step === 'failed') return
    }
    this.canvas.dataset.settled = 'true'
    this.startWarming()
  }

  /**
   * One move toward a finished frame of the current scene at this supersample, without waiting for the GPU:
   * collects the frame in flight once its fence has passed, or waits for compiles, or issues the render.
   */
  private step(supersample: 1 | 2): Step {
    const gpu = this.renderer.gpu
    if (this.lost || gpu.isLost) return 'failed'
    // Compile checks and canvas resizes wait for the GPU, so nothing here runs while earlier draws are unfinished.
    if (!this.warmDrawDone()) return 'waiting'
    if (this.partial) {
      if (!gpu.signaled(this.partial)) return 'waiting'
      this.partial = null
    }
    if (this.inFlight) {
      const frame = this.inFlight
      if (frame.sync && !gpu.signaled(frame.sync)) return 'waiting'
      frame.sync = null
      if (!this.renderer.presentWithoutWaiting()) return 'waiting'
      this.inFlight = null
      this.record(frame)
      if (frame.version === this.version && frame.supersample === supersample) return 'done'
    }
    const scene = this.scene
    if (!scene) return 'failed'
    if (!gpu.compiled(this.compiling)) return 'waiting'
    const start = performance.now()
    const finished = gpu.finishedPrograms
    const timer = gpu.beginTimer()
    let ready = false
    try {
      // Presented once the GPU has finished it: resizing the canvas before then would wait for the GPU.
      const stats = this.renderer.render(scene, { width: this.width, height: this.height, supersample, background: true })
      this.compiling = stats.compiling
      ready = stats.ready
    } catch (error) {
      console.error('Preview render failed', error)
      return 'failed'
    } finally {
      gpu.endTimer(timer)
      if (timer && !ready) gpu.deleteTimer(timer)
    }
    if (!ready) {
      this.partial = gpu.fence()
      return 'waiting'
    }
    const fresh = gpu.finishedPrograms !== finished
    this.inFlight = { sync: gpu.fence(), start, supersample, size: this.sizeKey(), version: this.version, fresh, timer }
    return 'waiting'
  }

  /**
   * Publishes a finished frame on the canvas: `fastMs` and `settledMs` run from issuing the frame until it is on the
   * canvas (whole animation frames), and `fastGpuMs` and `settledGpuMs` are the GPU's own time for the render.
   */
  private record(frame: InFlight): void {
    const ms = performance.now() - frame.start
    if (frame.supersample === 2 && ms > SLOW_SETTLE_MS && !frame.fresh) this.slowSizes.add(frame.size)
    this.frames++
    this.canvas.dataset.frame = String(this.frames)
    this.canvas.dataset.supersample = String(frame.supersample)
    this.canvas.dataset.renderSize = frame.size
    this.canvas.dataset[frame.supersample === 2 ? 'settledMs' : 'fastMs'] = ms.toFixed(1)
    if (!frame.timer) return
    if (this.timing) this.renderer.gpu.deleteTimer(this.timing.query)
    if (this.timingFrame) cancelAnimationFrame(this.timingFrame)
    this.timing = { query: frame.timer, supersample: frame.supersample }
    this.readTiming()
  }

  private readTiming(): void {
    this.timingFrame = 0
    const timing = this.timing
    if (!timing || this.lost) return
    const ms = this.renderer.gpu.timerMs(timing.query)
    if (ms === undefined) {
      this.timingFrame = requestAnimationFrame(() => this.readTiming())
      return
    }
    this.timing = null
    if (ms !== null) this.canvas.dataset[timing.supersample === 2 ? 'settledGpuMs' : 'fastGpuMs'] = ms.toFixed(1)
  }

  /** The shown look, then the shown look with each filter (a filter's output pass is the same in every look), then the other looks. */
  private startWarming(): void {
    const shown = this.scene?.recipe
    if (this.warmQueue || !shown || !this.renderer.gpu.compilesInBackground) return
    this.warmQueue = [
      { recipe: shown, output: {} },
      ...TOOL_FILTERS.map((filter) => ({ recipe: shown, output: { [filter]: 0.5 } })),
      ...RECIPE_IDS.filter((id) => id !== shown).map((recipe) => ({ recipe, output: {} })),
    ]
    this.idle = whenIdle(() => this.warmNext())
  }

  /**
   * Starts the next item's compiles; once they are done and the preview is idle, draws it at a tiny size; once the
   * GPU has finished that, moves on. Each item waits for the last, so a preview frame never sits behind a queue of
   * the driver's work.
   */
  private warmNext(): void {
    this.idle = 0
    if (this.lost || !this.warmQueue) return
    const gpu = this.renderer.gpu
    const previewIdle = !this.inFlight && !this.fastFrame && !this.settleFrame && this.settleTimer === undefined
    try {
      if (!this.warming) {
        const item = this.warmQueue.shift()
        if (!item) return
        this.warming = { ...item, sources: this.renderer.prepare(item.recipe), sync: null, drawn: false }
      } else if (!this.warming.sync) {
        if (previewIdle && gpu.compiled(this.warming.sources)) {
          const { recipe, output } = this.warming
          const scene: Scene = { recipe, seed: this.scene?.seed ?? 1, colors: [], params: {}, lens: {}, output }
          const stats = this.renderer.render(scene, { ...WARM_SIZE, supersample: 1, background: true })
          this.warming.sync = gpu.fence()
          this.warming.drawn = stats.ready
          if (!stats.ready) this.warming.sources = [...this.warming.sources, ...stats.compiling]
        }
      } else {
        this.warmDrawDone()
      }
    } catch (error) {
      console.error('Preparing a look failed', error)
      this.warming = null
    }
    this.idle = whenIdle(() => this.warmNext())
  }

  /** Whether the GPU has finished the warm-up's last draw (or there is none); moves the warm-up on once it has. */
  private warmDrawDone(): boolean {
    const warming = this.warming
    if (!warming?.sync) return true
    if (!this.renderer.gpu.signaled(warming.sync)) return false
    if (warming.drawn) this.warming = null
    else warming.sync = null
    return true
  }

  private cancelSettle(): void {
    clearTimeout(this.settleTimer)
    this.settleTimer = undefined
    if (this.settleFrame) cancelAnimationFrame(this.settleFrame)
    this.settleFrame = 0
  }

  private cancel(): void {
    if (this.fastFrame) cancelAnimationFrame(this.fastFrame)
    this.fastFrame = 0
    this.cancelSettle()
  }

  private sizeKey(): string {
    return `${this.width}x${this.height}`
  }
}
