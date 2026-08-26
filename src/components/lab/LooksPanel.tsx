'use client'

import { useEffect, useRef } from 'react'
import { useLabStore } from '@/core/lab/labStore'
import { LOOKS, lookPatchFor } from '@/core/lab/looks'
import { mergeDeep } from '@/core/state/store'
import { renderLab } from '@/core/lab/render'
import { createLabSourceFromCanvas, getLabSource } from '@/core/lab/sourceCache'
import { resolveBankCached } from './bankCache'
import { useBackgroundStore } from '@/features/background-generator/store'
import { scaleLabForPreview } from '@/core/lab/preview'
import { createDefaultBackgroundRecipe } from '@/features/background-generator/recipe'
import {
  renderRecipeLookToCanvas,
  sourceAwareLabForRecipe,
} from '@/features/background-generator/lookProcessor'

// The looks strip: every look rendered as a live thumbnail of YOUR
// image through the real pipeline. Clicking applies the look as one
// normal undo entry — every control underneath lands on real values.

const THUMB_H = 72
const GENERIC_3D_BASE_RECIPE = createDefaultBackgroundRecipe(1913)
const GENERIC_3D_RECIPE = {
  ...GENERIC_3D_BASE_RECIPE,
  format: {
    aspect: 'custom' as const,
    resolution: '4k' as const,
    width: 320,
    height: 180,
  },
  material: {
    ...GENERIC_3D_BASE_RECIPE.material,
    backgroundColor: '#1C2A33',
    highlightColor: '#D6E7EE',
  },
}

function createGenericMaterialFrame(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 320
  canvas.height = 180
  const context = canvas.getContext('2d')
  if (!context) return canvas
  const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height)
  gradient.addColorStop(0, '#101820')
  gradient.addColorStop(0.48, '#667A8A')
  gradient.addColorStop(1, '#E9EEF2')
  context.fillStyle = gradient
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = 'rgb(255 255 255 / 0.34)'
  context.beginPath()
  context.arc(92, 82, 48, 0, Math.PI * 2)
  context.fill()
  context.fillStyle = 'rgb(4 12 20 / 0.42)'
  context.fillRect(176, 28, 94, 124)
  context.strokeStyle = 'rgb(255 255 255 / 0.48)'
  context.lineWidth = 4
  context.beginPath()
  context.moveTo(24, 150)
  context.lineTo(292, 34)
  context.stroke()
  return canvas
}

export function LooksPanel() {
  const mode = useBackgroundStore((state) => state.mode)
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
  const thumbKey = mode === 'material'
    ? 'generic-3d-look-preview-v1'
    : [
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
      const generic = mode === 'material'
      const genericFrame = generic ? createGenericMaterialFrame() : null
      const genericSource = genericFrame
        ? createLabSourceFromCanvas(genericFrame, { filename: 'generic-3d-look-preview.rgba' })
        : null
      const source = generic ? null : getLabSource()
      const canvases = strip.querySelectorAll('canvas')
      const base = useLabStore.getState().lab
      LOOKS.forEach((look, i) => {
        const canvas = canvases[i]
        if (!canvas) return
        if (genericSource) {
          const recipe = mergeDeep(GENERIC_3D_RECIPE, {
            look: { id: look.id, detail: 0.5 },
            materialLookOverlay: { enabled: true },
          })
          const lookLab = sourceAwareLabForRecipe(recipe, genericSource, 'cover')
          renderRecipeLookToCanvas(
            canvas,
            recipe,
            genericSource,
            resolveBankCached(lookLab.mark.bank),
            { fit: 'cover', maxLongEdge: 128 },
          )
          return
        }
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
  }, [mode, thumbKey])

  return (
    <div className="panel-section">
      <h2 className="panel-heading">Looks</h2>
      {mode === 'material' ? (
        <div className="panel-note" data-mbs-look-scope="3d-full-frame">
          Generic effect previews
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
              title={mode === 'material' ? `${look.label} · generic effect preview` : look.label}
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
              <canvas
                className="lab-look-thumb"
                data-preview-mode={mode === 'material' ? 'generic' : 'live'}
              />
              <span className="lab-look-label">{look.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
