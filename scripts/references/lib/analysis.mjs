import { chroma, hueDegrees, linearRgbToHex, linearRgbToOklab, oklabToHex, srgb8ToLinear } from "./color.mjs";

// ---------- image setup ----------

export function prepare(img, ignore) {
  const W = img.width;
  const H = img.height;
  const N = W * H;
  const lin = new Float32Array(N * 3);
  const lab = new Float32Array(N * 3);
  const Y = new Float32Array(N);
  const luma8 = new Float32Array(N);
  const mask = new Uint8Array(N);
  for (const { rect } of ignore) {
    const [rx, ry, rw, rh] = rect;
    for (let y = Math.max(0, ry); y < Math.min(H, ry + rh); y++) {
      for (let x = Math.max(0, rx); x < Math.min(W, rx + rw); x++) mask[y * W + x] = 1;
    }
  }
  for (let i = 0; i < N; i++) {
    const r8 = img.data[i * 3];
    const g8 = img.data[i * 3 + 1];
    const b8 = img.data[i * 3 + 2];
    const r = srgb8ToLinear(r8);
    const g = srgb8ToLinear(g8);
    const b = srgb8ToLinear(b8);
    lin[i * 3] = r;
    lin[i * 3 + 1] = g;
    lin[i * 3 + 2] = b;
    const o = linearRgbToOklab(r, g, b);
    lab[i * 3] = o[0];
    lab[i * 3 + 1] = o[1];
    lab[i * 3 + 2] = o[2];
    Y[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    luma8[i] = 0.2126 * r8 + 0.7152 * g8 + 0.0722 * b8;
  }
  return { W, H, N, rgb8: img.data, lin, lab, Y, luma8, mask };
}

// Block average in linear light. Blocks that are mostly ignored are masked.
export function downsample(im, f) {
  const w = Math.floor(im.W / f);
  const h = Math.floor(im.H / f);
  const lin = new Float32Array(w * h * 3);
  const lab = new Float32Array(w * h * 3);
  const mask = new Uint8Array(w * h);
  for (let by = 0; by < h; by++) {
    for (let bx = 0; bx < w; bx++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = by * f; y < (by + 1) * f; y++) {
        for (let x = bx * f; x < (bx + 1) * f; x++) {
          const i = y * im.W + x;
          if (im.mask[i]) continue;
          r += im.lin[i * 3];
          g += im.lin[i * 3 + 1];
          b += im.lin[i * 3 + 2];
          n++;
        }
      }
      const j = by * w + bx;
      if (n < (f * f) / 2) {
        mask[j] = 1;
        continue;
      }
      lin[j * 3] = r / n;
      lin[j * 3 + 1] = g / n;
      lin[j * 3 + 2] = b / n;
      const o = linearRgbToOklab(r / n, g / n, b / n);
      lab[j * 3] = o[0];
      lab[j * 3 + 1] = o[1];
      lab[j * 3 + 2] = o[2];
    }
  }
  return { w, h, f, lin, lab, mask };
}

export function gaussianBlur(src, W, H, sigma) {
  const r = Math.ceil(sigma * 3);
  const k = new Float32Array(2 * r + 1);
  let s = 0;
  for (let i = -r; i <= r; i++) {
    k[i + r] = Math.exp((-i * i) / (2 * sigma * sigma));
    s += k[i + r];
  }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const tmp = new Float32Array(W * H);
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) {
        const xx = x + i < 0 ? 0 : x + i >= W ? W - 1 : x + i;
        a += k[i + r] * src[row + xx];
      }
      tmp[row + x] = a;
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) {
        const yy = y + i < 0 ? 0 : y + i >= H ? H - 1 : y + i;
        a += k[i + r] * tmp[yy * W + x];
      }
      out[y * W + x] = a;
    }
  }
  return out;
}

export function channel(arr, c, n) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = arr[i * 3 + c];
  return out;
}

