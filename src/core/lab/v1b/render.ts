import type { ShapeProto } from '@/core/canvas/shapeProtos'
import { META_BLUE } from '@/core/color/brand'
import { chan } from '@/core/organic/random'
import { INK, PAPER } from '@/core/state/defaults'
import { contourAtLevel } from '@/core/cloner/contours'
import { sampleCurve } from '@/core/lissajous/sampler'
import type { LabState, LabView } from '../types'
import type { LabSource } from '../sourceCache'
import type { Field, FitRect } from '../field'
import { fieldFromMap, fitRect } from '../field'
import { buildCurveField, compileTerritory, territoryGrid } from '../territory'
import { buildCellMarks, buildCells, curveFlowField, tintFor } from './composition'
import { buildDabs, buildStreams, composeFlow, type VectorField } from './flow'
import { buildColorField, hexToRgb, rgbCss } from '../colorField'
import { buildBlockFills, buildShingleFills, regionValue } from './fills'
import { getPaintRaster, reconcilePaint, type PaintRaster } from '../paintRuntime'
import { sampleRGB } from '../analysis'
import { stampProto } from '../stamp'
import { createOrganicMotionWarp } from '../motion'
import { artDirectTerritory, sampleCompositionPlan } from '../compositionPlan'
import { inkColorIndex, weightedColorIndex } from './colorDirection'

// One painter for preview AND export. The ctx arrives pre-scaled and
// everything draws in output units. Per-render work is lazy: the
// territory Field only evaluates where cells ask, and the two heavy
// lattices (curve distance, curve flow) cache across renders.

let scratch: HTMLCanvasElement | null = null

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

