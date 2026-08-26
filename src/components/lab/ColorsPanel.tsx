'use client'

import { Slider } from '@/components/controls/Slider'
import {
  addColorToMix,
  CUSTOM_PALETTE_ID,
  normalizeColorRatios,
  PALETTE_PACKS,
  type ColorMix,
} from '@/features/background-generator/palette/registry'
import { useBackgroundStore } from '@/features/background-generator/store'

const pct = (v: number) => `${Math.round(v)}`

// Color for the simplified generator: approved packs + explicit color
// ratios. Ratios are normalized to 100 and then expanded into a weighted
// palette consumed by the render engine.
export function ColorsPanel() {
  const palette = useBackgroundStore((state) => state.recipe.palette)
  const updateRecipe = useBackgroundStore((state) => state.updateRecipe)
  const setTransient = useBackgroundStore((state) => state.setTransient)
  const commitTransaction = useBackgroundStore((state) => state.commitTransaction)
  const activePack = PALETTE_PACKS.find((pack) => pack.id === palette.packId)
  const mix = palette.mix

  const setPack = (packId: string) => {
    const nextPack = PALETTE_PACKS.find((p) => p.id === packId) ?? PALETTE_PACKS[0]
    const nextMix = nextPack.colors.map((color, i) => ({
      color,
      ratio: i === 0 ? 70 : Math.round(30 / Math.max(1, nextPack.colors.length - 1)),
      enabled: i < Math.min(4, nextPack.colors.length),
    }))
    const normalized = normalizeColorRatios(
      nextMix.map((m) => m.ratio),
      nextMix.map((m) => m.enabled),
    )
    const remixed = nextMix.map((m, i) => ({ ...m, ratio: normalized[i] }))
    updateRecipe({ palette: { packId: nextPack.id, mix: remixed } })
  }

  const commitMix = (nextMix: ColorMix[]) => {
    const normalized = normalizeColorRatios(
      nextMix.map((m) => m.ratio),
      nextMix.map((m) => m.enabled),
    )
    const remixed = nextMix.map((m, i) => ({ ...m, ratio: normalized[i] }))
    updateRecipe({ palette: { packId: CUSTOM_PALETTE_ID, mix: remixed } })
  }

  const commitTransientMix = () => {
    const current = useBackgroundStore.getState().recipe.palette.mix
    const normalized = normalizeColorRatios(
      current.map((item) => item.ratio),
      current.map((item) => item.enabled),
    )
    setTransient({
      palette: {
        packId: CUSTOM_PALETTE_ID,
        mix: current.map((item, index) => ({ ...item, ratio: normalized[index] })),
      },
    })
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
      <div className="panel-heading">Color</div>
      <div className="panel-note">Primary and secondary approved color packs.</div>
      <div className="lab-add-row">
        {PALETTE_PACKS.filter((pack) => pack.tier !== 'extended').map((p) => (
          <button
            key={p.id}
            className={activePack?.id === p.id ? 'lab-chip active' : 'lab-chip'}
            onClick={() => setPack(p.id)}
          >
            {p.label}
          </button>
        ))}
        {!activePack ? <span className="lab-chip active">Custom</span> : null}
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
              value={m.enabled ? m.ratio : 0}
              min={0}
              max={100}
              step={1}
              format={pct}
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
            aria-label={`${m.color} percentage`}
            type="number"
            min={0}
            max={100}
            value={Math.round(m.enabled ? m.ratio : 0)}
            onChange={(event) => {
              const next = [...mix]
              const ratio = Number(event.target.value)
              next[i] = { ...next[i], enabled: ratio > 0, ratio }
              commitMix(next)
            }}
          />
        </div>
      ))}
      <details>
        <summary>More approved colors ({PALETTE_PACKS.at(-1)?.colors.length ?? 0})</summary>
        <div className="lab-approved-swatches">
          {PALETTE_PACKS.at(-1)?.colors.map((color, index) => (
            <button
              key={`${color}-${index}`}
              className={
                mix.some(
                  (item) => item.enabled && item.color.toUpperCase() === color.toUpperCase(),
                )
                  ? 'lab-approved-swatch active'
                  : 'lab-approved-swatch'
              }
              aria-label={`Add approved color ${color} to mix`}
              aria-pressed={mix.some(
                (item) => item.enabled && item.color.toUpperCase() === color.toUpperCase(),
              )}
              title={color}
              style={{ background: color }}
              onClick={() => addApprovedColor(color)}
            />
          ))}
        </div>
      </details>
    </div>
  )
}