function colorRecord(r, g, b) {
  const o = linearRgbToOklab(Math.max(0, r), Math.max(0, g), Math.max(0, b));
  return {
    hex: linearRgbToHex(Math.max(0, r), Math.max(0, g), Math.max(0, b)),
    oklab: o.map((v) => round(v, 4)),
    L: round(o[0], 4),
    C: round(chroma(o[1], o[2]), 4),
    h: round(hueDegrees(o[1], o[2]), 1),
  };
}

function labRecord(L, a, b) {
  return {
    hex: oklabToHex(L, a, b),
    oklab: [round(L, 4), round(a, 4), round(b, 4)],
    L: round(L, 4),
    C: round(chroma(a, b), 4),
    h: round(hueDegrees(a, b), 1),
  };
}

export function round(v, d = 3) {
  const m = 10 ** d;
  return Math.round(v * m) / m;
}

// ---------- axis geometry ----------

export function axisFrame(w, h, angleDeg) {
  const t = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(t);
  const dy = Math.sin(t);
  const cx = w / 2;
  const cy = h / 2;
  const corners = [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
  ];
  // q is across the axis: left to right for a downward axis, bottom to top for a rightward one.
  const ps = corners.map(([x, y]) => (x - cx) * dx + (y - cy) * dy);
  const qs = corners.map(([x, y]) => (x - cx) * dy - (y - cy) * dx);
  return {
    dx,
    dy,
    cx,
    cy,
    pMin: Math.min(...ps),
    pMax: Math.max(...ps),
    qMin: Math.min(...qs),
    qMax: Math.max(...qs),
    p: (x, y) => (x - cx) * dx + (y - cy) * dy,
    q: (x, y) => (x - cx) * dy - (y - cy) * dx,
  };
}

// Finds the direction along which the image is best explained by a 1D ramp.
export function findAxis(grid) {
  const { w, h, lab, mask } = grid;
  const evalAngle = (deg) => {
    const fr = axisFrame(w, h, deg);
    const nb = 48;
    const sums = new Float64Array(nb * 3);
    const sq = new Float64Array(nb);
    const cnt = new Float64Array(nb);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (mask[i]) continue;
        const p = fr.p(x + 0.5, y + 0.5);
        const bIdx = Math.min(nb - 1, Math.floor(((p - fr.pMin) / (fr.pMax - fr.pMin)) * nb));
        const L = lab[i * 3];
        const a = lab[i * 3 + 1];
        const b = lab[i * 3 + 2];
        sums[bIdx * 3] += L;
        sums[bIdx * 3 + 1] += a;
        sums[bIdx * 3 + 2] += b;
        sq[bIdx] += L * L + a * a + b * b;
        cnt[bIdx]++;
      }
    }
    let ssRes = 0;
    for (let k = 0; k < nb; k++) {
      if (!cnt[k]) continue;
      const m2 = (sums[k * 3] ** 2 + sums[k * 3 + 1] ** 2 + sums[k * 3 + 2] ** 2) / cnt[k];
      ssRes += sq[k] - m2;
    }
    return ssRes;
  };
  let ssTot = 0;
  {
    let n = 0;
    const m = [0, 0, 0];
    for (let i = 0; i < w * h; i++) {
      if (mask[i]) continue;
      for (let c = 0; c < 3; c++) m[c] += lab[i * 3 + c];
      n++;
    }
    for (let c = 0; c < 3; c++) m[c] /= n;
    for (let i = 0; i < w * h; i++) {
      if (mask[i]) continue;
      for (let c = 0; c < 3; c++) ssTot += (lab[i * 3 + c] - m[c]) ** 2;
    }
  }
  let best = { deg: 0, ss: Infinity };
  for (let deg = 0; deg < 180; deg += 2) {
    const ss = evalAngle(deg);
    if (ss < best.ss) best = { deg, ss };
  }
  for (let deg = best.deg - 2; deg <= best.deg + 2; deg += 0.25) {
    const ss = evalAngle(deg);
    if (ss < best.ss) best = { deg, ss };
  }
  let deg = ((best.deg % 180) + 180) % 180;
  // Point the axis toward the bottom of the frame (toward the right when level).
  if (deg >= 179.5) deg -= 180;
  return { angleDeg: round(deg, 2), r2: round(1 - best.ss / ssTot, 4), ssTot };
}

