import { getRecipe } from '../recipes'
import type { RecipeId, Scene } from '../scene'
import { ProgramRenderer, type RenderOptions, type RenderStats } from './programRenderer'

export type { RenderOptions, RenderStats } from './programRenderer'

/** ProgramRenderer plus scenes by recipe id from the recipe registry. */
export class LightRenderer extends ProgramRenderer {
  render(scene: Scene, options: RenderOptions): RenderStats {
    return this.renderProgram(getRecipe(scene.recipe), scene, options)
  }

  /** Starts compiling every program the look can draw with, without waiting; needs KHR_parallel_shader_compile. Returns them. */
  prepare(recipe: RecipeId): string[] {
    return this.prepareProgram(getRecipe(recipe))
  }
}
