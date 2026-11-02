// Isoline drawings: lines over an image, and the lines alone on white.

import { makeCanvas, drawPolyline, dimCanvas } from './image.mjs';
import { traceIsolines } from './isolines.mjs';

const MAIN_COLORS = [
  [255, 80, 40],
  [255, 200, 0],
  [40, 200, 255],
  [190, 90, 255],
  [60, 220, 110],
  [255, 120, 200],
  [255, 255, 255],
  [255, 150, 60],
];

export function mainColor(k) {
  return MAIN_COLORS[k % MAIN_COLORS.length];
}

// Equal-t isolines (thin white with a dark edge) and main boundaries (thick, colored).
export function overlay(base, T, levels, main, opts = {}) {
  const c = dimCanvas(base, opts.dim ?? 0.85);
  for (const lv of levels) {
    for (const line of traceIsolines(T, lv)) {
      if (line.length < 6) continue;
      drawPolyline(c, line, [0, 0, 0], 1.4, 0.55);
      drawPolyline(c, line, [255, 255, 255], 0.55, 0.9);
    }
  }
  main.forEach((m, k) => {
    for (const line of traceIsolines(T, m.t50)) {
      if (line.length < 6) continue;
      drawPolyline(c, line, [0, 0, 0], 2.6, 0.6);
      drawPolyline(c, line, mainColor(k), 1.5, 1);
    }
  });
  return c;
}

// The isolines alone: shaded 10-90 zone of each main transition, equal-t lines
// in grey, main boundaries in color.
export function linesPlot(T, levels, main) {
  const { w, h, t } = T;
  const c = makeCanvas(w, h, [255, 255, 255]);
  for (let i = 0; i < w * h; i++) {
    main.forEach((m, k) => {
      const lo = Math.min(m.t10, m.t90);
      const hi = Math.max(m.t10, m.t90);
      if (t[i] >= lo && t[i] <= hi) {
        const col = mainColor(k);
        for (let q = 0; q < 3; q++) c.data[i * 3 + q] = 255 - (255 - col[q]) * 0.22;
      }
    });
  }
  for (const lv of levels) {
    for (const line of traceIsolines(T, lv)) if (line.length >= 6) drawPolyline(c, line, [110, 110, 110], 0.6, 1);
  }
  main.forEach((m, k) => {
    const col = mainColor(k).map((v) => v * 0.75);
    for (const line of traceIsolines(T, m.t50)) if (line.length >= 6) drawPolyline(c, line, col, 1.4, 1);
  });
  return c;
}

// t as a grey map with steps every 1/14, so folds and plateaus show.
export function tMap(T) {
  const { w, h, t } = T;
  const c = makeCanvas(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = Math.max(0, Math.min(1, t[i]));
    const band = Math.floor(v * 14) % 2;
    const g = 40 + 180 * v + (band ? 18 : 0);
    c.data[i * 3] = g;
    c.data[i * 3 + 1] = g;
    c.data[i * 3 + 2] = g;
  }
  return c;
}
