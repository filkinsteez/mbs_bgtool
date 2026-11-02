// Grain measurements on sRGB-encoded images. All lengths are in pixels of
// the image passed in; callers rescale to the 925 px reference width.
import { linearToOklab, srgbToLinear } from './color.mjs';
import { blurPlane } from './noise.mjs';

export function oklabPlanes(imgSrgb) {
  const n = imgSrgb.w * imgSrgb.h;
  const L = new Float32Array(n);
  const A = new Float32Array(n);
  const B = new Float32Array(n);
  const lab = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    linearToOklab(
      srgbToLinear(imgSrgb.d[i * 3]),
      srgbToLinear(imgSrgb.d[i * 3 + 1]),
      srgbToLinear(imgSrgb.d[i * 3 + 2]),
      lab,
    );
    L[i] = lab[0];
    A[i] = lab[1];
    B[i] = lab[2];
  }
  return { L, A, B };
}

export function channelPlane(imgSrgb, c) {
  const n = imgSrgb.w * imgSrgb.h;
  const p = new Float32Array(n);
  for (let i = 0; i < n; i++) p[i] = imgSrgb.d[i * 3 + c];
  return p;
}

export function highpass(p, w, h, sigma) {
  const lo = blurPlane(p, w, h, sigma);
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i++) out[i] = p[i] - lo[i];
  return { hp: out, lo };
}

// Mask: 1 = measure. Excludes a border, listed rects, and pixels near
// mid-scale structure (edges, folds, text) where the high-pass residual is
// not grain.
export function buildMask(w, h, { border = 24, rects = [], L, structureThreshold = 0.012 } = {}) {
  const m = new Uint8Array(w * h);
  for (let y = border; y < h - border; y++) {
    for (let x = border; x < w - border; x++) m[y * w + x] = 1;
  }
  for (const [rx, ry, rw, rh] of rects) {
    for (let y = Math.max(0, ry); y < Math.min(h, ry + rh); y++) {
      for (let x = Math.max(0, rx); x < Math.min(w, rx + rw); x++) m[y * w + x] = 0;
    }
  }
  if (L && structureThreshold > 0) {
    const a = blurPlane(L, w, h, 3);
    const b = blurPlane(L, w, h, 12);
    const bad = new Float32Array(w * h);
    for (let i = 0; i < bad.length; i++) bad[i] = Math.abs(a[i] - b[i]) > structureThreshold ? 1 : 0;
    const grown = blurPlane(bad, w, h, 6);
    for (let i = 0; i < m.length; i++) if (grown[i] > 0.02) m[i] = 0;
  }
  return m;
}

function moments(values) {
  const n = values.length;
  if (n === 0) return { n: 0 };
  let s = 0;
  for (const v of values) s += v;
  const mean = s / n;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (const v of values) {
    const d = v - mean;
    const d2 = d * d;
    m2 += d2;
    m3 += d2 * d;
    m4 += d2 * d2;
  }
  m2 /= n;
  m3 /= n;
  m4 /= n;
  return {
    n,
    mean,
    std: Math.sqrt(m2),
    skew: m2 > 0 ? m3 / Math.pow(m2, 1.5) : 0,
    exKurt: m2 > 0 ? m4 / (m2 * m2) - 3 : 0,
  };
}

// Residual statistics per Oklab L bin (bin by the low-passed L).
export function binnedStats(planes, mask, { bins = 10, minCount = 1500 } = {}) {
  const { hpL, hpA, hpB, loL, hpR, hpG, hpBl } = planes;
  const groups = Array.from({ length: bins }, () => ({ L: [], A: [], B: [], R: [], G: [], Bl: [] }));
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const b = Math.min(bins - 1, Math.max(0, Math.floor(loL[i] * bins)));
    const g = groups[b];
    g.L.push(hpL[i]);
    g.A.push(hpA[i]);
    g.B.push(hpB[i]);
    if (hpR) {
      g.R.push(hpR[i]);
      g.G.push(hpG[i]);
      g.Bl.push(hpBl[i]);
    }
  }
  const out = [];
  groups.forEach((g, b) => {
    if (g.L.length < minCount) return;
    const mL = moments(g.L);
    const mA = moments(g.A);
    const mB = moments(g.B);
    const row = {
      bin: [b / bins, (b + 1) / bins],
      n: g.L.length,
      stdL: mL.std,
      stdA: mA.std,
      stdB: mB.std,
      skewL: mL.skew,
      exKurtL: mL.exKurt,
      monoShare: (mL.std * mL.std) / (mL.std * mL.std + mA.std * mA.std + mB.std * mB.std),
    };
    if (g.R.length) {
      const mR = moments(g.R);
      const mG = moments(g.G);
      const mBl = moments(g.Bl);
      row.stdRGB = [mR.std, mG.std, mBl.std];
      row.corrRG = corr(g.R, g.G);
      row.corrGB = corr(g.G, g.Bl);
      row.corrRB = corr(g.R, g.Bl);
    }
    out.push(row);
  });
  return out;
}

