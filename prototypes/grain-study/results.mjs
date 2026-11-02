// Copies the sheets used in the README into results/, as PNG when small
// enough, otherwise JPEG (4:4:4), keeping each file under 400 KB.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { HERE, OUT } from './refs.mjs';

const DIR = path.join(HERE, 'results');
fs.mkdirSync(DIR, { recursive: true });
const LIMIT = 400 * 1024;

const PICKS = [
  ['study/sunset-pink-riso.png', 'riso-tile-vs-scan'],
  ['study/sunset-film-poster-bands.png', 'poster-halftone'],
  ['study/deck-layers-grain.png', 'deck-grain-layer'],
  ['models/sunset-blue-riso-compare-4x.png', 'models-blue-4x'],
  ['models/sunset-pink-riso-compare-1x.png', 'models-pink-1x'],
  ['recommend/sunset-green-riso-1x.png', 'recommended-green-1x'],
  ['recommend/sunset-pink-riso-4x.png', 'recommended-pink-4x'],
  ['export/atmospheric-film05-100.png', 'export-3840-film-100'],
  ['export/atmospheric-riso10-100.png', 'export-3840-riso-100'],
  ['export/atmospheric-film05-25-zoom.png', 'export-25-film'],
  ['export/atmospheric-per-pixel125-25-zoom.png', 'export-25-per-pixel'],
  ['export/dark-gradient-banding.png', 'dark-gradient-banding'],
  ['packs/packs-16x9.png', 'packs-16x9'],
  ['packs/packs-9x16.png', 'packs-9x16'],
  ['packs/packs-zoom-16x9.png', 'packs-zoom'],
];

for (const name of fs.readdirSync(DIR)) fs.unlinkSync(path.join(DIR, name));
for (const [src, name] of PICKS) {
  const file = path.join(OUT, src);
  const png = await sharp(file).png({ compressionLevel: 9 }).toBuffer();
  if (png.length <= LIMIT) {
    fs.writeFileSync(path.join(DIR, `${name}.png`), png);
    console.log(`${name}.png ${(png.length / 1024).toFixed(0)} KB`);
    continue;
  }
  let done = false;
  for (const width of [null, 1400, 1100, 900]) {
    for (const quality of [92, 88, 84, 80]) {
      let img = sharp(file);
      if (width) img = img.resize({ width, withoutEnlargement: true });
      const jpg = await img.jpeg({ quality, chromaSubsampling: '4:4:4', mozjpeg: true }).toBuffer();
      if (jpg.length <= LIMIT) {
        fs.writeFileSync(path.join(DIR, `${name}.jpg`), jpg);
        console.log(`${name}.jpg ${(jpg.length / 1024).toFixed(0)} KB (q${quality}${width ? `, ${width} px wide` : ''})`);
        done = true;
        break;
      }
    }
    if (done) break;
  }
  if (!done) console.log(`${name}: could not fit under 400 KB`);
}
