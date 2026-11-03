# Light engine harness

Node scripts that render `src/light` scenes in headless system Chrome (Playwright, `channel: 'chrome'`) through a Vite dev server rooted at the repo (`@` points to `src`). Pixels come back to Node over HTTP; Node writes PNGs and composes sheets with sharp. Every output goes under `artifacts/` (gitignored).

No GPU flags are passed. On macOS headless Chrome uses the Metal GPU and has `EXT_color_buffer_float`. If a machine falls back to software rendering, set `LIGHT_CHROME_ARGS="--enable-gpu --ignore-gpu-blocklist"`.

The harness page loads each recipe file on its own. A recipe that does not load (often because its owner is mid-edit) only fails the scenes that use it: `check.mjs` prints a note and skips it, `audit.mjs` reports those references as failed and goes on, and the export check is skipped because exports load every recipe. If the page itself cannot start, the harness stops at once with the browser's or Vite's message.

References come from `public/references/awe/manifest.json` when it exists (only entries whose file exists), otherwise from the screenshots in `artifacts/brief-screens/` with their white rounded corners masked. Width and height always come from the image file. Presets are read from `src/light/presets/references/<id>.json`.

## Commands

The same scripts run as `npm run light:check`, `npm run light:audit -- --all`, `npm run light:fit -- --ref <id>` and `npm run light:profile -- --recipe <id>` (arguments after `--`).

```sh
node scripts/light/check.mjs [--only hex,determinism,resolution,banding,tone,scatter,context,export,lens] [--out dir]
```

Engine checks in the browser; prints a pass/fail table and exits 1 on a failure. Writes to `artifacts/light-check/`:

