// Contour light scene: emitters defined by 2D SDFs, each with a sum of
// falloff lobes, optional medium inside the shape, and background fields.
//
// Units: positions are frame fractions [u, v]; sizes are in units where the
// frame's short side is 1000. Colors are pack/preset indices, hex strings, or
// linear RGB triples.

import { hexToLinear } from './color.mjs';
import { sdPolygon, insetConvex, sdEllipse } from './sdf.mjs';
import { gaussianBlur } from './blur.mjs';
import { Img } from './image.mjs';

export function resolveColor(c, palette) {
  if (typeof c === 'number') return hexToLinear(palette[c]);
  if (typeof c === 'string') return hexToLinear(c);
  return c;
}

// Piecewise curve over t with smoothstep easing inside each segment.
function makeCurve(ts, vs, fallback) {
  if (!ts || !vs) return () => fallback;
  const n = ts.length;
  return (t) => {
    if (t <= ts[0]) return vs[0];
    if (t >= ts[n - 1]) return vs[n - 1];
    let i = 0;
    while (t > ts[i + 1]) i++;
    let f = (t - ts[i]) / (ts[i + 1] - ts[i]);
    f = f * f * (3 - 2 * f);
    return vs[i] + (vs[i + 1] - vs[i]) * f;
  };
}

function buildShape(shape, W, H, unit) {
  switch (shape.kind) {
    case 'wedge': {
      const cx = shape.corner[0] * W;
      const cy = shape.corner[1] * H;
      const far = 20 * Math.hypot(W, H);
      const a1 = (shape.angles[0] * Math.PI) / 180;
      const a2 = (shape.angles[1] * Math.PI) / 180;
      const xs = [cx, cx + Math.cos(a1) * far, cx + Math.cos(a2) * far];
      const ys = [cy, cy + Math.sin(a1) * far, cy + Math.sin(a2) * far];
      const r = (shape.radius ?? 0) * unit;
      const p = r > 0 ? insetConvex(xs, ys, r) : { xs, ys };
      return (x, y, o) => {
        o.d = sdPolygon(x, y, p.xs, p.ys) - r;
        o.t = 0;
      };
    }
    case 'ellipse': {
      const cx = shape.center[0] * W;
      const cy = shape.center[1] * H;
      const a = shape.radii[0] * unit;
      const b = shape.radii[1] * unit;
      return (x, y, o) => {
        o.d = sdEllipse(x, y, cx, cy, a, b);
        o.t = (Math.atan2((y - cy) / b, (x - cx) / a) / (2 * Math.PI) + 1) % 1;
      };
    }
    case 'line': {
      const ax = shape.a[0] * W;
      const ay = shape.a[1] * H;
      const bx = shape.b[0] * W;
      const by = shape.b[1] * H;
      const len = Math.hypot(bx - ax, by - ay);
      const ux = (bx - ax) / len;
      const uy = (by - ay) / len;
      // Positive d is on the +x side of a top-to-bottom line.
      return (x, y, o) => {
        o.d = (x - ax) * uy - (y - ay) * ux;
        o.t = ((x - ax) * ux + (y - ay) * uy) / len;
      };
    }
    default:
      throw new Error(`unknown shape kind ${shape.kind}`);
  }
}

