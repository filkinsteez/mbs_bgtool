import path from 'node:path'
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const stage = process.argv[2] || 'current'
const selectedLook = process.argv.find(arg => arg.startsWith('--look='))?.slice(7)
const selectedControl = process.argv.find(arg => arg.startsWith('--control='))?.slice(10)
const portrait = process.argv.includes('--portrait')
const profile = process.argv.includes('--folded') ? 'folded' : 'default'
if (selectedLook && !['diffusion', 'halo', 'flow', 'smear'].includes(selectedLook)) throw new Error('Unknown look')
if (selectedControl && !['complexity', 'softness', 'distortion', 'scale', 'folds', 'bleed', 'depth', 'reflow', 'grain'].includes(selectedControl)) throw new Error('Unknown control')
const seed = Number(process.env.AUDIT_SEED || 1913)
const directory = path.resolve(root, '../../outputs/gradient-controls', stage)
const files = (await readdir(path.join(root, 'src/core/lab/gradients')))
  .filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  .map(name => name.slice(0, -3)).sort()
const snapshot = async () => Object.fromEntries(await Promise.all(files.map(async name => [name, createHash('sha256').update(await readFile(path.join(root, `src/core/lab/gradients/${name}.ts`))).digest('hex')])))
const before = await snapshot()
const server = await createServer({ configFile: false, root, logLevel: 'error', resolve: { alias: { '@': path.join(root, 'src') } }, server: { host: '127.0.0.1', port: 0 } })
let browser
try {
  await mkdir(directory, { recursive: true })
  await server.listen()
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/scripts/look-thumbnails.html`)
  await page.waitForFunction(() => document.documentElement.dataset.thumbnails === 'ready')
  const results = []
  for (const mode of ['2d', '3d']) for (const id of selectedLook ? [selectedLook] : ['diffusion', 'halo', 'flow', 'smear']) {
    const group = await page.evaluate(async ({ mode, id, seed, selectedControl, portrait, profile }) => {
      const image = new Image(); image.src = '/scripts/fixtures/rendered-loop.png'; await image.decode()
      const { createLabSourceFromImage } = await import('/src/core/lab/sourceCache.ts')
      const source = createLabSourceFromImage(image, image.width, image.height)
      const { createDefaultBackgroundRecipe, renderExample, PALETTE_PACKS, colorMixForPack } = window
      const rows = [], sheets = []
      for (const pack of PALETTE_PACKS.slice(0, 6)) {
        const controls = selectedControl ? [selectedControl] : ['complexity', 'softness', 'distortion', 'scale', 'folds', 'bleed', 'depth', 'reflow', 'grain']
        const width = portrait ? 180 : 320, height = portrait ? 320 : 180, rowHeight = height + 22
        const sheet = document.createElement('canvas'); sheet.width = width * 3; sheet.height = 28 + controls.length * rowHeight
        const ctx = sheet.getContext('2d'); ctx.fillStyle = '#111418'; ctx.fillRect(0, 0, sheet.width, sheet.height)
        ctx.fillStyle = '#fff'; ctx.font = '15px sans-serif'; ctx.fillText(`${mode} / ${id} / ${pack.label} — 0 / 50 / 100`, 10, 20)
        const rgb = pack.colors.map(hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)))
        let paletteRange = 1
        for (const a of rgb) for (const b of rgb) paletteRange = Math.max(paletteRange, Math.hypot(...a.map((c, i) => c - b[i])) / Math.sqrt(3))
        for (let row = 0; row < controls.length; row++) {
          const control = controls[row], recipe = createDefaultBackgroundRecipe(seed)
          if (portrait) recipe.format = { aspect: '9:16', width: 2160, height: 3840 }
          recipe.palette = { packId: pack.id, mix: colorMixForPack(pack), ground: pack.colors.at(-1), ink: pack.colors[0] }
          recipe.look = { version: 'gradients', id, detail: .5, gradient: { softness: .65, distortion: .45, grain: 0, depth: .45, reflow: .5 } }
          if (profile === 'folded') Object.assign(recipe.look.gradient, { softness: .41, distortion: .44, scale: .49, folds: .77, bleed: .41, depth: .68, reflow: .13 })
          const frames = []
          for (const [column, value] of [0, .5, 1].entries()) {
            if (control === 'complexity') recipe.look.detail = value
            else recipe.look.gradient[control] = value
            const canvas = renderExample(recipe, mode === '3d' ? source : null, 480)
            frames.push(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data)
            ctx.drawImage(canvas, column * width, 28 + row * rowHeight, width, height)
            ctx.fillStyle = '#fff'; ctx.font = '13px sans-serif'; ctx.fillText(`${control}: ${value * 100}`, column * width + 8, 43 + height + row * rowHeight)
          }
          const difference = (a, b) => {
            let total = 0, changed = 0
            for (let i = 0; i < a.length; i += 4) {
              const delta = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3
              total += delta
              if (delta > paletteRange * .10) changed++
            }
            return { mean: total / (a.length / 4), changedFraction: changed / (a.length / 4) }
          }
          const endpoint = difference(frames[0], frames[2]), lowerHalf = difference(frames[0], frames[1]), upperHalf = difference(frames[1], frames[2])
          // A useful screening floor, followed by inspection of the saved images.
          // Grain changes texture; the other controls must change substantial areas.
          // Also catch a stuck half of the slider. This smaller floor checks
          // responsiveness; endpoint contrast remains the notability screen.
          const halvesRespond = Math.min(lowerHalf.mean, upperHalf.mean) / paletteRange > .015
          const pass = (control === 'grain' ? endpoint.mean > 8 : endpoint.mean / paletteRange > .10 && endpoint.changedFraction > .25) && halvesRespond
          rows.push({ mode, id, palette: pack.id, control, paletteRange, ...endpoint, normalized: endpoint.mean / paletteRange, lowerHalf: lowerHalf.mean, upperHalf: upperHalf.mean, halvesRespond, pass })
        }
        sheets.push({ name: `${mode}-${id}-${pack.id}.png`, data: sheet.toDataURL().split(',')[1] })
      }
      return { rows, sheets }
    }, { mode, id, seed, selectedControl, portrait, profile })
    results.push(...group.rows)
    for (const sheet of group.sheets) await writeFile(path.join(directory, sheet.name), Buffer.from(sheet.data, 'base64'))
    console.log(`${mode} ${id}: ${group.rows.filter(row => row.pass).length}/${group.rows.length} meet the endpoint screening floor`)
  }
  const stable = JSON.stringify(before) === JSON.stringify(await snapshot())
  await writeFile(path.join(directory, 'results.json'), JSON.stringify({ seed, portrait, profile, stable, snapshot: before, results }, null, 2))
  const weak = results.filter(row => !row.pass)
  const summary = weak.map(row => `${row.mode} ${row.id} ${row.palette} ${row.control}: mean ${row.mean.toFixed(2)}/255, ${(row.normalized * 100).toFixed(1)}% of palette range, ${(row.changedFraction * 100).toFixed(0)}% of pixels visibly changed; half ranges ${row.lowerHalf.toFixed(2)} / ${row.upperHalf.toFixed(2)}`).join('\n')
  await writeFile(path.join(directory, 'weak-controls.txt'), summary)
  console.log(`${results.length - weak.length}/${results.length} meet the screening floor. Stable renderer: ${stable}. Visual evidence: ${directory}`)
  console.log(summary)
  if (!stable) throw new Error('Renderer changed during audit')
  if (weak.length && process.argv.includes('--strict')) throw new Error(`${weak.length} controls have weak endpoint ranges; inspect weak-controls.txt and the saved images`)
} finally { await browser?.close(); await server.close() }
