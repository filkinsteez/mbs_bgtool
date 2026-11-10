// Color shares: what the picture shows. For each frame, the share of its visibly lit pixels that read as each pack
// color, counting a color's own dim and bright shades as that color only while they still read as it, with greys
// (pale bridges, white, greys) and other colors as entries of their own; black counts as none. Usage and how the
// rules were set: scripts/light/README.md, "Color shares".
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { list, parseArgs } from './lib/args.mjs'
import { startHarness } from './lib/harness.mjs'

const LOOKS = ['sunset.bands', 'sunset.ramp', 'sunset.blooms', 'contour.rim', 'contour.halo', 'contour.beam', 'contour.streaks']
const PACK_IDS = ['bold', 'elemental', 'atmospheric']
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

const T = {
  // Pixels darker than this (Oklab L) are black: none, left out of the shares.
  visible: 0.15,
  // A pixel reads as a hue rather than grey from this chroma: grey[0] up to L 0.35, rising to grey[1] from L 0.6.
  // In the dark a pack color's own dim shade has little chroma but still reads as that color (Elemental Beam's dim
  // Forest room: L 0.15 to 0.2, chroma 0.026 at Forest's hue), so for reading a pack color the limit is also at
  // most `greyDark` times the lightness; for calling a pixel another color it stays at `grey`.
  grey: [0.035, 0.05],
  greyDark: 0.12,
  // In a color's hue window a pixel reads as that color while it keeps this share of the color's own chroma at its
  // lightness (the hex dimmed in linear light below the hex, the hex mixed toward white above it). A greyer blue
  // reads as grey; a greyer warm color reads brown, khaki or olive (other).
  keep: 0.5,
  // Warm colors (hue 20 to 140) more than `purityBelow` darker than their hex keep this share of the hex's
  // chroma-to-lightness ratio, and darker than their hex turn at most `warmDimHue` degrees past it away from red:
  // dim Yellow at its own hue reads mustard or olive, dim Orange-red at amber's hue rust or brown (the palette
  // check's warm tail rule, C-025). Closer to the hex a greyer warm color is a pale tint (cream, butter, peach).
  purity: 0.85,
  purityBelow: 0.1,
  warmDimHue: 5,
  // From L 0.75 (ramping from the hex's lightness) hues under this read pink or salmon, not a warm pack color.
  pinkHue: 35,
  // Each chromatic color's hue window reaches halfway to the next pack color, and at most this far (degrees).
  window: 25,
  // Meta Blue (found by hex) toward violet: from about 15 degrees it reads indigo (palette check, compare round 11).
  violet: 12,
  // Between Meta Blue and a cyan in the pack, the hue boundary: halfway between the two hexes up to L 0.7, then 232
  // at L 0.8 and 227 from L 0.9 (palette check's pale-side rule, compare round 16): a pale blue there passes for Cyan.
  paleCyan: { from: 0.7, at: [0.8, 0.9], hue: [232, 227] },
  // Yellow, Lime and Tan only read as themselves when bright (dim they read olive or brown): down to this share of
  // their hex's light (1 stop, the palette check's warm rule). Dark pack colors (Forest, Plum): up to this many
  // times their hex's light (1 stop over); brighter, Forest reads aquamarine and Plum magenta.
  brightDown: 0.5,
  darkUp: 2,
}

const args = parseArgs()
const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '')
const outDir = path.resolve(typeof args.out === 'string' ? args.out : path.join('artifacts', 'color-shares', stamp))

// --- color math ---

const LIN = Float32Array.from({ length: 256 }, (_, i) => {
  const v = i / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
})
const toLinear = (hex) => [1, 3, 5].map((i) => LIN[parseInt(hex.slice(i, i + 2), 16)])
function oklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}
const hueOf = (a, b) => ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
const signedGap = (h, h0) => ((((h - h0) % 360) + 540) % 360) - 180
const lerp = (a, b, t) => a + (b - a) * Math.min(1, Math.max(0, t))

