// Reference images used by the grain study: the clean targets listed in
// public/references/awe/manifest.json (925 px wide). Nothing here is read by
// a renderer; the test ramps use only presets/riso-test-ramps.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '../..');
export const OUT = path.join(HERE, 'out');
export const RAW = path.join(OUT, 'raw');
const AWE = path.join(REPO, 'public/references/awe');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(AWE, 'manifest.json'), 'utf8'));

// The riso tiles are crops of one 567x1134 scan (Figma's source image for
// nodes 41:26-41:28), turned 90 degrees counter-clockwise and enlarged.
// `source` maps a tile pixel to the turned scan: (ox + x / s, oy + y / s).
// Found by correlating the fine residual of the shrunk tile with the scan
// (r = 0.92 green, 0.79 blue, 0.92 pink). The scan is downloaded to
// out/raw/ (gitignored) and only used for the study crops and measurements.
export const RISO_SCAN = path.join(RAW, '41-26-raw1.png');

const LOCAL = {
  'sunset-green-riso': {
    kind: 'riso',
    source: { s: 3.06, ox: 29, oy: 42 },
    spots: [
      { name: 'paper to green', fx: 0.5, fy: 0.07 },
      { name: 'light green', fx: 0.5, fy: 0.2 },
      { name: 'full green', fx: 0.5, fy: 0.42 },
      { name: 'green to mustard', fx: 0.5, fy: 0.9 },
    ],
  },
  'sunset-blue-riso': {
    kind: 'riso',
    source: { s: 2.925, ox: 423, oy: 36 },
    spots: [
      { name: 'paper', fx: 0.5, fy: 0.05 },
      { name: 'light blue', fx: 0.5, fy: 0.17 },
      { name: 'cyan blue', fx: 0.5, fy: 0.31 },
      { name: 'slate navy', fx: 0.5, fy: 0.57 },
    ],
  },
  'sunset-pink-riso': {
    kind: 'riso',
    source: { s: 2.92, ox: 792, oy: 36 },
    // The orange band's lower edge is a hard print edge, not grain.
    extraRects: [[0, 872, 925, 42]],
    spots: [
      { name: 'cream', fx: 0.5, fy: 0.05 },
      { name: 'pink', fx: 0.5, fy: 0.3 },
      { name: 'orange band', fx: 0.5, fy: 0.575 },
      { name: 'slate purple', fx: 0.5, fy: 0.93 },
    ],
  },
  'sunset-film-poster-bands': {
    kind: 'poster',
    spots: [
      { name: 'black band', fx: 0.5, fy: 0.12 },
      { name: 'blue band', fx: 0.3, fy: 0.27 },
      { name: 'grey band', fx: 0.5, fy: 0.5 },
      { name: 'red', fx: 0.5, fy: 0.75 },
    ],
  },
  'sunset-sky-peach': {
    kind: 'photo',
    spots: [
      { name: 'blue sky', fx: 0.5, fy: 0.12 },
      { name: 'grey-beige', fx: 0.5, fy: 0.45 },
      { name: 'peach', fx: 0.6, fy: 0.68 },
      { name: 'deep red', fx: 0.5, fy: 0.9 },
    ],
  },
  'sunset-violet-wave': {
    kind: 'photo',
    spots: [
      { name: 'light blue', fx: 0.4, fy: 0.12 },
      { name: 'white glow', fx: 0.6, fy: 0.35 },
      { name: 'violet', fx: 0.3, fy: 0.62 },
      { name: 'navy', fx: 0.5, fy: 0.85 },
    ],
  },
  'sunset-red-yellow-arcs': {
    kind: 'photo',
    spots: [
      { name: 'maroon', fx: 0.5, fy: 0.06 },
      { name: 'red', fx: 0.5, fy: 0.4 },
      { name: 'yellow', fx: 0.5, fy: 0.73 },
      { name: 'light blue', fx: 0.5, fy: 0.93 },
    ],
  },
  'sunset-blue-diagonal': {
    kind: 'photo',
    spots: [
      { name: 'deep blue', fx: 0.7, fy: 0.12 },
      { name: 'mid blue', fx: 0.5, fy: 0.45 },
      { name: 'lavender', fx: 0.25, fy: 0.68 },
      { name: 'orange', fx: 0.2, fy: 0.9 },
    ],
  },
  'contour-rim-edge': {
    kind: 'contour',
    spots: [
      { name: 'black', fx: 0.85, fy: 0.75 },
      { name: 'navy interior', fx: 0.3, fy: 0.35 },
      { name: 'rim glow', fx: 0.74, fy: 0.3 },
      { name: 'navy dark', fx: 0.15, fy: 0.8 },
    ],
  },
  'contour-yellow-halo': {
    kind: 'contour',
    spots: [
      { name: 'light blue', fx: 0.3, fy: 0.08 },
      { name: 'yellow halo', fx: 0.15, fy: 0.5 },
      { name: 'mid blue', fx: 0.6, fy: 0.55 },
      { name: 'saturated blue', fx: 0.85, fy: 0.75 },
    ],
  },
  'contour-iridescent-rings': {
    kind: 'contour',
    spots: [
      { name: 'near-black', fx: 0.8, fy: 0.35 },
      { name: 'ring interior', fx: 0.55, fy: 0.27 },
      { name: 'cyan rim', fx: 0.06, fy: 0.5 },
      { name: 'lower dark', fx: 0.88, fy: 0.8 },
    ],
  },
  'contour-radial-streaks': {
    kind: 'contour',
    spots: [
      { name: 'dark corner', fx: 0.9, fy: 0.35 },
      { name: 'blue streaks', fx: 0.4, fy: 0.25 },
      { name: 'bright horizon', fx: 0.3, fy: 0.78 },
      { name: 'mid blue', fx: 0.7, fy: 0.82 },
    ],
  },
  'contour-beam-pool': {
    kind: 'contour',
    spots: [
      { name: 'dark side', fx: 0.12, fy: 0.3 },
      { name: 'beam', fx: 0.5, fy: 0.35 },
      { name: 'floor pool', fx: 0.5, fy: 0.75 },
      { name: 'dark floor', fx: 0.5, fy: 0.93 },
    ],
  },
  'contour-light-line': {
    kind: 'contour',
    spots: [
      { name: 'black', fx: 0.2, fy: 0.3 },
      { name: 'yellow halo', fx: 0.44, fy: 0.75 },
      { name: 'red halo', fx: 0.56, fy: 0.85 },
      { name: 'dark falloff', fx: 0.7, fy: 0.9 },
    ],
  },
};

export const REFS = MANIFEST.references
  .filter((m) => LOCAL[m.id])
  .map((m) => {
    const local = LOCAL[m.id];
    return {
      id: m.id,
      kind: local.kind,
      file: path.join(AWE, m.file),
      fullFile: m.fullFile ? path.join(AWE, m.fullFile) : null,
      figmaWidth: m.width,
      rects: [...m.ignore.map((g) => g.rect), ...(local.extraRects ?? [])],
      source: local.source,
      spots: local.spots,
    };
  });

export const refById = (id) => REFS.find((r) => r.id === id);
