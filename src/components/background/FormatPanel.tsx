'use client'

import { SegmentedControl } from '@/components/controls/SegmentedControl'
import {
  dimensionsFor,
  type FixedAspectId,
} from '@/features/background-generator/recipe'
import { useBackgroundStore } from '@/features/background-generator/store'
import { CANVAS_FIT_VIEW_EVENT } from '@/components/lab/canvasEvents'

const ASPECTS: FixedAspectId[] = ['16:9', '9:16', '1:1', '4:5']

export function FormatPanel() {
  const format = useBackgroundStore((state) => state.recipe.format)
  const update = useBackgroundStore((state) => state.updateRecipe)

  const fitAfterLayout = () => {
    requestAnimationFrame(() => window.dispatchEvent(new Event(CANVAS_FIT_VIEW_EVENT)))
  }

  return (
    <div className="panel-section" role="region" aria-labelledby="format-heading">
      <h2 className="panel-heading" id="format-heading">Format</h2>
      <SegmentedControl
        label="Aspect"
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
          fitAfterLayout()
        }}
      />
    </div>
  )
}
