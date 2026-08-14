'use client'

import type { ComponentType, SVGProps } from 'react'
import { SelectControl } from 'dialkit'
import { niceLabel } from './label'

export type SegmentedOption<T extends string> = {
  value: T
  label: string
  icon?: ComponentType<SVGProps<SVGSVGElement>>
}

// Short option sets are a segmented row you can hit in one click; long
// ones fall back to DialKit's select. The row is built from the kit's
// own tokens and row metrics, so it sits in the stack as one of theirs.
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
      <div className="ctl-dial">
        <SelectControl
          label={niceLabel(label ?? '')}
          value={value}
          options={options.map((o) => ({ value: o.value, label: niceLabel(o.label) }))}
          onChange={(v) => onChange(v as T)}
        />
      </div>
    )
  }

  return (
    <div className="ctl-dial">
      <div className="dial-row">
        {label ? <span className="dial-row-label">{niceLabel(label)}</span> : null}
        <div className="dial-segments" role="group" aria-label={ariaLabel ?? label}>
          {options.map((o) => {
            const Icon = o.icon
            return (
              <button
                type="button"
                key={o.value}
                className={o.value === value ? 'dial-segment active' : 'dial-segment'}
                aria-pressed={o.value === value}
                aria-label={o.label}
                title={o.label}
                onClick={() => onChange(o.value)}
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
