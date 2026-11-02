// Renders a preset at its reference's native size, then writes the render, a
// side-by-side (reference | render), a 3x zoom crop of a chosen transition,
// and prints row profiles and a blurred Oklab difference.
//
// Usage:
//   node render.mjs presets/<id>.json [--set key=value ...] [--zoom x,y,w,h]
//                   [--tag name] [--size WxH]

import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderFinal } from "./lib/pipeline.mjs";
import {
  loadReference,
  linearToBytes,
  saveBytes,
  sideBySide,
  zoomCrop,
  bytesToLinear,
  blurredDeltaE,
  rowProfile,
} from "./lib/image.mjs";
import { linearToHex } from "./lib/color.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");

const SCREENSHOTS = {
  "sunset-sky-peach": "s39-sky-peach.png",
  "sunset-red-yellow-arcs": "s40-red-yellow-arc.png",
  "sunset-blue-diagonal": "s41-blue-diagonal.png",
  "sunset-violet-wave": "s58-wave.png",
  "sunset-pink-riso": "s64-pink-riso.png",
};

export function referencePath(id) {
  const manifestPath = join(repo, "public/references/awe/manifest.json");
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const ref = manifest.references?.find((r) => r.id === id);
    if (ref) {
      const p = join(repo, "public/references/awe", ref.file);
      if (existsSync(p)) return { path: p, cornerRadius: ref.cornerRadius ?? 0 };
    }
  }
  return { path: join(repo, "artifacts/brief-screens/sunset", SCREENSHOTS[id]), cornerRadius: 26 };
}

function parseValue(v) {
  if (v === "true") return true;
  if (v === "false") return false;
  if (v.startsWith("[")) return JSON.parse(v);
  const num = Number(v);
  return Number.isFinite(num) ? num : v;
}

export function applySets(preset, sets) {
  for (const s of sets) {
    const [k, v] = s.split("=");
    preset.scene.output ??= {};
    preset.scene.lens ??= {};
    if (k === "colors") preset.scene.colors = v.split(",");
    else if (k === "exposure" || k === "grain") preset.scene.output[k] = Number(v);
    else if (k === "seed") preset.scene.seed = Number(v);
    else if (k.startsWith("lens.")) preset.scene.lens[k.slice(5)] = parseValue(v);
    else preset.scene.params[k] = parseValue(v);
  }
  return preset;
}

async function main() {
  const args = process.argv.slice(2);
  const presetFile = args[0];
  const sets = [];
  let zoom = null;
  let tag = "latest";
  let size = null;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--set") sets.push(args[++i]);
    else if (args[i] === "--zoom") zoom = args[++i].split(",").map(Number);
    else if (args[i] === "--tag") tag = args[++i];
    else if (args[i] === "--size") size = args[++i].split("x").map(Number);
  }
  const preset = applySets(JSON.parse(readFileSync(presetFile, "utf8")), sets);
  preset.scene.output ??= {};
  preset.scene.params ??= {};
  const id = preset.referenceId;
  const outDir = join(here, "out", id ?? preset.id);
  mkdirSync(outDir, { recursive: true });

  let ref = null;
  if (id && !size) {
    const { path, cornerRadius } = referencePath(id);
    ref = await loadReference(path, cornerRadius);
  }
  const width = size ? size[0] : ref.width;
  const height = size ? size[1] : ref.height;
  const t0 = performance.now();
  const out = renderFinal(preset.scene, width, height);
  const ms = performance.now() - t0;
  await saveBytes(join(outDir, `${tag}.png`), out);
  console.log(`rendered ${width}x${height} in ${ms.toFixed(0)} ms -> out/${id ?? preset.id}/${tag}.png`);
  if (!ref) return;

  const refBytes = linearToBytes(ref);
  await saveBytes(join(outDir, `${tag}-side.png`), sideBySide([refBytes, out]));
  const z = zoom ?? [Math.round(width * 0.35), Math.round(height * 0.35), 160, 160];
  await saveBytes(
    join(outDir, `${tag}-zoom.png`),
    sideBySide([zoomCrop(refBytes, z, 3), zoomCrop(out, z, 3)]),
  );

  const renderLin = bytesToLinear(out);
  const dE = blurredDeltaE(ref, renderLin, ref.mask, 6);
  console.log(`blurred Oklab dE x100: mean ${dE.mean.toFixed(2)}  max ${dE.max.toFixed(2)}`);
  const thirds = [0, 1, 2].map((j) => [Math.floor((j * width) / 3), Math.floor(((j + 1) * width) / 3)]);
  const profR = thirds.map(([a, b]) => rowProfile(ref, ref.mask, a, b));
  const profO = thirds.map(([a, b]) => rowProfile(renderLin, null, a, b));
  const rows = 16;
  for (let k = 0; k < rows; k++) {
    const y = Math.round(((k + 0.5) / rows) * height);
    const cells = [0, 1, 2].map((j) => {
      const r = profR[j][y];
      const o = profO[j][y];
      const dl = (o[0] - r[0]) * 100;
      const dab = Math.hypot(o[1] - r[1], o[2] - r[2]) * 100;
      return `${hexOfOklab(r)}>${hexOfOklab(o)} dL${dl >= 0 ? "+" : ""}${dl.toFixed(0)} dC${dab.toFixed(0)}`;
    });
    console.log(`y=${(y / height).toFixed(2)}  ${cells.join("  ")}`);
  }
}

function hexOfOklab([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return linearToHex(rgb).slice(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
