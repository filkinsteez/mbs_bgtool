import { beforeEach, describe, expect, it } from 'vitest'
import { createDefaultBackgroundRecipe } from './recipe'
import { backgroundHistory, useBackgroundStore } from './store'

describe('background recipe history', () => {
  beforeEach(() => {
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
