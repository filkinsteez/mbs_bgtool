// Fits multi-octave grain weights to a reference's band energies. Each
// candidate octave's band response is measured on a flat field, then the
// non-negative weights (squared) are solved by projected gradient descent
// on band variances. Run once at design time; the renderer only uses the
// resulting weights.
import fs from 'node:fs';
import path from 'node:path';
import { octaveBands } from './lib/measure.mjs';
import { bandNoise } from './lib/noise.mjs';
import { OUT } from './refs.mjs';

const N = 384;
const SIGMAS = [0.5, 1.0, 2.0, 4.0, 8.0];
const mask = new Uint8Array(N * N);
for (let y = 24; y < N - 24; y++) for (let x = 24; x < N - 24; x++) mask[y * N + x] = 1;

const response = SIGMAS.map((s, k) => {
  const f = bandNoise(N, N, s, 1000 + k);
  return octaveBands(f, mask, N, N).map((b) => b.std * b.std);
});

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) return null;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

// Non-negative least squares on relative band error: minimise
// sum_j ((sum_k w2_k R_kj) / t_j - 1)^2 over w2 >= 0, by trying every
// subset of active octaves (2^5 cases).
function fit(target, bandsUsed) {
  const K = SIGMAS.length;
  const pred = (w) => target.map((_, j) => w.reduce((s, v, k) => s + v * response[k][j], 0));
  const err = (w) => bandsUsed.reduce((s, j) => s + (pred(w)[j] / target[j] - 1) ** 2, 0);
  let best = null;
  for (let mask = 1; mask < 1 << K; mask++) {
    const act = [...Array(K).keys()].filter((k) => mask & (1 << k));
    const AtA = act.map((a) => act.map((b) => bandsUsed.reduce((s, j) => s + (response[a][j] * response[b][j]) / target[j] ** 2, 0)));
    const Atb = act.map((a) => bandsUsed.reduce((s, j) => s + response[a][j] / target[j], 0));
    const x = solve(AtA, Atb);
    if (!x || x.some((v) => v < 0)) continue;
    const w2 = new Array(K).fill(0);
    act.forEach((k, i) => (w2[k] = x[i]));
    const e = err(w2);
    if (!best || e < best.e) best = { w2, e };
  }
  return { w2: best.w2, pred: pred(best.w2) };
}

for (const id of ['sunset-green-riso', 'sunset-blue-riso', 'sunset-pink-riso']) {
  const ref = JSON.parse(fs.readFileSync(path.join(OUT, 'measure', `${id}.json`), 'utf8'));
  const target = ref.octavesL.map((o) => o.std * o.std);
  // Bands 0-4 (up to 11.2 px); the widest band also holds the ramp itself.
  const { w2, pred } = fit(target, [0, 1, 2, 3, 4]);
  const total = Math.sqrt(w2.reduce((s, v) => s + v, 0));
  console.log(
    id,
    'weights (unit total):',
    SIGMAS.map((s, k) => `${s}:${(Math.sqrt(w2[k]) / total).toFixed(3)}`).join(' '),
    '| target std%',
    target.map((v) => (Math.sqrt(v) * 100).toFixed(2)).join(' '),
    '| fit std%',
    pred.map((v) => (Math.sqrt(v) * 100).toFixed(2)).join(' '),
    '| rms amp%',
    (total * 100).toFixed(2),
  );
}
