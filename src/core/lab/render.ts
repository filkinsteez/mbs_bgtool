import type { ShapeProto } from '@/core/canvas/shapeProtos'
import { META_BLUE } from '@/core/color/brand'
import { chan } from '@/core/organic/random'
import { INK, PAPER } from '@/core/state/defaults'
import { contourAtLevel } from '@/core/cloner/contours'
import { sampleCurve } from '@/core/lissajous/sampler'
import type { LabState, LabView } from './types'
import type { LabSource } from './sourceCache'
import type { Field, FitRect } from './field'
import { fieldFromMap, fitRect } from './field'
import { buildCurveField, compileTerritory, territoryGrid } from './territory'
import { buildCellMarks, buildCells, curveFlowField, tintFor } from './composition'
import { buildDabs, buildStreams, composeFlow, type VectorField } from './flow'
import { buildColorField, rgbCss } from './colorField'
import { buildBlockFills, buildShingleFills, regionValue } from './fills'
import { getPaintRaster, reconcilePaint, type PaintRaster } from './paintRuntime'
import { sampleRGB } from './analysis'
import { stampProto } from './stamp'
import { createOrganicMotionWarp } from './motion'
import { constrainArtworkToCanvas } from './artworkTransform'
import { artDirectTerritory, sampleCompositionPlan } from './compositionPlan'
import { weightedColorIndex } from './colorDirection'
import { renderQuilt } from './quilt'
import { renderFrameLook } from './frameRenderer'
import { renderTrails } from './renderTrails'
import { renderBrushwork } from './brushworkRender'

// One painter for preview AND export. The ctx arrives pre-scaled and
// everything draws in output units. Per-render work is lazy: the
// territory Field only evaluates where cells ask, and the two heavy
// lattices (curve distance, curve flow) cache across renders.

let scratch: HTMLCanvasElement | null = null
let artworkScratch: HTMLCanvasElement | null = null

export type ArtworkTransform = {
  x: number
  y: number
  scale: number
  rotation: number
}

function mapCanvas(w: number, h: number): CanvasRenderingContext2D {
  if (!scratch) scratch = document.createElement('canvas')
  scratch.width = w
  scratch.height = h
  return scratch.getContext('2d')!
}

function artworkCanvas(w: number, h: number): CanvasRenderingContext2D {
  if (!artworkScratch) artworkScratch = document.createElement('canvas')
  artworkScratch.width = w
  artworkScratch.height = h
  return artworkScratch.getContext('2d')!
}

// curve lattice caches — keyed by the exact inputs, capped small
const curveFieldCache = new Map<string, Field>()
const flowCache = new Map<string, (x: number, y: number) => number>()
const grainTileCache = new Map<string, HTMLCanvasElement>()

function cached<T>(cache: Map<string, T>, key: string, build: () => T): T {
  let hit = cache.get(key)
  if (!hit) {
    if (cache.size > 8) cache.clear()
    hit = build()
    cache.set(key, hit)
  }
  return hit
}

