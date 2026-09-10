'use client'
import { useBackgroundStore } from '@/features/background-generator/store'
import { Slider } from '@/components/controls/Slider'
import { useGradientBrush } from './gradientBrushStore'
import type { BrushMode } from '@/core/lab/gradients/deformation'

export function GradientBrushControls() {
  const brush = useGradientBrush()
  const hasDeformation = useBackgroundStore((s) => !!s.recipe.look.deformation)
  return <div className="gradient-brush-controls">
    <button type="button" className={brush.enabled ? 'gradient-brush-toggle active' : 'gradient-brush-toggle'} aria-pressed={brush.enabled} onClick={() => brush.set({ enabled: !brush.enabled })}>Distortion brush</button>
    {brush.enabled && <>
      <div className="gradient-brush-modes" role="group" aria-label="Brush mode">
        {(['push', 'twirl', 'inflate', 'restore'] as BrushMode[]).map((mode) => <button type="button" key={mode} aria-pressed={brush.mode === mode} className={brush.mode === mode ? 'active' : ''} onClick={() => brush.set({ mode })}>{mode[0].toUpperCase() + mode.slice(1)}</button>)}
      </div>
      <Slider label="Brush size" value={brush.radius} min={0.04} max={0.7} step={0.01} format={(v) => `${Math.round(v * 100)}`} onChange={(radius) => brush.set({ radius })} defaultValue={0.24} />
      <Slider label="Brush strength" value={brush.strength} min={0.05} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}`} onChange={(strength) => brush.set({ strength })} defaultValue={0.65} />
      <button type="button" disabled={!hasDeformation} onClick={() => useBackgroundStore.getState().updateRecipe({ look: { deformation: undefined } })}>Clear brush strokes</button>
    </>}
  </div>
}
