import { channel, gaussianBlur, round } from "./analysis.mjs";
import { chroma, hueDegrees, linearRgbToHex, linearRgbToOklab } from "./color.mjs";

// Glow falloff measured perpendicular to the brightest ridge of a light.
//
// spec.seeds:
//   { kind: "rows", from, to, count, x: [x0, x1] }  scan rows (fractions of H), search x (fractions of W)
//   { kind: "cols", from, to, count, y: [y0, y1] }
//   { kind: "rays", center: [cx, cy], angles: [[a0, a1], ...], count, r: [r0, r1], fitCircle }
//     center in fractions of W and H, angle ranges in degrees (0 = +x, 90 = +y), r in fractions of the short side
// spec.ridgeFit: "line" replaces the ridge points of rows/cols seeds by a fitted straight line
// spec.ridgeMode: "max" (default) or "centroid" (center of the part above half maximum, for broad flat-topped lights)
// spec.ridge: channel that locates the ridge, "Y" (linear luminance, default) or "b" (Oklab b)
// spec.profile: channel measured along the normal, "Y" (default) or "b"
// spec.groups: optional [{ name, t: [t0, t1] }] to report parts of the ridge separately
// spec.maxDist: profile length on each side, fraction of the short side

export function measureGlow(im, spec) {
  const S = Math.min(im.W, im.H);
  const ridgeSrc = spec.ridge === "b" ? channel(im.lab, 2, im.N) : im.Y;
  const maps = { coarse: gaussianBlur(ridgeSrc, im.W, im.H, 2), fine: gaussianBlur(ridgeSrc, im.W, im.H, 0.7) };
  const findRidge = (sd) => (spec.ridgeMode === "centroid" ? findRidgeCentroid(maps, im, sd) : findRidgePoint(maps, im, sd));

  let seeds = makeSeeds(im, spec.seeds, S);
  let ridge = seeds.map(findRidge).filter(Boolean);
  let circle = null;
  if (spec.seeds.kind === "rays" && spec.seeds.fitCircle && ridge.length >= 5) {
    circle = fitCircle(ridge.map((p) => [p.x, p.y]));
    const refined = {
      ...spec.seeds,
      center: [circle.cx / im.W, circle.cy / im.H],
      r: [(circle.r * 0.8) / S, (circle.r * 1.2) / S],
    };
    seeds = makeSeeds(im, refined, S);
    ridge = seeds.map(findRidge).filter(Boolean);
  }
  if (spec.seeds.kind !== "rays") {
    if (spec.ridgeFit === "line") fitRidgeLine(ridge, spec.seeds.kind);
    else assignNormals(ridge, spec.seeds.kind);
  }

  const maxD = Math.round((spec.maxDist ?? 0.5) * S);
  const groups = spec.groups ?? [{ name: "all", t: [0, 1] }];
  const results = [];
  for (const g of groups) {
    const pts = ridge.filter((p) => p.t >= g.t[0] && p.t <= g.t[1]);
    if (pts.length < 3) continue;
    for (const sign of [-1, 1]) {
      const side = sideName(spec.seeds.kind, pts, sign);
      const prof = medianProfile(im, pts, sign, maxD, spec.profile ?? "Y");
      const res = analyzeProfile(prof, S);
      if (!res) continue;
      results.push({ name: spec.name, group: g.name, side, ridgePoints: pts.length, ...res });
    }
  }
  return {
    name: spec.name,
    ridgeChannel: spec.ridge ?? "Y",
    profileChannel: spec.profile ?? "Y",
    circle: circle ? { cx: round(circle.cx, 1), cy: round(circle.cy, 1), r: round(circle.r, 1), rShortSide: round(circle.r / S, 3) } : null,
    ridge: ridge.map((p) => [Math.round(p.x), Math.round(p.y)]),
    sides: results,
  };
}

