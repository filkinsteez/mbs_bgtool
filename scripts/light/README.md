# Light engine harness

Node scripts that render `src/light` scenes in headless system Chrome (Playwright, `channel: 'chrome'`) through a Vite dev server rooted at the repo (`@` points to `src`). Pixels come back to Node over HTTP; Node writes PNGs and composes sheets with sharp. Every output goes under `artifacts/` (gitignored).

No GPU flags are passed. On macOS headless Chrome uses the Metal GPU and has `EXT_color_buffer_float`. If a machine falls back to software rendering, set `LIGHT_CHROME_ARGS="--enable-gpu --ignore-gpu-blocklist"`.

References come from `public/references/awe/manifest.json` when it exists (only entries whose file exists), otherwise from the screenshots in `artifacts/brief-screens/` with their white rounded corners masked. Width and height always come from the image file. Presets are read from `src/light/presets/references/<id>.json`.

## Commands

The same scripts run as `npm run light:check`, `npm run light:audit -- --all` and `npm run light:fit -- --ref <id>` (arguments after `--`).

```sh
node scripts/light/check.mjs [--only hex,determinism,resolution,banding,tone,scatter,context,export,lens] [--out dir]
```

Engine checks in the browser; prints a pass/fail table and exits 1 on a failure. Writes to `artifacts/light-check/`:

