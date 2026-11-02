// Offline fit of a rim light falloff field to brightness samples measured
// along the edges of contour-rim-edge (clean target, 925x1644). Prints the
// numbers for the preset; nothing here runs at render time.
//   node tools/fit-source.mjs glow|core

const W = 925;
const H = 1644;
const unit = Math.min(W, H) / 1000;

// [x, y, value]. glow: blue-lobe brightness from the plateau's blue channel.
// core: white-core brightness from the plateau's red channel.
const SAMPLES = {
  glow: [
    [40, 202.5, 0.27], [80, 202.5, 0.28], [120, 202.5, 0.37], [160, 202.5, 0.47], [200, 202.5, 0.58],
    [240, 202.5, 0.76], [280, 202.5, 0.84], [320, 202.5, 0.92], [360, 202.5, 0.95], [400, 202.5, 0.98],
    [440, 202.5, 0.98], [480, 202.5, 1.0], [520, 202.5, 0.99], [560, 202.5, 1.0], [600, 202.5, 1.0],
    [640, 202.5, 1.0], [709, 215, 1.0], [740, 246, 0.97], [751, 288, 1.0], [746, 316, 1.0],
    [717, 380, 0.95], [677, 460, 0.92], [637, 540, 0.96], [597, 620, 0.94], [557, 700, 0.95],
    [518, 780, 0.86], [478, 860, 0.675], [438, 940, 0.6], [398, 1020, 0.38], [358, 1100, 0.247],
    [318, 1180, 0.156], [279, 1260, 0.087], [239, 1340, 0.04], [199, 1420, 0.026], [159, 1500, 0.023],
  ],
  core: [
    [660, 203, 0.83], [683, 206, 0.9], [705, 215, 0.915], [723, 229, 0.935], [738, 248, 0.96],
    [747, 269, 0.97], [750, 293, 1.0], [747, 316, 0.99], [741, 332, 0.99], [640, 202.5, 0.8],
    [600, 202.5, 0.76], [560, 202.5, 0.69], [520, 202.5, 0.64], [480, 202.5, 0.56], [440, 202.5, 0.46],
    [400, 202.5, 0.38], [360, 202.5, 0.24], [320, 202.5, 0.157], [280, 202.5, 0.095], [240, 202.5, 0.05],
    [200, 202.5, 0.016], [715, 380, 0.87], [676, 460, 0.79], [636, 540, 0.69], [596, 620, 0.5],
    [557, 700, 0.38], [517, 780, 0.21], [477, 860, 0.083], [438, 940, 0.026],
  ],
};

const kind = process.argv[2] ?? 'glow';
const S = SAMPLES[kind];
const logCost = kind === 'glow';

const PLANE = process.argv[3] === 'plane';
function field(p, x, y) {
  if (PLANE) {
    // [px, py, r0, L, angle]: light toward angle; 1 on the light side of p.
    const [sx, sy, r0, L, ang] = p;
    const q = (sx - x) * Math.cos(ang) + (sy - y) * Math.sin(ang);
    return q <= 0 ? 1 : Math.exp(-(Math.sqrt(r0 * r0 + q * q) - r0) / L);
  }
  const [sx, sy, r0, L, an, ang] = p;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const dx = x - sx;
  const dy = y - sy;
  const u = (dx * ca + dy * sa) / an;
  const v = -dx * sa + dy * ca;
  return Math.exp(-(Math.sqrt(r0 * r0 + u * u + v * v) - r0) / L);
}

function cost(p) {
  if (p[2] < 1 || p[3] < 5 || (!PLANE && (p[4] < 0.25 || p[4] > 4))) return 1e9;
  if (Math.abs(p[0] - W / 2) > W * 1.5 || Math.abs(p[1] - H / 2) > H * 1.5) return 1e9;
  let c = 0;
  for (const [x, y, e] of S) {
    const m = field(p, x, y);
    c += logCost ? (Math.log(m + 0.01) - Math.log(e + 0.01)) ** 2 : (m - e) ** 2;
  }
  return c;
}

function nelderMead(f, x0, steps, iters) {
  const n = x0.length;
  let pts = [x0];
  for (let i = 0; i < n; i++) {
    const p = [...x0];
    p[i] += steps[i];
    pts.push(p);
  }
  let vals = pts.map(f);
  for (let it = 0; it < iters; it++) {
    const order = vals.map((_, i) => i).sort((a, b) => vals[a] - vals[b]);
    pts = order.map((i) => pts[i]);
    vals = order.map((i) => vals[i]);
    const c = Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += pts[i][j] / n;
    const at = (t) => c.map((v, j) => v + t * (pts[n][j] - v));
    const xr = at(-1);
    const fr = f(xr);
    if (fr < vals[0]) {
      const xe = at(-2);
      const fe = f(xe);
      [pts[n], vals[n]] = fe < fr ? [xe, fe] : [xr, fr];
    } else if (fr < vals[n - 1]) {
      [pts[n], vals[n]] = [xr, fr];
    } else {
      const xc = at(0.5);
      const fc = f(xc);
      if (fc < vals[n]) [pts[n], vals[n]] = [xc, fc];
      else
        for (let i = 1; i <= n; i++) {
          pts[i] = pts[i].map((v, j) => pts[0][j] + 0.5 * (v - pts[0][j]));
          vals[i] = f(pts[i]);
        }
    }
  }
  return [pts[0], vals[0]];
}

let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
let best = null;
for (let i = 0; i < 80; i++) {
  const start = PLANE ? [400 + rnd() * 600, 100 + rnd() * 700, 20 + rnd() * 600, 40 + rnd() * 300, rnd() * 2 * Math.PI] : [400 + rnd() * 600, 100 + rnd() * 700, 20 + rnd() * 600, 40 + rnd() * 300, 0.5 + rnd() * 3.4, rnd() * Math.PI];
  const r = nelderMead(cost, start, PLANE ? [60, 60, 60, 30, 0.2] : [60, 60, 60, 30, 0.2, 0.2], 3000);
  if (!best || r[1] < best[1]) best = r;
}
const [p, c] = best;
console.log(kind, 'cost', c.toFixed(4));
console.log(
  JSON.stringify(
    PLANE
      ? { pos: [+(p[0] / W).toFixed(4), +(p[1] / H).toFixed(4)], falloff: 'plane', radius: +(p[2] / unit).toFixed(1), length: +(p[3] / unit).toFixed(1), angle: +((p[4] * 180) / Math.PI).toFixed(2) }
      : { pos: [+(p[0] / W).toFixed(4), +(p[1] / H).toFixed(4)], falloff: 'exp', radius: +(p[2] / unit).toFixed(1), length: +(p[3] / unit).toFixed(1), aniso: +p[4].toFixed(3), angle: +((p[5] * 180) / Math.PI).toFixed(2) },
  ),
);
for (const [x, y, e] of S) console.log(`${x},${y}  target ${e.toFixed(3)}  model ${field(p, x, y).toFixed(3)}`);