function makeSeeds(im, s, S) {
  const out = [];
  if (s.kind === "rays") {
    const ranges = s.angles;
    const total = ranges.reduce((a, [a0, a1]) => a + (a1 - a0), 0);
    const cx = s.center[0] * im.W;
    const cy = s.center[1] * im.H;
    let done = 0;
    for (const [a0, a1] of ranges) {
      const n = Math.max(2, Math.round((s.count * (a1 - a0)) / total));
      for (let k = 0; k < n; k++) {
        const deg = a0 + ((a1 - a0) * k) / (n - 1);
        const a = (deg * Math.PI) / 180;
        const dx = Math.cos(a);
        const dy = Math.sin(a);
        const t = (done + ((a1 - a0) * k) / (n - 1)) / total;
        out.push({ t, x0: cx + dx * s.r[0] * S, y0: cy + dy * s.r[0] * S, x1: cx + dx * s.r[1] * S, y1: cy + dy * s.r[1] * S, ray: [dx, dy] });
      }
      done += a1 - a0;
    }
    return out;
  }
  for (let k = 0; k < s.count; k++) {
    const t = s.count === 1 ? 0.5 : k / (s.count - 1);
    if (s.kind === "rows") {
      const y = (s.from + t * (s.to - s.from)) * im.H;
      out.push({ t, x0: s.x[0] * im.W, y0: y, x1: s.x[1] * im.W, y1: y });
    } else if (s.kind === "cols") {
      const x = (s.from + t * (s.to - s.from)) * im.W;
      out.push({ t, x0: x, y0: s.y[0] * im.H, x1: x, y1: s.y[1] * im.H });
    } else {
      throw new Error(`unknown seed kind ${s.kind}`);
    }
  }
  return out;
}

