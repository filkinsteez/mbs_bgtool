// Seed raster: colored light seeds drawn as soft footprints into
// [P (3), A, Q (3)] = premultiplied color, coverage, premultiplied color^2.
//
// Coordinates: u = x / W and v = y / H on the canvas (v = 0 at the top); the
// raster may cover a padded area beyond [0, 1] so the canvas is a crop of a
// larger fill. Lines run across u. Blobs, arcs and strokes are measured in an
// isotropic frame X = (u - 0.5) * W / H, Y = v, so circles stay circles at any
// aspect; their sizes are in units of the canvas height.
//
// Seed colors: `color`, or `color` at the start and `colorR` at the end, or
// `stops: [[t, color], ...]`, interpolated in linear light along the seed
// (t = u for lines, arc length 0..1 for strokes).
import { hexToLinear } from './color.mjs';
import { fbm } from './noise.mjs';
import { makeImage } from './image.mjs';

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function resolveColor(c, palette) {
  if (typeof c === 'number') return hexToLinear(palette[c]);
  if (typeof c === 'string') return hexToLinear(c);
  return c;
}

// Centerline offset for a line: tilt, bend and a low-frequency wobble.
export function lineCenter(s, u, k) {
  const du = u - 0.5;
  let y = s.y + (s.slope ?? 0) * du + (s.bend ?? 0) * du * du;
  if (s.wave) y += s.wave.amp * Math.sin(2 * Math.PI * (s.wave.freq * u + (s.wave.phase ?? 0)));
  if (s.warp) y += s.warp.amp * fbm(u * s.warp.freq + 3.7 * k, 0.37 * k, s.warp.seed ?? 11 + k, s.warp.octaves ?? 2);
  return y;
}

function softAlong(s, t, k) {
  const soft = s.soft ?? 0.01;
  if (!s.softVar) return soft;
  return soft * Math.max(0.05, 1 + s.softVar * fbm(t * (s.softFreq ?? 1.3) + 9.1 * k, 1.7, 77 + k, 2));
}

export function extentMask(s, u) {
  if (s.u0 === undefined && s.u1 === undefined) return 1;
  const e = s.endSoft ?? 0.1;
  const u0 = s.u0 ?? -9;
  const u1 = s.u1 ?? 9;
  return smoothstep(u0 - e, u0 + e, u) * (1 - smoothstep(u1 - e, u1 + e, u));
}

