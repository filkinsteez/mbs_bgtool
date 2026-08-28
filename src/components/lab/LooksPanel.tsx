'use client'

import { useEffect, useRef } from 'react'
import { LOOKS } from '@/core/lab/looks'
import { mergeDeep } from '@/core/state/store'
import { createLabSourceFromCanvas } from '@/core/lab/sourceCache'
import { resolveBankCached } from './bankCache'
import { useBackgroundStore } from '@/features/background-generator/store'
import { createDefaultBackgroundRecipe } from '@/features/background-generator/recipe'
import { renderBackground2DCanvas } from '@/features/background-generator/render2d'
import { handleRadioGroupKeyDown } from '@/components/controls/radioKeyboard'
import { Slider } from '@/components/controls/Slider'
import {
  renderRecipeLookToCanvas,
  sourceAwareLabForRecipe,
} from '@/features/background-generator/lookProcessor'
import type { LookVersion } from '@/core/lab/types'

// 2D thumbnails use only the active generator recipe. 3D thumbnails use
// one fixed generic frame so live camera and material changes cannot leak in.

const GENERIC_3D_BASE_RECIPE = createDefaultBackgroundRecipe(1913)
const LOOK_VERSIONS: readonly LookVersion[] = ['v1', 'v1b', 'v2']
const GENERIC_3D_RECIPE = {
  ...GENERIC_3D_BASE_RECIPE,
  format: {
    aspect: 'custom' as const,
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
  const lookDetail = useBackgroundStore((state) => state.recipe.look.detail)
  const lookVersion = useBackgroundStore((state) => state.recipe.look.version)
  const materialOverlayEnabled = useBackgroundStore(
    (state) => state.recipe.materialLookOverlay.enabled,
  )
  const thumbnailRecipeKey = useBackgroundStore((state) => {
    const recipe = state.recipe
    return [
      recipe.seed,
      recipe.look.detail,
      recipe.look.version,
      recipe.palette.mix.map((item) =>
        `${item.color}:${item.enabled ? 1 : 0}:${item.ratio}`,
      ).join(','),
      recipe.palette.ink,
      recipe.palette.ground,
      `${recipe.format.width}x${recipe.format.height}`,
    ].join('|')
  })
  const updateRecipe = useBackgroundStore((state) => state.updateRecipe)
  const setTransient = useBackgroundStore((state) => state.setTransient)
  const commitTransaction = useBackgroundStore((state) => state.commitTransaction)
  const stripRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef(0)
  const redrawTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Direct artwork transforms intentionally do not invalidate all ten
  // thumbnails on every pointer sample.
  const thumbKey = mode === 'material'
    ? `generic-3d-look-preview-${lookVersion}`
    : thumbnailRecipeKey
  useEffect(() => {
    clearTimeout(redrawTimerRef.current)
    cancelAnimationFrame(rafRef.current)
    redrawTimerRef.current = setTimeout(() => {
      rafRef.current = requestAnimationFrame(() => {
        const strip = stripRef.current
        if (!strip) return
        const generic = mode === 'material'
        const genericFrame = generic ? createGenericMaterialFrame() : null
        const genericSource = genericFrame
          ? createLabSourceFromCanvas(genericFrame, { filename: 'generic-3d-look-preview.rgba' })
          : null
        const canvases = strip.querySelectorAll('canvas')
        const liveRecipe = useBackgroundStore.getState().recipe
        LOOKS.forEach((look, i) => {
          const canvas = canvases[i]
          if (!canvas) return
          if (genericSource) {
            const recipe = mergeDeep(GENERIC_3D_RECIPE, {
              look: { id: look.id, detail: 0.5, version: lookVersion },
              materialLookOverlay: { enabled: true },
            })
            const lookLab = sourceAwareLabForRecipe(recipe, genericSource, 'cover')
            renderRecipeLookToCanvas(
              canvas,
              recipe,
              genericSource,
              resolveBankCached(lookLab.mark.bank, lookLab.look.version),
              { fit: 'cover', maxLongEdge: 128 },
            )
            return
          }
          renderBackground2DCanvas(canvas, liveRecipe, {
            phase: 'thumbnail',
            maxLongEdge: 128,
            lookId: look.id,
            grain: 0,
          })
        })
      })
    }, 80)
    return () => {
      clearTimeout(redrawTimerRef.current)
      cancelAnimationFrame(rafRef.current)
    }
  }, [lookVersion, mode, thumbKey])

  return (
    <div className="panel-section">
      <div className="panel-heading-row">
        <h2 className="panel-heading">Looks</h2>
        {mode === 'material' ? (
          <span className="lab-status-badge" data-mbs-look-scope="3d-full-frame">
            Generic previews
          </span>
        ) : null}
      </div>
      <div className="lab-look-version-tabs" role="tablist" aria-label="Look version">
        {LOOK_VERSIONS.map((version) => (
          <button
            id={`lab-look-version-${version}`}
            key={version}
            type="button"
            role="tab"
            aria-controls="lab-look-version-panel"
            aria-selected={lookVersion === version}
            tabIndex={lookVersion === version ? 0 : -1}
            className={lookVersion === version ? 'active' : undefined}
            onClick={() => updateRecipe({ look: { version } })}
            onKeyDown={(event) => {
              let nextIndex: number
              const current = LOOK_VERSIONS.indexOf(version)
              if (event.key === 'ArrowLeft') {
                nextIndex = (current - 1 + LOOK_VERSIONS.length) % LOOK_VERSIONS.length
              } else if (event.key === 'ArrowRight') {
                nextIndex = (current + 1) % LOOK_VERSIONS.length
              } else if (event.key === 'Home') {
                nextIndex = 0
              } else if (event.key === 'End') {
                nextIndex = LOOK_VERSIONS.length - 1
              } else {
                return
              }
              event.preventDefault()
              const next = LOOK_VERSIONS[nextIndex]
              updateRecipe({ look: { version: next } })
              requestAnimationFrame(() => {
                document.getElementById(`lab-look-version-${next}`)?.focus()
              })
            }}
          >
            {version.toUpperCase()}
          </button>
        ))}
      </div>
      <div
        id="lab-look-version-panel"
        role="tabpanel"
        aria-labelledby={`lab-look-version-${lookVersion}`}
      >
        <div
          className="lab-looks"
          ref={stripRef}
          role={mode === 'background' ? 'radiogroup' : 'group'}
          aria-label={mode === 'background' ? '2D Look' : '3D Looks'}
        >
          {LOOKS.map((look) => {
            const active = lookId === look.id
              && (mode === 'background' || materialOverlayEnabled)
            return (
              <button
                key={look.id}
                type="button"
                className={active ? 'lab-look active' : 'lab-look'}
                role={mode === 'background' ? 'radio' : undefined}
                title={mode === 'material' ? `${look.label} · generic effect preview` : look.label}
                aria-checked={mode === 'background' ? active : undefined}
                aria-pressed={mode === 'material' ? active : undefined}
                tabIndex={mode === 'background' ? (active ? 0 : -1) : undefined}
                onKeyDown={mode === 'background' ? handleRadioGroupKeyDown : undefined}
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
        <Slider
          label="Complexity"
          value={lookDetail}
          min={0}
          max={1}
          step={0.01}
          format={(value) => `${Math.round(value * 100)}`}
          defaultValue={0.5}
          onChange={(detail) => setTransient({ look: { detail } })}
          onCommit={commitTransaction}
        />
      </div>
    </div>
  )
}
