// Color shares: what the picture shows. For each frame, the share of its visibly lit pixels that read as each pack
// color, counting a color's own dim and bright shades as that color only while they still read as it, with greys
// (pale bridges, white, greys) and other colors as entries of their own; black counts as none. Usage and how the
// rules were set: scripts/light/README.md, "Color shares".
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { list, parseArgs } from './lib/args.mjs'
import { BLEND, blendSharesOf, BLUE_LIGHT, blueLight, blueVerdict, LABELS, mixByName, READ, readAs, rulesFor, sharesOf } from './lib/color-read.mjs'
import { startHarness } from './lib/harness.mjs'
import { runMixSet, stageArgs, stageText } from './lib/stage-args.mjs'

const LOOKS = ['sunset.bands', 'sunset.ramp', 'sunset.blooms', 'contour.rim', 'contour.halo', 'contour.beam', 'contour.streaks']
// The looks behind the tool's switches (sunrise=merged, contour=merged, rush=split) are measured when named; `all` is
// the seven.
const MERGED = ['sunset.merged', 'contour.merged', 'rush.split']
const PACK_IDS = ['primary', 'bold', 'elemental', 'atmospheric']
// The palette check's test drags (palette-check.mjs DRAGS), in frame units as in the URL.
const DRAGS = {
  owner: { from: [1.011, 1.224], to: [-0.078, -0.067] },
  mirror: { from: [-0.011, 1.224], to: [1.078, -0.067] },
  above: { from: [0.5, -0.3], to: [0.5, -0.5] },
  side: { from: [0.9, 0.5], to: [0.1, 0.5] },
}
const FORMATS = { '16x9': [16, 9], '9x16': [9, 16], '1x1': [1, 1], '4x5': [4, 5] }
const RENDER_LONG = 320
const META_BLUE = '#0064E0'
// A picture is off its set shares when a pack color's share of the pack colors it shows is more than this far from
// the share set for it: half of the smallest slider step (20% in the five-color packs; SHARED, Wed 8:40 AM).
const SET_TOLERANCE = 0.1

const args = parseArgs()
const mixSetCode = runMixSet(args, import.meta.url)
if (mixSetCode !== null) process.exit(mixSetCode)
const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '')
const outDir = path.resolve(typeof args.out === 'string' ? args.out : path.join('artifacts', 'color-shares', stamp))

// The asked shares at the default mix (owner, 2026-11-09 10:03 PM): Meta Blue 50%, the other pack colors even.
function defaultAsked(pack) {
  const others = pack.colors.filter((c) => c.hex.toUpperCase() !== META_BLUE)
  return Object.fromEntries(pack.colors.map((c) => [c.name, c.hex.toUpperCase() === META_BLUE ? 0.5 : 0.5 / others.length]))
}
// Flags at the default mix: Meta Blue under 45% of the lit pixels, or any pack color under 5%.
function flagsOf(pack, shares) {
  const flags = []
  for (const c of pack.colors) {
    const s = shares[c.name] ?? 0
    if (c.hex.toUpperCase() === META_BLUE && s < 0.45) flags.push(`${c.name} ${pct(s)}`)
    else if (s < 0.05) flags.push(`${c.name} ${pct(s)}`)
  }
  return flags
}
const pct = (v) => `${Math.round(v * 100)}%`

// --- sheets ---

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const text = (s, w, size, color = '#ddd') => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${size + 6}"><text x="2" y="${size + 1}" font-family="Helvetica" font-size="${size}" fill="${color}">${esc(s)}</text></svg>`)
const LABEL_RGB = (rules) => Object.fromEntries([...rules.colors.map((c) => [c.name, [1, 3, 5].map((i) => parseInt(c.hex.slice(i, i + 2), 16))]), ['grey', [150, 150, 150]], ['other', [255, 0, 200]], ['none', [0, 0, 0]]])
async function labelMap(rules, labels, w, h) {
  const rgbOf = LABEL_RGB(rules)
  const px = Buffer.alloc(w * h * 3)
  for (let p = 0; p < w * h; p++) px.set(rgbOf[labels[p]], 3 * p)
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer()
}
async function shareBar(rules, shares, w, h) {
  const rgbOf = LABEL_RGB(rules)
  const px = Buffer.alloc(w * h * 3, 30)
  let x0 = 0
  for (const k of LABELS(rules)) {
    const x1 = Math.min(w, x0 + Math.round((shares[k] ?? 0) * w))
    for (let y = 0; y < h; y++) for (let x = x0; x < x1; x++) px.set(rgbOf[k], 3 * (y * w + x))
    x0 = x1
  }
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer()
}
const ABBR = { 'Meta Blue': 'MB', Cyan: 'Cy', Yellow: 'Ye', 'Orange-red': 'OR', Lime: 'Li', Forest: 'Fo', Tan: 'Ta', Plum: 'Pl', Ice: 'Ic', Steel: 'St', Slate: 'Sl', 'Near-black': 'NB', grey: 'grey', other: 'other' }
const shareText = (rules, shares) => LABELS(rules).map((k) => `${ABBR[k] ?? k} ${Math.round((shares[k] ?? 0) * 100)}`).join(' ')

