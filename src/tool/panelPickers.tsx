import type { ReactNode } from 'react'
import { EXPORT_SIZES, getPack, type ExportAspect, type MoodId, type PackId } from '@/light'
import { hueOrder } from '@/light/color/packs'
import { FORMAT_OPTIONS, MOOD_OPTIONS, PACK_DIAL_KEY, PACK_OPTIONS } from './dialConfig'
import { FILTER_DIAL_KEY, FILTER_OPTIONS, type FilterChoice } from './filterControl'
import { InfoTip } from './InfoTip'
import { moodPicture } from './panelPictures'
import { TilePicker } from './TilePicker'

/** The documentation the Colors card's info icon links to; while it is empty, the tip's text is not a link. */
export const COLORS_DOC_URL = ''

/** The Colors card's info tip, which becomes the documentation link once `COLORS_DOC_URL` is set (owner, 2026-11-12). */
export const COLORS_INFO = 'documentation link here'

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

/** Each pack as a strip of its own colors in hue order, as the color rows and the pictures have them. */
export function PackPicker({ value, onChange }: { value: PackId; onChange: (pack: PackId) => void }) {
  return (
    <TilePicker
      label="Colors"
      path={PACK_DIAL_KEY}
      kind="swatch"
      options={PACK_OPTIONS}
      value={value}
      onChange={onChange}
      info={<InfoTip label="About colors" text={COLORS_INFO} href={COLORS_DOC_URL} />}
      tile={(option) => {
        const pack = getPack(option.value)
        return hueOrder(pack).map((index) => <span key={pack.colors[index].hex} style={{ background: pack.colors[index].hex }} />)
      }}
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
  pixel: PIXEL_CELLS.map(({ x, y, opacity }) => (
    <rect key={`${x} ${y}`} className="tool-tile-fill" x={x} y={y} width="5.5" height="5.5" rx="1" fillOpacity={opacity} />
  )),
  paper: (
    <>
      <rect x="3" y="2" width="14" height="16" rx="1.5" />
      <path d="M6 7.5c1.6-.9 3.2-.3 4.6-.8M8.5 11.2c1.5-.6 3-.1 5.2-.9M6 14.6c1.3-.5 2.4-.1 3.6-.5" />
    </>
  ),
}

export function FilterPicker({ value, onChange }: { value: FilterChoice; onChange: (filter: FilterChoice) => void }) {
  return (
    <TilePicker
      label="Filter"
      path={FILTER_DIAL_KEY}
      kind="icon"
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
      kind="icon"
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
