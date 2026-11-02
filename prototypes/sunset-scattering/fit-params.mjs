// Offline helper for reference presets: Nelder-Mead search over a few named
// light parameters (and optionally palette color channels), minimising the
// mean Oklab difference between blurred low-resolution images. It only
// proposes starting values; every result is then checked by eye and adjusted
// by hand. The renderer never sees reference pixels.
//
// Usage:
//   node fit-params.mjs presets/<id>.json --fit name:min:max ... [--iters N]
//        [--set k=v ...] [--write]
// Color channels: c<i>.r / c<i>.g / c<i>.b are sRGB 0..1 components of
// colors[i]. "exposure" is the output exposure. Everything else is a param.

import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { renderFinal } from "./lib/pipeline.mjs";
import { loadReference, linearToBytes, bytesToLinear, blurFloat } from "./lib/image.mjs";
import { linearToOklab, hexToSrgb } from "./lib/color.mjs";
import { referencePath, applySets } from "./render.mjs";

const args = process.argv.slice(2);
const presetFile = args[0];
const fits = [];
const sets = [];
let iters = 400;
let write = false;
let cellH = 140;
for (let i = 1; i < args.length; i++) {
  if (args[i] === "--fit") {
    const [name, lo, hi] = args[++i].split(":");
    fits.push({ name, lo: Number(lo), hi: Number(hi) });
  } else if (args[i] === "--set") sets.push(args[++i]);
  else if (args[i] === "--iters") iters = Number(args[++i]);
  else if (args[i] === "--height") cellH = Number(args[++i]);
  else if (args[i] === "--write") write = true;
}

const base = applySets(JSON.parse(readFileSync(presetFile, "utf8")), sets);
base.scene.output ??= {};
const { path, cornerRadius } = referencePath(base.referenceId);
const ref = await loadReference(path, cornerRadius);
const h = cellH;
const w = Math.round((ref.width * h) / ref.height);
const small = await sharp(Buffer.from(linearToBytes(ref).data), {
  raw: { width: ref.width, height: ref.height, channels: 3 },
})
  .resize(w, h)
  .raw()
  .toBuffer();
const refLab = toLab(blurFloat(bytesToLinear({ width: w, height: h, data: new Uint8Array(small) }), 2));

function toLab(img) {
  const out = new Float32Array(img.width * img.height * 3);
  for (let i = 0; i < img.width * img.height; i++) {
    const l = linearToOklab(img.data[i * 3], img.data[i * 3 + 1], img.data[i * 3 + 2]);
    out.set(l, i * 3);
  }
  return out;
}

const hex2 = (v) =>
  Math.round(Math.max(0, Math.min(1, v)) * 255)
    .toString(16)
    .padStart(2, "0");

function getValue(scene, name) {
  const m = name.match(/^c(\d+)\.([rgb])$/);
  if (m) return hexToSrgb(scene.colors[Number(m[1])])["rgb".indexOf(m[2])];
  if (name === "exposure") return scene.output.exposure ?? 0;
  if (name.startsWith("lens.")) return scene.lens?.[name.slice(5)];
  return scene.params[name];
}

function apply(x) {
  const scene = JSON.parse(JSON.stringify(base.scene));
  fits.forEach((f, i) => {
    const v = Math.max(f.lo, Math.min(f.hi, x[i]));
    const m = f.name.match(/^c(\d+)\.([rgb])$/);
    if (m) {
      const idx = Number(m[1]);
      const rgb = hexToSrgb(scene.colors[idx]);
      rgb["rgb".indexOf(m[2])] = v;
      scene.colors[idx] = "#" + rgb.map(hex2).join("").toUpperCase();
    } else if (f.name === "exposure") scene.output.exposure = v;
    else if (f.name.startsWith("lens.")) {
      scene.lens ??= {};
      scene.lens[f.name.slice(5)] = v;
    } else scene.params[f.name] = v;
  });
  return scene;
}

