// Production-style Contour variations built from pack colors only: one
// light, a pack color as the light, a dark base from the pack. Each pack is
// rendered at 16:9 and 9:16 for two seeds, with a contact sheet per pack.
//   node generality.mjs [seedA] [seedB]

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { renderPreset } from './lib/render.mjs';
import { PACKS } from './lib/color.mjs';

const OUT = path.join(import.meta.dirname, 'out', 'generality');
fs.mkdirSync(OUT, { recursive: true });

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const lerp = (a, b, t) => a + (b - a) * t;

// Bold: a rim along a rounded corner, lit by Meta Blue from one side.
function boldRim(seed) {
  const r = rng(seed * 7919 + 1);
  const flipX = r() < 0.5;
  const cu = lerp(0.72, 0.84, r());
  const cv = lerp(0.14, 0.26, r());
  const a1 = 180 + lerp(-6, 6, r());
  const a2 = lerp(108, 124, r());
  const u = flipX ? 1 - cu : cu;
  const ang = (a) => (flipX ? 180 - a : a);
  const toward = flipX ? 200 : -20;
  return {
    id: `gen-bold-rim-${seed}`,
    scene: {
      recipe: 'contour.rim',
      seed,
      colors: PACKS.bold,
      params: {
        background: 0,
        backgroundIntensity: 0.004,
        emitters: [
          {
            shape: { kind: 'wedge', corner: [u, cv], angles: [ang(a1), ang(a2)], radius: lerp(70, 110, r()) },
            sources: [
              { pos: [lerp(u, 0.5, 0.35), cv + 0.12], falloff: 'plane', radius: 350, length: lerp(110, 170, r()), angle: toward },
              { pos: [u, cv + 0.05], falloff: 'gauss', radius: 330 },
            ],
            lobes: [
              { color: 0, intensity: 6, offset: -1.2, sigmaIn: 1.4, sigmaOut: 1.6, source: 1, sourceGamma: 1.5 },
              { color: 0, intensity: 4.5, offset: -1.2, plateau: 2, sigmaIn: 4, sigmaOut: 1.6, source: 1, sourceGamma: 2, widthSource: 1, widthGain: 1.2, widthGamma: 3 },
              { color: 0, intensity: 1.2, offset: -1.2, sigmaIn: 4, chSigmaIn: [0.5, 0.8, 1], sigmaOut: 1.6 },
              { color: 0, intensity: 0.55, offset: -1.2, sigmaIn: 14, sigmaOut: 1.6, widthSource: 1, widthGain: 0.5, widthGamma: 3 },
              { color: 0, intensity: 0.15, offset: -6, sigmaIn: 45, sigmaOut: 4 },
              { color: 0, intensity: 0.05, offset: 2, shape: 'power', power: 1, sigmaIn: 1, sigmaOut: 8 },
            ],
            inside: { color: 0, intensity: 0.02, soft: 1.5, floor: 0.5, sourceGamma: 0.6, scatter: { strength: 0.35, sigma: 130, tint: [0.3, 0.7, 1] } },
          },
        ],
      },
      lens: {
        bloom: [
          { sigma: 20, weight: 0.025 },
          { sigma: 60, weight: 0.012 },
        ],
      },
      output: { grain: 1.2, grainResponse: 'sqrt' },
    },
  };
}

// Elemental: a thin line of Lime light whose glow widens along its length and
// splits by channel (green left, red centered, blue right), on Forest.
function elementalLine(seed) {
  const r = rng(seed * 104729 + 3);
  const right = r() < 0.6;
  const x = right ? lerp(0.72, 0.84, r()) : lerp(0.16, 0.28, r());
  const tilt = lerp(-0.04, 0.04, r());
  const up = r() < 0.3;
  const a = [x - tilt, up ? 1 : 0];
  const b = [x + tilt, up ? 0 : 1];
  return {
    id: `gen-elemental-line-${seed}`,
    scene: {
      recipe: 'contour.rim',
      seed,
      colors: PACKS.elemental,
      params: {
        background: 2,
        backgroundIntensity: 0.22,
        emitters: [
          {
            shape: { kind: 'line', a, b },
            lobes: [
              {
                color: 1, intensity: 1.6, offset: 2.2, plateau: 4.4, sigma: 1.6,
                along: { t: [0, 0.3, 0.5, 0.75, 1], intensity: [0.2, 0.45, 0.9, 1, 0.85] },
              },
              {
                color: 1, intensity: 1, sigma: 26, chSigma: [1, 0.65, 1.2], chOffset: [0, -10, 22],
                along: {
                  t: [0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 1],
                  intensity: [0, 0.03, 0.15, 0.4, 0.62, 0.75, 0.7],
                  width: [1, 1, 1, 1.15, 1.35, 1.55, 1.75],
                },
              },
              {
                color: 1, intensity: 1, sigma: 32,
                along: { t: [0.45, 0.6, 0.8, 1], intensity: [0, 0.012, 0.025, 0.03], offset: [-50, -56, -76, -95] },
              },
            ],
          },
        ],
      },
      lens: { bloom: [{ sigma: 80, weight: 0.02 }] },
      output: { grain: 1, grainResponse: 'sqrt' },
    },
  };
}

