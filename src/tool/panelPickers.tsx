import type { ReactNode } from 'react'
import { EXPORT_SIZES, getPack, type ExportAspect, type MoodId, type PackId, type RecipeId } from '@/light'
import { FORMAT_OPTIONS, lookOptions, MOOD_OPTIONS, PACK_DIAL_KEY, PACK_OPTIONS } from './dialConfig'
import { FILTER_DIAL_KEY, FILTER_OPTIONS, type FilterChoice } from './filterControl'
import { lookPicture, moodPicture } from './panelPictures'
import { TilePicker } from './TilePicker'

/** A fixed picture of the option. */
function Picture({ src }: { src: string }) {
  return <span className="tool-tile-picture" style={{ backgroundImage: `url(${src})` }} />
}

/** A shape or icon with the option's name under it. */
function Mark({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="tool-tile-mark">
      {children}
      <span className="tool-tile-label">{label}</span>
    </span>
  )
}

export function MoodPicker({ value, onChange }: { value: MoodId; onChange: (mood: MoodId) => void }) {
  return (
    <TilePicker
      label="Mood"
      path="mood"
      kind="picture"
      options={MOOD_OPTIONS}
      value={value}
      onChange={onChange}
      tile={(option) => <Picture src={moodPicture(option.value)} />}
    />
  )
}

export function LookPicker({ mood, value, onChange }: { mood: MoodId; value: RecipeId; onChange: (look: RecipeId) => void }) {
  return (
    <TilePicker
      label="Look"
      path="look"
      kind="picture"
      options={lookOptions(mood)}
      value={value}
      onChange={onChange}
      tile={(option) => <Picture src={lookPicture(option.value)} />}
    />
  )
}

/** Each pack as a strip of its own colors in pack order. */
export function PackPicker({ value, onChange }: { value: PackId; onChange: (pack: PackId) => void }) {
  return (
    <TilePicker
      label="Colors"
      path={PACK_DIAL_KEY}
      kind="swatch"
      options={PACK_OPTIONS}
      value={value}
      onChange={onChange}
      tile={(option) => getPack(option.value).colors.map((color) => <span key={color.hex} style={{ background: color.hex }} />)}
    />
  )
}

/** Grain's specks: x, y and radius in the icon's 20-unit box. */
const GRAIN_DOTS = [
  [3.5, 4.5, 1.2],
  [9, 3, 1],
  [15.5, 4, 1.3],
  [6.5, 9, 1.1],
  [12.5, 8, 1.2],
  [17, 11, 1],
  [3, 13.5, 1.1],
  [9.5, 13, 1.3],
  [14.5, 15, 1.1],
  [6, 17.5, 1],
  [11.5, 18, 1.1],
  [17.5, 17.5, 1.2],
] as const

/** Pixel's cells: a 3 by 3 mosaic that fades from the top left. */
const PIXEL_CELLS = [0, 1, 2].flatMap((row) => [0, 1, 2].map((col) => ({ x: col * 7.25, y: row * 7.25, opacity: 1 - (row + col) * 0.2 })))

/** The filters' icons, in the tile's text color like the format shapes. */
const FILTER_ICONS: Readonly<Record<FilterChoice, ReactNode>> = {
  none: (
    <>
      <circle cx="10" cy="10" r="8" />
      <path d="M4.3 4.3 15.7 15.7" />
    </>
  ),
  grain: GRAIN_DOTS.map(([x, y, r]) => <circle key={`${x} ${y}`} className="tool-tile-fill" cx={x} cy={y} r={r} />),
  ascii: (
    <text className="tool-tile-glyph" x="10" y="15" textAnchor="middle">
      A
    </text>
  ),
  pixel: PIXEL_CELLS.map(({ x, y, opacity }) => (
    <rect key={`${x} ${y}`} className="tool-tile-fill" x={x} y={y} width="5.5" height="5.5" rx="1" fillOpacity={opacity} />
  )),
}

export function FilterPicker({ value, onChange }: { value: FilterChoice; onChange: (filter: FilterChoice) => void }) {
  return (
    <TilePicker
      label="Filter"
      path={FILTER_DIAL_KEY}
      kind="shape"
      options={FILTER_OPTIONS}
      value={value}
      onChange={onChange}
      tile={(option) => (
        <Mark label={option.label}>
          <svg className="tool-tile-icon" viewBox="0 0 20 20" aria-hidden="true">
            {FILTER_ICONS[option.value]}
          </svg>
        </Mark>
      )}
    />
  )
}

/** The format's frame, its long side the size of `--shape-box` (tool.css). */
function shapeStyle(aspect: ExportAspect) {
  const { width, height } = EXPORT_SIZES[aspect]
  const long = Math.max(width, height)
  return { width: `calc(var(--shape-box) * ${width / long})`, height: `calc(var(--shape-box) * ${height / long})` }
}

export function FormatPicker({ value, onChange }: { value: ExportAspect; onChange: (format: ExportAspect) => void }) {
  return (
    <TilePicker
      label="Format"
      path="format"
      kind="shape"
      options={FORMAT_OPTIONS}
      value={value}
      onChange={onChange}
      tile={(option) => (
        <Mark label={option.label}>
          <span className="tool-tile-shape" style={shapeStyle(option.value)} />
        </Mark>
      )}
    />
  )
}
