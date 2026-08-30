'use client'

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { Dices, X } from 'lucide-react'
import { chan } from '@/core/organic/random'
import {
  createLabSourceFromCanvas,
  type LabSource,
} from '@/core/lab/sourceCache'
import { mergeDeep } from '@/core/state/store'
import {
  renderRecipeLookToCanvas,
  sourceAwareLabForRecipe,
} from '@/features/background-generator/lookProcessor'
import { renderBackground2DCanvas } from '@/features/background-generator/render2d'
import type { BackgroundRecipeV2 } from '@/features/background-generator/recipe'
import { useBackgroundStore } from '@/features/background-generator/store'
import { resolveBankCached } from './bankCache'

// Seed contact sheet: a 3x3 grid of the CURRENT recipe rendered under nine
// candidate seeds. Candidates walk deterministically from the current seed
// (page 0 keeps the current seed in cell one for orientation); re-dealing
// advances the walk. 2D candidates render through the real thumbnail path;
// 3D candidates run the exact material Look processor over the same fixed
// generic frame the Looks strip previews with, so live camera state never
// leaks into the sheet.

const THUMB_LONG_EDGE = 168
const GRID_SIZE = 9
const SEED_WALK_CHANNEL = 'ui.seedsheet.walk'

function dealCandidateSeeds(seed: number, page: number): number[] {
  const seeds: number[] = []
  const seen = new Set<number>()
  if (page === 0) {
    seeds.push(seed)
    seen.add(seed)
  }
  // Non-overlapping id blocks per page keep every deal fresh; the dedupe
  // loop only ever advances a handful of ids past the block start.
  let id = page * 64
  while (seeds.length < GRID_SIZE) {
    const candidate =
      Math.floor(chan(seed, id, SEED_WALK_CHANNEL) * 0x80000000) & 0x7fffffff
    id += 1
    if (seen.has(candidate)) continue
    seen.add(candidate)
    seeds.push(candidate)
  }
  return seeds
}

// Mirrors the generic 3D preview frame in LooksPanel (which owns its copy
// privately): one deterministic lit-scene stand-in so material candidates
// preview the active Look treatment without touching the live viewer.
const GENERIC_FRAME_WIDTH = 320
const GENERIC_FRAME_HEIGHT = 180

function createGenericMaterialSource(): LabSource {
  const canvas = document.createElement('canvas')
  canvas.width = GENERIC_FRAME_WIDTH
  canvas.height = GENERIC_FRAME_HEIGHT
  const context = canvas.getContext('2d')
  if (context) {
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
  }
  return createLabSourceFromCanvas(canvas, {
    filename: 'generic-3d-seed-preview.rgba',
  })
}

let genericSourceCache: LabSource | null = null

function genericMaterialSource(): LabSource {
  genericSourceCache ??= createGenericMaterialSource()
  return genericSourceCache
}

// Rendered candidates keyed by (recipe minus seed, preview mode, seed) so
// reopening the sheet or walking back to a seen page blits instantly.
const CACHE_LIMIT = 96
const thumbCache = new Map<string, HTMLCanvasElement>()

function rememberThumb(key: string, canvas: HTMLCanvasElement): void {
  if (thumbCache.has(key)) thumbCache.delete(key)
  thumbCache.set(key, canvas)
  while (thumbCache.size > CACHE_LIMIT) {
    const oldest = thumbCache.keys().next().value
    if (oldest === undefined) break
    thumbCache.delete(oldest)
  }
}

function recipeCacheKey(recipe: BackgroundRecipeV2, material: boolean): string {
  return `${material ? '3d' : '2d'}|${JSON.stringify({ ...recipe, seed: 0 })}`
}

function renderCandidate(
  recipe: BackgroundRecipeV2,
  seed: number,
  material: boolean,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  if (material) {
    const source = genericMaterialSource()
    const candidate = mergeDeep(recipe, {
      seed,
      format: {
        aspect: 'custom' as const,
        width: GENERIC_FRAME_WIDTH,
        height: GENERIC_FRAME_HEIGHT,
      },
      materialLookOverlay: { enabled: true },
    })
    const lookLab = sourceAwareLabForRecipe(candidate, source, 'cover')
    renderRecipeLookToCanvas(
      canvas,
      candidate,
      source,
      resolveBankCached(lookLab.mark.bank, lookLab.look.version),
      { fit: 'cover', maxLongEdge: THUMB_LONG_EDGE },
    )
    return canvas
  }
  renderBackground2DCanvas(canvas, mergeDeep(recipe, { seed }), {
    phase: 'thumbnail',
    maxLongEdge: THUMB_LONG_EDGE,
  })
  return canvas
}

function blit(target: HTMLCanvasElement, rendered: HTMLCanvasElement): void {
  if (target.width !== rendered.width) target.width = rendered.width
  if (target.height !== rendered.height) target.height = rendered.height
  const context = target.getContext('2d')
  if (!context) return
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.clearRect(0, 0, target.width, target.height)
  context.drawImage(rendered, 0, 0)
  target.dataset.rendered = 'true'
}

type SeedSheetPopoverProps = {
  anchor: HTMLElement
  onClose: () => void
}

