// Screenshots of the tool's canvas, many queries in one browser session.
// node prototypes/organic-principle/shoot.mjs <list.json> <outDir>
// list.json: [["name", "mood=sunset&look=bands&..."], ...]
// Based on artifacts/coordinator/one.mjs: Chrome, wait 6 s after load, clip to the canvas.
// deviceScaleFactor 2 so the canvas renders at twice the CSS size.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'

const [listFile, outDir] = process.argv.slice(2)
const list = JSON.parse(fs.readFileSync(listFile, 'utf8'))
fs.mkdirSync(outDir, { recursive: true })

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const stamp = {
  at: new Date().toISOString(),
  head: git(['log', '-1', '--format=%h %s']),
  srcStatus: git(['status', '--short', '--', 'src/']).split('\n').filter(Boolean),
  shots: list,
}
fs.writeFileSync(path.join(outDir, 'shots.json'), JSON.stringify(stamp, null, 2))

const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })
for (const [name, query] of list) {
  const out = path.join(outDir, `${name}.png`)
  if (fs.existsSync(out)) continue
  const page = await context.newPage()
  const logs = []
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') logs.push('error: ' + m.text())
  })
  await page.goto('http://localhost:3000/?' + query, { waitUntil: 'load', timeout: 180000 })
  await page.waitForTimeout(6000)
  const box = await page.locator('canvas').first().boundingBox()
  await page.screenshot({ path: out, clip: box })
  console.log(name, Math.round(box.width * 2), 'x', Math.round(box.height * 2), logs.slice(0, 3).join(' | '))
  await page.close()
}
await browser.close()
