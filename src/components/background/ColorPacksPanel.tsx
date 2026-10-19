'use client'

import { handleRadioGroupKeyDown } from '@/components/controls/radioKeyboard'
import {
  ELEMENTAL_ACCENTS,
  PRODUCTION_COLOR_PACKS,
} from '@/features/background-generator/curatedPresets'
import { useBackgroundStore } from '@/features/background-generator/store'
import { ColorBalanceRail } from './ColorBalanceRail'

export function ColorPacksPanel() {
  const paletteState = useBackgroundStore((state) => state.recipe.paletteState)
  const updateRecipe = useBackgroundStore((state) => state.updateRecipe)

  return (
    <div className="panel-section">
      <h2 className="panel-heading">Color Packs</h2>
      <div className="lab-palette-presets" role="radiogroup" aria-label="Color Packs">
        {PRODUCTION_COLOR_PACKS.map((pack) => {
          const colors = pack.id === 'elemental'
            ? [pack.colors[0], paletteState.elementalAccent]
            : pack.colors
          return (
            <button
              key={pack.id}
              type="button"
              role="radio"
              aria-checked={paletteState.packId === pack.id}
              tabIndex={paletteState.packId === pack.id ? 0 : -1}
              className={paletteState.packId === pack.id ? 'lab-palette-preset active' : 'lab-palette-preset'}
              onKeyDown={handleRadioGroupKeyDown}
              onClick={() =>
                updateRecipe({
                  paletteState: {
                    ...paletteState,
                    packId: pack.id,
                  },
                })}
            >
              <span>{pack.label}</span>
              <span className="lab-palette-preset-colors" aria-hidden="true">
                {colors.map((color) => (
                  <span
                    key={`${pack.id}-${color}`}
                    style={{
                      backgroundColor: color,
                      flexBasis: `${100 / colors.length}%`,
                    }}
                  />
                ))}
              </span>
            </button>
          )
        })}
      </div>
      {paletteState.packId === 'elemental' ? (
        <div className="lab-material-quick-colors" role="radiogroup" aria-label="Elemental accent">
          {ELEMENTAL_ACCENTS.map((accent) => (
            <button
              key={accent}
              type="button"
              role="radio"
              aria-checked={paletteState.elementalAccent === accent}
              tabIndex={paletteState.elementalAccent === accent ? 0 : -1}
              className={paletteState.elementalAccent === accent ? 'active' : ''}
              title={accent}
              aria-label={`Use ${accent}`}
              style={{ backgroundColor: accent }}
              onClick={() =>
                updateRecipe({
                  paletteState: {
                    ...paletteState,
                    elementalAccent: accent,
                  },
                })}
            />
          ))}
        </div>
      ) : null}
      <ColorBalanceRail />
    </div>
  )
}
