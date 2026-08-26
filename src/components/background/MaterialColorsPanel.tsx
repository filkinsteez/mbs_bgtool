'use client'

import { useId, useState } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import { ApprovedColorPopover } from './ApprovedColorPopover'
import { handleRadioGroupKeyDown } from '@/components/controls/radioKeyboard'
import {
  META_BLUE,
} from '@/features/background-generator/palette/registry'
import { useBackgroundStore } from '@/features/background-generator/store'

type ColorRole = 'background' | 'highlight'

const QUICK_COLORS = [
  META_BLUE,
  '#0288F9',
  '#132682',
  '#26C8EE',
  '#1CC5EE',
  '#86E59F',
  '#FED61F',
  '#FF5001',
  '#D6E7EE',
  '#7CA0B8',
  '#AE4FC3',
  '#824DFF',
  '#FFFFFF',
  '#000000',
] as const

export function MaterialColorsPanel() {
  const backgroundDescriptionId = useId()
  const highlightDescriptionId = useId()
  const material = useBackgroundStore((state) => state.recipe.material)
  const update = useBackgroundStore((state) => state.updateRecipe)
  const [role, setRole] = useState<ColorRole>('highlight')
  const [colorPickerAnchor, setColorPickerAnchor] = useState<HTMLButtonElement | null>(null)
  const backgroundColor = material.backgroundColor ?? '#0064E0'
  const highlightColor = material.highlightColor ?? '#FFFFFF'
  const selected = role === 'background'
    ? backgroundColor
    : highlightColor
  const selectedInQuick = QUICK_COLORS.some((color) => color === selected)

  const setColor = (color: string) => {
    update({
      material: role === 'background'
        ? { backgroundColor: color }
        : { highlightColor: color },
    })
  }

  return (
    <div className="panel-section">
      <h2 className="panel-heading">Colors</h2>
      <div className="lab-material-role-row">
        <div className="lab-material-color-roles" role="group" aria-label="Material color role">
          <span id={backgroundDescriptionId} className="lab-visually-hidden">
            Current color {backgroundColor}
          </span>
          <span id={highlightDescriptionId} className="lab-visually-hidden">
            Current color {highlightColor}
          </span>
          <button
            type="button"
            aria-pressed={role === 'background'}
            aria-describedby={backgroundDescriptionId}
            aria-haspopup="dialog"
            aria-expanded={role === 'background' && colorPickerAnchor !== null}
            className={role === 'background' ? 'active' : ''}
            onClick={(event) => {
              setRole('background')
              setColorPickerAnchor(event.currentTarget)
            }}
          >
            <span className="lab-material-color-chip" style={{ background: backgroundColor }} />
            <span>Background</span>
          </button>
          <button
            type="button"
            aria-pressed={role === 'highlight'}
            aria-describedby={highlightDescriptionId}
            aria-haspopup="dialog"
            aria-expanded={role === 'highlight' && colorPickerAnchor !== null}
            className={role === 'highlight' ? 'active' : ''}
            onClick={(event) => {
              setRole('highlight')
              setColorPickerAnchor(event.currentTarget)
            }}
          >
            <span className="lab-material-color-chip" style={{ background: highlightColor }} />
            <span>Highlight</span>
          </button>
        </div>
        <button
          type="button"
          className="lab-icon-button"
          aria-label="Swap background and highlight colors"
          title="Swap colors"
          onClick={() => update({
            material: {
              backgroundColor: highlightColor,
              highlightColor: backgroundColor,
            },
          })}
        >
          <ArrowLeftRight aria-hidden="true" />
        </button>
      </div>
      <div className="lab-subsection-heading">Quick colors</div>
      <div
        className="lab-material-quick-colors"
        role="radiogroup"
        aria-label={`Choose a quick color for ${role}`}
      >
        {QUICK_COLORS.map((color, index) => (
          <button
            key={`${color}-${index}`}
            type="button"
            role="radio"
            aria-checked={selected === color}
            tabIndex={selected === color || (!selectedInQuick && index === 0) ? 0 : -1}
            className={selected === color ? 'active' : ''}
            aria-label={`Use ${color} for material ${role}`}
            title={color}
            style={{ backgroundColor: color }}
            onClick={() => setColor(color)}
            onKeyDown={handleRadioGroupKeyDown}
          />
        ))}
      </div>
      {colorPickerAnchor ? (
        <ApprovedColorPopover
          anchor={colorPickerAnchor}
          title={`Material ${role} color`}
          selectedColor={selected}
          onSelect={setColor}
          onClose={() => setColorPickerAnchor(null)}
        />
      ) : null}
    </div>
  )
}
