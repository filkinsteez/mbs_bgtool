import sharp from 'sharp'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const stage = process.argv[2] || '199-landscape-ranges'
const directory = path.join(root, 'outputs/gradient-controls', stage)
const looks = ['diffusion', 'halo', 'flow', 'smear']
for (const palette of ['primary-core', 'bold']) {
  const layers = []
  let labels = '<rect width="1280" height="954" fill="#111418"/><g font-family="Arial,sans-serif" fill="white">'
  labels += `<text x="16" y="28" font-size="20">Complexity — ${palette === 'bold' ? 'Bold' : 'Primary'} palette</text>`
  for (let column = 0; column < 4; column++) labels += `<text x="${column * 320 + 12}" y="56" font-size="15">${column < 2 ? '2D' : '3D'} · ${column % 2 === 0 ? '0' : '100'}</text>`
  for (let row = 0; row < looks.length; row++) {
    const look = looks[row], y = 94 + row * 215
    labels += `<text x="12" y="${y - 9}" font-size="16">${look[0].toUpperCase() + look.slice(1)}</text>`
    for (let column = 0; column < 4; column++) {
      const mode = column < 2 ? '2d' : '3d', left = column % 2 === 0 ? 0 : 640
      const input = await sharp(path.join(directory, `${mode}-${look}-${palette}.png`)).extract({ left, top: 28, width: 320, height: 180 }).toBuffer()
      layers.push({ input, left: column * 320, top: y })
    }
  }
  labels += '</g>'
  const background = Buffer.from(`<svg width="1280" height="954" xmlns="http://www.w3.org/2000/svg">${labels}</svg>`)
  await sharp(background).composite(layers).png().toFile(path.join(directory, `complexity-${palette}.png`))
}
console.log(`Saved actual renderer comparisons in ${directory}`)