export function renderLabV1b(
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
  const compiledTerritory = compileTerritoryCached(lab, rect, outW, outH, maps, paintField)
  const directedTerritory = lab.composition
    ? artDirectTerritory(lab.composition, compiledTerritory, outW, outH)
    : compiledTerritory
  // With a Look active the symbol is the composition: art direction
  // modulates the territory but never rewrites it. Full-strength
  // direction (focal lifts strong enough to mint their own islands)
  // remains the source-editor behavior, where no Look is set.
  const preserveSilhouette = lab.look?.id != null
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
  // strokes and marks sit ON the ground — dealing them the ground color
  // would erase them, so their deals come from the ink swatches only
  const dealInkPalette = (x: number, y: number, channel: string) => {
    const sample = regionValue(lab.seed, x, y, lab.structure.baseCell * 2.8, channel)
    const index = colorPlan
      ? inkColorIndex(colorPlan, sample)
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
    // Pixels reads as the reference's soft quantized gradient: territory
    // drives a ramp from the ground at the far field through ever
    // stronger ink toward the symbol core, with only mild weather.
    const pixelColors = lab.look?.id === 'pixels' && colorPlan
      ? colorPlan.depthOrder
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
            pixelColors.length > 0
              ? c.t * 0.92 - 0.18
                + (mass - 0.5) * 0.16
                + (planSample?.wave ?? 0) * 0.05
              : 0.5
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

  // BLOCKS — the flat color quilt: flush palette fills whose neighbor
  // coherence merges cells into larger shapes; rare nested accents
  if (cells.some((c) => c.treatment === 'blocks')) {
    for (const f of buildBlockFills({
      cells,
      paletteSize: K,
      seed: lab.seed,
      colorPlan,
    })) {
      const { cell } = f
      ctx.fillStyle = palette[f.color]
      const quilt = lab.look?.id === 'quilt'
      const gap = quilt ? Math.max(0.7, cell.size * 0.025) : 0
      ctx.fillRect(
        cell.x + gap,
        cell.y + gap,
        cell.size - gap * 2 + (quilt ? 0 : 0.35),
        cell.size - gap * 2 + (quilt ? 0 : 0.35),
      )
      if (f.accent !== null) {
        const inset = cell.size * 0.3
        ctx.fillStyle = palette[f.accent]
        if (quilt) {
          ctx.beginPath()
          ctx.moveTo(cell.x + gap, cell.y + gap)
          ctx.lineTo(cell.x + cell.size - gap, cell.y + gap)
          ctx.lineTo(cell.x + cell.size - gap, cell.y + cell.size - gap)
          ctx.closePath()
          ctx.fill()
        } else {
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
      // a full-range light-to-ink gradient reads as beveled satin, not
      // woven cloth — compress high-contrast pairs toward their midpoint
      const contrast = colorPlan
        ? Math.abs(
            (colorPlan.swatches[f.a]?.lightness ?? 0.5)
            - (colorPlan.swatches[f.b]?.lightness ?? 0.5),
          )
        : 0
      if (contrast > 0.18) {
        g.addColorStop(0, mixHexColors(palette[f.a], palette[f.b], 0.28))
        g.addColorStop(1, mixHexColors(palette[f.a], palette[f.b], 0.72))
      } else {
        g.addColorStop(0, palette[f.a])
        g.addColorStop(1, palette[f.b])
      }
      ctx.fillStyle = g
      ctx.fillRect(cell.x, cell.y, cell.size + 0.35, cell.size + 0.35)
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

  if (lab.look?.id === 'frame') {
    const grid = territoryGrid(T, outW, outH, 160)
    const levels = 10 + Math.round((lab.look.complexity ?? 0.5) * 10)
    // ground-colored rings would vanish into the paper they band
    const ringColors = colorPlan
      ? colorPlan.depthOrder.filter((index) => index !== colorPlan.roles.ground)
      : []
    ctx.save()
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    for (let index = 0; index < levels; index += 1) {
      const level = 0.12 + (index / Math.max(1, levels - 1)) * 0.76
      const pathData = contourAtLevel(grid, level)
      if (!pathData) continue
      const path = new Path2D(pathData)
      const paletteIndex = ringColors.length > 0
        ? ringColors[index % ringColors.length]
        : index % palette.length
      ctx.globalAlpha = index % 4 === 0 ? 0.92 : 0.56
      ctx.lineWidth = index % 4 === 0 ? 2.2 : 0.85
      ctx.strokeStyle = palette[paletteIndex]
      ctx.stroke(path)
    }
    ctx.restore()
  }

  // the process treatments share one composed vector field
  const needsVector =
    cells.some((c) => c.treatment === 'scan' || c.treatment === 'dabs' || c.treatment === 'streams') ||
    (lab.mark.echo > 0 && cells.some((c) => c.treatment === 'marks'))
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
    const spacing = Math.max(4, minDim * (0.024 - complexity * 0.015))
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
        ? dealInkPalette(outW * 0.5, y, 'lab.scan.ground')
        : ink
      ctx.lineWidth = baseWidth * (accented ? 1.08 : 0.72)
      ctx.globalAlpha = accented ? 0.2 : 0.11
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
        // neutral at rest: the pulse only dims while motion breathes
        const scanPulse = 1 + (Math.sin(
          y / Math.max(1, outH) * Math.PI * 6
          + motionPhase * Math.PI * 2,
        ) - 1) * 0.18 * motion
        ctx.strokeStyle = hasPalette
          ? dealInkPalette(anchorX, y, 'lab.scan.subject')
          : ink
        ctx.lineWidth = baseWidth * (1.2 + peak * 1.15 + (accented ? 0.2 : 0))
        ctx.globalAlpha = Math.min(0.96, (0.62 + peak * 0.34) * scanPulse)
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
    const streamWidth = Math.max(0.9, Math.min(outW, outH) * 0.0013)
    const widthScales = [0.85, 1.25, 1.95] as const
    for (const stream of streams) {
      const pts = stream.points
      const rhythm = lab.composition?.rhythm
      const accented = rhythm?.pattern[stream.id % rhythm.steps] ?? (stream.id % 7 === 0)
      ctx.lineWidth = streamWidth * widthScales[stream.widthClass] * (accented ? 1.25 : 1)
      ctx.globalAlpha = Math.min(0.94, (stream.alphaClass ? 0.86 : 0.68) + (accented ? 0.08 : 0))
      ctx.strokeStyle = hasPalette
        ? dealInkPalette(stream.seedX, stream.seedY, 'lab.stream.pal')
        : ink
      strokePolyline(ctx, pts)
    }
    ctx.globalAlpha = 1
  }

  // DABS — short strokes riding the flow, density and width from tone
  if (vector && cells.some((c) => c.treatment === 'dabs')) {
    const dabs = buildDabs({
      cells,
      maps,
      rect,
      seed: lab.seed,
      field: vector,
      occupancy: lab.mark.occupancy,
      complexity: lab.look?.complexity ?? 0.5,
      minDim: Math.min(outW, outH),
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
      } else if (mode === 'palette') stroke = dealInkPalette(d.pts[0], d.pts[1], 'lab.dab.pal')
      ctx.strokeStyle = stroke
      ctx.globalAlpha = alpha * (0.05 + d.pressure * 0.05)
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
          : dealInkPalette(s.x, s.y, 'lab.mark.pal')
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

function mixHexColors(a: string, b: string, amount: number): string {
  const [ar, ag, ab] = hexToRgb(a)
  const [br, bg, bb] = hexToRgb(b)
  return rgbCss([
    ar + (br - ar) * amount,
    ag + (bg - ag) * amount,
    ab + (bb - ab) * amount,
  ])
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
    // a finer lattice keeps tangents coherent through the crossover,
    // where nearest-point tangents on a coarse grid shear into a shelf
    return curveFlowField(samples, outW, outH, 128)
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
export function renderSourceOverlayV1b(
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