// Color stops along the curve; along.hue picks a position in [0, n-1].
function buildLobe(lobe, palette, unit) {
  const stops = (lobe.colors ?? [lobe.color, lobe.colorB ?? lobe.color]).map((c) => resolveColor(c, palette));
  const al = lobe.along ?? {};
  const sig = lobe.sigma ?? 10;
  return {
    intensity: lobe.intensity ?? 1,
    stops,
    aO: makeCurve(al.t, al.offset ? al.offset.map((v) => v * unit) : null, 0),
    sigIn: (lobe.sigmaIn ?? sig) * unit,
    sigOut: (lobe.sigmaOut ?? sig) * unit,
    offset: (lobe.offset ?? 0) * unit,
    plateau: (lobe.plateau ?? 0) * unit,
    chPlateau: lobe.chPlateau ?? [1, 1, 1],
    chSigma: lobe.chSigma ?? [1, 1, 1],
    chSigmaIn: lobe.chSigmaIn ?? [1, 1, 1],
    chOffset: (lobe.chOffset ?? [0, 0, 0]).map((v) => v * unit),
    powerIn: lobe.shape === 'power' ? (lobe.powerIn ?? lobe.power ?? 2) : 0,
    powerOut: lobe.shape === 'power' ? (lobe.powerOut ?? lobe.power ?? 2) : 0,
    aWIn: makeCurve(al.t, al.widthIn, 1),
    aWOut: makeCurve(al.t, al.widthOut, 1),
    source: lobe.source ?? 0,
    sourceGamma: lobe.sourceGamma ?? 1,
    widthSource: lobe.widthSource ?? -1,
    widthGain: lobe.widthGain ?? 0,
    widthGamma: lobe.widthGamma ?? 1,
    plateauSource: lobe.plateauSource ?? -1,
    plateauGamma: lobe.plateauGamma ?? 1,
    aI: makeCurve(al.t, al.intensity, 1),
    aW: makeCurve(al.t, al.width, 1),
    aH: makeCurve(al.t, al.hue, 0),
  };
}

function profile(x, s, power) {
  const q = (x * x) / (2 * s * s);
  return power > 0 ? Math.pow(1 + q / power, -power) : Math.exp(-q);
}

// Illumination from the light, evaluated at the pixel (smooth everywhere,
// unlike a value looked up at the nearest point of the curve).
// 'power': (1 + r^2/r0^2)^(-p/2). 'exp': exp(-(sqrt(r0^2 + r^2) - r0) / L).
// 'gauss': exp(-r^2 / (2 r0^2)). 'plane': light far off toward `angle`;
// 1 on the light side of pos, exp falloff of the distance q behind it.
function buildSource(src, W, H, unit) {
  if (!src) return () => 1;
  const sx = src.pos[0] * W;
  const sy = src.pos[1] * H;
  const r0 = src.radius * unit;
  const p = src.power ?? 2;
  const len = (src.length ?? 100) * unit;
  const falloff = src.falloff ?? 'power';
  const ax = src.aniso ?? 1;
  const ang = ((src.angle ?? 0) * Math.PI) / 180;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  if (falloff === 'plane') {
    return (x, y) => {
      const q = (sx - x) * ca + (sy - y) * sa;
      return q <= 0 ? 1 : Math.exp(-(Math.sqrt(r0 * r0 + q * q) - r0) / len);
    };
  }
  return (x, y) => {
    const dx = x - sx;
    const dy = y - sy;
    const u = (dx * ca + dy * sa) / ax;
    const v = -dx * sa + dy * ca;
    const r2 = u * u + v * v;
    switch (falloff) {
      case 'exp':
        return Math.exp(-(Math.sqrt(r0 * r0 + r2) - r0) / len);
      case 'gauss':
        return Math.exp(-r2 / (2 * r0 * r0));
      case 'power':
        return Math.pow(1 + r2 / (r0 * r0), -p / 2);
      default:
        throw new Error(`unknown falloff ${falloff}`);
    }
  };
}

function smoothStepCdf(x) {
  return 0.5 + 0.5 * Math.tanh(x);
}

