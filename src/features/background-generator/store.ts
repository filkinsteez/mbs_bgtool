'use client'

import { create } from 'zustand'
import { useLabStore } from '@/core/lab/labStore'
import { History } from '@/core/state/history'
import { mergeDeep } from '@/core/state/store'
import {
  applyFramingPreset,
  backgroundRecipeToLab,
  constrainBackgroundTransform,
  createDefaultBackgroundRecipe,
  normalizeSubjectTransform,
  type BackgroundRecipePatch,
  type BackgroundRecipeV2,
  type FramingMode,
  type GeneratorMode,
} from './recipe'

type BackgroundStore = {
  recipe: BackgroundRecipeV2
  mode: GeneratorMode
  historyVersion: number
  canUndo: boolean
  canRedo: boolean
  replaceRecipe: (recipe: BackgroundRecipeV2) => void
  updateRecipe: (patch: BackgroundRecipePatch) => void
  beginTransaction: () => void
  setTransient: (patch: BackgroundRecipePatch) => void
  commitTransaction: () => void
  cancelTransaction: () => void
  undo: () => void
  redo: () => void
  setMode: (mode: GeneratorMode) => void
  setFramingMode: (mode: FramingMode) => void
  newVariation: () => void
  reset: () => void
}

export const backgroundHistory = new History<BackgroundRecipeV2>()

let transactionStart: BackgroundRecipeV2 | null = null

function syncLab(recipe: BackgroundRecipeV2, live = false): void {
  const labStore = useLabStore.getState()
  labStore.replaceLab(backgroundRecipeToLab(recipe), { keepHistory: true })
  labStore.setUi({ quality: live ? 'live' : 'hq' })
}

function historyFlags(): Pick<BackgroundStore, 'canUndo' | 'canRedo'> {
  const depth = backgroundHistory.depth
  return { canUndo: depth.past > 0, canRedo: depth.future > 0 }
}

function changed(a: BackgroundRecipeV2, b: BackgroundRecipeV2): boolean {
  return JSON.stringify(a) !== JSON.stringify(b)
}

export const useBackgroundStore = create<BackgroundStore>()((set, get) => {
  const normalizeRecipe = (recipe: BackgroundRecipeV2): BackgroundRecipeV2 => ({
    ...recipe,
    transforms: {
      background: constrainBackgroundTransform(
        recipe.transforms.background,
        recipe.format.width,
        recipe.format.height,
      ),
      material: normalizeSubjectTransform(recipe.transforms.material),
    },
  })

  const commitRecipe = (recipe: BackgroundRecipeV2) => {
    recipe = normalizeRecipe(recipe)
    const before = get().recipe
    const transientStart = transactionStart
    transactionStart = null
    if (transientStart && changed(transientStart, before)) {
      backgroundHistory.push(transientStart)
    }
    if (!changed(before, recipe)) return
    backgroundHistory.push(before)
    set((state) => ({
      recipe,
      historyVersion: state.historyVersion + 1,
      ...historyFlags(),
    }))
    syncLab(recipe)
  }

  return {
    recipe: createDefaultBackgroundRecipe(),
    mode: 'background',
    historyVersion: 0,
    canUndo: false,
    canRedo: false,
    replaceRecipe: (recipe) => {
      transactionStart = null
      backgroundHistory.clear()
      set((state) => ({
        recipe,
        historyVersion: state.historyVersion + 1,
        ...historyFlags(),
      }))
      syncLab(recipe)
    },
    updateRecipe: (patch) => {
      commitRecipe(mergeDeep(get().recipe, patch))
    },
    beginTransaction: () => {
      if (!transactionStart) transactionStart = get().recipe
    },
    setTransient: (patch) => {
      if (!transactionStart) transactionStart = get().recipe
      const recipe = normalizeRecipe(mergeDeep(get().recipe, patch))
      if (!changed(get().recipe, recipe)) return
      set({ recipe })
      syncLab(recipe, true)
    },
    commitTransaction: () => {
      const before = transactionStart
      transactionStart = null
      if (!before) return
      const recipe = get().recipe
      if (changed(before, recipe)) backgroundHistory.push(before)
      set((state) => ({
        historyVersion: state.historyVersion + 1,
        ...historyFlags(),
      }))
      syncLab(recipe)
    },
    cancelTransaction: () => {
      const before = transactionStart
      transactionStart = null
      if (!before) return
      set((state) => ({
        recipe: before,
        historyVersion: state.historyVersion + 1,
        ...historyFlags(),
      }))
      syncLab(before)
    },
    undo: () => {
      if (transactionStart) {
        get().cancelTransaction()
        return
      }
      const previous = backgroundHistory.undo(get().recipe)
      if (!previous) return
      set((state) => ({
        recipe: previous,
        historyVersion: state.historyVersion + 1,
        ...historyFlags(),
      }))
      syncLab(previous)
    },
    redo: () => {
      if (transactionStart) {
        get().cancelTransaction()
        return
      }
      const next = backgroundHistory.redo(get().recipe)
      if (!next) return
      set((state) => ({
        recipe: next,
        historyVersion: state.historyVersion + 1,
        ...historyFlags(),
      }))
      syncLab(next)
    },
    setMode: (mode) => {
      if (transactionStart) get().commitTransaction()
      set({ mode })
    },
    setFramingMode: (mode) => {
      commitRecipe(applyFramingPreset(get().recipe, mode, get().mode))
    },
    newVariation: () => {
      const seed = globalThis.crypto?.getRandomValues
        ? globalThis.crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff
        : (get().recipe.seed + 104729) & 0x7fffffff
      commitRecipe(mergeDeep(get().recipe, { seed }))
    },
    reset: () => {
      commitRecipe(createDefaultBackgroundRecipe())
    },
  }
})

export function syncBackgroundRecipe(): void {
  syncLab(useBackgroundStore.getState().recipe)
}