export function renderLab(
  ctx: CanvasRenderingContext2D,
  lab: LabState,
  source: LabSource | null,
  protos: ShapeProto[],
  view: LabView,
  paintRaster?: PaintRaster | null,
): void {
  const { width: outW, height: outH } = lab.output
  // defensive: a live HMR session may hold pre-`colors` state until the
  // next apply/restore heals it
  const ink = lab.colors?.ink ?? INK
  const paper = lab.colors?.paper ?? PAPER
  // WYSIWYG transparency: an EMPTY zone is transparency — those cells
  // keep their alpha in preview and export alike. The old Transparent
  // toggle exported something the preview never showed.
  const transparent = view === 'composite' && lab.territory.bands.includes('empty')
  ctx.clearRect(0, 0, outW, outH)
  if (!transparent) {
    ctx.fillStyle = paper
    ctx.fillRect(0, 0, outW, outH)
  }

  const maps = source?.maps ?? null
  const rect: FitRect = source
    ? fitRect(source.fullW, source.fullH, outW, outH, lab.source?.fit ?? 'contain')
    : { x: 0, y: 0, w: outW, h: outH }

  if (view === 'source') {
    if (source) ctx.drawImage(source.image, rect.x, rect.y, rect.w, rect.h)
    return
  }
  if (view === 'lum' || view === 'edge' || view === 'orient') {
    if (maps) drawAnalysisView(ctx, maps, rect, view)
    return
  }

  // territory — curve lattices arrive as cached field overrides
  if (paintRaster === undefined) reconcilePaint(lab.paint)
  const paint = paintRaster === undefined ? getPaintRaster() : paintRaster
  // the mask is SIGNED around its neutral midpoint: brush strokes read
  // negative (carve into the glitch), erase reads positive (override up
  // to photo), untouched reads ~0 — folded in with plain 'add'
  const paintField: Field | null = paint
    ? (() => {
        const raw = fieldFromMap(
          Float32Array.from(paint.bytes, (b) => b / 255),
          paint.w,
          paint.h,
          { x: 0, y: 0, w: outW, h: outH },
        )
        return (x: number, y: number) =>
          Math.max(-1, Math.min(1, (raw(x, y) * 255 - 128) / 127))
      })()
    : null
  // the positive (erase) side of the mask protects the photo outright
  const restore: Field | null = paintField
    ? (x: number, y: number) => Math.max(0, paintField(x, y))
    : null
  const isFrameLook = lab.look?.id === 'frame'
  const compiledTerritory = compileTerritoryCached(lab, rect, outW, outH, maps, paintField)
  // Frame owns a fixed contour topology and animates those points after
  // extraction. Sampling the shared domain-warped field here would add and
  // remove loops while it moved.
  const frameTerritory = isFrameLook && lab.motion.frame
    ? compileTerritoryCached(
        { ...lab, motion: { ...lab.motion, frame: undefined } },
        rect,
        outW,
        outH,
        maps,
        paintField,
      )
    : compiledTerritory
  const directedTerritory = lab.composition
    ? artDirectTerritory(lab.composition, frameTerritory, outW, outH)
    : frameTerritory
  const preserveSilhouette = lab.look?.id != null
    && ['pixels', 'streams', 'beads', 'quilt'].includes(lab.look.id)
  const T: Field = preserveSilhouette
    ? (x, y) => {
        const base = compiledTerritory(x, y)
        return base * (0.82 + directedTerritory(x, y) * 0.18)
      }
    : directedTerritory

  if (view === 'territory') {
    drawFieldView(ctx, T, outW, outH)
    return
  }

  const cells = buildCells({
    T,
    territory: lab.territory,
    structure: lab.structure,
    maps,
    rect,
    outW,
    outH,
    seed: lab.seed,
    restore,
  })

  if (view === 'bands') {
    const n = Math.max(1, lab.territory.bands.length - 1)
    for (const c of cells) {
      const v = Math.round((c.band / n) * 230)
      ctx.fillStyle = `rgb(${v} ${v} ${v})`
      ctx.fillRect(c.x, c.y, c.size + 0.5, c.size + 0.5)
    }
    return
  }
  if (view === 'cells') {
    ctx.strokeStyle = ink
    for (const c of cells) {
      ctx.globalAlpha = 0.25 + c.level * 0.35
      ctx.lineWidth = 0.75
      ctx.strokeRect(c.x + 0.5, c.y + 0.5, c.size - 1, c.size - 1)
    }
    ctx.globalAlpha = 1
    return
  }

  // ---- composite ----
  // transparent mode lays the paper ground per cell instead of globally,
  // so exactly the EMPTY zones stay alpha and every other treatment
  // renders on the same ground it always had
  if (transparent) {
    ctx.fillStyle = paper
    for (const c of cells) {
      if (c.treatment !== 'empty') ctx.fillRect(c.x, c.y, c.size + 0.35, c.size + 0.35)
    }
  }
  if (source && lab.sourceVisibility > 0) {
    ctx.save()
    ctx.globalAlpha = lab.sourceVisibility
    ctx.drawImage(source.image, rect.x, rect.y, rect.w, rect.h)
    ctx.restore()
  }

  // photo: the source revealed cell-by-cell — one clip, one draw
  const photoCells = cells.filter((c) => c.treatment === 'photo')
  if (source && photoCells.length) {
    ctx.save()
    const clip = new Path2D()
    for (const c of photoCells) clip.rect(c.x, c.y, c.size + 0.35, c.size + 0.35)
    ctx.clip(clip)
    ctx.drawImage(source.image, rect.x, rect.y, rect.w, rect.h)
    ctx.restore()
  }

  // the palette every fill treatment deals from
  const hasPalette = !!lab.colors?.palette?.length
  const palette = hasPalette ? lab.colors.palette : [ink, paper]
  const colorPlan = lab.colors?.plan
  const K = palette.length
  const dealPalette = (x: number, y: number, channel: string) => {
    const sample = regionValue(lab.seed, x, y, lab.structure.baseCell * 2.8, channel)
    const index = colorPlan
      ? weightedColorIndex(colorPlan, sample)
      : Math.min(K - 1, Math.floor(sample * K))
    return palette[index]
  }

  // mosaic: the source quantized to the cell grid — or, with no photo,
  // the GENERATED color field quantized the same way (the pixel-
  // gradient read: a gorgeous smooth field, sampled coarsely)
  if (cells.some((c) => c.treatment === 'mosaic')) {
    const field = !maps && !colorPlan
      ? buildColorField({ palette, seed: lab.seed, T, outW, outH })
      : null
    const pixelColors = lab.look?.id === 'pixels' && colorPlan
      ? colorPlan.depthOrder.filter((index) => index !== colorPlan.roles.ground)
      : []
    for (const c of cells) {
      if (c.treatment !== 'mosaic') continue
      const cx = c.x + c.size / 2
      const cy = c.y + c.size / 2
      if (maps) {
        const u = (cx - rect.x) / rect.w
        const v = (cy - rect.y) / rect.h
        if (u < 0 || u > 1 || v < 0 || v > 1) continue
        const [r, g, b] = sampleRGB(maps, u * maps.w - 0.5, v * maps.h - 0.5)
        ctx.fillStyle = `rgb(${r} ${g} ${b})`
      } else {
        if (colorPlan) {
          const planSample = lab.composition
            ? sampleCompositionPlan(lab.composition, cx, cy, outW, outH)
            : null
          const mass = regionValue(
            lab.seed,
            cx,
            cy,
            Math.min(outW, outH) * 0.22,
            'lab.pixel.mass',
          )
          const sample = Math.max(0, Math.min(
            0.999999,
            0.5
              + (mass - 0.5) * 1.75
              + (planSample?.wave ?? 0) * 0.18
              + (c.t - 0.5) * 0.14,
          ))
          const colorIndex = pixelColors.length > 0
            ? pixelColors[
                Math.min(pixelColors.length - 1, Math.floor(sample * pixelColors.length))
              ]
            : weightedColorIndex(colorPlan, sample)
          ctx.fillStyle = palette[colorIndex]
        } else {
          ctx.fillStyle = rgbCss(field!(cx, cy))
        }
      }
      ctx.fillRect(c.x, c.y, c.size + 0.35, c.size + 0.35)
    }
  }

  // BLOCKS — generic flat fills, except Quilt: its focused renderer owns
  // the patch topology, role-led color groups, and textile seam hierarchy.
  if (!isFrameLook && cells.some((c) => c.treatment === 'blocks')) {
    if (lab.look?.id === 'quilt') {
      const curve = lab.territory.sources.find(
        (source) => source.kind === 'curve' && source.enabled && source.curve,
      )?.curve
      renderQuilt(ctx, {
        width: outW,
        height: outH,
        seed: lab.seed,
        complexity: lab.look.complexity ?? 0.5,
        palette,
        paletteSize: K,
        colorPlan,
        composition: lab.composition,
        curve,
        cells,
        motionPhase: lab.motion.frame?.phase,
        motionAmount: lab.motion.amount,
        motionSpeed: lab.motion.speed,
      })
    } else {
      for (const f of buildBlockFills({
        cells,
        paletteSize: K,
        seed: lab.seed,
        colorPlan,
      })) {
        const { cell } = f
        ctx.fillStyle = palette[f.color]
        ctx.fillRect(cell.x, cell.y, cell.size + 0.35, cell.size + 0.35)
        if (f.accent !== null) {
          const inset = cell.size * 0.3
          ctx.fillStyle = palette[f.accent]
          ctx.lineWidth = Math.max(1, cell.size * 0.055)
          ctx.strokeStyle = palette[f.accent]
          ctx.strokeRect(
            cell.x + inset,
            cell.y + inset,
            cell.size - inset * 2,
            cell.size - inset * 2,
          )
        }
      }
    }
  }

  // BEADS — a fixed hexagonal bead lattice. Size and color carry the
  // territory; positions never wobble into accidental columns.
  if (cells.some((c) => c.treatment === 'beads')) {
    const complexity = Math.max(0, Math.min(1, lab.look?.complexity ?? 0.5))
    const minDim = Math.min(outW, outH)
    const spacing = Math.max(7, minDim * (0.031 - complexity * 0.017))
    const rowStep = spacing * Math.sqrt(3) / 2
    const phase = (((lab.motion.frame?.phase ?? 0) % 1) + 1) % 1 * Math.PI * 2
    const motion = Math.max(0, Math.min(1, lab.motion.amount))
    const groundIndex = colorPlan?.roles.ground ?? 0
    const beadColors = colorPlan?.depthOrder.filter((index) => index !== groundIndex) ?? []
    let row = 0
    for (let cy = -rowStep; cy <= outH + rowStep; cy += rowStep) {
      const rowOffset = row % 2 === 0 ? 0 : spacing / 2
      let column = 0
      for (let cx = -spacing + rowOffset; cx <= outW + spacing; cx += spacing) {
        const territory = compiledTerritory(cx, cy)
        if (territory <= 0.075) {
          column += 1
          continue
        }
        const id = row * 4099 + column
        const edge = Math.max(0, Math.min(1, (territory - 0.075) / 0.72))
        const hero = edge > 0.58 && chan(lab.seed, id, 'lab.bead.hero') > 0.965
        const ring = !hero && chan(lab.seed, id, 'lab.bead.ring') > 0.84
        const pulse = 1 + Math.sin(
          phase + cx / Math.max(1, outW) * Math.PI * 2 + row * 0.17,
        ) * 0.075 * motion
        const radius = spacing
          * (0.18 + Math.pow(edge, 0.62) * 0.19)
          * (hero ? 1.42 : 1)
          * pulse
        const colorSample = regionValue(
          lab.seed,
          cx,
          cy,
          lab.structure.baseCell * 2.8,
          hero ? 'lab.bead.hero.color' : 'lab.bead.color',
        )
        const plannedColor = colorPlan
          ? weightedColorIndex(colorPlan, colorSample)
          : Math.min(K - 1, Math.floor(colorSample * K))
        const colorIndex = plannedColor === groundIndex && beadColors.length
          ? beadColors[Math.min(beadColors.length - 1, Math.floor(colorSample * beadColors.length))]
          : plannedColor
        const fill = hasPalette ? palette[colorIndex] : ink

        ctx.globalAlpha = 0.08 + edge * 0.08
        ctx.fillStyle = ink
        ctx.beginPath()
        ctx.arc(cx + radius * 0.13, cy + radius * 0.17, radius, 0, Math.PI * 2)
        ctx.fill()

        ctx.globalAlpha = 0.58 + edge * 0.42
        ctx.fillStyle = fill
        ctx.beginPath()
        ctx.arc(cx, cy, radius, 0, Math.PI * 2)
        ctx.fill()

        if (ring) {
          ctx.globalAlpha = 1
          ctx.fillStyle = palette[groundIndex]
          ctx.beginPath()
          ctx.arc(cx, cy, radius * 0.47, 0, Math.PI * 2)
          ctx.fill()
        } else if (hero) {
          ctx.globalAlpha = 0.9
          ctx.fillStyle = colorPlan?.roles.accent != null
            ? palette[colorPlan.roles.accent]
            : fill
          ctx.beginPath()
          ctx.arc(cx, cy, radius * 0.34, 0, Math.PI * 2)
          ctx.fill()
        }

        ctx.globalAlpha = 0.12 + edge * 0.12
        ctx.fillStyle = paper
        ctx.beginPath()
        ctx.arc(
          cx - radius * 0.28,
          cy - radius * 0.3,
          Math.max(0.45, radius * 0.14),
          0,
          Math.PI * 2,
        )
        ctx.fill()
        column += 1
      }
      row += 1
    }
    ctx.globalAlpha = 1
  }

  // SHINGLE — per-cell linear gradients between palette neighbors,
  // direction alternating in a weave, leaned by the flow angle
  if (cells.some((c) => c.treatment === 'shingle')) {
    let renderedCurveWeave = false
    if (lab.look?.id === 'weave') {
      const curveSource = lab.territory.sources.find(
        (source) => source.kind === 'curve' && source.enabled && source.curve,
      )
      const curve = curveSource?.curve
        ? sampleCurve(
            {
              ...curveSource.curve,
              sampleDensity: 128,
              curve: curveSource.curve.curve,
            },
            outW,
            outH,
            360,
          )
        : []
      if (curve.length > 1) {
        renderWeave(ctx, {
          width: outW,
          height: outH,
          seed: lab.seed,
          palette,
          colorPlan,
          curve,
          complexity: lab.look.complexity ?? 0.5,
          motionPhase: lab.motion.frame?.phase ?? 0,
          motionAmount: lab.motion.amount,
        })
        renderedCurveWeave = true
      }
    }
    if (!renderedCurveWeave) {
      // Source-aware processing has no fixed curve. Fall back to a woven
      // cell field driven by the captured frame instead of drawing a ghost
      // Meta curve over the material.
      const fills = buildShingleFills({
        cells,
        paletteSize: K,
        seed: lab.seed,
        lean: 0,
        colorPlan,
      })
      for (const f of fills) {
        const { cell } = f
        const cx = cell.x + cell.size / 2
        const cy = cell.y + cell.size / 2
        const dx = (Math.cos(f.angle) * cell.size) / 2
        const dy = (Math.sin(f.angle) * cell.size) / 2
        const g = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy)
        g.addColorStop(0, palette[f.a])
        g.addColorStop(1, palette[f.b])
        ctx.fillStyle = g
        ctx.fillRect(cell.x, cell.y, cell.size + 0.35, cell.size + 0.35)
      }
    }
  }

  // flat ink masses
  ctx.fillStyle = ink
  for (const c of cells) {
    if (c.treatment === 'flat') ctx.fillRect(c.x, c.y, c.size + 0.35, c.size + 0.35)
  }

  // contours: topographic hairlines of the territory itself, clipped to
  // the cells that own them
  const contourCells = cells.filter((c) => c.treatment === 'contours')
  if (contourCells.length) {
    const bandIdx = new Set(contourCells.map((c) => c.band))
    const grid = territoryGrid(T, outW, outH)
    const n = lab.territory.bands.length
    ctx.save()
    const clip = new Path2D()
    for (const c of contourCells) clip.rect(c.x, c.y, c.size + 0.35, c.size + 0.35)
    ctx.clip(clip)
    ctx.strokeStyle = ink
    ctx.lineWidth = 1.1
    for (const b of bandIdx) {
      for (let k = 0; k < 5; k++) {
        const level = (b + (k + 0.5) / 5) / n
        const d = contourAtLevel(grid, level)
        if (d) ctx.stroke(new Path2D(d))
      }
    }
    ctx.restore()
  }

  if (isFrameLook) {
    renderFrameLook(ctx, {
      field: T,
      width: outW,
      height: outH,
      seed: lab.seed,
      complexity: lab.look?.complexity ?? 0.5,
      palette,
      colorPlan,
      motion: {
        phase: lab.motion.frame?.phase,
        amount: lab.motion.amount,
        speed: lab.motion.speed,
      },
      topologyKey: source
        ? undefined
        : JSON.stringify([
            lab.seed,
            outW,
            outH,
            lab.look?.complexity ?? 0.5,
            lab.territory,
            lab.composition,
            colorPlan,
          ]),
    })
  }

  if (lab.look?.id === 'trails') {
    renderTrails(
      ctx,
      lab,
      source ? { source, rect, territory: compiledTerritory } : null,
    )
  }

  // the process treatments share one composed vector field
  const needsVector = cells.some((c) => c.treatment === 'scan' || c.treatment === 'streams')
    || (
      lab.look?.id !== 'brushwork'
      && cells.some((c) => c.treatment === 'dabs')
    )
    || (lab.mark.echo > 0 && cells.some((c) => c.treatment === 'marks'))
  const vector: VectorField | null =
    needsVector
      ? composeFlow(lab.flow, {
          seed: lab.seed,
          outW,
          outH,
          curveAngle: curveAngleFor(lab, outW, outH),
          T,
          motionPhase: lab.motion.frame?.phase,
          motionAmount: lab.motion.amount,
        })
      : null

  // SCAN — calm horizontal scanlines with the source revealed by brighter
  // segments. The lines stay legible while their endpoints describe the mark.
  const scanCells = cells.filter((c) => c.treatment === 'scan')
  if (scanCells.length) {
    const complexity = Math.max(0, Math.min(1, lab.look?.complexity ?? 0.5))
    const minDim = Math.min(outW, outH)
    const spacing = Math.max(4, minDim * (0.018 - complexity * 0.0095))
    const sampleStep = Math.max(2, outW / 360)
    const motionPhase = ((lab.motion.frame?.phase ?? 0) % 1 + 1) % 1
    const motion = Math.max(0, Math.min(1, lab.motion.amount))
    const rowOffset = (
      chan(lab.seed, 0, 'lab.scan.offset') * spacing
      + Math.sin(motionPhase * Math.PI * 2) * spacing * 0.32 * motion
    )
    const rhythm = lab.composition?.rhythm
    ctx.save()
    ctx.lineCap = 'round'
    const baseWidth = Math.max(0.8, minDim * 0.00135)
    let row = 0
    for (let y = -spacing + rowOffset; y <= outH + spacing; y += spacing) {
      const accented = rhythm?.pattern[row % Math.max(1, rhythm.steps)] ?? row % 5 === 0
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(outW, y)
      ctx.strokeStyle = hasPalette
        ? dealPalette(outW * 0.5, y, 'lab.scan.ground')
        : ink
      ctx.lineWidth = baseWidth * (accented ? 1.08 : 0.72)
      ctx.globalAlpha = accented ? 0.14 : 0.075
      ctx.stroke()

      let segment: Path2D | null = null
      let segmentStart = 0
      let peak = 0
      const flushSegment = (endX: number) => {
        if (!segment || endX - segmentStart < sampleStep) {
          segment = null
          peak = 0
          return
        }
        const anchorX = (segmentStart + endX) / 2
        const scanPulse = 0.82 + Math.sin(
          y / Math.max(1, outH) * Math.PI * 6
          + motionPhase * Math.PI * 2,
        ) * 0.18 * motion
        ctx.strokeStyle = hasPalette
          ? dealPalette(anchorX, y, 'lab.scan.subject')
          : ink
        ctx.lineWidth = baseWidth * (1.2 + peak * 1.15 + (accented ? 0.2 : 0))
        ctx.globalAlpha = Math.min(0.96, (0.56 + peak * 0.36) * scanPulse)
        ctx.stroke(segment)
        segment = null
        peak = 0
      }
      for (let x = 0; x <= outW + sampleStep; x += sampleStep) {
        const clampedX = Math.min(outW, x)
        const territory = compiledTerritory(clampedX, y)
        if (territory > 0.1) {
          const ripple = Math.sin(
            clampedX / Math.max(1, outW) * Math.PI * 4
            + row * 0.37,
          ) * spacing * 0.035 * territory
          if (!segment) {
            segment = new Path2D()
            segment.moveTo(clampedX, y + ripple)
            segmentStart = clampedX
          } else {
            segment.lineTo(clampedX, y + ripple)
          }
          peak = Math.max(peak, territory)
        } else if (segment) {
          flushSegment(clampedX)
        }
      }
      flushSegment(outW)
      row += 1
    }
    ctx.globalAlpha = 1
    ctx.restore()
  }

  // STREAMS — long field-line hairlines contained by the curve territory,
  // so the flow enriches the symbol instead of dissolving its silhouette.
  if (vector && cells.some((c) => c.treatment === 'streams')) {
    const streams = buildStreams({
      cells,
      seed: lab.seed,
      field: vector,
      outW,
      outH,
      complexity: lab.look?.complexity ?? 0.5,
      territory: T,
    })
    // each stream takes a palette color where it starts — the walker
    // carries it, so neighbouring seeds make colored braids
    const streamWidth = Math.max(0.65, Math.min(outW, outH) * 0.00105)
    const widthScales = [0.72, 1.14, 1.9] as const
    for (const stream of streams) {
      const pts = stream.points
      const rhythm = lab.composition?.rhythm
      const accented = rhythm?.pattern[stream.id % rhythm.steps] ?? (stream.id % 7 === 0)
      ctx.lineWidth = streamWidth * widthScales[stream.widthClass] * (accented ? 1.25 : 1)
      ctx.globalAlpha = Math.min(0.94, (stream.alphaClass ? 0.76 : 0.54) + (accented ? 0.14 : 0))
      ctx.strokeStyle = hasPalette
        ? dealPalette(stream.seedX, stream.seedY, 'lab.stream.pal')
        : ink
      strokePolyline(ctx, pts)
    }
    ctx.globalAlpha = 1
  }

  // BRUSHWORK — a fixed scene of broad hero gestures, supporting strokes,
  // and sparse bristle texture. Complexity reveals stable IDs from that scene;
  // motion deforms its existing points instead of reseeding cell-sized dabs.
  if (lab.look?.id === 'brushwork') {
    renderBrushwork(ctx, {
      width: outW,
      height: outH,
      seed: lab.seed,
      complexity: lab.look.complexity ?? 0.5,
      composition: lab.composition,
      palette,
      colorPlan,
      territory: T,
      motionPhase: lab.motion.frame?.phase,
      motionAmount: lab.motion.amount,
    })
  }

  // DABS — short strokes riding the flow, density and width from tone
  if (lab.look?.id !== 'brushwork' && vector && cells.some((c) => c.treatment === 'dabs')) {
    const dabs = buildDabs({
      cells,
      maps,
      rect,
      seed: lab.seed,
      field: vector,
      occupancy: lab.mark.occupancy,
      complexity: lab.look?.complexity ?? 0.5,
    })
    const mode = lab.mark.colorMode
    ctx.lineCap = 'round'
    for (const d of dabs) {
      let stroke = ink
      let alpha = 1
      if (mode === 'tint') alpha = tintFor(d.tone)
      else if (mode === 'source' && maps) {
        const [r, g, b] = sampleRGB(maps, d.mx, d.my)
        stroke = `rgb(${r} ${g} ${b})`
      } else if (mode === 'palette') stroke = dealPalette(d.pts[0], d.pts[1], 'lab.dab.pal')
      ctx.strokeStyle = stroke
      ctx.globalAlpha = alpha * (0.12 + d.pressure * 0.12)
      ctx.lineWidth = d.width * 1.65
      strokePolyline(ctx, d.pts)
      ctx.globalAlpha = alpha * (0.58 + d.pressure * 0.34)
      strokeTaperedPolyline(ctx, d.pts, d.width)
      if (d.dry > 0.48) {
        ctx.globalAlpha = alpha * (0.16 + d.dry * 0.18)
        ctx.lineWidth = Math.max(0.55, d.width * 0.12)
        strokePolyline(ctx, offsetPolyline(d.pts, d.width * 0.24))
        strokePolyline(ctx, offsetPolyline(d.pts, -d.width * 0.2))
      }
    }
    ctx.globalAlpha = 1
    ctx.lineCap = 'butt'
  }

  // marks — with or without a source; territory alone can carry them
  if (cells.some((c) => c.treatment === 'marks')) {
    const stamps = buildCellMarks({
      cells,
      params: lab.mark,
      maps,
      rect,
      seed: lab.seed,
      bankSize: Math.max(1, protos.length),
      flowField: flowFieldFor(lab, outW, outH),
      composition: lab.composition,
      outW,
      outH,
    })
    const mode = lab.mark.colorMode
    const echo = Math.round(lab.mark.echo)
    for (const s of stamps) {
      const proto = protos[Math.min(s.protoIndex, protos.length - 1)]
      if (!proto) continue
      let fill = ink
      let alpha = 1
      if (mode === 'tint') alpha = tintFor(s.tone)
      else if (mode === 'source' && maps) {
        const [r, g, b] = sampleRGB(maps, s.mx, s.my)
        fill = `rgb(${r} ${g} ${b})`
      } else if (mode === 'palette') {
        fill = lab.mark.bank !== 'brand'
          && s.hierarchy > 0.82
          && colorPlan?.roles.accent != null
          ? palette[colorPlan.roles.accent]
          : dealPalette(s.x, s.y, 'lab.mark.pal')
      }
      if (lab.mark.bank !== 'brand') {
        alpha *= 0.54 + s.hierarchy * 0.46
      }
      // ECHO: the mark repeats along the flow with a decaying ramp —
      // motion unfolded into space. Echoes stamp first so the live mark
      // sits on top of its own trail.
      if (echo > 0 && vector) {
        let ex = s.x
        let ey = s.y
        let previousX = Math.cos(s.rot)
        let previousY = Math.sin(s.rot)
        const echoes: { x: number; y: number; index: number }[] = []
        for (let e = 1; e <= echo; e += 1) {
          let [vx, vy] = vector(ex, ey)
          const length = Math.hypot(vx, vy) || 1
          vx /= length
          vy /= length
          if (vx * previousX + vy * previousY < 0) {
            vx = -vx
            vy = -vy
          }
          const spacing = s.size * (0.46 + e * 0.045)
          ex += vx * spacing
          ey += vy * spacing
          previousX = vx
          previousY = vy
          echoes.push({ x: ex, y: ey, index: e })
        }
        for (let index = echoes.length - 1; index >= 0; index -= 1) {
          const point = echoes[index]
          stampProto(
            ctx,
            proto,
            point.x,
            point.y,
            s.rot + point.index * 0.035,
            s.size * Math.pow(0.9, point.index),
            fill,
            alpha * Math.pow(0.7, point.index),
          )
        }
      }
      stampProto(ctx, proto, s.x, s.y, s.rot, s.size, fill, alpha)
    }
  }

  // STRENGTH — the Amount blend: below 1, the photo fades back over
  // the whole result, so the effect reads as a modifier of the image
  // rather than its replacement
  const strength = lab.look?.strength ?? 1
  if (source && strength < 1) {
    ctx.save()
    ctx.globalAlpha = Math.min(1, Math.max(0, 1 - strength))
    ctx.drawImage(source.image, rect.x, rect.y, rect.w, rect.h)
    ctx.restore()
  }

  // GRAIN — the shared surface pass: seeded hash noise over the whole
  // composite, so every treatment reads as one printed artifact
  if (lab.finish.grain > 0) applyGrain(ctx, lab.finish.grain, lab.seed)
}