// A pack's reading rules: each chromatic color's hue window and lightness range, and the greys.
function rulesFor(pack) {
  const colors = pack.colors.map((c) => {
    const [L0, a0, b0] = oklab(toLinear(c.hex))
    const C0 = Math.hypot(a0, b0)
    const h0 = hueOf(a0, b0)
    const neutral = C0 < 0.04
    const dark = L0 < 0.45
    const warm = !neutral && !dark && h0 >= 20 && h0 <= 140
    return { name: c.name, hex: c.hex, L0, C0, h0, neutral, dark, warm, blue: h0 >= 180 && h0 <= 290, brightOnly: warm && h0 >= 60, metaBlue: c.hex.toUpperCase() === META_BLUE }
  })
  const chromatic = colors.filter((c) => !c.neutral)
  for (const c of chromatic) {
    const gaps = (sign) => chromatic.filter((o) => o !== c).map((o) => (((sign * (o.h0 - c.h0)) % 360) + 360) % 360)
    c.minus = Math.min(T.window, ...gaps(-1).map((d) => d / 2))
    c.plus = Math.min(T.window, ...gaps(1).map((d) => d / 2), c.metaBlue ? T.violet : Infinity)
    c.Lmin = c.brightOnly ? c.L0 * Math.cbrt(T.brightDown) : 0
    c.Lmax = c.dark ? c.L0 * Math.cbrt(T.darkUp) : 1
  }
  const blue = chromatic.find((c) => c.metaBlue) ?? null
  const cyan = blue ? chromatic.find((c) => !c.metaBlue && signedGap(c.h0, blue.h0) < 0 && signedGap(c.h0, blue.h0) > -60) ?? null : null
  return { colors, chromatic, blue, cyan, greys: colors.filter((c) => c.neutral).sort((x, y) => x.L0 - y.L0) }
}

// The hue where a pale blue stops reading as Meta Blue and reads as Cyan, at lightness L.
function cyanEdge(rules, L) {
  const { from, at, hue } = T.paleCyan
  const mid = (rules.cyan.h0 + rules.blue.h0) / 2
  if (L <= at[0]) return lerp(mid, hue[0], (L - from) / (at[0] - from))
  return lerp(hue[0], hue[1], (L - at[0]) / (at[1] - at[0]))
}
// The color's own chroma at lightness L: its hex dimmed (chroma in proportion to L) or mixed toward white.
const ownChroma = (c, L) => (L <= c.L0 ? (c.C0 * L) / c.L0 : (c.C0 * Math.max(0, 1 - L)) / (1 - c.L0))
const greyLimit = (L) => lerp(T.grey[0], T.grey[1], (L - 0.35) / 0.25)

// What one pixel reads as: a pack color's name, 'grey', 'other' or 'none'.
function readAs(rules, L, a, b) {
  if (L < T.visible) return 'none'
  const C = Math.hypot(a, b)
  const h = hueOf(a, b)
  let best = null
  let bestGap = Infinity
  for (const c of rules.chromatic) {
    if (L < c.Lmin || L > c.Lmax) continue
    const d = signedGap(h, c.h0)
    let lo = -c.minus
    let hi = c.plus
    if (rules.cyan && c === rules.blue) lo = signedGap(cyanEdge(rules, L), c.h0)
    if (rules.cyan && c === rules.cyan) hi = signedGap(cyanEdge(rules, L), c.h0)
    if (c.warm && L < c.L0) hi = Math.min(hi, T.warmDimHue)
    if (c.warm && L > c.L0) lo = Math.max(lo, lerp(lo, T.pinkHue - c.h0, (L - c.L0) / Math.max(0.01, 0.75 - c.L0)))
    if (d < lo || d > hi || Math.abs(d) >= bestGap) continue
    bestGap = Math.abs(d)
    best = c
  }
  const greyish = C < greyLimit(L)
  if (best && C >= Math.min(greyLimit(L), T.greyDark * L)) {
    const pure = !best.warm || L >= best.L0 - T.purityBelow || C / L >= (T.purity * best.C0) / best.L0
    if (pure && C >= T.keep * ownChroma(best, L)) return best.name
    if (!best.blue && !greyish) return 'other'
  }
  if (!best && !greyish) return 'other'
  if (!rules.greys.length) return 'grey'
  // Atmospheric: greys and greyed blues are told apart by lightness, each up to halfway to the next.
  const g = rules.greys
  for (let i = 0; i < g.length - 1; i++) if (L < (g[i].L0 + g[i + 1].L0) / 2) return g[i].name
  return g[g.length - 1].name
}