let evals = 0;
function cost(x) {
  evals++;
  const scene = apply(x);
  const out = renderFinal(scene, w, h, { lutAzimuth: 24, lutElevation: 160, dither: false, noGrain: true });
  const lab = toLab(blurFloat(bytesToLinear(out), 2));
  let s = 0;
  for (let i = 0; i < w * h; i++) {
    s += Math.hypot(lab[i * 3] - refLab[i * 3], lab[i * 3 + 1] - refLab[i * 3 + 1], lab[i * 3 + 2] - refLab[i * 3 + 2]);
  }
  let penalty = 0;
  fits.forEach((f, i) => {
    if (x[i] < f.lo) penalty += (f.lo - x[i]) * 10;
    if (x[i] > f.hi) penalty += (x[i] - f.hi) * 10;
  });
  return (s / (w * h)) * 100 + penalty;
}

function nelderMead(f, x0, steps, maxIter) {
  const n = x0.length;
  let pts = [x0.slice()];
  for (let i = 0; i < n; i++) {
    const p = x0.slice();
    p[i] += steps[i];
    pts.push(p);
  }
  let vals = pts.map(f);
  for (let it = 0; it < maxIter; it++) {
    const order = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]);
    pts = order.map((i) => pts[i]);
    vals = order.map((i) => vals[i]);
    const c = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += pts[i][j] / n;
    const worst = pts[n];
    const refl = c.map((v, j) => v + (v - worst[j]));
    const fr = f(refl);
    if (fr < vals[0]) {
      const exp = c.map((v, j) => v + 2 * (v - worst[j]));
      const fe = f(exp);
      if (fe < fr) {
        pts[n] = exp;
        vals[n] = fe;
      } else {
        pts[n] = refl;
        vals[n] = fr;
      }
    } else if (fr < vals[n - 1]) {
      pts[n] = refl;
      vals[n] = fr;
    } else {
      const con = c.map((v, j) => v + 0.5 * (worst[j] - v));
      const fc = f(con);
      if (fc < vals[n]) {
        pts[n] = con;
        vals[n] = fc;
      } else {
        for (let i = 1; i <= n; i++) {
          pts[i] = pts[i].map((v, j) => pts[0][j] + 0.5 * (v - pts[0][j]));
          vals[i] = f(pts[i]);
        }
      }
    }
    if (it % 50 === 0) console.log(`iter ${it} evals ${evals} best ${vals[0].toFixed(3)}`);
  }
  const best = vals.indexOf(Math.min(...vals));
  return { x: pts[best], v: vals[best] };
}

const x0 = fits.map((f) => getValue(base.scene, f.name) ?? (f.lo + f.hi) / 2);
const steps = fits.map((f) => (f.hi - f.lo) * 0.15);
const t0 = performance.now();
console.log(`start cost ${cost(x0).toFixed(3)}  (${w}x${h})`);
let res = nelderMead(cost, x0, steps, iters);
// One restart from the best point with smaller steps.
res = nelderMead(cost, res.x, steps.map((s) => s * 0.4), Math.round(iters / 2));
console.log(`done in ${((performance.now() - t0) / 1000).toFixed(0)} s, ${evals} evals, cost ${res.v.toFixed(3)}`);
const scene = apply(res.x);
const report = {};
fits.forEach((f) => {
  report[f.name] = getValue(scene, f.name);
});
console.log(JSON.stringify(report));
console.log(`colors ${JSON.stringify(scene.colors)}`);
if (write) {
  const raw = JSON.parse(readFileSync(presetFile, "utf8"));
  raw.scene.colors = scene.colors;
  raw.scene.output = { ...(raw.scene.output ?? {}), exposure: Number((scene.output.exposure ?? 0).toFixed(3)) };
  for (const [k, v] of Object.entries(scene.params)) {
    raw.scene.params[k] = typeof v === "number" ? Number(v.toFixed(4)) : v;
  }
  raw.scene.lens = {};
  for (const [k, v] of Object.entries(scene.lens ?? {})) {
    raw.scene.lens[k] = typeof v === "number" ? Number(v.toFixed(4)) : v;
  }
  writeFileSync(presetFile, JSON.stringify(raw, null, 2) + "\n");
  console.log(`wrote ${presetFile}`);
}