// Mean color per bin along p, restricted to a lateral band [q0, q1) when given.
export function profileAlongAxis(grid, fr, nb, q0 = -Infinity, q1 = Infinity) {
  const { w, h, lin, mask } = grid;
  const sums = new Float64Array(nb * 3);
  const cnt = new Float64Array(nb);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (mask[i]) continue;
      const q = fr.q(x + 0.5, y + 0.5);
      if (q < q0 || q >= q1) continue;
      const p = fr.p(x + 0.5, y + 0.5);
      const k = Math.min(nb - 1, Math.floor(((p - fr.pMin) / (fr.pMax - fr.pMin)) * nb));
      sums[k * 3] += lin[i * 3];
      sums[k * 3 + 1] += lin[i * 3 + 1];
      sums[k * 3 + 2] += lin[i * 3 + 2];
      cnt[k]++;
    }
  }
  const out = [];
  for (let k = 0; k < nb; k++) {
    if (cnt[k] < 2) {
      out.push(null);
      continue;
    }
    const r = sums[k * 3] / cnt[k];
    const g = sums[k * 3 + 1] / cnt[k];
    const b = sums[k * 3 + 2] / cnt[k];
    out.push({ t: (k + 0.5) / nb, lin: [r, g, b], lab: linearRgbToOklab(r, g, b), n: cnt[k] });
  }
  return out;
}

function fillGaps(profile) {
  const out = profile.slice();
  for (let k = 0; k < out.length; k++) {
    if (out[k]) continue;
    let a = k - 1;
    while (a >= 0 && !out[a]) a--;
    let b = k + 1;
    while (b < out.length && !profile[b]) b++;
    const src = a >= 0 ? out[a] : profile[b];
    if (src) out[k] = { ...src, t: (k + 0.5) / out.length, filled: true };
  }
  return out;
}

function smoothLab(profile, sigmaBins) {
  const n = profile.length;
  const out = [];
  const r = Math.ceil(sigmaBins * 3);
  for (let k = 0; k < n; k++) {
    const acc = [0, 0, 0];
    let ws = 0;
    for (let j = -r; j <= r; j++) {
      const m = k + j;
      if (m < 0 || m >= n || !profile[m]) continue;
      const wgt = Math.exp((-j * j) / (2 * sigmaBins * sigmaBins));
      for (let c = 0; c < 3; c++) acc[c] += wgt * profile[m].lab[c];
      ws += wgt;
    }
    out.push(ws ? acc.map((v) => v / ws) : null);
  }
  return out;
}

const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// Douglas-Peucker on the Oklab curve, measuring the gap to linear-in-Oklab interpolation.
function simplify(labs, eps) {
  const keep = new Set([0, labs.length - 1]);
  const rec = (i0, i1) => {
    let worst = -1;
    let wd = 0;
    for (let k = i0 + 1; k < i1; k++) {
      const t = (k - i0) / (i1 - i0);
      const interp = [0, 1, 2].map((c) => labs[i0][c] + t * (labs[i1][c] - labs[i0][c]));
      const d = dist3(labs[k], interp);
      if (d > wd) {
        wd = d;
        worst = k;
      }
    }
    if (worst >= 0 && wd > eps) {
      keep.add(worst);
      rec(i0, worst);
      rec(worst, i1);
    }
  };
  rec(0, labs.length - 1);
  return [...keep].sort((a, b) => a - b);
}

// ---------- stops and transitions ----------