// The generated Look is stable in its own full-artboard coordinate system.
// Editing the 2D transform composites that completed artwork as one clipped
// layer, so the symbol, cells, marks, grain, and source pixels move together.
export function renderLabArtwork(
  ctx: CanvasRenderingContext2D,
  lab: LabState,
  source: LabSource | null,
  protos: ShapeProto[],
  view: LabView,
  transform: ArtworkTransform,
  focusedSourceId?: string | null,
  paintRaster?: PaintRaster | null,
): void {
  const { width: outW, height: outH } = lab.output
  const renderTransform = constrainArtworkToCanvas(
    transform,
    outW,
    outH,
    Math.max(outW, outH) / 3840,
  )
  const artwork = artworkCanvas(outW, outH)
  artwork.setTransform(1, 0, 0, 1, 0, 0)
  artwork.globalAlpha = 1
  artwork.globalCompositeOperation = 'source-over'
  renderLab(artwork, lab, source, protos, view, paintRaster)
  if (focusedSourceId && view === 'composite') {
    renderSourceOverlay(artwork, lab, source, focusedSourceId)
  }

  const transparent = view === 'composite' && lab.territory.bands.includes('empty')
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.clearRect(0, 0, outW, outH)
  if (!transparent) {
    ctx.fillStyle = lab.colors?.paper ?? PAPER
    ctx.fillRect(0, 0, outW, outH)
  }

  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, outW, outH)
  ctx.clip()
  ctx.translate(
    outW * (0.5 + renderTransform.x * 0.5),
    outH * (0.5 + renderTransform.y * 0.5),
  )
  ctx.rotate((renderTransform.rotation * Math.PI) / 180)
  ctx.scale(renderTransform.scale, renderTransform.scale)
  ctx.translate(-outW / 2, -outH / 2)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(artwork.canvas, 0, 0)
  ctx.restore()
}