function SeedSheetPopover({ anchor, onClose }: SeedSheetPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const cellsRef = useRef<(HTMLCanvasElement | null)[]>([])
  const mode = useBackgroundStore((state) => state.mode)
  const currentSeed = useBackgroundStore((state) => state.recipe.seed)
  const format = useBackgroundStore((state) => state.recipe.format)
  const historyVersion = useBackgroundStore((state) => state.historyVersion)
  const updateRecipe = useBackgroundStore((state) => state.updateRecipe)
  const [page, setPage] = useState(0)
  const [focusIndex, setFocusIndex] = useState(0)
  const candidates = useMemo(
    () => dealCandidateSeeds(currentSeed, page),
    [currentSeed, page],
  )

  const material = mode === 'material'
  const rect = anchor.getBoundingClientRect()
  const width = Math.min(344, window.innerWidth - 24)
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))
  const roomBelow = window.innerHeight - rect.bottom - 12
  const openBelow = roomBelow >= Math.min(420, rect.top - 12)
  const position = openBelow
    ? {
        top: rect.bottom + 8,
        maxHeight: Math.max(220, roomBelow - 8),
      }
    : {
        bottom: window.innerHeight - rect.top + 8,
        maxHeight: Math.max(220, rect.top - 20),
      }
  const formatRatio = material
    ? GENERIC_FRAME_WIDTH / GENERIC_FRAME_HEIGHT
    : format.width / Math.max(1, format.height)
  const cellAspect = Math.max(0.75, Math.min(2.4, formatRatio))

  useEffect(() => {
    popoverRef.current
      ?.querySelector<HTMLButtonElement>('[role="radio"]')
      ?.focus()
    const closeForOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (popoverRef.current?.contains(target) || anchor.contains(target)) return
      onClose()
    }
    const closeForEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      anchor.focus({ preventScroll: true })
      onClose()
    }
    const closeForResize = () => onClose()
    document.addEventListener('pointerdown', closeForOutsidePointer, true)
    document.addEventListener('keydown', closeForEscape)
    window.addEventListener('resize', closeForResize)
    return () => {
      document.removeEventListener('pointerdown', closeForOutsidePointer, true)
      document.removeEventListener('keydown', closeForEscape)
      window.removeEventListener('resize', closeForResize)
    }
  }, [anchor, onClose])

  // rAF-chunked fill: one candidate per frame so opening never blocks a
  // paint; cache hits are a plain blit on their frame.
  useEffect(() => {
    let cancelled = false
    let raf = 0
    const baseRecipe = useBackgroundStore.getState().recipe
    const baseKey = recipeCacheKey(baseRecipe, material)
    const queue = candidates.map((seed, index) => ({ seed, index }))
    const step = () => {
      if (cancelled) return
      const next = queue.shift()
      if (!next) return
      const cell = cellsRef.current[next.index]
      if (cell) {
        const key = `${baseKey}|${next.seed}`
        let rendered = thumbCache.get(key)
        if (!rendered) {
          rendered = renderCandidate(baseRecipe, next.seed, material)
          rememberThumb(key, rendered)
        }
        blit(cell, rendered)
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [candidates, material, historyVersion])

  const adopt = (seed: number) => {
    updateRecipe({ seed })
    anchor.focus({ preventScroll: true })
    onClose()
  }

  const onCellKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const key = event.key
    if (
      key !== 'ArrowLeft'
      && key !== 'ArrowRight'
      && key !== 'ArrowUp'
      && key !== 'ArrowDown'
      && key !== 'Home'
      && key !== 'End'
    ) return
    event.preventDefault()
    const cells = Array.from(
      gridRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
        ?? [],
    )
    const current = cells.indexOf(event.currentTarget)
    if (current < 0) return
    const count = cells.length
    const next = key === 'Home' ? 0
      : key === 'End' ? count - 1
        : key === 'ArrowLeft' ? (current + count - 1) % count
          : key === 'ArrowRight' ? (current + 1) % count
            : key === 'ArrowUp' ? (current + count - 3) % count
              : (current + 3) % count
    cells[next]?.focus()
  }

  return createPortal(
    <div
      ref={popoverRef}
      className="lab-color-popover lab-seed-sheet"
      role="dialog"
      aria-label="Variations"
      style={{ left, width, ...position }}
    >
      <div className="lab-color-popover-header">
        <h3>Variations</h3>
        <div className="lab-seed-sheet-actions">
          <button
            type="button"
            className="lab-icon-button"
            aria-label="Deal new variations"
            onClick={() => setPage((value) => value + 1)}
          >
            <Dices aria-hidden="true" />
          </button>
          <button
            type="button"
            className="lab-icon-button"
            aria-label="Close variations"
            onClick={() => {
              anchor.focus({ preventScroll: true })
              onClose()
            }}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      </div>
      <div
        ref={gridRef}
        id="lab-seed-sheet-grid"
        className="lab-seed-grid"
        role="radiogroup"
        aria-label="Candidate seeds"
        style={{ '--seed-cell-aspect': String(cellAspect) } as CSSProperties}
      >
        {candidates.map((seed, index) => (
          <button
            key={`${page}:${seed}`}
            type="button"
            role="radio"
            className="lab-seed-cell"
            aria-checked={seed === currentSeed}
            aria-label={`Use seed ${seed}`}
            tabIndex={index === focusIndex ? 0 : -1}
            data-seed={seed}
            onFocus={() => setFocusIndex(index)}
            onKeyDown={onCellKeyDown}
            onClick={() => adopt(seed)}
          >
            <canvas className="lab-seed-thumb" data-rendered="false" ref={(el) => {
              cellsRef.current[index] = el
            }}
            />
          </button>
        ))}
      </div>
    </div>,
    document.body,
  )
}

export function SeedSheetButton() {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
  return (
    <>
      <button
        id="lab-seed-sheet-trigger"
        type="button"
        className={anchor ? 'lab-chip active' : 'lab-chip'}
        aria-haspopup="dialog"
        aria-expanded={anchor !== null}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
      >
        Variations
      </button>
      {anchor ? (
        <SeedSheetPopover anchor={anchor} onClose={() => setAnchor(null)} />
      ) : null}
    </>
  )
}
