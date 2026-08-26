'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { LooksPanel } from '@/components/lab/LooksPanel'
import { LabCanvas } from '@/components/lab/LabCanvas'
import { ColorsPanel } from '@/components/lab/ColorsPanel'
import { LabExportPanel } from '@/components/lab/LabExportPanel'
import {
  BACKGROUND_AUTOSAVE_KEY,
  LEGACY_BACKGROUND_AUTOSAVE_KEY,
  deserializeBackgroundRecipe,
} from '@/features/background-generator/recipe'
import {
  syncBackgroundRecipe,
  useBackgroundStore,
} from '@/features/background-generator/store'
import { FormatPanel } from './FormatPanel'
import { MaterialColorsPanel } from './MaterialColorsPanel'
import { MaterialPanel } from './MaterialPanel'
import { MotionPanel } from './MotionPanel'

const subscribeHydration = () => () => undefined
const getClientHydration = () => true
const getServerHydration = () => false

export function BackgroundShell() {
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    getClientHydration,
    getServerHydration,
  )
  const mode = useBackgroundStore((state) => state.recipe.mode)
  const newVariation = useBackgroundStore((state) => state.newVariation)
  const reset = useBackgroundStore((state) => state.reset)

  useEffect(() => {
    try {
      const current = localStorage.getItem(BACKGROUND_AUTOSAVE_KEY)
      const legacy = localStorage.getItem(LEGACY_BACKGROUND_AUTOSAVE_KEY)
      const recipe = (current ? deserializeBackgroundRecipe(current) : null)
        ?? (legacy ? deserializeBackgroundRecipe(legacy) : null)
      if (recipe) {
        useBackgroundStore.getState().replaceRecipe(recipe)
        localStorage.setItem(BACKGROUND_AUTOSAVE_KEY, JSON.stringify(recipe))
      } else {
        syncBackgroundRecipe()
      }
    } catch {
      syncBackgroundRecipe()
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsub = useBackgroundStore.subscribe((state, prev) => {
      if (state.recipe === prev.recipe) return
      clearTimeout(timer)
      timer = setTimeout(() => {
        try {
          localStorage.setItem(BACKGROUND_AUTOSAVE_KEY, JSON.stringify(state.recipe))
        } catch {
          // ignore storage write failures
        }
      }, 350)
    })
    return () => {
      clearTimeout(timer)
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
      if (event.shiftKey) useBackgroundStore.getState().redo()
      else useBackgroundStore.getState().undo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="lab-root dialkit-root" data-hydrated={hydrated ? 'true' : 'false'}>
      <header className="lab-topbar">
        <span className="lab-title">MBS Background Generator</span>
        <div className="lab-topbar-actions">
          {mode === 'background' ? (
            <button type="button" className="lab-chip" onClick={newVariation}>
              New variation
            </button>
          ) : null}
          <button type="button" className="lab-chip" onClick={reset}>
            Reset
          </button>
        </div>
      </header>
      <div className="lab-columns">
        <main className="lab-stage">
          <LabCanvas />
        </main>
        <aside className="lab-side lab-side-right">
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
            </>
          )}
          <LabExportPanel />
        </aside>
      </div>
    </div>
  )
}
