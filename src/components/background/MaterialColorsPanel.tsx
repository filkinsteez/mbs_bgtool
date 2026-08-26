'use client'

import { useState } from 'react'
import { ApprovedColorPicker } from './ApprovedColorPicker'
import { handleRadioGroupKeyDown } from '@/components/controls/radioKeyboard'
import {
  groupColorsByHue,
  type HueGroup,
} from '@/features/background-generator/palette/hue'
import { PALETTE_PACKS } from '@/features/background-generator/palette/registry'
import { useBackgroundStore } from '@/features/background-generator/store'

type ColorRole = 'background' | 'highlight'

const CURATED_COLORS = Array.from(new Set(
  PALETTE_PACKS
    .filter((pack) => pack.tier !== 'extended')
    .flatMap((pack) => [...pack.colors]),
))

const EXTENDED_COLORS = PALETTE_PACKS.find((pack) => pack.tier === 'extended')?.colors ?? []
const CURATED_GROUPS = groupColorsByHue(CURATED_COLORS)

function HueColorGroups({
  groups,
  selected,
  role,
  extended = false,
  onSelect,
}: {
  groups: HueGroup[]
  selected: string
  role: ColorRole
  extended?: boolean
  onSelect: (color: string) => void
}) {
  return (
    <div className={extended ? 'lab-material-hue-groups extended' : 'lab-material-hue-groups'}>
      {groups.map((group) => (
        <section key={group.id} className="lab-material-hue-group">
          <div className="lab-material-hue-label">{group.label}</div>
          <div className="lab-material-swatches" role="group" aria-label={`${group.label} for material ${role}`}>
            {group.colors.map((color, index) => (
              <button
                key={`${group.id}-${color}-${index}`}
                type="button"
                className={selected === color ? 'active' : ''}
                aria-label={`Use ${color} for material ${role}`}
                aria-pressed={selected === color}
                title={color}
                style={{ background: color }}
                onClick={() => onSelect(color)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export function MaterialColorsPanel() {
  const material = useBackgroundStore((state) => state.recipe.material)
  const update = useBackgroundStore((state) => state.updateRecipe)
  const [role, setRole] = useState<ColorRole>('highlight')
  const backgroundColor = material.backgroundColor ?? '#0064E0'
  const highlightColor = material.highlightColor ?? '#FFFFFF'
  const selected = role === 'background'
    ? backgroundColor
    : highlightColor

  const setColor = (color: string) => {
    update({
      material: role === 'background'
        ? { backgroundColor: color }
        : { highlightColor: color },
    })
  }

  return (
    <div className="panel-section">
      <h2 className="panel-heading">Color</h2>
      <div className="lab-material-color-roles" role="radiogroup" aria-label="Material color role">
        <button
          type="button"
          role="radio"
          aria-checked={role === 'background'}
          tabIndex={role === 'background' ? 0 : -1}
          className={role === 'background' ? 'active' : ''}
          onClick={() => setRole('background')}
          onKeyDown={handleRadioGroupKeyDown}
        >
          <span className="lab-material-color-chip" style={{ background: backgroundColor }} />
          <span>Background</span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={role === 'highlight'}
          tabIndex={role === 'highlight' ? 0 : -1}
          className={role === 'highlight' ? 'active' : ''}
          onClick={() => setRole('highlight')}
          onKeyDown={handleRadioGroupKeyDown}
        >
          <span className="lab-material-color-chip" style={{ background: highlightColor }} />
          <span>Highlight</span>
        </button>
      </div>
      <div className="lab-material-color-actions">
        <button
          type="button"
          className="lab-chip"
          onClick={() => update({
            material: {
              backgroundColor: highlightColor,
              highlightColor: backgroundColor,
            },
          })}
        >
          Swap
        </button>
      </div>
      <HueColorGroups
        groups={CURATED_GROUPS}
        selected={selected}
        role={role}
        onSelect={setColor}
      />
      <details>
        <summary>More approved colors ({EXTENDED_COLORS.length})</summary>
        <ApprovedColorPicker
          selected={[selected]}
          action="Use"
          onSelect={setColor}
        />
      </details>
    </div>
  )
}
