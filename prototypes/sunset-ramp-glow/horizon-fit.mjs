// Dev tool: start values for a reference's horizon warp. Measures where the
// column lightness crosses a level (the horizon line, in frame heights) and
// grid-searches the warp noise scale and phase for that seed; amplitude and
// offset come from least squares. Prints the best few.
// Usage: node horizon-fit.mjs <referenceId> <level> <seed> [octaves]
import { gaussianBlur } from './lib/blur.mjs';
import { linearToOklab } from './lib/color.mjs';
import { fbm1 } from './lib/noise.mjs';
import { loadReference } from './lib/refs.mjs';

const [id, levelArg, seedArg, octArg] = process.argv.slice(2);
const level = Number(levelArg);
const seed = Number(seedArg ?? 1);
const octaves = Number(octArg ?? 2);
const ref = await loadReference(id);
const img = gaussianBlur(ref.img, 4);
const { w, h } = img;
const xs = [];
const ys = [];
for (let x = 4; x < w - 4; x += 8) {
  let prev = null;
  for (let y = 0; y < h; y++) {
    const i = (y * w + x) * 3;
    const L = linearToOklab(img.data[i], img.data[i + 1], img.data[i + 2])[0];
    if (prev && (prev.L - level) * (L - level) <= 0 && prev.L !== L) {
      xs.push((x + 0.5 - w / 2) / h);
      ys.push((prev.y + ((level - prev.L) / (L - prev.L)) * (y - prev.y) + 0.5) / h);
      break;
    }
    prev = { y, L };
  }
}
console.log(`${xs.length} columns; horizon y from ${Math.min(...ys).toFixed(3)} to ${Math.max(...ys).toFixed(3)}`);
const results = [];
for (let scale = 0.3; scale <= 3; scale += 0.05) {
  for (let phase = -2; phase <= 2; phase += 0.05) {
    const n = xs.map((x) => fbm1(x * scale + 3.7 + phase, seed, octaves));
    const mn = n.reduce((s, v) => s + v, 0) / n.length;
    const my = ys.reduce((s, v) => s + v, 0) / ys.length;
    let sxy = 0;
    let sxx = 0;
    for (let i = 0; i < n.length; i++) {
      sxy += (n[i] - mn) * (ys[i] - my);
      sxx += (n[i] - mn) ** 2;
    }
    const amp = sxy / Math.max(sxx, 1e-9);
    let err = 0;
    for (let i = 0; i < n.length; i++) err += (my + amp * (n[i] - mn) - ys[i]) ** 2;
    results.push({ scale, phase, amp, offset: my - amp * mn, rms: Math.sqrt(err / n.length) });
  }
}
results.sort((a, b) => a.rms - b.rms);
for (const r of results.slice(0, 6)) {
  console.log(
    `scale ${r.scale.toFixed(2)} phase ${r.phase.toFixed(2)} warp ${r.amp.toFixed(4)} offset ${r.offset.toFixed(4)} rms ${(r.rms * h).toFixed(1)} px`,
  );
}
