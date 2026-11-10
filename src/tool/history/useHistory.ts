import { useEffect, useLayoutEffect, useMemo, useSyncExternalStore, type RefObject } from 'react'
import type { Scene } from '@/light'
import {
  designOf,
  record,
  redo as redoMove,
  remove as removeEntry,
  restore as restoreMove,
  setQuery,
  showing,
  undo as undoMove,
  type History,
  type HistoryMove,
} from './historyModel'
import { readHistory, readServerHistory, subscribeHistory, writeHistory } from './historyStore'

/** A state goes in the history once it has been drawn and left unchanged this long. */
const QUIET_MS = 400

const newId = () => (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`)

/**
 * Records settled states: a state is recorded once its settled frame is drawn, it has stayed QUIET_MS, and no drag on
 * the image or press in the panel (a slider drag) is going on, so a drag or a slider move makes one record when it ends.
 */
class Recorder {
  query = ''
  private scene: Scene | null = null
  private changed = 0
  private pending: { query: string; thumb: string } | null = null
  private dragging = false
  private pressed = false
  /** The last state recorded or taken out: a redraw of it, after a resize say, only refreshes its picture. */
  private recorded: string | null = null
  private timer: ReturnType<typeof setTimeout> | undefined

  see(query: string, scene: Scene): void {
    if (query !== this.query) {
      this.changed = performance.now()
      this.pending = null
    }
    this.query = query
    this.scene = scene
  }

  settled(scene: Scene, thumb: string): void {
    if (scene !== this.scene) return
    this.pending = { query: this.query, thumb }
    this.tryCommit()
  }

  /** The state on screen was taken out of the history: it comes back only with the next change. */
  forget(): void {
    clearTimeout(this.timer)
    this.pending = null
    this.recorded = this.query
  }

  hold(kind: 'dragging' | 'pressed', on: boolean): void {
    this[kind] = on
    if (!on) this.tryCommit()
  }

  /** Records the shown state now if its frame is drawn, without waiting for QUIET_MS: before a change from the history. */
  flush(): void {
    if (this.pending?.query === this.query) this.commit()
  }

  dispose(): void {
    clearTimeout(this.timer)
  }

  private readonly tryCommit = (): void => {
    clearTimeout(this.timer)
    if (!this.pending || this.dragging || this.pressed) return
    const wait = this.changed + QUIET_MS - performance.now()
    if (wait > 0) this.timer = setTimeout(this.tryCommit, wait)
    else this.commit()
  }

  private commit(): void {
    clearTimeout(this.timer)
    const pending = this.pending
    this.pending = null
    if (!pending) return
    const now = readHistory()
    const again = pending.query === this.recorded
    this.recorded = pending.query
    // A redraw never adds a picture, so one taken out here or in another tab stays out until the next change.
    if (again && now.entries.find((entry) => entry.id === now.current)?.query !== pending.query) return
    writeHistory(record(now, pending.query, pending.thumb, newId()))
  }
}

export interface HistoryOptions {
  /** The shown state's URL query. */
  query: string
  /** The scene the preview draws for it. */
  scene: Scene
  /** The image is being dragged. */
  dragging: boolean
  /** The panel: a press in it holds recording until it ends. */
  panelRef: RefObject<HTMLElement | null>
  /** Shows a state from the history, given its query; returns the query the tool reads back for it. */
  show: (query: string) => string
}

export interface HistoryControls {
  /** The history as the row shows it: `current` is the entry of the design on screen, or null when it isn't in the row. */
  history: History
  /** The preview drew the settled frame of `scene`; `thumb` is a small JPEG of it, or ''. */
  onSettle: (scene: Scene, thumb: string) => void
  /** Shows entry `id`. */
  restore: (id: string) => void
  /** Takes entry `id` out of the history; when it is the design on screen, the entry in its place is shown. */
  remove: (id: string) => void
  /** Cmd/Ctrl+Z; false when there is nothing to go back to. */
  undo: () => boolean
  /** Shift+Cmd/Ctrl+Z; false when there is nothing to go forward to. */
  redo: () => boolean
}

/** The changes the strip and Cmd/Ctrl+Z make. Its actions don't change from render to render, so the strip can skip renders while a drag runs. */
class HistoryActions {
  private show: HistoryOptions['show'] = (query) => query

  constructor(private readonly recorder: Recorder) {}

  setShow(show: HistoryOptions['show']): void {
    this.show = show
  }

  readonly onSettle = (scene: Scene, thumb: string): void => this.recorder.settled(scene, thumb)

  readonly restore = (id: string): void => {
    this.recorder.flush()
    this.go(restoreMove(readHistory(), id))
  }

  readonly remove = (id: string): void => {
    this.recorder.flush()
    const now = readHistory()
    const entry = now.entries.find((item) => item.id === id)
    const { history, query } = removeEntry(now, id, this.recorder.query)
    if (query !== null) {
      writeHistory(setQuery(history, history.current, this.show(query)))
      return
    }
    // The design on screen was the last picture: the image stays, and a redraw of it doesn't add it back.
    if (entry && designOf(entry.query) === designOf(this.recorder.query)) this.recorder.forget()
    writeHistory(history)
  }

  readonly undo = (): boolean => this.step(true)

  readonly redo = (): boolean => this.step(false)

  private go(move: HistoryMove | null): boolean {
    if (!move) return false
    writeHistory(setQuery(move.history, move.history.current, this.show(move.query)))
    return true
  }

  private step(back: boolean): boolean {
    this.recorder.flush()
    const now = readHistory()
    const shown = now.entries.find((entry) => entry.id === now.current)
    // A change whose frame isn't drawn yet: back goes to the state shown before it, and there is nothing forward.
    if (shown && shown.query !== this.recorder.query) {
      if (back) this.show(shown.query)
      return back
    }
    return this.go(back ? undoMove(now, newId()) : redoMove(now, newId()))
  }
}

/** The history of the tool's states, with Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z through it. */
export function useHistory({ query, scene, dragging, panelRef, show }: HistoryOptions): HistoryControls {
  const stored = useSyncExternalStore(subscribeHistory, readHistory, readServerHistory)
  const design = designOf(query)
  const history = useMemo(() => showing(stored, design), [stored, design])
  // useMemo rather than useState: a hot reload in development then makes new ones from the new code, which use the
  // store the row reads. Kept ones would lack new methods and write to the store's old copy.
  const recorder = useMemo(() => new Recorder(), [])
  const actions = useMemo(() => new HistoryActions(recorder), [recorder])
  const { onSettle, restore, remove, undo, redo } = actions

  useLayoutEffect(() => actions.setShow(show))
  useLayoutEffect(() => recorder.see(query, scene), [recorder, query, scene])
  useEffect(() => recorder.hold('dragging', dragging), [recorder, dragging])
  useEffect(() => () => recorder.dispose(), [recorder])

  useEffect(() => {
    const panel = panelRef.current
    const press = () => recorder.hold('pressed', true)
    const release = () => recorder.hold('pressed', false)
    panel?.addEventListener('pointerdown', press, true)
    window.addEventListener('pointerup', release, true)
    window.addEventListener('pointercancel', release, true)
    return () => {
      panel?.removeEventListener('pointerdown', press, true)
      window.removeEventListener('pointerup', release, true)
      window.removeEventListener('pointercancel', release, true)
    }
  }, [recorder, panelRef])

  return { history, onSettle, restore, remove, undo, redo }
}
