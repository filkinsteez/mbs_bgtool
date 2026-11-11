// Same design in every pack (owner, 2026-11-09 5:58 PM; AGENTS.md): the same mood, seed, drag and format give the
// same shapes, light positions and light and dark layout in every pack, and only the colors change. For each look,
// seed, format and view (the default light or a test drag) this renders the three packs, and each color list given
// with --colors, and compares every two of those frames on their lightness alone, so the colors themselves don't
// count. Where two far-apart colors meet, the light along that thin line may rise by a different amount in each pack
// (owner, 2026-11-10 9:50 PM; AGENTS.md 8ed6a2a), so there the frames may differ by up to 0.15 in lightness
// (lib/design-maps.mjs, MEET). Usage and how the limits were set: scripts/light/README.md, "Same design".
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { list, parseArgs } from './lib/args.mjs'
import { mixByName } from './lib/color-read.mjs'
import { compare, MEET, mapsOf, meetingLines, meetMask } from './lib/design-maps.mjs'
import { startHarness } from './lib/harness.mjs'
import { stageArgs } from './lib/stage-args.mjs'

const LOOKS = ['sunset.bands', 'sunset.ramp', 'sunset.blooms', 'contour.rim', 'contour.halo', 'contour.beam', 'contour.streaks']
// The tool's three looks (the merged Sunrise and Contour, and Rush's split) are checked when named; `all` is the seven.
const MERGED = ['sunset.merged', 'contour.merged', 'rush.split']
const PACK_IDS = ['bold', 'elemental', 'atmospheric']
// The palette check's test drags (palette-check.mjs DRAGS), in frame units as in the URL.
const DRAGS = {
  owner: { from: [1.011, 1.224], to: [-0.078, -0.067] },
  mirror: { from: [-0.011, 1.224], to: [1.078, -0.067] },
  above: { from: [0.5, -0.3], to: [0.5, -0.5] },
  side: { from: [0.9, 0.5], to: [0.1, 0.5] },
}
const FORMATS = { '16x9': [16, 9], '9x16': [9, 16], '1x1': [1, 1], '4x5': [4, 5] }
const META_BLUE = '#0064E0'
// Frames render this long on their long side (2x supersampled) and are compared this long on their short side.
const RENDER_LONG = 320
const MAP_SHORT = 72

// The maps and their comparison are in lib/design-maps.mjs.
const T = {
  // Set by eye in compare round 22 (artifacts/compare/rounds/22/NOTES.md). Contour: the owner's case (Beam seed 15,
  // 16:9) splits Bold from Elemental and Atmospheric and passes those two, no pair judged the same or recolored with
  // every param kept fails, and Bold's different beams in seeds 3 and 5 are the only judged differences missed.
  // Sunrise frames are lit all over, so another color's lightness moves more of their layout: Bands' different stacks
  // are all caught and about 1 in 17 recolors with every param kept fails, where the swap turns a light part dark.
  // Rush takes Contour's limits, the stricter pair, not set by eye: on cb6934c its packs score at most a tenth of them
  // (compare round 33).
  limits: {
    contour: { layout: 0.12, light: 0.21 },
    sunset: { layout: 0.2, light: 0.3 },
    rush: { layout: 0.12, light: 0.21 },
  },
}

