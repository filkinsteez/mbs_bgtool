import { create } from 'zustand'
import type { ProjectState } from './types'
import { createDefaultProject } from './defaults'
import { History } from './history'

export type EditorMode = 'compose' | 'setup' | 'motion' | 'path'
export type PanelId = 'compose' | 'motion' | 'path'
export type Quality = 'live' | 'hq'
// canvas tools: SELECT (the cursor) is the default; TEXT arms one
// placement; the shape tools arm a drag-to-draw primitive. Every armed
// tool returns to SELECT after one use.
export type CanvasTool =
  | 'select'
  | 'text'
  | 'rect'
  | 'ellipse'
  | 'poly'
  | 'star'
  | 'line'
  | 'blob'
export type DesignTab = 'system' | 'field' | 'layers' | 'type'

export type UiState = {
  mode: EditorMode
  activePanel: PanelId
  quality: Quality
  tool: CanvasTool
  designTab: DesignTab // which DESIGN sub-panel the inspector shows
  panelOpen: boolean // the dock toggles the inspector; closed = full-bleed canvas
  shapesFlyout: boolean // the dock's drawing-tools flyout (SHAPES is a tool tray, not a panel)
  // canvas viewport: zoom multiplies the fit scale (1 = fit to stage),
  // pan offsets in screen px. View state only — never persisted.
  zoom: number
  panX: number
  panY: number
  mounted: boolean
  snap: boolean // grid magnetism for free objects (drawn shapes); type/images snap by model
  showGuides: boolean // optional construction guides while composing
  selectedBlockId?: string // the ACTIVE block — the one the panel edits
  selectedBlockIds: string[] // full selection (marquee / shift-click)
  selectedImageIds: string[] // selected image blocks — full peers in the selection
  selectedShapeIds: string[] // selected drawn primitives
  selectedLayerId?: string // the shape layer whose controls the panel shows
  // isolation: edit THIS effector's master shapes — the rest of the
  // canvas dims and only the masters render as objects. Esc exits.
  isolateLayerId?: string
  dragging: boolean // a type block is being dragged — guides show while true
  systemAdjusting: boolean // a SYSTEM control is being worked — curve reveals itself
  motionPlaying: boolean
}

type PartialValue<T> = T extends readonly unknown[] ? T : T extends object ? DeepPartial<T> : T
export type DeepPartial<T> = { [K in keyof T]?: PartialValue<T[K]> }

export type ProjectPatch = DeepPartial<ProjectState>

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// Arrays (typeBlocks, selectedNodeIds) are replaced wholesale; objects merge.
// A key explicitly present with value undefined CLEARS the field (how
// patches drop presetId when a manual tweak breaks the preset match);
// absent keys fill from base, so partial recipes keep loading. JSON
// parsing can never produce undefined, so deserialization is unaffected.
export function mergeDeep<T>(base: T, patch: DeepPartial<T>): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch as T
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete out[key]
      continue
    }
    const prev = (base as Record<string, unknown>)[key]
    out[key] = isPlainObject(prev) && isPlainObject(value) ? mergeDeep(prev, value) : value
  }
  return out as T
}

export type StoreState = {
  project: ProjectState
  ui: UiState
  // bumped on every history mutation so undo/redo buttons can read
  // history.depth reactively (the History instance itself is not a store)
  historyVersion: number
  setUi: (patch: Partial<UiState>) => void
  // Discrete change: one history entry per call (toggles, text edits, preset picks).
  apply: (patch: ProjectPatch) => void
  // Continuous change during a drag: no history. Call commitTransient on release.
  setTransient: (patch: ProjectPatch) => void
  commitTransient: () => void
  replaceProject: (project: ProjectState, opts?: { keepHistory?: boolean }) => void
  undo: () => void
  redo: () => void
}

export const history = new History()

// Project state captured when a transient drag begins; committed as one entry.
let preTransient: ProjectState | null = null

export const useStore = create<StoreState>()((set, get) => ({
  project: createDefaultProject(),
  historyVersion: 0,
  ui: {
    mode: 'compose',
    activePanel: 'compose',
    // 'hq' at rest — 'live' exists only mid-drag. Starting on 'live'
    // made freshly loaded organic layers render without their raster
    // finish until the first slider commit.
    quality: 'hq',
    tool: 'select',
    designTab: 'system',
    panelOpen: true,
    shapesFlyout: false,
    zoom: 1,
    panX: 0,
    panY: 0,
    mounted: false,
    snap: true,
    showGuides: false,
    selectedBlockId: 'headline',
    selectedBlockIds: ['headline'],
    selectedImageIds: [],
    selectedShapeIds: [],
    dragging: false,
    systemAdjusting: false,
    motionPlaying: true,
  },

  setUi: (patch) => set((s) => ({ ui: { ...s.ui, ...patch } })),

  apply: (patch) => {
    const before = get().project
    history.push(before)
    set({ project: mergeDeep(before, patch), historyVersion: get().historyVersion + 1 })
  },

  setTransient: (patch) => {
    const s = get()
    if (!preTransient) preTransient = s.project
    set({ project: mergeDeep(s.project, patch), ui: { ...s.ui, quality: 'live' } })
  },

  commitTransient: () => {
    const s = get()
    if (preTransient && JSON.stringify(preTransient) !== JSON.stringify(s.project)) {
      history.push(preTransient)
    }
    preTransient = null
    set({ ui: { ...s.ui, quality: 'hq' }, historyVersion: s.historyVersion + 1 })
  },

  replaceProject: (project, opts) => {
    if (!opts?.keepHistory) history.clear()
    preTransient = null
    set({ project, historyVersion: get().historyVersion + 1 })
  },

  undo: () => {
    const prev = history.undo(get().project)
    if (prev) set({ project: prev, historyVersion: get().historyVersion + 1 })
  },

  redo: () => {
    const next = history.redo(get().project)
    if (next) set({ project: next, historyVersion: get().historyVersion + 1 })
  },
}))

// dev handle for the debugging loop (console + devshot verification)
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  ;(window as unknown as { __lbsStore?: typeof useStore }).__lbsStore = useStore
}
