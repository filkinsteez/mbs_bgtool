# Light engine roadmap

We are replacing the old app with a tool that makes background images out of simulated light. First we match the Sunset and Contour moodboard images one to one, to prove the engine can make light that blends without mud. Then we turn that into pack-colored recipes with three sliders, then the app, then filters, then Warp Speed. The brief is in [`BRIEF.md`](BRIEF.md).

## Phases at a glance

| Phase | At the end of it | Status |
| --- | --- | --- |
| 0. Brief, research, references | The brief, the research, and a clean target image for every reference | in progress |
| 1. Engine foundation | A WebGL2 light engine with exact pack colors, lens effects, 4K export, and a harness that compares renders with targets | in progress |
| 1b. Light-model prototypes | CPU prototypes for each recipe, and one chosen model per recipe | in progress |
| 2. Sunset 1:1 | Eight Sunset references recreated from light parameters | next |
| 3. Contour 1:1 | Six Contour references recreated from light parameters | planned |
| 4. Production recipes | Pack-colored recipes on three sliders plus seed, and a preset library | planned |
| 5. The app | The tool non-designers use: Role → Mood → Recipe → Filter → Intensity/Softness → Export | planned |
| 6. Filters | Grain, then ASCII, then Pixel | planned |
| 7. Warp Speed | The third mood | later |

## How an image is made

1. A recipe (for example `sunset.ramp`) writes linear light into a float buffer. Values can go above 1.
2. Optional recipe passes: a directional or radial blur (beams, streaks).
3. Lens: a bloom pyramid with a tint per level (core, glow, haze), then halation (a warm, wide glow from the brightest light, strongest against dark).
4. Exposure and tone curve: a pack color at nominal intensity (the light level at which it should look like its swatch) comes out as its exact hex; brighter light goes smoothly toward white, with no ring where the roll-off starts.
5. sRGB encode.
6. Output filter at output size: grain, then dither before 8-bit.

The deck's rule "Rendered at 2x, filter applied last at output size" means steps 1 to 5 run at twice the export size, the result is downsampled, and step 6 runs at the export size.

Where things live:

| Path | What |
| --- | --- |
| `src/light/color/` | sRGB, Oklab, the three packs |
| `src/light/engine/` | WebGL2 renderer, passes, lens, tone curve and output, export, GLSL chunks |
| `src/light/recipes/` | `sunset/ramp.ts`, `sunset/bands.ts`, `sunset/blooms.ts`, `contour/rim.ts`, `contour/beam.ts`, `contour/halo.ts` |
| `src/light/presets/references/<id>.json` | 1:1 reference presets |
| `src/light/scene.ts` | scene and preset types |
| `scripts/light/` | audit and fit harness (Node, Vite, Playwright with system Chrome) |
| `src/app/lab/`, `src/app/api/light-preset/` | dev-only lab page and preset save route |
| `public/references/awe/` | target images and `manifest.json` |
| `docs/references/awe/` | one notes file per reference |
| `prototypes/<name>/` | CPU light-model prototypes; `out/` is gitignored |

A preset is a recipe name, a seed, a few colors and a few dozen numbers (`{ id, referenceId, scene: { recipe, seed, colors, params, lens, output } }`). Reference images are never read by the renderer.

## How we judge the work

The owner's eye, in a side-by-side review of target and render, decides. Metrics guide the work and catch regressions; they never approve anything. (The old app passed its checks and was rejected; see `docs/archive/HANDOFF.md`.)

Guide metrics. The thresholds are starting values to tune in Phase 1:

