// Test images: smooth vertical ramps through a few colour stops, built in
// linear RGB with monotone cubic (Fritsch-Carlson) interpolation per
// channel. Stops are { t, rgb } with t in [0, 1] down the image and rgb in
// linear light.
import { makeImage } from './image.mjs';

function pchipSlopes(ts, ys) {
  const n = ts.length;
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (ts[i + 1] - ts[i]));
  const m = new Array(n).fill(0);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else {
      const w1 = 2 * (ts[i + 1] - ts[i]) + (ts[i] - ts[i - 1]);
      const w2 = (ts[i + 1] - ts[i]) + 2 * (ts[i] - ts[i - 1]);
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  return m;
}

// Returns f(t) -> [r, g, b] in linear light.
export function rampFunction(stops) {
  const ts = stops.map((s) => s.t);
  const chans = [0, 1, 2].map((c) => {
    const ys = stops.map((s) => s.rgb[c]);
    return { ys, m: pchipSlopes(ts, ys) };
  });
  return (t) => {
    const tt = Math.min(ts[ts.length - 1], Math.max(ts[0], t));
    let i = 0;
    while (i < ts.length - 2 && tt > ts[i + 1]) i++;
    const h = ts[i + 1] - ts[i];
    const u = (tt - ts[i]) / h;
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1;
    const h10 = u ** 3 - 2 * u ** 2 + u;
    const h01 = -2 * u ** 3 + 3 * u ** 2;
    const h11 = u ** 3 - u ** 2;
    return chans.map(({ ys, m }) =>
      Math.max(0, h00 * ys[i] + h10 * h * m[i] + h01 * ys[i + 1] + h11 * h * m[i + 1]),
    );
  };
}

// Ramp coordinate per pixel: t = y / (h - 1) plus an optional per-pixel
// offset field (used by the coordinate-jitter grain model).
export function renderRamp(w, h, stops, jitter) {
  const f = rampFunction(stops);
  const img = makeImage(w, h);
  if (!jitter) {
    const row = [];
    for (let y = 0; y < h; y++) row.push(f(y / (h - 1)));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) img.d.set(row[y], (y * w + x) * 3);
    }
    return img;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      img.d.set(f(y / (h - 1) + jitter[i]), i * 3);
    }
  }
  return img;
}

// Diagonal or angled linear ramp for pack checks: t runs along `angle`
// (radians, 0 = top to bottom), normalized to the image's extent.
export function renderAngledRamp(w, h, stops, angle = 0) {
  const f = rampFunction(stops);
  const img = makeImage(w, h);
  const dx = Math.sin(angle);
  const dy = Math.cos(angle);
  const corners = [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
  ].map(([x, y]) => x * dx + y * dy);
  const lo = Math.min(...corners);
  const hi = Math.max(...corners);
  const lut = [];
  const N = 4096;
  for (let k = 0; k <= N; k++) lut.push(f(k / N));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = ((x + 0.5) * dx + (y + 0.5) * dy - lo) / (hi - lo);
      const k = t * N;
      const k0 = Math.min(N - 1, Math.floor(k));
      const u = k - k0;
      const a = lut[k0];
      const b = lut[k0 + 1];
      const o = (y * w + x) * 3;
      img.d[o] = a[0] + (b[0] - a[0]) * u;
      img.d[o + 1] = a[1] + (b[1] - a[1]) * u;
      img.d[o + 2] = a[2] + (b[2] - a[2]) * u;
    }
  }
  return img;
}
