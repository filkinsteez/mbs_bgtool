'use client'

import { Slider } from '@/components/controls/Slider'
import { handleRadioGroupKeyDown } from '@/components/controls/radioKeyboard'
import { useCommitOnRelease } from '@/components/controls/useCommitOnRelease'
import { ApprovedColorPicker } from '@/components/background/ApprovedColorPicker'
import {
  addColorToMix,
  CUSTOM_PALETTE_ID,
  PALETTE_PACKS,
} from '@/features/background-generator/palette/registry'
import { useBackgroundStore } from '@/features/background-generator/store'

const pct = (v: number) => `${Math.round(v)}`

// Stored values are weights. Rendering normalizes them without rewriting
// what the user entered; zero is the off state.
export function ColorsPanel() {
  const palette = useBackgroundStore((state) => state.recipe.palette)
  const updateRecipe = useBackgroundStore((state) => state.updateRecipe)
  const setTransient = useBackgroundStore((state) => state.setTransient)
  const commitTransaction = useBackgroundStore((state) => state.commitTransaction)
  const activePack = PALETTE_PACKS.find((pack) => pack.id === palette.packId)
  const packOptions = PALETTE_PACKS.filter((pack) => pack.tier !== 'extended')
  const activeVisiblePack = packOptions.find((pack) => pack.id === palette.packId)
  const mix = palette.mix
  const {
    touch: touchNumericMix,
    commitNow: commitNumericMix,
  } = useCommitOnRelease(commitTransaction)

  const setPack = (packId: string) => {
    const nextPack = PALETTE_PACKS.find((p) => p.id === packId) ?? PALETTE_PACKS[0]
    const nextMix = nextPack.colors.map((color, i) => ({
      color,
      ratio: i === 0 ? 70 : Math.round(30 / Math.max(1, nextPack.colors.length - 1)),
      enabled: i < Math.min(4, nextPack.colors.length),
    }))
    const enabled = nextMix.filter((item) => item.enabled)
    updateRecipe({
      palette: {
        packId: nextPack.id,
        mix: nextMix,
        ink: enabled[0]?.color ?? nextPack.colors[0],
        ground: enabled.at(-1)?.color ?? nextPack.colors[0],
      },
    })
  }

  const commitTransientMix = () => {
    commitTransaction()
  }

  const addApprovedColor = (color: string) => {
    updateRecipe({
      palette: {
        packId: CUSTOM_PALETTE_ID,
        mix: addColorToMix(mix, color),
      },
    })
  }

  return (
    <div className="panel-section">
      <h2 className="panel-heading">Color</h2>
      <div className="lab-add-row" role="radiogroup" aria-label="Color pack">
        {packOptions.map((p) => (
          <button
            key={p.id}
            className={activePack?.id === p.id ? 'lab-chip active' : 'lab-chip'}
            role="radio"
            aria-checked={activePack?.id === p.id}
            tabIndex={activeVisiblePack?.id === p.id ? 0 : -1}
            onClick={() => setPack(p.id)}
            onKeyDown={handleRadioGroupKeyDown}
          >
            {p.label}
          </button>
        ))}
        {!activeVisiblePack ? (
          <button
            type="button"
            className="lab-chip active"
            role="radio"
            aria-checked
            tabIndex={0}
            onKeyDown={handleRadioGroupKeyDown}
          >
            Custom
          </button>
        ) : null}
      </div>
      <div className="lab-palette-roles" aria-label="Palette roles">
        <span>Ground</span>
        <span
          className="lab-role-swatch"
          role="img"
          aria-label={`Ground ${palette.ground}`}
          style={{ backgroundColor: palette.ground }}
        />
        <span>Ink</span>
        <span
          className="lab-role-swatch"
          role="img"
          aria-label={`Ink ${palette.ink}`}
          style={{ backgroundColor: palette.ink }}
        />
        <button
          type="button"
          className="lab-chip"
          onClick={() => updateRecipe({
            palette: {
              ground: palette.ink,
              ink: palette.ground,
            },
          })}
        >
          Swap
        </button>
      </div>
      {mix.map((m, i) => (
        <div key={`${m.color}-${i}`} className="lab-zone-row">
          <span
            className="lab-color-preview"
            role="img"
            aria-label={`Color ${m.color}`}
            title={m.color}
            style={{ backgroundColor: m.color }}
          />
          <div style={{ flex: 1 }}>
            <Slider
              label=""
              ariaLabel={`${m.color} weight`}
              value={m.enabled ? m.ratio : 0}
              min={0}
              max={100}
              step={1}
              format={pct}
              defaultValue={50}
              onChange={(ratio) => {
                const next = [...mix]
                next[i] = { ...next[i], enabled: ratio > 0, ratio }
                setTransient({ palette: { packId: CUSTOM_PALETTE_ID, mix: next } })
              }}
              onCommit={commitTransientMix}
            />
          </div>
          <input
            className="lab-dim-input"
            aria-label={`${m.color} weight`}
            type="number"
            min={0}
            max={100}
            value={Math.round(m.enabled ? m.ratio : 0)}
            onChange={(event) => {
              touchNumericMix()
              const next = [...mix]
              const ratio = Math.max(0, Math.min(100, Number(event.target.value)))
              next[i] = { ...next[i], enabled: ratio > 0, ratio }
              setTransient({ palette: { packId: CUSTOM_PALETTE_ID, mix: next } })
            }}
            onBlur={commitNumericMix}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
          />
        </div>
      ))}
      <details>
        <summary>More approved colors ({PALETTE_PACKS.at(-1)?.colors.length ?? 0})</summary>
        <ApprovedColorPicker
          selected={mix.filter((item) => item.enabled).map((item) => item.color)}
          action="Add"
          onSelect={addApprovedColor}
        />
      </details>
    </div>
  )
}
