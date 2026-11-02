// Arranges PNGs in a grid, scaled to a common height.
// Usage: node sheet.mjs <out.png> <columns> <height> <a.png> <b.png> ...

import sharp from "sharp";

const [, , outFile, colsArg, heightArg, ...files] = process.argv;
const cols = Number(colsArg);
const cellH = Number(heightArg);
const gap = 8;

const cells = [];
for (const f of files) {
  const img = sharp(f).resize({ height: cellH }).removeAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  cells.push({ data, width: info.width, height: info.height });
}
const rows = Math.ceil(cells.length / cols);
const colW = [];
for (let c = 0; c < cols; c++) {
  colW.push(Math.max(0, ...cells.filter((_, i) => i % cols === c).map((x) => x.width)));
}
const width = colW.reduce((s, w) => s + w, 0) + gap * (cols - 1);
const height = rows * cellH + gap * (rows - 1);
const composites = cells.map((cell, i) => {
  const c = i % cols;
  const r = Math.floor(i / cols);
  const left = colW.slice(0, c).reduce((s, w) => s + w + gap, 0);
  return {
    input: cell.data,
    raw: { width: cell.width, height: cell.height, channels: 3 },
    left,
    top: r * (cellH + gap),
  };
});
await sharp({ create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } } })
  .composite(composites)
  .png()
  .toFile(outFile);
console.log(`${outFile} ${width}x${height}`);
