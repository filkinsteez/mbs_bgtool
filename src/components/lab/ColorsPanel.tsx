'use client'

import { Slider } from '@/components/controls/Slider'
import {
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
  const activePack = PALETTE_PACKS.find((pack) => pack.id === palette.packId) ?? PALETTE_PACKS[0]
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
    updateRecipe({ palette: { mix: remixed } })
  }

  const commitTransientMix = () => {
    const current = useBackgroundStore.getState().recipe.palette.mix
    const normalized = normalizeColorRatios(
      current.map((item) => item.ratio),
      current.map((item) => item.enabled),
    )
    setTransient({
      palette: {
        mix: current.map((item, index) => ({ ...item, ratio: normalized[index] })),
      },
    })
    commitTransaction()
  }

  return (
    <div className="panel-section">
      <div className="panel-heading">Color</div>
      <div className="panel-note">Primary and secondary approved color packs.</div>
      <div className="lab-add-row">
        {PALETTE_PACKS.filter((pack) => pack.tier !== 'extended').map((p) => (
          <button
            key={p.id}
            className={activePack.id === p.id ? 'lab-chip active' : 'lab-chip'}
            onClick={() => setPack(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
      {mix.map((m, i) => (
        <div key={`${m.color}-${i}`} className="lab-zone-row">
          <button
            className={m.enabled ? 'lab-chip active' : 'lab-chip'}
            onClick={() => {
              const next = [...mix]
              next[i] = { ...next[i], enabled: !next[i].enabled }
              commitMix(next)
            }}
          >
            {m.enabled ? 'On' : 'Off'}
          </button>
          <span className="lab-zone-label">{m.color}</span>
          <div style={{ flex: 1 }}>
            <Slider
              label=""
              value={m.ratio}
              min={0}
              max={100}
              step={1}
              format={pct}
              onChange={(ratio) => {
                const next = [...mix]
                next[i] = { ...next[i], ratio }
                setTransient({ palette: { mix: next } })
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
            value={Math.round(m.ratio)}
            onChange={(event) => {
              const next = [...mix]
              next[i] = { ...next[i], ratio: Number(event.target.value) }
              commitMix(next)
            }}
          />
        </div>
      ))}
      <div className="panel-note">Ratios normalize to 100% across enabled colors.</div>
      <details>
        <summary>More approved colors ({PALETTE_PACKS.at(-1)?.colors.length ?? 0})</summary>
        <div className="lab-approved-swatches">
          {PALETTE_PACKS.at(-1)?.colors.map((color, index) => (
            <button
              key={`${color}-${index}`}
              className="lab-approved-swatch"
              aria-label={`Use approved color ${color}`}
              title={color}
              style={{ background: color }}
              onClick={() =>
                updateRecipe({
                  palette: {
                    packId: 'extended-approved',
                    mix: [{ color, enabled: true, ratio: 100 }],
                  },
                })
              }
            />
          ))}
        </div>
      </details>
    </div>
  )
}
