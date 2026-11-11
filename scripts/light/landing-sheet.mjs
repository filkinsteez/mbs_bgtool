// Landing sheet (coordinator, 2026-11-11 5:23 PM): nothing lands in the color stage or a look until the coordinator
// has looked at this sheet. It draws HEAD and a candidate as the tool draws them, with the color stage on, side by side
// with a difference map and a banding score for each frame:
//   - every mood in every pack at the default mix and default view, seeds 1, 2 and 4, at 16:9;
//   - one 9:16 frame per mood;
//   - one color at 75% per pack (Cyan in Bold, Lime in Elemental, Ice in Atmospheric) in each mood;
//   - Sunrise Bold under the four test drags and a vertical drag;
//   - the owner's frames of 2026-11-11 (Contour s17 and s35 in three packs, Rush Elemental s2 and Sunrise Bold s2
//     with his drags).
//
//   node scripts/light/landing-sheet.mjs [--candidate <patch file | copy folder | commit>] [--base <commit>]
//     [--out <dir>] [--keep-frames]
//
// The base (HEAD unless --base) is drawn from a frozen copy made with git archive. A patch is applied to a second
// frozen copy of the base; a commit gets its own copy; a folder is drawn as it is. Without --candidate the sheet shows
// the base alone. Copies the tool makes are deleted at the end. Output: sheet.jpg (every frame), sunrise.jpg,
// contour.jpg and rush.jpg, summary.md and frames.json; --keep-frames also keeps each render as a PNG.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { BANDING, bandingScore, LIN, oklab } from './lib/banding.mjs'
import { TEST_DRAGS } from './lib/drag-colors.mjs'
import { ROOT } from './lib/harness.mjs'

const LONG = 480
const SUPERSAMPLE = 2
const CHANGED = 0.02 // Oklab difference above which a pixel counts as changed
const DIFF_FULL = 0.1 // Oklab difference drawn at full brightness in the difference map
const COPY_PATHS = ['src', 'scripts', 'public', 'package.json', 'tsconfig.json']

const MOODS = ['sunset', 'contour', 'rush']
const MOOD_NAME = { sunset: 'Sunrise', contour: 'Contour', rush: 'Rush' }
const MOOD_FILE = { sunset: 'sunrise', contour: 'contour', rush: 'rush' }
const PACKS = ['bold', 'elemental', 'atmospheric']
const PACK_NAME = { bold: 'Bold', elemental: 'Elemental', atmospheric: 'Atmospheric' }
const UP_COLOR = { bold: 'Cyan', elemental: 'Lime', atmospheric: 'Ice' }
const UP_SHARE = 0.75
const VERTICAL_DRAG = { name: 'vertical', from: [0.5, 0.85], to: [0.5, 0.15] }
const SECTION_TITLE = {
  default: 'Default mix and default view, seeds 1, 2 and 4, 16:9',
  portrait: 'One 9:16 frame per mood',
  up: `One color at ${UP_SHARE * 100}% (Cyan, Lime, Ice), seed 1`,
  drags: 'Sunrise Bold, seed 1, under the four test drags and a vertical drag',
  owner: 'The owner\u2019s frames of 2026-11-11',
}

export function landingFrames() {
  const frames = []
  const add = (f) => frames.push({ format: '16x9', color: null, drag: null, note: '', ...f })
  for (const mood of MOODS) for (const pack of PACKS) for (const seed of [1, 2, 4]) add({ section: 'default', mood, pack, seed })
  MOODS.forEach((mood, i) => add({ section: 'portrait', mood, pack: PACKS[i], seed: 1, format: '9x16' }))
  for (const mood of MOODS) for (const pack of PACKS) add({ section: 'up', mood, pack, seed: 1, color: UP_COLOR[pack] })
  for (const drag of [...TEST_DRAGS, VERTICAL_DRAG]) add({ section: 'drags', mood: 'sunset', pack: 'bold', seed: 1, drag })
  for (const seed of [17, 35]) for (const pack of PACKS) add({ section: 'owner', mood: 'contour', pack, seed, note: 'the owner\u2019s frame' })
  add({ section: 'owner', mood: 'rush', pack: 'elemental', seed: 2, drag: { name: 'owner, 2026-11-11', from: [0.85, 0.5], to: [0.85, 0.9] }, note: 'the owner\u2019s frame' })
  add({ section: 'owner', mood: 'sunset', pack: 'bold', seed: 2, drag: { name: 'owner, 2026-11-11', from: [0.5, 0.1], to: [0.5, 0.7] }, note: 'the owner\u2019s frame' })
  return frames.map((f) => ({
    ...f,
    id: [f.section, f.mood, f.pack, `s${f.seed}`, f.format, f.color && `${f.color.toLowerCase()}${UP_SHARE * 100}`, f.drag && f.drag.name.split(',')[0]].filter(Boolean).join('-'),
  }))
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new Error(`unexpected argument ${argv[i]}`)
    const [key, inline] = argv[i].slice(2).split('=')
    if (inline !== undefined) args[key] = inline
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) args[key] = argv[++i]
    else args[key] = true
  }
  return args
}

