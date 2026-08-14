'use client'

import { useEffect, useRef } from 'react'
import { useLabStore } from '@/core/lab/labStore'
import { LOOKS, lookPatchFor } from '@/core/lab/looks'
import { mergeDeep } from '@/core/state/store'
import { renderLab } from '@/core/lab/render'
import { getLabSource } from '@/core/lab/sourceCache'
import { resolveBankCached } from './bankCache'
import { useBackgroundStore } from '@/features/background-generator/store'
import { scaleLabForPreview } from '@/core/lab/preview'

// The looks strip: every look rendered as a live thumbnail of YOUR
// image through the real pipeline. Clicking applies the look as one
// normal undo entry — every control underneath lands on real values.

const THUMB_H = 72

export function LooksPanel() {
  const mode = useBackgroundStore((state) => state.recipe.mode)
  const lookId = useBackgroundStore((state) => state.recipe.look.id)
  const materialOverlayEnabled = useBackgroundStore(
    (state) => state.recipe.materialLookOverlay.enabled,
  )
  const updateRecipe = useBackgroundStore((state) => state.updateRecipe)
  const lab = useLabStore((s) => s.lab)
  const sourceNonce = useLabStore((s) => s.ui.sourceNonce)
  const stripRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef(0)

  // thumbnails: real renders at small scale, redrawn only when the
  // state they inherit changes. The key deliberately uses the source
  // CONTENT hash and the COMMITTED paint (pointer-up), never the
  // per-stroke nonce — one brush stroke must not re-render ten full
  // pipelines per pointer sample.
  const thumbKey = [
    lab.source?.contentHash ?? 'none',
    lab.source?.fit ?? '',
    lab.seed,
    lab.colors.palette.join(),
    lab.colors.ink,
    lab.colors.paper,
    `${lab.output.width}x${lab.output.height}`,
    // Direct canvas transforms intentionally do not invalidate all ten
    // thumbnails on every pointer sample.
    lab.paint?.data.length ?? 0,
    // bitmap PRESENCE, not the per-stroke nonce: flips exactly when an
    // image arrives (rehydration included) or is removed
    getLabSource() ? 'img' : 'none',
  ].join('|')
  void sourceNonce // subscription: re-render (and re-key) on cache changes
  useEffect(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      const strip = stripRef.current
      if (!strip) return
      const source = getLabSource()
      const canvases = strip.querySelectorAll('canvas')
      const base = useLabStore.getState().lab
      LOOKS.forEach((look, i) => {
        const canvas = canvases[i]
        if (!canvas) return
        const targetWidth = Math.max(1, Math.round((base.output.width * THUMB_H) / base.output.height))
        const fullPreview = mergeDeep(base, lookPatchFor(look, !!source))
        fullPreview.look = { id: look.id, strength: 1 }
        fullPreview.finish = { grain: 0 }
        const preview = scaleLabForPreview(fullPreview, Math.max(targetWidth, THUMB_H))
        canvas.width = preview.output.width
        canvas.height = preview.output.height
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        renderLab(ctx, preview, source, resolveBankCached(preview.mark.bank), 'composite')
      })
    })
    return () => cancelAnimationFrame(rafRef.current)
  }, [thumbKey])

  return (
    <div className="panel-section">
      <div className="panel-heading">Looks</div>
      {mode === 'material' ? (
        <div className="panel-note" data-mbs-look-scope="3d-full-frame">
          Processes the live 3D frame. Click the active Look to turn it off.
        </div>
      ) : null}
      <div className="lab-looks" ref={stripRef}>
        {LOOKS.map((look) => {
          const active = lookId === look.id
            && (mode === 'background' || materialOverlayEnabled)
          return (
            <button
              key={look.id}
              className={active ? 'lab-look active' : 'lab-look'}
              title={mode === 'material' ? `${look.label} · full-frame 3D post-process` : look.label}
              aria-pressed={active}
              onClick={() => {
                if (mode === 'background') {
                  updateRecipe({ look: { id: look.id } })
                  return
                }
                updateRecipe({
                  look: { id: look.id },
                  materialLookOverlay: {
                    enabled: !(materialOverlayEnabled && lookId === look.id),
                  },
                })
              }}
            >
              <canvas className="lab-look-thumb" />
              <span className="lab-look-label">{look.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
