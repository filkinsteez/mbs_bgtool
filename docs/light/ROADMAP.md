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
| 6. Filters | Grain, then Riso, then ASCII (Pixel dropped for now) | researched |
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
8. Side-by-side reviews: a compare agent shoots the tool about every 30 minutes, puts the shots next to the references, critiques them and adds ideas to this roadmap (section "Ideas from side-by-side reviews"). Its sheets, critiques and idea list are in `artifacts/compare/`.
9. Palette check: every review round runs `scripts/light/palette-check.mjs` on all seven looks, not only the ones that changed: three packs, seeds 1 to 8 at 16:9 and 1 to 4 at 9:16, rendered from a frozen copy of HEAD, plus the dev server for looks in the middle of a rebuild, labeled with the time. A frame fails when a wide area is a color outside the pack, when a Sunset frame shows fewer than three pack colors or no warm color, or when a Contour light leaves its color's family as it dims. A pack also fails when a light color it offers never lights a Contour frame across the seeds. Rules and thresholds: `scripts/light/README.md`, "Palette check".

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

Deliverables, in this order. The owner asked on 2026-11-02 for grain, risograph and ASCII, kept simple, with the light staying the focus. The research is in [`research/filters.md`](research/filters.md) (f389655, sheets in `prototypes/filters-research/results/`).

1. Grain, settled first: fine film grain at 1 to 2 percent, added last at output size, stronger or weaker with brightness, doubling as dither. Off by default until settled. Grain size is a fraction of the short side (clumps about 1 px at 4K), because grain fixed to output pixels loses about two thirds of its strength when an export is shown smaller (`prototypes/grain-study/README.md`). The engine's `grain.ts` already does this; it needs the strength slider in the tool.
2. Riso: the same grain pass with its coarse riso-end settings at every strength, so strength 1 looks like the moodboard prints. Left out: dot screens (they read as salt-and-pepper noise or camouflage blotches that bury the light), misregistration (invisible on soft gradients, chromatic aberration on thin rims) and separating the image into pack inks.
3. ASCII: one character per cell, 64 rows on the short side, each pixel keeping its own color. A cell's bright part (the character in dark cells, the background in bright cells) and dim part are weighted so the cell's average light is unchanged. Characters are picked by density only, mixed between neighbours so rows of the same character don't form stripes over a vertical gradient. Strength sets contrast only. The 5×7 pixel font needs no asset. Contour's near-black base and the hottest cores stay free of characters.
4. Pixel: dropped for now. Flat cells turn thin lines into rows of squares, and keeping each pixel's own color still reads as a grid. It can come back as a setting of the ASCII cell pass.

Defaults chosen by the coordinator (easy to reverse; the owner decides at the filter checkpoint):
- Grain stops at fine film grain, and the coarse end belongs to Riso.
- ASCII keeps the exact mean color, so text is dark over Sunset skies and light over Contour's dark base.
- The filter and its strength go in the URL and the file name next to the seed.
- Open for the owner when ASCII is built: whether ASCII is offered on Contour, given the brief's "not a science-fiction interface" rule, and how strong strength 1 is. At 1 in the research, the dim part keeps 30% of the light, the gaps between text lines read as horizontal stripes on flat bands, and small thumbnails come out about one just-noticeable difference darker.

The owner sees: each filter at strength 0, 50 and 100 on each mood, plus 4K crops.

Done when: the owner approves each filter; a filter changes the surface but not the color (blurred mean ΔE between filtered and unfiltered under about 0.01); grain looks the same at every export size when the images are shown at the same size.

Risks: ASCII can shift the average color or brightness, mostly in small thumbnails. Grain can read as digital noise instead of film.

## Phase 7: Warp Speed

Deliverables: the refracted column with flame-like edges, long-exposure streaks with a white core, and wide curved spectral bands; 1:1 studies of `warp-long-exposure-streaks`, `warp-refracted-column`, `warp-curved-spectral-bands` and `warp-film-poster-columns`; production presets with pack colors in pack order, Meta Blue the largest band, and pale-tint bridges.

The owner sees: compare sheets as in Phases 2 and 3, and contact sheets per pack.

Done when: as in Phases 2 to 4, plus never the full spectrum, pack order kept, and Meta Blue the largest band.

Risks: light split by a prism makes a rainbow by nature, and every Warp reference shows the full spectrum.

## Ideas from side-by-side reviews