- `hex-swatches.png`: flat fields of the 12 pack colors (each must be its exact hex with dither, grain and lens off; also with bloom 0.5; with dither on the mean must be within 0.5 code values).
- `resolution-*.png`: the same scene at 925 px and at the 3840 px long edge, downsampled (mean Oklab ΔE under 0.004 required).
- `banding-ramp-4k.png`, `banding-crop.png`: a 3840x2160 ramp #0B0F14 → #1C2B33 and a 4x crop with and without dither, contrast x8. Reports the banding score, the longest run of equal 8-bit values and how far column means stray from the exact ramp.
- `tone-curve.png`, `tone-curve-onset-zoom.png`: ramps 0 → 16x nominal for every pack color and six primaries, plus glowing dots and lines at 0.5x .. 32x. Checks that the GPU matches the CPU curve, luminance keeps its slope where compression starts, warm colors whiten through yellow (never back toward pink), blues stay within 8° of their hue on the violet side, and hue never jumps.
- `tone-glows.png`: gaussian dots, then vertical gaussian lines, at 1.5x, 3x and 8x nominal for each of the 12 pack colors (one row each, pack order), shown at 2x zoom. This is where a glow crossing 1 would show an edge.
- `grain-strength-0.5.png`, `grain-strength-1.png`: a black-to-white ramp at grain 0.5 and 1, crops of the black end, the middle and the white end at 2x. `grain-<riso id>.png`: the target's densest-ink 160 px crop next to a flat field of that crop's mean color with grain 1, at the reference size (both shown 3x) and at 4K (the target enlarged, the render 1:1). Also checks that strength 0.5 gives about 1.2 % Oklab L at L 0.45 in a 4K export, that a 960x540 preview shows the same grain as the 4K export shrunk to 960x540, and that black stays exactly 0 at strength 1.
- `scatter.png`: the `test.scatter` program (two rims; each disc catches only the other rim's blurred light) with scatter off, at blur 0.06 and at 0.15. Also checks on flat fields that `combine` gets the radiance blur and the aux blur in order, and that the scattered light lands only where `combine` puts it. `test.scatter` is also in the 925 vs 3840 px check.
- `export-vs-preview.png`: a 16:9 export through `exportPreset` (offscreen renderer, PNG encode; checks size, format and file name) downsampled next to a 960x540 preview of the same preset.
- context (no image): loses a context on purpose; `readPixels`, `render` and a new `LightRenderer` on that canvas must throw an error starting "WebGL context lost" (so `exportPreset` throws instead of returning a black PNG). Also prints a 1920x1080 1x render's time with and without `measure: true` (which waits for the GPU with a 1-pixel read).
- `lens.png`: point lights, a line and a disk with the lens off, bloom, halation, and both. Also checks that bloom keeps the mean light of a dim scene.
- `lens-halation.png`: a Meta Blue disk, a thin line and an orange-red dot at 4x on black with halation off and on, at nominal (max channel 1) on black with halation on, and at 4x on a bright background with halation on. Checks that nominal light makes no halation at all and that bright surroundings hold it back.

Lens rules: bloom has no threshold; it mixes the scene with its blur (`mix(scene, bloom, amount)`, per-level weights summing to 1 and tints of luminance 1), so flat fields stay exact and a dim scene keeps its mean light. Halation comes only from light above nominal: per sample of the lens base, luminance times a ramp from max channel `halationThreshold` (at least 1) to twice that; it is added in scene-linear light after bloom, weighted by `exp(-4 Y)` of the pixel it lands on, so it shows on dark surroundings and not on bright ones.
- `report.json`: every result and the run time.

```sh
node scripts/light/tone-study.mjs [--curves old,engine,camera,...] [--out dir]
```

CPU only, about 2 s. Puts the previous engine tone curve (`old`: straight Oklab line to white at constant hue) next to each alternative that was tried, and prints each pack color's hex and Oklab L, C, h at 1x .. 32x. Writes `artifacts/tone-study/glows-<pack>-<curve>.png` (dots and lines at 1.5x, 3x, 8x, 2x zoom) and `ramps-<curve>.png`. `engine` repeats the constants in `src/light/engine/output.ts`.

The engine curve: below max channel 1 nothing changes. Above it the largest channel stays at 1 and the other channels fill toward 1 like a camera's: each at a rate set by its own light plus crosstalk from the others, with one overall rate that keeps the luminance slope continuous at the knee. Orange-red goes orange (2x), yellow (4x), pale yellow (8x), white (16x+); Meta Blue keeps its hue to about 2x, then turns pale cyan-white. Pack colors that are already bright at nominal (Lime, Ice, and less so Cyan and Yellow) have little room above 1, so their glows still level off into a pale disc within a short distance.

```sh
node scripts/light/audit.mjs --ref <id>[,<id>...] | --all
  [--preset <path>]   # with one --ref: audit this preset file instead
  [--size WxH ...]    # extra renders at these sizes
  [--export4k]        # also render at the 3840 px long edge with 1:1 crops
  [--ss 1|2]          # supersample, default 2
  [--out <dir>]       # default artifacts/light-audit
```

For each reference, `artifacts/light-audit/<id>/`:

- `render.png`: the preset at the target's size.
- `compare.png`: target | render | Oklab ΔE heatmap (black 0, white 0.15). Below: row-mean color strips of target (top) and render (bottom), with x = row index, and row-mean Oklab L (solid) and chroma (dashed) for target (white) and render (orange).
- `metrics.json`: see below, plus timings.
- With `--size`: `render-WxH.png`. With `--export4k`: `export-4k.png`, `crop-smooth.png` (the gentlest ramp), `crop-bright.png`, `crop-dark.png`, each also as `*-contrast4x.png`.

`artifacts/light-audit/contact-sheet.png` shows target and render for every reference that has a `render.png` in the out dir.

```sh
node scripts/light/fit.mjs --ref <id>
  [--params a,b,c | all]      # numeric and vector params; `all` skips booleans and integer counts
  [--colors [all | slot,...]] # fit these color slots in Oklab
  [--lens bloom,halation,...] # numeric lens settings
  [--iters 400] [--restarts 2] [--size 256] [--weights image,rows,columns]
  [--preset <path>] [--write] [--out <dir>]
```

Nelder-Mead on values normalized to their ranges, with restarts from the best point at half the step. It renders at `--size` px on the long side (1x, no dither, no grain) in one browser session; the loss is computed in the page. Loss = image ΔE + 0.5 row-profile ΔE + 0.5 column-profile ΔE by default. Prints the loss before and after and writes `artifacts/light-fit/<id>/` (`compare.png`, `render.png` at full size, `preset.json`, `fit.json` with the loss history). Only `--write` overwrites the preset JSON. Look at `compare.png` before keeping a fit: a lower loss can still add a hard edge.

## Metrics (`metrics.json`)

All ΔE values are plain Euclidean Oklab distances (L on 0..1; about 0.02 is one just-noticeable difference). The roadmap's starting targets are mean under 0.03 and p95 under 0.06. Ignore rects and rounded corners are masked everywhere.

- `deltaE`: mean, p95 and max per pixel after area-downsampling both images by 4 and blurring with a gaussian of 1 % of the short edge (removes grain, dither and JPEG blocks).
- `rowProfileDeltaE`, `columnProfileDeltaE`: ΔE between the mean colors of each row (column), averaged and max.
- `histogramDistance`: earth mover's distance between the Oklab L histograms and between the chroma histograms.
- `banding`: share of pixels on monotonic 8-bit steps at least 24 px long (0 none, 1 fully banded), target and render.
- `clipped`: share of pixels with a channel at 255 (`high`) or all channels at 0 (`low`).
- `grain`: robust standard deviation of luma minus its gaussian blur (sigma 2 px), in 8-bit code values.

## Speed (Apple M4 Pro)

- Start-up (Vite, Chrome, page): about 1.2 s.
- One audit at the reference size, 2x supersampled, with metrics and sheet: 0.6 to 1.3 s. `--all` for 14 references: about 16 s.
- One fit evaluation at 256 px: about 12 to 14 ms (render 4.5 ms, loss 7.5 ms, the rest is the page round trip). 500 evaluations take 6 to 10 s.
- `check.mjs`: about 13 s.
- Preview cost, 1920x1080 at 1x, GPU finished (`measure: true`): engine passes with a flat field 2.2 ms; the rest is the recipe's own shader (evaluated once per output pixel and 4 times per pixel of the 512 px lens base).

## Writing recipes and presets

Types are in `src/light/scene.ts`. A recipe file (one per recipe, no imports between recipe files) exports a `RecipeDefinition`: `id`, `mood`, `label`, `colorSlots`, `defaultColors`, `params` (`ParamSpec`: number, boolean or vector, each with key, label, range, step, default), `fragment`, `uniforms(ctx)`, optional `post` passes and `lens` / `output` defaults, and `fromPack(pack)`.

`fragment` is GLSL ES 3.00 that defines `vec3 radiance(vec2 uv, vec2 p)` and returns scene-linear light (may exceed 1). `uv` is the frame position (0..1, y down); `p` is the offset from the frame center in short-side units (y down). Write sizes in short-side units so a preset looks the same at every resolution. The engine prepends its uniforms (`uRenderSize`, `uFrameAspect`, `uPixel`, `uSeed`, ...) and the chunk library in `src/light/engine/glsl/` (hashes, noise, fbm, domain warp, dither, falloffs, SDFs, color helpers, `blurredRamp`, `blurredBands`, `sampleSmooth`). `uniforms(ctx)` maps resolved params and linear slot colors to uniform values; arrays may be passed flat.

Scattered light (`scatter`, for light that a medium inside a shape catches). List up to 4 blurs, each `{ source: 'radiance' | 'aux', radius: (ctx) => sigma }` with the gaussian sigma in short-side units. The fragment then also defines

```glsl
vec3 combine(vec2 uv, vec2 p, vec3 radiance, vec3 blurred0 /*, vec3 blurred1, ... one per entry, in order */)
```

and what it returns is the radiance that post passes, the lens and the tone curve see. `combine` runs at full resolution wherever radiance is evaluated, so it can mask the scattered light with the recipe's own shapes (for example `radiance + k * tint * insideMask(p) * blurred0`). Source `'aux'` blurs `vec3 auxRadiance(vec2 uv, vec2 p)` instead of `radiance`: a second output for blurring only part of the light. It can hold any non-negative data, one value per channel; for example each ring's light in its own channel, so each disc can catch only the other rings' light (`test.scatter` in `scripts/light/harness/testPrograms.ts` does this for two rims). The sources render at a working size whose short side keeps the smallest blur at least 4 px (256 to 1024 px, independent of the output size, so previews and exports scatter the same light); `radiance` sources are clamped at 0, aux values are blurred as they are. Cost: one source render per source kind, one blur per entry, and one cubic texture read per entry per pixel.

A preset is `{ id, referenceId, scene: { recipe, seed, colors, params, lens, output } }`. Missing params take the recipe defaults, missing colors the recipe's default colors.

`output.grain` is one strength 0..1 (`src/light/engine/grain.ts`, ported from `prototypes/grain-study`): mono grain on Oklab L at output size, after the tone curve and before dither, with clump sizes as fractions of the short side so a preview and an export carry the same grain relative to the picture. 0 is off; 0.5 is fine film grain (about 1.25 % Oklab L at mid-tones in a 4K export); 1 matches the riso prints. It fades to 0 at black and eases off toward white. Reference presets use 1 for the three riso prints and 0 for every other reference. Older presets' `grainSize` (px) and `grainChroma` are ignored.

`compose` (optional on a `RecipeDefinition`): `({ pack, controls: { intensity, softness, mood }, seed, aspect }) => { colors, params, lens, output }`, with each control 0..1 and `aspect` = width / height. The tool uses it instead of its fallback mapping in `src/tool/controls.ts`. Colors must be exact hexes of `pack` (or `#000000`); `compositionProblems(recipe, pack, composition)` in `src/light/compose.ts` lists anything wrong, and `src/light/recipes/compose.test.ts` runs it for every recipe with `compose` over 3 packs x 5 seeds x 4 aspects x 27 control settings.