const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }).trim()

function frozenCopy(rev, dir) {
  if (fs.existsSync(dir)) throw new Error(`${dir} already exists`)
  fs.mkdirSync(dir, { recursive: true })
  execFileSync('sh', ['-c', 'r="$1"; v="$2"; d="$3"; shift 3; git -C "$r" archive "$v" "$@" | tar -x -C "$d"', 'sh', ROOT, rev, dir, ...COPY_PATHS])
  if (!fs.existsSync(path.join(dir, 'scripts/light/lib/harness.mjs'))) throw new Error(`git archive of ${rev} into ${dir} failed`)
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'))
}

// Splits a label line at spaces into lines of at most n characters.
function wrap(s, n) {
  const lines = ['']
  for (const word of s.split(' ')) {
    const last = lines.at(-1)
    if (last && last.length + 1 + word.length > n) lines.push(word)
    else lines[lines.length - 1] = last ? `${last} ${word}` : word
  }
  return lines
}

function frameText(f) {
  const what = f.color ? `${f.color} at ${UP_SHARE * 100}%` : 'default mix'
  const view = f.drag ? `drag ${f.drag.name}: (${f.drag.from.join(', ')}) to (${f.drag.to.join(', ')})` : 'default view'
  return { title: `${MOOD_NAME[f.mood]} ${PACK_NAME[f.pack]}, seed ${f.seed}`, lines: [`${what}, ${f.format.replace('x', ':')}`, view, f.note].filter(Boolean) }
}

async function renderSide(copy, frames) {
  // Each side loads the harness from its own copy: the harness serves the src of the repo it sits in.
  const { startHarness } = await import(pathToFileURL(path.join(copy, 'scripts/light/lib/harness.mjs')).href)
  const harness = await startHarness()
  const out = new Map()
  try {
    const tool = await harness.ssr('/src/tool/controls.ts')
    const filters = await harness.ssr('/src/tool/filterControl.ts')
    const state = await harness.ssr('/src/tool/state.ts')
    const { getPack } = await harness.ssr('/src/light/color/packs.ts')
    const stage = await harness.ssr('/src/light/color/stage.ts')
    const mixes = await harness.ssr('/src/light/color/mix.ts')
    const design = getPack(stage.COLOR_DESIGN_PACK)
    for (const f of frames) {
      try {
        const look = state.MOOD_LOOKS[f.mood]
        const aspect = f.format === '9x16' ? 9 / 16 : 16 / 9
        const pack = getPack(f.pack)
        const index = f.color ? pack.colors.findIndex((c) => c.name === f.color) : -1
        const mix = index >= 0 ? mixes.setShare(pack, mixes.defaultMix(pack), index, UP_SHARE) : mixes.defaultMix(pack)
        const drag = f.drag ? tool.clampDrag(f.drag) : undefined
        const controls = tool.toolControls(look, design, f.seed, aspect, drag)
        const built = stage.withColorMix(tool.buildScene(look, design, f.seed, controls, aspect), pack, mix)
        const scene = filters.withFilter(built, { filter: 'none', strength: 0.5 })
        const [width, height] = aspect > 1 ? [LONG, Math.round(LONG / aspect)] : [Math.round(LONG * aspect), LONG]
        const image = await harness.render({ scene, width, height, supersample: SUPERSAMPLE })
        const rgb = await sharp(image.data, { raw: { width, height, channels: 4 } }).removeAlpha().raw().toBuffer()
        out.set(f.id, { rgb, width, height })
      } catch (error) {
        out.set(f.id, { error: String(error.message ?? error).split('\n')[0] })
      }
    }
  } finally {
    await harness.close()
  }
  return out
}