// One sheet of frames: each frame, its label map beside it, and the shares under them.
async function drawSheet(items, file, title) {
  const W = 1280
  const comp = [{ input: text(title, W, 14, '#fff'), left: 8, top: 6 }]
  let x = 8
  let top = 28
  let rowH = 0
  for (const it of items) {
    const th = it.h >= it.w ? 200 : 135
    const tw = Math.round((th * it.w) / it.h)
    const cellW = 2 * tw + 14
    if (x + cellW > W) {
      x = 8
      top += rowH
      rowH = 0
    }
    comp.push({ input: text(it.title, cellW, 11, it.flags?.length ? '#ffb070' : '#ddd'), left: x, top })
    comp.push({ input: await sharp(it.png).resize(tw, th, { fit: 'fill' }).png().toBuffer(), left: x, top: top + 16 })
    comp.push({ input: await sharp(await labelMap(it.rules, it.labels, it.w, it.h)).resize(tw, th, { fit: 'fill', kernel: 'nearest' }).png().toBuffer(), left: x + tw + 4, top: top + 16 })
    comp.push({ input: await shareBar(it.rules, it.shares, 2 * tw + 4, 8), left: x, top: top + 20 + th })
    comp.push({ input: text(shareText(it.rules, it.shares), cellW, 10, '#bbb'), left: x, top: top + 31 + th })
    if (it.note) comp.push({ input: text(it.note, cellW, 10, '#8c8'), left: x, top: top + 45 + th })
    rowH = Math.max(rowH, th + 66)
    x += cellW + 10
  }
  top += rowH
  await sharp({ create: { width: W, height: top + 6, channels: 3, background: '#161616' } }).composite(comp).jpeg({ quality: 88 }).toFile(file)
}

// Swatches for setting the rules by eye: each pack color's own shades and their neighbours in hue, chroma and
// lightness, labelled by what they read as in each pack.
async function swatches(rulesById, getPack) {
  for (const packId of PACK_IDS) {
    const rules = rulesById[packId]
    const pack = getPack(packId)
    const S = 46
    const Ls = [0.12, 0.18, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.92]
    const hues = Array.from({ length: 24 }, (_, i) => i * 15)
    const sheetW = 60 + hues.length * (S + 2) + 10
    const table = [`${pack.name}: what each Oklab swatch reads as; rows L, columns hue ${hues.join(' ')}`]
    for (const C of [0.03, 0.05, 0.08, 0.12, 0.18]) {
      table.push(`chroma ${C}`, ...Ls.map((L) => `L ${L.toFixed(2)}: ${hues.map((hh) => (ABBR[readAs(rules, L, C * Math.cos((hh * Math.PI) / 180), C * Math.sin((hh * Math.PI) / 180))] ?? '?').padEnd(5)).join(' ')}`))
      const comp = [{ input: text(`${pack.name}, Oklab chroma ${C}: hue in columns (15-degree steps from 0), lightness in rows; under each swatch, what it reads as`, sheetW - 16, 13, '#fff'), left: 8, top: 4 }]
      let top = 26
      for (const L of Ls) {
        comp.push({ input: text(`L ${L}`, 50, 10, '#aaa'), left: 8, top: top + 14 })
        hues.forEach((hh, i) => {
          const a = C * Math.cos((hh * Math.PI) / 180)
          const b = C * Math.sin((hh * Math.PI) / 180)
          const rgb = fromOklab([L, a, b])
          const label = readAs(rules, L, a, b)
          comp.push({ input: { create: { width: S, height: S - 12, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } }, left: 60 + i * (S + 2), top })
          comp.push({ input: text(ABBR[label] ?? label, S, 9, label === 'other' ? '#ff70d0' : label === 'grey' ? '#bbb' : '#fff'), left: 60 + i * (S + 2), top: top + S - 12 })
        })
        top += S + 4
      }
      await sharp({ create: { width: sheetW, height: top + 6, channels: 3, background: '#161616' } }).composite(comp).jpeg({ quality: 90 }).toFile(path.join(outDir, `swatches-${packId}-c${C}.jpg`))
    }
    await fs.writeFile(path.join(outDir, `swatches-${packId}.txt`), `${table.join('\n')}\n`)
  }
  console.log(`swatches: ${path.relative(process.cwd(), outDir)}`)
}
// Oklab to 8-bit sRGB, clipped.
function fromOklab([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
  return lin.map((v) => {
    const c = Math.min(1, Math.max(0, v))
    return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055))
  })
}

