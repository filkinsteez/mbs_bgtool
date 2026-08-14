'use client'

import { Slider } from '@/components/controls/Slider'
import {
  MATERIAL_BY_ID,
  SHADERS_CATALOG,
  type MaterialId,
} from '@/features/background-generator/material/shadersCatalog'
import { useBackgroundStore } from '@/features/background-generator/store'

const pct = (v: number) => `${Math.round(v * 100)}`

export function MaterialPanel() {
  const material = useBackgroundStore((state) => state.recipe.material)
  const update = useBackgroundStore((state) => state.updateRecipe)
  const setTransient = useBackgroundStore((state) => state.setTransient)
  const commit = useBackgroundStore((state) => state.commitTransaction)
  const selectedMaterial = MATERIAL_BY_ID[material.id]

  return (
    <div className="panel-section">
      <div className="panel-heading">Materials</div>
      <div className="lab-add-row">
        {SHADERS_CATALOG.map((item) => (
          <button
            key={item.id}
            className={material.id === item.id ? 'lab-chip active' : 'lab-chip'}
            onClick={() => update({ material: { id: item.id as MaterialId } })}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="panel-note">
        {material.id === 'clean'
          ? 'Opaque untreated Meta symbol.'
          : selectedMaterial.preset
            ? `Licensed Shaders.com preset ${selectedMaterial.label} · ${selectedMaterial.preset.id}. Intensity changes the effect—not symbol opacity.`
            : 'Licensed Shaders.com finish. Intensity changes the effect—not symbol opacity.'}
      </div>
      {material.id === 'clean' ? null : (
        <>
          <Slider
            label="Intensity"
            value={material.intensity}
            min={0}
            max={1}
            step={0.01}
            format={pct}
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
            onChange={(depth) => setTransient({ material: { depth } })}
            onCommit={commit}
          />
        </>
      )}
    </div>
  )
}
