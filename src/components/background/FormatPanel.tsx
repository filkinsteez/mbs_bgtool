'use client'

import { SegmentedControl } from '@/components/controls/SegmentedControl'
import {
  dimensionsFor,
  type FixedAspectId,
} from '@/features/background-generator/recipe'
import { useBackgroundStore } from '@/features/background-generator/store'

const ASPECTS: FixedAspectId[] = ['16:9', '9:16', '1:1', '4:5']

export function FormatPanel() {
  const format = useBackgroundStore((state) => state.recipe.format)
  const update = useBackgroundStore((state) => state.updateRecipe)

  return (
    <div className="panel-section" role="region" aria-labelledby="format-heading">
      <h2 className="panel-heading" id="format-heading">Aspect ratio</h2>
      <SegmentedControl
        ariaLabel="Aspect ratio"
        value={format.aspect}
        options={ASPECTS.map((aspect) => ({
          value: aspect,
          label: aspect,
        }))}
        onChange={(value) => {
          const aspect = value as FixedAspectId
          update({
            format: {
              aspect,
              ...dimensionsFor(aspect),
            },
          })
        }}
      />
    </div>
  )
}