// Atmospheric: a halo of Ice light cropped by a corner; blue spreads wider
// than red, so the rim goes white to pale blue. Slate inside, Near-black out.
function atmosphericHalo(seed) {
  const r = rng(seed * 15485863 + 5);
  const corner = Math.floor(r() * 4);
  const cu = corner % 2 === 0 ? lerp(1.02, 1.12, r()) : lerp(-0.12, -0.02, r());
  const cv = corner < 2 ? lerp(1.05, 1.15, r()) : lerp(-0.15, -0.05, r());
  return {
    id: `gen-atmospheric-halo-${seed}`,
    scene: {
      recipe: 'contour.halo',
      seed,
      colors: PACKS.atmospheric,
      params: {
        background: 4,
        backgroundIntensity: 0.25,
        emitters: [
          {
            shape: { kind: 'ellipse', center: [cu, cv], radii: [lerp(880, 1050, r()), lerp(880, 1050, r())] },
            lobes: [
              { color: 1, intensity: 0.5, offset: -3, sigmaIn: 14, chSigmaIn: [0.6, 0.8, 1.4], sigmaOut: 7 },
              { color: 1, intensity: 0.3, shape: 'power', powerIn: 1.5, powerOut: 3, sigmaIn: 70, chSigmaIn: [0.8, 0.9, 1.2], sigmaOut: 45 },
              { color: 2, intensity: 0.12, shape: 'power', power: 2, sigmaIn: 2, sigmaOut: 120 },
            ],
          },
        ],
        fields: [
          { emitter: 0, side: 'in', color: 3, edge: 60, soft: 120, intensity: 0.45 },
          { emitter: 0, side: 'out', color: 4, edge: 40, soft: 160, intensity: 0.35 },
        ],
      },
      lens: { bloom: [{ sigma: 30, weight: 0.03 }, { sigma: 90, weight: 0.02 }] },
      output: { grain: 1, grainResponse: 'sqrt' },
    },
  };
}

const BUILDERS = { bold: boldRim, elemental: elementalLine, atmospheric: atmosphericHalo };
const SIZES = [
  [1920, 1080],
  [1080, 1920],
];
const seeds = [Number(process.argv[2] ?? 1), Number(process.argv[3] ?? 2)];

for (const [pack, build] of Object.entries(BUILDERS)) {
  const tiles = [];
  for (const [W, H] of SIZES) {
    for (const seed of seeds) {
      const preset = build(seed);
      const { bytes, timing } = renderPreset(preset, W, H, seed);
      const file = path.join(OUT, `${pack}-${W}x${H}-s${seed}.png`);
      await sharp(Buffer.from(bytes), { raw: { width: W, height: H, channels: 3 } }).png().toFile(file);
      tiles.push({ file, W, H });
      console.log(pack, W, H, 'seed', seed, `${(timing.scene + timing.lens).toFixed(0)}ms`);
    }
  }
  // Contact sheet: two 16:9 tiles on top, two 9:16 tiles below.
  const tw = 640;
  const wide = tiles.filter((t) => t.W > t.H);
  const tall = tiles.filter((t) => t.W < t.H);
  const wh = Math.round((tw * 1080) / 1920);
  const th = Math.round(wh * 2.2);
  const tallW = Math.round((th * 1080) / 1920);
  const sheetW = tw * 2 + 30;
  const sheetH = wh + th + 30;
  const comps = [];
  for (const [i, t] of wide.entries()) comps.push({ input: await sharp(t.file).resize(tw, wh).toBuffer(), left: 10 + i * (tw + 10), top: 10 });
  for (const [i, t] of tall.entries()) comps.push({ input: await sharp(t.file).resize(tallW, th).toBuffer(), left: 10 + i * (tallW + 10), top: wh + 20 });
  await sharp({ create: { width: sheetW, height: sheetH, channels: 3, background: '#ffffff' } })
    .composite(comps)
    .png()
    .toFile(path.join(OUT, `sheet-${pack}.png`));
}