const args = parseArgs()
const lookArg = list(args.look)
if (!lookArg.length) {
  console.error('usage: node scripts/light/same-design.mjs --look <contour.beam|beam|...|all> [--seeds 1-8] [--drag default,owner|all] [--format 16x9,9x16] [--colors 1FCDF0,FFD61E,FF4F00] [--mix [default,blue-off,Cyan:0.6]] [--out dir]')
  process.exit(2)
}
const looks = lookArg.includes('all') ? LOOKS : lookArg.map((l) => (l.includes('.') ? l : LOOKS.find((id) => id.endsWith(`.${l}`)) ?? l))
for (const look of looks) if (!LOOKS.includes(look) && !MERGED.includes(look)) throw new Error(`Unknown look ${look}: give ${[...LOOKS, ...MERGED].join(', ')} or all`)
const seeds = list(args.seeds ?? '1-8').flatMap((part) => {
  const [a, b = a] = part.split('-').map(Number)
  if (!Number.isInteger(a) || !Number.isInteger(b) || b < a) throw new Error(`--seeds takes seeds and ranges, for example 1-8,15: ${part}`)
  return Array.from({ length: b - a + 1 }, (_, i) => a + i)
})
const viewArg = list(args.drag ?? args.drags).map((v) => (v === 'none' ? 'default' : v))
const views = !viewArg.length ? ['default'] : viewArg.includes('all') ? ['default', ...Object.keys(DRAGS)] : [...new Set(viewArg)]
for (const v of views) if (v !== 'default' && !(v in DRAGS)) throw new Error(`Unknown drag ${v}: give default, ${Object.keys(DRAGS).join(', ')} or all`)
const formats = (list(args.format ?? args.formats).length ? list(args.format ?? args.formats) : ['16x9']).map((f) => f.replace(':', 'x'))
for (const f of formats) if (!(f in FORMATS)) throw new Error(`Unknown format ${f}: give ${Object.keys(FORMATS).join(', ')}`)
const intensity = args.intensity === undefined ? null : Number(args.intensity)
// As the app draws (lib/stage-args.mjs): the color stage on at the default mix. --mix <names> compares those mixes
// (a bare --mix: the default mix, Meta Blue off and the pack's first other color at 60%); --stage off compares each
// pack's look without the stage.
const mixArg = !stageArgs(args).on ? null : args.mix === undefined ? ['default'] : list(args.mix)
// --from <dir>: judge renders kept by an earlier run (--keep) instead of rendering.
const fromDir = typeof args.from === 'string' ? path.resolve(args.from) : null
const keep = Boolean(args.keep)
const sheetAll = args.sheet === 'all'
const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '')
const outDir = path.resolve(typeof args.out === 'string' ? args.out : path.join('artifacts', 'same-design', stamp))

const mixLabel = (name) => (name === 'default' ? 'default mix' : name === 'blue-off' ? 'Meta Blue off' : `${name.split(':')[0]} ${Math.round(Number(name.split(':')[1]) * 100)}%`)

// --- render and compare ---

