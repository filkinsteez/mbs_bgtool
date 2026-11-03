# organic-principle

Why the Punch-Drunk Love poster (artwork by Jeremy Blake) and the blurred ridge frame (Figma 33:112) feel organic, and a CPU test of a rule the Sunset looks could follow. The write-up with the evidence and the proposal is [`docs/light/research/organic-principle.md`](../../docs/light/research/organic-principle.md).

## The rule being tested

Build a scene of pack-colored light that is sharp where real things are sharp (the outlines of masses) and soft where light is soft (glows, light fading across the sky), uneven at every scale above the lens size, then look at the whole frame through one out-of-focus lens. Don't draw soft edges one by one.

## Files

| File | What it does |
| --- | --- |
| `shoot.mjs` | Screenshots of the running tool, many queries in one Chrome session (copied from `artifacts/coordinator/one.mjs`, device scale 2). Writes `out/tool/` and `out/tool/shots.json` with the commit and `git status -- src/` at shooting time. |
| `look.mjs` | Scale-space views at a short side of 720 px: blurs at sigma 2 to 64 px, the band-pass layers between them in Oklab L and a/b, and lightness contour maps. Writes `out/look/`. |
| `measure.mjs` | Per image: share of variance a vertical profile explains, RMS of the 2D band-pass layers per octave, spectrum slope, flat share, edge 10-90 widths and shape, edge wander, x/y gradient balance, vertical value structure. `--set tool` (targets and tool shots), `--set proto` (prototype renders), `--dir <folder>`. Writes `out/measure-<name>.json`. |
| `tools-colspec.mjs` | Column power spectra of the targets, to look for the zero a disc blur puts in the spectrum. |
| `render.mjs` | The prototype: `lib/scene.mjs` builds a seeded scene, `lib/lens.mjs` blurs it with one lens in linear light (FFT), then the engine's tone curve (copied in `lib/tone.mjs`). `--layout stack` (Bands-like), `--layout horizon` (Ramp-like), `--variant plain` (same layout, flat straight bands). Writes `out/proto/`. |
| `ablate.mjs` | Same seeds as: scene with no lens, flat bands through the lens, scene through a Gaussian of equal edge width, scene through the disc, and the disc computed at 1/8 size. Writes `out/ablate/`. |
| `lowres.mjs` | Error of the lens computed at 1/8, 1/16 and 1/32 of the output size. |
| `checks.mjs` | Owner-rule checks: dips in lightness between neighbouring band middles (mud), thinnest band and thinnest dark band in lens radii, band thickness change across the frame, narrowest edge against the lens floor, exact hexes at band middles in the flat variant. Writes `out/checks.json`. |
| `sheets.mjs` | Target next to current tool shots next to prototype renders. |
| `summary.mjs` | The measurement table in the doc, from `out/measure-tool.json` and `out/measure-proto.json`. |

`lib/` holds the shared code: `color.mjs` (sRGB, Oklab), `image.mjs` (load and save linear planes), `blur.mjs` (box-cascade Gaussian), `fft.mjs` (FFT, convolution, spectra), `noise.mjs` (the engine's gradient noise and a seeded random), `packs.mjs` (the twelve pack hexes), `tone.mjs` (copy of `toneCurve` from `src/light/engine/output.ts`), `scene.mjs`, `lens.mjs`, `measure.mjs`, `sheet.mjs`, `targets.mjs`.

Reference images are only measured (`look.mjs`, `measure.mjs`, `tools-colspec.mjs`) and shown next to renders in sheets. Nothing in `render.mjs`, `lib/scene.mjs` or `lib/lens.mjs` reads them.

## Run

```sh
cd prototypes/organic-principle
node shoot.mjs out/tool/list.json out/tool        # needs the dev server on :3000
node render.mjs --layout stack --tag pb            # Bands-like, 3 packs x seeds 3,7,12 x 16:9, 9:16
node render.mjs --layout horizon --tag pr          # Ramp-like
node render.mjs --layout stack --variant plain --tag plainb
node sheets.mjs --tag pb --tool bands --name bands
node sheets.mjs --tag pr --tool ramp --name ramp
node look.mjs && node measure.mjs --set tool && node measure.mjs --set proto --out proto
node ablate.mjs && node lowres.mjs && node checks.mjs && node summary.mjs
```

A 960 px render takes 3 to 5 s on the CPU (scene at 2 x 2 samples per pixel, FFT lens).

## Results

Sheets are in `results/` (JPEG to keep each file well under 1 MB). Everything else, including full-size renders, is in `out/` (gitignored).

- `results/bands-9x16.jpg`, `results/bands-16x9.jpg`: poster or ridge frame, then current Bands at seeds 3, 7, 12, then the stacked layout through the lens at the same seeds.
- `results/ramp-16x9.jpg`: ridge frame, current Ramp, the horizon layout through the lens.
- `results/scale-space.jpg`: band-pass layers and contours of the poster, current Bands and the prototype.
- `results/ablate-9x16.jpg`, `results/ablate-16x9.jpg`: what each part adds.
- `results/variant-sharp-everywhere.jpg`: an earlier version with every outline sharp and fine roughness, which the measurements argued against.
- `results/poster-closeup.jpg`: the Etsy copy of the poster at 1:1, as is and contrast-stretched (measurement only).

## Verdict

The rule holds as a direction, with one correction found by measuring: not everything in the scene should be sharp. Outlines of masses are sharp in places; light transitions are soft in the scene; roughness finer than the lens is left out (it comes through the lens as lumps). With that, the prototype has the targets' scale signature (2D structure growing toward large scales, almost nothing at the lens scale), almost no flat area, edges that start at the lens floor and widen where the scene is soft, and the same look at 16:9 and 9:16. The lens can be computed on a grid where its radius is about 6 pixels and upsampled, with no visible difference. A disc and a Gaussian of the same edge width look almost the same; the scene matters far more than the lens shape. See the doc for numbers, sheets, the proposal per look and the risks.
