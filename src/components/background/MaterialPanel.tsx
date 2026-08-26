'use client'

import { Slider } from '@/components/controls/Slider'
import { handleRadioGroupKeyDown } from '@/components/controls/radioKeyboard'
import {
  MATERIALS,
  type MaterialId,
} from '@/features/background-generator/material/catalog'
import { useBackgroundStore } from '@/features/background-generator/store'

const pct = (v: number) => `${Math.round(v * 100)}`

export function MaterialPanel() {
  const material = useBackgroundStore((state) => state.recipe.material)
  const update = useBackgroundStore((state) => state.updateRecipe)
  const setTransient = useBackgroundStore((state) => state.setTransient)
  const commit = useBackgroundStore((state) => state.commitTransaction)

  return (
    <div className="panel-section">
      <h2 className="panel-heading">Materials</h2>
      <div className="lab-add-row" role="radiogroup" aria-label="3D surface">
        {MATERIALS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={material.id === item.id ? 'lab-chip active' : 'lab-chip'}
            role="radio"
            aria-checked={material.id === item.id}
            tabIndex={material.id === item.id ? 0 : -1}
            onClick={() => update({ material: { id: item.id as MaterialId } })}
            onKeyDown={handleRadioGroupKeyDown}
          >
            {item.label}
          </button>
        ))}
      </div>
      <Slider
            label="Intensity"
            value={material.intensity}
            min={0}
            max={1}
            step={0.01}
            format={pct}
            defaultValue={0.65}
            onChange={(intensity) => setTransient({ material: { intensity } })}
            onCommit={commit}
      />
      <Slider
            label="Light"
            value={material.light}
            min={0}
            max={1}
            step={0.01}
            format={pct}
            defaultValue={0.5}
            onChange={(light) => setTransient({ material: { light } })}
            onCommit={commit}
      />
      <Slider
            label="Depth"
            value={material.depth}
            min={0}
            max={1}
            step={0.01}
            format={pct}
            defaultValue={0.35}
            onChange={(depth) => setTransient({ material: { depth } })}
            onCommit={commit}
      />
    </div>
  )
}
