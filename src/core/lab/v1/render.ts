import type { ShapeProto } from '@/core/canvas/shapeProtos'
import { INK, PAPER } from '@/core/state/defaults'
import { contourAtLevel } from '@/core/cloner/contours'
import { sampleCurve } from '@/core/lissajous/sampler'
import type { LabState, LabView, TreatmentId } from '../types'
import type { LookId } from '../looks'
import type { LabSource } from '../sourceCache'
import type { Field, FitRect } from '../field'
import { fieldFromMap, fitRect } from '../field'
import { borderDistanceField } from '../sourceMask'
import { buildCurveField, compileTerritory, territoryGrid } from './territory'
import { buildCellMarks, buildCells, curveFlowField, tintFor } from './composition'
import { buildDabs, buildScanlines, buildStreams, composeFlow, type VectorField } from './flow'
import { buildColorField, hexToRgb, rgbCss } from './colorField'
import { buildBlockFills, buildBeadFills, buildShingleFills, regionValue } from './fills'
import { getPaintRaster, reconcilePaint, type PaintRaster } from '../paintRuntime'
import { sampleMap, sampleRGB } from '../analysis'
import { stampProto } from '../stamp'

// The renderer below is the painter from git commit 67f7de1. Its only
// adaptation is accepting the current render path's optional paint raster.

let scratch: HTMLCanvasElement | null = null

const LOOK_BACKGROUND_TREATMENT: Partial<Record<LookId, TreatmentId>> = {
  frame: 'blocks',
  pixels: 'mosaic',
  scanlines: 'scan',
  streams: 'streams',
  brushwork: 'dabs',
  beads: 'beads',
  quilt: 'blocks',
  weave: 'shingle',
  marks: 'marks',
  trails: 'marks',
}