function renderWeave(
  ctx: CanvasRenderingContext2D,
  options: {
    width: number
    height: number
    seed: number
    palette: string[]
    colorPlan: LabState['colors']['plan']
    curve: readonly { x: number; y: number; angle: number }[]
    complexity: number
    motionPhase: number
    motionAmount: number
  },
): void {
  const {
    width,
    height,
    seed,
    palette,
    colorPlan,
    curve,
    complexity,
    motionPhase,
    motionAmount,
  } = options
  if (curve.length < 2) return
  const c = Math.max(0, Math.min(1, complexity))
  const minDim = Math.min(width, height)
  const strandCount = 3 + Math.round(c * 2)
  const bandWidth = minDim * (0.115 + c * 0.035)
  const threadWidth = Math.max(1.25, bandWidth / (strandCount * 2.25))
  const groundIndex = colorPlan?.roles.ground ?? 0
  const phase = (((motionPhase % 1) + 1) % 1) * Math.PI * 2
  const motion = Math.max(0, Math.min(1, motionAmount))
  const visibleColors = colorPlan?.depthOrder.filter((index) => index !== groundIndex) ?? []
  const strandColors = Array.from({ length: strandCount }, (_, index) => {
    if (!colorPlan) return index % palette.length
    return visibleColors[index % Math.max(1, Math.min(visibleColors.length, 3))]
      ?? colorPlan.roles.dominant
  })
  const cycles = 8 + Math.round(c * 8)
  const seededPhase = chan(seed, 0, 'lab.weave.phase') * Math.PI * 2
  const strandPoints = Array.from({ length: strandCount }, (_, strand) => {
    const strandPhase = seededPhase + strand / strandCount * Math.PI * 2
    return curve.map((point, index) => {
      const progress = index / Math.max(1, curve.length - 1)
      const braidPhase = progress * Math.PI * 2 * cycles
        + strandPhase
        + phase * motion
      const offset = (
        Math.sin(braidPhase) * 0.28
        + Math.sin(braidPhase * 2 + strandPhase) * 0.045
      ) * bandWidth
      return {
        x: point.x - Math.sin(point.angle) * offset,
        y: point.y + Math.cos(point.angle) * offset,
        depth: Math.cos(braidPhase),
      }
    })
  })
  const buildPath = (strand: number, start = 0, end = curve.length - 1): Path2D => {
    const path = new Path2D()
    for (let index = start; index <= end; index += 1) {
      const point = strandPoints[strand][index]
      if (index === start) path.moveTo(point.x, point.y)
      else path.lineTo(point.x, point.y)
    }
    return path
  }

  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (let strand = 0; strand < strandCount; strand += 1) {
    const path = buildPath(strand)
    ctx.strokeStyle = palette[strandColors[strand]]
    ctx.lineWidth = threadWidth
    ctx.globalAlpha = 0.92
    ctx.stroke(path)
  }

  // Redraw only the forward-facing portions with a narrow knockout. This
  // creates a real alternating braid without filling the symbol or adding
  // transverse straps.
  for (let strand = 0; strand < strandCount; strand += 1) {
    const points = strandPoints[strand]
    let runStart = -1
    for (let index = 0; index <= points.length; index += 1) {
      const isOver = index < points.length && points[index].depth > 0.56
      if (isOver && runStart < 0) runStart = Math.max(0, index - 1)
      if ((!isOver || index === points.length) && runStart >= 0) {
        const runEnd = Math.min(points.length - 1, index)
        const path = buildPath(strand, runStart, runEnd)
        ctx.strokeStyle = palette[groundIndex]
        ctx.lineWidth = threadWidth * 1.34
        ctx.globalAlpha = 1
        ctx.stroke(path)
        ctx.strokeStyle = palette[strandColors[strand]]
        ctx.lineWidth = threadWidth
        ctx.stroke(path)
        runStart = -1
      }
    }
  }

  // Resolve the symbol's self-intersection as one deliberate overpass.
  const centerX = width / 2
  const centerY = height / 2
  let crossingIndex = Math.floor(curve.length / 2)
  let crossingDistance = Number.POSITIVE_INFINITY
  for (let index = Math.floor(curve.length * 0.12); index < curve.length * 0.88; index += 1) {
    const dx = curve[index].x - centerX
    const dy = curve[index].y - centerY
    const distance = dx * dx + dy * dy
    if (distance < crossingDistance) {
      crossingDistance = distance
      crossingIndex = index
    }
  }
  const crossingSpan = Math.max(4, Math.round(curve.length * 0.018))
  const crossingStart = Math.max(0, crossingIndex - crossingSpan)
  const crossingEnd = Math.min(curve.length - 1, crossingIndex + crossingSpan)
  const crossingPath = new Path2D()
  for (let index = crossingStart; index <= crossingEnd; index += 1) {
    const point = curve[index]
    if (index === crossingStart) crossingPath.moveTo(point.x, point.y)
    else crossingPath.lineTo(point.x, point.y)
  }
  ctx.strokeStyle = palette[groundIndex]
  ctx.lineWidth = bandWidth * 0.64
  ctx.globalAlpha = 1
  ctx.lineCap = 'butt'
  ctx.stroke(crossingPath)
  ctx.lineCap = 'round'
  for (let strand = 0; strand < strandCount; strand += 1) {
    ctx.strokeStyle = palette[strandColors[strand]]
    ctx.lineWidth = threadWidth
    ctx.stroke(buildPath(strand, crossingStart, crossingEnd))
  }
  ctx.restore()
}

