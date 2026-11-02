// Builds the reference targets from the raw Figma image fills.
//
//   node scripts/references/build-targets.mjs [id ...]
//
// Reads artifacts/references-raw/<node>-fill.png (the image fill) and
// <node>-shot.png (Figma's render of the tile, used only to check the crop).
// Writes public/references/awe/<mood>/<id>.png at 925 px wide,
// <id>-full.png when the fill has more pixels than that, the manifest, and
// side-by-side checks in artifacts/references-raw/verify/.

import fs from "node:fs/promises";
import sharp from "sharp";
import {
  FULL_MAX_EDGE,
  NOTES_DIR,
  RAW_DIR,
  REFERENCES,
  TARGET_DIR,
  TARGET_WIDTH,
  fullFile,
  rawFillPath,
  rawShotPath,
  targetFile,
  targetSize,
} from "./references.mjs";
import { loadRgb, loadRgba, resampleAxis, rotateCcw, saveRgbPng } from "./lib/image.mjs";

const VERIFY_DIR = `${RAW_DIR}/verify`;
const TILE_CORNER_RADIUS = 30;

// Figma's screenshots paint the rounded corners opaque white, so they are skipped.
function inRoundedCorner(x, y, w, h, r) {
  const cx = x < r ? r : x >= w - r ? w - r : null;
  const cy = y < r ? r : y >= h - r ? h - r : null;
  if (cx === null || cy === null) return false;
  return Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r - 1.5;
}

// Visible part of the (already rotated) source, in source pixels.
function visibleRegion(ref, src) {
  const [tw, th] = ref.tile;
  const { fill } = ref;
  switch (fill.fit) {
    case "cover": {
      const s = Math.max(tw / src.width, th / src.height);
      const uw = tw / s;
      const vh = th / s;
      return { u0: (src.width - uw) / 2, v0: (src.height - vh) / 2, uw, vh };
    }
    case "crop": {
      const { left, top, width, height } = fill.box;
      const nu0 = -left / width;
      const nuw = 1 / width;
      const nv0 = -top / height;
      const nvh = 1 / height;
      if (fill.rotate === "ccw90") {
        // src here is the rotated image: its width is the original height.
        const iw = src.height;
        const ih = src.width;
        return { u0: nv0 * ih, v0: (1 - nu0 - nuw) * iw, uw: nvh * ih, vh: nuw * iw };
      }
      return { u0: nu0 * src.width, v0: nv0 * src.height, uw: nuw * src.width, vh: nvh * src.height };
    }
    default:
      throw new Error(`unknown fill fit ${fill.fit}`);
  }
}

function render(src, region, width, height, tileHeightPx) {
  const scaleX = width / region.uw;
  const scaleY = tileHeightPx / region.vh;
  const kernel = Math.min(scaleX, scaleY) >= 1 ? "catmull" : "mitchell";
  const img = resampleAxis(src, width, height, { u0: region.u0, v0: region.v0, scaleX, scaleY }, kernel);
  return { img, scaleX, scaleY, kernel };
}

async function compareToShot(ref, img) {
  const shotPath = rawShotPath(ref);
  try {
    await fs.access(shotPath);
  } catch {
    return null;
  }
  const shot = await loadRgba(shotPath);
  const k = shot.width / ref.tile[0];
  const tileH = ref.tile[1] * k;
  const radius = TILE_CORNER_RADIUS * k;
  const rows = Math.min(img.height, shot.height, Math.floor(tileH));
  let sum = 0;
  let count = 0;
  const hist = new Uint32Array(256);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < img.width; x++) {
      if (inRoundedCorner(x, y, shot.width, tileH, radius)) continue;
      const si = (y * shot.width + x) * 4;
      if (shot.data[si + 3] < 255) continue;
      const ti = (y * img.width + x) * 3;
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(shot.data[si + c] - img.data[ti + c]);
        sum += d;
        hist[d]++;
        count++;
      }
    }
  }
  let acc = 0;
  let p99 = 0;
  for (let d = 0; d < 256; d++) {
    acc += hist[d];
    if (acc >= 0.99 * count) {
      p99 = d;
      break;
    }
  }
  let max = 0;
  for (let d = 255; d >= 0; d--) {
    if (hist[d]) {
      max = d;
      break;
    }
  }
  return { meanAbs: sum / count, p99, max, shotPath };
}