export function analyzeRamp(grid, fr, opts = {}) {
  const axisLen = fr.pMax - fr.pMin;
  const nb = Math.max(32, Math.min(400, Math.round(axisLen / 2)));
  const raw = fillGaps(profileAlongAxis(grid, fr, nb));
  const labs = smoothLab(raw, 1);
  const eps = opts.eps ?? 0.025;
  const keys = simplify(labs, eps);

  // Merge neighboring key points closer than eps (a plateau, or a wobble at a frame edge).
  const groups = [];
  for (const k of keys) {
    const last = groups[groups.length - 1];
    if (last && dist3(labs[last[last.length - 1]], labs[k]) < eps) last.push(k);
    else groups.push([k]);
  }
  const stops = groups.map((g) => {
    const k0 = g[0];
    const k1 = g[g.length - 1];
    const lab = [0, 1, 2].map((c) => g.reduce((s, k) => s + labs[k][c], 0) / g.length);
    return { k: Math.round((k0 + k1) / 2), k0, k1, lab };
  });

  const binToT = (k) => (k + 0.5) / nb;
  const stopsOut = stops.map((s) => ({
    pos: round(binToT(s.k), 4),
    range: [round(binToT(s.k0), 4), round(binToT(s.k1), 4)],
    ...labRecord(...s.lab),
  }));

  const transitions = [];
  for (let i = 0; i + 1 < stops.length; i++) {
    const A = stops[i];
    const B = stops[i + 1];
    transitions.push(measureTransition(labs, nb, A, B, fr, grid, i));
  }

  // A stop lighter than both neighbors bridges them.
  const bridges = [];
  for (let i = 1; i + 1 < stops.length; i++) {
    const L = stops[i].lab[0];
    const La = stops[i - 1].lab[0];
    const Lb = stops[i + 1].lab[0];
    if (L > La + 0.005 && L > Lb + 0.005) {
      bridges.push({ stop: i, pos: stopsOut[i].pos, hex: stopsOut[i].hex, L: round(L, 4), neighborsL: [round(La, 4), round(Lb, 4)] });
    }
  }

  const profile = labs.map((l, k) => (l ? { t: round(binToT(k), 4), ...labRecord(...l) } : null));
  return { bins: nb, eps, stops: stopsOut, transitions, bridges, profile, labs };
}

function progressAt(lab, A, B) {
  const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
  const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  return ((lab[0] - A[0]) * d[0] + (lab[1] - A[1]) * d[1] + (lab[2] - A[2]) * d[2]) / dd;
}

function crossing(labs, k0, k1, A, B, level) {
  // First bin where progress reaches `level`, scanning from the A side, interpolated.
  let prev = null;
  for (let k = k0; k <= k1; k++) {
    if (!labs[k]) continue;
    const s = progressAt(labs[k], A, B);
    if (prev && prev.s < level && s >= level) {
      const f = (level - prev.s) / (s - prev.s);
      return prev.k + f * (k - prev.k);
    }
    if (!prev && s >= level) return k;
    prev = { k, s };
  }
  return null;
}

function mixLinear(Alab, Blab, t) {
  const toLin = (lab) => labToLin(lab);
  const a = toLin(Alab);
  const b = toLin(Blab);
  return linearRgbToOklab(...a.map((v, c) => v + t * (b[c] - v)));
}

function mixSrgb(Alab, Blab, t) {
  const enc = (l) => (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);
  const dec = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const a = labToLin(Alab).map((v) => enc(Math.max(0, v)));
  const b = labToLin(Blab).map((v) => enc(Math.max(0, v)));
  return linearRgbToOklab(...a.map((v, c) => dec(v + t * (b[c] - v))));
}

