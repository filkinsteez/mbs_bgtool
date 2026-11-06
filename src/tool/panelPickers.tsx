import { EXPORT_SIZES, getPack, type ExportAspect, type MoodId, type PackId, type RecipeId } from '@/light'
import { FORMAT_OPTIONS, lookOptions, MOOD_OPTIONS, PACK_DIAL_KEY, PACK_OPTIONS } from './dialConfig'
import { FILTER_DIAL_KEY, FILTER_OPTIONS, type FilterChoice } from './filterControl'
import { filterPicture, lookPicture, moodPicture } from './panelPictures'
import { TilePicker } from './TilePicker'

/** A fixed picture of the option in the chosen pack. */
function Picture({ src }: { src: string }) {
  return <span className="tool-tile-picture" style={{ backgroundImage: `url(${src})` }} />
}

/** No filter: a circle with a line through it. */
function OffIcon() {
  return (
    <span className="tool-tile-off">
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="8" />
        <path d="M4.3 4.3 15.7 15.7" />
      </svg>
    </span>
  )
}

export function MoodPicker({ value, pack, onChange }: { value: MoodId; pack: PackId; onChange: (mood: MoodId) => void }) {
  return (
    <TilePicker
      label="Mood"
      path="mood"
      kind="picture"
      options={MOOD_OPTIONS}
      value={value}
      onChange={onChange}
      tile={(option) => <Picture src={moodPicture(option.value, pack)} />}
    />
  )
}

export function LookPicker({ mood, value, pack, onChange }: { mood: MoodId; value: RecipeId; pack: PackId; onChange: (look: RecipeId) => void }) {
  return (
    <TilePicker
      label="Look"
      path="look"
      kind="picture"
      options={lookOptions(mood)}
      value={value}
      onChange={onChange}
      tile={(option) => <Picture src={lookPicture(option.value, pack)} />}
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

export function FilterPicker({ value, pack, onChange }: { value: FilterChoice; pack: PackId; onChange: (filter: FilterChoice) => void }) {
  return (
    <TilePicker
      label="Filter"
      path={FILTER_DIAL_KEY}
      kind="picture"
      options={FILTER_OPTIONS}
      value={value}
      onChange={onChange}
      tile={(option) => (option.value === 'none' ? <OffIcon /> : <Picture src={filterPicture(option.value, pack)} />)}
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
        <span className="tool-tile-format">
          <span className="tool-tile-shape" style={shapeStyle(option.value)} />
          <span className="tool-tile-format-label">{option.label}</span>
        </span>
      )}
    />
  )
}