const LABELS = (rules) => [...rules.colors.map((c) => c.name), 'grey', 'other']
// Shares of one frame (RGB bytes, 3 per pixel) over its visibly lit pixels, and its label map when asked.
function sharesOf(rules, rgb, n, wantMap = false) {
  const counts = Object.fromEntries([...LABELS(rules), 'none'].map((k) => [k, 0]))
  const labels = wantMap ? new Array(n) : null
  const cache = new Map()
  for (let p = 0; p < n; p++) {
    const key = (rgb[3 * p] << 16) | (rgb[3 * p + 1] << 8) | rgb[3 * p + 2]
    let label = cache.get(key)
    if (label === undefined) {
      const [L, a, b] = oklab([LIN[rgb[3 * p]], LIN[rgb[3 * p + 1]], LIN[rgb[3 * p + 2]]])
      label = readAs(rules, L, a, b)
      cache.set(key, label)
    }
    counts[label]++
    if (labels) labels[p] = label
  }
  const lit = n - counts.none
  const shares = Object.fromEntries(LABELS(rules).map((k) => [k, lit ? counts[k] / lit : 0]))
  return { shares, lit: lit / n, labels }
}

// The asked shares at the default mix (owner, 2026-11-09 10:03 PM): Meta Blue 50%, the other pack colors even.
function defaultAsked(pack) {
  const others = pack.colors.filter((c) => c.hex.toUpperCase() !== META_BLUE)
  return Object.fromEntries(pack.colors.map((c) => [c.name, c.hex.toUpperCase() === META_BLUE ? 0.5 : 0.5 / others.length]))
}
// A mix by name, from src/light/color/mix.ts: `default`, `blue-off` (Meta Blue at 0%), or `<color>:<share>` such as
// `Cyan:0.6`, set on the default mix with the others keeping their ratios; null when the pack has no such color.
function mixByName(mixes, pack, name) {
  if (name === 'default') return mixes.defaultMix(pack)
  if (name === 'blue-off') return mixes.setMetaBlue(pack, mixes.defaultMix(pack), false)
  const [color, share] = name.split(':')
  const index = pack.colors.findIndex((c) => c.name.toLowerCase() === color.toLowerCase())
  if (index < 0 || !(Number(share) >= 0)) return null
  return mixes.setShare(pack, mixes.defaultMix(pack), index, Number(share))
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
    const r = sharesOf(rulesById[packId], data, info.width * info.height, Boolean(args.maps))
    rows.push({ file: name, pack: packId, lit: +r.lit.toFixed(4), shares: round(r.shares) })
    if (args.maps) items.push({ title: name.replace(/\.(png|jpe?g)$/i, ''), png: await sharp(path.join(dir, name)).png().toBuffer(), labels: r.labels, rules: rulesById[packId], shares: r.shares, w: info.width, h: info.height })
  }
  await fs.writeFile(path.join(outDir, 'shares.json'), JSON.stringify(rows, null, 1))
  await fs.writeFile(path.join(outDir, 'shares.txt'), `${rows.map((r) => `${r.file}: lit ${pct(r.lit)} | ${shareText(rulesById[r.pack], r.shares)}`).join('\n')}\n`)
  if (args.maps) for (let i = 0; i < items.length; i += 12) await drawSheet(items.slice(i, i + 12), path.join(outDir, `maps-${String(i / 12 + 1).padStart(2, '0')}.jpg`), `${path.basename(dir)}: frames and what each pixel reads as (grey: grey or pale bridge; magenta: another color; black: none)`)
  console.log(`${rows.length} files: ${path.relative(process.cwd(), path.join(outDir, 'shares.txt'))}`)
}
const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +v.toFixed(4)]))

