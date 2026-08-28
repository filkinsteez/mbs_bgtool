'use client'

import { useState } from 'react'
import { Slider } from '@/components/controls/Slider'
import { handleRadioGroupKeyDown } from '@/components/controls/radioKeyboard'
import { ApprovedColorPicker } from '@/components/background/ApprovedColorPicker'
import { ApprovedColorPopover } from '@/components/background/ApprovedColorPopover'
import { ArrowLeftRight, Plus, X } from 'lucide-react'
import {
  addColorToMix,
  colorMixForPack,
  CUSTOM_PALETTE_ID,
  PALETTE_PACKS,
} from '@/features/background-generator/palette/registry'
import { useBackgroundStore } from '@/features/background-generator/store'

const pct = (v: number) => `${Math.round(v)}`
type ColorPickerTarget =
  | { kind: 'ground' | 'ink'; anchor: HTMLButtonElement }
  | { kind: 'mix'; index: number; anchor: HTMLButtonElement }

// Stored values are weights. Rendering normalizes them without rewriting
// what the user entered; zero is the off state.
export function ColorsPanel() {
  const [colorPicker, setColorPicker] = useState<ColorPickerTarget | null>(null)
  const mode = useBackgroundStore((state) => state.mode)
  const palette = useBackgroundStore((state) => state.recipe.palette)
  const updateRecipe = useBackgroundStore((state) => state.updateRecipe)
  const setTransient = useBackgroundStore((state) => state.setTransient)
  const commitTransaction = useBackgroundStore((state) => state.commitTransaction)
  const packOptions = PALETTE_PACKS.filter((pack) => pack.tier !== 'extended')
  const customActive = palette.packId === CUSTOM_PALETTE_ID
  const mix = palette.mix
  const mixRows = mix
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => customActive || item.enabled)

  const setPack = (packId: string) => {
    if (palette.packId === packId) return
    const nextPack = PALETTE_PACKS.find((p) => p.id === packId) ?? PALETTE_PACKS[0]
    const nextMix = colorMixForPack(nextPack)
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
    const currentMix = customActive ? mix : mix.filter((item) => item.enabled)
    updateRecipe({
      palette: {
        packId: CUSTOM_PALETTE_ID,
        mix: addColorToMix(currentMix, color),
      },
    })
  }

  const replaceMixColor = (index: number, color: string) => {
    const current = mix[index]
    if (!current || current.color.toUpperCase() === color.toUpperCase()) return
    const next = mix.map((item) => ({ ...item }))
    const duplicateIndex = next.findIndex(
      (item, itemIndex) => itemIndex !== index && item.color.toUpperCase() === color.toUpperCase(),
    )
    if (duplicateIndex >= 0) {
      next[duplicateIndex] = {
        ...next[duplicateIndex],
        enabled: next[duplicateIndex].enabled || current.enabled,
        ratio: next[duplicateIndex].ratio + current.ratio,
      }
      next.splice(index, 1)
    } else {
      next[index] = { ...current, color }
    }
    updateRecipe({
      palette: {
        packId: CUSTOM_PALETTE_ID,
        mix: next,
        ink: palette.ink === current.color ? color : palette.ink,
        ground: palette.ground === current.color ? color : palette.ground,
      },
    })
  }

  const setMixWeight = (index: number, ratio: number) => {
    const updated = [...mix]
    updated[index] = { ...updated[index], enabled: ratio > 0, ratio }
    const next = customActive
      ? updated
      : updated.filter((item, itemIndex) => item.enabled || itemIndex === index)
    const enabled = next.filter((item) => item.enabled)
    const disabledColor = ratio <= 0 ? updated[index].color : null
    setTransient({
      palette: {
        packId: CUSTOM_PALETTE_ID,
        mix: next,
        ink: disabledColor === palette.ink
          ? (enabled[0]?.color ?? palette.ink)
          : palette.ink,
        ground: disabledColor === palette.ground
          ? (enabled.at(-1)?.color ?? palette.ground)
          : palette.ground,
      },
    })
  }

  const removeMixColor = (index: number) => {
    const removed = mix[index]
    if (!removed) return
    const next = mix
      .filter((item, itemIndex) =>
        itemIndex !== index && (customActive || item.enabled))
      .map((item) => ({ ...item }))
    if (!next.length) return
    const enabled = next.filter((item) => item.enabled && item.ratio > 0)
    updateRecipe({
      palette: {
        packId: CUSTOM_PALETTE_ID,
        mix: next,
        ink: palette.ink === removed.color
          ? (enabled[0]?.color ?? next[0].color)
          : palette.ink,
        ground: palette.ground === removed.color
          ? (enabled.at(-1)?.color ?? next.at(-1)!.color)
          : palette.ground,
      },
    })
  }

  return (
    <div className="panel-section">
      <h2 className="panel-heading">{mode === 'material' ? 'Look palette' : 'Colors'}</h2>
      <div className="lab-subsection-heading">
        <span>Palette</span>
        {customActive ? <span className="lab-status-badge">Custom mix</span> : null}
      </div>
      <div className="lab-palette-presets" role="radiogroup" aria-label="Apply a color palette">
        {packOptions.map((p, index) => (
          <button
            key={p.id}
            type="button"
            className={palette.packId === p.id ? 'lab-palette-preset active' : 'lab-palette-preset'}
            role="radio"
            aria-checked={palette.packId === p.id}
            tabIndex={palette.packId === p.id || (customActive && index === 0) ? 0 : -1}
            onClick={() => setPack(p.id)}
            onKeyDown={handleRadioGroupKeyDown}
          >
            <span>{p.label}</span>
            <span className="lab-palette-preset-colors" aria-hidden="true">
              {colorMixForPack(p).filter((item) => item.enabled).map((item, index) => (
                <span
                  key={`${p.id}-${item.color}-${index}`}
                  style={{
                    backgroundColor: item.color,
                    flexBasis: `${item.ratio}%`,
                  }}
                />
              ))}
            </span>
          </button>
        ))}
      </div>
      {mode === 'material' ? (
        <>
          <div className="lab-subsection-heading">Roles</div>
          <div className="lab-palette-roles" role="group" aria-label="Palette roles">
            <button
              type="button"
              className="lab-palette-role"
              aria-label={`Change background color, currently ${palette.ground}`}
              aria-haspopup="dialog"
              aria-expanded={colorPicker?.kind === 'ground'}
              onClick={(event) => setColorPicker({
                kind: 'ground',
                anchor: event.currentTarget,
              })}
            >
              <span className="lab-role-swatch" style={{ backgroundColor: palette.ground }} />
              <span>Background</span>
            </button>
            <button
              type="button"
              className="lab-icon-button"
              aria-label="Swap background and marks colors"
              title="Swap colors"
              onClick={() => updateRecipe({
                palette: {
                  packId: CUSTOM_PALETTE_ID,
                  ground: palette.ink,
                  ink: palette.ground,
                },
              })}
            >
              <ArrowLeftRight aria-hidden="true" />
            </button>
            <button
              type="button"
              className="lab-palette-role"
              aria-label={`Change marks color, currently ${palette.ink}`}
              aria-haspopup="dialog"
              aria-expanded={colorPicker?.kind === 'ink'}
              onClick={(event) => setColorPicker({
                kind: 'ink',
                anchor: event.currentTarget,
              })}
            >
              <span className="lab-role-swatch" style={{ backgroundColor: palette.ink }} />
              <span>Marks</span>
            </button>
          </div>
        </>
      ) : null}
      <div className="lab-subsection-heading">
        <span>Mix</span>
        <span className="lab-subsection-meta">Relative weight</span>
      </div>
      {mixRows.map(({ item: m, index: i }) => (
        <div
          key={`mix-${i}`}
          className={m.enabled ? 'lab-zone-row' : 'lab-zone-row disabled'}
        >
          <button
            type="button"
            className="lab-color-preview"
            aria-label={`Change mix color ${m.color}`}
            aria-haspopup="dialog"
            aria-expanded={colorPicker?.kind === 'mix' && colorPicker.index === i}
            title={m.color}
            style={{ backgroundColor: m.color }}
            onClick={(event) => setColorPicker({
              kind: 'mix',
              index: i,
              anchor: event.currentTarget,
            })}
          />
          <Slider
            label=""
            ariaLabel={`${m.color} weight`}
            value={m.enabled ? m.ratio : 0}
            min={0}
            max={100}
            step={1}
            format={pct}
            defaultValue={50}
            editableValue
            onChange={(ratio) => setMixWeight(i, ratio)}
            onCommit={commitTransientMix}
          />
          <button
            type="button"
            className="lab-icon-button lab-mix-remove"
            aria-label={`Remove ${m.color} from mix`}
            title="Remove color"
            disabled={mixRows.length <= 1}
            onClick={() => removeMixColor(i)}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      ))}
      <details className="lab-color-library">
        <summary>
          <Plus aria-hidden="true" />
          Add color
          <span>{PALETTE_PACKS.at(-1)?.colors.length ?? 0}</span>
        </summary>
        <ApprovedColorPicker
          selected={mix.filter((item) => item.enabled).map((item) => item.color)}
          action="Add"
          onSelect={addApprovedColor}
        />
      </details>
      {colorPicker ? (
        <ApprovedColorPopover
          anchor={colorPicker.anchor}
          title={
            colorPicker.kind === 'ground'
              ? 'Background color'
              : colorPicker.kind === 'ink'
                ? 'Marks color'
                : 'Mix color'
          }
          selectedColor={
            'index' in colorPicker
              ? (mix[colorPicker.index]?.color ?? palette.ink)
              : colorPicker.kind === 'ground'
              ? palette.ground
              : palette.ink
          }
          onSelect={(color) => {
            if ('index' in colorPicker) {
              replaceMixColor(colorPicker.index, color)
              return
            }
            updateRecipe({
              palette: {
                packId: CUSTOM_PALETTE_ID,
                [colorPicker.kind]: color,
              },
            })
          }}
          onClose={() => setColorPicker(null)}
        />
      ) : null}
    </div>
  )
}
