'use client'

import { SegmentedControl } from '@/components/controls/SegmentedControl'
import {
  dimensionsFor,
  type AspectId,
} from '@/features/background-generator/recipe'
import { useBackgroundStore } from '@/features/background-generator/store'

const ASPECTS: AspectId[] = ['16:9', '9:16', '1:1', '4:5', 'custom']

export function FormatPanel() {
  const format = useBackgroundStore((state) => state.recipe.format)
  const update = useBackgroundStore((state) => state.updateRecipe)

  return (
    <div className="panel-section" role="region" aria-labelledby="format-heading">
      <h2 className="panel-heading" id="format-heading">Format</h2>
      <SegmentedControl
        label="Aspect"
        value={format.aspect}
        options={ASPECTS.map((aspect) => ({
          value: aspect,
          label: aspect === 'custom' ? 'Custom' : aspect,
        }))}
        onChange={(value) => {
          const aspect = value as AspectId
          update({
            format: {
              aspect,
              ...dimensionsFor(aspect, format),
            },
          })
        }}
      />
    </div>
  )
}