// The looks at HEAD: each look, pack, seed, format and view, rendered as the tool shows it.
async function looksRun(harness, rulesById, getPack) {
  const lookArg = list(args.look)
  if (!lookArg.length) throw new Error('usage: color-shares.mjs --look <contour.beam|beam|...|all> [--seeds 1-8] [--drag default,owner|all] [--format 16x9,9x16] [--maps] [--out dir]; or --files <dir> [--pack id] [--maps]; or --swatches')
  const looks = lookArg.includes('all') ? LOOKS : lookArg.map((l) => (l.includes('.') ? l : LOOKS.find((id) => id.endsWith(`.${l}`)) ?? l))
  for (const look of looks) if (!LOOKS.includes(look)) throw new Error(`Unknown look ${look}`)
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
  // --mix <name>: the shared color stage on at that mix (src/light/color/stage.ts): the design is drawn in the
  // stage's design pack and the stage gives it the picked pack's colors.
  const mixName = typeof args.mix === 'string' ? args.mix : null
  let stage = null
  let mixes = null
  if (mixName) {
    stage = await harness.ssr('/src/light/color/stage.ts').catch(() => null)
    if (!stage?.withColorMix || !stage.COLOR_DESIGN_PACK) throw new Error('--mix: this checkout has no color stage yet (src/light/color/stage.ts with withColorMix and COLOR_DESIGN_PACK)')
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
            const r = sharesOf(rulesById[packId], rgb, width * height, Boolean(args.maps))
            const flags = !mixName || mixName === 'default' ? flagsOf(pack, r.shares) : []
            frames.push({ look, pack: packId, seed, format, view, lit: +r.lit.toFixed(4), asked: round(asked), shares: round(r.shares), flags })
            if (args.maps) items.push({ title: `${packId} s${seed} ${format.replace('x', ':')} ${view}`, png: await sharp(rgb, { raw: { width, height, channels: 3 } }).png().toBuffer(), labels: r.labels, rules: rulesById[packId], shares: r.shares, flags, w: width, h: height })
          }
        }
      }
    }
    if (args.maps) for (let i = 0; i < items.length; i += 24) await drawSheet(items.slice(i, i + 24), path.join(outDir, `${look}-${String(i / 24 + 1).padStart(2, '0')}.jpg`), `${look}: frames and what each pixel reads as (grey: grey or pale bridge; magenta: another color; black: none); orange title: flagged at the default mix`)
  }
  await fs.writeFile(path.join(outDir, 'shares.json'), JSON.stringify({ rules: T, mix: mixName, seeds, formats, views, frames }, null, 1))
  await fs.writeFile(path.join(outDir, 'summary.md'), summaryOf(frames, looks, formats, views, seeds, getPack, rulesById, mixName, Math.round((Date.now() - started) / 1000)))
  const flagged = frames.filter((f) => f.flags.length).length
  console.log(`${frames.length} frames in ${Math.round((Date.now() - started) / 1000)} s${mixName && mixName !== 'default' ? '' : `; ${flagged} flagged at the default mix`}; summary: ${path.relative(process.cwd(), path.join(outDir, 'summary.md'))}`)
}

// Per look, pack, format and view: the median share of each entry over the seeds (with its range), next to the
// asked shares, and the seeds flagged.
function summaryOf(frames, looks, formats, views, seeds, getPack, rulesById, mixName, seconds) {
  const source = mixName ? `the color stage on at the mix \`${mixName}\`; asked: that mix's shares` : "today's coloring (no color stage); asked: the default mix, Meta Blue 50% and the other pack colors even"
  const lines = ['# Color shares', '', `Seeds ${seeds[0]}-${seeds.at(-1)}; ${formats.map((f) => f.replace('x', ':')).join(' and ')}; ${views.join(', ')}; ${source}; ${frames.length} frames in ${seconds} s. Each cell: the median share of the visibly lit pixels (Oklab L ${T.visible} and up) over the seeds, with the lowest and highest in brackets.${!mixName || mixName === 'default' ? ' Flagged: Meta Blue under 45% or a pack color under 5%.' : ''}`, '']
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
  return `${lines.join('\n')}\n`
}

// --- main ---

await fs.mkdir(outDir, { recursive: true })
const harness = await startHarness()
try {
  const { PACKS, getPack } = await harness.ssr('/src/light/color/packs.ts')
  const rulesById = Object.fromEntries(PACKS.map((p) => [p.id, rulesFor(p)]))
  if (args.swatches) await swatches(rulesById, getPack)
  else if (typeof args.files === 'string') await files(rulesById)
  else await looksRun(harness, rulesById, getPack)
} finally {
  await harness.close()
}
