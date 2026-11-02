// What each offline fit may change, with ranges. Entries:
//   ['color', path, range]   sRGB +-range around the current hex
//   ['num', path, lo, hi]
const colors = (preset, range = 0.2) => preset.scene.colors.map((_, i) => ['color', `colors.${i}`, range]);
const stops = (preset, d = 0.12) =>
  preset.scene.params.stops.map((v, i) => ['num', `params.stops.${i}`, v - d, v + d]);
const widths = (preset, lo = 0.01, hi = 0.7) => preset.scene.params.widths.map((_, i) => ['num', `params.widths.${i}`, lo, hi]);
const glowLayers = (preset, key, lo = 0.005, hi = 1.2) =>
  (preset.scene.params[key]?.layers ?? []).flatMap((layer, i) =>
    layer.map((v, j) =>
      typeof v === 'string'
        ? ['color', `params.${key}.layers.${i}.${j}`, 0.35]
        : ['num', `params.${key}.layers.${i}.${j}`, j === 0 ? 0 : lo, j === 0 ? 2 : hi],
    ),
  );

const sunlight = () => [
  ['num', 'params.sunlight.pos.0', 0.4, 2.0],
  ['num', 'params.sunlight.gain', 0, 1.5],
  ['num', 'params.sunlight.width', 0.1, 2.0],
];

