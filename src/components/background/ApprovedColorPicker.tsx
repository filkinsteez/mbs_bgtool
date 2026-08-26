'use client'

import { useMemo, useRef, useState } from 'react'
import { groupColorsByHue, type HueGroupId } from '@/features/background-generator/palette/hue'
import { APPROVED_COLOR_GROUPS } from '@/features/background-generator/palette/registry'

type ApprovedColorPickerProps = {
  selected: readonly string[]
  onSelect: (color: string) => void
  action: 'Add' | 'Use'
}

const PAGE_SIZE = 96
const ALL_COLORS = APPROVED_COLOR_GROUPS.flatMap((group) => group.colors)
const HUE_GROUPS = groupColorsByHue(ALL_COLORS)
const HUE_BY_COLOR = new Map(
  HUE_GROUPS.flatMap((group) => group.colors.map((color) => [color, group.id] as const)),
)

export function ApprovedColorPicker({
  selected,
  onSelect,
  action,
}: ApprovedColorPickerProps) {
  const [query, setQuery] = useState('')
  const [source, setSource] = useState('all')
  const [hue, setHue] = useState<'all' | HueGroupId>('all')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const resultsRef = useRef<HTMLDivElement>(null)
  const selectedSet = useMemo(
    () => new Set(selected.map((color) => color.toUpperCase())),
    [selected],
  )
  const normalizedQuery = query.trim().replace('#', '').toUpperCase()
  const matches = APPROVED_COLOR_GROUPS.flatMap((group) =>
    group.colors
      .filter(() => source === 'all' || source === group.id)
      .filter((color) => hue === 'all' || HUE_BY_COLOR.get(color) === hue)
      .filter((color) => !normalizedQuery || color.includes(normalizedQuery))
      .map((color) => ({ color, groupId: group.id, groupLabel: group.label })),
  )
  const visible = matches.slice(0, limit)
  const visibleGroups = APPROVED_COLOR_GROUPS.map((group) => ({
    ...group,
    colors: visible
      .filter((item) => item.groupId === group.id)
      .map((item) => item.color),
  })).filter((group) => group.colors.length > 0)
  const resetLimit = () => setLimit(PAGE_SIZE)

  return (
    <div className="lab-approved-picker">
      <div className="lab-approved-filters">
        <input
          type="search"
          aria-label="Search approved colors"
          placeholder="Search hex"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            resetLimit()
          }}
        />
        <select
          aria-label="Approved color source"
          value={source}
          onChange={(event) => {
            setSource(event.target.value)
            resetLimit()
          }}
        >
          <option value="all">All ramps</option>
          {APPROVED_COLOR_GROUPS.map((group) => (
            <option key={group.id} value={group.id}>{group.label}</option>
          ))}
        </select>
        <select
          aria-label="Approved color hue"
          value={hue}
          onChange={(event) => {
            setHue(event.target.value as 'all' | HueGroupId)
            resetLimit()
          }}
        >
          <option value="all">All hues</option>
          {HUE_GROUPS.map((group) => (
            <option key={group.id} value={group.id}>{group.label}</option>
          ))}
        </select>
      </div>
      <div className="lab-approved-results" ref={resultsRef}>
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
                    aria-label={`${action} approved color ${color}`}
                    aria-pressed={active}
                    title={color}
                    style={{ backgroundColor: color }}
                    onClick={() => onSelect(color)}
                  />
                )
              })}
            </div>
          </section>
        ))}
        {matches.length === 0 ? (
          <div className="panel-note" role="status" aria-live="polite">
            No approved colors match
          </div>
        ) : null}
      </div>
      {limit < matches.length ? (
        <button
          type="button"
          className="lab-chip"
          onClick={() => {
            const firstNewIndex = visible.length
            setLimit((current) => current + PAGE_SIZE)
            requestAnimationFrame(() => {
              resultsRef.current
                ?.querySelectorAll<HTMLButtonElement>('.lab-approved-swatch')
                [firstNewIndex]
                ?.focus()
            })
          }}
        >
          Show more
        </button>
      ) : null}
    </div>
  )
}
