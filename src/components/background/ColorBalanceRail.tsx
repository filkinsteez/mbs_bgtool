'use client'

import {
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import {
  paletteBoundaryLimits,
  resolvePaletteMix,
  setPaletteBoundary,
} from '@/features/background-generator/gradientControls'
import { approvedColorName } from '@/features/background-generator/palette/registry'
import { useBackgroundStore } from '@/features/background-generator/store'

const ADJUSTMENT_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowDown',
  'ArrowUp',
  'PageDown',
  'PageUp',
  'Home',
  'End',
])

type ActiveDrag = {
  pointerId: number
  boundaryIndex: number
}

export function ColorBalanceRail() {
  const paletteState = useBackgroundStore((state) => state.recipe.paletteState)
  const beginTransaction = useBackgroundStore((state) => state.beginTransaction)
  const setTransient = useBackgroundStore((state) => state.setTransient)
  const commitTransaction = useBackgroundStore((state) => state.commitTransaction)
  const cancelTransaction = useBackgroundStore((state) => state.cancelTransaction)
  const mix = resolvePaletteMix(paletteState).mix
  const visibleBoundaries = paletteState.boundaries.slice(0, mix.length - 1)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [numberDraft, setNumberDraft] = useState<string | null>(null)
  const dragRef = useRef<ActiveDrag | null>(null)
  const numberId = useId()
  const selected = Math.min(selectedIndex, visibleBoundaries.length - 1)
  const selectedValue = visibleBoundaries[selected]
  const selectedLimits = paletteBoundaryLimits(paletteState, selected)

  const boundaryLabel = (index: number) =>
    `Boundary between ${approvedColorName(mix[index].color)} and ${
      approvedColorName(mix[index + 1].color)
    }`

  const updateBoundary = (index: number, value: number) => {
    const live = useBackgroundStore.getState().recipe.paletteState
    setTransient({ paletteState: setPaletteBoundary(live, index, value) })
  }

  const finishPointer = (
    event: PointerEvent<HTMLDivElement>,
    cancel = false,
  ) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragRef.current = null
    if (cancel) cancelTransaction()
    else commitTransaction()
  }

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      dragRef.current = null
      cancelTransaction()
      return
    }
    if (!ADJUSTMENT_KEYS.has(event.key)) return
    event.preventDefault()
    const live = useBackgroundStore.getState().recipe.paletteState
    const limits = paletteBoundaryLimits(live, index)
    const current = live.boundaries[index]
    const delta = event.key === 'PageDown'
      ? -10
      : event.key === 'PageUp'
        ? 10
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
          ? -1
          : event.key === 'ArrowRight' || event.key === 'ArrowUp'
            ? 1
            : 0
    const next = event.key === 'Home'
      ? limits.min
      : event.key === 'End'
        ? limits.max
        : current + delta
    beginTransaction()
    updateBoundary(index, next)
  }

  return (
    <div className="lab-color-balance" role="group" aria-label="Color balance">
      <div className="lab-subsection-heading">
        <span>Color balance</span>
      </div>
      <div
        className="lab-color-balance-track"
        onPointerDown={(event) => {
          const target = (event.target as HTMLElement)
            .closest<HTMLButtonElement>('[data-color-boundary-index]')
          if (!target) return
          event.preventDefault()
          const bounds = event.currentTarget.getBoundingClientRect()
          const pointerPercent = (event.clientX - bounds.left) / bounds.width * 100
          const nearestIndex = visibleBoundaries.reduce(
            (nearest, value, index) =>
              Math.abs(value - pointerPercent)
                < Math.abs(visibleBoundaries[nearest] - pointerPercent)
                ? index
                : nearest,
            0,
          )
          setSelectedIndex(nearestIndex)
          setNumberDraft(null)
          event.currentTarget
            .querySelector<HTMLButtonElement>(
              `[data-color-boundary-index="${nearestIndex}"]`,
            )
            ?.focus()
          beginTransaction()
          dragRef.current = {
            pointerId: event.pointerId,
            boundaryIndex: nearestIndex,
          }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current
          if (!drag || drag.pointerId !== event.pointerId) return
          event.preventDefault()
          const bounds = event.currentTarget.getBoundingClientRect()
          updateBoundary(
            drag.boundaryIndex,
            (event.clientX - bounds.left) / bounds.width * 100,
          )
        }}
        onPointerUp={(event) => finishPointer(event)}
        onPointerCancel={(event) => finishPointer(event, true)}
      >
        <div className="lab-color-balance-segments" aria-hidden="true">
          {mix.map((entry) => (
            <span
              key={entry.color}
              style={{
                width: `${entry.ratio}%`,
                backgroundColor: entry.color,
              }}
            />
          ))}
        </div>
        {visibleBoundaries.map((value, index) => {
          const limits = paletteBoundaryLimits(paletteState, index)
          return (
            <button
              key={index}
              type="button"
              role="slider"
              className={`lab-color-boundary${selected === index ? ' active' : ''}`}
              data-color-boundary-index={index}
              aria-label={boundaryLabel(index)}
              aria-orientation="horizontal"
              aria-valuemin={limits.min}
              aria-valuemax={limits.max}
              aria-valuenow={value}
              aria-valuetext={`${value} percent; ${
                approvedColorName(mix[index].color)
              } ${mix[index].ratio} percent; ${
                approvedColorName(mix[index + 1].color)
              } ${mix[index + 1].ratio} percent`}
              style={{
                left: `${value}%`,
                '--boundary-color': mix[index + 1].color,
              } as CSSProperties}
              onFocus={() => {
                setSelectedIndex(index)
                setNumberDraft(null)
              }}
              onKeyDown={(event) => handleKeyDown(event, index)}
              onKeyUp={(event) => {
                if (ADJUSTMENT_KEYS.has(event.key)) commitTransaction()
              }}
              onBlur={commitTransaction}
            />
          )
        })}
      </div>
      <div
        className="lab-color-balance-values"
        aria-label="Color shares"
        style={{
          gridTemplateColumns: mix.map((entry) => `${entry.ratio}fr`).join(' '),
        }}
      >
        {mix.map((entry) => (
          <span key={entry.color} title={approvedColorName(entry.color)}>
            {entry.ratio}%
          </span>
        ))}
      </div>
      <div className="lab-color-boundary-editor">
        <label htmlFor={numberId} title={boundaryLabel(selected)}>
          {approvedColorName(mix[selected].color)}
          {' / '}
          {approvedColorName(mix[selected + 1].color)}
        </label>
        <span>
          <input
            id={numberId}
            type="number"
            inputMode="numeric"
            aria-label={boundaryLabel(selected)}
            value={numberDraft ?? selectedValue}
            min={selectedLimits.min}
            max={selectedLimits.max}
            step={1}
            onFocus={() => {
              beginTransaction()
              setNumberDraft(String(selectedValue))
            }}
            onChange={(event) => {
              const raw = event.currentTarget.value
              setNumberDraft(raw)
              if (raw.trim() === '') return
              const next = Number(raw)
              if (Number.isFinite(next)) updateBoundary(selected, next)
            }}
            onBlur={() => {
              if (numberDraft?.trim() === '') cancelTransaction()
              else commitTransaction()
              setNumberDraft(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key !== 'Escape') return
              event.preventDefault()
              cancelTransaction()
              setNumberDraft(null)
              event.currentTarget.blur()
            }}
          />
          <span aria-hidden="true">%</span>
        </span>
      </div>
    </div>
  )
}