// Images in a folder (PNG or JPEG), each judged in the pack named in its file name (or --pack).
async function files(rulesById) {
  const dir = path.resolve(args.files)
  const names = (await fs.readdir(dir)).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort()
  const rows = []
  const items = []
  for (const name of names) {
    const packId = typeof args.pack === 'string' ? args.pack : PACK_IDS.find((p) => name.includes(p))
    if (!packId) continue
    const { data, info } = await sharp(path.join(dir, name)).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const r = sharesOf(rulesById[packId], data, info.width * info.height, true)
    const blend = args.blend ? blendOf(rulesById[packId], data, info.width, info.height, r.labels) : {}
    rows.push({ file: name, pack: packId, lit: +r.lit.toFixed(4), shares: round(r.shares), ...blend, blue: blueOf(rulesById[packId], data, info.width, info.height, r.labels) })
    if (args.maps) items.push({ title: name.replace(/\.(png|jpe?g)$/i, ''), png: await sharp(path.join(dir, name)).png().toBuffer(), labels: r.labels, rules: rulesById[packId], shares: r.shares, w: info.width, h: info.height })
  }
  await fs.writeFile(path.join(outDir, 'shares.json'), JSON.stringify(rows, null, 1))
  await fs.writeFile(path.join(outDir, 'shares.txt'), `${rows.map((r) => `${r.file}: lit ${pct(r.lit)} | ${shareText(rulesById[r.pack], r.shares)} | ${blueText(r.blue)}`).join('\n')}\n`)
  if (args.maps) for (let i = 0; i < items.length; i += 12) await drawSheet(items.slice(i, i + 12), path.join(outDir, `maps-${String(i / 12 + 1).padStart(2, '0')}.jpg`), `${path.basename(dir)}: frames and what each pixel reads as (grey: grey or pale bridge; magenta: another color; black: none)`)
  console.log(`${rows.length} files: ${path.relative(process.cwd(), path.join(outDir, 'shares.txt'))}`)
}
const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +v.toFixed(4)]))
// Whether Meta Blue carries light (lib/color-read.mjs, blueLight and BLUE_LIGHT): its numbers, whether the rule
// applies (Meta Blue on 10% or more of the lit pixels) and the reasons it fails.
function blueOf(rules, rgb, width, height, labels) {
  const light = blueLight(rules, rgb, width, height, labels)
  if (!light) return null
  const { applies, reasons } = blueVerdict(light)
  return { ...round(light), applies, fails: reasons }
}
const blueText = (b) => (!b ? 'no Meta Blue' : !b.applies ? 'Meta Blue light: not judged (under 10%)' : `Meta Blue light: ${b.fails.length ? b.fails.join(', ') : 'carries light'} (spread ${b.spread.toFixed(2)}, peak ${b.peak >= 0 ? '+' : ''}${b.peak.toFixed(2)}, borrowed ${b.borrowed.toFixed(2)})`)

// The blend-aware reading (--blend, coordinator 2026-11-10 3:25 AM; since compare round 29 the palette check's
// reading, blendSharesOf in lib/color-read.mjs): a soft blend between two pack colors is partly each.
const blendOf = (rules, rgb, width, height, labels) => ({ blendShares: round(blendSharesOf(rules, rgb, width, height, labels).shares) })

