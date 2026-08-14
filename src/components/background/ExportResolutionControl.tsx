'use client'

import { useSyncExternalStore } from 'react'
import { SegmentedControl } from '@/components/controls/SegmentedControl'
import {
  getMaxTextureSize,
  inspect8kCapability,
} from '@/features/background-generator/capabilities'
import {
  dimensionsFor,
  type ResolutionId,
} from '@/features/background-generator/recipe'
import { useBackgroundStore } from '@/features/background-generator/store'

const RESOLUTIONS: ResolutionId[] = ['1080', '2k', '4k', '8k']
const subscribeCapability = () => () => undefined

export function ExportResolutionControl() {
  const format = useBackgroundStore((state) => state.recipe.format)
  const material = useBackgroundStore((state) => state.recipe.material.id)
  const mode = useBackgroundStore((state) => state.recipe.mode)
  const update = useBackgroundStore((state) => state.updateRecipe)
  const maxTextureSize = useSyncExternalStore(
    subscribeCapability,
    getMaxTextureSize,
    () => 0,
  )
  const capability = inspect8kCapability(
    format.aspect,
    mode === 'material' ? material : 'clean',
    maxTextureSize,
  )

  return (
    <>
      <div className="panel-heading">Export resolution</div>
      <SegmentedControl
        ariaLabel="Export resolution"
        value={format.resolution}
        options={RESOLUTIONS.filter(
          (resolution) => resolution !== '8k' || capability.supported,
        ).map((resolution) => ({
          value: resolution,
          label: resolution.toUpperCase(),
        }))}
        onChange={(value) => {
          const resolution = value as ResolutionId
          update({
            format: {
              resolution,
              ...dimensionsFor(resolution, format.aspect, format),
            },
          })
        }}
      />
      {!capability.supported ? (
        <div className="panel-note" role="status">
          8K unavailable: {capability.reason}
        </div>
      ) : null}
    </>
  )
}