function strokePolyline(ctx: CanvasRenderingContext2D, pts: number[]): void {
  if (pts.length < 4) return
  ctx.beginPath()
  ctx.moveTo(pts[0], pts[1])
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1])
  ctx.stroke()
}

function strokeTaperedPolyline(
  ctx: CanvasRenderingContext2D,
  pts: number[],
  width: number,
): void {
  const segments = pts.length / 2 - 1
  if (segments < 1) return
  for (let index = 0; index < segments; index += 2) {
    const end = Math.min(segments, index + 2)
    const t = (index + end) / (2 * segments)
    const taper = Math.max(0.08, Math.sin(Math.PI * t) ** 0.48)
    ctx.lineWidth = Math.max(0.45, width * taper)
    ctx.beginPath()
    ctx.moveTo(pts[index * 2], pts[index * 2 + 1])
    ctx.lineTo(pts[end * 2], pts[end * 2 + 1])
    ctx.stroke()
  }
}

function offsetPolyline(pts: number[], distance: number): number[] {
  if (pts.length < 4) return pts
  const dx = pts[pts.length - 2] - pts[0]
  const dy = pts[pts.length - 1] - pts[1]
  const length = Math.hypot(dx, dy) || 1
  const offsetX = (-dy / length) * distance
  const offsetY = (dx / length) * distance
  const shifted: number[] = []
  for (let index = 0; index < pts.length; index += 2) {
    shifted.push(pts[index] + offsetX, pts[index + 1] + offsetY)
  }
  return shifted
}

