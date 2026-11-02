// The three user controls, each 0..1 with 0.5 = the preset as written.
//   intensity: strength of the low sun (glows and sunlight together)
//   softness:  transition widths near the horizon and glow sizes; fades for
//              transitions far from the horizon so the high sky keeps its blue
//   horizon:   moves the horizon and the sun up (0) or down (1)
const MIN_WIDTH = 0.02;
const MIN_GLOW = 0.04;
const HORIZON_RANGE = 0.3;
const SOFTNESS_REACH = 0.25;

export function applyControls(scene, { intensity = 0.5, softness = 0.5, horizon = 0.5 } = {}) {
  const out = structuredClone(scene);
  const p = out.params;
  const gain = Math.pow(2, (intensity - 0.5) * 1.5);
  const soft = Math.pow(2, (softness - 0.5) * 1.4);
  const shift = (horizon - 0.5) * HORIZON_RANGE;

  const hIndex = p.horizon?.index ?? Math.floor((out.colors.length - 1) / 2);
  const near = p.stops.map((m) => Math.exp(-Math.abs(m - p.stops[hIndex]) / SOFTNESS_REACH));
  p.widths = p.widths.map((w, j) => Math.max(MIN_WIDTH, w * Math.pow(soft, near[j])));
  p.stops = p.stops.map((m) => m + shift);
  if (p.horizon?.soft !== undefined) p.horizon.soft = Math.max(p.horizon.soft, 0.3 + 0.4 * softness);
  if (p.sunlight) {
    p.sunlight.gain *= gain;
    if (p.sunlight.pos) p.sunlight.pos = [p.sunlight.pos[0], p.sunlight.pos[1] + shift];
  }
  // A thin bright glow line reads as a planet's limb, so glows scale less and have a floor.
  const glowSize = (v) => Math.max(MIN_GLOW, v * Math.sqrt(soft));
  if (p.horizonGlow) {
    p.horizonGlow.intensity *= gain;
    p.horizonGlow.layers = p.horizonGlow.layers.map(([w, up, down, ...c]) => [w, glowSize(up), glowSize(down), ...c]);
  }
  if (p.sunGlow) {
    p.sunGlow.intensity *= gain;
    p.sunGlow.layers = p.sunGlow.layers.map(([w, r, ...c]) => [w, glowSize(r), ...c]);
    if (p.sunGlow.occludeWidth) p.sunGlow.occludeWidth *= soft;
    if (p.sunGlow.pos) p.sunGlow.pos = [p.sunGlow.pos[0], p.sunGlow.pos[1] + shift];
  }
  return out;
}