const LOOK_SUBJECT_TREATMENT: Partial<Record<LookId, TreatmentId>> = {
  ...LOOK_BACKGROUND_TREATMENT,
  frame: 'shingle',
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

function cached<T>(cache: Map<string, T>, key: string, build: () => T): T {
  let hit = cache.get(key)
  if (!hit) {
    if (cache.size > 8) cache.clear()
    hit = build()
    cache.set(key, hit)
  }
  return hit
}

export function renderLabV1(
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
  // A selected Look is always a finished background. Legacy V1 recipes keep
  // their original `empty` bands for compatibility, but those bands now take
  // a Look-specific carrier below instead of exposing a flat/transparent
  // canvas around the Meta field.
  const transparent = view === 'composite'
    && !lab.look?.id
    && lab.territory.bands.includes('empty')
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
  const sourceAwareMaterial = lab.sourceMask === 'border-distance' && source !== null
  const T = sourceAwareMaterial
    ? borderDistanceField(source, rect)
    : compileTerritoryCached(lab, rect, outW, outH, maps, paintField)

  if (view === 'territory') {
    drawFieldView(ctx, T, outW, outH)
    return
  }

  let cells = buildCells({
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
  if (lab.look?.id) {
    const lookId = lab.look.id as LookId
    const backgroundTreatment = LOOK_BACKGROUND_TREATMENT[lookId] ?? 'mosaic'
    const subjectTreatment = LOOK_SUBJECT_TREATMENT[lookId] ?? backgroundTreatment
    const subjectBand = lab.territory.bands.length - 1
    cells = cells.map((cell) =>
      (
        sourceAwareMaterial
        && cell.treatment === 'photo'
      ) || (
        source === null
        && cell.band === subjectBand
        && cell.treatment === 'mosaic'
      )
        ? { ...cell, treatment: subjectTreatment }
        : cell.treatment === 'empty'
        ? { ...cell, treatment: backgroundTreatment }
        : cell)
  }
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
  const K = palette.length
  const integratesLookField = sourceAwareMaterial || lab.look?.id !== undefined
  const dealPalette = (x: number, y: number, channel: string) =>
    palette[
      Math.min(K - 1, Math.floor(regionValue(lab.seed, x, y, lab.structure.baseCell * 2.8, channel) * K))
    ]

  // MATERIAL recolor space. The v1 run palette is 100 weighted slots, so
  // any slot shift is congruent to a near no-op (it rotates within
  // same-color runs) and neighbor-slot gradient pairs collapse to one
  // color. Material treatments therefore rotate through the DISTINCT
  // colors: identical deal at t = 0, a real recolor inside the subject.
  const distinct =
    sourceAwareMaterial && lab.colors?.distinct && lab.colors.distinct.length > 1
      ? lab.colors.distinct
      : null
  const D = distinct?.length ?? 0
  const distinctIndex = distinct
    ? new Map(distinct.map((color, index) => [color, index] as [string, number]))
    : null
  const materialWheel = (slotColor: string, steps: number): string => {
    if (!distinct || !distinctIndex) return slotColor
    const s = ((steps % D) + D) % D
    if (!s) return slotColor
    return distinct[((distinctIndex.get(slotColor) ?? 0) + s) % D]
  }
  const materialShift = (slotColor: string, t: number): string =>
    materialWheel(slotColor, Math.min(D - 1, Math.floor(t * D)))
  // the distinct colors sorted light -> dark: a tonal ramp for the fill
  // treatments' SUBJECT interiors. The shaded territory indexes it, so
  // blocks and shingles render the lit form as quantized tone while the
  // ground keeps its region-dealt camo.
  const materialRamp = distinct
    ? [...distinct].sort((a, b) => {
        const [ar, ag, ab] = hexToRgb(a)
        const [br, bg, bb] = hexToRgb(b)
        return (
          0.2126 * br + 0.7152 * bg + 0.0722 * bb
          - (0.2126 * ar + 0.7152 * ag + 0.0722 * ab)
        )
      })
    : null
  const rampIndex = materialRamp
    ? new Map(materialRamp.map((color, index) => [color, index] as [string, number]))
    : null
  // normalized lit-form shading recovered from the shaded border mask
  // (0 on lit faces, 1 in the deepest shadow; only meaningful inside)
  const materialShade = (t: number): number =>
    Math.max(0, Math.min(1, (t - 0.35) / 0.65))
  // the complexity dial recovered from the v1 detail mapping (baseCell
  // 16..88) — material-only responses hang off this so the slider drives
  // posterization depth and color feature size, not just cell pitch
  const materialDetail = Math.max(0, Math.min(1, (88 - lab.structure.baseCell) / 72))

  // mosaic: the source quantized to the cell grid — or, with no photo,
  // the GENERATED color field quantized the same way (the pixel-
  // gradient read: a gorgeous smooth field, sampled coarsely)
  if (cells.some((c) => c.treatment === 'mosaic')) {
    const field = !maps || sourceAwareMaterial
      ? buildColorField({
          palette,
          seed: lab.seed,
          T,
          outW,
          outH,
          // complexity shrinks the color features too, so a finer pitch
          // re-samples a busier field instead of the same broad gradient
          ...(sourceAwareMaterial
            ? { featurePx: Math.min(outW, outH) * (0.34 - materialDetail * 0.26) }
            : {}),
        })
      : null
    // material posterization depth: few chunky levels at low complexity,
    // many at high — the render itself pixelates through the cell grid
    const levels = 3 + Math.round(materialDetail * 9)
    const q = (v: number) =>
      Math.round((Math.round((v / 255) * (levels - 1)) / (levels - 1)) * 255)
    for (const c of cells) {
      if (c.treatment !== 'mosaic') continue
      const cx = c.x + c.size / 2
      const cy = c.y + c.size / 2
      if (maps && !sourceAwareMaterial) {
        const u = (cx - rect.x) / rect.w
        const v = (cy - rect.y) / rect.h
        if (u < 0 || u > 1 || v < 0 || v > 1) continue
        const [r, g, b] = sampleRGB(maps, u * maps.w - 0.5, v * maps.h - 0.5)
        ctx.fillStyle = `rgb(${r} ${g} ${b})`
      } else if (sourceAwareMaterial && maps) {
        // the actual render, quantized to the cell grid inside the
        // silhouette; the generated palette field carries the ground
        const u = (cx - rect.x) / rect.w
        const v = (cy - rect.y) / rect.h
        const mx = u * maps.w - 0.5
        const my = v * maps.h - 0.5
        const inside =
          u >= 0 && u <= 1 && v >= 0 && v <= 1 &&
          sampleMap(maps.alpha, maps.w, maps.h, mx, my) > 0.5
        if (inside) {
          // amplify the lit form before quantizing — the near-white
          // model's own contrast is too shallow for posterization to
          // read, so the normalized shading deepens it
          const deepen = 1 - 0.45 * materialShade(T(cx, cy))
          const [r, g, b] = sampleRGB(maps, mx, my)
          ctx.fillStyle = `rgb(${q(r * deepen)} ${q(g * deepen)} ${q(b * deepen)})`
        } else {
          ctx.fillStyle = rgbCss(field!(cx, cy))
        }
      } else {
        ctx.fillStyle = rgbCss(field!(cx, cy))
      }
      ctx.fillRect(c.x, c.y, c.size + 0.35, c.size + 0.35)
    }
  }

  // BLOCKS — the flat color quilt: flush palette fills whose neighbor
  // coherence merges cells into larger shapes; rare nested accents
  if (cells.some((c) => c.treatment === 'blocks')) {
    for (const f of buildBlockFills({ cells, paletteSize: K, seed: lab.seed })) {
      const { cell } = f
      if (distinct) {
        // subject interior: the tonal ramp indexed by the lit form (with
        // region jitter keeping the quilt texture); ground keeps the
        // weighted camo — the run-palette shift was congruent to a no-op
        if (cell.t > 0.05 && materialRamp) {
          const jitter = ((f.color + 0.5) / K - 0.5) * 1.6
          const idx = Math.max(
            0,
            Math.min(D - 1, Math.round(materialShade(cell.t) * (D - 1) + jitter)),
          )
          ctx.fillStyle = materialRamp[idx]
        } else {
          ctx.fillStyle = materialShift(palette[f.color % K], cell.t)
        }
        ctx.fillRect(cell.x, cell.y, cell.size + 0.35, cell.size + 0.35)
        if (f.accent !== null) {
          const inset = cell.size * 0.3
          ctx.fillStyle = materialShift(palette[f.accent % K], cell.t)
          ctx.fillRect(cell.x + inset, cell.y + inset, cell.size - inset * 2, cell.size - inset * 2)
        }
        continue
      }
      const sourceShift = integratesLookField
        ? Math.min(K - 1, Math.floor(cell.t * K))
        : 0
      ctx.fillStyle = palette[(f.color + sourceShift) % K]
      ctx.fillRect(cell.x, cell.y, cell.size + 0.35, cell.size + 0.35)
      if (f.accent !== null) {
        const inset = cell.size * 0.3
        ctx.fillStyle = palette[(f.accent + sourceShift) % K]
        ctx.fillRect(cell.x + inset, cell.y + inset, cell.size - inset * 2, cell.size - inset * 2)
      }
    }
  }

  // BEADS — the pegboard: every cell draws a circle, ground beads
  // included; colored runs travel down columns
  if (cells.some((c) => c.treatment === 'beads')) {
    const pg = hexToRgb(paper)
    const groundBead = rgbCss([pg[0] * 0.94 + 8, pg[1] * 0.94 + 8, pg[2] * 0.94 + 8])
    const beadFills = buildBeadFills({
      cells,
      paletteSize: K,
      seed: lab.seed,
      // material: quiet the background columns so colored runs
      // concentrate on the subject instead of matching its brightness
      ...(sourceAwareMaterial
        ? { activityScale: (cell: { t: number }) => 0.42 + 0.25 * cell.t }
        : {}),
    })
    for (const f of beadFills) {
      const { cell } = f
      const cx = cell.x + cell.size / 2
      const cy = cell.y + cell.size / 2
      if (sourceAwareMaterial) {
        const active = f.active || cell.t > 0.18
        const base = palette[f.color % K]
        ctx.fillStyle = active ? materialShift(base, cell.t) : groundBead
        ctx.beginPath()
        // radius carries the lit form: small on the ground and on lit
        // faces, swelling through the shaded T into the shadows
        ctx.arc(cx, cy, cell.size * (0.33 + cell.t * 0.17), 0, Math.PI * 2)
        ctx.fill()
        if (f.inner !== null || cell.t > 0.42) {
          const innerBase = f.inner !== null ? palette[f.inner % K] : base
          ctx.fillStyle = materialWheel(
            innerBase,
            Math.min(D - 1, Math.floor(cell.t * D)) + 1,
          )
          ctx.beginPath()
          ctx.arc(cx, cy, cell.size * 0.2, 0, Math.PI * 2)
          ctx.fill()
        }
        continue
      }
      const sourceShift = integratesLookField
        ? Math.min(K - 1, Math.floor(cell.t * K))
        : 0
      const active = f.active || (integratesLookField && cell.t > 0.18)
      ctx.fillStyle = active
        ? palette[(f.color + sourceShift) % K]
        : groundBead
      ctx.beginPath()
      ctx.arc(
        cx,
        cy,
        cell.size * (integratesLookField ? 0.4 + cell.t * 0.08 : 0.47),
        0,
        Math.PI * 2,
      )
      ctx.fill()
      if (f.inner !== null || (integratesLookField && cell.t > 0.42)) {
        const inner = f.inner ?? (f.color + Math.max(1, sourceShift)) % K
        ctx.fillStyle = palette[(inner + sourceShift) % K]
        ctx.beginPath()
        ctx.arc(cx, cy, cell.size * 0.2, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  // SHINGLE — per-cell linear gradients between palette neighbors,
  // direction alternating in a weave, leaned by the flow angle
  if (cells.some((c) => c.treatment === 'shingle')) {
    // lean deliberately 0: the flow-angle coupling was unreachable from
    // the UI (shingle never opens the Direction section) — a hidden
    // input that could silently tilt the weave is worse than none.
    // MATERIAL: shingles inside the silhouette lean with the captured
    // frame's edge orientation, so the weave follows the lit form.
    const materialLean =
      sourceAwareMaterial && maps
        ? (cell: { x: number; y: number; size: number }) => {
            const cx = cell.x + cell.size / 2
            const cy = cell.y + cell.size / 2
            const u = (cx - rect.x) / rect.w
            const v = (cy - rect.y) / rect.h
            if (u < 0 || u > 1 || v < 0 || v > 1) return 0
            const mx = u * maps.w - 0.5
            const my = v * maps.h - 0.5
            if (sampleMap(maps.alpha, maps.w, maps.h, mx, my) < 0.5) return 0
            const ox = sampleMap(maps.orientX, maps.w, maps.h, mx, my)
            const oy = sampleMap(maps.orientY, maps.w, maps.h, mx, my)
            const confidence = Math.min(1, Math.hypot(ox, oy) * 6)
            return 0.5 * Math.atan2(oy, ox) * confidence
          }
        : undefined
    const fills = buildShingleFills({
      cells,
      // the distinct palette restores REAL neighbor gradients — over the
      // 100-slot run palette a and a+1 are almost always the same color
      paletteSize: distinct ? D : K,
      seed: lab.seed,
      lean: 0,
      ...(materialLean ? { leanAt: materialLean } : {}),
    })
    for (const f of fills) {
      const { cell } = f
      const cx = cell.x + cell.size / 2
      const cy = cell.y + cell.size / 2
      const dx = (Math.cos(f.angle) * cell.size) / 2
      const dy = (Math.sin(f.angle) * cell.size) / 2
      const g = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy)
      if (distinct) {
        // subject interior: gradient pairs walk the tonal ramp with the
        // lit form (region jitter keeps the woven texture); the ground
        // weaves neighbor gradients over the distinct colors
        if (cell.t > 0.05 && materialRamp) {
          const jitter = ((f.a + 0.5) / D - 0.5) * 1.4
          const a = Math.max(
            0,
            Math.min(D - 2, Math.round(materialShade(cell.t) * (D - 1) + jitter)),
          )
          g.addColorStop(0, materialRamp[a])
          g.addColorStop(1, materialRamp[a + 1])
        } else if (materialRamp && rampIndex) {
          // ground: WEIGHTED color frequency (the same region deal the
          // classic shingle makes) paired with its tonal ramp neighbor —
          // a calm silky weave; uniform distinct pairs overweighted the
          // dark colors and camouflaged the subject
          const r = regionValue(lab.seed, cx, cy, cell.size * 3.2, 'lab.shingle')
          const slotColor = palette[Math.min(K - 1, Math.floor(r * K))]
          // the deepest tones are reserved for the subject's shading —
          // a ground that also goes full-dark camouflages the model
          const ai = Math.max(0, Math.min(rampIndex.get(slotColor) ?? 0, D - 3))
          g.addColorStop(0, materialRamp[ai])
          g.addColorStop(1, materialRamp[Math.min(D - 2, ai + 1)])
        } else {
          g.addColorStop(0, distinct[f.a % D])
          g.addColorStop(1, distinct[f.b % D])
        }
      } else {
        const sourceShift = integratesLookField
          ? Math.min(K - 1, Math.floor(cell.t * K))
          : 0
        g.addColorStop(0, palette[(f.a + sourceShift) % K])
        g.addColorStop(1, palette[(f.b + sourceShift) % K])
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

  // the process treatments share one composed vector field
  const needsVector =
    cells.some((c) => c.treatment === 'dabs' || c.treatment === 'streams') ||
    (lab.mark.echo > 0 && cells.some((c) => c.treatment === 'marks'))
  const vector: VectorField | null =
    needsVector
      ? composeFlow(
          // material: the curve source is stripped, so a 'curve' basis
          // would silently fall to a fixed angle. The contour basis over
          // the shaded border-distance T flows along the silhouette and
          // its shading level-sets — the render steers the flow.
          sourceAwareMaterial ? { ...lab.flow, basis: 'contour' } : lab.flow,
          {
            seed: lab.seed,
            outW,
            outH,
            curveAngle: curveAngleFor(lab, outW, outH),
            T,
          },
        )
      : null

  // SCAN — slit-scan hairlines displaced by the image, clipped to their
  // territory
  const scanCells = cells.filter((c) => c.treatment === 'scan')
  if (scanCells.length) {
    const lines = buildScanlines({
      outW,
      outH,
      spacing: Math.max(3, lab.structure.baseCell / 3),
      warp: lab.flow.warp,
      maps,
      rect,
      field: null,
      bend: 0,
    })
    ctx.save()
    const clip = new Path2D()
    for (const c of scanCells) clip.rect(c.x, c.y, c.size + 0.35, c.size + 0.35)
    ctx.clip(clip)
    ctx.lineWidth = 1.1
    // lines deal from the palette (coherent patches along the scan) —
    // hardcoded ink left the palette dead for every line treatment
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const pts = lines[lineIndex]
      const baseColor = hasPalette ? dealPalette(pts[0], pts[1], 'lab.scan.pal') : ink
      if (lab.look?.id !== 'scanlines') {
        ctx.strokeStyle = baseColor
        strokePolyline(ctx, pts)
        continue
      }
      for (let index = 2; index < pts.length; index += 2) {
        const startX = pts[index - 2]
        const startY = pts[index - 1]
        const endX = pts[index]
        const endY = pts[index + 1]
        const startAmount = T(startX, startY)
        const endAmount = T(endX, endY)
        const amount = (startAmount + endAmount) / 2
        if (sourceAwareMaterial) {
          // the model's own shading lifts the lines (shaded T: silhouette
          // × normalized lit form) — a ridge-line read of the render
          // instead of the synthetic sine ramp; color deals per segment
          // so a line can't vanish full-width against the ground
          const disp = Math.max(4, lab.structure.baseCell * 0.6)
          const segColor = hasPalette
            ? dealPalette(startX, startY, 'lab.scan.pal')
            : ink
          ctx.strokeStyle = amount > 0.18
            ? (lineIndex % 3 === 0 ? paper : ink)
            : segColor
          ctx.globalAlpha = 0.72 + amount * 0.25
          ctx.lineWidth = 0.9 + amount * 1.35
          ctx.beginPath()
          ctx.moveTo(startX, startY - startAmount * disp)
          ctx.lineTo(endX, endY - endAmount * disp)
          ctx.stroke()
          continue
        }
        const displacement = Math.max(1.5, lab.structure.baseCell * 0.12)
        const displace = (x: number, y: number, influence: number) =>
          y + Math.sin(
            x / Math.max(12, lab.structure.baseCell * 0.85)
            + lineIndex * 0.38,
          ) * displacement * influence
        ctx.strokeStyle = amount > 0.18
          ? (lineIndex % 3 === 0 ? paper : ink)
          : baseColor
        ctx.globalAlpha = 0.72 + amount * 0.25
        ctx.lineWidth = 0.9 + amount * 1.35
        ctx.beginPath()
        ctx.moveTo(startX, displace(startX, startY, startAmount))
        ctx.lineTo(endX, displace(endX, endY, endAmount))
        ctx.stroke()
      }
    }
    ctx.globalAlpha = 1
    ctx.restore()
  }

  // STREAMS — long field-line hairlines. Seeded BY their territory but
  // free to travel: walkers obey the field, not the band boundary
  if (vector && cells.some((c) => c.treatment === 'streams')) {
    const streams = buildStreams({
      cells,
      seed: lab.seed,
      field: vector,
      outW,
      outH,
      // material: seed density concentrates on the subject — sparse
      // ground, dense braids tracing the silhouette and its shading
      ...(sourceAwareMaterial
        ? { presence: (cell: { t: number }) => 0.22 + 0.7 * Math.min(1, cell.t * 1.4) }
        : {}),
    })
    ctx.lineWidth = 1
    ctx.globalAlpha = 0.85
    // each stream takes a palette color where it starts — the walker
    // carries it, so neighbouring seeds make colored braids
    for (const pts of streams) {
      ctx.strokeStyle = hasPalette ? dealPalette(pts[0], pts[1], 'lab.stream.pal') : ink
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
      ...(sourceAwareMaterial ? { material: true } : {}),
    })
    const mode = lab.mark.colorMode
    ctx.lineCap = 'round'
    for (const d of dabs) {
      let stroke = ink
      let alpha = 1
      if (mode === 'tint') alpha = tintFor(d.tone)
      else if (mode === 'source' && maps) {
        // material ground dabs deal from the palette — sampling the
        // ground color painted invisible (formerly black) strokes
        if (
          sourceAwareMaterial &&
          sampleMap(maps.alpha, maps.w, maps.h, d.mx, d.my) < 0.5
        ) {
          stroke = dealPalette(d.pts[0], d.pts[1], 'lab.dab.pal')
          alpha = 0.9
        } else {
          const [r, g, b] = sampleRGB(maps, d.mx, d.my)
          stroke = `rgb(${r} ${g} ${b})`
        }
      } else if (mode === 'palette') stroke = dealPalette(d.pts[0], d.pts[1], 'lab.dab.pal')
      ctx.strokeStyle = stroke
      ctx.globalAlpha = alpha
      ctx.lineWidth = d.width
      strokePolyline(ctx, d.pts)
    }
    ctx.globalAlpha = 1
    ctx.lineCap = 'butt'
  }

  // marks — with or without a source; territory alone can carry them
  if (cells.some((c) => c.treatment === 'marks')) {
    const fullFrameMarkCarrier = sourceAwareMaterial
      || lab.look?.id === 'marks'
      || lab.look?.id === 'trails'
    const markCells = fullFrameMarkCarrier
      ? cells.map((cell) =>
          cell.treatment === 'marks'
            ? {
                ...cell,
                // material: the subject interior gets a HIGH tone floor
                // (dense mass, shading modulating on top) while the
                // ground keeps its calm 0.32 — without the floor the lit
                // faces of a bright model render hollow
                t: sourceAwareMaterial
                  ? cell.t <= 0.05
                    ? 0.32
                    : 0.7 + 0.3 * materialShade(cell.t)
                  : 0.32 + cell.t * 0.68,
              }
            : cell)
      : cells
    const stamps = buildCellMarks({
      cells: markCells,
      params: lab.mark,
      // material: maps stay CONNECTED — edge/detail select and rotate the
      // stamps from the real render; tone comes from the shaded territory
      // (raw 1-lum on a near-white model would hollow out the lit form)
      maps,
      rect,
      seed: lab.seed,
      bankSize: Math.max(1, protos.length),
      flowField: flowFieldFor(lab, outW, outH),
      ...(sourceAwareMaterial ? { toneFromTerritory: true } : {}),
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
      } else if (mode === 'palette') fill = dealPalette(s.x, s.y, 'lab.mark.pal')
      // ECHO: the mark repeats along the flow with a decaying ramp —
      // motion unfolded into space. Echoes stamp first so the live mark
      // sits on top of its own trail.
      if (echo > 0 && vector) {
        let ex = s.x
        let ey = s.y
        const [vx, vy] = vector(s.x, s.y)
        const l = Math.hypot(vx, vy) || 1
        const stepX = (vx / l) * s.size * 0.7
        const stepY = (vy / l) * s.size * 0.7
        for (let e = echo; e >= 1; e--) {
          ex = s.x + stepX * e
          ey = s.y + stepY * e
          stampProto(
            ctx,
            proto,
            ex,
            ey,
            s.rot,
            s.size * Math.pow(0.88, e),
            fill,
            alpha * Math.pow(0.62, e),
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

function strokePolyline(ctx: CanvasRenderingContext2D, pts: number[]): void {
  if (pts.length < 4) return
  ctx.beginPath()
  ctx.moveTo(pts[0], pts[1])
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1])
  ctx.stroke()
}

function applyGrain(ctx: CanvasRenderingContext2D, amount: number, seed: number): void {
  const { width, height } = ctx.canvas
  const img = ctx.getImageData(0, 0, width, height)
  const d = img.data
  const amp = amount * 34
  for (let y = 0; y < height; y++) {
    let h = Math.imul(y + 1, 0x9e3779b1) ^ Math.imul(seed + 1, 0x85ebca6b)
    for (let x = 0; x < width; x++) {
      h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
      const n = (((h >>> 16) & 0xff) / 255 - 0.5) * amp
      const o = (y * width + x) * 4
      d[o] += n
      d[o + 1] += n
      d[o + 2] += n
    }
  }
  ctx.putImageData(img, 0, 0)
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
  for (const src of lab.territory.sources) {
    if (src.kind !== 'curve' || !src.enabled || !src.curve) continue
    const key = `${JSON.stringify(src.curve)}|${outW}x${outH}|${src.softness.toFixed(3)}`
    fieldOverrides.set(
      src.id,
      cached(curveFieldCache, key, () => buildCurveField(src.curve!, outW, outH, src.softness)),
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
export function renderSourceOverlayV1(
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
    ctx.strokeStyle = '#0668e1'
    ctx.lineWidth = 1.4
    ctx.stroke(p)
  }
  ctx.restore()
}