Added by the compare agent (roadmap step 8). Each entry fixes a gap visible in a round's sheets and says what the owner will see. Sheet paths are under `artifacts/compare/` (gitignored, local), research paths under `docs/light/`. Ids match `artifacts/compare/IDEAS.md`, which has the details.

- **C-001, 2026-11-02, ramp and blooms.** Wrong: the top 40 to 50% of every frame is one flat Meta Blue (`rounds/01/sheets/ramp.png`, `blooms.png`). Change: keep the sky changing up to the top edge, about 1 to 1.5 stops darker at the top and deeper away from the glow, with Meta Blue's exact hex in mid-sky (`research/twilight-sky-color.md` §5 rules 1 and 8). Owner sees: the sky deepens slowly toward the top instead of a flat fill. Area: ramp, blooms. Status: Done for Blooms (round 06); open for Ramp at round 07 (`582259c`): its seed-1 frames vary by 0.06 to 0.11 in Oklab L over the top 40% (sky references 0.11 to 0.18).
- **C-002, 2026-11-02, ramp.** Wrong: arc seeds put a symmetric dome at the bottom center with evenly spaced arcs, like a rainbow (`rounds/01/crops/ramp-seeds.png`). Change: move the dome's center to one side, brighten the sun side with the sideways falloff (twilight note §5 rule 6), and make the widths under the arcs uneven (widest at least 3 times the narrowest). Owner sees: a lopsided glow that fades to one side. Area: ramp. Status: Open in round 06 for seed 1, still a yellow dome low in the middle; seed 6 now has bands instead of a dome (`rounds/06/crops/ramp-seeds.png`).
- **C-003, 2026-11-02, ramp.** Wrong: Atmospheric seed 1 has a round white hot spot at the bottom edge, like a rising sun (`rounds/01/crops/ramp-packs.png`). Change: with Ice as the light, a wide flat glow band whose peak sits a little above the bottom edge. Owner sees: a pale band low in the sky, no white disc. Area: ramp. Status: Done in `667eb6c` (round 02).
- **C-004, 2026-11-02, bands.** Wrong: Elemental seed 1 has a blue-grey seam (`#566674`) between Lime and Tan, darker than both and not a pack color (`rounds/01/shots/bands-elemental-s1-16x9.png`). Change: a dark band between two light bands must be a full pack-color band (Forest), otherwise the two meet through a lighter bridge. Owner sees: no grey seam. Area: bands. Status: Done (round 06), and still holds in the rebuilt Bands at round 07.
- **C-005, 2026-11-02, bands.** Wrong: some seeds are one bright stroke on a flat field (Bold seed 2 reads as a stock light swoosh) or a thin lime line (`rounds/01/crops/bands-packs.png`). Change: at least three visible bands per frame, and glow bands at least about 12% of the frame height tall with soft edges (one may be crisper, never under about 4%). Owner sees: wide soft stacked bands in every seed. Area: bands. Status: Done in `5b1e281` (round 07): every seed is a stack of the pack's colors, and Bold seed 2 is no longer one stroke (`rounds/07/sheets/bands.png`).
- **C-007, 2026-11-02, blooms.** Wrong: every seed has one glow touching the bottom edge or a corner; with Cyan it spreads along the bottom and reads as a horizon (`rounds/01/crops/blooms-seeds.png`). Change: two or three blooms of different sizes per frame, at least one away from every edge, for example a wider and fainter one high on the sun side like the twilight purple light (twilight note §3.4); Cyan blooms stay off the bottom edge. Owner sees: a few soft glows at different heights, no band along the bottom. Area: blooms. Status: Mostly done at round 07: a glow sits away from every edge in Bold seeds 1, 2, 4, 6 and 8; seeds 3 and 5 now have a small Yellow glow in a bottom corner, and seed 7's sits low (`rounds/07/crops/blooms-seeds.png`).
- **C-008, 2026-11-02, blooms.** Wrong: a lavender ring (Oklab chroma up to 0.08 to 0.11) between the glow and the sky in Bold and Elemental (`rounds/01/crops/blooms-packs.png`). Change: add a little pale yellow-white light in the bridge so it passes near-neutral before the blue. Owner sees: a pale grey or cream bridge. Area: blooms. Status: Done in round 06: lavender covers at most 4% of any pack frame (Elemental seed 2, was 11.4%) and 0.5% of the blue-diagonal check.
- **C-009, 2026-11-02, rim.** Wrong: corner seeds show a rounded corner with both edges in frame and an evenly lit far edge, like the corner of a phone or tablet (`rounds/01/crops/rim-seeds.png`). Change: put the vertex at or past a frame edge, let brightness fall 10 to 100 times along the edge away from the hot spot, and light the inside only near the hot spot (`research/halos-and-edges.md`). Owner sees: a curve of light that fades out, not a device corner. Area: rim. Status: Done (round 02), still holds at round 06.
- **C-010, 2026-11-02, rim.** Wrong: line seeds are a straight line with a symmetric pointed glint, like a lightsaber (`rounds/01/crops/rim-seeds.png`). Change: the glow widens steadily along the line from one end, with different width and color on each side, as in contour-light-line. Owner sees: a glow that opens into a soft wedge. Area: rim. Status: Open at round 06 for seed 1: the diagonal line still has a bright, pointed glint in the middle (`rounds/06/crops/rim-seeds.png`).
- **C-011, 2026-11-02, halo.** Wrong: seeds 1, 2 and 4 are a disc filled with light inside a thin bright edge, which reads as a planet seen from orbit (`rounds/01/crops/halo-seeds.png`). Change: most of the light outside the circle, with a long outward falloff (half in about 0.18 to 0.22 of the short side) and a short inward one, and the inside at the base level, as in the yellow-halo reference and natural halos (`research/halos-and-edges.md`). Owner sees: an arc of light around an off-frame source, no lit planet. Area: halo. Status: Mostly done in `680bd1c` (round 06): seeds 1, 2, 4, 5 and 6 are arcs with a crisp inner edge and the light outside; seed 3 is now a filled blue wedge in all packs, part of the logo-crop work in progress (`rounds/06/crops/halo-seeds.png`).
- **C-012, 2026-11-02, beam.** Wrong: every frame is a narrow column ending in a small oval pool on a flat dark fill, a stage spotlight (`rounds/01/sheets/beam.png`). Change: use the structure the 1:1 preset already draws: a column 0.3 to 0.37 of the short side wide, a bright pool line at the beam's width, the floor fan, and haze lit only near the beam. Owner sees: a wide column landing in a bright line with light spreading across the floor. Area: beam. Status: Done in `cfa3779` (round 02).
- **C-013, 2026-11-02, streaks.** Wrong: the shafts and floor stay saturated mid Meta Blue; only a small spot goes pale, so the frame reads dim (`rounds/01/sheets/streaks.png`). Change: the brightest shafts and the floor pool above about 2 times nominal so the tone curve takes them toward pale blue-white, with the far sky and the dark sector kept deep. Owner sees: pale shafts and a white pool over deep blue. Area: streaks. Status: Done in `2ee8771` (round 06): pale blue-white shafts and a white floor pool over a deep sky (`rounds/06/sheets/streaks.png`).
- **C-014, 2026-11-02, streaks.** Wrong: at Intensity 1 the floor hot spot becomes a lumpy blob (`rounds/01/crops/streaks-extra.png`). Change: the hot spot keeps a smooth outline at every Intensity. Owner sees: it grows and whitens without lumps. Area: streaks. Status: Done in `79d2308` (round 02).
- **C-006, 2026-11-02, bands and ramp.** Wrong: sky tops and grounds are flat single hexes (`rounds/01/crops/bands-packs.png`, unchanged in `rounds/02/crops/bands-packs.png`). Change: slow light variation inside flat areas, about ±3 to 5% luminance over 0.3 to 0.5 of the frame width, with the pack hex at the area's mean (owner decision, 2026-11-02). Owner sees: big areas of one pack color look lit instead of flat. Area: bands, ramp. Status: Open at round 06: grounds and the lower sky in Bands are still flat single colors.
- **C-018, 2026-11-02, rim.** Wrong: at the smallest logo size, Bold seed 15 shows the crossing with both loop tops and reads as the Meta logo, not a crop (`rounds/02/crops/logo.png`); seeds 38 and 104 show one loop and read as crops. Change: a logo crop may show at most one of the crossing, the left loop's top and the right loop's top. Owner sees: logo crops that read as a curve of light, never as the mark. Area: rim. Status: Done in `54c4b5b` (round 06): seed 15 is a tight crop around the crossing with neither loop top in frame (`rounds/06/crops/logo.png`).
- **C-019, 2026-11-02, beam.** Wrong: seed 1 has a narrow dark bar with straight, hard sides across the floor, like the shadow of a pole (`rounds/02/crops/beam-packs.png`). Change: the dark part of the floor fan is one soft wedge centered under the pool that widens downward between two broad rays, as in the reference. The beam-pool 1:1 preset draws the same flat-topped, straight-sided dark strip straight under the pool, where the reference's dark middle has a soft rounded top that starts a little below the pool line (`rounds/02/crops/beam-pool-floor-target-vs-render.png`), so the fix belongs in the floor code both use, and the 1:1 audit can check it. Owner sees: light spreading across the floor with no shadow bar. Area: beam. Status: Done in `582259c` (round 07): the dark floor bar is gone, and the pool line has no step (`rounds/07/sheets/beam.png`).
- **C-020, 2026-11-02, blooms.** Wrong: since round 03, seed 1 in every pack is plain Meta Blue with a small light patch in the corner: share at Oklab L 0.8 or higher Bold 1.9%, Elemental 2.0%, Atmospheric 0% (round 02: 9.3%, 9.5%, 4.5%), and Yellow and Ice no longer appear (`rounds/04/crops/blooms-packs.png`). Change: every seed keeps at least one glow whose core reaches the pack's light color and rolls toward white, as the seed 2 frames do. Owner sees: seed 1 shows a clear yellow, cream or ice glow again. Area: blooms. Status: Done in `d666044` (round 06): seed 1 is 30.6% bright in Bold, 22.1% in Elemental and 21.0% in Atmospheric, with Yellow and Ice back.
- **C-021, 2026-11-02, blooms.** Wrong: the violet-wave look check lost its violet. Where the target is pink-magenta (Oklab hue 325) over the ridge and violet (293) above the ground, the render is blue (269 and 268), more saturated than the target. `1360a3d` dims a glow's faint light over a dark area and `7f93c69` gives it the dark area's hue; both remove the violet (`rounds/04/sheets/blooms-1to1.png`). Change: a glow's light adds to what is behind it and keeps its own hue; avoid the grey with extra bridge light instead of re-coloring the glow (AGENTS.md: light from every point of a source adds up). Owner sees: the ridge frame's violet and pink glow comes back, and glows keep their color over dark areas. Area: blooms. Status: Done for the look check in round 06: violet covers 19.3% of the frame (target 12.3%) and the ridge edge sits at 0.56, 0.58 and 0.51 of the height (target 0.57, 0.52, 0.54).
- **C-022, 2026-11-02, blooms.** Wrong: the blue-diagonal look check's warm band is pale peach over mauve: its warmest 5% of pixels have chroma 0.083 and L 0.87 against the target's 0.141 and 0.80 at the same hue, and orange covers 0% of the frame against 7.8% (`rounds/04/sheets/blooms-1to1.png`). Change: keep the warm glow's own chroma in its core and lower part, with the pale bridge only on the sky side. Owner sees: the bottom of the blue-diagonal check reads orange, as in the reference. Area: blooms. Status: Mostly done at round 07: orange covers 6.4% of the frame (target 7.8%), and the warmest pixels have chroma 0.115 (target 0.141); mean ΔE 0.0184.
- **C-023, 2026-11-03, ramp.** Wrong: in the palette check of committed code, all 36 Ramp frames fail. Each shows Meta Blue and one pale glow, never three pack colors. Bold seeds 3 and 8 add wide purple and mauve bands (28 to 35% of the frame). Elemental's cream glows register as no warm color, and Atmospheric shows Meta Blue with at most Ice (`rounds/05/palette/head-6b8e24f/sunset.ramp.png`). Change: each frame lights at least three pack colors as areas, with one warm color: in Bold, Meta Blue, Cyan and one of Yellow or Orange-red; in Atmospheric, Meta Blue, Ice and a grey. Owner sees: every Ramp seed reads as its pack. Area: ramp (rebuild in progress). Status: Open at round 07, better: 24 of 36 Ramp frames fail (round 06: 31). Cyan now shows in Bold seeds 2 to 5, but Bold seeds 1, 7 and 8 still show two pack colors, seeds 3 and 6 have wide salmon or mauve, and all 12 Elemental frames fail (`rounds/07/palette/new-rule/sunset.ramp.png`).
- **C-024, 2026-11-03, blooms.** Wrong: all 36 Blooms frames fail the palette check. Each shows Meta Blue and at most one glow color: in Bold, Yellow or Cyan, never both. Elemental's glows have no Tan or Lime area, and Atmospheric is Meta Blue with at most Ice (`rounds/05/palette/head-6b8e24f/sunset.blooms.png`). Change: at least three pack colors as areas of light per frame, with one warm color (Bold: a warm bloom and a Cyan bloom over Meta Blue). Owner sees: Blooms frames read as their pack. Area: blooms. Status: Open at round 07, much better: 17 of 36 Blooms frames fail (round 06: 36). Bold fails only seeds 3 and 5 and Atmospheric 3 frames, but Elemental still shows only Meta Blue and one glow in all 12 (`rounds/07/palette/new-rule/sunset.blooms.png`).
- **C-025, 2026-11-03, rim, halo, beam and streaks.** Wrong: a warm light's wide dim haze reads brick, olive or grey-brown, so 44 of 96 Bold and Elemental Contour frames fail the palette check, all with Orange-red, Yellow, Lime or Tan light. For example, the Lime beam (Elemental seed 3) is 39% olive, the Lime streaks (seed 6) 86% olive, and the Orange-red streaks (Bold seed 4) 90% brick. Cool lights and all of Atmospheric pass (`rounds/05/palette/head-6b8e24f/contour.*.png`). Change: a warm light's dim tail keeps a warm, saturated color, turning toward orange-red as it fades as in `contour-light-line`, instead of the core's color at low light (`research/perception-additive-light.md` 4.5 and 7.3), and its haze over the dark base stays small. Owner sees: warm Contour lights glow on black with no brown or olive fog. Area: rim, halo, beam, streaks. Status: Done for Orange-red at round 08 (`817d09f`, warm toe in `b616d1a` and `9d58cb6`): its tail is now deep red in all four looks (hue 30 to 32, chroma per lightness 0.38 to 0.40 against the nominal 0.33). Open for the others: Yellow's tail is still dark yellow-olive (hue 81 to 87; amber is about 45 to 80), Tan's is brown (hue 45 to 71), with maroon on Beam's Plum base, and Lime's is olive (hue 116 to 129); Beam's dim Lime tail is greener (149, as in round 07), but most of its lit area still reads olive. Palette check with the 9:40 tail rule: Rim 6, Halo 13, Beam 7, Streaks 8 failing frames (`rounds/08/crops/tails.jpg`, `rounds/08/palette/tails-drift/`).
- **C-026, 2026-11-03, beam, streaks and rim.** Wrong: across seeds 1 to 8 at 16:9, Bold beam lights with Meta Blue in 6 seeds and Orange-red in 2, and Bold streaks with Meta Blue in 7 and Orange-red in 1, never Cyan or Yellow. Bold rim never uses Yellow, and Elemental streaks never shows Lime as Lime, because both Lime frames read olive (`rounds/05/palette/head-6b8e24f/contour.beam.png`, `contour.streaks.png`, `contour.rim.png`). Change: across seeds, each look lights with every light color its pack offers. Owner sees: Cyan and Yellow beams and streaks in Bold. Area: beam, streaks, rim. Status: Done for Beam and Streaks in `9d58cb6` (round 08): every pack light is the main light at least once in seeds 1 to 8 (Bold Beam: Meta Blue 1, Cyan 4, Yellow 1, Orange-red 2; Bold Streaks: 2, 3, 2, 1). Open for Rim, where Bold still never uses Yellow; Halo uses every light.
- **C-027, 2026-11-03, halo.** Wrong: halo seed 3 is a filled blue wedge in every pack, lit inside, with straight sides and a sharp corner at the top left (`rounds/06/crops/halo-s3-check.png`, unchanged at round 07). The brief forbids object silhouettes, complete geometric shapes and hard edges in Contour: a dark side may be crisp along a curve, but a frame must not read as a filled shape with straight hard sides or a sharp corner. Change: seed 3 gets a curve whose light lies outside it, as in the other halo seeds, with no straight sides and no corner. Owner sees: halo seed 3 reads as light around a curve, not a blue sail. Area: rim and halo. Status: open at round 08 (seed 3 unchanged).
- **C-028, 2026-11-03, bands.** Wrong: at Intensity 1, Elemental's lime band turns near-white across the full width in all four seeds checked. Its brightest row is `#FFFFD1` to `#FFFFD3` (Oklab L 0.99, chroma 0.06) with no pixel below L 0.984, against `#D9F280` to `#DCF381` (L 0.92, chroma 0.14 to 0.16) at the default (`rounds/08/sheets-bands-controls-elemental.jpg`). Rule: "Intensity never makes a flat full-width white band; white appears only near the light" (SHARED.md, 9:40 AM). Change: at high Intensity the band keeps its color and whitens only near the light. Owner sees: more daylight at Intensity 1 without a white stripe across the frame. Area: bands. Status: new.

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
