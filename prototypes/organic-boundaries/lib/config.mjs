// Measurement settings per Sunset reference. Stop positions (axis fractions)
// come from the reference notes (docs/references/awe/<id>.md); each pair of
// neighbouring stops is one main transition. window: path search window for
// paths that pass the same color twice (see rampcoord.projectToPath).

export const SUNSET = {
  'sunset-sky-peach': {
    angle: 90,
    band: 0.3,
    window: null,
    gain: true,
    stops: [
      [0.0, 'blue'],
      [0.39, 'grey'],
      [0.56, 'peach'],
      [0.76, 'light orange'],
      [0.86, 'orange'],
      [0.94, 'red'],
      [0.995, 'deep red'],
    ],
  },
  'sunset-violet-wave': {
    angle: 90,
    band: 0.3,
    window: null,
    prepend: '#578ECC',
    stops: [
      [0.0, 'sky blue'],
      [0.3, 'blue-white'],
      [0.45, 'pink-lilac'],
      [0.55, 'violet'],
      [0.68, 'indigo'],
      [0.925, 'navy'],
      [0.995, 'near-black navy'],
    ],
  },
  'sunset-red-yellow-arcs': {
    angle: 90,
    band: 0.3,
    window: null,
    stops: [
      [0.0, 'maroon'],
      [0.123, 'dark red'],
      [0.419, 'scarlet'],
      [0.518, 'red-orange'],
      [0.744, 'golden yellow'],
      [0.811, 'cream'],
      [0.99, 'light blue'],
    ],
  },
  'sunset-blue-diagonal': {
    angle: 123.5,
    band: 0.3,
    window: null,
    gain: true,
    stops: [
      [0.0, 'deep blue'],
      [0.42, 'medium blue'],
      [0.58, 'pale blue-grey'],
      [0.83, 'cream'],
      [0.94, 'amber'],
      [0.995, 'red-orange'],
    ],
  },
  'sunset-film-poster-bands': {
    angle: 90,
    band: 0.6,
    window: 0.15,
    stops: [
      [0.01, 'dark red'],
      [0.123, 'ink black'],
      [0.386, 'denim blue'],
      [0.494, 'warm grey'],
      [0.575, 'olive grey'],
      [0.715, 'coral rim'],
      [0.815, 'scarlet core'],
    ],
  },
  'sunset-green-riso': {
    angle: 90,
    band: 0.4,
    window: null,
    stops: [
      [0.005, 'paper'],
      [0.35, 'green'],
      [0.62, 'green'],
      [0.995, 'mustard'],
    ],
  },
  'sunset-blue-riso': {
    angle: 90,
    band: 0.4,
    window: 0.15,
    stops: [
      [0.02, 'paper'],
      [0.33, 'cyan'],
      [0.39, 'cyan'],
      [0.423, 'grey-blue'],
      [0.5, 'slate'],
      [0.61, 'slate'],
      [0.78, 'grey lavender'],
      [0.995, 'light blue'],
    ],
  },
  'sunset-pink-riso': {
    angle: 90,
    band: 0.4,
    window: 0.08,
    stops: [
      [0.0, 'cream'],
      [0.449, 'magenta'],
      [0.511, 'magenta'],
      [0.603, 'orange'],
      [0.612, 'orange rim'],
      [0.626, 'magenta'],
      [0.849, 'dusty violet'],
      [0.995, 'slate'],
    ],
  },
};

export const SUNSET_IDS = Object.keys(SUNSET);

// Transitions between neighbouring stops that change color (plateaus skipped).
export function transitions(cfg, pathTAt, path) {
  const out = [];
  for (let i = 0; i + 1 < cfg.stops.length; i++) {
    const [p0, n0] = cfg.stops[i];
    const [p1, n1] = cfg.stops[i + 1];
    const t0 = pathTAt(path, p0);
    const t1 = pathTAt(path, p1);
    if (n0 === n1 || Math.abs(t1 - t0) < 0.02) continue;
    out.push({ name: `${n0} → ${n1}`, t0, t1, t10: t0 + 0.1 * (t1 - t0), t50: t0 + 0.5 * (t1 - t0), t90: t0 + 0.9 * (t1 - t0) });
  }
  return out;
}
