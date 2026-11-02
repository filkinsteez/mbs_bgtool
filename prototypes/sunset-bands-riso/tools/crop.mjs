// Usage: node tools/crop.mjs <in.png> <x> <y> <w> <h> <zoom> <out.png>
import { readSrgb8, crop8, zoom8, writeRgb8 } from '../lib/image.mjs';

const [, , inPath, xs, ys, ws, hs, zs, outPath] = process.argv;
const im = await readSrgb8(inPath);
const c = crop8(im, +xs, +ys, +ws, +hs);
const z = zoom8(c, +zs);
await writeRgb8(outPath, z.w, z.h, z.data);
console.log(`wrote ${outPath} ${z.w}x${z.h}`);
