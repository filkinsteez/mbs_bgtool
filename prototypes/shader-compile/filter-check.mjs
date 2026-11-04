// Picks each Filter in the tool's panel on the dev server and checks the panel, the URL, a reload from that URL, the
// preview, and an export against the preview. Usage: node filter-check.mjs [base url] [out dir]
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'
import sharp from 'sharp'

const base = process.argv[2] ?? 'http://localhost:3000'
const out = process.argv[3] ?? new URL('./out/filter-check', import.meta.url).pathname
mkdirSync(out, { recursive: true })
const notes = []
const errors = []
const COMPARE = { width: 480, height: 270 }

const canvasData = (page) => page.evaluate(() => ({ ...document.querySelector('canvas.tool-canvas').dataset }))

async function settled(page, previousFrame) {
  await page.waitForFunction(
    (prev) => {
      const canvas = document.querySelector('canvas.tool-canvas')
      return canvas?.dataset.settled === 'true' && canvas.dataset.frame !== prev
    },
    previousFrame ?? null,
    { timeout: 120_000 },
  )
  await page.waitForTimeout(300)
  return (await canvasData(page)).frame
}

const panelText = async (page) => (await page.locator('.tool-panel').innerText()).replace(/\s+/g, ' ')

async function pick(page, label) {
  const frame = (await canvasData(page)).frame
  await page.locator('[data-dial-path="filter"]').click()
  await page.locator('.dialkit-select-dropdown .dialkit-select-option').getByText(label, { exact: true }).click()
  return settled(page, frame)
}

/** Area-averaged RGB at COMPARE size. */
const small = async (png) => sharp(png).removeAlpha().resize(COMPARE.width, COMPARE.height, { kernel: 'cubic', fit: 'fill' }).raw().toBuffer()

function difference(a, b) {
  let sum = 0
  let max = 0
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i])
    sum += d
    max = Math.max(max, d)
  }
  return { mean: sum / a.length, max }
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true })
  page.on('pageerror', (error) => errors.push(`page error: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') errors.push(`console ${message.type()}: ${message.text().slice(0, 300)}`)
  })
  const query = 'mood=sunset&look=ramp&pack=bold&intensity=0.5&softness=0.5&horizon=0.5&seed=3&format=16x9'
  await page.goto(`${base}/?${query}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.waitForSelector('canvas.tool-canvas', { timeout: 120_000 })
  await settled(page)
  const shots = {}
  for (const [label, key] of [
    ['Grain', 'grain'],
    ['ASCII', 'ascii'],
    ['Pixel', 'pixel'],
    ['None', 'none'],
  ]) {
    await pick(page, label)
    const panel = await panelText(page)
    const url = page.url()
    const strengthShown = panel.includes('Strength')
    const urlHas = key === 'none' ? !url.includes('filter=') : url.includes(`filter=${key}&strength=0.5`)
    const preview = await page.locator('canvas.tool-canvas').screenshot()
    shots[key] = preview
    const meta = await sharp(preview).metadata()
    await sharp(preview).resize(960).jpeg({ quality: 90 }).toFile(`${out}/preview-${key}.jpg`)
    const crop = { left: Math.round(meta.width * 0.4), top: Math.round(meta.height * 0.3), width: 300, height: 300 }
    await sharp(preview).extract(crop).resize(900, 900, { kernel: 'nearest' }).jpeg({ quality: 90 }).toFile(`${out}/preview-${key}-crop3x.jpg`)
    notes.push(`${label}: panel "${panel}"`)
    notes.push(`  url ${url.replace(base, '')}; strength slider ${strengthShown ? 'shown' : 'hidden'}; url keeps the choice: ${urlHas}`)

    if (key !== 'none') {
      const reload = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
      reload.on('pageerror', (error) => errors.push(`page error (reload): ${error.message}`))
      reload.on('console', (message) => {
        if (message.type() === 'error') errors.push(`console error (reload): ${message.text().slice(0, 300)}`)
      })
      await reload.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await reload.waitForSelector('canvas.tool-canvas', { timeout: 120_000 })
      await settled(reload)
      const reloadPanel = await panelText(reload)
      const same = difference(await small(await reload.locator('canvas.tool-canvas').screenshot()), await small(preview))
      notes.push(`  reload from the url: panel shows ${label}: ${reloadPanel.includes(`Filter ${label}`)}, strength shown: ${reloadPanel.includes('Strength')}; preview vs before mean ${same.mean.toFixed(2)} max ${same.max} code values`)
      await reload.close()
    }

    const download = page.waitForEvent('download', { timeout: 180_000 })
    const start = Date.now()
    await page.getByRole('button', { name: 'Export PNG' }).click()
    const file = await download
    const png = await (await file.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks))
    const exportMeta = await sharp(png).metadata()
    const diff = difference(await small(png), await small(preview))
    await sharp(png).resize(960).jpeg({ quality: 90 }).toFile(`${out}/export-${key}.jpg`)
    const exportCrop = {
      left: Math.round(exportMeta.width * 0.4),
      top: Math.round(exportMeta.height * 0.3),
      width: Math.round((300 * exportMeta.width) / meta.width),
      height: Math.round((300 * exportMeta.height) / meta.height),
    }
    await sharp(png).extract(exportCrop).resize(900, 900, { kernel: 'cubic' }).jpeg({ quality: 90 }).toFile(`${out}/export-${key}-crop.jpg`)
    notes.push(
      `  export ${file.suggestedFilename()} ${exportMeta.width}x${exportMeta.height} in ${((Date.now() - start) / 1000).toFixed(1)} s; vs preview at ${COMPARE.width}x${COMPARE.height}: mean ${diff.mean.toFixed(2)}, max ${diff.max} code values`,
    )
  }
  const strengthNone = await small(shots.none)
  for (const key of ['grain', 'ascii', 'pixel']) {
    const d = difference(await small(shots[key]), strengthNone)
    notes.push(`${key} preview vs none at ${COMPARE.width}x${COMPARE.height}: mean ${d.mean.toFixed(2)}, max ${d.max}`)
  }
} finally {
  await browser.close()
}
notes.push(errors.length ? `console and page errors:\n${errors.join('\n')}` : 'no console errors or warnings')
console.log(notes.join('\n'))
writeFileSync(`${out}/notes.txt`, notes.join('\n') + '\n')