function applyGrain(ctx: CanvasRenderingContext2D, amount: number, seed: number): void {
  const { width, height } = ctx.canvas
  if (typeof document === 'undefined') return
  const key = `${seed}:${Math.round(amount * 1000)}`
  let tile = grainTileCache.get(key)
  if (!tile) {
    tile = document.createElement('canvas')
    tile.width = 256
    tile.height = 256
    const tileContext = tile.getContext('2d')
    if (!tileContext) return
    const image = tileContext.createImageData(tile.width, tile.height)
    const data = image.data
    for (let y = 0; y < tile.height; y += 1) {
      let hash = Math.imul(y + 1, 0x9e3779b1) ^ Math.imul(seed + 1, 0x85ebca6b)
      for (let x = 0; x < tile.width; x += 1) {
        hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35)
        const value = (hash >>> 16) & 0xff
        const offset = (y * tile.width + x) * 4
        data[offset] = value
        data[offset + 1] = value
        data[offset + 2] = value
        data[offset + 3] = 255
      }
    }
    tileContext.putImageData(image, 0, 0)
    grainTileCache.set(key, tile)
    if (grainTileCache.size > 12) {
      grainTileCache.delete(grainTileCache.keys().next().value!)
    }
  }
  const pattern = ctx.createPattern(tile, 'repeat')
  if (!pattern) return
  ctx.save()
  ctx.globalCompositeOperation = 'soft-light'
  ctx.globalAlpha = Math.min(0.16, amount * 0.72)
  ctx.fillStyle = pattern
  ctx.fillRect(0, 0, width, height)
  ctx.restore()
}