- `hex-swatches.png`: flat fields of the 12 pack colors (each must be its exact hex with dither, grain and lens off; also with bloom 0.5; with dither on the mean must be within 0.5 code values).
- `resolution-*.png`: the same scene at 925 px and at the 3840 px long edge, downsampled (mean Oklab ΔE under 0.004 required).
- `banding-ramp-4k.png`, `banding-crop.png`: a 3840x2160 ramp #0B0F14 → #1C2B33 and a 4x crop with and without dither, contrast x8. Reports the banding score, the longest run of equal 8-bit values and how far column means stray from the exact ramp.
- `tone-curve.png`, `tone-curve-onset-zoom.png`: ramps 0 → 16x nominal for every pack color and six primaries, plus glowing dots and lines at 0.5x .. 32x. Checks that the GPU matches the CPU curve, luminance keeps its slope where compression starts, warm colors whiten through yellow (never back toward pink), blues stay within 8° of their hue on the violet side, and hue never jumps.
- `tone-glows.png`: gaussian dots, then vertical gaussian lines, at 1.5x, 3x and 8x nominal for each of the 12 pack colors (one row each, pack order), shown at 2x zoom. This is where a glow crossing 1 would show an edge.
- `tone-ties.png`: Yellow and Orange-red glows at 1.5x, 3x and 8x, alone and overlapping a Cyan and a Meta Blue glow, so the overlaps run through ties of two channels for the largest. The tie check sweeps the second channel through the largest (0.85 to 1 / 0.85 of it in 0.25 % steps) for every pair of channels at 8 intensities and 5 third-channel levels, and fails if any channel moves more than 3 code values in one step. The slope check above skips colors within 5 % of a tie (Ice and the three secondaries), where the curve gives up an exact slope so that it has no ridge.
- `grain-strength-0.5.png`, `grain-strength-1.png`: a black-to-white ramp at grain 0.5 and 1, crops of the black end, the middle and the white end at 2x. `grain-<riso id>.png`: the target's densest-ink 160 px crop next to a flat field of that crop's mean color with grain 1 and the ink weight below, at the reference size (both shown 3x) and at 4K (the target enlarged, the render 1:1); each must land within 20 % of its print's fine grain. Also checks that strength 0.5 gives about 1.2 % Oklab L at L 0.45 in a 4K export, that a 960x540 preview shows the same grain as the 4K export shrunk to 960x540, that black stays exactly 0 at strength 1, and that a recipe grain weight of 0.25 gives a quarter of the grain, also through a post pass.
- `scatter-cache.png`: a slow smooth layer at every pixel next to the same layer from an unblurred 128 px scatter source; the check also compares a 925 px render with a 3840 px one and times both at 1920x1080.
- `lens-scatter-16x9.png`, `lens-scatter-9x16.png` (`--only lensscatter`): a scene of sharp bands (wavy outlines, a Yellow band exactly 3 R tall, a thin Ice line) with no blur, the gaussian at sigma 0.53 R, the engine's lens and the CPU prototype's lens, at R 0.0825. The checks compare engine and prototype at R 0.045, 0.0825 and 0.12 at both aspects (the CPU input is the sharp scene rendered 4x larger and averaged 4 x 4, padded by repeating the frame edges), measure a horizontal edge's 10-90 width against the prototype kernel's, read the 3 R band's middle, compare 925 px with 3840 px, and time 1080p and the 4K export render with a cheap scene, a slow scene read only through the lens, and the slow scene also read at every pixel.
- `scatter.png`: the `test.scatter` program (two rims; each disc catches only the other rim's blurred light) with scatter off, at blur 0.06 and at 0.15. Also checks on flat fields that `combine` gets the radiance blur and the aux blur in order, and that the scattered light lands only where `combine` puts it. `test.scatter` is also in the 925 vs 3840 px check.
- `export-vs-preview.png`: a 16:9 export through `exportPreset` (offscreen renderer, PNG encode; checks size, format and file name) downsampled next to a 960x540 preview of the same preset.
- speed (no image): for sunset.ramp, sunset.blooms and contour.beam, the 1920x1080 1x time at full resolution and at `radianceScale` 0.5; the 0.5 render must look the same as full resolution (p95 under 0.004) and a 960x540 preview must match the 4K export shrunk to 960x540.
- aspect (no image): a probe program records `ctx.aspect` in `uniforms`, `radianceScale`, a post pass and a scatter radius, at export sizes, at preview sizes the tool would make for each format, and at a 925x1002 reference frame. All four must get the format's exact aspect (the reference keeps 925 / 1002).
- context (no image): loses a context on purpose; `readPixels`, `render` and a new `LightRenderer` on that canvas must throw an error starting "WebGL context lost" (so `exportPreset` throws instead of returning a black PNG). Also prints a 1920x1080 1x render's time with and without `measure: true` (which waits for the GPU with a 1-pixel read).
- `lens.png`: point lights, a line and a disk with the lens off, bloom, halation, and both. Also checks that bloom keeps the mean light of a dim scene.
- `lens-halation.png`, `lens-halation-2.png`: a Meta Blue disk, a thin white-hot line and an orange-red dot at 4x with halation off and on, the blue disk alone at 8x, everything at nominal, at nominal with exposure +2, and at 4x on a bright background. Checks that blue lights at 4x and 8x add no light at all, that white-hot and orange lights get a red-orange halo, that nominal light adds nothing, that exposure counts before the threshold, and that bright surroundings hold the halo back.

Lens rules, all in exposed light (exposure is applied first):
- Bloom has no threshold; it mixes the scene with its blur (`mix(scene, bloom, amount)`, per-level weights summing to 1 and tints of luminance 1), so flat fields stay exact and a dim scene keeps its mean light.
- Halation is fed by each channel's own light above nominal, like film, where only light that reaches the red layer comes back: per sample of the lens base, channel value times a ramp from `halationThreshold` (at least 1) to twice that. `halationTint` is the per-channel strength; the default `#FF9500` is red 1, green 0.3, blue 0, so blue lights make no halo and white-hot lights get orange near, red farther out. Red sits at `halationRadius`, green `halationSpread` x 1.5 levels narrower (default 0.67: one level).
- Halation is added in scene-linear light after bloom, times `1 / (1 + max(Y - 1, 0))` (it does not tint the hot core itself) and `1 / (1 + 4 max(Ys - 0.15, 0))`, where `Ys` is the luminance of the wide surroundings (the scene clamped to nominal, blurred to about 0.06 of the short side). Dark scenes keep the full halo, including inside a recipe's own glow; on a bright background it is held back so it does not tint the background.
- Vignette (`lens.vignette`, 0 by default, up to 1): after bloom and halation and before the tone curve, the exposed light is multiplied by (1 + d²)^(-2 x vignette), where d is the distance from the center scaled to 1 at the corners (a lens's cos⁴ falloff). 1 takes the corners two stops down and the middles of the long edges about 0.6 stop; 0.5 is one stop in the corners. The Lab lists it with the lens settings. `lens-vignette-0.png` (a flat grey) and `lens-vignette-1.png` (sunset.ramp) show 0, 0.5 and 1; the check measures the grey at the center, corners and edge middles against the formula, looks for a step along the diagonal, and compares 925 px with 3840 px.
- `report.json`: every result and the run time.

```sh
node scripts/light/tone-study.mjs [--curves old,engine,camera,...] [--out dir]
```

CPU only, about 2 s. Puts the previous engine tone curve (`old`: straight Oklab line to white at constant hue) next to each alternative that was tried, and prints each pack color's hex and Oklab L, C, h at 1x .. 32x. Writes `artifacts/tone-study/glows-<pack>-<curve>.png` (dots and lines at 1.5x, 3x, 8x, 2x zoom) and `ramps-<curve>.png`. `engine` repeats the constants in `src/light/engine/output.ts`.

The engine curve: below max channel 1 nothing changes. Above it the largest channel stays at 1 and the other channels fill toward 1 like a camera's: each at a rate set by its own light plus crosstalk from the others, with one overall rate that keeps the luminance slope continuous at the knee. Orange-red goes orange (2x), yellow (4x), pale yellow (8x), white (16x+); Meta Blue keeps its hue to about 2x, then turns pale cyan-white. Pack colors that are already bright at nominal (Lime, Ice, and less so Cyan and Yellow) have little room above 1, so their glows still level off into a pale disc within a short distance. Where two channels tie for the largest, the rate that holds the luminance slope would shoot up and whiten the third channel in a thin ridge (Yellow over Cyan at 1.5x, blue along a row went 196, 208, 229, 221, 218; now 196, 203, 207, 215, 218). Within 5 % of a tie each lower channel's share of that rate blends toward a value both sides give alike, so the rate passes through the tie smoothly; colors farther from a tie come out exactly as before.

```sh
node scripts/light/audit.mjs --ref <id>[,<id>...] | --all
  [--preset <path>]   # with one --ref: audit this preset file instead
  [--size WxH ...]    # extra renders at these sizes
  [--export4k]        # also render at the 3840 px long edge with 1:1 crops
  [--isolines [6..10]] # draw Oklab lightness isolines over target and render (default 8)
  [--ss 1|2]          # supersample, default 2
  [--toe 0..1]        # set output.toe on every preset (to compare the paper toe)
  [--out <dir>]       # default artifacts/light-audit
```

For each reference, `artifacts/light-audit/<id>/`:

- `render.png`: the preset at the target's size.
- `compare.png`: target | render | Oklab ΔE heatmap (black 0, white 0.15). Below: row-mean color strips of target (top) and render (bottom), with x = row index, and row-mean Oklab L (solid) and chroma (dashed) for target (white) and render (orange).
- `metrics.json`: see below, plus timings.
- With `--isolines`: `isolines.png` (target | render with the same 6–10 Oklab lightness isolines) and the same pair as a last row of `compare.png`. Levels are evenly spaced between the target's 2nd and 98th lightness percentile; both images are blurred by 0.8 % of the short side first so grain and JPEG blocks do not draw their own loops. It shows whether the render's boundaries curve, drift and change spacing like the target's, or run straight and parallel.
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

```sh
node scripts/light/profile.mjs [--recipe <id>[,<id>...]] [--pack bold] [--seed 3] [--size 1920x1080] [--ss 1]
  [--runs 5] [--defaults] [--json <file>] [--save <dir>] [--against <dir>]
```

Where a recipe's render time goes. Each recipe renders its compose scene (the pack, controls at 0.5, the frame's aspect; with `--defaults` or without a compose, the recipe defaults and the seed), then the same scene with a stub of its program whose shader functions return constants. It prints the time of single renders that wait for the GPU, the time per frame of 10 renders drawn back to back, and a table per stage (scatter sources, scatter blurs, radiance texture, post passes, lens base, lens bloom, lens halation, composite, resolve, output) with the total, the engine alone (the stub) and the difference, which is the recipe's own shader. Compare the back-to-back times: a GPU that sits idle between single renders slows down, so single renders vary more. Stage times come from renders that wait for the GPU after every stage, so they add up to more than a normal render. Other programs drawing on the GPU at the same time slow everything down, so compare runs made one after the other.

`--save <dir>` writes a 1080p 1x preview and a 4K 2x export of each scene (no grain, no dither) and prints preview vs export ΔE. `--against <dir>` renders again and prints ΔE against images saved earlier, which shows whether a speedup changed the image.

### Palette check

```sh
node scripts/light/palette-check.mjs --look <ramp|bands|blooms|rim|halo|beam|streaks|all>[,...]
  [--from <dir> | --dev [--url http://localhost:3000]] [--seeds 8] [--portrait 4] [--maps] [--label text] [--out dir]
  [--rule new|old] [--lens-edge 0.165] [--tails drift|strict] [--at intensity=1,softness=0,horizon=0.3]
```

Checks that every frame reads as its pack: the three packs at seeds 1-8 (16:9) and 1-4 (9:16). Without `--from` or `--dev` it renders the tool's scene (controls at 0.5) with the harness from the checkout the script sits in; to check committed code, run it from a frozen copy of HEAD (`git archive HEAD src scripts public package.json tsconfig.json | tar -x -C <dir>`, with `node_modules` linked), which also gives it each frame's `scene.colors`. `--dev` shoots the dev server (one page at a time, the uncommitted working tree; say so and give the time in `--label`), and `--from` reads `<look>-<pack>-s<seed>-<16x9|9x16>.png` from a folder. It writes `<out>/<recipe>.png` (packs as rows, seeds as columns, a bar under each tile with each pack color's share, clean mixes, pale bridges, white, the dark base and outside colors, failing tiles framed in red), `summary.md` (the failing frames and why), `palette.json`, and with `--maps` a map per frame of what each pixel counted as. Default `--out` is `artifacts/palette-check/<label>`.

How a pixel counts:

- As a pack color when, at its Oklab lightness, it has the color's hue (within 20°) on the color's light path: the color under less light (the tone curve is the identity below nominal) up to its overexposed version through the engine's tone curve. Below nominal it may be at most 35% greyer than the path; pale tints (lighter and greyer, cream for Yellow) count down to L 0.78. Warm colors count down to 1 stop under nominal (Orange-red 1.5 stops), because dimmer they read as olive and brown (`docs/light/research/perception-additive-light.md` 1.4 and 4.5). Dark colors (L under 0.5) count up to 1 stop over nominal, because brighter they read as another color (Forest aquamarine, Plum hot pink). Atmospheric's Ice, Steel, Slate and Near-black share one hue and are told apart by lightness.
- As a clean mix only for the pairs that stay clean in linear light (the same doc, section 5): Meta Blue with Cyan, Forest, Plum or Ice, Yellow with Orange-red, and Atmospheric's greys. Every other pair goes grey, invents a hue (magenta, mint) or turns olive, khaki or brown.
- As a lens edge (the default rule, `--rule new`, from the palette rules in SHARED.md, 2026-11-03): an off-pack pixel on the linear-light mix of two pack colors that both show as areas near their own brightness, which is what the lens makes of an edge between them. It is fine where the band is no wider than the lens's own blur, 2R = 0.165 of the short side at Softness 0.5 (`--lens-edge`; R runs 0.045 to 0.12 with Softness); wider parts count as outside. Third hues (pink, salmon, mauve, mauve-grey, lavender, violet, magenta) are never lens edges, and in Contour the frame's dark base is never one side of one, so a light's tail over the base is still judged as a tail (C-025). `--rule old` turns lens edges off.
- As a warm light's tail (the default, `--tails drift`, from the 9:40 AM decision in SHARED.md): below nominal, an Orange-red, Yellow or Tan light that drifts toward deep red or amber as it dims, or a Lime light that drifts toward Forest's deep green, still counts as that light if it stays at least as pure (hues and chroma-to-lightness limits in `T.tails`). Olive, brown and grey tails are still outside. `--tails strict` turns this off.

`--at` renders other control values (`horizon` or `light` is the mood control); the lens-edge width then follows Softness (2R with R = 0.045 + 0.075 × Softness of the short side).
- As a pale bridge at L 0.78 or more and chroma 0.05 or less, as the dark base below L 0.1, and otherwise as an outside color, named in plain words (pink, magenta, mauve, lavender, salmon, brick, brown, grey-brown, khaki, olive, mint, teal, grey and so on). Only wide outside areas count: whatever is thinner than 6% of the short side (a bridge, a tail) is removed first.

A frame fails when:

- one wide outside area covers 8% of the frame or more, or wide outside areas cover 15% or more;
- Sunset: fewer than three pack colors each cover 5% of the frame, there is no Meta Blue sky, there is no warm color (Bold, Elemental), or Bold shows both Yellow and Orange-red at their own brightness (Yellow's deep tones and Orange-red's pale ones overlap, so they count as one warm light otherwise; Elemental's Lime with Tan is noted as open question 7);
- Contour: 30% of the dark base or 20% of the lit area is outside the pack, or, when the scene is known, 25% of the lit area is a pack color the scene does not light with (counting pixels with Oklab chroma 0.05 or more: a near-grey is no color).

Contour also checks each pack across seeds 1-8 at 16:9: every light color the pack offers (pack colors at L 0.5 or more; for Atmospheric, Meta Blue and Ice) must be a frame's main light at least once. The thresholds (`T` at the top of the script) were set by eye on the coordinator's shots in `artifacts/coordinator/bands-bug`, `palette-now` and `palette-now-contour`.

## Metrics (`metrics.json`)

All ΔE values are plain Euclidean Oklab distances (L on 0..1; about 0.02 is one just-noticeable difference). The roadmap's starting targets are mean under 0.03 and p95 under 0.06. Ignore rects and rounded corners are masked everywhere.

- `deltaE`: mean, p95 and max per pixel after area-downsampling both images by 4 and blurring with a gaussian of 1 % of the short edge (removes grain, dither and JPEG blocks).
- `rowProfileDeltaE`, `columnProfileDeltaE`: ΔE between the mean colors of each row (column), averaged and max.
- `histogramDistance`: earth mover's distance between the Oklab L histograms and between the chroma histograms.
- `banding`: share of pixels on monotonic 8-bit steps at least 24 px long (0 none, 1 fully banded), target and render.
- `clipped`: share of pixels with a channel at 255 (`high`) or all channels at 0 (`low`).
- `grain`: robust standard deviation of luma minus its gaussian blur (sigma 2 px), in 8-bit code values.
- `falloff` (Contour references only; also printed under each audit line and on `compare.png`): how the glow falls off outward from the brightest light. The light is where the target, lightly blurred, is at least half its peak. At 0.01, 0.02, 0.04 and 0.07 of the short side from it, a thin ring is read in target and render on the same pixels (the ring's darker half by target luminance, i.e. the outer side of a rim or line), and the far ring at 0.15 is subtracted as the background. `ratio` is render glow / target glow per distance (above 1: the render's glow is too bright there); `target` and `render` are the glows as shares of each image's light level; `length` is the fitted exponential falloff length of each. A ratio that rises with distance means the render's glow reaches too far; one that falls means it ends too soon.

## Speed (Apple M4 Pro)

- Start-up (Vite, Chrome, page): about 1.2 s.
- One audit at the reference size, 2x supersampled, with metrics and sheet: 0.6 to 1.3 s. `--all` for 14 references: about 16 s.
- One fit evaluation at 256 px: about 12 to 14 ms (render 4.5 ms, loss 7.5 ms, the rest is the page round trip). 500 evaluations take 6 to 10 s.
- `check.mjs`: about 13 s.
- Preview cost, 1920x1080 at 1x, frames back to back (`profile.mjs`): the engine's own passes take 0.7 to 1.7 ms for the Contour recipes, about 1.2 ms of it the scatter blurs; the rest is the recipe's own shader. That runs once per output pixel. With bloom or halation on, 1x frames with a short side of 1024 px or more (up to 2560x1600) build the 512 px lens base from those same samples; smaller frames and 2x renders evaluate the base on its own, 4 samples per base pixel. Scatter sources run the shader again at their working size, 2 x 2 samples per pixel.

## Writing recipes and presets

Types are in `src/light/scene.ts`. A recipe file (one per recipe, no imports between recipe files) exports a `RecipeDefinition`: `id`, `mood`, `label`, `colorSlots`, `defaultColors`, `params` (`ParamSpec`: number, boolean or vector, each with key, label, range, step, default), `fragment`, `uniforms(ctx)`, optional `post` passes and `lens` / `output` defaults, and `fromPack(pack)`.

`fragment` is GLSL ES 3.00 that defines `vec3 radiance(vec2 uv, vec2 p)` and returns scene-linear light (may exceed 1). `uv` is the frame position (0..1, y down); `p` is the offset from the frame center in short-side units (y down). Write sizes in short-side units so a preset looks the same at every resolution. The engine prepends its uniforms (`uRenderSize`, `uFrameAspect`, `uPixel`, `uSeed`, ...) and the chunk library in `src/light/engine/glsl/` (hashes, noise, fbm, domain warp, dither, falloffs, SDFs, color helpers, `blurredRamp`, `blurredBands`, `sampleSmooth`). `uniforms(ctx)` maps resolved params and linear slot colors to uniform values; arrays may be passed flat. `ctx.aspect` is the frame's width / height, for CPU work that depends on the frame (such as calibrating boundaries); `uniforms`, `radianceScale`, post-pass settings and scatter radii all get it. A frame within 2 % of an export format's aspect gets the format's exact value (`frameAspect` in `src/light/engine/frame.ts`, the same number compose gets), so a preview, which the tool sizes in whole pixels, and the export of that format see the same aspect and draw the same picture.

Scattered light (`scatter`, for light that a medium inside a shape catches). List up to 4 blurs, each `{ source: 'radiance' | 'aux', radius: (ctx) => sigma }` with the gaussian sigma in short-side units. The fragment then also defines

```glsl
vec3 combine(vec2 uv, vec2 p, vec3 radiance, vec3 blurred0 /*, vec3 blurred1, ... one per entry, in order */)
```

and what it returns is the radiance that post passes, the lens and the tone curve see. `combine` runs at full resolution wherever radiance is evaluated, so it can mask the scattered light with the recipe's own shapes (for example `radiance + k * tint * insideMask(p) * blurred0`). Source `'aux'` blurs `vec3 auxRadiance(vec2 uv, vec2 p)` instead of `radiance`: a second output for blurring only part of the light. It can hold any non-negative data, one value per channel; for example each ring's light in its own channel, so each disc can catch only the other rings' light (`test.scatter` in `scripts/light/harness/testPrograms.ts` does this for two rims). The sources render at a working size whose short side keeps the smallest blur at least 4 px (256 to 1024 px, independent of the output size, so previews and exports scatter the same light); `radiance` sources are clamped at 0, aux values are blurred as they are. Cost: one source render per source kind, one blur per entry, and one cubic texture read per entry per pixel.

An entry can also set `size: (ctx) => px`, the short side of its own source (8 to 2048), instead of the shared working size. Like that size it does not depend on the output size. A sized source takes one sample per texel, so it is for layers that are smooth at that size, and with `radius: () => 0` it is not blurred: `{ source: 'aux', radius: () => 0, size: () => 192 }` renders `auxRadiance` once at 192 px on the short side and `combine` reads it back with a cubic filter. That is a cache for an expensive smooth layer such as a sky. In `check.mjs` a deliberately slow layer read from a 128 px cache matches the same layer at every pixel within mean ΔE 0.0001 and takes 0.9 instead of 11.9 ms at 1920x1080 1x.

`shape: 'lens'` makes an entry one out-of-focus lens over its source instead of a gaussian: `radius` is the disc radius R in short-side units (Sunset's Softness runs 0.045 to 0.12, 0.0825 at the default), and the kernel matches `prototypes/organic-principle/lib/lens.mjs` with rim 0.35 and stretch 1.1: 65 % a disc of radius R with a one-texel rim plus 35 % a gaussian of sigma R / 2, both 10 % wider than tall, normalized over the taps, in linear light. The source renders at 4 x 4 pixels per grid texel, one sample each, and is averaged down to a grid whose short side is ceil(6 / R), so R is about 6 texels and sharp outlines are averaged over 16 samples before the gather. Past the frame edges it repeats the grid's edge texels, like the other entries. `combine` reads it back with the cubic filter; the grid follows R and the frame's aspect only, so a preview and a 4K export read the same light. For a whole-frame defocus, scatter `radiance` with the lens and return only the blurred light from `combine`:

```ts
scatter: [{ source: 'radiance', radius: (ctx) => ctx.num('lensRadius'), shape: 'lens' }],
// fragment: vec3 combine(vec2 uv, vec2 p, vec3 light, vec3 blurred0) { return blurred0; }
```

The shader compiler then drops the unused full-resolution `radiance` from the composite, so the scene is evaluated only on the grid (16 x 9,500 times at the default R for 16:9). In `check.mjs` a slow scene costs 2.7 ms at 1080p that way and 23 ms when `combine` also reads `light`. A horizontal edge comes out 1.37 to 1.39 R wide (10 to 90 %; the CPU kernel alone gives 1.35 R, the cubic read adds the rest), a band 3 R tall keeps its exact hex in the middle, and the result matches the CPU prototype within a mean of 0.07 to 0.21 Oklab ΔE×100. A vertical edge is 10 % wider (the stretch).

A preset is `{ id, referenceId, scene: { recipe, seed, colors, params, lens, output } }`. Missing params take the recipe defaults, missing colors the recipe's default colors.

Lower-resolution radiance (`radianceScale: 0.5` or `0.25`, or a function of the scene that returns one): for smooth looks. The recipe's radiance renders once at that share of the render resolution, one sample per pixel, and the composite upsamples it with a cubic B-spline before the lens, tone curve and grain; the lens base is made from the same texture instead of evaluating the recipe again. At 1920x1080 1x it takes sunset.ramp from about 21 to 4.5 ms, sunset.blooms from 15 to 5.6 ms and contour.beam from 26 to 4.8 ms, with p95 ΔE 0.0001 against full resolution and the same preview-to-export match (`check.mjs`, `speed`). Features narrower than about 2 / scale render pixels get soft, so keep sharp cores, riso ink edges and thin lines at 1.

Per-pixel grain weight (`grainWeight: true`, and the fragment defines `float grainWeight(vec2 uv, vec2 p)` returning 0..1): it multiplies the grain at each point, so a riso recipe can put strong grain in dense dark ink and less in thin ink and on paper. It travels in the alpha channel to the output pass, also through post passes. A rule that lands the three riso crops within 20 % of their prints at grain 1 (`check.mjs`): weight = ink coverage x saturate((L paper - L ink) / 0.5) in Oklab L, paper at about 0.95.

`output.toe` is the paper toe from `docs/light/research/light-photography.md`, 0 (off, the default) to 1: below nominal the weaker channels fall faster than the largest, so dim Yellow reads amber instead of olive, dim Lime a purer green, dim Orange-red deep red and dim blue navy. Light at and above nominal is unchanged. With the toe on, the engine pre-inverts every slot color (`ctx.colors`, `ctx.color`), so flat pack colors still print their exact hex (`check.mjs`, 12 of 12); a color a recipe builds from `ctx.hex` itself is not pre-inverted. The Lab shows it as Paper toe under the output settings.

```sh
node scripts/light/dim-study.mjs [--out dir]
```

Each warm pack color (Yellow and Orange-red over black and a dim Meta Blue, Lime and Tan over black, Forest and Plum) from 0.05x to 1x nominal, evenly in stops, with the toe off and at 1, plus the hex and Oklch at whole stops; then the contour.beam Elemental scenes whose light is Lime or Tan, toe off and at 1. Writes `artifacts/dim-study/dim-ramps-before-after.png` and `beam-<hex>-before-after.png`.

```sh
node scripts/light/toe-evidence.mjs [--recipe <id>[,<id>...]] [--seeds 1,2,3,4] [--out dir]
node scripts/light/toe-evidence.mjs --preset <path> [--size 960x640] [--out dir]
```

The tool's scene (each recipe's compose, controls at 0.5) for the three packs at 16:9 and seeds 1 to 4, at toe 0 and 1, side by side with 3x crops of the window where the toe changes the picture most; one sheet per recipe, `artifacts/toe-evidence/<recipe>.png`, and the mean Oklab ΔE between the two per scene. With `--preset`, one preset the same way. Recipes change while their agents work, so run it from a frozen copy of HEAD (`git archive HEAD src scripts public package.json tsconfig.json`, with `node_modules` linked) when comparing.

```sh
node scripts/light/control-sweep.mjs --quick [--look ramp,bands]          # before committing control changes
node scripts/light/control-sweep.mjs [--look ramp,...] [--control intensity,softness,horizon|light]
  [--pack bold,...] [--seeds 1-12,5081] [--format 16x9,9x16] [--at intensity=0.75,softness=1,horizon=0.79]
  [--from 0] [--to 1] [--rev HEAD [--patch file] | --tree] [--frames 0:1:0.1] [--strip-all] [--no-strips]
  [--ratio 4] [--floor 0.003] [--peak-floor 0.02] [--label text] [--out dir] [--tool-check http://localhost:3000]
```

Checks that every slider moves the image smoothly. For each look, control, pack, seed and format it steps the control from 0 to 1 by 0.01 (the values the tool's sliders produce), with the other controls at 0.5 unless `--at` sets them, and measures the change per step: the mean Oklab ΔE between neighbouring frames, each rendered at 320x180 (180x320 for 9:16) with 2x supersampling like the settled preview and averaged down to 160x90 in linear light. Scenes come from the tool's own `buildScene` (`src/tool/controls.ts`) with the format's exact aspect, so the frames are what the tool shows; `--tool-check <url>` proves it by loading the tool at three values of the first sweep and comparing its canvas with the harness render at the canvas size (run it on the live tree, without `--rev` or `--tree`; mean ΔE about 0.0015 when the code is the same).

A step is a jump when it is at least `--ratio` (4) times the median of the 12 steps around it (6 on each side) and at least `--floor` (ΔE 0.003), or when its worst 10x10 block of the 160 px frame changes by at least `--peak-floor` (0.02) and 4 times that block measure's median around it, which catches a switch in a small part of the frame. On the owner's example (Ramp, Bold, seed 5081, Intensity 0.75, Softness 1) the land-to-shore switch at Horizon 0.78-0.79 is ΔE 0.143, 28x the steps around it; every other step there is within 2.2x. Each jump gets a strip in `jumps/` (a JPEG: the frames two steps either side, the ΔE per step, and a ΔE map of the jump, white at its 99th percentile) and a line naming the scene params and uniforms that jump with it (those whose change across the jump is more than 4 times their usual change per step, or that switch where they otherwise hold still), which points at the code to fix; "nothing in the scene or uniforms" means the shader itself turns a smooth input into a fast change. `curves/<look>-<format>.png` plots the change per step against the control for every control and pack, one line per seed, log scale, jumps in red. `steps.json` holds every step and jump. `--frames 0:1:0.1` also writes a strip per sweep of frames at those values (`frames/`) and a contact sheet per look, control and format with a row per pack and seed (`contact/`), `--strip-all` a strip around every sweep's largest step. The run exits 1 when it finds a jump or a look does not load.

`--quick` runs seeds 1-6 at 16:9 for all three controls and packs (5,454 frames per look, about a minute) and is the check to run before committing a change to a look's controls or compose. The full default run (7 looks, seeds 1-12 and 5081, 16:9 and 9:16) takes about 13 minutes for the Sunset looks and 16 for Contour. Other agents edit the working tree while a sweep runs, so `--rev <commit>` renders from a copy of that commit (`git archive` of `src scripts package.json tsconfig.json` in the system temp folder, `node_modules` linked; each run makes its own and deletes it at the end) and `--patch <file>` applies a patch to that copy first, to test a change against HEAD alone; `--tree` renders from a copy of the working tree as it is at the start. A frame takes 6 to 12 ms to render (320x180 at 2x), more for the first frames of a look while its shader compiles.

`output.grain` is one strength 0..1 (`src/light/engine/grain.ts`, ported from `prototypes/grain-study`): mono grain on Oklab L at output size, after the tone curve and before dither, with clump sizes as fractions of the short side so a preview and an export carry the same grain relative to the picture. 0 is off; 0.5 is fine film grain (about 1.25 % Oklab L at mid-tones in a 4K export); 1 matches the riso prints. It fades to 0 at black and eases off toward white. Reference presets use 1 for the three riso prints and 0 for every other reference. Older presets' `grainSize` (px) and `grainChroma` are ignored.

`compose` (optional on a `RecipeDefinition`): `({ pack, controls: { intensity, softness, mood }, seed, aspect }) => { colors, params, lens, output }`, with each control 0..1 and `aspect` = width / height. The tool uses it instead of its fallback mapping in `src/tool/controls.ts`. Colors must be exact hexes of `pack` (or `#000000`); `compositionProblems(recipe, pack, composition)` in `src/light/compose.ts` lists anything wrong, and `src/light/recipes/compose.test.ts` runs it for every recipe with `compose` over 3 packs x 5 seeds x 4 aspects x 27 control settings.
