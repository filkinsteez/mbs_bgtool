import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, '..', '..');

const SCREENS = join(REPO, 'artifacts', 'brief-screens', 'sunset');
const CLEAN = join(REPO, 'public', 'references', 'awe');

// Ignore rects are [x, y, w, h] in target pixels, found with tools/crop.mjs
// and the row anomaly scan in analyze.mjs. Used when the manifest has none.
const POSTER_TEXT = [
  { kind: 'text', rect: [130, 1085, 700, 85] },
  { kind: 'text', rect: [20, 1160, 890, 85] },
  { kind: 'text', rect: [350, 1235, 240, 40] },
];

const LOCAL = {
  'sunset-green-riso': {
    screenshot: { file: 's50-green-riso.png', ignore: [{ kind: 'fold', rect: [0, 712, 895, 16] }] },
    clean: [{ kind: 'fold', rect: [0, 726, 925, 24] }],
  },
  'sunset-blue-riso': {
    screenshot: { file: 's63-blue-riso.png', ignore: [{ kind: 'fold', rect: [0, 688, 895, 14] }] },
    clean: [{ kind: 'fold', rect: [0, 699, 925, 26] }],
  },
  'sunset-pink-riso': {
    screenshot: { file: 's64-pink-riso.png', ignore: [{ kind: 'fold', rect: [0, 688, 895, 14] }] },
    clean: [{ kind: 'fold', rect: [0, 703, 925, 28] }],
  },
  'sunset-film-poster-bands': {
    screenshot: { file: 's42-poster.png', ignore: POSTER_TEXT },
    clean: POSTER_TEXT,
  },
};

// Prefers the clean targets from the reference agent once they exist.
export function getRef(id, { forceScreenshot = false } = {}) {
  const local = LOCAL[id];
  const manifestPath = join(CLEAN, 'manifest.json');
  if (!forceScreenshot && existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const entry = manifest.references?.find((r) => r.id === id);
    if (entry && existsSync(join(CLEAN, entry.file))) {
      // Manifest rects win; local 'other' rects (scan edges) are added on top.
      const extra = (local?.clean ?? []).filter((r) => r.kind === 'other');
      const ignore = entry.ignore?.length ? [...entry.ignore, ...extra] : (local?.clean ?? []);
      return { id, file: join(CLEAN, entry.file), ignore, clean: true, ignoreFrom: entry.ignore?.length ? 'manifest' : 'local' };
    }
  }
  return { id, file: join(SCREENS, local.screenshot.file), ignore: local.screenshot.ignore, clean: false, ignoreFrom: 'local' };
}

export const REF_IDS = Object.keys(LOCAL);