// Returns { emission, medium } linear images. medium is added after the
// scatter blur (it needs the blurred emission).
export function renderScene(scene, W, H) {
  const P = scene.params;
  const palette = scene.colors ?? [];
  const unit = Math.min(W, H) / 1000;
  const emitters = (P.emitters ?? []).map((e) => ({
    shape: buildShape(e.shape, W, H, unit),
    lobes: (e.lobes ?? []).map((l) => buildLobe(l, palette, unit)),
    sources: (e.sources ?? [e.source]).map((s) => buildSource(s, W, H, unit)),
    inside: e.inside
      ? {
          color: resolveColor(e.inside.color ?? [0, 0, 0], palette),
          intensity: e.inside.intensity ?? 1,
          soft: (e.inside.soft ?? 1) * unit,
          source: e.inside.source ?? 0,
          sourceGamma: e.inside.sourceGamma ?? 1,
          floor: e.inside.floor ?? 0,
          // density 'inside': the whole shape scatters. 'rim': the shape's own
          // rim light (luminance / rimNorm) sets how much it scatters.
          scatter: e.inside.scatter
            ? {
                strength: e.inside.scatter.strength ?? 0,
                sigma: (e.inside.scatter.sigma ?? 50) * unit,
                tint: resolveColor(e.inside.scatter.tint ?? [1, 1, 1], palette),
                rim: e.inside.scatter.density === 'rim',
                rimNorm: e.inside.scatter.rimNorm ?? 0.3,
                spread: (e.inside.scatter.spread ?? 0) * unit,
                others: e.inside.scatter.from === 'others',
                clip: e.inside.scatter.clip ?? false,
              }
            : null,
        }
      : null,
  }));
  const fields = (P.fields ?? []).map((f) => ({
    emitter: f.emitter ?? 0,
    side: f.side ?? 'in',
    color: resolveColor(f.color, palette),
    colorFar: f.colorFar !== undefined ? resolveColor(f.colorFar, palette) : null,
    far: (f.far ?? 1000) * unit,
    edge: (f.edge ?? 0) * unit,
    soft: (f.soft ?? 50) * unit,
    intensity: f.intensity ?? 1,
    edgeAlong: makeCurve(f.along?.t, f.along?.edge, 1),
  }));
  const base = resolveColor(P.background ?? [0, 0, 0], palette);
  const baseI = P.backgroundIntensity ?? 1;

  const emission = new Img(W, H);
  const insideMask = emitters.map((e) => (e.inside ? new Float32Array(W * H) : null));
  const rimY = emitters.map((e) => (e.inside?.scatter?.rim ? new Float32Array(W * H) : null));
  const own = emitters.map((e) => (e.inside?.scatter?.others ? new Img(W, H) : null));
  const geo = { d: 0, t: 0 };
  const ds = new Float32Array(emitters.length);
  const tsv = new Float32Array(emitters.length);
  const srcV = new Float32Array(8);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const i = (y * W + x) * 3;
      let r = base[0] * baseI;
      let g = base[1] * baseI;
      let b = base[2] * baseI;
      for (let k = 0; k < emitters.length; k++) {
        const e = emitters[k];
        e.shape(px, py, geo);
        ds[k] = geo.d;
        tsv[k] = geo.t;
        for (let s = 0; s < e.sources.length; s++) srcV[s] = e.sources[s](px, py);
        const r0 = r;
        const g0 = g;
        const b0 = b;
        for (const L of e.lobes) {
          const aw = L.aW(geo.t);
          // Brighter light reads wider (overexposure): widens sigma and the
          // plateau, not the offsets, so the outer boundary stays put.
          const gw = L.widthSource >= 0 ? 1 + L.widthGain * Math.pow(srcV[L.widthSource], L.widthGamma) : 1;
          const ai = L.aI(geo.t) * L.intensity * (L.sourceGamma ? Math.pow(srcV[L.source], L.sourceGamma) : 1);
          if (ai <= 0) continue;
          const h = Math.min(L.stops.length - 1, Math.max(0, L.aH(geo.t)));
          const i0 = Math.min(L.stops.length - 2, Math.floor(h));
          const f = L.stops.length > 1 ? h - i0 : 0;
          const sa = L.stops[Math.max(0, i0)];
          const sb = L.stops[Math.min(L.stops.length - 1, i0 + 1)];
          const cols = [sa[0] + (sb[0] - sa[0]) * f, sa[1] + (sb[1] - sa[1]) * f, sa[2] + (sb[2] - sa[2]) * f];
          // The flat top only shows where the light is strong, when requested.
          const pk = L.plateauSource >= 0 ? Math.pow(srcV[L.plateauSource], L.plateauGamma) : 1;
          const ao = L.aO(geo.t);
          const wIn = L.aWIn(geo.t);
          const wOut = L.aWOut(geo.t);
          for (let c = 0; c < 3; c++) {
            let xc = geo.d - ao - (L.offset + L.chOffset[c]) * aw;
            // Flat top from -plateau to 0 (measured inward from the lobe center).
            const pl = L.plateau * L.chPlateau[c] * aw * gw * pk;
            if (pl > 0) xc = xc < -pl ? xc + pl : xc > 0 ? xc : 0;
            const s = (xc < 0 ? L.sigIn * gw * wIn * L.chSigmaIn[c] : L.sigOut * wOut) * L.chSigma[c] * aw;
            const v = ai * cols[c] * profile(xc, s, xc < 0 ? L.powerIn : L.powerOut);
            if (c === 0) r += v;
            else if (c === 1) g += v;
            else b += v;
          }
        }
        if (rimY[k]) rimY[k][y * W + x] = 0.2126 * (r - r0) + 0.7152 * (g - g0) + 0.0722 * (b - b0);
        if (own[k]) {
          own[k].data[i] = r - r0;
          own[k].data[i + 1] = g - g0;
          own[k].data[i + 2] = b - b0;
        }
        if (e.inside) {
          const m = 1 - smoothStepCdf(geo.d / e.inside.soft);
          insideMask[k][y * W + x] = m;
          const lit = e.inside.sourceGamma ? Math.pow(srcV[e.inside.source], e.inside.sourceGamma) : 1;
          const f = m * e.inside.intensity * (e.inside.floor + (1 - e.inside.floor) * lit);
          r += f * e.inside.color[0];
          g += f * e.inside.color[1];
          b += f * e.inside.color[2];
        }
      }
      for (const f of fields) {
        const d = f.side === 'in' ? -ds[f.emitter] : ds[f.emitter];
        const edge = f.edge * f.edgeAlong(tsv[f.emitter]);
        const wgt = smoothStepCdf((d - edge) / f.soft) * f.intensity;
        let cr = f.color[0];
        let cg = f.color[1];
        let cb = f.color[2];
        if (f.colorFar) {
          const q = Math.min(1, Math.max(0, (d - edge) / f.far));
          cr += (f.colorFar[0] - cr) * q;
          cg += (f.colorFar[1] - cg) * q;
          cb += (f.colorFar[2] - cb) * q;
        }
        r += wgt * cr;
        g += wgt * cg;
        b += wgt * cb;
      }
      emission.data[i] = r;
      emission.data[i + 1] = g;
      emission.data[i + 2] = b;
    }
  }

  // Medium inside shapes catches blurred light from every emitter.
  let out = emission;
  const scatterers = emitters.map((e, k) => ({ e, k })).filter(({ e }) => e.inside?.scatter?.strength);
  if (scatterers.length) {
    out = emission.clone();
    const cache = new Map();
    for (const { e, k } of scatterers) {
      const sc = e.inside.scatter;
      const key = sc.sigma.toFixed(3);
      if (!cache.has(key)) cache.set(key, gaussianBlur(emission, sc.sigma));
      let blurred = cache.get(key);
      if (sc.others) {
        // Light from the other emitters only: blur(total) - blur(own).
        const ownB = gaussianBlur(own[k], sc.sigma);
        const diff = new Img(W, H);
        for (let p = 0; p < W * H * 3; p++) diff.data[p] = Math.max(0, blurred.data[p] - ownB.data[p]);
        blurred = diff;
      }
      const mask = insideMask[k];
      const rim = rimY[k];
      // Scattered light, optionally spread again (it acts as a new soft source).
      let sct = new Img(W, H);
      for (let p = 0; p < W * H; p++) {
        const m = (rim ? rim[p] / sc.rimNorm : mask[p]) * sc.strength;
        if (m <= 0) continue;
        sct.data[p * 3] = m * sc.tint[0] * blurred.data[p * 3];
        sct.data[p * 3 + 1] = m * sc.tint[1] * blurred.data[p * 3 + 1];
        sct.data[p * 3 + 2] = m * sc.tint[2] * blurred.data[p * 3 + 2];
      }
      if (sc.spread > 0) sct = gaussianBlur(sct, sc.spread);
      // Light spread inside a translucent shape stays inside it.
      if (sc.clip) for (let p = 0; p < W * H * 3; p++) sct.data[p] *= mask[(p / 3) | 0];
      for (let p = 0; p < W * H * 3; p++) out.data[p] += sct.data[p];
    }
  }
  return out;
}
