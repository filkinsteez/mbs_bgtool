// Zoomed crop of a reference target for visual inspection.
//
//   node scripts/references/crop.mjs <id> <x> <y> <w> <h> [--scale=3] [--gain=1] [--name=crop]
//
// x, y, w, h are target pixels (925 px wide). --scale enlarges with
// nearest-neighbor so single pixels and grain stay visible. --gain multiplies
// the image in linear light (use 4 or 8 to see detail in dark areas).
// Writes artifacts/references-raw/crops/<id>/<name>.png and prints the path.

import fs from "node:fs/promises";
import sharp from "sharp";
import { RAW_DIR, TARGET_DIR } from "./references.mjs";
import { linearToSrgb, srgb8ToLinear } from "./lib/color.mjs";

async function main() {
  const args = process.argv.slice(2);
  const opts = Object.fromEntries(args.filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")));
  const [id, ...nums] = args.filter((a) => !a.startsWith("--"));
  const [x, y, w, h] = nums.map(Number);
  if (!id || [x, y, w, h].some((v) => !Number.isFinite(v))) {
    console.error("usage: node scripts/references/crop.mjs <id> <x> <y> <w> <h> [--scale=3] [--gain=1] [--name=crop]");
    process.exit(1);
  }
  const manifest = JSON.parse(await fs.readFile(`${TARGET_DIR}/manifest.json`, "utf8"));
  const entry = manifest.references.find((e) => e.id === id);
  if (!entry) throw new Error(`unknown reference ${id}`);
  const scale = Number(opts.scale ?? 3);
  const gain = Number(opts.gain ?? 1);

  const { data, info } = await sharp(`${TARGET_DIR}/${entry.file}`)
    .removeAlpha()
    .extract({ left: x, top: y, width: w, height: h })
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (gain !== 1) {
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.round(Math.min(1, linearToSrgb(Math.min(1, srgb8ToLinear(data[i]) * gain))) * 255);
    }
  }
  const dir = `${RAW_DIR}/crops/${id}`;
  await fs.mkdir(dir, { recursive: true });
  const out = `${dir}/${opts.name ?? `crop-${x}-${y}-${w}x${h}`}.png`;
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } })
    .resize(info.width * scale, info.height * scale, { kernel: "nearest" })
    .png()
    .toFile(out);
  console.log(out);
}

await main();