const harness = await startHarness()
const started = Date.now()
const results = []
const notes = []
const labels = new Map()
try {
  const { PACKS, getPack } = await harness.ssr('/src/light/color/packs.ts')
  const tool = await harness.ssr('/src/tool/controls.ts')
  const { getRecipe } = await harness.ssr('/src/light/recipes/index.ts')

  // The frames compared at each seed: the three packs, then each --colors list as its pack with only those colors.
  const variants = PACK_IDS.map((id) => ({ key: id, label: getPack(id).name, pack: getPack(id) }))
  for (const raw of [].concat(args.colors ?? []).filter((v) => v !== true)) {
    const hexes = String(raw).split(',').map((h) => `#${h.trim().replace(/^#/, '').toUpperCase()}`)
    if (hexes.some((h) => !/^#[0-9A-F]{6}$/.test(h)) || new Set(hexes).size !== hexes.length) throw new Error(`--colors takes distinct hexes: ${raw}`)
    const source = PACKS.find((p) => hexes.every((h) => p.colors.some((c) => c.hex.toUpperCase() === h)))
    if (!source) throw new Error(`--colors ${raw}: give colors of one pack (packs never mix)`)
    const colors = hexes.map((h) => source.colors.find((c) => c.hex.toUpperCase() === h))
    variants.push({ key: `${source.id}-${hexes.map((h) => h.slice(1)).join('-')}`, label: `${source.name}: ${colors.map((c) => c.name).join(', ')}`, pack: { ...source, colors }, list: hexes })
  }
  // --mix: the shared color stage on (src/light/color/stage.ts), every design drawn in the stage's design pack and
  // given each pack's colors at each mix: by default the default mix, Meta Blue off and the pack's first other color
  // at 60%. The packs are compared at the default mix, and each pack's other mixes against its default.
  let stage = null
  let mixes = null
  if (mixArg) {
    stage = await harness.ssr('/src/light/color/stage.ts').catch(() => null)
    if (!stage?.withColorMix || !stage.COLOR_DESIGN_PACK) throw new Error('--mix: this checkout has no color stage yet (src/light/color/stage.ts with withColorMix and COLOR_DESIGN_PACK)')
    mixes = await harness.ssr('/src/light/color/mix.ts')
    variants.length = 0
    for (const id of PACK_IDS) {
      const pack = getPack(id)
      const other = pack.colors.find((c) => c.hex.toUpperCase() !== META_BLUE)
      for (const name of mixArg.length ? mixArg : ['default', 'blue-off', `${other.name}:0.6`]) {
        const mix = mixByName(mixes, pack, name)
        if (mix) variants.push({ key: `${id}-${name.replace(/[^A-Za-z0-9]+/g, '')}`, label: `${pack.name} ${mixLabel(name)}`, pack, mix, mixName: name, design: getPack(stage.COLOR_DESIGN_PACK) })
      }
    }
  }
  for (const v of variants) labels.set(v.key, v.label)
  const packHexes = new Set(PACKS.flatMap((p) => p.colors.map((c) => c.hex.toUpperCase())))

  // The controls the tool sends: the mood's fixed values (intensity too once the panel drops its slider), and for a
  // drag the line with the mood control set from its start.
  const controlsFor = (look, variant, seed, aspect, view) => {
    const fixed = tool.FIXED_CONTROLS?.[getRecipe(look).mood] ?? {}
    const base = { intensity: 0.5, softness: 0.5, mood: 0.5, ...fixed, ...(intensity === null ? {} : { intensity }) }
    return view === 'default' ? base : tool.controlsForDrag(look, variant.pack, seed, base, aspect, tool.clampDrag(DRAGS[view]))
  }

  for (const look of looks) {
    const limits = T.limits[getRecipe(look).mood] ?? T.limits.contour
    const skipped = new Map()
    for (const seed of seeds) {
      for (const format of formats) {
        const [fw, fh] = FORMATS[format]
        const [width, height] = fw >= fh ? [RENDER_LONG, Math.round((RENDER_LONG * fh) / fw)] : [Math.round((RENDER_LONG * fw) / fh), RENDER_LONG]
        const [mw, mh] = fw >= fh ? [Math.round((MAP_SHORT * fw) / fh), MAP_SHORT] : [MAP_SHORT, Math.round((MAP_SHORT * fh) / fw)]
        for (const view of views) {
          const frames = []
          for (const variant of variants) {
            if (skipped.has(variant.key)) continue
            const file = `${look}-${variant.key}-s${seed}-${format}-${view}.png`
            let png
            if (fromDir) {
              if (!existsSync(path.join(fromDir, file))) continue
              png = await fs.readFile(path.join(fromDir, file))
            } else {
              // A look that doesn't take a color list yet throws on one, or still uses a pack color the list leaves
              // out (its own table, or Meta Blue as the first color); the list is skipped for that look.
              let scene
              try {
                if (stage) scene = stage.withColorMix(tool.buildScene(look, variant.design, seed, controlsFor(look, { pack: variant.design }, seed, fw / fh, view), fw / fh), variant.pack, variant.mix)
                else scene = tool.buildScene(look, variant.pack, seed, controlsFor(look, variant, seed, fw / fh, view), fw / fh)
              } catch (error) {
                if (!variant.list) throw error
                skipped.set(variant.key, `${look}, ${variant.label}: skipped, the look doesn't take a color list yet (${String(error.message ?? error).split('\n')[0]})`)
                continue
              }
              const outside = variant.list ? [...new Set(scene.colors.map((h) => h.toUpperCase()).filter((h) => packHexes.has(h) && !variant.list.includes(h)))] : []
              if (outside.length) {
                skipped.set(variant.key, `${look}, ${variant.label}: skipped, the look doesn't take a color list yet (it still uses ${outside.join(', ')})`)
                continue
              }
              const image = await harness.render({ scene, width, height, supersample: 2 })
              png = await sharp(image.data, { raw: { width, height, channels: 4 } }).removeAlpha().png().toBuffer()
              if (keep) {
                await fs.mkdir(path.join(outDir, 'renders'), { recursive: true })
                await fs.writeFile(path.join(outDir, 'renders', file), png)
              }
            }
            const small = await sharp(png).removeAlpha().resize(mw, mh, { fit: 'fill' }).raw().toBuffer()
            frames.push({ variant, png, maps: mapsOf(small, mw, mh), lines: meetingLines(variant.pack, small, mw, mh) })
          }
          const pairs = []
          const wanted = (a, b) => !stage || (a.mixName === 'default' && b.mixName === 'default') || (a.pack.id === b.pack.id && (a.mixName === 'default' || b.mixName === 'default'))
          for (let i = 0; i < frames.length; i++) {
            for (let j = i + 1; j < frames.length; j++) {
              if (!wanted(frames[i].variant, frames[j].variant)) continue
              const meet = meetMask([frames[i].lines, frames[j].lines], mw, mh)
              pairs.push({ frames: [frames[i].variant.key, frames[j].variant.key], ...compare(frames[i].maps, frames[j].maps, limits, meet) })
            }
          }
          results.push({ look, seed, format, view, limits, pairs, differs: pairs.some((p) => p.differs), score: Math.max(0, ...pairs.map((p) => p.score)), frames })
        }
      }
    }
    notes.push(...skipped.values())
  }
} finally {
  await harness.close()
}

// --- the report ---

await fs.mkdir(outDir, { recursive: true })
const seconds = Math.round((Date.now() - started) / 1000)
const nameOf = (key) => labels.get(key) ?? key
const viewText = (v) => (v === 'default' ? 'default view' : `drag ${v}`)
const pairText = (p) => `${p.frames.map(nameOf).join(' / ')} (layout ${p.layout}, light ${p.light}${p.allowed ? `; ${p.allowed} px on far-hue meeting lines left out` : ''})`
const MOOD_NAMES = { sunset: 'Sunrise', contour: 'Contour', rush: 'Rush' }
const limitText = Object.entries(T.limits).map(([mood, l]) => `${MOOD_NAMES[mood]}: layout over ${l.layout} or light over ${l.light}`).join('; ')
const lines = [
  mixArg ? '# Same design in every pack and mix (color stage on)' : '# Same design in every pack',
  '',
  mixArg ? `Stage on, mix ${mixArg.length ? mixArg.join(', ') : 'default, blue-off and the first other color at 60%'}.` : 'Stage off.',
  '',
  `Seeds ${seeds.join(', ')}; ${formats.map((f) => f.replace('x', ':')).join(' and ')}; ${views.map(viewText).join(', ')}; ${results.reduce((s, r) => s + r.frames.length, 0)} frames in ${seconds} s. Two frames differ in design when (${limitText}). Pixels near a meeting line of two pack colors ${MEET.hue} degrees or more apart in hue, whose lightness differs by ${MEET.allow} or less, are left out, the strongest lines first and at most ${Math.round(100 * MEET.cap)}% of a frame (owner, 2026-11-10 9:50 PM).`,
  '',
  ...notes.map((n) => `- ${n}`),
  ...(notes.length ? [''] : []),
]
const printed = []
for (const look of looks) {
  const mine = results.filter((r) => r.look === look)
  const failing = [...new Set(mine.filter((r) => r.differs).map((r) => r.seed))]
  printed.push(`${look}: ${failing.length} of ${seeds.length} seeds differ${failing.length ? ` (s${failing.join(', s')})` : ''}`)
  lines.push(`## ${look}`, '', `${failing.length} of ${seeds.length} seeds differ in design${failing.length ? `: s${failing.join(', s')}` : ''}.`, '')
  if (formats.length > 1 || views.length > 1) {
    lines.push(`| Format | ${views.map(viewText).join(' | ')} |`, `| --- | ${views.map(() => '---').join(' | ')} |`)
    for (const f of formats) lines.push(`| ${f.replace('x', ':')} | ${views.map((v) => mine.filter((r) => r.format === f && r.view === v && r.differs).map((r) => `s${r.seed}`).join(', ') || '-').join(' | ')} |`)
    lines.push('')
  }
  for (const r of mine.filter((x) => x.differs)) lines.push(`- s${r.seed} ${r.format.replace('x', ':')} ${viewText(r.view)}: ${r.pairs.filter((p) => p.differs).map(pairText).join('; ')}`)
  if (failing.length) lines.push('')
}
await fs.writeFile(path.join(outDir, 'summary.md'), `${lines.join('\n')}\n`)
await fs.writeFile(
  path.join(outDir, 'same-design.json'),
  JSON.stringify({ limits: T.limits, seeds, formats, views, intensity, notes, results: results.map(({ frames, ...r }) => ({ ...r, frames: frames.map((f) => f.variant.key) })) }, null, 1),
)

// A sheet per look: the frames whose design differs, worst first, then the passing ones closest to the limits (all of
// them with --sheet all). Under each frame its light map: its lightness stretched to its own range, what both
// measures read.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const text = (s, w, size, color) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${size + 6}"><text x="2" y="${size + 1}" font-family="Helvetica" font-size="${size}" fill="${color}">${esc(s)}</text></svg>`)
const greyPng = (m) => sharp(Buffer.from(m.lit.map((v) => Math.round(v * 255))), { raw: { width: m.w, height: m.h, channels: 1 } })
for (const look of looks) {
  const mine = results.filter((r) => r.look === look).sort((a, b) => b.score - a.score)
  const failing = mine.filter((r) => r.differs)
  const shown = sheetAll ? mine : [...failing.slice(0, 40), ...mine.filter((r) => !r.differs).slice(0, 6)]
  if (!shown.length) continue
  const W = Math.max(1240, ...shown.map((r) => 8 + r.frames.length * (Math.round((110 * FORMATS[r.format][0]) / FORMATS[r.format][1]) + 8) + 420))
  const comp = [{ input: text(`${look}: ${failing.length} differ in design (red), worst first${sheetAll ? '' : '; then the passing ones closest to the limits'}. Frames above, their lightness stretched to its own range below.`, W, 14, '#fff'), left: 8, top: 6 }]
  let top = 30
  for (const r of shown) {
    const [fw, fh] = FORMATS[r.format]
    const th = 110
    const tw = Math.round((th * fw) / fh)
    comp.push({ input: text(`s${r.seed} ${r.format.replace('x', ':')} ${viewText(r.view)}: ${r.differs ? 'differs' : 'same'}`, W, 12, r.differs ? '#ff9a9a' : '#9c9'), left: 8, top })
    let x = 8
    for (const f of r.frames) {
      comp.push({ input: text(f.variant.label, tw + 6, 10, '#bbb'), left: x, top: top + 16 })
      comp.push({ input: await sharp(f.png).resize(tw, th, { fit: 'fill' }).png().toBuffer(), left: x, top: top + 30 })
      comp.push({ input: await greyPng(f.maps).resize(tw, th, { fit: 'fill' }).png().toBuffer(), left: x, top: top + 34 + th })
      x += tw + 8
    }
    let y = top + 30
    for (const p of r.pairs) {
      comp.push({ input: text(pairText(p), Math.max(100, W - x - 8), 11, p.differs ? '#ff9a9a' : '#9c9'), left: x + 4, top: y })
      y += 16
    }
    top += 34 + 2 * th + 14
  }
  if (!sheetAll && failing.length > 40) {
    comp.push({ input: text(`${failing.length - 40} more that differ in summary.md`, W, 12, '#bbb'), left: 8, top })
    top += 20
  }
  await sharp({ create: { width: W, height: top + 4, channels: 3, background: '#161616' } }).composite(comp).jpeg({ quality: 85 }).toFile(path.join(outDir, `${look}.jpg`))
}
console.log([...printed, ...notes, `summary: ${path.relative(process.cwd(), path.join(outDir, 'summary.md'))} (${seconds} s)`].join('\n'))
process.exitCode = results.some((r) => r.differs) ? 1 : 0
