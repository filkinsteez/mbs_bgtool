'use client'

import { useId, useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import { APPROVED_COLOR_GROUPS } from '@/features/background-generator/palette/registry'
import {
  handleRadioGroupKeyDown,
  handleRovingGridKeyDown,
} from '@/components/controls/radioKeyboard'

type ApprovedColorPickerProps = {
  selected: readonly string[]
  onSelect: (color: string) => void
  action: 'Add' | 'Use'
}

export function ApprovedColorPicker({
  selected,
  onSelect,
  action,
}: ApprovedColorPickerProps) {
  const searchId = useId()
  const [query, setQuery] = useState('')
  const selectedSet = useMemo(
    () => new Set(selected.map((color) => color.toUpperCase())),
    [selected],
  )
  const normalizedQuery = query.trim().replace('#', '').toUpperCase()
  const visibleGroups = APPROVED_COLOR_GROUPS.map((group) => {
    const familyMatches = group.label.toUpperCase().includes(normalizedQuery)
      || group.id.toUpperCase().includes(normalizedQuery)
    return {
      ...group,
      colors: group.colors.filter(
        (color) => !normalizedQuery || familyMatches || color.includes(normalizedQuery),
      ),
    }
  }).filter((group) => group.colors.length > 0)
  const matchCount = visibleGroups.reduce((total, group) => total + group.colors.length, 0)
  const hasVisibleSelection = visibleGroups.some((group) =>
    group.colors.some((color) => selectedSet.has(color.toUpperCase())))
  const firstVisibleColor = visibleGroups[0]?.colors[0]
  const firstAvailableColor = visibleGroups
    .flatMap((group) => group.colors)
    .find((color) => !selectedSet.has(color.toUpperCase()))

  return (
    <div className="lab-approved-picker">
      <div className="lab-approved-filters">
        <label htmlFor={searchId}>Search approved colors</label>
        <input
          id={searchId}
          type="search"
          placeholder="Hex or family"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <output role="status" aria-live="polite">
          {matchCount} {matchCount === 1 ? 'color' : 'colors'}
        </output>
      </div>
      <div
        className="lab-approved-results"
        role={action === 'Use' ? 'radiogroup' : undefined}
        aria-label={action === 'Use' ? 'Approved color' : undefined}
        data-roving-grid={action === 'Add' ? 'true' : undefined}
      >
        {visibleGroups.map((group) => (
          <section key={group.id} aria-labelledby={`approved-${group.id}`}>
            <h3 id={`approved-${group.id}`}>{group.label}</h3>
            <div className="lab-approved-swatches">
              {group.colors.map((color, index) => {
                const active = selectedSet.has(color.toUpperCase())
                return (
                  <button
                    key={`${group.id}-${color}-${index}`}
                    type="button"
                    className={active ? 'lab-approved-swatch active' : 'lab-approved-swatch'}
                    role={action === 'Use' ? 'radio' : undefined}
                    aria-checked={action === 'Use' ? active : undefined}
                    tabIndex={
                      action === 'Use'
                        ? (active || (!hasVisibleSelection && color === firstVisibleColor) ? 0 : -1)
                        : (color === firstAvailableColor ? 0 : -1)
                    }
                    aria-label={
                      action === 'Add' && active
                        ? `Approved color ${color} added`
                        : `${action} approved color ${color}`
                    }
                    disabled={action === 'Add' && active}
                    title={color}
                    style={{ backgroundColor: color }}
                    onClick={(event) => {
                      const grid = event.currentTarget.closest<HTMLElement>('[data-roving-grid]')
                      const available = Array.from(
                        grid?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
                      )
                      const currentIndex = available.indexOf(event.currentTarget)
                      onSelect(color)
                      if (action === 'Add' && currentIndex >= 0) {
                        requestAnimationFrame(() => {
                          const next = Array.from(
                            grid?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
                          )
                          next[Math.min(currentIndex, next.length - 1)]?.focus()
                        })
                      }
                    }}
                    onKeyDown={
                      action === 'Use'
                        ? handleRadioGroupKeyDown
                        : handleRovingGridKeyDown
                    }
                  >
                    {active ? <Check aria-hidden="true" /> : null}
                  </button>
                )
              })}
            </div>
          </section>
        ))}
        {matchCount === 0 ? (
          <div className="panel-note">
            No approved colors match
          </div>
        ) : null}
      </div>
    </div>
  )
}
