'use client'

import { Slider } from '@/components/controls/Slider'
import { useReducedMotion } from '@/features/background-generator/motion/useReducedMotion'
import { useBackgroundStore } from '@/features/background-generator/store'

const pct = (v: number) => `${Math.round(v * 100)}`

export function MotionPanel() {
  const motion = useBackgroundStore((state) => state.recipe.motion)
  const setTransient = useBackgroundStore((state) => state.setTransient)
  const commit = useBackgroundStore((state) => state.commitTransaction)
  const reducedMotion = useReducedMotion()

  return (
    <div className="panel-section">
      <h2 className="panel-heading">Motion</h2>
      {reducedMotion ? <div className="panel-note">Reduce Motion is on</div> : null}
      <Slider
        label="Amount"
        value={motion.amount}
        min={0}
        max={1}
        step={0.01}
        format={pct}
        defaultValue={0}
        disabled={reducedMotion}
        onChange={(amount) => setTransient({ motion: { amount, enabled: amount > 0 } })}
        onCommit={commit}
      />
      <Slider
        label="Energy"
        value={motion.speed}
        min={0.1}
        max={2}
        step={0.01}
        format={(v) => `${v.toFixed(2)}x`}
        defaultValue={0.5}
        disabled={reducedMotion || motion.amount <= 0}
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
        defaultValue={8}
        disabled={reducedMotion || motion.amount <= 0}
        onChange={(loopSeconds) => setTransient({ motion: { loopSeconds } })}
        onCommit={commit}
      />
    </div>
  )
}