function labToLin([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

// Mix ratio at which a blend reaches Oklab progress 0.5 from A to B.
function mixAtHalfProgress(mixFn, A, B) {
  let lo = 0;
  let hi = 1;
  for (let it = 0; it < 40; it++) {
    const mid = (lo + hi) / 2;
    if (progressAt(mixFn(A, B, mid), A, B) < 0.5) lo = mid;
    else hi = mid;
  }
  const t = (lo + hi) / 2;
  return { t, lab: mixFn(A, B, t) };
}

function measureTransition(labs, nb, A, B, fr, grid, index) {
  const axisLen = fr.pMax - fr.pMin;
  const frameH = grid.h;
  const k0 = A.k;
  const k1 = B.k;
  const c10 = crossing(labs, k0, k1, A.lab, B.lab, 0.1);
  const c50 = crossing(labs, k0, k1, A.lab, B.lab, 0.5);
  const c90 = crossing(labs, k0, k1, A.lab, B.lab, 0.9);
  const toT = (k) => (k + 0.5) / nb;
  const binPx = axisLen / nb;

  const out = { index, from: index, to: index + 1 };
  if (c10 !== null && c90 !== null) {
    out.mid = round(toT(c50 ?? (c10 + c90) / 2), 4);
    out.p10 = round(toT(c10), 4);
    out.p90 = round(toT(c90), 4);
    out.width1090Axis = round(((c90 - c10) * binPx) / axisLen, 4);
    out.width1090FrameH = round(((c90 - c10) * binPx) / frameH, 4);
  }
  const deltaE = dist3(A.lab, B.lab);
  out.deltaE = round(deltaE, 4);

  // Midpoint of the real transition vs blends at the same progress.
  if (c50 !== null) {
    const ki = Math.round(c50);
    const real = labs[ki];
    const lin = mixAtHalfProgress(mixLinear, A.lab, B.lab);
    const srgb = mixAtHalfProgress(mixSrgb, A.lab, B.lab);
    const C = (l) => chroma(l[1], l[2]);
    out.midpoint = labRecord(...real);
    out.linearLightMix = { ratio: round(lin.t, 3), ...labRecord(...lin.lab) };
    out.srgbMix = { ratio: round(srgb.t, 3), ...labRecord(...srgb.lab) };
    out.midLighterThanBoth = real[0] > Math.max(A.lab[0], B.lab[0]) + 0.003;
    out.midDarkerThanBoth = real[0] < Math.min(A.lab[0], B.lab[0]) - 0.003;
    // Ratios are unstable when both ends are near grey; the differences are not.
    out.midChromaVsLinearMix = round(C(real) / Math.max(1e-4, C(lin.lab)), 3);
    out.midChromaVsSrgbMix = round(C(real) / Math.max(1e-4, C(srgb.lab)), 3);
    out.midChromaMinusLinearMix = round(C(real) - C(lin.lab), 4);
    out.midChromaMinusSrgbMix = round(C(real) - C(srgb.lab), 4);
    out.midLVsLinearMix = round(real[0] - lin.lab[0], 4);
    out.midLVsSrgbMix = round(real[0] - srgb.lab[0], 4);
  }

  // Largest departure from the straight Oklab line between the two colors.
  let worst = null;
  let peakC = null;
  let maxL = null;
  for (let k = k0; k <= k1; k++) {
    const l = labs[k];
    if (!l) continue;
    const s = Math.min(1, Math.max(0, progressAt(l, A.lab, B.lab)));
    const line = [0, 1, 2].map((c) => A.lab[c] + s * (B.lab[c] - A.lab[c]));
    const d = dist3(l, line);
    if (!worst || d > worst.d) worst = { k, d, l, dL: l[0] - line[0], dC: chroma(l[1], l[2]) - chroma(line[1], line[2]) };
    const c = chroma(l[1], l[2]);
    if (!peakC || c > peakC.c) peakC = { k, c, l };
    if (!maxL || l[0] > maxL.L) maxL = { k, L: l[0], l };
  }
  if (worst) {
    out.maxDeparture = {
      pos: round(toT(worst.k), 4),
      deltaE: round(worst.d, 4),
      dL: round(worst.dL, 4),
      dC: round(worst.dC, 4),
      ...labRecord(...worst.l),
    };
  }
  if (peakC) {
    const cA = chroma(A.lab[1], A.lab[2]);
    const cB = chroma(B.lab[1], B.lab[2]);
    out.peakChroma = { pos: round(toT(peakC.k), 4), C: round(peakC.c, 4), aboveBothEnds: peakC.c > Math.max(cA, cB) + 0.005, hex: oklabToHex(...peakC.l) };
  }
  if (maxL) {
    out.maxLInside = { pos: round(toT(maxL.k), 4), L: round(maxL.L, 4), aboveBothEnds: maxL.L > Math.max(A.lab[0], B.lab[0]) + 0.005, hex: oklabToHex(...maxL.l) };
  }
  return out;
}

// Per lateral strip: where each transition's midpoint sits, and how wide it is.
export function transitionShape(grid, fr, ramp, strips = 15) {
  const nb = ramp.bins;
  const axisLen = fr.pMax - fr.pMin;
  const binPx = axisLen / nb;
  const results = [];
  const stripProfiles = [];
  for (let s = 0; s < strips; s++) {
    const q0 = fr.qMin + ((fr.qMax - fr.qMin) * s) / strips;
    const q1 = fr.qMin + ((fr.qMax - fr.qMin) * (s + 1)) / strips;
    const prof = profileAlongAxis(grid, fr, nb, q0, q1);
    stripProfiles.push({ qc: (q0 + q1) / 2, labs: smoothLab(prof, 1) });
  }
  ramp.transitions.forEach((tr) => {
    const A = ramp.stops[tr.from].oklab;
    const B = ramp.stops[tr.to].oklab;
    const k0 = Math.max(0, Math.round(ramp.stops[tr.from].pos * nb - 0.5));
    const k1 = Math.min(nb - 1, Math.round(ramp.stops[tr.to].pos * nb - 0.5));
    const pts = [];
    for (const sp of stripProfiles) {
      const c10 = crossing(sp.labs, k0, k1, A, B, 0.1);
      const c50 = crossing(sp.labs, k0, k1, A, B, 0.5);
      const c90 = crossing(sp.labs, k0, k1, A, B, 0.9);
      if (c50 === null) continue;
      const qn = (2 * (sp.qc - fr.qMin)) / (fr.qMax - fr.qMin) - 1;
      pts.push({ qn, mid: (c50 + 0.5) * binPx, width: c10 !== null && c90 !== null ? (c90 - c10) * binPx : null });
    }
    if (pts.length < 5) {
      results.push({ index: tr.index, strips: pts.length });
      return;
    }
    const fit = polyfit2(pts.map((p) => p.qn), pts.map((p) => p.mid));
    const resid = pts.map((p) => p.mid - (fit[0] + fit[1] * p.qn + fit[2] * p.qn * p.qn));
    const rms = Math.sqrt(resid.reduce((s, r) => s + r * r, 0) / resid.length);
    const widths = pts.map((p) => p.width).filter((v) => v !== null).sort((a, b) => a - b);
    const H = grid.h;
    const halfLateral = (fr.qMax - fr.qMin) / 2;
    const bow = fit[2];
    results.push({
      index: tr.index,
      strips: pts.length,
      // Midpoint offset at the lateral edges relative to the center (positive: edges further along the axis).
      bowFrameH: round(bow / H, 4),
      tiltFrameH: round(fit[1] / H, 4),
      radiusFrameH: Math.abs(bow) > 1e-6 ? round((halfLateral * halfLateral) / (2 * Math.abs(bow)) / H, 2) : null,
      wavinessRmsFrameH: round(rms / H, 4),
      widthStripsFrameH: widths.length
        ? {
            min: round(widths[0] / H, 4),
            median: round(widths[Math.floor(widths.length / 2)] / H, 4),
            max: round(widths[widths.length - 1] / H, 4),
          }
        : null,
      midByStrip: pts.map((p) => [round(p.qn, 3), round((p.mid + fr.pMin) / H, 4)]),
    });
  });
  return results;
}

function polyfit2(xs, ys) {
  // Least squares y = c0 + c1 x + c2 x^2.
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  let s4 = 0;
  let t0 = 0;
  let t1 = 0;
  let t2 = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    const y = ys[i];
    s0 += 1;
    s1 += x;
    s2 += x * x;
    s3 += x ** 3;
    s4 += x ** 4;
    t0 += y;
    t1 += x * y;
    t2 += x * x * y;
  }
  const M = [
    [s0, s1, s2, t0],
    [s1, s2, s3, t1],
    [s2, s3, s4, t2],
  ];
  for (let c = 0; c < 3; c++) {
    let piv = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
    }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
}

// Lateral spread of color across the axis, per position along it.
export function lateralVariation(grid, fr, positions = 20) {
  const { w, h, lab, mask } = grid;
  const nb = positions;
  const sums = Array.from({ length: nb }, () => ({ n: 0, m: [0, 0, 0], s: [0, 0, 0] }));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (mask[i]) continue;
      const p = fr.p(x + 0.5, y + 0.5);
      const k = Math.min(nb - 1, Math.floor(((p - fr.pMin) / (fr.pMax - fr.pMin)) * nb));
      const e = sums[k];
      e.n++;
      for (let c = 0; c < 3; c++) {
        e.m[c] += lab[i * 3 + c];
        e.s[c] += lab[i * 3 + c] ** 2;
      }
    }
  }
  const per = sums.map((e, k) => {
    if (e.n < 4) return { t: round((k + 0.5) / nb, 3), std: null };
    let v = 0;
    for (let c = 0; c < 3; c++) {
      const m = e.m[c] / e.n;
      v += e.s[c] / e.n - m * m;
    }
    return { t: round((k + 0.5) / nb, 3), std: round(Math.sqrt(Math.max(0, v)), 4) };
  });
  const vals = per.map((p) => p.std).filter((v) => v !== null);
  return {
    meanStd: round(vals.reduce((a, b) => a + b, 0) / vals.length, 4),
    maxStd: round(Math.max(...vals), 4),
    perPosition: per,
  };
}