- Blurred mean Oklab ΔE: blur target and render with the same Gaussian (σ about 1% of the short edge) to remove grain, skip the manifest's `ignore` areas, and average the Oklab distance. Start with mean under 0.03 and the worst 5% of pixels under 0.06. About 0.02 is one just-noticeable difference.
- No banding at 4K: in 3840 px exports, crops of the longest ramps and darkest falloffs, contrast stretched 4×, show no steps or contour lines.
- No transition darker than both of its neighbors: along the blend between two neighboring colors, Oklab L never drops more than 0.01 below the darker side. A dark band that the recipe puts there on purpose (the poster's black band) is a side, not a blend.
- Exact pack hexes at nominal: a flat field of each of the twelve pack colors, at nominal Intensity with lens and grain off, encodes to its exact hex. This is an automated test.

### The visual audit loop

Every visual change goes through this loop. Code checks alone are not enough.

1. Render: the harness renders the preset at the target's size, and at 4K for banding checks.
2. Compare sheet: target and render side by side, a difference image, row and column profiles, zoomed crops of the horizon, the glow and the darkest area, and the metrics. Sheets go under `artifacts/` (gitignored).
3. Look: open the sheet as an image and write down the three biggest visible differences in plain words before reading the numbers.
4. Adjust: change parameters, by hand in `/lab` or with the fitter, or change the model. Re-render.
5. Check other sizes: render the preset at the other three aspect ratios and two more seeds. It must still look right.
6. Critic review: a second agent that did not make the render looks at the sheet and lists the visible differences, before it sees the metrics.
7. Owner checkpoint: the owner sees the sheets at the end of phases 1b, 2, 3, 4 and 5, for each filter in 6, and in 7. The owner's verdict overrides the metrics.

## Phase 0: brief, research, reference library (in progress)

Deliverables:

- `docs/light/BRIEF.md`, `docs/light/research-artists.md`, `docs/light/research-techniques.md`, `docs/light/README.md`.
- `public/references/awe/<mood>/<id>.png` and `manifest.json` (committed), with text, folds and corners marked as `ignore` areas; `docs/references/awe/<id>.md` notes with color profiles; `scripts/references/`.
- Updated `AGENTS.md` and `.cursor/rules/`; old docs moved to `docs/archive/`.

The owner sees: the brief and research docs, and one clean target per reference.

Done when: every Sunset and Contour reference has a target, a manifest entry and a notes file; the quotes in the brief match Figma; the open questions below are answered or logged.

Risks: the targets are Figma screenshots about 925 px wide, with JPEG banding and blocking. We match structure, color and grain amount, not compression artifacts.

## Phase 1: light engine foundation (in progress)

Deliverables:

- Color math: sRGB to linear and back, Oklab, ΔE, and the three packs with the slide hexes.
- HDR float pipeline in WebGL2: float render targets, recipe pass, post passes, shared GLSL chunks.
- Lens: bloom pyramid with a tint per level, and halation.
- Tone curve: exact at nominal, with a smooth path to white above it.
- Output: grain and dither at output size.
- Export: render at 2x, downsample, filter, PNG at the four preset sizes (16:9 = 3840×2160, 9:16 = 2160×3840, 1:1 = 3840×3840, 4:5 = 3072×3840), seed in the file name.
- Audit harness: renders presets in headless Chrome and writes compare sheets and metrics.
- Parameter fitter: adjusts a reference preset's numbers to lower the blurred ΔE against its target and writes the preset JSON. It reads the target; the renderer never does.
- Dev lab page at `/lab`: pick a reference, see target and render side by side, move the preset's parameters, save.

The owner sees: `/lab` with a reference and its render side by side; a test sheet of the twelve pack colors at nominal and above nominal going to white; a 4K dark ramp with no banding; bloom and halation test images.

Done when: color math and exact-hex tests pass; the owner agrees the lens and tone test sheets look like light through a lens; the harness makes a sheet for every reference in the manifest; the fitter lowers the blurred ΔE on at least two references without visible damage; a downscaled 4K export matches the preview.

Risks:

- Several pack colors have a channel at or near 255 (Yellow `#FFD61E`, Orange-red `#FF4F00`, Ice `#F2F4F7`). That channel has no room left, so the path to white must come from the other channels rising, not from a per-channel curve.
- Rendering at 2x for a 4K export means 7680×4320 float buffers, about 265 MB each at half float. We may need to render in tiles.
- Float render targets need `EXT_color_buffer_float`; support and precision differ between GPUs.
- The fitter can overfit: a preset that matches at the reference size and seed but breaks elsewhere. Step 5 of the audit loop catches this.

## Phase 1b: light-model prototypes (in progress)

Deliverables:

- CPU prototypes in Node, one folder each: `prototypes/sunset-ramp-glow`, `sunset-scattering`, `sunset-diffusion`, `sunset-bands-riso`, `sunset-blooms`, `contour-curve-glow`, `contour-beams`, `grain-study`. Each has a render script, presets, output PNGs in `out/`, and a short README: what it tried, compare images, verdict.
- One chosen model per recipe (`sunset.ramp`, `sunset.bands`, `sunset.blooms`, `contour.rim`, `contour.beam`, `contour.halo`) and one grain model, each with the reason. The shaders are written from these choices.

The owner sees: for each prototype, its renders next to the references; then one page listing recipe, chosen model, reason, and one image.

Done when: every recipe has a chosen model that the owner has seen beside its references.

Risks: CPU results may not carry over to the GPU (blur kernels, precision), so the GPU port gets its own CPU-against-GPU compare. Prototypes can grow into a second engine; each one ends with a decision.

## Phase 2: Sunset 1:1 matches

Deliverables:

- `sunset.ramp` with reference presets for `sunset-sky-peach`, `sunset-red-yellow-arcs`, `sunset-blue-diagonal`, `sunset-violet-wave`.
- `sunset.bands` with reference presets for `sunset-film-poster-bands`, `sunset-green-riso`, `sunset-blue-riso`, `sunset-pink-riso`.
- `sunset.blooms`, which has no reference: no horizon, a few wide blooms, shown in each pack.

The owner sees: eight compare sheets; each preset rendered again at the four aspect ratios and two more seeds; blooms in Bold, Elemental and Atmospheric.

Done when: the owner signs off each sheet; the guide metrics are met; no banding at 4K; no blend darker than both neighbors; no straight horizons; renders at other sizes and seeds still read as sky.

Risks: the riso prints are ink on paper, not light (see the open questions). The poster's bands change along their length, which needs slow horizontal variation without making blobs. The violet-wave ridge must stay a horizon and not become a hill shape.

## Phase 3: Contour 1:1 matches

Deliverables:

- `contour.rim` with reference presets for `contour-rim-edge` and `contour-light-line`.
- `contour.beam` with reference presets for `contour-beam-pool` and `contour-radial-streaks`.
- `contour.halo` with reference presets for `contour-yellow-halo` and `contour-iridescent-rings`.

The owner sees: six compare sheets; each preset at other sizes and seeds; each recipe in each pack.

Done when: the owner signs off each sheet; the falloff has a sharp core and a long tail; overlapping light goes to white; halation is warm and wide with no visible ring; dark areas show no banding at 4K; shapes stay cropped by the frame.

Risks: the rings reference has three rims, and the brief says "one source per image". The yellow halo is light on light, and the brief says "everything else dark". The rim must not read as an object's silhouette. Radial and directional blur at 2x is expensive.

## Phase 4: production recipes with packs

Deliverables:

- Pack rules for each recipe, taken from the deck. Sunset: Meta Blue holds the sky, at most one warm color, bands in pack order. Contour: one source on a dark base. Packs never mix.
- Each recipe's parameters mapped onto Intensity, Softness and one mood control, plus the seed. The seed picks composition details such as the horizon warp, the glow position and the crop.
- A preset library: a few named starting points for each recipe in each pack.

The owner sees: for each pack, a contact sheet of every recipe at the four aspect ratios and several seeds; slider sweeps at 0, 50 and 100 for each control.

Done when: the owner approves the contact sheets; every image follows the deck's "must not" lines; pack hexes are exact at nominal; every slider makes a visible, sensible change across its whole range; in 50 random seeds per recipe, none gives an unusable image.

Risks: three sliders may not reach everything the 1:1 presets do; the 1:1 presets stay as studies. Dark pack colors (Forest, Plum, Slate, Near-black) cannot act as light sources, so they become the base the light sits on, and that needs explicit rules. Elemental and Atmospheric have few bright colors.

## Phase 5: the app

Deliverables:

- The main page with the deck's flow: Role (picks the pack) → Mood → Recipe → Filter and strength → Intensity and Softness, plus the mood control → Export.
- The seed is always visible and editable, with a control for a new seed.
- The four preset sizes, 2x rendering, PNG export with the seed in the file name.
- No color pickers and no status labels or explanatory text.

The owner sees: the tool at `localhost:3000` and the exported PNGs.

Done when: someone who is not a designer makes and exports a usable background without help; the export matches the preview; all four sizes export; the same settings and seed give the same file.

Risks: there is no list of roles yet. Preview speed at 2x on laptops. Export memory at 4K (see Phase 1).

## Phase 6: filters

Deliverables, in this order:

1. Grain, settled first: fine film grain at 1 to 2 percent, added at output size so it never scales with the image, stronger or weaker with brightness, doubling as dither. Off by default until settled.
2. ASCII: the render redrawn as a character grid, pack-colored text on the dark base.
3. Pixel: the render quantized to a coarse grid like an LED wall seen up close, with low contrast.

The owner sees: each filter at strength 0, 50 and 100 on each mood, plus 4K crops.

Done when: the owner approves each filter; a filter changes the surface but not the color (blurred mean ΔE between filtered and unfiltered under about 0.01); grain looks the same size in pixels at every export size.

Risks: ASCII and Pixel can shift the average color or brightness. Grain can read as digital noise instead of film.

## Phase 7: Warp Speed

Deliverables: the refracted column with flame-like edges, long-exposure streaks with a white core, and wide curved spectral bands; 1:1 studies of `warp-long-exposure-streaks`, `warp-refracted-column`, `warp-curved-spectral-bands` and `warp-film-poster-columns`; production presets with pack colors in pack order, Meta Blue the largest band, and pale-tint bridges.

The owner sees: compare sheets as in Phases 2 and 3, and contact sheets per pack.

Done when: as in Phases 2 to 4, plus never the full spectrum, pack order kept, and Meta Blue the largest band.

Risks: light split by a prism makes a rainbow by nature, and every Warp reference shows the full spectrum.

## Open questions for the owner

1. Off-pack colors. The references use colors outside the packs. Our plan: match them 1:1 as studies with colors picked from each reference, and use only pack colors in production. Is that right?
2. Riso prints. The three riso references are ink on paper, not light. Our plan: recreate the light (paper white as the light, color as tinted light) and add print-like grain, rather than simulating ink. Is that right?
3. The poster. We ignore the poster's typography. Its black and grey bands are dark on purpose; in production, should Sunset bands allow a dark band (for example Near-black in Atmospheric), or should bands stay light?
4. Three sliders. Each recipe has a few dozen parameters, and the deck allows three controls plus the seed. Our proposal: Intensity sets how bright the light is (exposure and bloom), Softness sets blur and edge width, the seed sets composition, and the mood control is horizon height for Sunset, light position along the edge for Contour, and direction for Warp Speed. Everything else is fixed per preset. Is that the right split?
5. Volumes. The deck does not map Everyday, Drumbeat and Tentpole to moods or settings. Our reading: Sunset is mostly Everyday, Contour Drumbeat, Warp Speed Tentpole. Is that right?
6. Roles. "Role (which picks the pack)" needs a list of roles and the pack each one picks. Who provides it?
7. One warm color. "One warm color at most" in Sunset: in Bold, is that Yellow or Orange-red per image, never both? In Elemental, do Lime and Tan count as warm?
8. Contour exceptions. The yellow halo is bright overall and the rings show three sources. Should production Contour allow a light base and more than one ring, or keep these as 1:1 studies only?
9. Size and 2x. Is 3840 px on the long edge right for all four presets, and does "rendered at 2x" mean an internal 7680 px render for a 4K export?
10. Grain in studies. Grain is "off by default until it is settled", but the riso references are grainy. We plan to keep grain in the 1:1 studies and leave it off in production until Phase 6. Is that right?
11. Hex sign-off. The owner chose the slide hexes, and slide `33:233` says the non-blue values were eyeballed. Does the brand team need to confirm them before anything ships?
12. Motion. The deck does not mention animation. We plan still images only. Is that right?
