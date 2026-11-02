/** Minimal line plots into an 8-bit RGB buffer, for looking at profiles. */
export function makeCanvas(w, h, bg = 255) {
  return { w, h, bytes: new Uint8Array(w * h * 3).fill(bg) };
}

function dot(cv, x, y, col) {
  if (x < 0 || y < 0 || x >= cv.w || y >= cv.h) return;
  const i = (y * cv.w + x) * 3;
  cv.bytes[i] = col[0];
  cv.bytes[i + 1] = col[1];
  cv.bytes[i + 2] = col[2];
}

export function line(cv, x0, y0, x1, y1, col, thick = 1) {
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  for (let i = 0; i <= n; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / n);
    const y = Math.round(y0 + ((y1 - y0) * i) / n);
    for (let t = 0; t < thick; t++) dot(cv, x, y + t, col);
  }
}

/**
 * Plot series into a panel. series: [{ values: Float32Array|number[], color, dashed }]
 * x spans the series length; y maps [lo, hi] to the panel height.
 */
export function panel(cv, top, height, series, lo, hi, gridLines = []) {
  const toY = (v) => top + height - 1 - ((v - lo) / (hi - lo)) * (height - 1);
  line(cv, 0, top, cv.w - 1, top, [200, 200, 200]);
  line(cv, 0, top + height - 1, cv.w - 1, top + height - 1, [200, 200, 200]);
  for (const g of gridLines) line(cv, 0, toY(g), cv.w - 1, toY(g), [232, 232, 232]);
  for (const s of series) {
    const n = s.values.length;
    let prev = null;
    for (let i = 0; i < n; i++) {
      const v = s.values[i];
      if (!Number.isFinite(v)) {
        prev = null;
        continue;
      }
      const x = Math.round((i / (n - 1)) * (cv.w - 1));
      const y = Math.round(toY(Math.min(hi, Math.max(lo, v))));
      if (prev && (!s.dashed || Math.floor(i / 6) % 2 === 0)) line(cv, prev[0], prev[1], x, y, s.color, s.thick ?? 2);
      prev = [x, y];
    }
  }
}
