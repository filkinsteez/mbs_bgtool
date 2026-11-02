// Reference targets. Prefers the clean targets in public/references/awe when
// the manifest lists them; falls back to the Figma screenshots.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SCREENSHOTS = {
  'sunset-sky-peach': { file: 's39-sky-peach.png', ignore: [] },
  'sunset-red-yellow-arcs': { file: 's40-red-yellow-arc.png', ignore: [] },
  'sunset-blue-diagonal': { file: 's41-blue-diagonal.png', ignore: [] },
  'sunset-violet-wave': { file: 's58-wave.png', ignore: [] },
  'sunset-pink-riso': { file: 's64-pink-riso.png', ignore: [{ kind: 'fold', rect: [0, 708, 895, 10] }] },
};

// Masks for print artifacts in the clean targets, used when the manifest
// doesn't list them yet.
const CLEAN_EXTRA_IGNORE = {
  'sunset-pink-riso': [{ kind: 'fold', rect: [0, 710, 925, 16] }],
};

export async function resolveReference(id) {
  const manifestPath = join(ROOT, 'public/references/awe/manifest.json');
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const entry = manifest.references?.find((r) => r.id === id);
    if (entry) {
      const path = join(ROOT, 'public/references/awe', entry.file);
      if (existsSync(path)) {
        const ignore = entry.ignore ?? [];
        const hasFold = ignore.some((r) => r.kind === 'fold');
        const extra = hasFold ? [] : (CLEAN_EXTRA_IGNORE[id] ?? []);
        return { id, path, cornerRadius: entry.cornerRadius ?? 0, ignore: [...ignore, ...extra], source: 'clean' };
      }
    }
  }
  const s = SCREENSHOTS[id];
  if (!s) throw new Error(`unknown reference ${id}`);
  return {
    id,
    path: join(ROOT, 'artifacts/brief-screens/sunset', s.file),
    cornerRadius: 26,
    ignore: s.ignore,
    source: 'screenshot',
  };
}