function difference(a, b) {
  const n = a.width * a.height
  const map = Buffer.alloc(n * 3)
  let changed = 0
  let sum = 0
  const lab = (rgb, i) => oklab([LIN[rgb[3 * i]], LIN[rgb[3 * i + 1]], LIN[rgb[3 * i + 2]]])
  for (let i = 0; i < n; i++) {
    const [p, q] = [lab(a.rgb, i), lab(b.rgb, i)]
    const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
    sum += d
    if (d > CHANGED) changed++
    const v = Math.min(1, d / DIFF_FULL)
    map[3 * i] = Math.round(255 * Math.min(1, 3 * v))
    map[3 * i + 1] = Math.round(255 * Math.min(1, Math.max(0, 3 * v - 1)))
    map[3 * i + 2] = Math.round(255 * Math.min(1, Math.max(0, 3 * v - 2)))
  }
  return { map, changed: changed / n, mean: sum / n }
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
const svg = (w, h, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`)
const txt = (x, y, s, size = 12, fill = '#ccc', weight = 'normal') =>
  `<text x="${x}" y="${y}" font-family="Helvetica" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(s)}</text>`
const thumb = (r, w, h) => sharp(r.rgb, { raw: { width: r.width, height: r.height, channels: 3 } }).resize(w, h).png().toBuffer()
const placeholder = (w, h, message) => svg(w, h, `<rect width="${w}" height="${h}" fill="#3a1d1d"/>${txt(8, 20, 'did not render', 12, '#f99')}${txt(8, 38, message.slice(0, 48), 10, '#f99')}`)
const bandsText = (s) => (s.error ? 'did not render' : `${s.bands} band${s.bands === 1 ? '' : 's'}, ${s.sharp} sharp`)
const bandsColor = (base, cand) => {
  if (base.error || cand.error) return '#ccc'
  const [more, fewer] = [cand.bands > base.bands || cand.sharp > base.sharp, cand.bands < base.bands || cand.sharp < base.sharp]
  return more ? '#ffb070' : fewer ? '#9d9' : '#ccc'
}

const [PAD, GAP, LABEL, CELL, DIFF, WIDTH] = [8, 6, 150, 310, 160, 960]
const cellSize = (format, box = CELL) => (format === '9x16' ? [Math.round((box * 9) / 16), box] : [box, Math.round((box * 9) / 16)])

// One sheet: pairs in rows (label, base, candidate, difference map), or the base alone in a grid of three.
async function composeSheet(rows, names, title, file, paired) {
  const parts = []
  let top = 0
  const header = (text, size, fill) => {
    parts.push({ input: svg(WIDTH, size + 14, txt(PAD, size + 4, text, size, fill, 'bold')), left: 0, top })
    top += size + 14
  }
  header(title, 16, '#fff')
  if (paired) {
    const x = [PAD + LABEL + GAP, PAD + LABEL + GAP + CELL + GAP, PAD + LABEL + 2 * (GAP + CELL) + GAP]
    parts.push({ input: svg(WIDTH, 20, [txt(x[0], 14, names.base, 12, '#bbb'), txt(x[1], 14, names.candidate, 12, '#bbb'), txt(x[2], 14, 'difference', 12, '#bbb')].join('')), left: 0, top })
    top += 22
  }
  let section = null
  let grid = []
  const flushGrid = async () => {
    if (!grid.length) return
    const height = Math.max(...grid.map((r) => cellSize(r.frame.format)[1]))
    for (const [k, r] of grid.entries()) {
      const left = PAD + k * (CELL + GAP)
      const [w, h] = cellSize(r.frame.format)
      const t = frameText(r.frame)
      const label = [txt(0, 13, t.title, 12, '#fff', 'bold'), txt(0, 28, t.lines.join('; ').slice(0, 56), 10, '#aaa'), txt(0, 42, bandsText(r.base), 10, '#ccc')]
      parts.push({ input: svg(CELL, 48, label.join('')), left, top })
      parts.push({ input: r.base.thumb ? await r.base.thumb(w, h) : placeholder(w, h, r.base.error), left, top: top + 48 })
    }
    top += 48 + height + GAP + 4
    grid = []
  }
  for (const r of rows) {
    if (r.frame.section !== section) {
      await flushGrid()
      section = r.frame.section
      header(SECTION_TITLE[section], 13, '#e8c870')
    }
    if (!paired) {
      grid.push(r)
      if (grid.length === 3) await flushGrid()
      continue
    }
    const [w, h] = cellSize(r.frame.format)
    const [dw, dh] = cellSize(r.frame.format, DIFF)
    const t = frameText(r.frame)
    const titles = wrap(t.title, 20)
    const lines = t.lines.flatMap((l) => wrap(l, 27))
    const textTop = 14 + titles.length * 16
    const rowH = Math.max(h, textTop + 36 + lines.length * 15)
    const label = [...titles.map((l, k) => txt(0, 14 + k * 16, l, 13, '#fff', 'bold')), ...lines.map((l, k) => txt(0, textTop + 4 + k * 15, l, 10, '#aaa'))]
    const bandsY = textTop + 4 + lines.length * 15 + 6
    label.push(txt(0, bandsY, `base: ${bandsText(r.base)}`, 11, '#ccc'))
    label.push(txt(0, bandsY + 16, `new: ${bandsText(r.cand)}`, 11, bandsColor(r.base, r.cand)))
    parts.push({ input: svg(LABEL, rowH, label.join('')), left: PAD, top })
    const x0 = PAD + LABEL + GAP
    parts.push({ input: r.base.thumb ? await r.base.thumb(w, h) : placeholder(w, h, r.base.error), left: x0, top })
    parts.push({ input: r.cand.thumb ? await r.cand.thumb(w, h) : placeholder(w, h, r.cand.error), left: x0 + CELL + GAP, top })
    const xd = x0 + 2 * (CELL + GAP)
    if (r.diff) {
      parts.push({ input: await sharp(r.diff.map, { raw: { width: r.diff.width, height: r.diff.height, channels: 3 } }).resize(dw, dh).png().toBuffer(), left: xd, top })
      const says = r.diff.changed === 0 ? 'no pixel changed' : `changed: ${(100 * r.diff.changed).toFixed(1)}% of pixels`
      parts.push({ input: svg(DIFF, 34, txt(0, 13, says, 11, r.diff.changed > 0 ? '#ffb070' : '#9d9') + txt(0, 28, `mean difference ${r.diff.mean.toFixed(4)}`, 10, '#aaa')), left: xd, top: top + dh + 4 })
    }
    top += rowH + GAP + 4
  }
  await flushGrid()
  await sharp({ create: { width: WIDTH, height: top + PAD, channels: 3, background: '#161616' } }).composite(parts).jpeg({ quality: 82 }).toFile(file)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '')
  const out = path.resolve(typeof args.out === 'string' ? args.out : path.join(ROOT, 'artifacts', 'landing-sheet', stamp))
  fs.mkdirSync(out, { recursive: true })
  const baseRev = git('rev-parse', '--short=8', `${typeof args.base === 'string' ? args.base : 'HEAD'}^{commit}`)
  const made = []
  const copyFor = (rev, tag) => {
    const dir = path.join('/tmp', `landing-${stamp}-${tag}`)
    frozenCopy(rev, dir)
    made.push(dir)
    return dir
  }
  const names = { base: `HEAD ${baseRev}`, candidate: null }
  if (typeof args.base === 'string') names.base = `base ${baseRev}`
  try {
    const base = copyFor(baseRev, 'base')
    let cand = null
    const c = typeof args.candidate === 'string' ? args.candidate : null
    if (c && fs.existsSync(c) && fs.statSync(c).isDirectory()) {
      cand = path.resolve(c)
      names.candidate = `copy ${path.basename(cand)}`
    } else if (c && fs.existsSync(c)) {
      cand = copyFor(baseRev, 'candidate')
      execFileSync('git', ['apply', '--check', path.resolve(c)], { cwd: cand })
      execFileSync('git', ['apply', path.resolve(c)], { cwd: cand })
      names.candidate = `${baseRev} with ${path.basename(c)}`
    } else if (c) {
      const rev = git('rev-parse', '--short=8', `${c}^{commit}`)
      cand = copyFor(rev, 'candidate')
      names.candidate = `commit ${rev}`
    }
    const frames = landingFrames()
    const started = Date.now()
    const baseRenders = await renderSide(base, frames)
    const candRenders = cand ? await renderSide(cand, frames) : null
    const rows = frames.map((frame) => {
      const side = (r) => (r.error ? { error: r.error } : { ...bandingScore(r.rgb, r.width, r.height), thumb: (w, h) => thumb(r, w, h) })
      const b = baseRenders.get(frame.id)
      const row = { frame, base: side(b) }
      if (candRenders) {
        const k = candRenders.get(frame.id)
        row.cand = side(k)
        if (!b.error && !k.error && b.width === k.width && b.height === k.height) row.diff = { ...difference(b, k), width: b.width, height: b.height }
      }
      return row
    })
    if (args['keep-frames']) {
      for (const [tag, renders] of [['base', baseRenders], ['candidate', candRenders]]) {
        if (!renders) continue
        fs.mkdirSync(path.join(out, tag), { recursive: true })
        for (const [id, r] of renders) if (!r.error) await sharp(r.rgb, { raw: { width: r.width, height: r.height, channels: 3 } }).png().toFile(path.join(out, tag, `${id}.png`))
      }
    }
    const paired = Boolean(candRenders)
    const what = paired ? `${names.base} and ${names.candidate}` : names.base
    await composeSheet(rows, names, `Landing sheet: ${what}. Stage on, as the tool draws.`, path.join(out, 'sheet.jpg'), paired)
    for (const mood of MOODS) {
      await composeSheet(rows.filter((r) => r.frame.mood === mood), names, `${MOOD_NAME[mood]}: ${what}`, path.join(out, `${MOOD_FILE[mood]}.jpg`), paired)
    }
    const seconds = Math.round((Date.now() - started) / 1000)
    const kept = (s) => ({ bands: s.bands ?? null, sharp: s.sharp ?? null, angle: s.angle ?? null, error: s.error ?? null })
    const record = rows.map((r) => ({
      ...r.frame,
      base: kept(r.base),
      ...(paired ? { candidate: kept(r.cand) } : {}),
      ...(r.diff ? { changed: r.diff.changed, meanDifference: r.diff.mean } : {}),
    }))
    fs.writeFileSync(path.join(out, 'frames.json'), JSON.stringify({ base: names.base, candidate: names.candidate, frames: record }, null, 1))
    const summary = [
      `# Landing sheet: ${what}`,
      '',
      `${new Date().toISOString()}. ${frames.length} frames, drawn as the tool draws them with the color stage on (\`toolControls\`, \`buildScene\`, \`withColorMix\`, no filter), ${LONG} px on the long side, in ${seconds} s. Sheets: \`sheet.jpg\` (every frame), ${MOODS.map((m) => `\`${MOOD_FILE[m]}.jpg\``).join(', ')}.`,
      '',
      `Bands: the most hue bands along one of ${BANDING.angles} lines through the frame's brightest place, a band holding its hue within ${BANDING.tolerance} degrees for ${BANDING.band} px or more; sharp: the most sharp hue steps on one of those lines (\`lib/banding.mjs\`). A hint for the eye, not a gate.${paired ? ` Changed: the share of pixels whose Oklab difference is over ${CHANGED}; the difference map is brightest at ${DIFF_FULL} and over.` : ''}`,
      '',
      paired ? '| Frame | Base | Candidate | Changed | Mean difference |' : '| Frame | Bands |',
      paired ? '| --- | --- | --- | --- | --- |' : '| --- | --- |',
      ...rows.map((r) => {
        const t = frameText(r.frame)
        const name = `${t.title}; ${t.lines.join('; ')}`
        const bands = (s) => (s.error ? `did not render: ${s.error}` : bandsText(s))
        if (!paired) return `| ${name} | ${bands(r.base)} |`
        return `| ${name} | ${bands(r.base)} | ${bands(r.cand)} | ${r.diff ? `${(100 * r.diff.changed).toFixed(1)}%` : '-'} | ${r.diff ? r.diff.mean.toFixed(4) : '-'} |`
      }),
      '',
    ]
    fs.writeFileSync(path.join(out, 'summary.md'), summary.join('\n'))
    console.log(`${frames.length} frames in ${seconds} s; sheets and summary in ${path.relative(process.cwd(), out) || '.'}`)
  } finally {
    for (const dir of made) fs.rmSync(dir, { recursive: true, force: true })
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main()