// ---------- samples, means, extremes ----------

export function axisSamples(im, angleDeg, stepPct = 5) {
  const fr = axisFrame(im.W, im.H, angleDeg);
  // Ends of the axis line through the frame center.
  const tHits = [];
  const { dx, dy, cx, cy } = fr;
  const lim = [];
  if (Math.abs(dx) > 1e-9) lim.push((0 - cx) / dx, (im.W - cx) / dx);
  if (Math.abs(dy) > 1e-9) lim.push((0 - cy) / dy, (im.H - cy) / dy);
  for (const t of lim) {
    const x = cx + t * dx;
    const y = cy + t * dy;
    if (x >= -1e-6 && x <= im.W + 1e-6 && y >= -1e-6 && y <= im.H + 1e-6) tHits.push(t);
  }
  const t0 = Math.min(...tHits);
  const t1 = Math.max(...tHits);
  const half = Math.max(4, Math.round(Math.min(im.W, im.H) * 0.012));
  const out = [];
  for (let pct = 0; pct <= 100; pct += stepPct) {
    const t = t0 + ((t1 - t0) * pct) / 100;
    let x = cx + t * dx;
    let y = cy + t * dy;
    let shifted = 0;
    let rec = windowMedian(im, x, y, half);
    // When the window is ignored, slide sideways (across the axis) to the nearest clean spot.
    for (let s = 1; !rec && s < 60; s++) {
      for (const sign of [1, -1]) {
        const xs = x + sign * s * half * -dy;
        const ys = y + sign * s * half * dx;
        rec = windowMedian(im, xs, ys, half);
        if (rec) {
          shifted = round((sign * s * half) / Math.min(im.W, im.H), 3);
          x = xs;
          y = ys;
          break;
        }
      }
    }
    out.push({ pct, x: Math.round(x), y: Math.round(y), shiftedShortSide: shifted, ...(rec ?? { hex: null }) });
  }
  return out;
}

