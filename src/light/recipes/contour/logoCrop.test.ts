import { describe, expect, it } from 'vitest'
import { PACKS } from '../../color/packs'
import type { ControlValues, ParamValue, RecipeDefinition } from '../../scene'
import { frameSize, pointsNearFrame } from './curveCompose'
import { contourHalo } from './halo'
import { contourRim } from './rim'
import { META_LOGO_LANDMARKS, type Vec2 } from './shapes'

const ASPECTS = [16 / 9, 9 / 16, 1, 4 / 5]
const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1)
const CONTROLS: ControlValues[] = [
  { intensity: 0.5, softness: 0.5, mood: 0 },
  { intensity: 0.5, softness: 0.5, mood: 0.5 },
  { intensity: 0.5, softness: 0.5, mood: 1 },
]

/** The logo placement a composition asks for (logo kinds only), as the shader places it. */
interface LogoPlacement {
  size: number
  rotate: number
  flip: boolean
  anchor: Vec2
}
type Placement = (params: Record<string, ParamValue>, aspect: number) => LogoPlacement | null

const at = (value: ParamValue, aspect: number): Vec2 => {
  const [fw, fh] = frameSize(aspect)
  const uv = value as number[]
  return [(uv[0] - 0.5) * fw, (uv[1] - 0.5) * fh]
}

const CASES: [RecipeDefinition, Placement][] = [
  [contourRim, (p, aspect) => (p.shape === 5 ? { size: p.size as number, rotate: p.rotate as number, flip: p.flip as boolean, anchor: at(p.at, aspect) } : null)],
  [
    contourHalo,
    (p, aspect) =>
      p.ring1Shape === 5 || p.ring1Shape === 7
        ? { size: p.ring1Radius as number, rotate: p.ring1Rotate as number, flip: p.ring1Flip as boolean, anchor: at(p.ring1At, aspect) }
        : null,
  ],
]

describe('logo crops never show the whole logo', () => {
  for (const [recipe, placement] of CASES) {
    it(`${recipe.id}: at most one of the crossing and the two loop tops inside the frame`, () => {
      const problems: string[] = []
      let crops = 0
      for (const pack of PACKS)
        for (const aspect of ASPECTS)
          for (const controls of CONTROLS)
            for (const seed of SEEDS) {
              const composition = recipe.compose?.({ pack, controls, seed, aspect })
              const logo = composition && placement(composition.params, aspect)
              if (!logo) continue
              crops++
              // A loop reads from the curve around its top, so landmarks just past the frame edge count too.
              const shown = pointsNearFrame(META_LOGO_LANDMARKS, logo.size, logo.rotate, logo.flip, logo.anchor, aspect, 0.1 * logo.size)
              if (shown > 1) problems.push(`${pack.id} ${aspect.toFixed(3)} seed ${seed} light ${controls.mood}: ${shown} landmarks`)
            }
      expect(crops).toBeGreaterThan(0)
      expect(problems).toEqual([])
    }, 60_000)
  }
})
