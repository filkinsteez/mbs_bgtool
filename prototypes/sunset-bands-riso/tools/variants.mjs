// Writes light-only variants of the reference presets to out/variants/ for the
// README comparison: the same band structure with mixN = 1 (linear light),
// as translucent layers over the base ("over") or as added light ("add").
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HERE } from '../refs.mjs';

const dir = join(HERE, 'out', 'variants');
mkdirSync(dir, { recursive: true });
const load = (name) => JSON.parse(readFileSync(join(HERE, 'presets', `${name}.json`), 'utf8'));
const save = (preset, suffix) => {
  const out = { ...preset, id: `${preset.id}.${suffix}` };
  const path = join(dir, `${out.id}.json`);
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(path);
};

// Linear-light "over": every layer is a translucent light layer over the base.
for (const name of ['ref-sunset-green-riso', 'ref-sunset-blue-riso', 'ref-sunset-pink-riso', 'ref-sunset-film-poster-bands']) {
  const p = load(name);
  p.scene.params.mode = 'over';
  p.scene.params.mixN = 1;
  for (const b of p.scene.params.bands) delete b.op;
  save(p, 'light-over');
}

// Additive light for the green: black base; paper, green and mustard are
// emitters whose edges meet, so the blurred bands sum to one across each edge.
{
  const p = load('ref-sunset-green-riso');
  const k = { shape: 'box', soft: 0.15 };
  p.scene.params = {
    mode: 'add',
    mixN: 1,
    base: '#000000',
    kernel: k,
    light: { x: -0.05 },
    bands: [
      { color: 0, top: -1, bottom: 0.1918, softUp: 0.172, softDown: 0.172, tiltDown: -0.04 },
      { color: 1, top: 0.1918, bottom: 0.7981, softUp: 0.172, softDown: 0.2038, tilt: -0.04, tiltDown: 0.08, grain: 0.053 },
      { color: 2, top: 0.7981, bottom: 2, softUp: 0.2038, softDown: 0.2 },
    ],
    grainSize: 1.3,
  };
  save(p, 'light-add');
}

// Additive light for the poster: black base, bands and blooms as emitters.
{
  const p = load('ref-sunset-film-poster-bands');
  p.scene.params.mode = 'add';
  p.scene.params.mixN = 1;
  for (const b of p.scene.params.blooms) delete b.opacity;
  save(p, 'light-add');
}
