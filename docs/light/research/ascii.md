# ASCII filter: what the examples show and what the filter does

Started 2026-11-04. Prototype: `prototypes/ascii/` (README there). Downloads and crops: `artifacts/ascii/` (local, gitignored).

## Where the examples are

The only ASCII examples are the stand-in tiles on the deck's filter slides. The moodboards (63:658, 63:659, 63:660), the loose images on page 26:2 and `public/references/awe/` have none.

| Node | Slide | Font | Caption |
| --- | --- | --- | --- |
| `26:245` | 26:237 "11 Filters" (older deck) | Roboto Mono Regular | "The render re-drawn as a character grid, pack-colored text on the dark base. The developer and builder surfaces." |
| `33:244` | 33:236 "11 Filters — Optimistic VF" (older deck) | Optimistic VF Regular | same |
| `44:275` | 44:267 "12 Filters — Optimistic VF" (current deck) | Optimistic VF Regular | "The render redrawn as a character grid, pack-colored text on the dark base. Reads as code, terminal, machine." |

The older slides add: "The ASCII and pixel tiles are stand-ins drawn in Figma; the tool renders the real thing from the frame buffer." (26:294, 33:293). The current slide drops that line.

All three tiles hold the same 26 lines of 68 characters. The text sits over the slide's sky photo at 35 % opacity on white. Only the font and the text color change between them.

Files: `artifacts/ascii/figma/44-275-ascii-tile-4x.png` (2176 x 1760), `44-275-ascii-tile-1x.png`, `26-245-ascii-tile-robotomono-1x.png` (the 4x export of 26:245 was blocked by the approval check twice), `44-267-filters-slide.png`, crops `crop-4x-*.png` and `zoom-4x-*.png`.

## Measurements

Cell size
- The tile is 544 x 440 px. The text is 13 px with line height 1.3, so rows are 16.9 px: 26 rows on the 440 px short side.
- Roboto Mono advances 0.6 em, so cells are 7.8 x 16.9 px: 0.6 x 1.3 em, width / height 0.46.
- At 1080p that is a 41.5 px row, a 32 px font and 19.2 px columns: 100 x 26 cells at 16:9. At 4K, 83 px rows.
- The Optimistic copies use the same size and line height, but Optimistic is proportional, so their columns do not line up. Roboto Mono, the original, is a true grid.

Glyphs
- The ramp is Paul Bourke's ` .:-=+*#%@` (10 levels), Regular weight.
- Glyphs are picked by brightness, not by edge direction. There are no edge glyphs (`/ \ | _`).
- Each row picks uniformly at random from a window of 5 neighbouring levels. Every row's standard deviation is 1.32 to 1.52 levels; a uniform pick over 5 levels gives 1.41.
- The window moves up one level every 4 or 5 rows. Rows 1–5 use levels 0–4, then 1–5, 2–6, 3–7, 4–8, and rows 23–26 use 5–9. The mean level goes from 2 to 7 top to bottom.
- Even the densest rows mix `+ * # % @`; no row is all `@`. Even the sparsest rows are only about 20 % spaces.
- The density follows the lightness of the sky underneath. Its Oklab L goes from 0.50 to 0.79 over the rows, and the mean level is about 17.6 L − 6.9: level 0 near L 0.39, level 9 near L 0.90. Brighter means denser.

Color
- The text is one fixed color, not the image's: `#17171A` in the Roboto Mono tile and `#1C2B33` in the Optimistic tiles (Atmospheric's Near-black).
- Between the glyphs is the image itself, faded toward white (35 % image, 65 % white). It is neither black nor dimmed.

Levels, grain, gradients
- There are 10 glyph levels and no grain or dither under the text; the sky photo is smooth.
- The 5-level random window hides the steps between glyphs: no row is one glyph, so a gradient reads as a gradual change in density. The window's step every 4 or 5 rows shows only faintly.

Optimistic VF Regular glyph shapes (em, from `src/fonts/OptimisticVF.ttf` drawn at 400 px; `prototypes/ascii/glyphs.mjs`, `measure-complex.mjs`)
- Strokes are 0.07 to 0.08 thick.
- `.` and `:` are round dots 0.13 across, at heights 0.06 and 0.455.
- `-` is 0.335 x 0.08 at height 0.27. `=` is two 0.42-wide bars at 0.25 and 0.45. `+` is 0.43 across, centred at 0.35.
- `*` is five arms 0.2 long around (0, 0.53).
- `#` has uprights slanted 12° and bars at 0.215 and 0.4875.
- `%` is two oval rings, 0.35 x 0.39 outside, with a slash at 40°.
- `@` is a 0.8-wide ring, open at the lower right, around a single-storey `a`.
- `%` (0.85 em) and `@` (0.88 em) are wider than a 0.6 em monospace cell.

## What the filter does

It is a stage of the output filter chain (`src/light/engine/filters/`), after the tone curve and before the sRGB encode and the dither.

Grid and glyphs
- There are 26 rows on the short side, with whole cells across and down. The cell count depends on the frame's aspect only: 100 x 26 at 16:9, 56 x 46 at 9:16.
- A 4K export therefore has the same characters in the same places as the preview, only sharper.
- Glyphs are drawn in the shader as shapes, with Optimistic's proportions measured above. `#`, `%` and `@` are narrowed to the 0.6 em cell the way a monospace font narrows them, keeping the stroke.
- The edges are filtered over one output pixel, so glyphs stay crisp at every size. No font file and no DOM text are used.

