// The targets with the measured heights marked in the margins (numbers from measure-*.mjs, out/*.txt).
//   node prototypes/horizon-placement/targets.mjs -> results/targets-measured.png
import sharp from 'sharp'

const frames = new URL('../../artifacts/moodboard-frames/', import.meta.url).pathname
const out = new URL('./results/targets-measured.png', import.meta.url).pathname
const H = 420
const M = 205 // margin for labels on the right of each image
const gap = 16

const items = [
  {
    file: 'sea-horizon-33-106.png',
    title: 'sea 33:106',
    marks: [
      [0.41, 'brightest band 41%'],
      [0.28, 'neutral grey bridge 28%'],
      [0.728, 'horizon 73%, level, thin light line'],
      [0.92, 'reflection peak 92% (L 0.58)'],
    ],
  },
  {
    file: 'ridge-glow-33-112.png',
    title: 'ridge 33:112',
    marks: [
      [0.255, 'light center 26% (at 91% across)'],
      [0.37, 'ridge top at the right edge 37%'],
      [0.53, 'ridge, line fit at the center 53%'],
      [0.61, 'lowest dips 55-61%'],
    ],
  },
  {
    file: 'poster-bands-33-113.png',
    title: 'poster 33:113',
    marks: [
      [0.12, 'black band 10-14%'],
      [0.38, 'blue band 30-42%'],
      [0.58, 'dark grey band 54-62%'],
      [0.682, 'grey-to-red edge 68% (66-70%)'],
    ],
  },
]

const tiles = []
let x = gap
const texts = []
for (const it of items) {
  const buf = await sharp(frames + it.file).removeAlpha().resize({ height: H }).png().toBuffer()
  const { width } = await sharp(buf).metadata()
  tiles.push({ input: buf, left: x, top: 40 })
  texts.push(`<text x="${x}" y="28" font-family="Helvetica, Arial" font-size="15" fill="#111">${it.title}</text>`)
  let last = -Infinity
  for (const [f, label] of [...it.marks].sort((a, b) => a[0] - b[0])) {
    const y = 40 + f * H
    const ly = Math.max(y, last + 15)
    last = ly
    texts.push(`<line x1="${x + width - 18}" x2="${x + width + 6}" y1="${y}" y2="${y}" stroke="#d9480f" stroke-width="2"/>`)
    texts.push(`<line x1="${x + width + 6}" x2="${x + width + 14}" y1="${y}" y2="${ly}" stroke="#bbb"/>`)
    texts.push(`<text x="${x + width + 17}" y="${ly + 4}" font-family="Helvetica, Arial" font-size="11.5" fill="#333">${label}</text>`)
  }
  x += width + M + gap
}

// riso: the scan as it is, with the crisp edges and the start of paper marked under each print
{
  const buf = await sharp(frames + 'riso-scan-33-109.png').removeAlpha().resize({ height: H }).png().toBuffer()
  const { width } = await sharp(buf).metadata()
  tiles.push({ input: buf, left: x, top: 40 })
  texts.push(`<text x="${x}" y="28" font-family="Helvetica, Arial" font-size="15" fill="#111">riso 33:109, as scanned</text>`)
  const s = H / 1134
  // prints: rows (scan px) and columns 13-551, 16-552, 18-553
  const prints = [
    { y0: 0, y1: 351, x0: 13, x1: 551, marks: [[0.64, 'green ends 64%'], [0.965, 'paper 96%']], name: 'green: no crisp edge' },
    { y0: 383, y1: 755, x0: 16, x1: 552, marks: [[0.539, 'crisp edge 54%'], [0.888, 'paper 89%']], name: 'blue: slate | cyan' },
    { y0: 786, y1: 1134, x0: 18, x1: 553, marks: [[0.379, 'crisp edge 38%'], [0.929, 'paper 93%']], name: 'pink: magenta | orange' },
  ]
  for (const p of prints) {
    const top = 40 + p.y0 * s
    const bot = 40 + p.y1 * s
    for (const [f] of p.marks) {
      const mx = x + (p.x0 + f * (p.x1 - p.x0)) * s
      texts.push(`<line x1="${mx}" x2="${mx}" y1="${top}" y2="${bot}" stroke="#d9480f" stroke-width="1.5" stroke-dasharray="4 3"/>`)
    }
    texts.push(`<text x="${x + width + 8}" y="${(top + bot) / 2 - 6}" font-family="Helvetica, Arial" font-size="11.5" fill="#333">${p.name}</text>`)
    texts.push(`<text x="${x + width + 8}" y="${(top + bot) / 2 + 9}" font-family="Helvetica, Arial" font-size="11.5" fill="#333">${p.marks.map((m) => m[1]).join(', ')}</text>`)
  }
  x += width + 190 + gap
}

const width = x
const height = 40 + H + 16
const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${texts.join('')}</svg>`)
await sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
  .composite([...tiles, { input: svg, left: 0, top: 0 }])
  .png({ compressionLevel: 9 })
  .toFile(out)
console.log(out)
