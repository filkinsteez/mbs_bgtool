/** Seeded PRNG (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Separable CMA-ES (diagonal covariance) over x in [0, 1]^n.
 * f receives a clamped vector; leaving the box adds a penalty.
 */
export function cmaes(f, x0, { sigma = 0.15, maxEvals = 3000, seed = 1, log = () => {} } = {}) {
  const n = x0.length;
  const rand = rng(seed);
  const randn = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, rand()))) * Math.cos(2 * Math.PI * rand());
  const lambda = 4 + Math.floor(3 * Math.log(n));
  const mu = Math.floor(lambda / 2);
  let weights = Array.from({ length: mu }, (_, i) => Math.log(mu + 0.5) - Math.log(i + 1));
  const wsum = weights.reduce((s, v) => s + v, 0);
  weights = weights.map((v) => v / wsum);
  const mueff = 1 / weights.reduce((s, v) => s + v * v, 0);
  const cs = (mueff + 2) / (n + mueff + 5);
  const ds = 1 + 2 * Math.max(0, Math.sqrt((mueff - 1) / (n + 1)) - 1) + cs;
  const cc = (4 + mueff / n) / (n + 4 + (2 * mueff) / n);
  const c1 = ((2 / ((n + 1.3) ** 2 + mueff)) * (n + 2)) / 3;
  const cmu = Math.min(1 - c1, ((2 * (mueff - 2 + 1 / mueff)) / ((n + 2) ** 2 + mueff)) * ((n + 2) / 3));
  const chiN = Math.sqrt(n) * (1 - 1 / (4 * n) + 1 / (21 * n * n));

  let m = x0.slice();
  let C = new Array(n).fill(1);
  let ps = new Array(n).fill(0);
  let pc = new Array(n).fill(0);
  const clamp = (x) => x.map((v) => Math.min(1, Math.max(0, v)));
  const evalPenalized = (x) => {
    const xc = clamp(x);
    let pen = 0;
    for (let i = 0; i < n; i++) pen += (x[i] - xc[i]) ** 2;
    return f(xc) + 50 * pen;
  };
  let best = { x: clamp(m), fx: f(clamp(m)) };
  let evals = 1;
  let gen = 0;
  while (evals < maxEvals && sigma > 1e-4) {
    const pop = [];
    for (let k = 0; k < lambda; k++) {
      const z = Array.from({ length: n }, randn);
      const y = z.map((v, i) => v * Math.sqrt(C[i]));
      const x = m.map((v, i) => v + sigma * y[i]);
      const fx = evalPenalized(x);
      evals++;
      pop.push({ x, y, z, fx });
      if (fx < best.fx) best = { x: clamp(x), fx };
    }
    pop.sort((p, q) => p.fx - q.fx);
    const yw = new Array(n).fill(0);
    const zw = new Array(n).fill(0);
    for (let k = 0; k < mu; k++) {
      for (let i = 0; i < n; i++) {
        yw[i] += weights[k] * pop[k].y[i];
        zw[i] += weights[k] * pop[k].z[i];
      }
    }
    m = m.map((v, i) => v + sigma * yw[i]);
    ps = ps.map((v, i) => (1 - cs) * v + Math.sqrt(cs * (2 - cs) * mueff) * zw[i]);
    const psNorm = Math.sqrt(ps.reduce((s, v) => s + v * v, 0));
    const hsig = psNorm / Math.sqrt(1 - (1 - cs) ** (2 * (gen + 1))) / chiN < 1.4 + 2 / (n + 1) ? 1 : 0;
    pc = pc.map((v, i) => (1 - cc) * v + hsig * Math.sqrt(cc * (2 - cc) * mueff) * yw[i]);
    C = C.map((v, i) => {
      let rankMu = 0;
      for (let k = 0; k < mu; k++) rankMu += weights[k] * pop[k].y[i] ** 2;
      return (1 - c1 - cmu) * v + c1 * (pc[i] ** 2 + (1 - hsig) * cc * (2 - cc) * v) + cmu * rankMu;
    });
    sigma *= Math.exp((cs / ds) * (psNorm / chiN - 1));
    gen++;
    if (gen % 20 === 0) log(`gen ${gen} evals ${evals} best ${best.fx.toFixed(3)} sigma ${sigma.toFixed(4)}`);
  }
  return best;
}
