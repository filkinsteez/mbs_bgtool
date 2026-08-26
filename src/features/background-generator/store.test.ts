import { beforeEach, describe, expect, it } from 'vitest'
import { createDefaultBackgroundRecipe, deserializeBackgroundRecipe } from './recipe'
import { backgroundHistory, useBackgroundStore } from './store'

describe('background recipe history', () => {
  beforeEach(() => {
    useBackgroundStore.getState().setMode('background')
    useBackgroundStore.getState().replaceRecipe(createDefaultBackgroundRecipe(42))
  })

  it('undoes and redoes discrete recipe edits', () => {
    useBackgroundStore.getState().updateRecipe({ look: { detail: 0.9 } })
    expect(useBackgroundStore.getState().recipe.look.detail).toBe(0.9)
    expect(backgroundHistory.depth.past).toBe(1)

    useBackgroundStore.getState().undo()
    expect(useBackgroundStore.getState().recipe.look.detail).toBe(0.5)
    useBackgroundStore.getState().redo()
    expect(useBackgroundStore.getState().recipe.look.detail).toBe(0.9)
  })

  it('keeps a redone Look recipe valid for autosave restore', () => {
    const store = useBackgroundStore.getState()
    store.updateRecipe({ look: { id: 'pixels' } })
    useBackgroundStore.getState().updateRecipe({ look: { id: 'scanlines' } })
    useBackgroundStore.getState().undo()
    useBackgroundStore.getState().redo()

    const recipe = useBackgroundStore.getState().recipe
    expect(recipe.look.id).toBe('scanlines')
    expect(deserializeBackgroundRecipe(JSON.stringify(recipe))?.look.id).toBe('scanlines')
  })

  it('keeps mode navigation out of recipe history', () => {
    const store = useBackgroundStore.getState()
    store.updateRecipe({ look: { detail: 0.9 } })
    store.setMode('material')

    expect(useBackgroundStore.getState().mode).toBe('material')
    expect(useBackgroundStore.getState().recipe.mode).toBe('background')
    expect(backgroundHistory.depth.past).toBe(1)

    useBackgroundStore.getState().undo()
    expect(useBackgroundStore.getState().mode).toBe('material')
    expect(useBackgroundStore.getState().recipe.mode).toBe('background')
    expect(useBackgroundStore.getState().recipe.look.detail).toBe(0.5)
    useBackgroundStore.getState().redo()
    expect(useBackgroundStore.getState().mode).toBe('material')
    expect(useBackgroundStore.getState().recipe.mode).toBe('background')
  })

  it('settles an active edit before changing mode without adding mode history', () => {
    const store = useBackgroundStore.getState()
    store.beginTransaction()
    store.setTransient({ look: { detail: 0.8 } })
    store.setMode('material')

    expect(backgroundHistory.depth.past).toBe(1)
    expect(useBackgroundStore.getState()).toMatchObject({
      mode: 'material',
      recipe: { mode: 'background', look: { detail: 0.8 } },
    })

    useBackgroundStore.getState().undo()
    expect(useBackgroundStore.getState()).toMatchObject({
      mode: 'material',
      recipe: { mode: 'background', look: { detail: 0.5 } },
    })
  })

  it('does not restore the workspace mode from a saved recipe', () => {
    const saved = { ...createDefaultBackgroundRecipe(42), mode: 'material' as const }
    useBackgroundStore.getState().replaceRecipe(saved)

    expect(useBackgroundStore.getState().mode).toBe('background')
    expect(useBackgroundStore.getState().recipe.mode).toBe('material')
  })

  it('settles an active edit before a discrete edit', () => {
    const store = useBackgroundStore.getState()
    store.beginTransaction()
    store.setTransient({ look: { detail: 0.8 } })
    store.updateRecipe({ look: { id: 'trails' } })

    expect(backgroundHistory.depth.past).toBe(2)
    useBackgroundStore.getState().undo()
    expect(useBackgroundStore.getState().recipe.look).toMatchObject({
      id: 'frame',
      detail: 0.8,
    })
    useBackgroundStore.getState().undo()
    expect(useBackgroundStore.getState().recipe.look.detail).toBe(0.5)
  })

  it('canonicalizes invalid custom dimensions before they enter state', () => {
    useBackgroundStore.getState().updateRecipe({
      format: { aspect: 'custom', width: 100, height: 0 },
    })

    expect(useBackgroundStore.getState().recipe.format).toEqual({
      aspect: '16:9',
      width: 3840,
      height: 2160,
    })
  })

  it('persists 3D Look overlay selection as recipe history', () => {
    const store = useBackgroundStore.getState()
    store.updateRecipe({
      look: { id: 'trails' },
      materialLookOverlay: { enabled: true },
    })
    expect(useBackgroundStore.getState().recipe).toMatchObject({
      look: { id: 'trails' },
      materialLookOverlay: { enabled: true },
    })

    useBackgroundStore.getState().undo()
    expect(useBackgroundStore.getState().recipe.materialLookOverlay.enabled).toBe(false)
  })

  it('coalesces a direct manipulation transaction into one history entry', () => {
    const store = useBackgroundStore.getState()
    store.beginTransaction()
    store.setTransient({
      transforms: { background: { preset: 'free', x: 0.1 } },
    })
    store.setTransient({
      transforms: { background: { preset: 'free', x: 0.2 } },
    })
    store.commitTransaction()

    expect(backgroundHistory.depth.past).toBe(1)
    useBackgroundStore.getState().undo()
    expect(useBackgroundStore.getState().recipe.transforms.background.x).toBe(0)
  })

  it('restores the pre-gesture recipe when a transaction is cancelled', () => {
    const store = useBackgroundStore.getState()
    store.beginTransaction()
    store.setTransient({
      transforms: { background: { preset: 'free', rotation: 90 } },
    })
    store.cancelTransaction()

    expect(useBackgroundStore.getState().recipe.transforms.background.rotation).toBe(0)
    expect(backgroundHistory.depth.past).toBe(0)
  })
})