// Polyline in the isotropic frame, smoothed with Catmull-Rom subdivision.
export function prepareStroke(s, aspect) {
  const raw = s.points.map(([u, v]) => [(u - 0.5) * aspect, v]);
  const pts = [];
  const sub = s.smooth === false ? 1 : 8;
  for (let i = 0; i < raw.length - 1; i++) {
    const p0 = raw[Math.max(0, i - 1)];
    const p1 = raw[i];
    const p2 = raw[i + 1];
    const p3 = raw[Math.min(raw.length - 1, i + 2)];
    for (let j = 0; j < sub; j++) {
      const t = j / sub;
      const t2 = t * t;
      const t3 = t2 * t;
      const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      pts.push([cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  pts.push(raw[raw.length - 1]);
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = acc[acc.length - 1];
  return { pts, acc, total };
}

function strokeDistance(st, X, Y) {
  let best = Infinity;
  let bestT = 0;
  const { pts, acc, total } = st;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const ex = bx - ax;
    const ey = by - ay;
    const l2 = ex * ex + ey * ey || 1e-12;
    const h = Math.min(1, Math.max(0, ((X - ax) * ex + (Y - ay) * ey) / l2));
    const dx = X - ax - ex * h;
    const dy = Y - ay - ey * h;
    const d = dx * dx + dy * dy;
    if (d < best) {
      best = d;
      bestT = (acc[i] + h * Math.sqrt(l2)) / total;
    }
  }
  return [Math.sqrt(best), bestT];
}

// Returns [coverage, t] for one seed at one point.
function footprint(s, k, u, v, X, Y, aspect) {
  switch (s.kind) {
    case 'line': {
      const d = Math.abs(v - lineCenter(s, u, k));
      const hw = s.width ?? 0.005;
      return [(1 - smoothstep(hw, hw + softAlong(s, u, k), d)) * extentMask(s, u), u];
    }
    case 'stroke': {
      const [d, t] = strokeDistance(s.prepared, X, Y);
      const hw = s.width ?? 0.005;
      return [1 - smoothstep(hw, hw + softAlong(s, t, k), d), t];
    }
    case 'blob': {
      const cx = (s.u - 0.5) * aspect;
      const rot = ((s.rot ?? 0) * Math.PI) / 180;
      const dx = X - cx;
      const dy = Y - s.v;
      const qx = (Math.cos(rot) * dx + Math.sin(rot) * dy) / s.rx;
      const qy = (-Math.sin(rot) * dx + Math.cos(rot) * dy) / (s.ry ?? s.rx);
      const d = Math.sqrt(qx * qx + qy * qy);
      if (s.profile === 'gauss') return [Math.exp(-0.5 * d * d * 9), u];
      const soft = s.soft ?? 0.5;
      return [1 - smoothstep(1 - soft, 1, d), u];
    }
    case 'arc': {
      const cx = (s.u - 0.5) * aspect;
      const dx = (X - cx) / (s.sx ?? 1);
      const dy = (Y - s.v) / (s.sy ?? 1);
      let r = Math.sqrt(dx * dx + dy * dy);
      if (s.warp) {
        const ang = Math.atan2(dy, dx);
        r -= s.warp.amp * fbm(ang * s.warp.freq + 3.7 * k, 0.37 * k, s.warp.seed ?? 11 + k, s.warp.octaves ?? 2);
      }
      const d = Math.abs(r - s.r);
      const hw = s.width ?? 0.005;
      return [1 - smoothstep(hw, hw + (s.soft ?? 0.01), d), u];
    }
    default:
      throw new Error(`unknown seed kind ${s.kind}`);
  }
}

function colorStops(s, palette) {
  const g = s.gain ?? 1;
  const scale = (c) => resolveColor(c, palette).map((x) => x * g);
  if (s.stops) return s.stops.map(([t, c]) => [t, scale(c)]);
  if (s.colorR !== undefined) return [[0, scale(s.color)], [1, scale(s.colorR)]];
  return [[0, scale(s.color)]];
}

function colorAt(stops, t, out) {
  if (stops.length === 1 || t <= stops[0][0]) {
    for (let c = 0; c < 3; c++) out[c] = stops[0][1][c];
    return;
  }
  for (let j = 0; j < stops.length - 1; j++) {
    const [t0, c0] = stops[j];
    const [t1, c1] = stops[j + 1];
    if (t <= t1) {
      const a = (t - t0) / (t1 - t0 || 1);
      for (let c = 0; c < 3; c++) out[c] = c0[c] + (c1[c] - c0[c]) * a;
      return;
    }
  }
  for (let c = 0; c < 3; c++) out[c] = stops[stops.length - 1][1][c];
}

// Rasterizes seeds on a (w x h) grid that covers the canvas plus `pad` of the
// canvas size on every side. `aspect` is the canvas aspect (W / H).
// warpField(u, v) -> [du, dv] bends every seed together.
export function rasterSeeds(seeds, palette, w, h, { secondMoment = true, warpField = null, pad = 0, aspect = w / h } = {}) {
  const nc = secondMoment ? 7 : 4;
  const img = makeImage(w, h, nc);
  const span = 1 + 2 * pad;
  const prepared = seeds.map((s, k) => ({
    s: s.kind === 'stroke' ? { ...s, prepared: prepareStroke(s, aspect) } : s,
    k,
    stops: colorStops(s, palette),
    wgt: s.weight ?? 1,
  }));
  const col = [0, 0, 0];
  const [Pr, Pg, Pb, A] = img.ch;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let u = ((x + 0.5) / w) * span - pad;
      let v = ((y + 0.5) / h) * span - pad;
      if (warpField) {
        const [du, dv] = warpField(u, v);
        u += du;
        v += dv;
      }
      const X = (u - 0.5) * aspect;
      const Y = v;
      const i = y * w + x;
      for (const p of prepared) {
        const [cov, t] = footprint(p.s, p.k, u, v, X, Y, aspect);
        const f = cov * p.wgt;
        if (f <= 0) continue;
        colorAt(p.stops, t, col);
        Pr[i] += f * col[0];
        Pg[i] += f * col[1];
        Pb[i] += f * col[2];
        A[i] += f;
        if (secondMoment) {
          // second moment of chromaticity (color / (r + g + b)), so the spread
          // measures hue difference and ignores brightness differences
          const s = col[0] + col[1] + col[2] + 1e-6;
          img.ch[4][i] += f * (col[0] / s) ** 2;
          img.ch[5][i] += f * (col[1] / s) ** 2;
          img.ch[6][i] += f * (col[2] / s) ** 2;
        }
      }
      if (A[i] > 1) {
        const inv = 1 / A[i];
        for (let c = 0; c < nc; c++) img.ch[c][i] *= inv;
      }
    }
  }
  return img;
}
