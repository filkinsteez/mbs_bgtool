'use client'

import { Toggle } from '@/components/controls/Toggle'
import { Slider } from '@/components/controls/Slider'
import { useReducedMotion } from '@/features/background-generator/motion/useReducedMotion'
import { useBackgroundStore } from '@/features/background-generator/store'

const pct = (v: number) => `${Math.round(v * 100)}`

export function MotionPanel() {
  const motion = useBackgroundStore((state) => state.recipe.motion)
  const update = useBackgroundStore((state) => state.updateRecipe)
  const setTransient = useBackgroundStore((state) => state.setTransient)
  const commit = useBackgroundStore((state) => state.commitTransaction)
  const reducedMotion = useReducedMotion()

  return (
    <div className="panel-section">
      <div className="panel-heading">Motion</div>
      <Toggle
        label="Animate preview"
        value={motion.enabled && !reducedMotion}
        onChange={(enabled) => update({ motion: { enabled: reducedMotion ? false : enabled } })}
      />
      {reducedMotion ? <div className="panel-note">Preview motion follows your reduced-motion setting.</div> : null}
      {motion.enabled && !reducedMotion ? (
        <>
          <Slider
            label="Amount"
            value={motion.amount}
            min={0}
            max={1}
            step={0.01}
            format={pct}
            onChange={(amount) => setTransient({ motion: { amount } })}
            onCommit={commit}
          />
          <Slider
            label="Speed"
            value={motion.speed}
            min={0.1}
            max={2}
            step={0.01}
            format={(v) => `${v.toFixed(2)}x`}
            onChange={(speed) => setTransient({ motion: { speed } })}
            onCommit={commit}
          />
          <Slider
            label="Loop"
            value={motion.loopSeconds}
            min={2}
            max={20}
            step={1}
            format={(v) => `${Math.round(v)}s`}
            onChange={(loopSeconds) => setTransient({ motion: { loopSeconds } })}
            onCommit={commit}
          />
        </>
      ) : null}
    </div>
  )
}
