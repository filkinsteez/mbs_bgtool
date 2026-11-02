// Measures each reference target and writes
// docs/references/awe/profiles/<id>.json and a plot, <id>.png.
//
//   node scripts/references/profile.mjs [id ...]
//
// All color math uses the exact sRGB transfer curve and Oklab. Means are
// taken in linear light. Ignore rects from the manifest are left out of
// every measurement.

import fs from "node:fs/promises";
import { NOTES_DIR, TARGET_DIR } from "./references.mjs";
import {
  analyzeRamp,
  axisFrame,
  axisSamples,
  downsample,
  extremes,
  findAxis,
  lateralVariation,
  prepare,
  round,
  rowColumnMeans,
  transitionShape,
} from "./lib/analysis.mjs";
import { measureGlow } from "./lib/glow.mjs";
import { grain } from "./lib/grain.mjs";
import { loadRgb } from "./lib/image.mjs";
import { renderPlot } from "./lib/plot.mjs";

const OUT_DIR = `${NOTES_DIR}/profiles`;

// Where to look for each Contour light. Fractions of the frame; see lib/glow.mjs.
const GLOWS = {
  "contour-rim-edge": [
    { name: "diagonal edge", seeds: { kind: "rows", from: 0.15, to: 0.92, count: 28, x: [0, 1] }, groups: [{ name: "upper", t: [0, 0.5] }, { name: "lower", t: [0.5, 1] }], maxDist: 0.45 },
    { name: "top edge", seeds: { kind: "cols", from: 0.05, to: 0.7, count: 14, y: [0.07, 0.22] }, maxDist: 0.3 },
  ],
  "contour-yellow-halo": [
    { name: "yellow arc (Oklab b)", ridge: "b", profile: "b", seeds: { kind: "rows", from: 0.03, to: 0.72, count: 26, x: [0, 1] }, maxDist: 0.6 },
    { name: "yellow arc (luminance)", ridge: "b", profile: "Y", seeds: { kind: "rows", from: 0.03, to: 0.72, count: 26, x: [0, 1] }, maxDist: 0.6 },
  ],
  // Ring angle ranges skip the places where two rims cross and add up to white.
  "contour-iridescent-rings": [
    { name: "small ring", seeds: { kind: "rays", center: [0.546, 0.261], angles: [[0, 352.5]], count: 48, r: [0.15, 0.36], fitCircle: true }, maxDist: 0.2 },
    { name: "large ring", seeds: { kind: "rays", center: [0.653, 0.208], angles: [[58, 75], [100, 122], [135, 152]], count: 24, r: [0.6, 0.9], fitCircle: true }, maxDist: 0.2 },
    { name: "lower ring", seeds: { kind: "rays", center: [0.423, 0.865], angles: [[155, 215], [245, 310]], count: 24, r: [0.3, 0.47], fitCircle: true }, maxDist: 0.2 },
  ],
  "contour-radial-streaks": [
    { name: "horizon", seeds: { kind: "cols", from: 0.05, to: 0.95, count: 19, y: [0.62, 0.8] }, ridgeFit: "line", groups: [{ name: "left half", t: [0, 0.5] }, { name: "right half", t: [0.5, 1] }], maxDist: 0.6 },
  ],
  "contour-beam-pool": [
    { name: "beam", seeds: { kind: "rows", from: 0.08, to: 0.6, count: 14, x: [0.2, 0.8] }, ridgeMode: "centroid", ridgeFit: "line", groups: [{ name: "upper", t: [0, 0.5] }, { name: "lower", t: [0.5, 1] }], maxDist: 0.5 },
    { name: "floor pool", seeds: { kind: "cols", from: 0.38, to: 0.62, count: 9, y: [0.62, 0.86] }, maxDist: 0.5 },
  ],
  "contour-light-line": [
    { name: "line", seeds: { kind: "rows", from: 0.05, to: 0.95, count: 30, x: [0.4, 0.6] }, groups: [{ name: "top third", t: [0, 0.33] }, { name: "middle third", t: [0.33, 0.66] }, { name: "bottom third", t: [0.66, 1] }], maxDist: 0.5 },
  ],
};