export function overallStats(planes, mask) {
  const L = [];
  const A = [];
  const B = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    L.push(planes.hpL[i]);
    A.push(planes.hpA[i]);
    B.push(planes.hpB[i]);
  }
  const mL = moments(L);
  const mA = moments(A);
  const mB = moments(B);
  return {
    n: L.length,
    stdL: mL.std,
    stdA: mA.std,
    stdB: mB.std,
    skewL: mL.skew,
    exKurtL: mL.exKurt,
    monoShare: (mL.std * mL.std) / (mL.std * mL.std + mA.std * mA.std + mB.std * mB.std),
  };
}

function corr(a, b) {
  const n = a.length;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) {
    sa += a[i];
    sb += b[i];
  }
  const ma = sa / n;
  const mb = sb / n;
  let cab = 0;
  let caa = 0;
  let cbb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    cab += da * db;
    caa += da * da;
    cbb += db * db;
  }
  return cab / Math.sqrt(caa * cbb);
}

// Normalized autocorrelation of a residual plane over masked pixels, for
// lags in [-maxLag, maxLag]^2. Returns a (2*maxLag+1)^2 grid.
export function autocorr(hp, mask, w, h, maxLag = 8) {
  const size = 2 * maxLag + 1;
  const acf = new Float64Array(size * size);
  let mean = 0;
  let cnt = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) {
      mean += hp[i];
      cnt++;
    }
  }
  mean /= cnt;
  let v0 = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) v0 += (hp[i] - mean) * (hp[i] - mean);
  v0 /= cnt;
  for (let dy = -maxLag; dy <= maxLag; dy++) {
    for (let dx = -maxLag; dx <= maxLag; dx++) {
      let s = 0;
      let c = 0;
      for (let y = Math.max(0, -dy); y < Math.min(h, h - dy); y += 1) {
        const row = y * w;
        const row2 = (y + dy) * w;
        for (let x = Math.max(0, -dx); x < Math.min(w, w - dx); x += 1) {
          const i = row + x;
          const j = row2 + x + dx;
          if (mask[i] && mask[j]) {
            s += (hp[i] - mean) * (hp[j] - mean);
            c++;
          }
        }
      }
      acf[(dy + maxLag) * size + dx + maxLag] = c ? s / c / v0 : 0;
    }
  }
  return { acf, maxLag, size };
}

// Summaries of an ACF: values along x and y, the lag where the radial mean
// falls to 0.5 (half width at half maximum) and the equivalent gaussian
// blob sigma (ACF of white noise blurred by a gaussian of sigma s is a
// gaussian of sigma s*sqrt(2), so HWHM = 1.665 s).
export function acfSummary({ acf, maxLag, size }) {
  const at = (dx, dy) => acf[(dy + maxLag) * size + dx + maxLag];
  const xs = [];
  const ys = [];
  for (let k = 0; k <= maxLag; k++) {
    xs.push(+at(k, 0).toFixed(3));
    ys.push(+at(0, k).toFixed(3));
  }
  const radial = [];
  for (let r = 0; r <= maxLag; r++) {
    let s = 0;
    let c = 0;
    for (let dy = -maxLag; dy <= maxLag; dy++) {
      for (let dx = -maxLag; dx <= maxLag; dx++) {
        const d = Math.hypot(dx, dy);
        if (d >= r - 0.5 && d < r + 0.5) {
          s += at(dx, dy);
          c++;
        }
      }
    }
    radial.push(c ? s / c : 0);
  }
  const hw = (arr) => {
    for (let k = 1; k < arr.length; k++) {
      if (arr[k] <= 0.5) return k - 1 + (arr[k - 1] - 0.5) / (arr[k - 1] - arr[k]);
    }
    return arr.length - 1;
  };
  const hwhmX = hw(xs);
  const hwhmY = hw(ys);
  const hwhmR = hw(radial);
  return {
    x: xs,
    y: ys,
    radial: radial.map((v) => +v.toFixed(3)),
    hwhmX: +hwhmX.toFixed(2),
    hwhmY: +hwhmY.toFixed(2),
    hwhm: +hwhmR.toFixed(2),
    blobSigma: +(hwhmR / 1.665).toFixed(2),
  };
}

