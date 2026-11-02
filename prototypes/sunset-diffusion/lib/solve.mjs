// Diffusion fills for a seed raster.
//
// Input level 0 is a planar image with channels
//   [Pr, Pg, Pb, A, Qr, Qg, Qb]
// where A is seed coverage (0..1), P = A * color and Q = A * color^2
// (all linear light). The Q channels are optional.
//
// pushPull(): pyramid push-pull fill (Gortler et al. 1996, the structure used
// by ofxPoissonFill). Down passes filter premultiplied values with a 4x4 tent
// at stride 2, scale coverage by `gain`, and renormalize when coverage passes 1.
// Up passes fill each level's holes with the upsampled coarser fill:
//   F_k = P_k + (1 - A_k) * up(F_{k+1}).
// Every pass is a small fixed kernel, so it maps to 2 * log2(size) fragment
// passes on a GPU.
//
// harmonic(): solves (1 - A) * laplacian(u) = A * (u - C) with multigrid
// V-cycles (red-black Gauss-Seidel smoothing). This is the exact membrane
// (Laplace) fill, used to compare against push-pull.
import { makeImage } from './image.mjs';

const TENT = [1 / 8, 3 / 8, 3 / 8, 1 / 8];

function downLevel(src, gain) {
  const { w, h } = src;
  const W = Math.max(1, Math.ceil(w / 2));
  const H = Math.max(1, Math.ceil(h / 2));
  const nc = src.ch.length;
  const tmp = makeImage(W, h, nc);
  const out = makeImage(W, H, nc);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let X = 0; X < W; X++) {
      let norm = 0;
      const acc = new Float64Array(nc);
      for (let t = 0; t < 4; t++) {
        const fx = 2 * X + t - 1;
        if (fx < 0 || fx >= w) continue;
        const k = TENT[t];
        norm += k;
        for (let c = 0; c < nc; c++) acc[c] += k * src.ch[c][row + fx];
      }
      for (let c = 0; c < nc; c++) tmp.ch[c][y * W + X] = acc[c] / norm;
    }
  }
  for (let Y = 0; Y < H; Y++) {
    for (let X = 0; X < W; X++) {
      let norm = 0;
      const acc = new Float64Array(nc);
      for (let t = 0; t < 4; t++) {
        const fy = 2 * Y + t - 1;
        if (fy < 0 || fy >= h) continue;
        const k = TENT[t];
        norm += k;
        for (let c = 0; c < nc; c++) acc[c] += k * tmp.ch[c][fy * W + X];
      }
      const i = Y * W + X;
      let a = (acc[3] / norm) * gain;
      const s = a > 1 ? gain / (norm * a) : gain / norm;
      if (a > 1) a = 1;
      for (let c = 0; c < nc; c++) out.ch[c][i] = acc[c] * s;
      out.ch[3][i] = a;
    }
  }
  return out;
}

// Upsampling weights for a sample at fractional offset t between coarse
// pixels; returns weights for taps at floor-1 .. floor+2.
function kernelWeights(kind, t) {
  if (kind === 'linear') return [0, 1 - t, t, 0];
  // cubic B-spline (smooth, C2); costs 4 bilinear taps on a GPU
  const t2 = t * t;
  const t3 = t2 * t;
  return [(1 - t) ** 3 / 6, (3 * t3 - 6 * t2 + 4) / 6, (-3 * t3 + 3 * t2 + 3 * t + 1) / 6, t3 / 6];
}

// Resamples a coarse planar image to (w, h) with pixel centers aligned.
export function upsample(coarse, w, h, kind = 'bspline') {
  const { w: W, h: H } = coarse;
  const nc = coarse.ch.length;
  const sx = W / w;
  const sy = H / h;
  const tmp = makeImage(w, H, nc);
  const xi = new Int32Array(w * 4);
  const xw = new Float32Array(w * 4);
  for (let x = 0; x < w; x++) {
    const cx = (x + 0.5) * sx - 0.5;
    const f = Math.floor(cx);
    const k = kernelWeights(kind, cx - f);
    for (let t = 0; t < 4; t++) {
      xi[x * 4 + t] = Math.min(W - 1, Math.max(0, f - 1 + t));
      xw[x * 4 + t] = k[t];
    }
  }
  for (let Y = 0; Y < H; Y++) {
    for (let c = 0; c < nc; c++) {
      const s = coarse.ch[c];
      const d = tmp.ch[c];
      const row = Y * W;
      for (let x = 0; x < w; x++) {
        const j = x * 4;
        d[Y * w + x] =
          xw[j] * s[row + xi[j]] +
          xw[j + 1] * s[row + xi[j + 1]] +
          xw[j + 2] * s[row + xi[j + 2]] +
          xw[j + 3] * s[row + xi[j + 3]];
      }
    }
  }
  const out = makeImage(w, h, nc);
  for (let y = 0; y < h; y++) {
    const cy = (y + 0.5) * sy - 0.5;
    const f = Math.floor(cy);
    const k = kernelWeights(kind, cy - f);
    const r = [0, 1, 2, 3].map((t) => Math.min(H - 1, Math.max(0, f - 1 + t)) * w);
    for (let c = 0; c < nc; c++) {
      const s = tmp.ch[c];
      const d = out.ch[c];
      for (let x = 0; x < w; x++) {
        d[y * w + x] = k[0] * s[r[0] + x] + k[1] * s[r[1] + x] + k[2] * s[r[2] + x] + k[3] * s[r[3] + x];
      }
    }
  }
  return out;
}

