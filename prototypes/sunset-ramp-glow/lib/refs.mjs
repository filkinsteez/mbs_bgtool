import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadImage, tileMask } from './image.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const PROTO = join(ROOT, 'prototypes', 'sunset-ramp-glow');

const SCREENSHOTS = {
  'sunset-sky-peach': 'artifacts/brief-screens/sunset/s39-sky-peach.png',
  'sunset-red-yellow-arcs': 'artifacts/brief-screens/sunset/s40-red-yellow-arc.png',
  'sunset-blue-diagonal': 'artifacts/brief-screens/sunset/s41-blue-diagonal.png',
  'sunset-violet-wave': 'artifacts/brief-screens/sunset/s58-wave.png',
};

/** Clean target from the shared manifest when it exists, else the screenshot. */
export function referencePath(id) {
  const manifestPath = join(ROOT, 'public/references/awe/manifest.json');
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const entry = manifest.references?.find((r) => r.id === id);
    if (entry) {
      const file = join(ROOT, 'public/references/awe', entry.file);
      if (existsSync(file)) return { file, entry, clean: true };
    }
  }
  return { file: join(ROOT, SCREENSHOTS[id]), entry: null, clean: false };
}

export async function loadReference(id) {
  const { file, entry, clean } = referencePath(id);
  const ref = await loadImage(file);
  const mask = clean ? new Uint8Array(ref.w * ref.h).fill(1) : tileMask(ref.bytes, ref.w, ref.h);
  for (const ig of entry?.ignore ?? []) {
    const [x0, y0, rw, rh] = ig.rect;
    for (let y = Math.max(0, y0); y < Math.min(ref.h, y0 + rh); y++) {
      for (let x = Math.max(0, x0); x < Math.min(ref.w, x0 + rw); x++) mask[y * ref.w + x] = 0;
    }
  }
  return { ...ref, mask, file, clean };
}

export const REFERENCE_IDS = Object.keys(SCREENSHOTS);