// Band energy: std of the difference of gaussians between successive
// octaves, over masked pixels. Band 0 is (identity - G(s0)).
export function octaveBands(p, mask, w, h, sigmas = [0.7, 1.4, 2.8, 5.6, 11.2, 22.4]) {
  const blurred = [p, ...sigmas.map((s) => blurPlane(p, w, h, s))];
  const out = [];
  for (let k = 0; k < sigmas.length; k++) {
    let s2 = 0;
    let c = 0;
    const a = blurred[k];
    const b = blurred[k + 1];
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      const d = a[i] - b[i];
      s2 += d * d;
      c++;
    }
    out.push({ band: k === 0 ? `<${sigmas[0]}` : `${sigmas[k - 1]}-${sigmas[k]}`, std: Math.sqrt(s2 / c) });
  }
  return out;
}

// Periodic block grid check (JPEG 8x8 blocks, possibly rescaled): mean
// |horizontal step| per column and |vertical step| per row, then the
// strength of each candidate period relative to the median.
export function gridPeriodicity(L, mask, w, h, periods) {
  const col = new Float64Array(w);
  const colN = new Float64Array(w);
  const row = new Float64Array(h);
  const rowN = new Float64Array(h);
  for (let y = 1; y < h; y++) {
    for (let x = 1; x < w; x++) {
      const i = y * w + x;
      if (!mask[i] || !mask[i - 1] || !mask[i - w]) continue;
      col[x] += Math.abs(L[i] - L[i - 1]);
      colN[x]++;
      row[y] += Math.abs(L[i] - L[i - w]);
      rowN[y]++;
    }
  }
  const norm = (a, n) => {
    const out = [];
    for (let i = 0; i < a.length; i++) if (n[i] > 20) out.push({ i, v: a[i] / n[i] });
    return out;
  };
  const score = (series, P) => {
    // Fold the series by period P and measure how peaked the fold is.
    const bins = Math.max(4, Math.round(P));
    const acc = new Float64Array(bins);
    const cnt = new Float64Array(bins);
    let total = 0;
    for (const { i, v } of series) {
      const ph = Math.floor((((i / P) % 1) + 1) % 1 * bins);
      acc[ph] += v;
      cnt[ph]++;
      total += v;
    }
    const mean = total / series.length;
    let mx = 0;
    for (let b = 0; b < bins; b++) if (cnt[b]) mx = Math.max(mx, acc[b] / cnt[b]);
    return mx / mean;
  };
  const cs = norm(col, colN);
  const rs = norm(row, rowN);
  return periods.map((P) => ({ period: P, col: +score(cs, P).toFixed(3), row: +score(rs, P).toFixed(3) }));
}

// Radix-2 FFT power spectrum of a square power-of-two patch of a plane.
export function powerSpectrum(p, w, x0, y0, n) {
  const re = new Float64Array(n * n);
  const im = new Float64Array(n * n);
  let mean = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) mean += p[(y0 + y) * w + x0 + x];
  mean /= n * n;
  for (let y = 0; y < n; y++) {
    const wy = 0.5 - 0.5 * Math.cos((2 * Math.PI * (y + 0.5)) / n);
    for (let x = 0; x < n; x++) {
      const wx = 0.5 - 0.5 * Math.cos((2 * Math.PI * (x + 0.5)) / n);
      re[y * n + x] = (p[(y0 + y) * w + x0 + x] - mean) * wx * wy;
    }
  }
  const rowRe = new Float64Array(n);
  const rowIm = new Float64Array(n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      rowRe[x] = re[y * n + x];
      rowIm[x] = im[y * n + x];
    }
    fft1(rowRe, rowIm);
    for (let x = 0; x < n; x++) {
      re[y * n + x] = rowRe[x];
      im[y * n + x] = rowIm[x];
    }
  }
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      rowRe[y] = re[y * n + x];
      rowIm[y] = im[y * n + x];
    }
    fft1(rowRe, rowIm);
    for (let y = 0; y < n; y++) {
      re[y * n + x] = rowRe[y];
      im[y * n + x] = rowIm[y];
    }
  }
  const pow = new Float64Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const sy = (y + n / 2) % n;
      const sx = (x + n / 2) % n;
      pow[sy * n + sx] = re[y * n + x] ** 2 + im[y * n + x] ** 2;
    }
  }
  return pow;
}

