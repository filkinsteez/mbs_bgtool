// Measure the spots named in docs/references/awe/<id>.md ("Five things a
// recreation must get right") on the reference and on the preset's render.
// Usage: node checks.mjs [id ...]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gaussianBlur } from './lib/blur.mjs';
import { linearToHex, linearToOklab, luminance } from './lib/color.mjs';
import { bytesToLinear } from './lib/compare.mjs';
import { renderScene } from './lib/model.mjs';
import { applyLens, encodeOutput } from './lib/output.mjs';
import { PROTO, REFERENCE_IDS, loadReference } from './lib/refs.mjs';

// Positions are target pixels.
//   ['at', label, x, y]                         color at a point
//   ['ratio', label, [x, y], [x, y]]            luminance ratio of two points
//   ['cross', label, x, channel, level]         rows where a column crosses a level
//   ['max', label, x, channel, y0, y1]          row of a column's maximum
//   ['region', label, [x0, y0, x1, y1], channel] maximum over a rectangle
const CHECKS = {
  'sunset-sky-peach': [
    ['at', 'top center', 462, 4],
    ['at', 'bridge, center 39% H', 462, 392],
    ['at', 'glow, center 56% H', 462, 560],
    ['at', 'red, center 94% H', 462, 943],
    ['at', 'bottom center', 462, 995],
    ['max', 'center L peak', 462, 'L', 0, 1000],
    ['max', 'center C peak', 462, 'C', 700, 1000],
    ['ratio', 'right/left luminance, top', [912, 20], [12, 20]],
    ['ratio', 'right/left luminance, 56% H', [912, 560], [12, 560]],
    ['ratio', 'right/left luminance, 85% H', [912, 850], [12, 850]],
  ],
  'sunset-red-yellow-arcs': [
    ['at', 'top center', 462, 4],
    ['at', 'top corner', 4, 4],
    ['at', 'crimson, center y 358', 462, 358],
    ['at', 'cream, center y 1111', 462, 1111],
    ['at', 'mint midpoint, center y 1216', 462, 1216],
    ['at', 'bottom center', 462, 1355],
    ['at', 'bottom corner', 4, 1355],
    ['max', 'center C peak', 462, 'C', 300, 800],
    ['max', 'center L peak', 462, 'L', 900, 1300],
    ['cross', 'center b = 0', 462, 'b', 0],
    ['cross', 'edge b = 0', 12, 'b', 0],
    ['cross', 'center L = 0.6', 462, 'L', 0.6],
    ['cross', 'edge L = 0.6', 12, 'L', 0.6],
  ],
  'sunset-blue-diagonal': [
    ['at', 'top left', 12, 4],
    ['at', 'top right', 912, 4],
    ['at', 'left bridge y 763', 12, 763],
    ['at', 'left brightest y 942', 12, 942],
    ['at', 'left amber y 1125', 12, 1125],
    ['at', 'bottom left', 12, 1208],
    ['at', 'bottom center', 462, 1208],
    ['at', 'bottom right', 912, 1208],
    ['at', 'right grey-green y 1030', 912, 1030],
    ['ratio', 'left/right luminance, top', [12, 20], [912, 20]],
    ['ratio', 'left/right luminance, 50% H', [12, 607], [912, 607]],
    ['cross', 'b = 0 at x 0', 2, 'b', 0],
    ['cross', 'b = 0 at x 300', 300, 'b', 0],
    ['cross', 'b = 0 at x 600', 600, 'b', 0],
    ['cross', 'b = 0 at x 900', 900, 'b', 0],
  ],
  'sunset-violet-wave': [
    ['at', 'glow core (839, 160)', 839, 160],
    ['at', 'center top', 460, 2],
    ['at', 'center blue-white y 185', 460, 185],
    ['at', 'pink band (750, 280)', 750, 280],
    ['at', 'right hill (905, 260)', 905, 260],
    ['at', 'right hill (905, 330)', 905, 330],
    ['at', 'left sky (10, 200)', 10, 200],
    ['at', 'lavender-grey (250, 320)', 250, 320],
    ['at', 'left ridge (10, 360)', 10, 360],
    ['at', 'bottom center', 460, 612],
    ['region', 'L max left of x 260', [0, 0, 260, 617], 'L'],
    ['cross', 'L = 0.5 at x 10', 10, 'L', 0.5],
    ['cross', 'L = 0.5 at x 440', 440, 'L', 0.5],
    ['cross', 'L = 0.5 at x 700', 700, 'L', 0.5],
    ['cross', 'L = 0.5 at x 910', 910, 'L', 0.5],
  ],
};

function lab(img, x, y) {
  const i = (y * img.w + x) * 3;
  const rgb = [img.data[i], img.data[i + 1], img.data[i + 2]];
  const [L, a, b] = linearToOklab(...rgb);
  const C = Math.hypot(a, b);
  const h = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return { rgb, L, a, b, C, h };
}

const value = (img, x, y, channel) => lab(img, x, y)[channel];

function measure(img, check) {
  const [kind, , ...args] = check;
  switch (kind) {
    case 'at': {
      const c = lab(img, args[0], args[1]);
      return `${linearToHex(c.rgb)} L ${c.L.toFixed(3)} C ${c.C.toFixed(3)} h ${c.h.toFixed(0)}`;
    }
    case 'ratio': {
      const [p, q] = args.map(([x, y]) => luminance(...lab(img, x, y).rgb));
      return (p / q).toFixed(2);
    }
    case 'cross': {
      const [x, channel, level] = args;
      const rows = [];
      for (let y = 1; y < img.h; y++) {
        if (Math.sign(value(img, x, y, channel) - level) !== Math.sign(value(img, x, y - 1, channel) - level)) rows.push(y);
      }
      return rows.slice(0, 6).join(', ') || 'none';
    }
    case 'max': {
      const [x, channel, y0, y1] = args;
      let best = -Infinity;
      let at = y0;
      for (let y = y0; y < Math.min(y1, img.h); y++) {
        const v = value(img, x, y, channel);
        if (v > best) [best, at] = [v, y];
      }
      return `${best.toFixed(3)} at y ${at}`;
    }
    case 'region': {
      const [[x0, y0, x1, y1], channel] = args;
      let best = -Infinity;
      let at = [x0, y0];
      for (let y = y0; y < Math.min(y1, img.h); y += 2) {
        for (let x = x0; x < Math.min(x1, img.w); x += 2) {
          const v = value(img, x, y, channel);
          if (v > best) [best, at] = [v, [x, y]];
        }
      }
      return `${best.toFixed(3)} at (${at.join(', ')})`;
    }
    default:
      throw new Error(`unknown check ${kind}`);
  }
}

const ids = process.argv.slice(2).length ? process.argv.slice(2) : REFERENCE_IDS;
for (const id of ids) {
  const preset = JSON.parse(readFileSync(join(PROTO, 'presets', `ref-${id}.json`), 'utf8'));
  const ref = await loadReference(id);
  const { scene } = preset;
  const bytes = encodeOutput(applyLens(renderScene(scene, ref.w, ref.h), scene.lens), scene.output, scene.seed);
  // A light blur hides JPEG blocks and dither.
  const images = [ref.img, bytesToLinear(bytes, ref.w, ref.h)].map((im) => gaussianBlur(im, 2));
  console.log(`\n${id}`);
  for (const check of CHECKS[id]) {
    const [refValue, outValue] = images.map((im) => measure(im, check));
    console.log(`  ${check[1].padEnd(30)} ref ${refValue.padEnd(34)} render ${outValue}`);
  }
}