// Returns { fill: 3-channel color, second: 3-channel second moment or null }.
export function pushPull(level0, { gain = 4, up = 'bspline', minSize = 1 } = {}) {
  const levels = [level0];
  while (levels[levels.length - 1].w > minSize || levels[levels.length - 1].h > minSize) {
    const prev = levels[levels.length - 1];
    if (prev.w <= 1 && prev.h <= 1) break;
    levels.push(downLevel(prev, gain));
  }
  const nc = level0.ch.length;
  const hasQ = nc >= 7;
  const colorCh = hasQ ? [0, 1, 2, 4, 5, 6] : [0, 1, 2];
  // coarsest: normalize what is there
  const top = levels[levels.length - 1];
  let filled = makeImage(top.w, top.h, colorCh.length);
  for (let i = 0; i < top.w * top.h; i++) {
    const a = top.ch[3][i];
    colorCh.forEach((c, j) => {
      filled.ch[j][i] = a > 1e-8 ? top.ch[c][i] / a : 0;
    });
  }
  for (let k = levels.length - 2; k >= 0; k--) {
    const lv = levels[k];
    const u = upsample(filled, lv.w, lv.h, up);
    const A = lv.ch[3];
    for (let i = 0; i < lv.w * lv.h; i++) {
      const t = 1 - Math.min(1, A[i]);
      colorCh.forEach((c, j) => {
        u.ch[j][i] = lv.ch[c][i] + t * u.ch[j][i];
      });
    }
    filled = u;
  }
  const fill = { w: level0.w, h: level0.h, ch: filled.ch.slice(0, 3) };
  const second = hasQ ? { w: level0.w, h: level0.h, ch: filled.ch.slice(3, 6) } : null;
  return { fill, second, levels: levels.length };
}

// ---------- harmonic (membrane) fill by multigrid ----------

function restrictFull(src, w, h) {
  const W = Math.max(1, Math.ceil(w / 2));
  const H = Math.max(1, Math.ceil(h / 2));
  const out = new Float32Array(W * H);
  for (let Y = 0; Y < H; Y++) {
    for (let X = 0; X < W; X++) {
      let acc = 0;
      let norm = 0;
      for (let dy = 0; dy < 4; dy++) {
        const fy = 2 * Y + dy - 1;
        if (fy < 0 || fy >= h) continue;
        for (let dx = 0; dx < 4; dx++) {
          const fx = 2 * X + dx - 1;
          if (fx < 0 || fx >= w) continue;
          const k = TENT[dx] * TENT[dy];
          acc += k * src[fy * w + fx];
          norm += k;
        }
      }
      out[Y * W + X] = acc / norm;
    }
  }
  return { data: out, w: W, h: H };
}

function prolongAdd(coarse, W, H, fine, w, h) {
  const img = { w: W, h: H, ch: [coarse] };
  const up = upsample(img, w, h, 'linear').ch[0];
  for (let i = 0; i < w * h; i++) fine[i] += up[i];
}

// Operator: L u = A*u + (1-A)*s*(u - avg4(u)), Neumann edges.
function smooth(u, f, A, w, h, s, iters) {
  for (let it = 0; it < iters; it++) {
    for (let color = 0; color < 2; color++) {
      for (let y = 0; y < h; y++) {
        const yu = y > 0 ? -w : 0;
        const yd = y < h - 1 ? w : 0;
        for (let x = (y + color) & 1; x < w; x += 2) {
          const i = y * w + x;
          const xl = x > 0 ? -1 : 0;
          const xr = x < w - 1 ? 1 : 0;
          const avg = 0.25 * (u[i + xl] + u[i + xr] + u[i + yu] + u[i + yd]);
          const a = A[i];
          const d = 1 - a;
          u[i] = (f[i] + d * s * avg) / (a + d * s);
        }
      }
    }
  }
}

function residual(u, f, A, w, h, s) {
  const r = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const yu = y > 0 ? -w : 0;
    const yd = y < h - 1 ? w : 0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const xl = x > 0 ? -1 : 0;
      const xr = x < w - 1 ? 1 : 0;
      const avg = 0.25 * (u[i + xl] + u[i + xr] + u[i + yu] + u[i + yd]);
      const a = A[i];
      r[i] = f[i] - (a * u[i] + (1 - a) * s * (u[i] - avg));
    }
  }
  return r;
}

function vcycle(u, f, A, w, h, s, depth) {
  if (w * h <= 64 || depth > 14) {
    smooth(u, f, A, w, h, s, 60);
    return;
  }
  smooth(u, f, A, w, h, s, 3);
  const r = residual(u, f, A, w, h, s);
  const rc = restrictFull(r, w, h);
  const Ac = restrictFull(A, w, h);
  const ec = new Float32Array(rc.w * rc.h);
  vcycle(ec, rc.data, Ac.data, rc.w, rc.h, s / 4, depth + 1);
  prolongAdd(ec, rc.w, rc.h, u, w, h);
  smooth(u, f, A, w, h, s, 3);
}

// Solves each color channel (and second-moment channels when present).
export function harmonic(level0, { cycles = 8, init = null } = {}) {
  const { w, h } = level0;
  const A = level0.ch[3];
  const nc = level0.ch.length;
  const colorCh = nc >= 7 ? [0, 1, 2, 4, 5, 6] : [0, 1, 2];
  const outCh = colorCh.map((c, j) => {
    const f = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) f[i] = level0.ch[c][i];
    const u = init ? new Float32Array(init[j]) : new Float32Array(w * h);
    for (let k = 0; k < cycles; k++) vcycle(u, f, A, w, h, 1, 0);
    return u;
  });
  return {
    fill: { w, h, ch: outCh.slice(0, 3) },
    second: nc >= 7 ? { w, h, ch: outCh.slice(3, 6) } : null,
  };
}
