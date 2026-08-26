'use client'

import { useId } from 'react'
import { niceLabel } from './label'
import { useCommitOnRelease } from './useCommitOnRelease'

export type SliderProps = {
  label: string
  value: number
  min: number
  max: number
  step?: number
  format?: (v: number) => string
  defaultValue?: number
  unit?: string
  ariaLabel?: string
  disabled?: boolean
  onChange: (v: number) => void
  // fires once at the end of a drag / key adjustment — the store commits
  // one history entry there instead of one per pixel of drag
  onCommit?: () => void
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  defaultValue,
  unit,
  ariaLabel,
  disabled = false,
  onChange,
  onCommit,
}: SliderProps) {
  const id = useId()
  const { touch, commitNow } = useCommitOnRelease(onCommit)

  const isPct = !!format && format(1) === '100'
  const isDeg = !!format && format(Math.PI).startsWith('180')
  const k = isPct ? 100 : isDeg ? 180 / Math.PI : 1
  const suffix = unit ?? (isPct ? '%' : isDeg ? '°' : undefined)
  const scaledStep = step ? Math.max(Math.round(step * k * 1000) / 1000, 0.001) : undefined
  const scaledValue = Math.round(value * k * 1000) / 1000
  const scaledMin = Math.round(min * k * 1000) / 1000
  const scaledMax = Math.round(max * k * 1000) / 1000
  const visibleLabel = niceLabel(label)
  const accessibleLabel = ariaLabel ?? (visibleLabel || 'Value')
  const valueText = suffix
    ? `${scaledValue}${suffix}`
    : format
      ? format(value)
      : String(scaledValue)

  return (
    <div
      className={visibleLabel ? 'ctl-slider' : 'ctl-slider no-label'}
      onDoubleClick={() => {
        if (disabled || defaultValue === undefined) return
        onChange(defaultValue)
        commitNow()
      }}
    >
      {visibleLabel ? <label htmlFor={id}>{visibleLabel}</label> : null}
      <div className="ctl-slider-control">
        <input
          id={id}
          type="range"
          disabled={disabled}
          aria-label={visibleLabel ? undefined : accessibleLabel}
          aria-keyshortcuts={defaultValue === undefined ? undefined : 'R'}
          aria-valuetext={valueText}
          title={defaultValue === undefined ? undefined : 'Double-click or press R to reset'}
          value={scaledValue}
          min={scaledMin}
          max={scaledMax}
          step={k === 1 ? step : (scaledStep ?? 1)}
          onChange={(event) => {
            const next = Number(event.currentTarget.value)
            if (!Number.isFinite(next)) return
            touch()
            onChange(k === 1 ? next : next / k)
          }}
          onKeyDown={(event) => {
            if (
              disabled
              || defaultValue === undefined
              || event.key.toLowerCase() !== 'r'
              || event.ctrlKey
              || event.metaKey
              || event.altKey
            ) return
            event.preventDefault()
            onChange(defaultValue)
            commitNow()
          }}
          onBlur={commitNow}
        />
        <output htmlFor={id}>{valueText}</output>
      </div>
    </div>
  )
}