// The looks at HEAD: each look, pack, seed, format and view, rendered as the tool shows it.
async function looksRun(harness, rulesById, getPack) {
  const lookArg = list(args.look)
  if (!lookArg.length) throw new Error('usage: color-shares.mjs --look <contour.beam|beam|...|all> [--seeds 1-8] [--drag default,owner|all] [--format 16x9,9x16] [--mix name | --stage off] [--blend] [--maps] [--out dir]; or --files <dir> [--pack id] [--blend] [--maps]; or --swatches')
  const looks = lookArg.includes('all') ? LOOKS : lookArg.map((l) => (l.includes('.') ? l : LOOKS.find((id) => id.endsWith(`.${l}`)) ?? l))
  for (const look of looks) if (!LOOKS.includes(look) && !MERGED.includes(look)) throw new Error(`Unknown look ${look}`)
  const seeds = list(args.seeds ?? '1-8').flatMap((part) => {
    const [a, b = a] = part.split('-').map(Number)
    return Array.from({ length: b - a + 1 }, (_, i) => a + i)
  })
  const viewArg = list(args.drag ?? args.drags).map((v) => (v === 'none' ? 'default' : v))
  const views = !viewArg.length ? ['default'] : viewArg.includes('all') ? ['default', ...Object.keys(DRAGS)] : [...new Set(viewArg)]
  for (const v of views) if (v !== 'default' && !(v in DRAGS)) throw new Error(`Unknown drag ${v}`)
  const formats = (list(args.format ?? args.formats).length ? list(args.format ?? args.formats) : ['16x9']).map((f) => f.replace(':', 'x'))
  const tool = await harness.ssr('/src/tool/controls.ts')
  const { getRecipe } = await harness.ssr('/src/light/recipes/index.ts')
  // As the app draws (lib/stage-args.mjs): the shared color stage on at the default mix or --mix <name>, the design
  // drawn in the stage's design pack and given the picked pack's colors; --stage off: the look in the picked pack.
  const { mix: mixName } = stageArgs(args)
  let stage = null
  let mixes = null
  if (mixName) {
    stage = await harness.ssr('/src/light/color/stage.ts').catch(() => null)
    if (!stage?.withColorMix || !stage.COLOR_DESIGN_PACK) throw new Error('this checkout has no color stage (src/light/color/stage.ts with withColorMix and COLOR_DESIGN_PACK): use --stage off')
    mixes = await harness.ssr('/src/light/color/mix.ts')
  }
  const frames = []
  const started = Date.now()
  for (const look of looks) {
    const items = []
    for (const packId of PACK_IDS) {
      const pack = getPack(packId)
      const mix = mixName ? mixByName(mixes, pack, mixName) : null
      if (mixName && !mix) continue
      const asked = mix ? Object.fromEntries(pack.colors.map((c, i) => [c.name, mix.shares[i]])) : defaultAsked(pack)
      const design = stage ? getPack(stage.COLOR_DESIGN_PACK) : pack
      for (const format of formats) {
        const [fw, fh] = FORMATS[format]
        const [width, height] = fw >= fh ? [RENDER_LONG, Math.round((RENDER_LONG * fh) / fw)] : [Math.round((RENDER_LONG * fw) / fh), RENDER_LONG]
        for (const view of views) {
          for (const seed of seeds) {
            const fixed = tool.FIXED_CONTROLS?.[getRecipe(look).mood] ?? {}
            const base = { intensity: 0.5, softness: 0.5, mood: 0.5, ...fixed }
            const controls = view === 'default' ? base : tool.controlsForDrag(look, design, seed, base, fw / fh, tool.clampDrag(DRAGS[view]))
            const built = tool.buildScene(look, design, seed, controls, fw / fh)
            const scene = stage ? stage.withColorMix(built, pack, mix) : built
            const image = await harness.render({ scene, width, height, supersample: 2 })
            const rgb = await sharp(image.data, { raw: { width, height, channels: 4 } }).removeAlpha().raw().toBuffer()
            const r = sharesOf(rulesById[packId], rgb, width * height, true)
            const flags = !mixName || mixName === 'default' ? flagsOf(pack, r.shares) : []
            const blend = args.blend ? blendOf(rulesById[packId], rgb, width, height, r.labels) : {}
            const error = setError(asked, r.shares)
            frames.push({ look, pack: packId, seed, format, view, lit: +r.lit.toFixed(4), asked: round(asked), shares: round(r.shares), error: +error.toFixed(4), off: error > SET_TOLERANCE, ...blend, flags, blue: blueOf(rulesById[packId], rgb, width, height, r.labels) })
            if (args.maps) items.push({ title: `${packId} s${seed} ${format.replace('x', ':')} ${view}`, png: await sharp(rgb, { raw: { width, height, channels: 3 } }).png().toBuffer(), labels: r.labels, rules: rulesById[packId], shares: r.shares, flags, w: width, h: height })
          }
        }
      }
    }
    if (args.maps) for (let i = 0; i < items.length; i += 24) await drawSheet(items.slice(i, i + 24), path.join(outDir, `${look}-${String(i / 24 + 1).padStart(2, '0')}.jpg`), `${look}: frames and what each pixel reads as (grey: grey or pale bridge; magenta: another color; black: none); orange title: flagged at the default mix`)
  }
  await fs.writeFile(path.join(outDir, 'shares.json'), JSON.stringify({ rules: READ, mix: mixName, seeds, formats, views, frames }, null, 1))
  await fs.writeFile(path.join(outDir, 'summary.md'), summaryOf(frames, looks, formats, views, seeds, getPack, rulesById, mixName, Math.round((Date.now() - started) / 1000)))
  const flagged = frames.filter((f) => f.flags.length).length
  console.log(`${frames.length} frames in ${Math.round((Date.now() - started) / 1000)} s${mixName && mixName !== 'default' ? '' : `; ${flagged} flagged at the default mix`}; summary: ${path.relative(process.cwd(), path.join(outDir, 'summary.md'))}`)
}

