# Pixel filter: what the examples show and what the filter does

Started 2026-11-04. Engine stage: `src/light/engine/filters/pixel.ts`. Prototype: `prototypes/pixel/`. Downloads, measurements and copies of the sheets: `artifacts/pixel/` (local, gitignored). Prototype output: `prototypes/pixel/out/` (gitignored).

## Where the examples are

The only Pixel examples are the stand-in tiles on the deck's filter slides. They are the same tile in all three deck versions:

| Node | Slide |
| --- | --- |
| `26:250` | 26:237 "11 Filters" (older deck) |
| `33:249` | 33:236 "11 Filters — Optimistic VF" (older deck) |
| `44:280` | 44:267 "12 Filters — Optimistic VF" (current deck) |

No moodboard, loose image on page 26:2, sketch board or file in `public/references/` shows a pixel or LED filter. The film poster's halftone screen and the riso prints' grain are print textures, not pixels.

The brief (`44:323`): "The render quantized to a coarse grid, like an LED wall seen up close. Keep the contrast low so it reads as light, not pattern." The current slide says "snapped" instead of "quantized". `44:324`: "The ASCII and pixel tiles are stand-ins drawn in Figma; the tool renders the real thing from the frame buffer."

The roadmap had dropped Pixel (item 4: "Flat cells turn thin lines into rows of squares, and keeping each pixel's own color still reads as a grid."). The coordinator assigned it again on 2026-11-04.

Files: `artifacts/pixel/figma/44-280-pixel-tile.png`, `44-267-filters-slide.png`, `26-80-four-moods.png`, and the sketch and moodboard pages checked for pixel examples (`132-*.png`).

## The stand-in tile (44:280)

- The tile is 544 x 440 px: the slide's sky photo with light lines 2 px wide every 24 px, so 22 x 18 cells. That is 18.3 cells on the short side: a 59 px cell at 1080p, 118 px at 4K.
- The lines are white at about 55 to 63 % opacity in sRGB, over the photo. They are lighter than the image. A real LED wall has dark gaps.
- Inside each cell the photo's gradient stays smooth. There is no averaging per cell, no reduced levels, no dither and no grain.
- So the tile is a grid drawn over the image, not the image turned into cells. It shows the idea, as `44:324` says, not how the filter should be built.

## What the filter does

It is a stage of the output filter chain, after the tone curve and before the sRGB encode and the dither. It reads the small copy of the frame that the chain draws for it (`OutputFilter.source`).

Grid
- 36 cells on the short side and a whole number on the long side, so cells are square and fill the frame: 64 x 36 at 16:9, 36 x 64 at 9:16, 36 x 36 at 1:1, 36 x 45 at 4:5. A cell is 30 px at 1080p and 60 px at 4K.
- The cell count depends on the aspect only, so a preview shows the same cells as the export at any size.
- 36 is twice as fine as the stand-in's 18.3. At 18 cells a Contour rim turns into a few large blocks and a Sunset sky into a handful of bands. 36 still reads as coarse.

Cell color
- Each cell shows the mean of the frame over the cell, in linear light. The frame copy has 2 x 2 texels a cell, each the mean of 4 x 4 samples, and the cell mean is one bilinear read at the cell's center: 8 x 8 samples a cell. With 4 x 4 samples a cell, cells on thin lines came out visibly off their true mean in the prototype. 8 x 8 matched.
- The cell's color is flat and blends into the next cell over about a fifth of a cell (weight t⁸ / (t⁸ + (1 − t)⁸)), so cell edges are soft rather than one-pixel steps.
- Colors stay the image's colors. In a flat area every cell has the same mean and the LED pattern averages 1 over a cell, so a pack hex keeps its hex.

LED
- A rounded-square LED (half-size 0.4 cell, edge 0.12 cell wide, superellipse corners of exponent 4) brightens the middle of each cell and darkens the gaps by the same amount of light, so the cell keeps its mean: gain = 1 + contrast × (LED / mean LED − 1).
- Where the brighter middle would push a channel past 1, the gain is capped and the rest of the light is added as white, keeping the luminance. Bright LEDs turn whiter, as they do on camera, and the gaps next to them still darken.
- The LED fades out as the cell's luminance goes from 0.7 to 1, so near-white light covers the gaps instead of showing grey lines.

Glow
- 30 % of the light spreads over the neighbouring cells as a smooth glow (a cubic B-spline through the cell means), as a lens blooms an LED wall. It softens the steps between cells and the stairs along thin lines.

Strength
- 0 to 0.5 fades the filter in. 0.5 to 1 raises the LED contrast from 0.10 to 0.20.
- Above about 0.2 the gaps read as a mesh when the whole frame is seen at preview size (sheets `led-contrast-*.jpg`). The first version went to 0.30; it was lowered after the GPU audit.
- Between 0 and 0.5 the image and the cells show at the same time. On thin lines that looks like a double exposure (the strength 0.25 tile in `rim-bold-s1-crops.png`).

Seed
- The filter adds no randomness. The dither after it is keyed to the seed and the output pixel, so the same seed gives the same bytes.

Cost
- Per output pixel: 20 bilinear reads of the small frame copy (4 for the flat cells, 16 for the glow) and a few dozen arithmetic operations. The copy is 128 x 72 texels at 16:9, drawn from a 512 x 288 render.