export const SPECS = {
  'ramp-only': (p) => [...colors(p), ...stops(p), ...widths(p)],
  'ramp-sun': (p) => [...colors(p), ...stops(p), ...widths(p), ...sunlight()],
  'ramp-bend': (p) => [...colors(p), ...stops(p), ...widths(p), ['num', 'params.axis.bend', 0, 3]],
  'ramp-bend-glow': (p) => [
    ...colors(p),
    ...stops(p),
    ...widths(p),
    ['num', 'params.axis.bend', 0, 3],
    ['color', 'params.horizonGlow.color', 0.3],
    ['num', 'params.horizonGlow.intensity', 0, 1.5],
    ['num', 'params.horizonGlow.offset', -0.2, 0.2],
    ...glowLayers(p, 'horizonGlow', 0.005, 0.6),
  ],
  'ramp-sun-tint': (p) => [
    ...colors(p),
    ...stops(p),
    ...widths(p),
    ...sunlight(),
    ['color', 'params.sunlight.tint', 0.5],
  ],
  diag: (p) => [
    ...colors(p, 0.2),
    ...stops(p, 0.15),
    ...widths(p, 0.02, 0.8),
    ['num', 'params.axis.tilt', p.scene.params.axis.tilt - 15, p.scene.params.axis.tilt + 15],
    ['num', 'params.axis.bend', -1.5, 1.5],
    ['num', 'params.sunGlow.pos.0', -0.4, 0.5],
    ['num', 'params.sunGlow.pos.1', 0.75, 1.5],
    ['num', 'params.sunGlow.intensity', 0, 1.5],
    ['num', 'params.sunGlow.aspect', 0.5, 4],
    ['num', 'params.sunGlow.beta', 0.6, 3],
    ...p.scene.params.sunGlow.layers.flatMap((_, i) => [
      ['num', `params.sunGlow.layers.${i}.0`, 0, 2],
      ['num', `params.sunGlow.layers.${i}.1`, 0.03, 1.5],
      ['color', `params.sunGlow.layers.${i}.2`, 0.35],
    ]),
    ['num', 'params.sunlight.gain', 0, 2],
    ['num', 'params.sunlight.width', 0.1, 2],
    ['color', 'params.sunlight.tint', 0.4],
  ],
  'diag-sunlight': (p) => [
    ...colors(p, 0.3),
    ...stops(p, 0.15),
    ...widths(p, 0.02, 0.8),
    ['num', 'params.axis.tilt', p.scene.params.axis.tilt - 12, p.scene.params.axis.tilt + 12],
    ['num', 'params.axis.bend', -0.6, 0.6],
    ['num', 'params.sunlight.pos.0', -0.5, 0.5],
    ['num', 'params.sunlight.gain', 0, 3],
    ['num', 'params.sunlight.width', 0.05, 2],
    ['color', 'params.sunlight.tint', 0.5],
  ],
  // Blue sky ramp + warm horizon glow with lateral falloff + sun glow + sunlight.
  'diag-H': (p) => [
    ...colors(p, 0.3),
    ...stops(p, 0.15),
    ...widths(p, 0.02, 0.8),
    ['num', 'params.axis.tilt', p.scene.params.axis.tilt - 10, p.scene.params.axis.tilt + 10],
    ['num', 'params.axis.bend', -0.6, 0.6],
    ...(p.scene.params.horizonGlow.color ? [['color', 'params.horizonGlow.color', 0.35]] : []),
    ['num', 'params.horizonGlow.intensity', 0, 2.5],
    ['num', 'params.horizonGlow.offset', -0.15, 0.25],
    ['num', 'params.horizonGlow.lateral', 0, 1],
    ['num', 'params.horizonGlow.lateralWidth', 0.05, 1.5],
    ...(p.scene.params.horizonGlow.extinction !== undefined ? [['num', 'params.horizonGlow.extinction', 0, 6]] : []),
    ...glowLayers(p, 'horizonGlow', 0.01, 1.0),
    ...(p.scene.params.sunGlow
      ? [
          ['num', 'params.sunGlow.pos.0', -0.4, 0.4],
          ['num', 'params.sunGlow.pos.1', 0.65, 1.1],
          ['color', 'params.sunGlow.color', 0.35],
          ['num', 'params.sunGlow.intensity', 0, 1.5],
          ['num', 'params.sunGlow.aspect', 0.5, 5],
          ['num', 'params.sunGlow.beta', 0.6, 3],
          ...p.scene.params.sunGlow.layers.flatMap((_, i) => [
            ['num', `params.sunGlow.layers.${i}.0`, 0, 2],
            ['num', `params.sunGlow.layers.${i}.1`, 0.03, 1.0],
          ]),
        ]
      : []),
    ['num', 'params.sunlight.pos.0', -0.4, 0.4],
    ['num', 'params.sunlight.gain', 0, 2],
    ['num', 'params.sunlight.width', 0.05, 2],
  ],
  // Tilted sky ramp + level horizon band (own line) + sun glow.
  'diag-light': (p) => [
    ...colors(p, 0.3),
    ...stops(p, 0.15),
    ...widths(p, 0.02, 0.8),
    ['num', 'params.axis.tilt', p.scene.params.axis.tilt - 12, p.scene.params.axis.tilt + 12],
    ['num', 'params.axis.bend', -1.5, 1.5],
    ['num', 'params.horizonGlow.line.anchor.1', 0.85, 1.2],
    ['num', 'params.horizonGlow.line.tilt', -12, 12],
    ['color', 'params.horizonGlow.color', 0.35],
    ['num', 'params.horizonGlow.intensity', 0, 2],
    ['num', 'params.horizonGlow.lateral', 0, 1],
    ['num', 'params.horizonGlow.lateralWidth', 0.1, 2],
    ...glowLayers(p, 'horizonGlow', 0.01, 1.0),
    ['num', 'params.sunGlow.pos.0', -0.4, 0.5],
    ['num', 'params.sunGlow.pos.1', 0.8, 1.4],
    ['color', 'params.sunGlow.color', 0.35],
    ['num', 'params.sunGlow.intensity', 0, 1.5],
    ['num', 'params.sunGlow.aspect', 0.5, 4],
    ['num', 'params.sunGlow.beta', 0.6, 3],
    ...p.scene.params.sunGlow.layers.flatMap((_, i) => [
      ['num', `params.sunGlow.layers.${i}.0`, 0, 2],
      ['num', `params.sunGlow.layers.${i}.1`, 0.03, 1.5],
    ]),
  ],
  // Vertical ramp with a warped horizon, horizon glow above it, sun glow, sunlight.
  wave: (p) => [
    ...colors(p, 0.2),
    ...stops(p, 0.1),
    ...widths(p, 0.02, 0.6),
    ['num', 'params.horizon.warp', p.scene.params.horizon.warp - 0.3, p.scene.params.horizon.warp + 0.3],
    ['num', 'params.horizon.scale', p.scene.params.horizon.scale * 0.7, p.scene.params.horizon.scale * 1.4],
    ['num', 'params.horizon.phase', (p.scene.params.horizon.phase ?? 0) - 0.4, (p.scene.params.horizon.phase ?? 0) + 0.4],
    ['num', 'params.horizon.reach', 0.03, 1],
    ['num', 'params.horizon.soft', 0, 1.2],
    ['color', 'params.horizonGlow.color', 0.25],
    ['num', 'params.horizonGlow.intensity', 0, 2],
    ['num', 'params.horizonGlow.offset', -0.2, 0.1],
    ['num', 'params.horizonGlow.lateral', 0, 1],
    ['num', 'params.horizonGlow.lateralWidth', 0.05, 1.5],
    ...glowLayers(p, 'horizonGlow', 0.01, 0.8),
    ['num', 'params.sunGlow.pos.0', 0.4, 1.3],
    ['num', 'params.sunGlow.pos.1', -0.1, 0.5],
    ['color', 'params.sunGlow.color', 0.25],
    ['num', 'params.sunGlow.intensity', 0, 2],
    ['num', 'params.sunGlow.aspect', 0.5, 4],
    ['num', 'params.sunGlow.beta', 0.6, 3],
    ...p.scene.params.sunGlow.layers.flatMap((_, i) => [
      ['num', `params.sunGlow.layers.${i}.0`, 0, 2],
      ['num', `params.sunGlow.layers.${i}.1`, 0.03, 1.0],
    ]),
    ...(p.scene.params.sunGlow.occlude !== undefined
      ? [
          ['num', 'params.sunGlow.occlude', 0, 1],
          ['num', 'params.sunGlow.occludeWidth', 0.01, 0.3],
        ]
      : []),
    ['num', 'params.sunlight.gain', 0, 2],
    ['num', 'params.sunlight.width', 0.05, 2],
  ],
  // Same as wave, but the sun stays at the upper right behind the hills and
  // the horizon may tilt.
  'wave-occluded': (p) =>
    [...SPECS.wave(p), ['num', 'params.axis.tilt', -12, 12]].map((e) => {
      if (e[1] === 'params.sunGlow.pos.0') return ['num', e[1], 0.7, 1.1];
      if (e[1] === 'params.sunGlow.pos.1') return ['num', e[1], 0.1, 0.4];
      if (e[1] === 'params.sunGlow.occlude') return ['num', e[1], 0.8, 1];
      if (e[1] === 'params.sunGlow.layers.1.1') return ['num', e[1], 0.25, 1.0];
      return e;
    }),
  'sky-peach-full': (p) => [
    ...colors(p, 0.15),
    ...stops(p, 0.1),
    ...widths(p),
    ...sunlight(),
    ['color', 'params.sunlight.tint', 0.3],
    ['num', 'params.axis.tilt', -6, 6],
    ['num', 'lens.vignette', 1.2, 6],
    ['color', 'params.horizonGlow.color', 0.25],
    ['num', 'params.horizonGlow.intensity', 0.05, 0.4],
    ['num', 'params.horizonGlow.offset', -0.7, -0.2],
    ...glowLayers(p, 'horizonGlow', 0.02, 0.8),
  ],
  'ramp-sun-tilt-vig': (p) => [
    ...colors(p, 0.12),
    ...stops(p, 0.08),
    ...widths(p),
    ...sunlight(),
    ['color', 'params.sunlight.tint', 0.3],
    ['num', 'params.axis.tilt', -6, 6],
    ['num', 'lens.vignette', 1.2, 6],
  ],
  'sky-peach': (p) => [
    ...colors(p),
    ...stops(p),
    ...widths(p),
    ['num', 'params.sunlight.pos.0', 0.6, 2.0],
    ['num', 'params.sunlight.gain', 0, 1.5],
    ['num', 'params.sunlight.width', 0.1, 2.0],
    ['color', 'params.horizonGlow.color', 0.3],
    ['num', 'params.horizonGlow.intensity', 0, 0.6],
    ['num', 'params.horizonGlow.offset', -0.6, 0.05],
    ['num', 'params.horizonGlow.lateral', 0, 1],
    ...glowLayers(p, 'horizonGlow'),
  ],
  'glow-only': (p) => [
    ['num', 'params.sunlight.pos.0', 0.6, 2.0],
    ['num', 'params.sunlight.gain', 0, 1.5],
    ['num', 'params.sunlight.width', 0.1, 2.0],
    ['color', 'params.horizonGlow.color', 0.3],
    ['num', 'params.horizonGlow.intensity', 0, 0.6],
    ['num', 'params.horizonGlow.offset', -0.6, 0.05],
    ['num', 'params.horizonGlow.lateral', 0, 1],
    ...glowLayers(p, 'horizonGlow'),
  ],
};
