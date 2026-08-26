import type { ShapeProto } from '@/core/canvas/shapeProtos'
import { META_BLUE } from '@/core/color/brand'
import { INK, PAPER } from '@/core/state/defaults'
import { contourAtLevel } from '@/core/cloner/contours'
import { sampleCurve } from '@/core/lissajous/sampler'
import type { LabState, LabView } from './types'
import type { LabSource } from './sourceCache'
import type { Field, FitRect } from './field'
import { fieldFromMap, fitRect } from './field'
import { buildCurveField, compileTerritory, territoryGrid } from './territory'
import { buildCellMarks, buildCells, curveFlowField, tintFor } from './composition'
import { buildDabs, buildScanlines, buildStreams, composeFlow, type VectorField } from './flow'
import { buildColorField, hexToRgb, rgbCss } from './colorField'
import { buildBlockFills, buildBeadFills, buildShingleFills, regionValue } from './fills'
import { getPaintRaster, reconcilePaint } from './paintRuntime'
import { sampleRGB } from './analysis'
import { stampProto } from './stamp'
import { createOrganicMotionWarp } from './motion'
import { constrainArtworkCover } from './artworkTransform'

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
  reconcilePaint(lab.paint)
  const paint = getPaintRaster()
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
  const T = compileTerritoryCached(lab, rect, outW, outH, maps, paintField)

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
  const K = palette.length
  const dealPalette = (x: number, y: number, channel: string) =>
    palette[
      Math.min(K - 1, Math.floor(regionValue(lab.seed, x, y, lab.structure.baseCell * 2.8, channel) * K))
    ]

  // mosaic: the source quantized to the cell grid — or, with no photo,
  // the GENERATED color field quantized the same way (the pixel-
  // gradient read: a gorgeous smooth field, sampled coarsely)
  if (cells.some((c) => c.treatment === 'mosaic')) {
    const field = !maps ? buildColorField({ palette, seed: lab.seed, T, outW, outH }) : null
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
      ctx.fillStyle = palette[f.color]
      ctx.fillRect(cell.x, cell.y, cell.size + 0.35, cell.size + 0.35)
      if (f.accent !== null) {
        const inset = cell.size * 0.3
        ctx.fillStyle = palette[f.accent]
        ctx.fillRect(cell.x + inset, cell.y + inset, cell.size - inset * 2, cell.size - inset * 2)
      }
    }
  }

  // BEADS — the pegboard: every cell draws a circle, ground beads
  // included; colored runs travel down columns
  if (cells.some((c) => c.treatment === 'beads')) {
    const pg = hexToRgb(paper)
    const groundBead = rgbCss([pg[0] * 0.94 + 8, pg[1] * 0.94 + 8, pg[2] * 0.94 + 8])
    for (const f of buildBeadFills({ cells, paletteSize: K, seed: lab.seed })) {
      const { cell } = f
      const cx = cell.x + cell.size / 2
      const cy = cell.y + cell.size / 2
      ctx.fillStyle = f.active ? palette[f.color] : groundBead
      ctx.beginPath()
      ctx.arc(cx, cy, cell.size * 0.47, 0, Math.PI * 2)
      ctx.fill()
      if (f.inner !== null) {
        ctx.fillStyle = palette[f.inner]
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
    // input that could silently tilt the weave is worse than none
    const fills = buildShingleFills({
      cells,
      paletteSize: K,
      seed: lab.seed,
      lean: 0,
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
      ? composeFlow(lab.flow, {
          seed: lab.seed,
          outW,
          outH,
          curveAngle: curveAngleFor(lab, outW, outH),
          T,
        })
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
    for (const pts of lines) {
      ctx.strokeStyle = hasPalette ? dealPalette(pts[0], pts[1], 'lab.scan.pal') : ink
      strokePolyline(ctx, pts)
    }
    ctx.restore()
  }

  // STREAMS — long field-line hairlines. Seeded BY their territory but
  // free to travel: walkers obey the field, not the band boundary
  if (vector && cells.some((c) => c.treatment === 'streams')) {
    const streams = buildStreams({ cells, seed: lab.seed, field: vector, outW, outH })
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
      ctx.globalAlpha = alpha
      ctx.lineWidth = d.width
      strokePolyline(ctx, d.pts)
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
): void {
  const { width: outW, height: outH } = lab.output
  const renderTransform = constrainArtworkCover(
    transform,
    outW,
    outH,
    Math.max(outW, outH) / 3840,
  )
  const artwork = artworkCanvas(outW, outH)
  artwork.setTransform(1, 0, 0, 1, 0, 0)
  artwork.globalAlpha = 1
  artwork.globalCompositeOperation = 'source-over'
  renderLab(artwork, lab, source, protos, view)
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
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = lab.output.width
  canvas.height = lab.output.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D context unavailable')
  renderLabArtwork(ctx, lab, source, protos, 'composite', transform)
  return canvasToPng(canvas)
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
  })
}
