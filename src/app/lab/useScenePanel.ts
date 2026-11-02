import { DialStore, useDialKitController, type DialConfig, type DialKitController } from 'dialkit'
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { getRecipe } from '@/light/recipes'
import type { RecipeDefinition, RecipeId, Scene } from '@/light/scene'
import { configDefaults, recipeOf, sceneDialConfig, sceneFromValues, switchRecipe } from './sceneConfig'

export interface ScenePanelOptions {
  id: string
  name: string
  /** What the panel starts from: a preset file, or a recipe with its defaults. */
  base: Scene
  /** Show a color control per slot; otherwise colors come from `colorsFor`. */
  colors: boolean
  colorsFor?: (recipe: RecipeDefinition) => string[]
}

export interface ScenePanel {
  scene: Scene
  recipe: RecipeDefinition
  config: DialConfig
  dial: DialKitController<DialConfig>
}

/** One DialKit panel for a scene, built from the recipe picked in it. */
export function useScenePanel({ id, name, base, colors, colorsFor }: ScenePanelOptions): ScenePanel {
  const subscribe = useCallback((onChange: () => void) => DialStore.subscribe(id, onChange), [id])
  const readRecipe = useCallback(() => DialStore.getValue(id, 'recipe'), [id])
  const stored = useSyncExternalStore(subscribe, readRecipe, () => undefined)
  const recipeId = recipeOf({ recipe: stored }, base.recipe)
  const start = useMemo(() => (recipeId === base.recipe ? base : switchRecipe(base, recipeId)), [base, recipeId])
  const config = useMemo(() => sceneDialConfig(start, { colors }), [start, colors])
  const dial = useDialKitController(name, config, { id })
  const { values } = dial
  const recipe = getRecipe(recipeId)
  const scene = useMemo(() => {
    const fromValues = sceneFromValues(recipeId, values, base)
    return colorsFor ? { ...fromValues, colors: colorsFor(getRecipe(recipeId)) } : fromValues
  }, [recipeId, values, base, colorsFor])

  // DialKit keeps the values of params two recipes share; a recipe picked here starts from its own params instead.
  const last = useRef<{ id: string; recipe: RecipeId; colors: readonly string[] } | null>(null)
  useEffect(() => {
    const previous = last.current
    last.current = { id, recipe: recipeId, colors: scene.colors }
    if (!previous || previous.id !== id || previous.recipe === recipeId) return
    const next = getRecipe(recipeId)
    const params = Object.entries(configDefaults(config)).filter(([path]) => path.startsWith('params.'))
    const kept = colors ? next.colorSlots.map((slot, i) => [`colors.${slot.key}`, previous.colors[i] ?? next.defaultColors[i]]) : []
    DialStore.updateValues(id, Object.fromEntries([...params, ...kept]))
  })

  return { scene, recipe, config, dial }
}
