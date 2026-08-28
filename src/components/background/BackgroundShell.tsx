'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ConfirmDialog } from '@/components/controls/ConfirmDialog'
import { LooksPanel } from '@/components/lab/LooksPanel'
import { LabCanvas } from '@/components/lab/LabCanvas'
import { ColorsPanel } from '@/components/lab/ColorsPanel'
import { LabExportPanel } from '@/components/lab/LabExportPanel'
import { CANVAS_FIT_VIEW_EVENT } from '@/components/lab/canvasEvents'
import {
  BACKGROUND_AUTOSAVE_KEY,
  LEGACY_BACKGROUND_AUTOSAVE_KEY,
  deserializeBackgroundRecipe,
} from '@/features/background-generator/recipe'
import { useBackgroundStore } from '@/features/background-generator/store'
import { FormatPanel } from './FormatPanel'
import { MaterialColorsPanel } from './MaterialColorsPanel'
import { MaterialPanel } from './MaterialPanel'
import { MotionPanel } from './MotionPanel'
import {
  MATERIAL_MODEL_RESET_VIEW_EVENT,
  MATERIAL_MODEL_SETTLE_VIEW_EVENT,
} from './materialModelEvents'

export function BackgroundShell() {
  const [restored, setRestored] = useState(false)
  const mode = useBackgroundStore((state) => state.mode)
  const newVariation = useBackgroundStore((state) => state.newVariation)
  const reset = useBackgroundStore((state) => state.reset)
  const inspectorRef = useRef<HTMLDivElement>(null)
  const previousModeRef = useRef(mode)
  const scrollByModeRef = useRef({ background: 0, material: 0 })
  const [confirmReset, setConfirmReset] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved')
  const resetAll = () => {
    reset()
    window.dispatchEvent(new Event(CANVAS_FIT_VIEW_EVENT))
    window.dispatchEvent(new Event(MATERIAL_MODEL_RESET_VIEW_EVENT))
  }

  useLayoutEffect(() => {
    const inspector = inspectorRef.current
    if (!inspector || previousModeRef.current === mode) return
    inspector.scrollTop = scrollByModeRef.current[mode]
    previousModeRef.current = mode
  }, [mode])

  useEffect(() => {
    let mounted = true
    try {
      const current = localStorage.getItem(BACKGROUND_AUTOSAVE_KEY)
      const legacy = localStorage.getItem(LEGACY_BACKGROUND_AUTOSAVE_KEY)
      const recipe = (current ? deserializeBackgroundRecipe(current) : null)
        ?? (legacy ? deserializeBackgroundRecipe(legacy) : null)
      if (recipe) {
        useBackgroundStore.getState().replaceRecipe(recipe)
        localStorage.setItem(BACKGROUND_AUTOSAVE_KEY, JSON.stringify(recipe))
      }
    } catch {
      queueMicrotask(() => {
        if (mounted) setSaveStatus('error')
      })
    }
    queueMicrotask(() => {
      if (mounted) setRestored(true)
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    let pending = useBackgroundStore.getState().recipe
    const write = (announce = true) => {
      clearTimeout(timer)
      timer = undefined
      try {
        localStorage.setItem(BACKGROUND_AUTOSAVE_KEY, JSON.stringify(pending))
        if (announce && mounted) setSaveStatus('saved')
      } catch {
        if (announce && mounted) setSaveStatus('error')
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
      setSaveStatus('saving')
      timer = setTimeout(flush, 350)
    })
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      mounted = false
      write(false)
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      unsub()
    }
  }, [])

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
        body="Resets format, colors, Looks, motion, 2D framing, and 3D view."
        confirmLabel="Reset all"
        onConfirm={() => {
          resetAll()
          setConfirmReset(false)
        }}
        onCancel={() => setConfirmReset(false)}
      />
      <header className="lab-topbar">
        <h1 className="lab-title">MBS Background Generator</h1>
        <span
          className={saveStatus === 'error' ? 'lab-save-status error' : 'lab-save-status'}
          role={saveStatus === 'error' ? 'alert' : 'status'}
          aria-live="polite"
        >
          {saveStatus === 'error' ? 'Save failed' : saveStatus === 'saving' ? 'Saving' : 'Saved'}
        </span>
        <div className="lab-topbar-actions">
          <button type="button" className="lab-chip" onClick={newVariation}>
            New variation
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
        <aside
          className="lab-side lab-side-right"
          aria-label={`${mode === 'background' ? '2D' : '3D'} controls`}
        >
          <div
            ref={inspectorRef}
            className="lab-inspector-body"
            onScroll={(event) => {
              scrollByModeRef.current[mode] = event.currentTarget.scrollTop
            }}
          >
            <FormatPanel />
            {mode === 'background' ? (
              <>
                <LooksPanel />
                <ColorsPanel />
                <MotionPanel />
              </>
            ) : (
              <>
                <MaterialColorsPanel />
                <MaterialPanel />
                <LooksPanel />
                <ColorsPanel />
                <MotionPanel />
              </>
            )}
          </div>
          <LabExportPanel />
        </aside>
      </div>
    </div>
  )
}
