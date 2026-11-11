import { LightRenderer, RECIPE_IDS, type OutputSettings, type RecipeId, type Scene } from '@/light'
import { defaultMix, mixFromShares, neighbourMixes } from '@/light/color/mix'
import { getPack, isPackId } from '@/light/color/packs'
import { TOOL_FILTERS } from './filterControl'

const SETTLE_MS = 250
/** A settled 2x render slower than this stops settled 2x renders at that size. */
const SLOW_SETTLE_MS = 300
/** The render that has the driver build a look's programs for drawing before the look is shown. */
const WARM_SIZE = { width: 96, height: 54 }
/** While frames come back out of date (a drag or a slider moving), one that would take more GPU time than this at full size is drawn smaller. */
const MOVING_GPU_MS = 12
/** The GPU time a smaller moving frame aims for. */
const MOVING_TARGET_MS = 8
/** Sizes a moving frame may be drawn at, against the canvas; the browser scales it up. */
const MOVING_SCALES = [1, 0.75, 0.5]
/**
 * Without a GPU timer: a 1x frame that takes longer than this to reach the canvas counts as too slow at its size, so
 * moving frames get smaller, from the first full-size frame on, not only once a drag has started.
 */
const LATE_FRAME_MS = 25
/** Updates closer together than this are a drag or a slider moving; this long after the last, frames are full size again. */
const MOVING_QUIET_MS = 100
/** Long side, in pixels, of the frames drawn only to solve the color stage for a mix ahead of time. */
const PRESOLVE_LONG_SIDE = 64
/** Idle time left that a solve ahead of time needs to start in: one takes about 15 to 40 ms on the CPU. */
const PRESOLVE_IDLE_MS = 30
/** How long a solve ahead of time waits for that much idle time before it runs anyway, as an animation keeps idle short. */
const PRESOLVE_WAIT_MS = 400

/** The scene with each mix one color slider move away from its own (`neighbourMixes`), or none without the color stage. */
function neighbourScenes(scene: Scene): Scene[] {
  const colorMix = scene.colorMix
  if (!colorMix || !isPackId(colorMix.pack)) return []
  const pack = getPack(colorMix.pack)
  return neighbourMixes(pack, mixFromShares(pack, colorMix.shares) ?? defaultMix(pack)).map((mix) => ({ ...scene, colorMix: { pack: pack.id, shares: [...mix.shares] } }))
}

/** Whether two scenes differ only in their color mix. */
function onlyMixDiffers(a: Scene, b: Scene): boolean {
  return a.colorMix !== undefined && b.colorMix !== undefined && JSON.stringify({ ...a, colorMix: null }) === JSON.stringify({ ...b, colorMix: null })
}

type Step = 'done' | 'waiting' | 'failed'

/** A frame issued to the GPU and not yet on the canvas. */
interface InFlight {
  /** Until the GPU has finished the frame; null after. */
  sync: WebGLSync | null
  start: number
  supersample: 1 | 2
  /** Its size against the canvas: below 1 while moving. */
  scale: number
  /** The canvas size it was drawn for. */
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
  scale: number
  fresh: boolean
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

/** Calls back in idle time, with the time left in it where the browser tells it, or after `timeout` ms at the latest. */
const whenIdle = (callback: (deadline?: IdleDeadline) => void, timeout?: number): number =>
  typeof requestIdleCallback === 'function' ? requestIdleCallback(callback, timeout ? { timeout } : undefined) : window.setTimeout(callback, 100)

const cancelIdle = (handle: number): void => {
  if (typeof cancelIdleCallback === 'function') cancelIdleCallback(handle)
  else clearTimeout(handle)
}

/** The size for moving frames when a full-size 1x frame takes `fullMs` of GPU time: the largest that fits MOVING_TARGET_MS once it is over MOVING_GPU_MS. */
function movingScaleFor(fullMs: number): number {
  if (fullMs <= MOVING_GPU_MS) return 1
  return MOVING_SCALES.find((scale) => fullMs * scale * scale <= MOVING_TARGET_MS) ?? MOVING_SCALES[MOVING_SCALES.length - 1]
}

function smallerScale(scale: number): number {
  return MOVING_SCALES.find((s) => s < scale) ?? MOVING_SCALES[MOVING_SCALES.length - 1]
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
  /** Updates are arriving close together (a drag or a slider moving). */
  private moving = false
  private lastUpdate = -Infinity
  private quietTimer: ReturnType<typeof setTimeout> | undefined
  /** The size moving frames are drawn at, from the GPU time of recent frames. */
  private movingScale = 1
  /** A frame that built no programs has been timed, so movingScale no longer comes from frames that did. */
  private movingTimed = false
  /** The shown scene at the mixes one slider move away, still to solve ahead of time, nearest first. */
  private presolveQueue: Scene[] = []
  private presolveIdle = 0
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
    // A new mix alone is drawn like a moving slider's frame first, so a slow look shows it at once and sharp after.
    const mixStep = this.scene !== null && width === this.width && height === this.height && onlyMixDiffers(this.scene, scene)
    this.scene = scene
    this.width = width
    this.height = height
    this.version++
    this.presolveQueue = []
    const now = performance.now()
    this.moving = now - this.lastUpdate < MOVING_QUIET_MS || mixStep
    this.lastUpdate = now
    clearTimeout(this.quietTimer)
    // Right after the last change the frame is drawn again at full size, before the settled 2x frame.
    if (this.moving) {
      this.quietTimer = setTimeout(() => {
        this.quietTimer = undefined
        this.moving = false
        this.schedule()
      }, MOVING_QUIET_MS)
    }
    this.schedule()
  }

  setPaused(paused: boolean): void {
    this.paused = paused
    if (paused) this.cancel()
    else this.schedule()
  }

