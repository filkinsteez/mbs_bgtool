// Production Sunset scenes from a pack and a seed, on the shared boundary model.
// Pack colors only, in pack order; Meta Blue holds the sky; at most one warm color.
// The seed drives every noise field and a small change of horizon height and tilt.

import { PACKS } from './color.mjs';
import { hashIndex } from './noise.mjs';

// stops: [color index into the pack, gain, transition position (frame heights), width]
const LAYOUT = {
  // Meta Blue sky -> Cyan low sky -> Yellow horizon glow (the one warm color) -> dim Meta Blue ground
  bold: {
    colors: [[0, 1], [1, 0.9], [2, 1], [0, 0.3]],
    stops: [
      [0.46, 0.42],
      [0.7, 0.2],
      [0.82, 0.06],
    ],
  },
  // Meta Blue sky -> Tan horizon (the one warm color) -> Forest ground -> Plum floor
  elemental: {
    colors: [[0, 1], [3, 1.1], [2, 1], [4, 0.9]],
    stops: [
      [0.56, 0.34],
      [0.76, 0.07],
      [0.92, 0.14],
    ],
  },
  // Meta Blue sky -> Ice glow -> Steel -> Slate -> Near-black
  atmospheric: {
    colors: [[0, 1], [1, 0.95], [2, 1], [3, 1], [4, 1]],
    stops: [
      [0.5, 0.4],
      [0.73, 0.1],
      [0.84, 0.1],
      [0.95, 0.12],
    ],
  },
};

export function productionScene(pack, seed, controls = {}) {
  const L = LAYOUT[pack];
  const hex = PACKS[pack];
  const softness = controls.softness ?? 0.5;
  const kS = 2 ** ((softness - 0.5) * 1.4);
  const shift = (hashIndex(1, seed) - 0.5) * 0.08;
  const tilt = (hashIndex(2, seed) - 0.5) * 5;
  const stops = L.stops.map(([at, width]) => ({ at: at + shift, width: width * kS }));
  const horizon = stops[1].at;
  // wander: largest in the high sky and at the horizon, smaller in the ground
  const wander = [
    [stops[0].at, 0.016],
    [horizon - 0.06, 0.012],
    [horizon, 0.018],
    [horizon + 0.12, 0.006],
  ];
  return {
    seed,
    colors: L.colors.map(([i]) => hex[i]),
    gains: L.colors.map(([, g]) => g),
    base: { tilt, anchor: [0.5, 0] },
    stops,
    boundary: {
      wander: wander.map(([s, a]) => [s, a * Math.sqrt(kS)]),
      share: 0.35,
      sharedScale: 0.45,
      scale: 0.4,
      lyMode: 'ramp',
      ly: 2.0,
      octaves: 2,
      gain: 0.25,
      clip: 1.3,
      alongMod: { amount: 0.2, scale: 0.9 },
      soft: { amount: 0.15, scale: 0.5, ly: 0.25, wRef: 0.08 },
    },
    bridge: { pull: 0.5, lift: 0.12 },
  };
}

// The color positions the audit uses for main transitions: the middle of each
// plateau between transitions.
export function auditStops(scene) {
  const m = scene.stops.map((s) => s.at);
  const pos = [0];
  for (let i = 0; i + 1 < m.length; i++) pos.push((m[i] + m[i + 1]) / 2);
  pos.push(0.995);
  return pos.map((p, i) => [Math.max(0, Math.min(0.995, p)), `c${i}`]);
}
