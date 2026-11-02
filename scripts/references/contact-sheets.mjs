// Writes docs/references/awe/contact-<mood>.png: every target of a mood
// side by side at the same height, with its id underneath.
//
//   node scripts/references/contact-sheets.mjs

import fs from "node:fs/promises";
import sharp from "sharp";
import { NOTES_DIR, TARGET_DIR } from "./references.mjs";

const TILE_HEIGHT = 520;
const GAP = 24;
const LABEL_HEIGHT = 40;
const MAX_PER_ROW = 4;

function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function sheet(mood, entries) {
  const tiles = [];
  for (const e of entries) {
    const buf = await sharp(`${TARGET_DIR}/${e.file}`).resize({ height: TILE_HEIGHT }).png().toBuffer();
    const { width } = await sharp(buf).metadata();
    tiles.push({ e, buf, width });
  }
  const rows = [];
  for (let i = 0; i < tiles.length; i += MAX_PER_ROW) rows.push(tiles.slice(i, i + MAX_PER_ROW));
  const rowWidth = (row) => row.reduce((w, t) => w + t.width, 0) + GAP * (row.length + 1);
  const width = Math.max(...rows.map(rowWidth));
  const rowHeight = TILE_HEIGHT + LABEL_HEIGHT + GAP;
  const height = rows.length * rowHeight + GAP;

  const composites = [];
  let labels = "";
  rows.forEach((row, r) => {
    let x = GAP;
    const y = GAP + r * rowHeight;
    for (const t of row) {
      composites.push({ input: t.buf, left: x, top: y });
      const label = `${t.e.id}  ${t.e.width}x${t.e.height}`;
      labels += `<text x="${x}" y="${y + TILE_HEIGHT + 27}" font-family="Helvetica, Arial, sans-serif" font-size="18" fill="#e8e8e8">${escapeXml(label)}</text>`;
      x += t.width + GAP;
    }
  });
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${labels}</svg>`);
  composites.push({ input: svg, left: 0, top: 0 });

  const out = `${NOTES_DIR}/contact-${mood}.png`;
  await sharp({ create: { width, height, channels: 3, background: "#1e1e1e" } })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toFile(out);
  console.log(`wrote ${out}`);
}

async function main() {
  const manifest = JSON.parse(await fs.readFile(`${TARGET_DIR}/manifest.json`, "utf8"));
  await fs.mkdir(NOTES_DIR, { recursive: true });
  for (const mood of ["sunset", "contour", "warp"]) {
    const entries = manifest.references.filter((e) => e.mood === mood);
    if (entries.length) await sheet(mood, entries);
  }
}

await main();
