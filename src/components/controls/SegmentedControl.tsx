'use client'

import type { ComponentType, SVGProps } from 'react'
import { niceLabel } from './label'
import { handleRadioGroupKeyDown } from './radioKeyboard'

export type SegmentedOption<T extends string> = {
  value: T
  label: string
  icon?: ComponentType<SVGProps<SVGSVGElement>>
}

// Short option sets are a segmented row you can hit in one click; long
// ones use the browser's accessible select.
export function SegmentedControl<T extends string>({
  label,
  ariaLabel,
  value,
  options,
  onChange,
}: {
  label?: string
  ariaLabel?: string
  value: T
  options: SegmentedOption<T>[]
  onChange: (v: T) => void
}) {
  if (options.length > 4) {
    return (
      <label className="ctl-select-row">
        {label ? <span>{niceLabel(label)}</span> : null}
        <select
          aria-label={ariaLabel ?? label}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value as T)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {niceLabel(option.label)}
            </option>
          ))}
        </select>
      </label>
    )
  }

  return (
    <div className="ctl-dial">
      <div className="dial-row">
        {label ? <span className="dial-row-label">{niceLabel(label)}</span> : null}
        <div className="dial-segments" role="radiogroup" aria-label={ariaLabel ?? label}>
          {options.map((o) => {
            const Icon = o.icon
            return (
              <button
                type="button"
                key={o.value}
                className={o.value === value ? 'dial-segment active' : 'dial-segment'}
                role="radio"
                aria-checked={o.value === value}
                aria-label={o.label}
                title={o.label}
                tabIndex={o.value === value ? 0 : -1}
                onClick={() => onChange(o.value)}
                onKeyDown={handleRadioGroupKeyDown}
              >
                {Icon ? <Icon /> : niceLabel(o.label)}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