function windowMedian(im, x, y, half) {
  const xs = Math.round(x);
  const ys = Math.round(y);
  const vals = [[], [], []];
  for (let yy = ys - half; yy <= ys + half; yy++) {
    if (yy < 0 || yy >= im.H) continue;
    for (let xx = xs - half; xx <= xs + half; xx++) {
      if (xx < 0 || xx >= im.W) continue;
      const i = yy * im.W + xx;
      if (im.mask[i]) continue;
      for (let c = 0; c < 3; c++) vals[c].push(im.rgb8[i * 3 + c]);
    }
  }
  if (vals[0].length < half) return null;
  const med = vals.map((v) => {
    v.sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  });
  return colorRecord(srgb8ToLinear(med[0]), srgb8ToLinear(med[1]), srgb8ToLinear(med[2]));
}

export function rowColumnMeans(im, samples = 64) {
  const rows = [];
  const cols = [];
  for (let k = 0; k < samples; k++) {
    const y0 = Math.floor((im.H * k) / samples);
    const y1 = Math.floor((im.H * (k + 1)) / samples);
    rows.push(meanRect(im, 0, y0, im.W, y1));
    const x0 = Math.floor((im.W * k) / samples);
    const x1 = Math.floor((im.W * (k + 1)) / samples);
    cols.push(meanRect(im, x0, 0, x1, im.H));
  }
  return { rows, cols };
}