function fft1(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ar = re[i + j];
        const ai = im[i + j];
        const br = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci;
        const bi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ar + br;
        im[i + j] = ai + bi;
        re[i + j + len / 2] = ar - br;
        im[i + j + len / 2] = ai - bi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

// Radially averaged spectrum (by spatial period in px) and the strongest
// isolated peaks away from the centre.
export function spectrumSummary(pow, n) {
  const radial = new Float64Array(n / 2);
  const cnt = new Float64Array(n / 2);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const r = Math.round(Math.hypot(x - n / 2, y - n / 2));
      if (r < n / 2) {
        radial[r] += pow[y * n + x];
        cnt[r]++;
      }
    }
  }
  for (let r = 0; r < n / 2; r++) radial[r] /= cnt[r] || 1;
  const peaks = [];
  for (let y = 2; y < n - 2; y++) {
    for (let x = 2; x < n - 2; x++) {
      const r = Math.hypot(x - n / 2, y - n / 2);
      if (r < 6) continue;
      const v = pow[y * n + x];
      const ref = radial[Math.min(n / 2 - 1, Math.round(r))] || 1e-30;
      if (v / ref < 12) continue;
      let isMax = true;
      for (let dy = -2; dy <= 2 && isMax; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if ((dx || dy) && pow[(y + dy) * n + x + dx] > v) {
            isMax = false;
            break;
          }
        }
      }
      if (isMax) {
        peaks.push({
          fx: x - n / 2,
          fy: y - n / 2,
          periodPx: +(n / r).toFixed(2),
          angleDeg: +((Math.atan2(y - n / 2, x - n / 2) * 180) / Math.PI).toFixed(1),
          ratio: +(v / ref).toFixed(1),
        });
      }
    }
  }
  peaks.sort((a, b) => b.ratio - a.ratio);
  return { radial: Array.from(radial), peaks: peaks.slice(0, 8) };
}

// Full residual analysis used for references and for model renders alike.
export function analyze(imgSrgb, { hpSigma = 6, rects = [], border = 24, structureThreshold = 0.012, maxLag = 8 } = {}) {
  const { w, h } = imgSrgb;
  const { L, A, B } = oklabPlanes(imgSrgb);
  const mask = buildMask(w, h, { border, rects, L, structureThreshold });
  const fL = highpass(L, w, h, hpSigma);
  const fA = highpass(A, w, h, hpSigma);
  const fB = highpass(B, w, h, hpSigma);
  const fR = highpass(channelPlane(imgSrgb, 0), w, h, hpSigma);
  const fG = highpass(channelPlane(imgSrgb, 1), w, h, hpSigma);
  const fBl = highpass(channelPlane(imgSrgb, 2), w, h, hpSigma);
  const planes = {
    hpL: fL.hp,
    hpA: fA.hp,
    hpB: fB.hp,
    loL: fL.lo,
    hpR: fR.hp,
    hpG: fG.hp,
    hpBl: fBl.hp,
  };
  let kept = 0;
  for (const v of mask) kept += v;
  return {
    w,
    h,
    kept,
    overall: overallStats(planes, mask),
    bins: binnedStats(planes, mask),
    acfL: acfSummary(autocorr(fL.hp, mask, w, h, maxLag)),
    acfChroma: acfSummary(autocorr(fA.hp, mask, w, h, maxLag)),
    octavesL: octaveBands(L, mask, w, h),
    octavesA: octaveBands(A, mask, w, h),
    mask,
    planes: { L, A, B },
  };
}
