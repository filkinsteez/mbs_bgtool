// 2D signed distance functions in pixels. Negative inside.

// Exact distance to a closed polygon (any winding), sign by crossing count.
export function sdPolygon(px, py, xs, ys) {
  const n = xs.length;
  let d = (px - xs[0]) ** 2 + (py - ys[0]) ** 2;
  let s = 1;
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const ex = xs[j] - xs[i];
    const ey = ys[j] - ys[i];
    const wx = px - xs[i];
    const wy = py - ys[i];
    const t = Math.min(1, Math.max(0, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
    const bx = wx - ex * t;
    const by = wy - ey * t;
    d = Math.min(d, bx * bx + by * by);
    const c1 = py >= ys[i];
    const c2 = py < ys[j];
    const c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d);
}

// Moves every edge of a convex polygon inward by r. sdPolygon(inset) - r is
// then the same polygon with every corner rounded by radius r.
export function insetConvex(xs, ys, r) {
  const n = xs.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += xs[i] * ys[j] - xs[j] * ys[i];
  }
  const sign = area > 0 ? 1 : -1;
  const lines = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = xs[j] - xs[i];
    const dy = ys[j] - ys[i];
    const len = Math.hypot(dx, dy);
    // Inward normal for this winding.
    const nx = (-dy / len) * sign;
    const ny = (dx / len) * sign;
    lines.push({ px: xs[i] + nx * r, py: ys[i] + ny * r, dx, dy });
  }
  const ox = [];
  const oy = [];
  for (let i = 0; i < n; i++) {
    const a = lines[(i + n - 1) % n];
    const b = lines[i];
    const den = a.dx * b.dy - a.dy * b.dx;
    const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / den;
    ox.push(a.px + a.dx * t);
    oy.push(a.py + a.dy * t);
  }
  return { xs: ox, ys: oy };
}

// Approximate ellipse distance, accurate near the boundary.
export function sdEllipse(px, py, cx, cy, a, b) {
  const qx = px - cx;
  const qy = py - cy;
  const k0 = Math.hypot(qx / a, qy / b);
  const k1 = Math.hypot(qx / (a * a), qy / (b * b));
  if (k1 < 1e-9) return -Math.min(a, b);
  return (k0 * (k0 - 1)) / k1;
}