// Straight ridge: least-squares line through the ridge points (one pass of outlier removal).
function fitRidgeLine(pts, kind) {
  const u = (p) => (kind === "rows" ? p.y : p.x);
  const v = (p) => (kind === "rows" ? p.x : p.y);
  const fit = (list) => {
    const n = list.length;
    const mu = list.reduce((s, p) => s + u(p), 0) / n;
    const mv = list.reduce((s, p) => s + v(p), 0) / n;
    let suu = 0;
    let suv = 0;
    for (const p of list) {
      suu += (u(p) - mu) ** 2;
      suv += (u(p) - mu) * (v(p) - mv);
    }
    const b = suu ? suv / suu : 0;
    return { a: mv - b * mu, b };
  };
  let line = fit(pts);
  const res = pts.map((p) => Math.abs(v(p) - (line.a + line.b * u(p))));
  const cut = res.slice().sort((x, y) => x - y)[Math.floor(res.length * 0.8)] * 1.5 + 1;
  const kept = pts.filter((_, i) => res[i] <= cut);
  if (kept.length >= 3) line = fit(kept);
  // Direction along the ridge in (x, y), then its normal pointing +x (rows) or +y (cols).
  const dir = kind === "rows" ? [line.b, 1] : [1, line.b];
  const len = Math.hypot(dir[0], dir[1]);
  let nx = -dir[1] / len;
  let ny = dir[0] / len;
  if (kind === "rows" ? nx < 0 : ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  for (const p of pts) {
    if (kind === "rows") p.x = line.a + line.b * p.y;
    else p.y = line.a + line.b * p.x;
    p.n = [nx, ny];
  }
}

function sample1(map, W, H, x, y) {
  if (x < 0 || y < 0 || x > W - 1 || y > H - 1) return NaN;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(W - 1, x0 + 1);
  const y1 = Math.min(H - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  return (map[y0 * W + x0] * (1 - fx) + map[y0 * W + x1] * fx) * (1 - fy) + (map[y1 * W + x0] * (1 - fx) + map[y1 * W + x1] * fx) * fy;
}

function sampleLin(im, x, y) {
  if (x < 0 || y < 0 || x > im.W - 1 || y > im.H - 1) return null;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(im.W - 1, x0 + 1);
  const y1 = Math.min(im.H - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const v00 = im.lin[(y0 * im.W + x0) * 3 + c];
    const v10 = im.lin[(y0 * im.W + x1) * 3 + c];
    const v01 = im.lin[(y1 * im.W + x0) * 3 + c];
    const v11 = im.lin[(y1 * im.W + x1) * 3 + c];
    out[c] = (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy;
  }
  return out;
}

// Coarse maximum on a blurred map, then refined to sub-pixel on a lightly blurred one.
function findRidgePoint(maps, im, sd) {
  const len = Math.hypot(sd.x1 - sd.x0, sd.y1 - sd.y0);
  const n = Math.max(2, Math.round(len));
  const ux = (sd.x1 - sd.x0) / len;
  const uy = (sd.y1 - sd.y0) / len;
  let best = null;
  for (let i = 0; i <= n; i++) {
    const x = sd.x0 + ((sd.x1 - sd.x0) * i) / n;
    const y = sd.y0 + ((sd.y1 - sd.y0) * i) / n;
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= im.W || yi >= im.H || im.mask[yi * im.W + xi]) continue;
    const v = sample1(maps.coarse, im.W, im.H, x, y);
    if (Number.isNaN(v)) continue;
    if (!best || v > best.v) best = { x, y, v };
  }
  if (!best) return null;
  let fine = { s: 0, v: -Infinity };
  for (let s = -4; s <= 4; s += 0.25) {
    const v = sample1(maps.fine, im.W, im.H, best.x + ux * s, best.y + uy * s);
    if (v > fine.v) fine = { s, v };
  }
  const p = { t: sd.t, x: best.x + ux * fine.s, y: best.y + uy * fine.s };
  if (sd.ray) p.n = sd.ray;
  return p;
}

function findRidgeCentroid(maps, im, sd) {
  const len = Math.hypot(sd.x1 - sd.x0, sd.y1 - sd.y0);
  const n = Math.max(2, Math.round(len));
  const vals = [];
  for (let i = 0; i <= n; i++) {
    const x = sd.x0 + ((sd.x1 - sd.x0) * i) / n;
    const y = sd.y0 + ((sd.y1 - sd.y0) * i) / n;
    vals.push({ x, y, v: sample1(maps.coarse, im.W, im.H, x, y) });
  }
  const ok = vals.filter((p) => !Number.isNaN(p.v));
  if (!ok.length) return null;
  const lo = Math.min(...ok.map((p) => p.v));
  const hi = Math.max(...ok.map((p) => p.v));
  const thr = lo + 0.5 * (hi - lo);
  let sw = 0;
  let sx = 0;
  let sy = 0;
  for (const p of ok) {
    if (p.v < thr) continue;
    sw += p.v - thr;
    sx += (p.v - thr) * p.x;
    sy += (p.v - thr) * p.y;
  }
  if (!sw) return null;
  const pt = { t: sd.t, x: sx / sw, y: sy / sw };
  if (sd.ray) pt.n = sd.ray;
  return pt;
}

function assignNormals(pts, kind) {
  for (let i = 0; i < pts.length; i++) {
    const nb = pts.slice(Math.max(0, i - 2), Math.min(pts.length, i + 3));
    const mx = nb.reduce((s, p) => s + p.x, 0) / nb.length;
    const my = nb.reduce((s, p) => s + p.y, 0) / nb.length;
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    for (const p of nb) {
      sxx += (p.x - mx) ** 2;
      sxy += (p.x - mx) * (p.y - my);
      syy += (p.y - my) ** 2;
    }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    let tx = Math.cos(ang);
    let ty = Math.sin(ang);
    if (sxx + syy < 1e-6) [tx, ty] = kind === "rows" ? [0, 1] : [1, 0];
    let nx = -ty;
    let ny = tx;
    if (kind === "rows" ? nx < 0 : ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    pts[i].n = [nx, ny];
  }
}

function sideName(kind, pts, sign) {
  if (kind === "rays") return sign > 0 ? "outer" : "inner";
  const nx = pts.reduce((s, p) => s + p.n[0], 0) * sign;
  const ny = pts.reduce((s, p) => s + p.n[1], 0) * sign;
  if (Math.abs(nx) >= Math.abs(ny)) return nx > 0 ? "right" : "left";
  return ny > 0 ? "below" : "above";
}

function medianProfile(im, pts, sign, maxD, profileChannel) {
  const Y = [];
  const rgb = [];
  for (let d = 0; d <= maxD; d++) {
    const ys = [];
    const cs = [[], [], []];
    for (const p of pts) {
      const x = p.x + sign * p.n[0] * d;
      const y = p.y + sign * p.n[1] * d;
      const xi = Math.round(x);
      const yi = Math.round(y);
      if (xi < 0 || yi < 0 || xi >= im.W || yi >= im.H || im.mask[yi * im.W + xi]) continue;
      const c = sampleLin(im, x, y);
      if (!c) continue;
      ys.push(profileChannel === "b" ? linearRgbToOklab(Math.max(0, c[0]), Math.max(0, c[1]), Math.max(0, c[2]))[2] : 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]);
      for (let k = 0; k < 3; k++) cs[k].push(c[k]);
    }
    if (ys.length < Math.max(3, pts.length * 0.4)) break;
    Y.push(median(ys));
    rgb.push(cs.map(median));
  }
  return { Y, rgb };
}

function median(a) {
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function analyzeProfile({ Y, rgb }, S) {
  if (Y.length < 12) return null;
  const peak = Math.max(...Y.slice(0, 4));
  const floor = Math.min(...Y);
  if (peak - floor < 1e-4) return null;
  const f = Y.map((v) => Math.max(0, (v - floor) / (peak - floor)));
  const cross = (level) => {
    for (let d = 1; d < f.length; d++) {
      if (f[d] < level) return d - 1 + (f[d - 1] - level) / Math.max(1e-9, f[d - 1] - f[d]);
    }
    return null;
  };
  const d50 = cross(0.5);
  const d10 = cross(0.1);
  const d01 = cross(0.01);
  let fitEnd = f.length - 1;
  for (let d = 1; d < f.length; d++) {
    if (f[d] < 0.002) {
      fitEnd = d;
      break;
    }
  }
  const fitF = f.slice(0, fitEnd + 1);
  const g2 = fitGaussians(fitF, 2, S);
  const g3 = fitGaussians(fitF, 3, S);
  const pl = fitPowerLaw(fitF, S);

  const colorAt = (d) => {
    if (d === null) return null;
    const i = Math.min(rgb.length - 1, Math.max(0, Math.round(d)));
    const [r, g, b] = rgb[i];
    const o = linearRgbToOklab(Math.max(0, r), Math.max(0, g), Math.max(0, b));
    return { dShortSide: round(i / S, 4), hex: linearRgbToHex(Math.max(0, r), Math.max(0, g), Math.max(0, b)), L: round(o[0], 4), C: round(chroma(o[1], o[2]), 4), h: round(hueDegrees(o[1], o[2]), 1) };
  };
  const frac = (d) => (d === null ? null : round(d / S, 4));
  const logSamples = [];
  for (let k = 0; k <= 40; k++) {
    const d = Math.round(Math.expm1((Math.log1p(f.length - 1) * k) / 40));
    if (!logSamples.length || logSamples[logSamples.length - 1][0] !== round(d / S, 5)) logSamples.push([round(d / S, 5), round(f[d], 5)]);
  }
  return {
    profileLengthShortSide: round((f.length - 1) / S, 4),
    peak: round(peak, 4),
    floor: round(floor, 5),
    peakToFloor: floor > 0 ? round(peak / Math.max(1e-5, floor), 1) : null,
    d50ShortSide: frac(d50),
    d10ShortSide: frac(d10),
    d01ShortSide: frac(d01),
    d50Px: d50 === null ? null : round(d50, 1),
    gauss2: g2,
    gauss3: g3,
    powerLaw: pl,
    colors: [colorAt(0), colorAt(d50), colorAt(d10), colorAt(d01 ?? (d10 === null ? null : d10 * 2))].filter(Boolean),
    normalizedProfile: logSamples,
  };
}

function sigmaGrid(S) {
  const out = [];
  const lo = Math.log(0.5);
  const hi = Math.log(S * 0.8);
  for (let k = 0; k < 40; k++) out.push(Math.exp(lo + ((hi - lo) * k) / 39));
  return out;
}

// Weighted least squares favoring the tail: residuals are divided by (f + 0.01).
function fitGaussians(f, K, S) {
  const sig = sigmaGrid(S);
  const n = f.length;
  const w2 = f.map((v) => 1 / (v + 0.01) ** 2);
  const basis = sig.map((s) => f.map((_, d) => Math.exp((-d * d) / (2 * s * s))));
  const G = sig.map((_, i) => sig.map((__, j) => {
    let a = 0;
    for (let d = 0; d < n; d++) a += w2[d] * basis[i][d] * basis[j][d];
    return a;
  }));
  const bvec = sig.map((_, i) => {
    let a = 0;
    for (let d = 0; d < n; d++) a += w2[d] * basis[i][d] * f[d];
    return a;
  });
  let fTf = 0;
  for (let d = 0; d < n; d++) fTf += w2[d] * f[d] * f[d];

  let best = null;
  const combos = [];
  const rec = (start, picked) => {
    if (picked.length === K) {
      combos.push(picked.slice());
      return;
    }
    for (let i = start; i < sig.length; i++) {
      picked.push(i);
      rec(i + 1, picked);
      picked.pop();
    }
  };
  rec(0, []);
  for (const combo of combos) {
    const sol = nnlsSmall(combo.map((i) => combo.map((j) => G[i][j])), combo.map((i) => bvec[i]));
    if (!sol) continue;
    // weighted SSE = fTf - 2 c.b + c.G.c
    let cb = 0;
    let cGc = 0;
    for (let a = 0; a < K; a++) {
      cb += sol[a] * bvec[combo[a]];
      for (let b = 0; b < K; b++) cGc += sol[a] * sol[b] * G[combo[a]][combo[b]];
    }
    const sse = fTf - 2 * cb + cGc;
    if (!best || sse < best.sse) best = { sse, combo, sol };
  }
  if (!best) return null;
  const total = best.sol.reduce((a, b) => a + b, 0);
  return {
    components: best.combo
      .map((i, a) => ({ sigmaShortSide: round(sig[i] / S, 5), sigmaPx: round(sig[i], 2), weight: round(best.sol[a] / total, 4), amplitude: round(best.sol[a], 4) }))
      .filter((c) => c.amplitude > 0)
      .sort((x, y) => x.sigmaPx - y.sigmaPx),
    relRms: round(Math.sqrt(Math.max(0, best.sse) / n), 4),
  };
}

// Non-negative least squares for 2-3 unknowns by trying every active set.
function nnlsSmall(G, b) {
  const K = b.length;
  let best = null;
  for (let mask = 1; mask < 1 << K; mask++) {
    const idx = [];
    for (let i = 0; i < K; i++) if (mask & (1 << i)) idx.push(i);
    const sub = solve(idx.map((i) => idx.map((j) => G[i][j])), idx.map((i) => b[i]));
    if (!sub || sub.some((v) => v < 0)) continue;
    const x = new Array(K).fill(0);
    idx.forEach((i, a) => (x[i] = sub[a]));
    let val = 0;
    for (let i = 0; i < K; i++) {
      val -= 2 * x[i] * b[i];
      for (let j = 0; j < K; j++) val += x[i] * x[j] * G[i][j];
    }
    if (!best || val < best.val) best = { val, x };
  }
  return best ? best.x : null;
}

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  return M.map((row, i) => row[n] / M[i][i]);
}

// f(d) = 1 / (1 + (d / d0)^n)
function fitPowerLaw(f, S) {
  const n = f.length;
  let best = null;
  const lo = Math.log(0.5);
  const hi = Math.log(S * 0.6);
  for (let a = 0; a < 60; a++) {
    const d0 = Math.exp(lo + ((hi - lo) * a) / 59);
    for (let e = 0.5; e <= 6.001; e += 0.1) {
      let sse = 0;
      for (let d = 0; d < n; d++) {
        const m = 1 / (1 + (d / d0) ** e);
        sse += ((m - f[d]) / (f[d] + 0.01)) ** 2;
      }
      if (!best || sse < best.sse) best = { sse, d0, e };
    }
  }
  return { d0ShortSide: round(best.d0 / S, 5), d0Px: round(best.d0, 2), exponent: round(best.e, 2), relRms: round(Math.sqrt(best.sse / n), 4) };
}

function fitCircle(pts) {
  // Algebraic (Kasa) fit: x^2 + y^2 + D x + E y + F = 0.
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let sxz = 0;
  let syz = 0;
  let sz = 0;
  for (const [x, y] of pts) {
    const z = x * x + y * y;
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
    sxz += x * z;
    syz += y * z;
    sz += z;
  }
  const n = pts.length;
  const sol = solve(
    [
      [sxx, sxy, sx],
      [sxy, syy, sy],
      [sx, sy, n],
    ],
    [-sxz, -syz, -sz],
  );
  const [D, E, F] = sol;
  const cx = -D / 2;
  const cy = -E / 2;
  return { cx, cy, r: Math.sqrt(Math.max(0, cx * cx + cy * cy - F)) };
}