function compileTerritoryCached(
  lab: LabState,
  rect: FitRect,
  outW: number,
  outH: number,
  maps: LabSource['maps'] | null,
  paintField: Field | null,
): Field {
  // curve distance lattices are the one expensive compile step — build
  // them through the cache and hand them to compileTerritory as
  // OVERRIDES, so each source keeps its exact place in the fold and its
  // weight/invert/combine semantics (an earlier version re-added curve
  // fields with forced 'add' and silently contradicted the engine)
  const fieldOverrides = new Map<string, Field>()
  const motionWarp = createOrganicMotionWarp(lab.motion, lab.seed, outW, outH)
  for (const src of lab.territory.sources) {
    if (src.kind !== 'curve' || !src.enabled || !src.curve) continue
    const key = `${JSON.stringify(src.curve)}|${outW}x${outH}|${src.softness.toFixed(3)}`
    const staticField = cached(
      curveFieldCache,
      key,
      () => buildCurveField(src.curve!, outW, outH, src.softness),
    )
    fieldOverrides.set(
      src.id,
      motionWarp.field(staticField),
    )
  }
  return compileTerritory(lab.territory, { rect, outW, outH, maps, paintField, fieldOverrides })
}

// the curve's tangent-angle field, cached — null when no curve source
function curveAngleFor(lab: LabState, outW: number, outH: number) {
  const src = lab.territory.sources.find((s) => s.kind === 'curve' && s.enabled && s.curve)
  if (!src?.curve) return null
  const key = `${JSON.stringify(src.curve)}|${outW}x${outH}`
  return cached(flowCache, key, () => {
    const samples = sampleCurve({ ...src.curve!, sampleDensity: 96, curve: src.curve!.curve }, outW, outH, 200)
    return curveFlowField(samples, outW, outH)
  })
}

