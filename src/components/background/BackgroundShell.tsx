'use client'

import { useEffect, useState } from 'react'
import { ConfirmDialog } from '@/components/controls/ConfirmDialog'
import { LabCanvas } from '@/components/lab/LabCanvas'
import { LabExportPanel } from '@/components/lab/LabExportPanel'
import { setGradientSpatialStudy } from '@/core/lab/gradients/render'
import {
  BACKGROUND_AUTOSAVE_KEY,
  LEGACY_BACKGROUND_AUTOSAVE_KEY,
  deserializeBackgroundRecipe,
} from '@/features/background-generator/recipe'
import { useBackgroundStore } from '@/features/background-generator/store'
import { FormatPanel } from './FormatPanel'
import { ColorPacksPanel } from './ColorPacksPanel'
import { PresetPanel } from './PresetPanel'
import {
  MATERIAL_MODEL_RESET_VIEW_EVENT,
  MATERIAL_MODEL_SETTLE_VIEW_EVENT,
} from './materialModelEvents'

export function BackgroundShell() {
  const [restored, setRestored] = useState(false)
  const [spatialStudy, setSpatialStudy] = useState(() => {
    if (typeof window === 'undefined' || process.env.NODE_ENV === 'production') return false
    return localStorage.getItem('mbs-dev-spatial-study') === '1'
  })
  const reset = useBackgroundStore((state) => state.reset)
  const undo = useBackgroundStore((state) => state.undo)
  const redo = useBackgroundStore((state) => state.redo)
  const canUndo = useBackgroundStore((state) => state.canUndo)
  const canRedo = useBackgroundStore((state) => state.canRedo)
  const [confirmReset, setConfirmReset] = useState(false)
  const resetAll = () => {
    reset()
    window.dispatchEvent(new Event(MATERIAL_MODEL_RESET_VIEW_EVENT))
  }

  useEffect(() => {
    try {
      const current = localStorage.getItem(BACKGROUND_AUTOSAVE_KEY)
      const legacy = localStorage.getItem(LEGACY_BACKGROUND_AUTOSAVE_KEY)
      const recipe = (current ? deserializeBackgroundRecipe(current) : null)
        ?? (legacy ? deserializeBackgroundRecipe(legacy) : null)
      if (recipe) {
        useBackgroundStore.getState().replaceRecipe(recipe)
        localStorage.setItem(BACKGROUND_AUTOSAVE_KEY, JSON.stringify(recipe))
      }
    } catch {}
    queueMicrotask(() => setRestored(true))
    let timer: ReturnType<typeof setTimeout> | undefined
    let pending = useBackgroundStore.getState().recipe
    const write = (announce = true) => {
      clearTimeout(timer)
      timer = undefined
      try {
        localStorage.setItem(BACKGROUND_AUTOSAVE_KEY, JSON.stringify(pending))
        void announce
      } catch {
        void announce
      }
    }
    const flush = () => write()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    const unsub = useBackgroundStore.subscribe((state, prev) => {
      if (state.recipe === prev.recipe) return
      pending = state.recipe
      clearTimeout(timer)
      timer = setTimeout(flush, 350)
    })
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      write(false)
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      unsub()
    }
  }, [])

  useEffect(() => {
    setGradientSpatialStudy(spatialStudy)
  }, [spatialStudy])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const editable = !!target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      )
      if (editable || event.isComposing || (!event.metaKey && !event.ctrlKey)) return
      if (event.key.toLowerCase() !== 'z') return
      event.preventDefault()
      if (useBackgroundStore.getState().mode === 'material') {
        window.dispatchEvent(new Event(MATERIAL_MODEL_SETTLE_VIEW_EVENT))
      }
      if (event.shiftKey) useBackgroundStore.getState().redo()
      else useBackgroundStore.getState().undo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  if (!restored) {
    return (
      <div className="lab-root" data-hydrated="false" aria-busy="true">
        <div className="lab-initial-loading" role="status">Loading</div>
      </div>
    )
  }

  return (
    <div className="lab-root" data-hydrated="true">
      <ConfirmDialog
        open={confirmReset}
        title="Reset all?"
        body="Resets format, preset, colors, 2D framing, and 3D view."
        confirmLabel="Reset all"
        onConfirm={() => {
          resetAll()
          setConfirmReset(false)
        }}
        onCancel={() => setConfirmReset(false)}
      />
      <header className="lab-topbar">
        <div className="lab-topbar-actions">
          {process.env.NODE_ENV !== 'production' ? (
            <button
              type="button"
              className={spatialStudy ? 'lab-chip active' : 'lab-chip'}
              onClick={() => {
                const next = !spatialStudy
                setSpatialStudy(next)
                setGradientSpatialStudy(next)
                localStorage.setItem('mbs-dev-spatial-study', next ? '1' : '0')
              }}
            >
              Spatial compare
            </button>
          ) : null}
          <button type="button" className="lab-chip" onClick={undo} disabled={!canUndo}>
            Undo
          </button>
          <button type="button" className="lab-chip" onClick={redo} disabled={!canRedo}>
            Redo
          </button>
          <button type="button" className="lab-chip" onClick={() => setConfirmReset(true)}>
            Reset all
          </button>
        </div>
      </header>
      <div className="lab-columns">
        <main className="lab-stage">
          <LabCanvas />
        </main>
        <aside className="lab-side lab-side-right" aria-label="Background controls">
          <div className="lab-inspector-body">
            <FormatPanel />
            <PresetPanel />
            <ColorPacksPanel />
          </div>
          <LabExportPanel />
        </aside>
      </div>
    </div>
  )
}
