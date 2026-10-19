import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const stage = process.argv[2]
if (!stage || !/^[a-zA-Z0-9_-]+$/.test(stage)) throw Error('Provide an audit stage name')
const directory = path.resolve(root, '../../outputs/gradient-controls', stage)
const audit = JSON.parse(await readFile(path.join(directory, 'results.json'), 'utf8'))
const width = audit.portrait ? 540 : 960
const height = audit.portrait ? 370 : 230

// Extract the actual audited 0/50/100 frames without rerendering the artwork.
for (const mode of ['2d', '3d']) for (const palette of ['blues', 'bold']) {
  const layers = []
  for (const [row, look] of ['diffusion', 'halo', 'flow', 'smear'].entries()) {
    const input = await sharp(path.join(directory, `${mode}-${look}-${palette}.png`))
      .extract({ left: 0, top: 0, width, height }).png().toBuffer()
    layers.push({ input, left: 0, top: row * (height + 8) })
  }
  await sharp({ create: { width, height: height * 4 + 24, channels: 3, background: '#111418' } })
    .composite(layers).png().toFile(path.join(directory, `complexity-${mode}-${palette}.png`))
}
console.log(`Saved four Complexity comparisons in ${directory}`)
