import { channel, gaussianBlur, round } from "./analysis.mjs";

// Grain is the high-pass residual: the image minus a blurred copy.
//
// mode "isotropic": gaussian blur in both directions (sigma px).
// mode "along-iso": blur only along the iso-color lines (perpendicular to the
//   main axis). A ramp is constant along those lines, so the ramp itself and
//   8-bit banding steps drop out and only grain is left.
//
// Pixels near ignore rects, near the frame border, and on strong structure
// (blurred L changing faster than gradLimit per px) are skipped.

export function grain(im, { mode = "isotropic", sigma = mode === "isotropic" ? 4 : 8, axisAngleDeg = 90, gradLimit = mode === "isotropic" ? 0.003 : 0.01 } = {}) {
  const { W, H, N } = im;
  const L = channel(im.lab, 0, N);
  const A = channel(im.lab, 1, N);
  const B = channel(im.lab, 2, N);
  const t = (axisAngleDeg * Math.PI) / 180;
  const across = [Math.cos(t), Math.sin(t)];
  const along = [-Math.sin(t), Math.cos(t)];
  const low = mode === "isotropic" ? (src) => gaussianBlur(src, W, H, sigma) : (src) => directionalBlur(src, W, H, along, sigma);
  const Lb = low(L);
  const Ab = low(A);
  const Bb = low(B);
  const Yb = low(im.luma8);
  const Lg = mode === "isotropic" ? Lb : gaussianBlur(L, W, H, 4);

  // Structure (steep areas) is grown by 2 sigma so the tops of thin bright ridges, where the slope is zero, are skipped too.
  const steep = new Uint8Array(N);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const gx = (Lg[i + 1] - Lg[i - 1]) / 2;
      const gy = (Lg[i + W] - Lg[i - W]) / 2;
      if (Math.hypot(gx, gy) > gradLimit) steep[i] = 1;
    }
  }
  const structure = growMask(steep, W, H, Math.ceil(2 * Math.min(sigma, 4)));
  const use = new Uint8Array(N);
  const margin = Math.ceil(3 * sigma);
  const grown = growMask(im.mask, W, H, margin);
  let used = 0;
  for (let y = margin; y < H - margin; y++) {
    for (let x = margin; x < W - margin; x++) {
      const i = y * W + x;
      if (grown[i] || structure[i]) continue;
      use[i] = 1;
      used++;
    }
  }

  const bins = Array.from({ length: 10 }, () => ({ n: 0, sL: 0, sC: 0, sY: 0 }));
  let vL = 0;
  let vA = 0;
  let vB = 0;
  let vY = 0;
  const rL = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (!use[i]) continue;
    const dL = L[i] - Lb[i];
    const dA = A[i] - Ab[i];
    const dB = B[i] - Bb[i];
    const dY = im.luma8[i] - Yb[i];
    rL[i] = dL;
    vL += dL * dL;
    vA += dA * dA;
    vB += dB * dB;
    vY += dY * dY;
    const k = Math.min(9, Math.max(0, Math.floor(Lb[i] * 10)));
    bins[k].n++;
    bins[k].sL += dL * dL;
    bins[k].sC += dA * dA + dB * dB;
    bins[k].sY += dY * dY;
  }
  const n = Math.max(1, used);

  const dirs = mode === "isotropic" ? { x: [1, 0], y: [0, 1] } : { alongIso: along, acrossIso: across };
  const autocorr = {};
  const lag50 = {};
  for (const [name, d] of Object.entries(dirs)) {
    autocorr[name] = autocorrelation(rL, use, W, H, d).map((v) => round(v, 3));
    lag50[name] = halfLag(autocorr[name]);
  }
  const lags = Object.values(lag50);

  const out = {
    mode,
    highpassSigmaPx: sigma,
    pixelsUsedShare: round(used / N, 3),
    stdL100: round(Math.sqrt(vL / n) * 100, 3),
    stdChroma100: round(Math.sqrt((vA + vB) / n) * 100, 3),
    stdLuma8: round(Math.sqrt(vY / n), 3),
    stdLumaPercent: round((Math.sqrt(vY / n) / 255) * 100, 3),
    monoShare: round(vL / Math.max(1e-12, vL + vA + vB), 3),
    byLightness: bins.map((b, k) => ({
      L: [k / 10, (k + 1) / 10],
      n: b.n,
      stdL100: b.n > 200 ? round(Math.sqrt(b.sL / b.n) * 100, 3) : null,
      stdChroma100: b.n > 200 ? round(Math.sqrt(b.sC / b.n) * 100, 3) : null,
      stdLuma8: b.n > 200 ? round(Math.sqrt(b.sY / b.n), 3) : null,
    })),
    autocorr,
    halfCorrelationLagPx: Object.fromEntries(Object.entries(lag50).map(([k, v]) => [k, v === null ? null : round(v, 2)])),
    grainSizePx: lags.every((v) => v !== null) ? round(lags[0] + lags[1], 2) : null,
  };
  if (mode === "isotropic") {
    const multi = {};
    for (const s of [1, 2, 8]) {
      const blur = gaussianBlur(L, W, H, s);
      let v = 0;
      for (let i = 0; i < N; i++) if (use[i]) v += (L[i] - blur[i]) ** 2;
      multi[`sigma${s}`] = round(Math.sqrt(v / n) * 100, 3);
    }
    multi[`sigma${sigma}`] = out.stdL100;
    out.stdL100ByHighpassSigma = multi;
  }
  return out;
}

