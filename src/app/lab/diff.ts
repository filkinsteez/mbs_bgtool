export interface DiffJob {
  /** Identifies the target; the view drops results for a target it no longer shows. */
  key: number
  width: number
  height: number
  target: Uint8ClampedArray<ArrayBuffer>
  render: Uint8Array<ArrayBuffer>
  mask: Uint8Array
}

export interface DiffResult {
  key: number
  width: number
  height: number
  heat: Uint8ClampedArray<ArrayBuffer>
}

const MIN_INTERVAL_MS = 300

/**
 * Runs deltaEMap and heatmapImage off the main thread. Keeps only the latest
 * request, runs one job at a time and starts at most one job per
 * MIN_INTERVAL_MS.
 */
export class DiffWorker {
  private readonly worker: Worker
  private busy = false
  private pending: (() => DiffJob | null) | null = null
  private lastStart = Number.NEGATIVE_INFINITY
  private timer: number | undefined

  constructor(onResult: (result: DiffResult) => void, onError: (message: string) => void) {
    this.worker = new Worker(new URL('./diff.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (event: MessageEvent<DiffResult>) => {
      this.busy = false
      onResult(event.data)
      this.pump()
    }
    this.worker.onerror = (event) => {
      this.busy = false
      onError(event.message || 'The diff worker failed to run.')
    }
  }

  /** `makeJob` runs when a job can start; it reads the pixels then, or returns null to skip. */
  request(makeJob: () => DiffJob | null): void {
    this.pending = makeJob
    this.pump()
  }

  dispose(): void {
    window.clearTimeout(this.timer)
    this.worker.terminate()
  }

  private pump(): void {
    if (this.busy || this.timer !== undefined || !this.pending) return
    const wait = this.lastStart + MIN_INTERVAL_MS - performance.now()
    if (wait > 0) {
      this.timer = window.setTimeout(() => {
        this.timer = undefined
        this.pump()
      }, wait)
      return
    }
    const makeJob = this.pending
    this.pending = null
    const job = makeJob()
    if (!job) return
    this.busy = true
    this.lastStart = performance.now()
    this.worker.postMessage(job, [job.render.buffer])
  }
}