async function profileOne(entry) {
  const targetPath = `${TARGET_DIR}/${entry.file}`;
  const img = await loadRgb(targetPath);
  const im = prepare(img, entry.ignore);

  const coarse = downsample(im, 8);
  const axis = findAxis(coarse);
  const fine = downsample(im, 2);
  const fr = axisFrame(fine.w, fine.h, axis.angleDeg);
  // Contour frames are mostly dark with a few sharp lights; a coarser tolerance keeps only their main stops.
  const ramp = analyzeRamp(fine, fr, { eps: entry.mood === "contour" ? 0.04 : 0.025 });
  const shape = transitionShape(fine, fr, ramp);
  const lateral = lateralVariation(fine, fr);
  const { rows, cols } = rowColumnMeans(im);

  // Curvature of the iso-color lines, read from the largest transition that spans enough strips.
  const dominant = ramp.transitions
    .map((tr, i) => ({ tr, sh: shape[i] }))
    .filter(({ sh }) => sh && sh.bowFrameH !== undefined)
    .sort((a, b) => b.tr.deltaE - a.tr.deltaE)[0];

  const prof = {
    id: entry.id,
    figmaNodeId: entry.figmaNodeId,
    width: im.W,
    height: im.H,
    ignore: entry.ignore,
    axis: {
      angleDeg: axis.angleDeg,
      convention: "degrees in image coordinates: 0 points right, 90 points down; positions run from where the axis line through the frame center enters the frame (0) to where it leaves (1)",
      r2: axis.r2,
      axisLengthPx: round((fr.pMax - fr.pMin) * fine.f, 1),
      curvature: dominant
        ? {
            transition: dominant.tr.index,
            bowFrameH: dominant.sh.bowFrameH,
            radiusFrameH: dominant.sh.radiusFrameH,
            tiltFrameH: dominant.sh.tiltFrameH,
            wavinessRmsFrameH: dominant.sh.wavinessRmsFrameH,
            convention: "bow: offset of the iso-line at the left and right frame edges (across the axis) relative to its center, as a fraction of frame height; positive means the edges are further along the axis",
          }
        : null,
    },
    ramp: {
      eps: ramp.eps,
      stops: ramp.stops,
      transitions: ramp.transitions.map((tr, i) => ({ ...tr, shape: shape[i] })),
      bridges: ramp.bridges,
      profile: downsampleProfile(ramp.profile, 128),
    },
    lateral,
    rowMeans: rows,
    colMeans: cols,
    axisSamples: axisSamples(im, axis.angleDeg, 5),
    extremes: extremes(im),
    grain: {
      isotropic: grain(im, { mode: "isotropic" }),
      alongIso: entry.mood === "sunset" ? grain(im, { mode: "along-iso", axisAngleDeg: axis.angleDeg }) : undefined,
    },
  };

  if (GLOWS[entry.id]) prof.glows = GLOWS[entry.id].map((spec) => measureGlow(im, spec));

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(`${OUT_DIR}/${entry.id}.json`, `${JSON.stringify(prof, null, 1)}\n`);
  await renderPlot(targetPath, prof, `${OUT_DIR}/${entry.id}.png`);
  return prof;
}

function downsampleProfile(profile, n) {
  if (profile.length <= n) return profile;
  const out = [];
  for (let k = 0; k < n; k++) out.push(profile[Math.floor(((k + 0.5) * profile.length) / n)]);
  return out;
}

async function main() {
  const manifest = JSON.parse(await fs.readFile(`${TARGET_DIR}/manifest.json`, "utf8"));
  const only = process.argv.slice(2);
  const entries = manifest.references.filter((e) => (only.length ? only.includes(e.id) : e.mood !== "warp"));
  for (const entry of entries) {
    const t0 = Date.now();
    const p = await profileOne(entry);
    const tr = p.ramp.transitions.map((t) => `${t.width1090FrameH ?? "-"}`).join(",");
    const g = p.grain.alongIso ?? p.grain.isotropic;
    console.log(
      `${entry.id.padEnd(28)} axis ${String(p.axis.angleDeg).padStart(6)} R2 ${p.axis.r2}  stops ${p.ramp.stops.length}  widths ${tr}  grain(${g.mode}) L ${g.stdL100} luma ${g.stdLumaPercent}% size ${g.grainSizePx}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
    );
  }
}

await main();
