// Shoots the current Sunset looks from the dev server on :3000, one page at a time in one browser.
//   node prototypes/horizon-placement/shoot.mjs            all looks x packs x formats x seeds 1-8 x Horizon 0, 0.5, 1
//   node prototypes/horizon-placement/shoot.mjs ramp bold  only those looks / packs
// Writes out/shots/<look>-<pack>-<format>-s<seed>-h<horizon>.png and out/shots/meta.json.
// Skips shots that already exist. A shot is kept once two screenshots 600 ms apart are identical.
import { chromium } from 'playwright'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, 'out', 'shots')
mkdirSync(outDir, { recursive: true })

export const LOOKS = ['ramp', 'bands', 'blooms']
export const PACKS = ['bold', 'elemental', 'atmospheric']
export const FORMATS = ['16x9', '9x16']
export const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8]
export const HORIZONS = [0, 0.5, 1]
export const shotName = (look, pack, format, seed, horizon) => `${look}-${pack}-${format}-s${seed}-h${horizon}.png`

const args = process.argv.slice(2)
const looks = LOOKS.filter((l) => !args.some((a) => LOOKS.includes(a)) || args.includes(l))
const packs = PACKS.filter((p) => !args.some((a) => PACKS.includes(a)) || args.includes(p))

const git = (cmd) => execSync(cmd, { cwd: join(here, '..', '..') }).toString().trim()
const meta = {
  started: new Date().toISOString(),
  commit: git("git log -1 --format='%h %s'"),
  srcStatus: git('git status --short -- src/'),
}

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))

async function shoot(query, file) {
  await page.goto('http://localhost:3000/?' + query, { waitUntil: 'load', timeout: 180000 })
  await page.waitForSelector('canvas', { timeout: 60000 })
  await page.waitForTimeout(1500)
  let last = null
  for (let i = 0; i < 20; i++) {
    const box = await page.locator('canvas').first().boundingBox()
    const buf = await page.screenshot({ clip: box })
    if (last && buf.equals(last)) {
      writeFileSync(file, buf)
      return i
    }
    last = buf
    await page.waitForTimeout(600)
  }
  writeFileSync(file, last)
  return -1
}

let count = 0
const t0 = Date.now()
for (const look of looks) {
  for (const pack of packs) {
    for (const format of FORMATS) {
      for (const seed of SEEDS) {
        for (const horizon of HORIZONS) {
          const file = join(outDir, shotName(look, pack, format, seed, horizon))
          if (existsSync(file)) continue
          const query = `mood=sunset&look=${look}&pack=${pack}&seed=${seed}&format=${format}&intensity=0.5&softness=0.5&horizon=${horizon}`
          const tries = await shoot(query, file)
          count++
          if (count % 10 === 0 || tries < 0) console.log(`${count} shots, ${((Date.now() - t0) / 1000).toFixed(0)} s, last ${file.split('/').pop()}${tries < 0 ? ' (never stable)' : ''}`)
        }
      }
    }
  }
}
meta.finished = new Date().toISOString()
meta.commitAfter = git("git log -1 --format='%h %s'")
meta.srcStatusAfter = git('git status --short -- src/')
meta.pageErrors = errors.slice(0, 20)
writeFileSync(join(outDir, `meta-${looks.join('-')}-${packs.join('-')}.json`), JSON.stringify(meta, null, 2))
console.log(`done: ${count} shots in ${((Date.now() - t0) / 1000).toFixed(0)} s`)
await browser.close()