async function writeVerifySheet(ref, targetPath, shotPath) {
  const h = 600;
  const target = await sharp(targetPath).resize({ height: h }).toBuffer();
  const shot = await sharp(shotPath).flatten({ background: "#ffffff" }).resize({ height: h }).toBuffer();
  const tMeta = await sharp(target).metadata();
  const sMeta = await sharp(shot).metadata();
  await sharp({
    create: { width: tMeta.width + sMeta.width + 12, height: h, channels: 3, background: "#ffffff" },
  })
    .composite([
      { input: target, left: 0, top: 0 },
      { input: shot, left: tMeta.width + 12, top: 0 },
    ])
    .png()
    .toFile(`${VERIFY_DIR}/${ref.id}.png`);
}

async function buildOne(ref) {
  let src = await loadRgb(rawFillPath(ref));
  const rawSize = [src.width, src.height];
  if (ref.fill.rotate === "ccw90") src = rotateCcw(src);
  const region = visibleRegion(ref, src);
  const [width, height] = targetSize(ref);
  const tileHeightPx = (ref.tile[1] * width) / ref.tile[0];

  await fs.mkdir(`${TARGET_DIR}/${ref.mood}`, { recursive: true });
  const targetPath = `${TARGET_DIR}/${targetFile(ref)}`;
  const main = render(src, region, width, height, tileHeightPx);
  await saveRgbPng(targetPath, main.img);

  let full = null;
  if (region.uw > TARGET_WIDTH + 0.5) {
    const s = Math.min(1, FULL_MAX_EDGE / Math.max(region.uw, region.vh));
    const fw = Math.round(region.uw * s);
    const fh = Math.round(region.vh * s);
    const r = render(src, region, fw, fh, (region.vh * fw) / region.uw);
    await saveRgbPng(`${TARGET_DIR}/${fullFile(ref)}`, r.img);
    full = { width: fw, height: fh, kernel: r.kernel };
  }

  const check = await compareToShot(ref, main.img);
  if (check) await writeVerifySheet(ref, targetPath, check.shotPath);

  return { ref, rawSize, region, width, height, main, full, check };
}

function manifestEntry({ ref, width, height, full }) {
  const entry = {
    id: ref.id,
    mood: ref.mood,
    figmaNodeId: ref.figmaNodeId,
    figmaName: ref.figmaName,
    title: ref.title,
    file: targetFile(ref),
  };
  if (full) entry.fullFile = fullFile(ref);
  Object.assign(entry, {
    width,
    height,
    recipe: ref.recipe,
    ignore: ref.ignore,
    cornerRadius: 0,
    notes: `${NOTES_DIR}/${ref.id}.md`,
  });
  return entry;
}

async function main() {
  const only = process.argv.slice(2);
  const selected = only.length ? REFERENCES.filter((r) => only.includes(r.id)) : REFERENCES;
  await fs.mkdir(VERIFY_DIR, { recursive: true });

  const results = [];
  for (const ref of selected) {
    const r = await buildOne(ref);
    results.push(r);
    const g = r.region;
    console.log(
      [
        ref.id.padEnd(28),
        `raw ${r.rawSize.join("x")}`.padEnd(14),
        `region ${g.u0.toFixed(1)},${g.v0.toFixed(1)} ${g.uw.toFixed(1)}x${g.vh.toFixed(1)}`.padEnd(32),
        `x${r.main.scaleX.toFixed(3)} ${r.main.kernel}`.padEnd(16),
        `${r.width}x${r.height}`.padEnd(10),
        r.full ? `full ${r.full.width}x${r.full.height}`.padEnd(16) : "".padEnd(16),
        r.check ? `vs shot mean ${r.check.meanAbs.toFixed(3)} p99 ${r.check.p99} max ${r.check.max}` : "no shot",
      ].join(" "),
    );
  }

  const manifestPath = `${TARGET_DIR}/manifest.json`;
  let previous = { version: 1, references: [] };
  try {
    previous = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  } catch {
    // first run
  }
  const built = new Map(results.map((r) => [r.ref.id, manifestEntry(r)]));
  const previousById = new Map(previous.references.map((e) => [e.id, e]));
  const references = REFERENCES.map((ref) => built.get(ref.id) ?? previousById.get(ref.id)).filter(Boolean);
  await fs.writeFile(manifestPath, `${JSON.stringify({ version: 1, references }, null, 2)}\n`);
  console.log(`wrote ${manifestPath} (${references.length} references)`);
}

await main();
