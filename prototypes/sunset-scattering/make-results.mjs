// Builds the committed result images in results/ from renders in out/.
// Run after render.mjs (tag "final") and variations.mjs.

import { mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { referencePath } from "./render.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "out");
const res = join(here, "results");
mkdirSync(res, { recursive: true });

async function row(files, height, gap = 8) {
  const bufs = [];
  let width = 0;
  for (const f of files) {
    const b = await sharp(f).removeAlpha().resize({ height }).png().toBuffer();
    const m = await sharp(b).metadata();
    bufs.push({ b, w: m.width });
    width += m.width;
  }
  width += gap * (files.length - 1);
  let left = 0;
  const comps = bufs.map(({ b, w }) => {
    const c = { input: b, left, top: 0 };
    left += w + gap;
    return c;
  });
  return sharp({ create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite(comps)
    .png()
    .toBuffer();
}

async function stack(buffers, gap = 8) {
  const metas = await Promise.all(buffers.map((b) => sharp(b).metadata()));
  const width = Math.max(...metas.map((m) => m.width));
  const height = metas.reduce((s, m) => s + m.height, 0) + gap * (buffers.length - 1);
  let top = 0;
  const comps = buffers.map((b, i) => {
    const c = { input: b, left: 0, top };
    top += metas[i].height + gap;
    return c;
  });
  return sharp({ create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite(comps)
    .png()
    .toBuffer();
}

async function save(name, buf, quality = 82) {
  const file = join(res, name);
  await sharp(buf).jpeg({ quality, chromaSubsampling: "4:4:4" }).toFile(file);
  console.log(`${file} ${(statSync(file).size / 1024).toFixed(0)} KB`);
}

const refs = ["sunset-sky-peach", "sunset-blue-diagonal", "sunset-red-yellow-arcs", "sunset-violet-wave"];
for (const id of refs) {
  const ref = referencePath(id).path;
  const h = id === "sunset-violet-wave" ? 460 : 640;
  await save(`${id}.jpg`, await row([ref, join(out, id, "final.png")], h));
}

await save(
  "zooms.jpg",
  await stack([
    await row([join(out, "sunset-sky-peach/final-zoom.png"), join(out, "sunset-blue-diagonal/final-zoom.png")], 360),
    await row([join(out, "sunset-violet-wave/final-zoom.png"), join(out, "sunset-red-yellow-arcs/final-zoom.png")], 360),
  ]),
);

await save(
  "modes-sky-peach.jpg",
  await row(
    [
      referencePath("sunset-sky-peach").path,
      join(out, "sunset-sky-peach/bands-final.png"),
      join(out, "sunset-sky-peach/bands-fit.png"),
      join(out, "sunset-sky-peach/physical-final.png"),
      join(out, "sunset-sky-peach/final.png"),
    ],
    420,
  ),
);

const v = (n) => join(out, "variations", n);
await save(
  "production.jpg",
  await stack([
    await row(
      [v("production-bold-1920x1080-s1.png"), v("production-elemental-1920x1080-s1.png"), v("production-atmospheric-1920x1080-s1.png")],
      300,
    ),
    await row(
      [
        v("production-bold-1080x1920-s1.png"),
        v("production-bold-1080x1920-s2.png"),
        v("production-elemental-1080x1920-s1.png"),
        v("production-elemental-1080x1920-s2.png"),
        v("production-atmospheric-1080x1920-s1.png"),
        v("production-atmospheric-1080x1920-s2.png"),
      ],
      420,
    ),
  ]),
);
