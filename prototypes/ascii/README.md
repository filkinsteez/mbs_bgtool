# ASCII filter prototype

Runs the ASCII stage over tool frames in headless Chrome, before it runs in the engine. Findings and decisions: [`docs/light/research/ascii.md`](../../docs/light/research/ascii.md).

- `filter.ts`: the stage, shaped like the engine's `OutputFilter` (GLSL with `filterAscii`, uniforms, the per-cell grid).
- `runner.ts`: a small WebGL2 runner that builds the per-cell frame source the engine would bind (mean of 4 x 4 samples per cell), runs the stage, encodes and dithers like the output pass.
- `page.ts`, `index.html`: the page. Frames render from a copy of `src/light` at a commit (`artifacts/ascii/head`), so other agents' edits don't break a run.
- `run.mjs`: the commands below. `lib/server.mjs` starts Vite and Chrome (same pattern as `scripts/light/lib/harness.mjs`).
- `glyphs.mjs`, `measure-complex.mjs`: Optimistic VF glyphs drawn at 400 px and measured in em.

```sh
node prototypes/ascii/run.mjs frames                       # 14 tool frames, 2x supersampled -> out/frames/
node prototypes/ascii/run.mjs glyphs                       # stage glyphs next to Optimistic VF -> out/glyphs/compare.jpg
node prototypes/ascii/run.mjs filter --name v4 --strength 1 [--knobs '{"litFloor":0.5}'] [--only ramp-bold-s1]
node prototypes/ascii/run.mjs crops --names v3,v4 --frame rim-bold-s1 --at 160,560 [--size 640x400]
node prototypes/ascii/glyphs.mjs                           # font glyph sheets and measurements -> out/glyphs/
node prototypes/ascii/engine-check.mjs --strength 1 [--skip4k] [--only rim-bold-s1]   # through the engine's chain -> out/engine/s100/
node prototypes/ascii/sheets.mjs                           # out/engine/sheet-full.jpg, sheet-crops.jpg (needs s50 and s100)
```

`engine-check.mjs` renders from a copy of `src/light` at HEAD. While `programRenderer.ts` does not call `prepareOutputFilters` yet, the copy gets `artifacts/grain/programRenderer-filter-chain.patch` (the label in `artifacts/ascii/head/REV` ends in `+chain`).

Versions tried (sheets in `out/filtered/<name>/`):

- v1: dark glyphs made from the pixel's own color scaled down; levels up to the top of the ramp. Bright skies filled with walls of `@`, and dark text over yellow read olive.
- v2: levels capped at 7 so the 5-level window always mixes glyphs (as in the tile); dark ink is a deep, nearly grey shade of the pixel's hue. Sunset matched the tile's look, but thin Contour lights lost their text, and dark bands turned blank with a ghost row of dense glyphs where light glyphs hand over to dark ones.
- v3: the light-glyph floor follows the frame's darkest light; density and contrast both fade at the handover, which is now a clean band. Dark bases still showed lone dots that read as dust.
- v4: text never thinner than level 2 (the tile's sparsest rows), so faint areas fade by contrast instead; gains smoothed with a cubic B-spline between cell centres (no blotches around rims); the light-glyph background keeps 45 %.