function meanRect(im, x0, y0, x1, y1) {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * im.W + x;
      if (im.mask[i]) continue;
      r += im.lin[i * 3];
      g += im.lin[i * 3 + 1];
      b += im.lin[i * 3 + 2];
      n++;
    }
  }
  if (!n) return null;
  return colorRecord(r / n, g / n, b / n);
}

export function extremes(im) {
  const idx = [];
  for (let i = 0; i < im.N; i++) if (!im.mask[i]) idx.push(i);
  idx.sort((a, b) => im.lab[a * 3] - im.lab[b * 3]);
  const meanOf = (list) => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (const i of list) {
      r += im.lin[i * 3];
      g += im.lin[i * 3 + 1];
      b += im.lin[i * 3 + 2];
    }
    return colorRecord(r / list.length, g / list.length, b / list.length);
  };
  const nTop = Math.max(1, Math.round(idx.length * 0.005));
  const nBot = Math.max(1, Math.round(idx.length * 0.01));
  let any255 = 0;
  let all255 = 0;
  let any0 = 0;
  let all0 = 0;
  for (const i of idx) {
    const r = im.rgb8[i * 3];
    const g = im.rgb8[i * 3 + 1];
    const b = im.rgb8[i * 3 + 2];
    if (r === 255 || g === 255 || b === 255) any255++;
    if (r === 255 && g === 255 && b === 255) all255++;
    if (r === 0 || g === 0 || b === 0) any0++;
    if (r === 0 && g === 0 && b === 0) all0++;
  }
  const n = idx.length;
  const median = idx[Math.floor(n / 2)];
  return {
    brightest05: { ...meanOf(idx.slice(n - nTop)), thresholdL: round(im.lab[idx[n - nTop] * 3], 4) },
    darkest1: { ...meanOf(idx.slice(0, nBot)), thresholdL: round(im.lab[idx[nBot - 1] * 3], 4) },
    medianL: round(im.lab[median * 3], 4),
    shareAnyChannel255: round(any255 / n, 5),
    shareWhite255: round(all255 / n, 5),
    shareAnyChannel0: round(any0 / n, 5),
    shareBlack0: round(all0 / n, 5),
  };
}
