// Copies a fitted scene into presets/<referenceId>.json, keeping only the
// parameters the scene's mode reads, rounded.
// Usage: node finalize.mjs <fitted.json>

import { readFileSync, writeFileSync } from "node:fs";

const KEEP = {
  twolight: [
    "mode",
    "roles",
    "sunElevation",
    "sunAzimuth",
    "fov",
    "horizon",
    "tilt",
    "air",
    "airWarmth",
    "haze",
    "hazeHeight",
    "redden",
    "mieG",
    "mieGSpread",
    "msScale",
    "skySat",
    "hazeChain",
    "observer",
    "groundAlbedo",
    "wbTemp",
    "wbTint",
    "warp",
    "warpScale",
    "warpPhase",
    "warpOctaves",
    "softness",
    "softnessVar",
  ],
  spectra: [
    "mode",
    "roles",
    "airModel",
    "airWarmth",
    "reddenAir",
    "sunGray",
    "sunElevation",
    "sunAzimuth",
    "fov",
    "horizon",
    "tilt",
    "air",
    "haze",
    "hazeHeight",
    "redden",
    "mieG",
    "ozone",
    "msScale",
    "observer",
    "groundAlbedo",
    "wbTemp",
    "wbTint",
    "warp",
    "warpScale",
    "warpPhase",
    "warpOctaves",
    "softness",
    "softnessVar",
  ],
};

const src = JSON.parse(readFileSync(process.argv[2], "utf8"));
const p = src.scene.params;
const keep = KEEP[p.mode];
const params = {};
for (const k of keep) {
  if (p[k] === undefined) continue;
  params[k] = typeof p[k] === "number" ? Number(p[k].toFixed(4)) : p[k];
}
const out = {
  id: `ref-${src.referenceId}`,
  referenceId: src.referenceId,
  scene: {
    recipe: "sunset.scatter",
    seed: src.scene.seed ?? 1,
    colors: src.scene.colors,
    params,
    lens: src.scene.lens ?? {},
    output: { grain: src.scene.output?.grain ?? 0, exposure: Number((src.scene.output?.exposure ?? 0).toFixed(3)) },
  },
};
const file = `presets/${src.referenceId}.json`;
writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${file}`);