  dispose(): void {
    this.cancel()
    clearTimeout(this.quietTimer)
    if (this.idle) cancelIdle(this.idle)
    this.idle = 0
    if (this.presolveIdle) cancelIdle(this.presolveIdle)
    this.presolveIdle = 0
    this.presolveQueue = []
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
    this.startPresolving()
    this.startWarming()
  }

  /**
   * Solves the color stage ahead of time for each mix one slider move away from the shown one, one per idle period
   * with time for it, so a slider step finds its solve kept and its frame needs none. Each is a frame of the shown
   * scene at that mix drawn at PRESOLVE_LONG_SIDE, which the stage solves for the format's design as at any size.
   */
  private startPresolving(): void {
    if (!this.scene) return
    this.presolveQueue = neighbourScenes(this.scene)
    if (this.presolveQueue.length && !this.presolveIdle) this.presolveIdle = whenIdle((deadline) => this.presolveNext(deadline), PRESOLVE_WAIT_MS)
  }

  private presolveNext(deadline?: IdleDeadline): void {
    this.presolveIdle = 0
    if (this.lost || this.paused) return
    const previewIdle = this.canvas.dataset.settled === 'true' && !this.inFlight && !this.fastFrame && !this.settleFrame && this.settleTimer === undefined
    const roomy = !deadline || deadline.didTimeout || deadline.timeRemaining() >= PRESOLVE_IDLE_MS
    const scene = previewIdle && roomy ? this.presolveQueue.shift() : undefined
    if (scene) {
      const scale = PRESOLVE_LONG_SIDE / Math.max(this.width, this.height, 1)
      try {
        this.renderer.render(scene, { width: Math.max(1, Math.round(this.width * scale)), height: Math.max(1, Math.round(this.height * scale)), supersample: 1, background: true })
      } catch (error) {
        console.error('Solving a mix ahead of time failed', error)
        this.presolveQueue = []
      }
    }
    if (this.presolveQueue.length) this.presolveIdle = whenIdle((next) => this.presolveNext(next), PRESOLVE_WAIT_MS)
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
      // Once a smaller frame comes back up to date (the drag or slider stopped), the next one is full size.
      if (frame.version === this.version && frame.supersample === supersample && frame.scale === this.scaleFor(supersample)) return 'done'
    }
    const scene = this.scene
    if (!scene) return 'failed'
    if (!gpu.compiled(this.compiling)) return 'waiting'
    const scale = this.scaleFor(supersample)
    const width = Math.max(1, Math.round(this.width * scale))
    const height = Math.max(1, Math.round(this.height * scale))
    const start = performance.now()
    const finished = gpu.finishedPrograms
    const timer = gpu.beginTimer()
    let ready = false
    try {
      // Presented once the GPU has finished it: resizing the canvas before then would wait for the GPU.
      const stats = this.renderer.render(scene, { width, height, supersample, background: true })
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
    this.inFlight = { sync: gpu.fence(), start, supersample, scale, size: this.sizeKey(), version: this.version, fresh, timer }
    return 'waiting'
  }

  /** Settled frames and frames while nothing moves are full size. */
  private scaleFor(supersample: 1 | 2): number {
    return supersample === 1 && this.moving ? this.movingScale : 1
  }

  /**
   * Publishes a finished frame on the canvas: `fastMs` and `settledMs` run from issuing the frame until it is on the
   * canvas (whole animation frames), and `fastGpuMs` and `settledGpuMs` are the GPU's own time for the render.
   */
  private record(frame: InFlight): void {
    const ms = performance.now() - frame.start
    if (frame.supersample === 2 && ms > SLOW_SETTLE_MS && !frame.fresh) this.slowSizes.add(frame.size)
    if (frame.supersample === 1 && !frame.timer && !frame.fresh) this.movingScale = ms > LATE_FRAME_MS ? smallerScale(frame.scale) : frame.scale
    this.frames++
    this.canvas.dataset.frame = String(this.frames)
    this.canvas.dataset.supersample = String(frame.supersample)
    this.canvas.dataset.scale = String(frame.scale)
    this.canvas.dataset.renderSize = `${Math.max(1, Math.round(this.width * frame.scale))}x${Math.max(1, Math.round(this.height * frame.scale))}`
    this.canvas.dataset[frame.supersample === 2 ? 'settledMs' : 'fastMs'] = ms.toFixed(1)
    if (!frame.timer) return
    if (this.timing) this.renderer.gpu.deleteTimer(this.timing.query)
    if (this.timingFrame) cancelAnimationFrame(this.timingFrame)
    this.timing = { query: frame.timer, supersample: frame.supersample, scale: frame.scale, fresh: frame.fresh }
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
    if (ms === null) return
    this.canvas.dataset[timing.supersample === 2 ? 'settledGpuMs' : 'fastGpuMs'] = ms.toFixed(1)
    // A settled frame has four times the pixels of a full-size 1x frame. After load every frame so far built programs,
    // so until a frame that didn't is timed, those set the size for moving frames, and a slider's first step is small.
    if (!timing.fresh || !this.movingTimed) this.movingScale = movingScaleFor(ms / (timing.scale * timing.scale) / (timing.supersample === 2 ? 4 : 1))
    if (!timing.fresh) this.movingTimed = true
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
    // Nothing starts while the preview is busy, compiles included: they share the GPU process with a drag's frames.
    const previewIdle =
      this.canvas.dataset.settled === 'true' && !this.inFlight && !this.fastFrame && !this.settleFrame && this.settleTimer === undefined
    try {
      if (!this.warming) {
        if (previewIdle) {
          const item = this.warmQueue.shift()
          if (!item) return
          this.warming = { ...item, sources: this.renderer.prepare(item.recipe), sync: null, drawn: false }
        }
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