// marks only hand orientation to the curve when FLOW is dialed in
function flowFieldFor(lab: LabState, outW: number, outH: number) {
  if (lab.mark.flow <= 0) return null
  return curveAngleFor(lab, outW, outH)
}

function drawFieldView(ctx: CanvasRenderingContext2D, f: Field, outW: number, outH: number) {
  // budget the long side — a 64x8192 output must not rasterize 4M samples
  const rw = Math.max(8, Math.round((180 * outW) / Math.max(outW, outH)))
  const rh = Math.max(8, Math.round((rw * outH) / outW))
  const img = new ImageData(rw, rh)
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const v = Math.round(f(((x + 0.5) / rw) * outW, ((y + 0.5) / rh) * outH) * 255)
      const o = (y * rw + x) * 4
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v
      img.data[o + 3] = 255
    }
  }
  blitMap(ctx, img, { x: 0, y: 0, w: outW, h: outH })
}

function drawAnalysisView(
  ctx: CanvasRenderingContext2D,
  maps: NonNullable<LabSource['maps']>,
  rect: FitRect,
  view: 'lum' | 'edge' | 'orient',
) {
  const img = new ImageData(maps.w, maps.h)
  if (view === 'orient') {
    for (let i = 0; i < maps.orientX.length; i++) {
      const conf = Math.min(1, Math.hypot(maps.orientX[i], maps.orientY[i]) * 6)
      const hue = ((0.5 * Math.atan2(maps.orientY[i], maps.orientX[i]) + Math.PI / 2) / Math.PI) * 360
      const [r, g, b] = hslToRgb(hue, 0.75 * conf, 0.52)
      const o = i * 4
      img.data[o] = r
      img.data[o + 1] = g
      img.data[o + 2] = b
      img.data[o + 3] = 255
    }
  } else {
    const data = view === 'lum' ? maps.lum : maps.edge
    for (let i = 0; i < data.length; i++) {
      const v = Math.round(Math.max(0, Math.min(1, data[i])) * 255)
      const o = i * 4
      img.data[o] = img.data[o + 1] = img.data[o + 2] = view === 'edge' ? 255 - v : v
      img.data[o + 3] = 255
    }
  }
  blitMap(ctx, img, rect)
}

function blitMap(
  ctx: CanvasRenderingContext2D,
  img: ImageData,
  rect: { x: number; y: number; w: number; h: number },
): void {
  const m = mapCanvas(img.width, img.height)
  m.putImageData(img, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(m.canvas, rect.x, rect.y, rect.w, rect.h)
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = ((h % 360) + 360) % 360 / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const m = l - c / 2
  const [r, g, b] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x]
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

// The focused field made visible: contour lines of THAT source alone,
// stroked over the composite while its dial drags — Linear/Radial/The
// curve get a live referent instead of asking the user to imagine an
// invisible gradient. Weight is pinned to 1 (a scaled field's fixed-
// level contours would mislead); invert is kept (it genuinely flips
// what the contours enclose).
export function renderSourceOverlay(
  ctx: CanvasRenderingContext2D,
  lab: LabState,
  source: LabSource | null,
  srcId: string,
): void {
  const src = lab.territory.sources.find((s) => s.id === srcId)
  // the painted mask has its own visual (the strokes themselves)
  if (!src || !src.enabled || src.kind === 'paint') return
  const { width: outW, height: outH } = lab.output
  const maps = source?.maps ?? null
  const rect: FitRect = source
    ? fitRect(source.fullW, source.fullH, outW, outH, lab.source?.fit ?? 'contain')
    : { x: 0, y: 0, w: outW, h: outH }
  const solo: LabState = {
    ...lab,
    territory: {
      ...lab.territory,
      gain: 1,
      sources: [{ ...src, weight: 1, combine: 'add' }],
    },
  }
  const T = compileTerritoryCached(solo, rect, outW, outH, maps, null)
  const grid = territoryGrid(T, outW, outH)
  ctx.save()
  ctx.lineJoin = 'round'
  for (const level of [0.25, 0.5, 0.75]) {
    const d = contourAtLevel(grid, level)
    if (!d) continue
    const p = new Path2D(d)
    // white underlay keeps the blue legible on any composite
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'
    ctx.lineWidth = 3
    ctx.stroke(p)
    ctx.strokeStyle = META_BLUE
    ctx.lineWidth = 1.4
    ctx.stroke(p)
  }
  ctx.restore()
}

// Export renders the SAME painter at full output dimensions on a fresh
// canvas — never a scaled screenshot of the preview.
export async function exportLabPng(
  lab: LabState,
  source: LabSource | null,
  protos: ShapeProto[],
  transform: ArtworkTransform = { x: 0, y: 0, scale: 1, rotation: 0 },
  paintRaster?: PaintRaster | null,
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = lab.output.width
  canvas.height = lab.output.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D context unavailable')
  renderLabArtwork(ctx, lab, source, protos, 'composite', transform, null, paintRaster)
  return canvasToPng(canvas)
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
  })
}
