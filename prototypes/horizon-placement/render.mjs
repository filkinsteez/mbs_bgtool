// Renders the proposal sketches next to the targets.
//   node prototypes/horizon-placement/render.mjs
// Writes results/proposal-<pack>.png (16:9: water, ridge, bank or shore at 30, 50, 70%),
// results/proposal-tall.png (9:16), results/sideways.png and results/reflection-vs-sea.png.
// Target images are only shown next to the sketches; nothing reads their pixels.
import { writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { renderBands } from './lib/bands.mjs'
import { encode, renderScene, turnClockwise } from './lib/scene.mjs'
import { layout, tileFromFile, tileFromRaw } from './lib/sheet.mjs'

const here = new URL('.', import.meta.url).pathname
const frames = new URL('../../artifacts/moodboard-frames/', import.meta.url).pathname
const save = (name, buf) => {
  writeFileSync(here + 'results/' + name, buf)
  console.log(`results/${name} ${(buf.length / 1024).toFixed(0)} KB`)
}
const sketch = async (spec, W, H) => tileFromRaw(encode(renderScene(spec, W, H), W, H, spec.seed ?? 7), W, H)

// Seeds per pack: the sun's side and the shapes change with the seed, as in production.
const SUN = { bold: 0.72, elemental: 0.3, atmospheric: 0.62 }
const SEED = { bold: 3, elemental: 5, atmospheric: 9 }
const HEIGHTS = [0.3, 0.5, 0.7]

async function targets(h) {
  return [
    { buf: await tileFromFile(frames + 'sea-horizon-33-106.png', h), label: 'sea 33:106' },
    { buf: await tileFromFile(frames + 'ridge-glow-33-112.png', h), label: 'ridge 33:112' },
    { buf: await tileFromFile(frames + 'poster-bands-33-113.png', h, { left: 0, top: 0, width: 585, height: 560 }), label: 'poster 33:113 (text cut)' },
    { buf: await tileFromFile(frames + 'riso-scan-33-109.png', h), label: 'riso 33:109' },
  ]
}

// ---------------------------------------------------------------- per pack, 16:9
const W = 384
const H = 216
for (const pack of ['bold', 'elemental', 'atmospheric']) {
  const sunX = SUN[pack]
  const seed = SEED[pack]
  const rows = [{ label: 'Targets', tiles: await targets(H) }]
  rows.push({
    label: 'Water: the sky mirrored below the horizon, squeezed, smeared by ripples, dimmer with depth (Fresnel), the water\'s own light showing through',
    tiles: await Promise.all(HEIGHTS.map(async (h) => ({ buf: await sketch({ pack, horizon: h, below: 'water', sunX, seed }, W, H), label: `water, horizon ${Math.round(h * 100)}%` }))),
  })
  rows.push({
    label: 'Ridge: land climbing toward the light, the light glowing above and behind it, far land paler',
    tiles: await Promise.all(HEIGHTS.map(async (h) => ({ buf: await sketch({ pack, horizon: h + 0.04, below: 'ridge', sunX: sunX > 0.5 ? 0.82 : 0.18, seed, rise: 0.2 }, W, H), label: `ridge, around ${Math.round(h * 100)}%` }))),
  })
  rows.push({
    label: 'Flat land: a far shore over water when the horizon is high, a bank lower down',
    tiles: await Promise.all(
      HEIGHTS.map(async (h) => {
        const below = h < 0.4 ? 'shore' : 'bank'
        return { buf: await sketch({ pack, horizon: h, below, sunX, seed: seed + 1 }, W, H), label: `${below}, horizon ${Math.round(h * 100)}%` }
      }),
    ),
  })
  save(`proposal-${pack}.png`, await layout(rows, { title: `Proposal sketches, ${pack[0].toUpperCase() + pack.slice(1)} pack (exact hexes), 16:9` }))
}

// ---------------------------------------------------------------- 9:16
{
  const TW = 171
  const TH = 304
  const tiles = []
  for (const pack of ['bold', 'elemental', 'atmospheric']) {
    tiles.push({ buf: await sketch({ pack, horizon: 0.3, below: 'water', sunX: SUN[pack], seed: SEED[pack] }, TW, TH), label: `${pack}, water 30%` })
    tiles.push({ buf: await sketch({ pack, horizon: 0.62, below: 'water', sunX: SUN[pack], seed: SEED[pack] }, TW, TH), label: 'water 62%' })
    tiles.push({ buf: await sketch({ pack, horizon: 0.55, below: 'ridge', sunX: SUN[pack] > 0.5 ? 0.85 : 0.15, seed: SEED[pack], rise: 0.12 }, TW, TH), label: 'ridge 55%' })
  }
  const rows = [
    { label: 'Targets', tiles: await targets(TH) },
    { label: '9:16: a high horizon leaves a short sky, so the sky\'s layout is squeezed into it; water fills the rest', tiles },
  ]
  save('proposal-tall.png', await layout(rows, { title: 'Proposal sketches, 9:16' }))
}

// ---------------------------------------------------------------- sideways
{
  // Atmospheric in Bands form, like the blue print: a pale band, Meta Blue, a crisp Slate edge
  // (the horizon), Steel, Meta Blue again. Rendered 9:16 and turned so the pale side is on the right.
  const TW = 384
  const TH = 216
  const atmos = {
    bands: [
      { hex: '#F2F4F7', gain: 1, top: 0, soft: 0.1 },
      { hex: '#0064E0', gain: 1, top: 0.24, soft: 0.26 },
      { hex: '#384753', gain: 1, top: 0.47, soft: 0.022 },
      { hex: '#6A7788', gain: 1, top: 0.7, soft: 0.2 },
      { hex: '#0064E0', gain: 0.85, top: 0.9, soft: 0.2 },
    ],
    horizon: 2,
    seed: 4,
  }
  const turnedAtmos = turnClockwise(renderBands(atmos, TH, TW), TH, TW)
  const plainAtmos = renderBands(atmos, TW, TH)
  // Bold as a ramp with water, turned: the sky's top (Meta Blue) on the right.
  const bold = { pack: 'bold', horizon: 0.55, below: 'water', sunX: 0.35, seed: 3 }
  const turnedBold = turnClockwise(renderScene(bold, TH, TW), TH, TW)
  const rows = [
    {
      label: 'The scan in its original orientation, and the same three prints turned with paper on top (the current references)',
      tiles: [
        { buf: await tileFromFile(frames + 'riso-scan-33-109.png', 2 * TH + 34), label: 'riso 33:109 as scanned' },
        { buf: await sharp(frames + 'riso-scan-33-109.png').rotate(-90).resize({ height: TH }).png().toBuffer(), label: 'scan turned (paper on top)' },
      ],
    },
    {
      label: 'Sketches: the same frames upright and turned sideways (16:9)',
      tiles: [
        { buf: await tileFromRaw(encode(plainAtmos, TW, TH), TW, TH), label: 'Atmospheric bands, upright' },
        { buf: await tileFromRaw(encode(turnedAtmos, TW, TH), TW, TH), label: 'turned: pale side right, crisp edge 47% from it' },
        { buf: await tileFromRaw(encode(turnedBold, TW, TH), TW, TH), label: 'Bold ramp with water, turned' },
      ],
    },
  ]
  save('sideways.png', await layout(rows, { title: 'Sideways: the riso prints run left to right; should some seeds do that?' }))
}

// ---------------------------------------------------------------- reflection next to the sea
{
  const SH = 420
  const sea = await tileFromFile(frames + 'sea-horizon-33-106.png', SH)
  const TW = 280
  const tiles = [{ buf: sea, label: 'sea 33:106' }]
  for (const pack of ['bold', 'elemental', 'atmospheric']) tiles.push({ buf: await sketch({ pack, horizon: 0.72, below: 'water', sunX: 0.8, seed: 6 }, TW, SH), label: `${pack}, horizon 72%` })
  // Bands with a reflection: Meta Blue, Cyan, Orange-red above; mirrored below (no Yellow: see mud-check)
  const bands = {
    bands: [
      { hex: '#0064E0', gain: 1, top: 0, soft: 0.1 },
      { hex: '#1FCDF0', gain: 1, top: 0.24, soft: 0.34 },
      { hex: '#FF4F00', gain: 1, top: 0.56, soft: 0.16 },
      { hex: '#FF4F00', gain: 0.85, top: 0.72, soft: 0.01 },
    ],
    horizon: 3,
    reflect: true,
    water: ['#0064E0', 0.3],
    seed: 5,
  }
  tiles.push({ buf: await tileFromRaw(encode(renderBands(bands, TW, SH), TW, SH), TW, SH), label: 'Bold bands, mirrored below' })
  save('reflection-vs-sea.png', await layout([{ tiles }], { title: 'Reflection: the sea next to sketches with the horizon at the same height (9:13.5 frames)' }))
}

// ---------------------------------------------------------------- mud check
{
  const TW = 320
  const TH = 180
  const yellow = '#FFD61E'
  const row = async (items) => Promise.all(items.map(async ([spec, label]) => ({ buf: await sketch(spec, TW, TH), label })))
  const base = { horizon: 0.5, below: 'water', sunX: 0.7, seed: 3 }
  const rows = [
    {
      label: 'Bold: Orange-red light dims to rose and deep red over blue water; Yellow dims to khaki and olive whatever the water',
      tiles: await row([
        [{ ...base, pack: 'bold' }, 'Orange-red light, Meta Blue water (proposed)'],
        [{ ...base, pack: 'bold', roles: { light: yellow } }, 'Yellow light, Meta Blue water'],
        [{ ...base, pack: 'bold', roles: { light: yellow, water: ['#1FCDF0', 0.12] } }, 'Yellow light, Cyan water'],
        [{ ...base, pack: 'bold', roles: { light: yellow, water: ['#FF4F00', 0.25] } }, 'Yellow light, Orange-red water'],
      ]),
    },
    {
      label: 'Elemental: Tan light over Plum water stays mauve; over Forest it goes olive-grey',
      tiles: await row([
        [{ ...base, pack: 'elemental' }, 'Tan light, Plum water (proposed)'],
        [{ ...base, pack: 'elemental', roles: { water: ['#0F3D33', 1.4] } }, 'Tan light, Forest water'],
        [{ ...base, pack: 'elemental', roles: { light: '#D6F26C', glow: 0.7 } }, 'Lime light, Plum water'],
        [{ ...base, pack: 'atmospheric' }, 'Atmospheric: Ice light, Slate water'],
      ]),
    },
  ]
  save('mud-check.png', await layout(rows, { title: 'Mud check: which lights may be reflected in water (horizon 50%)' }))
}
