'use client'

import { handleRadioGroupKeyDown } from '@/components/controls/radioKeyboard'
import { SegmentedControl } from '@/components/controls/SegmentedControl'
import { Slider } from '@/components/controls/Slider'
import { CURATED_PRESETS, findPreset } from '@/features/background-generator/curatedPresets'
import {
  applyStructureControl,
  structureControlValue,
  transferVisibleGradientControls,
} from '@/features/background-generator/gradientControls'
import { useBackgroundStore } from '@/features/background-generator/store'

const pct = (value: number) => `${Math.round(value * 100)}`

export function PresetPanel() {
  const gradient = useBackgroundStore((state) => state.recipe.gradientState)
  const backgroundSymbol = useBackgroundStore((state) => state.recipe.backgroundSymbol)
  const mode = useBackgroundStore((state) => state.mode)
  const updateRecipe = useBackgroundStore((state) => state.updateRecipe)
  const setTransient = useBackgroundStore((state) => state.setTransient)
  const commit = useBackgroundStore((state) => state.commitTransaction)
  const newVariation = useBackgroundStore((state) => state.newVariation)
  const preset = findPreset(gradient.presetId)
  const structure = structureControlValue(gradient.controls, preset.controls)

  return (
    <div className="panel-section">
      <h2 className="panel-heading">Presets</h2>
      <div className="lab-looks" role="radiogroup" aria-label="Gradient presets">
        {CURATED_PRESETS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.id === preset.id ? 'lab-look active' : 'lab-look'}
            role="radio"
            aria-checked={item.id === preset.id}
            tabIndex={item.id === preset.id ? 0 : -1}
            onKeyDown={handleRadioGroupKeyDown}
            onClick={() => {
              updateRecipe({
                presetId: item.id,
                seed: item.seed,
                gradientState: {
                  presetId: item.id,
                  controls: transferVisibleGradientControls(
                    gradient.controls,
                    preset.controls,
                    item.controls,
                  ),
                  orientation: item.orientation,
                  field: item.field,
                  deformation: undefined,
                },
              })
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="lab-look-thumb"
              src={`/look-thumbnails/preset-${item.id}.webp`}
              width={256}
              height={144}
              alt=""
              data-preview-mode="fixed"
            />
            <span className="lab-look-label">{item.label}</span>
          </button>
        ))}
      </div>
      <button type="button" className="ctl-action" onClick={newVariation}>
        New variation
      </button>
      {mode === 'background' ? (
        <SegmentedControl
          label="Meta symbol"
          value={backgroundSymbol.enabled ? 'on' : 'off'}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'on', label: 'On' },
          ]}
          onChange={(value) =>
            updateRecipe({ backgroundSymbol: { enabled: value === 'on' } })}
        />
      ) : null}
      <h2 className="panel-heading">Gradient</h2>
      <Slider
        label="Detail"
        value={structure}
        min={0}
        max={1}
        step={0.01}
        format={pct}
        defaultValue={structureControlValue(preset.controls, preset.controls)}
        onChange={(value) =>
          setTransient({
            gradientState: {
              ...gradient,
              controls: applyStructureControl(
                gradient.controls,
                preset.controls,
                value,
              ),
            },
          })}
        onCommit={commit}
      />
      <Slider
        label="Softness"
        value={gradient.controls.blend}
        min={0}
        max={1}
        step={0.01}
        format={pct}
        defaultValue={preset.controls.blend}
        onChange={(blend) =>
          setTransient({
            gradientState: {
              ...gradient,
              controls: { ...gradient.controls, blend },
            },
          })}
        onCommit={commit}
      />
      <h2 className="panel-heading">Orientation</h2>
      <div className="lab-add-row" role="radiogroup" aria-label="Gradient orientation">
        {[0, 90, 180, 270].map((orientation) => (
          <button
            key={orientation}
            type="button"
            className={gradient.orientation === orientation ? 'lab-chip active' : 'lab-chip'}
            role="radio"
            aria-checked={gradient.orientation === orientation}
            tabIndex={gradient.orientation === orientation ? 0 : -1}
            onKeyDown={handleRadioGroupKeyDown}
            onClick={() =>
              updateRecipe({
                gradientState: {
                  ...gradient,
                  orientation: orientation as 0 | 90 | 180 | 270,
                },
              })}
          >
            {orientation}°
          </button>
        ))}
      </div>
    </div>
  )
}