function directionalBlur(src, W, H, [ux, uy], sigma) {
  const r = Math.ceil(sigma * 3);
  const k = [];
  let s = 0;
  for (let i = -r; i <= r; i++) {
    const w = Math.exp((-i * i) / (2 * sigma * sigma));
    k.push(w);
    s += w;
  }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) a += k[i + r] * bilinear(src, W, H, x + i * ux, y + i * uy);
      out[y * W + x] = a;
    }
  }
  return out;
}

function bilinear(src, W, H, x, y) {
  x = x < 0 ? 0 : x > W - 1 ? W - 1 : x;
  y = y < 0 ? 0 : y > H - 1 ? H - 1 : y;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1 < W ? x0 + 1 : x0;
  const y1 = y0 + 1 < H ? y0 + 1 : y0;
  const fx = x - x0;
  const fy = y - y0;
  return (src[y0 * W + x0] * (1 - fx) + src[y0 * W + x1] * fx) * (1 - fy) + (src[y1 * W + x0] * (1 - fx) + src[y1 * W + x1] * fx) * fy;
}

function autocorrelation(r, use, W, H, [dx, dy]) {
  const out = [];
  for (let lag = 0; lag <= 12; lag++) {
    let num = 0;
    let den = 0;
    const ox = lag * dx;
    const oy = lag * dy;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!use[i]) continue;
        const xx = x + ox;
        const yy = y + oy;
        if (xx < 0 || yy < 0 || xx > W - 1 || yy > H - 1) continue;
        if (!use[Math.round(yy) * W + Math.round(xx)]) continue;
        num += r[i] * bilinear(r, W, H, xx, yy);
        den += r[i] * r[i];
      }
    }
    out.push(den ? num / den : 0);
  }
  return out;
}

function halfLag(arr) {
  for (let k = 1; k < arr.length; k++) {
    if (arr[k] < 0.5) return k - 1 + (arr[k - 1] - 0.5) / (arr[k - 1] - arr[k]);
  }
  return null;
}

// Square dilation of radius r: distance sweeps along rows, then along columns.
function growMask(mask, W, H, r) {
  const rows = new Uint8Array(mask.length);
  for (let y = 0; y < H; y++) {
    let d = Infinity;
    for (let x = 0; x < W; x++) {
      d = mask[y * W + x] ? 0 : d + 1;
      if (d <= r) rows[y * W + x] = 1;
    }
    d = Infinity;
    for (let x = W - 1; x >= 0; x--) {
      d = mask[y * W + x] ? 0 : d + 1;
      if (d <= r) rows[y * W + x] = 1;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let x = 0; x < W; x++) {
    let d = Infinity;
    for (let y = 0; y < H; y++) {
      d = rows[y * W + x] ? 0 : d + 1;
      if (d <= r) out[y * W + x] = 1;
    }
    d = Infinity;
    for (let y = H - 1; y >= 0; y--) {
      d = rows[y * W + x] ? 0 : d + 1;
      if (d <= r) out[y * W + x] = 1;
    }
  }
  return out;
}
