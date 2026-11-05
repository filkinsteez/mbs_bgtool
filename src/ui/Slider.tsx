import { useId } from 'react'

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  onChangeStart,
  onChangeEnd,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (next: number) => void
  onChangeStart?: () => void
  onChangeEnd?: () => void
}) {
  const id = useId()

  const ratio = Math.max(0, Math.min(1, (value - min) / Math.max(max - min, 1e-9)))

  return (
    <label className="xmds-slider" htmlFor={id}>
      <span className="xmds-label-row">
        <span className="xmds-label">{label}</span>
        <span className="xmds-value">{Number.isInteger(value) ? value : value.toFixed(2)}</span>
      </span>
      <span className="xmds-slider-track" style={{ ['--fill' as string]: `${ratio * 100}%` }}>
        <input
          id={id}
          className="xmds-slider-input"
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onPointerDown={() => onChangeStart?.()}
          onPointerUp={() => onChangeEnd?.()}
          onPointerCancel={() => onChangeEnd?.()}
          onChange={(event) => onChange(Number(event.target.value))}
          onKeyDown={(event) => {
            if (!event.shiftKey) return
            const multiplier = 10
            let delta = 0
            if (event.key === 'ArrowRight' || event.key === 'ArrowUp') delta = step * multiplier
            if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') delta = -step * multiplier
            if (delta === 0) return
            event.preventDefault()
            onChange(Math.max(min, Math.min(max, value + delta)))
          }}
        />
      </span>
    </label>
  )
}
