import { useState, type ChangeEvent } from 'react'
import { isHex, normalizeHex } from '@/light/color/srgb'
import { RECIPE_LIST } from '@/light/recipes'
import type { ParamSpec, ParamValue, RecipeId } from '@/light/scene'
import styles from './lab.module.css'

export interface Option<T extends string> {
  value: T
  label: string
}

export const RECIPE_OPTIONS: readonly Option<RecipeId>[] = RECIPE_LIST.map((recipe) => ({ value: recipe.id, label: recipe.id }))

const AXES = ['x', 'y', 'z', 'w']
const FULL_HEX = /^#?[0-9a-f]{6}$/i

function finiteValue(event: ChangeEvent<HTMLInputElement>): number | null {
  const value = event.target.valueAsNumber
  return Number.isFinite(value) ? value : null
}

interface NumberRowProps {
  label: string
  min: number
  max: number
  step: number
  value: number
  onChange: (value: number) => void
}

export function NumberRow({ label, min, max, step, value, onChange }: NumberRowProps) {
  const change = (event: ChangeEvent<HTMLInputElement>) => {
    const next = finiteValue(event)
    if (next !== null) onChange(next)
  }
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <input className={styles.range} type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={change} />
      <input className={styles.number} type="number" aria-label={label} min={min} max={max} step={step} value={value} onChange={change} />
    </div>
  )
}

export function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      <input className={styles.check} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  )
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className={styles.toggle}>
      <input className={styles.check} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  )
}

export function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft !== null && isHex(draft)) onChange(normalizeHex(draft))
    setDraft(null)
  }
  return (
    <div className={styles.colorRow}>
      <span className={styles.label}>{label}</span>
      <input
        className={styles.swatch}
        type="color"
        aria-label={label}
        value={value.toLowerCase()}
        onChange={(event) => onChange(normalizeHex(event.target.value))}
      />
      <input
        className={styles.text}
        type="text"
        aria-label={`${label} hex`}
        spellCheck={false}
        value={draft ?? value}
        onChange={(event) => {
          setDraft(event.target.value)
          if (FULL_HEX.test(event.target.value.trim())) onChange(normalizeHex(event.target.value))
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
    </div>
  )
}

interface SelectRowProps<T extends string> {
  label: string
  value: T
  options: readonly Option<T>[]
  onChange: (value: T) => void
}

export function SelectRow<T extends string>({ label, value, options, onChange }: SelectRowProps<T>) {
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      <select
        className={styles.select}
        value={value}
        onChange={(event) => {
          const option = options.find((candidate) => candidate.value === event.target.value)
          if (option) onChange(option.value)
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function SeedRow({ value, onChange }: { value: number; onChange: (seed: number) => void }) {
  return (
    <label className={styles.field}>
      <span className={styles.label}>Seed</span>
      <input
        className={styles.number}
        type="number"
        step={1}
        value={value}
        onChange={(event) => {
          const next = finiteValue(event)
          if (next !== null) onChange(Math.round(next))
        }}
      />
    </label>
  )
}

function ParamControl({ spec, value, onChange }: { spec: ParamSpec; value: ParamValue | undefined; onChange: (value: ParamValue) => void }) {
  switch (spec.kind) {
    case 'number':
      return (
        <NumberRow
          label={spec.label}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={typeof value === 'number' ? value : spec.default}
          onChange={onChange}
        />
      )
    case 'boolean':
      return <CheckRow label={spec.label} checked={typeof value === 'boolean' ? value : spec.default} onChange={onChange} />
    case 'vector': {
      const vector = Array.isArray(value) ? value : [...spec.default]
      return vector.map((component, index) => (
        <NumberRow
          key={index}
          label={`${spec.label} ${AXES[index] ?? index + 1}`}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={component}
          onChange={(next) => onChange(vector.map((old, i) => (i === index ? next : old)))}
        />
      ))
    }
    default: {
      const unknown: never = spec
      throw new Error(`Unknown param kind: ${JSON.stringify(unknown)}`)
    }
  }
}

interface ParamControlsProps {
  specs: readonly ParamSpec[]
  values: Readonly<Record<string, ParamValue>>
  onChange: (key: string, value: ParamValue) => void
}

/** One control per declared param: number = range + number, boolean = checkbox, vector = one range per component. */
export function ParamControls({ specs, values, onChange }: ParamControlsProps) {
  return specs.map((spec) => (
    <ParamControl key={spec.key} spec={spec} value={values[spec.key]} onChange={(value) => onChange(spec.key, value)} />
  ))
}