Per cell
- The engine gives the filter each cell's mean light: the frame source, 4 x 4 samples per cell.
- The cell aims for a level of the ramp, sorted by measured ink. Its glyph is picked uniformly from a 5-level window around that level, seeded per cell, as in the tile.
- Ink share of a 0.6 x 1.3 em cell for the shader's glyphs: `.` 1.7 %, `:` 3.3 %, `-` 3.4 %, `+` 7.9 %, `=` 8.6 %, `*` 8.6 %, `#` 20.2 %, `%` 24.4 %, `@` 31.5 %.
- Levels stay between 2 (the tile's sparsest rows) and 7 (its densest), so text is always a mix of glyphs.

Color: the filter changes the surface, never the color
- Each pixel keeps its own light; glyph and background split it.
- In dark cells the glyph is light and carries the cell's light, with the background dimmed. This is the caption's "pack-colored text on the dark base": a Contour light becomes text in its own color.
- In bright cells the glyph is dark ink, a deep, nearly grey shade of the pixel's hue like the tile's `#1C2B33`, and the background brightens by the light the ink takes. This is the tile's dark text over a sky.
- The gains follow the cell light smoothed between cell centres (cubic B-spline), so backgrounds show no cell edges. They keep each cell's mean light for the glyph mix its dither gives.
- Light glyphs start a little above the frame's darkest light (the dimmest of 8 x 5 cell lights), so a dark base stays clean whatever its color: black, Slate or Forest.
- Dark ink thins out and fades as the brightest channel runs out of room above it, so Yellow and white glows stay clean light.
- Light and dark glyphs hand over through a clean band where both fade.

What differs from the tile, on purpose
- **Density direction on bright skies.** The tile's dark text is densest where its sky is brightest. With dark ink that darkens the glow, which the brief rules out ("It changes the surface, never the color"). Here dark ink is densest where a bright cell has the most room (deep sky) and thins out into the glow.
- **Background.** The tile fades its sky to 35 % on white so dark text reads on a slide. Here the background keeps the pack colors.
- **Text color.** The tile uses one fixed ink. Here the dark ink takes a trace of the pixel's hue, and light glyphs take the light's own color.

## Results (engine, 2026-11-04)

How these were made
- The stage is `src/light/engine/filters/ascii.ts` and `src/light/engine/glsl/ascii.ts` (dc8b193), registered in `OUTPUT_FILTERS`.
- It runs once `programRenderer.ts` calls `prepareOutputFilters` (`artifacts/grain/programRenderer-filter-chain.patch`). Until then `prototypes/ascii/engine-check.mjs` renders from a copy of `src/light` at HEAD with that patch applied.
- The tool's Filter choice needs `'ascii'` in `TOOL_FILTERS` (`artifacts/ascii/tool-filter-ascii.patch`).

Color: Oklab distance between ASCII on and off, after a gaussian blur of one cell height in linear light, at 1920 x 1080, 2x. The roadmap's limit is a mean of 0.01.

| Frame | Strength 1: mean (p95) | Strength 0.5: mean (p95) |
| --- | --- | --- |
| Ramp, Bold, seed 1 | 0.0031 (0.0096) | 0.0016 (0.0048) |
| Bands, Elemental, seed 3 | 0.0035 (0.0114) | 0.0019 (0.0064) |
| Blooms, Atmospheric, seed 2 | 0.0030 (0.0111) | 0.0016 (0.0060) |
| Rim, Bold, seed 1 | 0.0008 (0.0048) | 0.0004 (0.0025) |
| Halo, Elemental, seed 2 | 0.0016 (0.0083) | 0.0008 (0.0042) |
| Beam, Atmospheric, seed 1 | 0.0030 (0.0120) | 0.0015 (0.0062) |
| Streaks, Bold, seed 3 | 0.0038 (0.0132) | 0.0019 (0.0067) |

Preview against export
- A 960 x 540 render at 1x was compared with the 3840 x 2160 export at 2x, shrunk to 960 x 540, cell by cell.
- 0 to 4 of the 2,600 cells differ by more than 0.02 (mean linear difference). These are cells whose light sits right at a glyph threshold.
- Contour frames: 0 to 2 cells. The grid and the frame source depend on the aspect only, so every other cell has the same glyph.

4K against 1080p: the same characters in the same places, sharper (`out/engine/s100/*-1080x2-vs-4k.jpg`).

Twelve frames, 9:16 included (ab488ff), stay within a mean of 0.0041. Preview and export differ in at most 4 cells.

Sliders, 960 x 540, mean change in linear light per step (`page.ts` `sweep`):
- The ASCII strength slider (0 to 1 in 0.05 steps) changes the image by the same amount at every step. Glyphs stay where they are; only the contrast grows.
- With ASCII at 1, Intensity and the mood control (0.01 steps) on Ramp Bold, Bands Elemental and Halo Elemental have no step above 1.5 times the median of its neighbours.
- Glyphs that change as the light moves add a small, steady amount per step: Ramp's median step goes from 0.0027 to 0.0038.

Cost: the stage adds about 2 ms to a 3840 x 2160 export at 2x (11.5 to 13.6 ms for Ramp Bold) and 0.4 ms to a 1832 x 1030 preview. Grain at 0.5 adds 3.7 ms at 4K.

Dark ink over yellow, lime and tan hues (Oklab hue 55 to 145 degrees) is plain grey (ab488ff). With a trace of the hue it read dark olive over Lime.

Sheets (local, `prototypes/ascii/out/engine/`)
- `sheet-full.jpg`: every look, off, 0.5 and 1.
- `sheet-crops.jpg`: 1:1 crops at 1080 next to the Figma tile at the same 41.5 px rows.
