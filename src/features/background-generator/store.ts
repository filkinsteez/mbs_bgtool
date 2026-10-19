'use client'

import { create } from 'zustand'
import { History } from '@/core/state/history'
import { mergeDeep } from '@/core/state/store'
import { findPreset } from './curatedPresets'
import {
  gradientLookId,
  normalizeGradientState,
  normalizePaletteState,
  resolveGradientSettings,
  resolvePaletteMix,
} from './gradientControls'
import {
  applyFramingPreset,
  canonicalizeFormat,
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

function historyFlags(): Pick<BackgroundStore, 'canUndo' | 'canRedo'> {
  const depth = backgroundHistory.depth
  return { canUndo: depth.past > 0, canRedo: depth.future > 0 }
}

function changed(a: BackgroundRecipeV2, b: BackgroundRecipeV2): boolean {
  return JSON.stringify(a) !== JSON.stringify(b)
}

export const useBackgroundStore = create<BackgroundStore>()((set, get) => {
  const normalizeRecipe = (recipe: BackgroundRecipeV2): BackgroundRecipeV2 => {
    const format = canonicalizeFormat(recipe.format)
    const gradientState = normalizeGradientState(recipe.gradientState)
    const paletteState = normalizePaletteState(recipe.paletteState)
    const preset = findPreset(gradientState.presetId)
    const palette = resolvePaletteMix(paletteState)
    const settings = resolveGradientSettings(
      preset.family,
      gradientState.controls,
      preset.grain,
      gradientState.orientation,
      gradientState.center,
      gradientState.field,
      palette.mix.length,
    )
    return {
      ...recipe,
      mode: recipe.mode === 'background' || recipe.mode === 'material' ? recipe.mode : 'material',
      presetId: preset.id,
      gradientState,
      paletteState,
      format,
      look: {
        ...recipe.look,
        id: gradientLookId(preset.family),
        version: 'gradients',
        detail: gradientState.controls.detail,
        gradient: settings,
        deformation: gradientState.deformation,
      },
      materialLookOverlay: { enabled: true },
      backgroundSymbol: {
        enabled: recipe.backgroundSymbol.enabled !== false,
      },
      palette: {
        ...recipe.palette,
        packId: paletteState.packId,
        mix: palette.mix,
        ink: palette.ink,
        ground: palette.ground,
      },
      transforms: {
        background: constrainBackgroundTransform(
          recipe.transforms.background,
          format.width,
          format.height,
        ),
        material: normalizeSubjectTransform(recipe.transforms.material),
      },
    }
  }

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
      mode: recipe.mode,
      historyVersion: state.historyVersion + 1,
      ...historyFlags(),
    }))
  }

  return {
    recipe: createDefaultBackgroundRecipe(),
    mode: createDefaultBackgroundRecipe().mode,
    historyVersion: 0,
    canUndo: false,
    canRedo: false,
    replaceRecipe: (recipe) => {
      recipe = normalizeRecipe(recipe)
      transactionStart = null
      backgroundHistory.clear()
      set((state) => ({
        recipe,
        mode: recipe.mode,
        historyVersion: state.historyVersion + 1,
        ...historyFlags(),
      }))
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
    },
    undo: () => {
      if (transactionStart) {
        get().cancelTransaction()
        return
      }
      const previous = backgroundHistory.undo(get().recipe)
      if (!previous) return
      const recipe = normalizeRecipe({ ...previous, mode: get().mode })
      set((state) => ({
        recipe,
        historyVersion: state.historyVersion + 1,
        ...historyFlags(),
      }))
    },
    redo: () => {
      if (transactionStart) {
        get().cancelTransaction()
        return
      }
      const next = backgroundHistory.redo(get().recipe)
      if (!next) return
      const recipe = normalizeRecipe({ ...next, mode: get().mode })
      set((state) => ({
        recipe,
        historyVersion: state.historyVersion + 1,
        ...historyFlags(),
      }))
    },
    setMode: (mode) => {
      if (transactionStart) get().commitTransaction()
      const recipe = normalizeRecipe(mergeDeep(get().recipe, {
        mode,
        ...(mode === 'material' ? { materialLookOverlay: { enabled: true } } : {}),
      }))
      if (recipe.mode === get().mode) return
      set({ recipe, mode: recipe.mode })
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
      const recipe = createDefaultBackgroundRecipe()
      commitRecipe(recipe)
      set({ mode: recipe.mode })
    },
  }
})