// Per look, pack, format and view: the median share of each entry over the seeds (with its range), next to the
// asked shares, and the seeds flagged.
function summaryOf(frames, looks, formats, views, seeds, getPack, rulesById, mixName, seconds) {
  const source = mixName ? `${stageText(true, mixName)}; asked: that mix's shares` : `${stageText(false)} (the look in each pack); asked: the default mix, Meta Blue 50% and the other pack colors even`
  const lines = ['# Color shares', '', `${source[0].toUpperCase()}${source.slice(1)}.`, '', `Seeds ${seeds[0]}-${seeds.at(-1)}; ${formats.map((f) => f.replace('x', ':')).join(' and ')}; ${views.join(', ')}; ${frames.length} frames in ${seconds} s. Each cell: the median share of the visibly lit pixels (Oklab L ${READ.visible} and up) over the seeds, with the lowest and highest in brackets.${!mixName || mixName === 'default' ? ' Flagged: Meta Blue under 45% or a pack color under 5%.' : ''}`, '']
  const median = (v) => [...v].sort((a, b) => a - b)[Math.floor((v.length - 1) / 2)]
  for (const look of looks) {
    lines.push(`## ${look}`, '')
    for (const packId of PACK_IDS) {
      const pack = getPack(packId)
      const keys = LABELS(rulesById[packId])
      const asked = frames.find((f) => f.look === look && f.pack === packId)?.asked
      if (!asked) continue
      lines.push(`| ${pack.name} | ${keys.map((k) => `${k}${asked[k] !== undefined ? ` (${pct(asked[k])})` : ''}`).join(' | ')} | lit | flagged |`, `| --- | ${keys.map(() => '---').join(' | ')} | --- | --- |`)
      for (const format of formats) {
        for (const view of views) {
          const set = frames.filter((f) => f.look === look && f.pack === packId && f.format === format && f.view === view)
          if (!set.length) continue
          const cell = (vals) => `${pct(median(vals))} (${pct(Math.min(...vals))}-${pct(Math.max(...vals))})`
          const flagged = set.filter((f) => f.flags.length).map((f) => `s${f.seed}`)
          lines.push(`| ${format.replace('x', ':')} ${view} | ${keys.map((k) => cell(set.map((f) => f.shares[k]))).join(' | ')} | ${cell(set.map((f) => f.lit))} | ${flagged.length} of ${set.length} |`)
        }
      }
      lines.push('')
    }
  }
  lines.push('## Meta Blue carries light', '', `Judged where Meta Blue covers ${pct(BLUE_LIGHT.applies)} or more of the lit pixels (owner, 2026-11-09 10:05 PM): it carries light when its lightness spreads ${BLUE_LIGHT.spread} or more (else flat), its brightest tenth reaches its hex's lightness (else dim), and under ${pct(BLUE_LIGHT.borrowed)} of that brightest tenth sits next to another color's lighter light (else borrowed). Each cell: frames where it carries light, of those judged, and the others by reason.`, '', '| Look | Primary | Bold | Elemental | Atmospheric |', '| --- | --- | --- | --- | --- |')
  for (const look of looks) {
    const cells = PACK_IDS.map((packId) => {
      const set = frames.filter((f) => f.look === look && f.pack === packId && f.blue?.applies)
      const by = (reason) => set.filter((f) => f.blue.fails.includes(reason)).length
      return `${set.filter((f) => !f.blue.fails.length).length} of ${set.length} (flat ${by('flat')}, dim ${by('dim')}, borrowed ${by('borrowed')})`
    })
    lines.push(`| ${look} | ${cells.join(' | ')} |`)
  }
  const judged = frames.filter((f) => f.blue?.applies)
  lines.push('', `All: Meta Blue carries light in ${judged.filter((f) => !f.blue.fails.length).length} of ${judged.length} judged frames; ${frames.length - judged.length} not judged.`, '')
  if (frames.some((f) => f.blendShares)) {
    lines.push('## Both readings (--blend)', '', `Frames with Meta Blue at 45% or more of the lit pixels, and with every pack color at 5% or more: the reading above (each pixel one label), then the blend-aware reading the palette check's \`--mix\` uses (\`blendSharesOf\` in \`lib/color-read.mjs\`: a pixel in a soft blend between two pack colors read near it counts toward each by how close it lies to each one's own shade at its lightness, when each also reads as itself on one area of ${+(BLEND.own * 100).toFixed(1)}% or more of the lit pixels).`, '', '| Look, pack | Meta Blue 45%+ | every color 5%+ | Meta Blue median |', '| --- | --- | --- | --- |')
    for (const look of looks)
      for (const packId of PACK_IDS) {
        const set = frames.filter((f) => f.look === look && f.pack === packId)
        if (!set.length) continue
        const colors = getPack(packId).colors.map((c) => c.name)
        const mb = (key) => set.filter((f) => (f[key]['Meta Blue'] ?? 0) >= 0.45).length
        const every = (key) => set.filter((f) => colors.every((c) => (f[key][c] ?? 0) >= 0.05)).length
        const med = (key) => pct(median(set.map((f) => f[key]['Meta Blue'] ?? 0)))
        lines.push(`| ${look} ${packId} | ${mb('shares')} / ${mb('blendShares')} of ${set.length} | ${every('shares')} / ${every('blendShares')} | ${med('shares')} / ${med('blendShares')} |`)
      }
    lines.push('')
  }
  lines.push(
    '## Against the set shares',
    '',
    `Each picture's error: the largest gap, over the pack colors, between a color's share of the pack colors the picture shows and the share set for it. Off: more than ${Math.round(100 * SET_TOLERANCE)} points, half of the smallest slider step (20% in the five-color packs), where a picture reads closer to the next step than to its own.`,
    '',
    '| Look | Pack | Median error | Worst | Off |',
    '| --- | --- | --- | --- | --- |',
  )
  for (const look of looks)
    for (const packId of PACK_IDS) {
      const set = frames.filter((f) => f.look === look && f.pack === packId)
      if (!set.length) continue
      const worst = set.reduce((a, b) => (b.error > a.error ? b : a))
      lines.push(`| ${look} | ${packId} | ${pct(median(set.map((f) => f.error)))} | ${pct(worst.error)} (s${worst.seed} ${worst.format.replace('x', ':')} ${worst.view}) | ${set.filter((f) => f.off).length} of ${set.length} |`)
    }
  return `${lines.join('\n')}\n`
}

// How far a picture's pack colors are from the shares set for them: the largest gap over the pack colors between a
// color's share of the pack colors read (grey and other left out) and its set share.
function setError(asked, shares) {
  const names = Object.keys(asked)
  const total = names.reduce((s, n) => s + (shares[n] ?? 0), 0)
  if (!(total > 0)) return 1
  return Math.max(...names.map((n) => Math.abs((shares[n] ?? 0) / total - asked[n])))
}

// --- main ---

await fs.mkdir(outDir, { recursive: true })
const harness = await startHarness()
try {
  const { PACKS, getPack, HUE_ORDER } = await harness.ssr('/src/light/color/packs.ts')
  const rulesById = Object.fromEntries(PACKS.map((p) => [p.id, rulesFor(p, HUE_ORDER?.[p.id] ?? [])]))
  if (args.swatches) await swatches(rulesById, getPack)
  else if (typeof args.files === 'string') await files(rulesById)
  else await looksRun(harness, rulesById, getPack)
} finally {
  await harness.close()
}
