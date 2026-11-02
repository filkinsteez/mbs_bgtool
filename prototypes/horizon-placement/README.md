# horizon-placement

Where the Sunset looks put the horizon and the light today, what the targets do (sea 33:106, riso 33:109, ridge 33:112, poster 33:113), and CPU sketches of a shared horizon placement: open sky, water or land below a line that can sit anywhere from a quarter of the way down to below the frame. The write-up is [`docs/light/research/horizon-placement.md`](../../docs/light/research/horizon-placement.md).

Run from the repo root (Node 24, `sharp` and `playwright` from the repo; the dev server on :3000 for the shots):

```sh
node prototypes/horizon-placement/shoot.mjs [look ...] [pack ...]   # 432 shots -> out/shots/ (skips existing)
node prototypes/horizon-placement/measure-shots.mjs                 # -> out/shot-measures.json
node --import ./prototypes/horizon-placement/lib/ts-register.mjs prototypes/horizon-placement/code-placement.mjs   # -> out/code-placement.json
node prototypes/horizon-placement/summary.mjs                       # numbers for the doc
node prototypes/horizon-placement/plot.mjs                          # results/current-*.png, results/fresnel-vs-sea.png
node prototypes/horizon-placement/measure-sea.mjs                   # target numbers (also measure-riso.mjs, measure-ridge-poster.mjs)
node prototypes/horizon-placement/targets.mjs                       # results/targets-measured.png
node prototypes/horizon-placement/render.mjs                        # proposal sketches -> results/
node --import ./prototypes/horizon-placement/lib/ts-register.mjs prototypes/horizon-placement/check-tone.mjs      # lib/tone.mjs = engine tone curve
```

`lib/ts-register.mjs` lets Node import the app's `.ts` files with type stripping (extensionless imports resolve to `.ts`). It only reads `src/`.

## Files

- `shoot.mjs`: one Chrome page per shot, kept once two screenshots 600 ms apart match. Writes `out/shots/<look>-<pack>-<format>-s<seed>-h<horizon>.png` and a `meta-*.json` with the commit and `git status --short -- src/` before and after.
- `measure-shots.mjs`: per shot, the brightest row (rows smoothed over 2% of the height), the light center (luminance blurred over 12% of the short side), the strongest drop in light going down (counted as a horizon under 0.65) and the sharpest Oklab color edge.
- `code-placement.mjs`: the horizon and light positions the compose code asks for, seeds 1-64, Horizon 0 to 1 in quarters.
- `measure-sea.mjs`, `measure-riso.mjs`, `measure-ridge-poster.mjs`: target measurements for the notes; outputs in `out/sea.txt`, `out/riso.txt`, `out/ridge-poster.txt`. Reference pixels are only measured; no renderer reads them.
- `lib/scene.mjs`: the sketch renderer. A sky of added light (Meta Blue, one warm light reddened near the horizon, a pale bridge, a wide flat glow around the sun) and below the line: `sky`, `water` (sky mirrored, squeezed 1.25×, smeared, Fresnel with a long-lens scale, plus the water's own light), `shore` (a far bank over water), `bank` (flat land) or `ridge`. Linear RGB, pack hexes only.
- `lib/bands.mjs`: a Bands-style sketch (flat bands laid over each other through soft edges, one crisp edge) with optional mirrored bands below the horizon.
- `lib/tone.mjs`: copy of the engine's `toneCurve` (`check-tone.mjs` confirms it matches on 20,000 colors).
- `render.mjs`, `plot.mjs`, `targets.mjs`: the sheets. `try.mjs`: quick tuning sheet (`out/try.png`).

## Results

All under 1 MB, committed:

- `current-distribution.png`: horizon (code), light (code) and brightest row (shots) against the Horizon control, per look, with the targets' heights.
- `current-typical.png`: Bold 16:9 seeds 1-4 and an Elemental 9:16 shot per look at Horizon 0, 0.5, 1, with the horizon and brightest row ticked.
- `targets-measured.png`: the targets with the measured heights marked.
- `fresnel-vs-sea.png`: the sea's reflection brightness against water's Fresnel reflectance.
- `proposal-bold.png`, `proposal-elemental.png`, `proposal-atmospheric.png`: water, ridge and flat land (shore or bank) at 30, 50, 70%, next to the targets.
- `proposal-tall.png`: the same in 9:16.
- `reflection-vs-sea.png`: sketches with the horizon at the sea's 72%.
- `mud-check.png`: which lights can be reflected without khaki or olive.
- `sideways.png`: the scan as scanned and turned, and turned sketches.

The sheets' tiles are encoded without dither so the PNGs stay small; the tiles are too small to band.

## Shot record

- Ramp: 23:24-23:31 UTC, commit `8bb0b9a`. Bands: 23:30-23:36, `8bb0b9a` then `1360a3d`. Blooms: 23:37-23:44, `1360a3d` (resumed once after a page reload timed out).
- `git status --short -- src/` during the shots: modified `contour/curveCompose.ts`, `curveLight.ts`, `halo.ts`, `rim.ts`, `streaks.ts`; `sunset/bands-compose.ts`, `bands-light.ts`, `bands-params.ts`, `bands.ts`, `blooms-compose.ts` (from 23:36), `blooms-light.ts` (until 23:36), `blooms.ts`, `ramp-compose.ts`, `ramp-shader.ts`, `ramp.ts`; untracked `sunset/ramp-boundary.ts`. The dev server rendered that uncommitted work.
- Code positions were read at `1360a3d` plus the same uncommitted work, at 23:44 UTC. `f251b06` (Bands) landed after the shots.

## Verdict

- The current looks keep the light at the bottom edge. Ramp shows a horizon for only 1 seed in 4 (62-88% down); Bands always shows one (30-90%) with land below; Blooms has none.
- One shared horizon height (Horizon 0: below the frame, 0.5: two-thirds down, 1: a quarter down) with open sky, water or land below works at all three heights in the sketches, in both formats, with every pack, as long as land does not fill more than about half the frame (far shore over water when the line is high) and the reflected light dims cleanly (Orange-red, Ice, Tan over Plum; not Yellow or Lime).
- Water stays light with a long-lens Fresnel scale (bottom of the frame 8-12° below the horizon) and the water's own light as a dark pack color; the sea photo's dimming matches Fresnel for a 25-30° lens.
- Sideways suits Bands only, and is the owner's call.
