'use client'

import { SegmentedControl } from '@/components/controls/SegmentedControl'
import {
  dimensionsFor,
  type AspectId,
} from '@/features/background-generator/recipe'
import { useBackgroundStore } from '@/features/background-generator/store'
import {
  CANVAS_ASPECT_TOOL_EVENT,
  CANVAS_FIT_VIEW_EVENT,
} from '@/components/lab/canvasEvents'

const ASPECTS: Exclude<AspectId, 'custom'>[] = ['16:9', '9:16', '1:1', '4:5']

export function FormatPanel() {
  const format = useBackgroundStore((state) => state.recipe.format)
  const framing = useBackgroundStore((state) => state.recipe.transforms.background)
  const mode = useBackgroundStore((state) => state.mode)
  const update = useBackgroundStore((state) => state.updateRecipe)
  const setFramingMode = useBackgroundStore((state) => state.setFramingMode)

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
          const aspect = value as AspectId
          update({
            format: {
              aspect,
              ...dimensionsFor(aspect, format),
            },
          })
          fitAfterLayout()
        }}
      />
      <div className="lab-format-details">
        <output aria-label="Export dimensions">
          {format.width} × {format.height}
        </output>
        <button
          type="button"
          className={format.aspect === 'custom' ? 'ctl-action active' : 'ctl-action'}
          aria-pressed={format.aspect === 'custom'}
          onClick={() => window.dispatchEvent(new Event(CANVAS_ASPECT_TOOL_EVENT))}
        >
          Custom aspect…
        </button>
        {mode === 'background' ? (
          <button
            type="button"
            className="ctl-action"
            disabled={
              framing.preset === 'full'
              && framing.x === 0
              && framing.y === 0
              && framing.scale === 1
              && framing.rotation === 0
            }
            onClick={() => setFramingMode('full')}
          >
            Reset framing
          </button>
        ) : null}
      </div>
    </div>
  )
}
