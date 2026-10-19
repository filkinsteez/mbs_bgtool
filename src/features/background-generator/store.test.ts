import { beforeEach, describe, expect, it } from 'vitest'
import { encodeDeformation, emptyDeformation } from '@/core/lab/gradients/deformation'
import { createDefaultBackgroundRecipe, deserializeBackgroundRecipe } from './recipe'
import { backgroundHistory, useBackgroundStore } from './store'

describe('background recipe history', () => {
  beforeEach(() => {
    useBackgroundStore.getState().replaceRecipe(createDefaultBackgroundRecipe(42))
  })

  it('starts in 3D and keeps mode navigation out of content history', () => {
    const store = useBackgroundStore.getState()
    expect(store.mode).toBe('material')
    expect(store.recipe.mode).toBe('material')

    store.setMode('background')
    expect(useBackgroundStore.getState()).toMatchObject({
      mode: 'background',
      recipe: { mode: 'background' },
    })
    expect(backgroundHistory.depth.past).toBe(0)

    useBackgroundStore.getState().setMode('material')
    expect(backgroundHistory.depth.past).toBe(0)
  })

  it('undoes and redoes a semantic control edit', () => {
    const store = useBackgroundStore.getState()
    const gradient = store.recipe.gradientState
    store.updateRecipe({
      gradientState: {
        ...gradient,
        controls: { ...gradient.controls, detail: 0.9 },
      },
    })

    expect(useBackgroundStore.getState().recipe).toMatchObject({
      gradientState: { controls: { detail: 0.9 } },
      look: { detail: 0.9 },
    })
    expect(backgroundHistory.depth.past).toBe(1)

    useBackgroundStore.getState().undo()
    expect(useBackgroundStore.getState().recipe.gradientState.controls.detail).toBe(0.3)
    useBackgroundStore.getState().redo()
    expect(useBackgroundStore.getState().recipe.gradientState.controls.detail).toBe(0.9)
  })

  it('undoes and redoes the 2D Meta symbol toggle', () => {
    const store = useBackgroundStore.getState()
    store.updateRecipe({ backgroundSymbol: { enabled: false } })

    expect(useBackgroundStore.getState().recipe.backgroundSymbol.enabled).toBe(false)
    useBackgroundStore.getState().undo()
    expect(useBackgroundStore.getState().recipe.backgroundSymbol.enabled).toBe(true)
    useBackgroundStore.getState().redo()
    expect(useBackgroundStore.getState().recipe.backgroundSymbol.enabled).toBe(false)
  })

  it('coalesces a color-boundary drag into one history entry', () => {
    const store = useBackgroundStore.getState()
    store.beginTransaction()
    store.setTransient({
      paletteState: {
        ...store.recipe.paletteState,
        boundaries: [68, 84],
      },
    })
    store.setTransient({
      paletteState: {
        ...useBackgroundStore.getState().recipe.paletteState,
        boundaries: [64, 82],
      },
    })
    store.commitTransaction()

    expect(backgroundHistory.depth.past).toBe(1)
    expect(useBackgroundStore.getState().recipe.paletteState.boundaries).toEqual([64, 82])
    useBackgroundStore.getState().undo()
    expect(useBackgroundStore.getState().recipe.paletteState.boundaries).toEqual([70, 85])
  })

  it('coalesces a gradient-position drag and keeps it across presets and modes', () => {
    const store = useBackgroundStore.getState()
    store.beginTransaction()
    store.setTransient({ gradientState: { center: { x: 0.35, y: 0.7 } } })
    store.setTransient({ gradientState: { center: { x: 0.2, y: 0.8 } } })
    store.commitTransaction()

    expect(backgroundHistory.depth.past).toBe(1)
    expect(useBackgroundStore.getState().recipe).toMatchObject({
      gradientState: { center: { x: 0.2, y: 0.8 } },
      look: { gradient: { centerX: 0.2, centerY: 0.8 } },
    })

    useBackgroundStore.getState().setMode('background')
    useBackgroundStore.getState().updateRecipe({
      gradientState: { presetId: 'fine-smear' },
    })
    expect(useBackgroundStore.getState().recipe.gradientState.center)
      .toEqual({ x: 0.2, y: 0.8 })
    useBackgroundStore.getState().undo()
    useBackgroundStore.getState().undo()
    expect(useBackgroundStore.getState().recipe.gradientState.center)
      .toEqual({ x: 0.5, y: 0.5 })
  })

  it('settles an active edit before changing mode', () => {
    const store = useBackgroundStore.getState()
    const gradient = store.recipe.gradientState
    store.beginTransaction()
    store.setTransient({
      gradientState: {
        ...gradient,
        controls: { ...gradient.controls, position: 0.75 },
      },
    })
    store.setMode('background')

    expect(backgroundHistory.depth.past).toBe(1)
    expect(useBackgroundStore.getState()).toMatchObject({
      mode: 'background',
      recipe: {
        mode: 'background',
        gradientState: { controls: { position: 0.75 } },
      },
    })

    useBackgroundStore.getState().undo()
    expect(useBackgroundStore.getState()).toMatchObject({
      mode: 'background',
      recipe: {
        mode: 'background',
        gradientState: { controls: { position: 0.5 } },
      },
    })
  })

  it('commits distortion data through the canonical gradient state', () => {
    const store = useBackgroundStore.getState()
    const deformation = encodeDeformation(emptyDeformation())
    store.beginTransaction()
    store.setTransient({
      gradientState: {
        ...store.recipe.gradientState,
        deformation,
      },
    })
    store.commitTransaction()

    expect(backgroundHistory.depth.past).toBe(1)
    expect(useBackgroundStore.getState().recipe).toMatchObject({
      gradientState: { deformation },
      look: { deformation },
    })
    useBackgroundStore.getState().undo()
    expect(useBackgroundStore.getState().recipe.gradientState.deformation).toBeUndefined()
    useBackgroundStore.getState().redo()
    expect(useBackgroundStore.getState().recipe.look.deformation).toEqual(deformation)
  })

  it('settles a transient edit before a preset selection', () => {
    const store = useBackgroundStore.getState()
    const gradient = store.recipe.gradientState
    store.beginTransaction()
    store.setTransient({
      gradientState: {
        ...gradient,
        controls: { ...gradient.controls, distortion: 0.7 },
      },
    })
    store.updateRecipe({
      seed: 9027,
      gradientState: {
        presetId: 'fine-smear',
        controls: { detail: 0.82, blend: 0.32, distortion: 0.4, position: 0.64 },
        orientation: 90,
      },
    })

    expect(backgroundHistory.depth.past).toBe(2)
    expect(useBackgroundStore.getState().recipe).toMatchObject({
      seed: 9027,
      presetId: 'fine-smear',
      look: { id: 'smear', version: 'gradients' },
    })
    useBackgroundStore.getState().undo()
    expect(useBackgroundStore.getState().recipe.gradientState.controls.distortion).toBe(0.7)
    useBackgroundStore.getState().undo()
    expect(useBackgroundStore.getState().recipe.gradientState.controls.distortion).toBe(0.2)
  })

  it('keeps a redone recipe valid for autosave restore', () => {
    const store = useBackgroundStore.getState()
    store.updateRecipe({
      paletteState: {
        ...store.recipe.paletteState,
        packId: 'elemental',
        elementalAccent: '#410840',
      },
    })
    store.undo()
    useBackgroundStore.getState().redo()

    const recipe = useBackgroundStore.getState().recipe
    expect(deserializeBackgroundRecipe(JSON.stringify(recipe))).toEqual(recipe)
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

  it('reset returns to the canonical 3D baseline', () => {
    const store = useBackgroundStore.getState()
    store.setMode('background')
    store.updateRecipe({ seed: 17 })
    useBackgroundStore.getState().reset()

    expect(useBackgroundStore.getState()).toMatchObject({
      mode: 'material',
      recipe: createDefaultBackgroundRecipe(),
    })
  })
})