## What was tried and dropped

Prototype sheets for these are in `prototypes/pixel/out/` (`variants`, `concepts`, `contrast`, `amount`, `balanced`, `low`, `led3`, `full-*`).

- Light lines over the image, as in the stand-in: reads as a ruled grid laid on the photo, and every detail of the image stays, so nothing looks quantized.
- Keeping each pixel's own color with a pattern on top: reads as a grid over the image, as the roadmap said.
- Flat cells with no LED: gradients turn into stacked bands, because nothing explains the steps between cells.
- Round soft dots: reads as quilting.
- Fine grids (54 to 96 cells): a screen-door texture that reads as noise.
- Dark gaps at a contrast of 0.25 and above: graph paper at viewing size.
- Lowering the contrast per pixel where a channel nears 1: tiles next to white light came out inside out, with bright frames around darker middles. Replaced by adding the extra light as white.

## Measurements

Colors (`prototypes/pixel/measure.mjs`; all 21 frames at 1920 x 1080, 7 looks x 3 packs, seed 1). Both frames get the same Gaussian blur in linear light, then the Oklab distance between them is measured. 0.02 is about one just-noticeable difference; the roadmap's limits are mean < 0.03 and 95th percentile < 0.06.

| Strength | Blur | Mean (worst frame) | 95th percentile, worst frame | Mean change in L |
| --- | --- | --- | --- | --- |
| 0.5 | 30 px (one cell) | 0.0018 (0.0034) | 0.0164 | +0.0006 |
| 0.5 | 10.8 px (1 % of the short side) | 0.0028 (0.0078) | 0.0446 | +0.0013 |
| 1 | 30 px | 0.0023 (0.0057) | 0.0173 | +0.0004 |
| 1 | 10.8 px | 0.0032 (0.0078) | 0.0443 | +0.0012 |

Files: `artifacts/pixel/color-check.txt` (strength 0.5; its strength 1 rows are from the earlier contrast of 0.30), `color-check-strength1.txt`.

GPU against the CPU prototype (`prototypes/pixel/gpu.mjs`): the engine's output shader with the Pixel stage, run on frames the engine renders. Over all 21 frames at 1920 x 1080 the mean difference is 0.2 to 0.4 8-bit levels, and the 99th percentile is 1.2 levels, the size of the dither. The same holds at 1080 x 1920 and 1080 x 1350. The image is not flipped. With the frame copy drawn the way the renderer's filter chain draws it (`--source small`), the 99th percentile is at most 1.6 levels, and cells along thin lines light evenly.

Preview against export (`prototypes/pixel/scale.mjs`; strength 1; Blooms, Beam, Rim, Streaks): a 3840 x 2160 render shrunk to 960 x 540 and to 1920 x 1080 against renders at those sizes. With Pixel the Oklab mean is 0.0016 to 0.0031, the 95th percentile 0.0032 to 0.0158, and the worst single pixels 0.074, at LED edges on the Rim. Without filters the engine's own difference is 0.0002 to 0.0007. This harness builds the cell means from each size's frame. The renderer draws its frame copy at a size that depends on the aspect only, so there the cell means are the same at every size.

## Sheets

Copies in `artifacts/pixel/sheets/`:
- `<look>-frames.jpg`: each look in three packs, off, strength 0.5 and strength 1, whole 1920 x 1080 frames shrunk 3x.
- `<frame>-crops.png`: 1:1 crops at off, 0.25, 0.5, 0.75 and 1, from the busiest part of the frame.
- `9x16-streaks-frames.jpg`, `4x5-halo-frames.jpg`: portrait.
- `preview-vs-export-rim-bold-s1.jpg`: a 960 x 540 render, the 4K export shrunk 4x, and a 1:1 crop of the export.
- `led-contrast-ramp-bold-s1.jpg`, `led-contrast-bands-atmospheric-s1.jpg`: LED contrast 0.10 to 0.30 on whole frames.
- `small-source-rim-elemental-s1-crops.png`: the frame copy drawn as the renderer draws it.

## Open decisions

1. Cell size: 36 cells on the short side, against 18.3 in the stand-in.
2. Contour: a thin line becomes a row of LEDs, dimmer than the line, because a cell shows its mean (a 5 px line in a 30 px cell gives about a sixth of its peak). This comes with cells; it is why the roadmap dropped Pixel.
3. Strength 0 to 0.5 cross-fades the image and the cells. Another option is to grow the cells with strength, from fine to 36 on the short side.

## Running it in the tool

- The renderer has to call `prepareOutputFilters` (`artifacts/grain/programRenderer-filter-chain.patch`). Until then only grain runs in the app.
- Then 'pixel' goes into `TOOL_FILTERS` (`src/tool/filterControl.ts`).

## Commands

- `node prototypes/pixel/gpu.mjs [--looks rim,beam] [--packs bold] [--size 1080x1920] [--strengths 0.5,1] [--source small] [--set name]`
- `node prototypes/pixel/scale.mjs [--frames rim-bold-s1] [--export 3840x2160] [--sizes 960x540]`
- `node prototypes/pixel/frames.mjs` writes 1080p frames for the CPU prototype; then `measure.mjs`, `full.mjs --set top`, `run.mjs --set led3`, `zoom.mjs`, `probe.mjs`.
