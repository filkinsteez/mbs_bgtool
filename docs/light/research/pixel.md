# Pixel filter: what the examples show and what the filter does

Started 2026-11-04; the slider became density on 2026-11-05. Engine stage: `src/light/engine/filters/pixel.ts`. First prototype: `prototypes/pixel/`. Scratch scripts for the density version, downloads, measurements and sheets: `artifacts/pixel/` (local, gitignored). Prototype output: `prototypes/pixel/out/` (gitignored).

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

It is a stage of the output filter chain, after the tone curve and before the sRGB encode and the dither. It is fully on at every slider value; the slider sets the density. It reads a small copy of the frame that the chain draws for it (`OutputFilter.source`).

Density
- The slider sets the cells on the short side: 18 at 0, 36 at 0.5 and 72 at 1, rounded to whole cells (`round(18 × 4^density)`). Each quarter of the slider multiplies the count by about √2, the same kind of scale as ASCII's density slider (13 to 52 rows).
- The long side gets a whole number of cells too, so the cells fill the frame and are square to within that rounding (2.2 % at worst, 4:5 at 18 cells). At 0.5: 64 x 36 at 16:9, 36 x 64 at 9:16, 36 x 36 at 1:1, 36 x 45 at 4:5.
- A cell is 60 px at 1080p at density 0, about the stand-in's 59 px; 30 px at 0.5; 15 px at 1.
- The grid depends on the frame's aspect and the density only, so a preview shows the same cells as the export. Between whole cell counts nothing changes.
- The chain leaves a filter out at exactly 0, so the tool sends density 0 as 0.001 (`withFilter`, `src/tool/filterControl.ts`), which gives 18 cells.

Frame copy
- One copy serves every density: two texels a cell of the densest grid each way (144 on the short side, 256 x 144 at 16:9), each the mean of 2 x 2 samples. The frame is drawn once for it at 288 px on the short side, samples 3.75 px apart at 1080p, close enough for a Contour line. Its size depends on the frame's aspect only, as the chain asks.
- A cell covers 2 to 9 texels each way. Its mean is read from the texels it covers, each weighed by how much of it the cell covers: per axis up to 5 bilinear reads, each taking two neighbouring texels in the right proportion.

Cell color
- Each cell shows the mean of the frame over the cell, in linear light, flat. It blends into the next cell over about a quarter of a cell (weight t⁴ / (t⁴ + (1 − t)⁴)), so cell edges are soft.

LED
- A rounded-square LED (half-size 0.42 cell, edge 0.16 cell wide, superellipse corners of exponent 4) brightens the middle of each cell and darkens the gaps by the same amount of light: gain = 1 + contrast × (LED / mean LED − 1). A flat area keeps its color exactly, so a pack hex keeps its hex.
- The contrast is 0.15 at every density. Above about 0.2 the gaps read as a mesh when the whole frame is seen at preview size.
- Each channel's contrast is lowered where the LED's middle would push that channel past 1. A bright LED keeps its pattern in the channels with room: its middle turns paler and its color sits in the gaps, and every channel keeps its mean. White has no pattern.
- Below 3 to 6 output pixels a cell, the LED fades out, so small previews show cells without moiré. Exports and settled previews don't get there (a cell at 1080p is at least 15 px).

Light kept
- A soft edge hands light from the brighter of two cells to the darker. Per axis, a cell's own color covers 1 − 2H of its area and each neighbour's H, where H = 0.042 for this blend (`blendShare`). The light a cell loses this way goes back into its own LED, so a light cell is never dimmed and a thin bright line keeps its brightness as a row of LEDs.
- A darker cell keeps the little light it gets: taking it back would leave a dark spot in its middle. Beside a hot line on black this reads as the LED's light spilling into the next cell. Accepted on 2026-11-05.
- There is no glow. In the first density version a glow through the cell means (0.35 of the light) moved up to a fifth of a thin line cell's light into its neighbours (line cells 0.02 to 0.03 darker in Oklab L), and the plain light it laid over the pattern lowered the LED contrast by a third.

Seed
- The filter adds no randomness. The dither after it is keyed to the seed and the output pixel, so the same seed gives the same bytes.

Cost
- Per output pixel: the means of six cells (the nearest, the four beside it and the diagonal one in the pixel's 2 x 2 block), each from 1 to 25 bilinear reads depending on the density, and a few dozen arithmetic operations.
- At 3840 x 2160 (Halo Elemental seed 2, one run each on a shared machine) the frame takes about 58 ms without a filter. Pixel adds about 14 ms at density 0, 5 ms at 0.5 and 2 ms at 1.
- Later option: a frame copy sized per density (two texels a cell at every density, with more samples a texel at coarse densities) would read each cell mean in one read and cost about the same at every density. The chain calls `source.size(frame)` without the slider's value, so this needs the value passed in (`src/light/engine/output.ts`, `filters/types.ts`). Not needed now: 14 ms at 4K at density 0 is fine.

## What was tried and dropped

The first version (2026-11-04, this note at commit 0462813): 36 cells at every strength. Strength 0 to 0.5 faded the cells in over the image, which looked like a double exposure on thin lines; 0.5 to 1 raised the LED contrast from 0.10 to 0.20. LED half-size 0.4 and edge 0.12, blend t⁸, 30 % glow through a cubic B-spline, light past 1 added as white, and the LED faded out from luminance 0.7 to 1. Its sheets are in `artifacts/pixel/sheets/`.

Candidates for the density version (scratch stage `artifacts/pixel/exp/pixel-exp.ts`; sheets and per-cell numbers in `artifacts/pixel/exp/out/`, rounds r1 to r6):
- Light past 1 added as white, as in the first version: the texture is even, but bright cells' average colors turn paler.
- Contrast limited by the brightest channel: colors are kept, but pale skies and bright yellows lose the pattern while darker areas keep it, so the texture looks patchy.
- Glow 0.35 and 0.2: soft, but thin line cells lose 0.02 to 0.03 of their Oklab L (0.017 to 0.025 with glow 0.2).
- Sharper edges (t⁶, t⁸): keep more light in each cell, but cells read as a mosaic.
- Contrast 0.25 (the M3 sample) and 0.2 without glow: the grid reads as a mesh over light skies.
- More samples a texel (4 x 4 instead of 2 x 2): no change in the cell means.

From the first version's exploration (`prototypes/pixel/out/`):
- Light lines over the image, as in the stand-in: reads as a ruled grid laid on the photo, and every detail of the image stays, so nothing looks quantized.
- Keeping each pixel's own color with a pattern on top: reads as a grid over the image, as the roadmap said.
- Flat cells with no LED: gradients turn into stacked bands, because nothing explains the steps between cells.
- Round soft dots: reads as quilting.
- Fine grids (54 to 96 cells) as the only size: a screen-door texture that reads as noise.
- Lowering the contrast per pixel where a channel nears 1: tiles next to white light came out inside out, with bright frames around darker middles.

## Measurements (density version, 2026-11-05)

Each cell's color (`artifacts/pixel/exp/density.mjs`, `others.mjs`): frames rendered through the tool's renderer and filter chain at 1920 x 1080, controls at 0.5. The per-cell means in linear light without and with Pixel are compared in Oklab; 0.02 is about one just-noticeable difference. Light cells are those above Oklab L 0.7.

| Frame | Density | Mean | 95th percentile | Worst cell | Light cells, change in L |
| --- | --- | --- | --- | --- | --- |
| Ramp Bold s1 | 0 | 0.0005 | 0.0015 | 0.0022 | +0.0001 |
| Ramp Bold s1 | 0.5 | 0.0002 | 0.0006 | 0.0012 | +0.0001 |
| Ramp Bold s1 | 1 | 0.0001 | 0.0003 | 0.0007 | 0.0000 |
| Halo Elemental s2 | 0 | 0.0033 | 0.0126 | 0.0233 | no light cells |
| Halo Elemental s2 | 0.5 | 0.0013 | 0.0061 | 0.0129 | +0.0015 (1 cell) |
| Halo Elemental s2 | 1 | 0.0006 | 0.0023 | 0.0127 | +0.0023 (9 cells) |
| Beam Atmospheric s1 | 0 | 0.0009 | 0.0038 | 0.0090 | +0.0007 |
| Beam Atmospheric s1 | 0.5 | 0.0003 | 0.0013 | 0.0040 | +0.0003 |
| Beam Atmospheric s1 | 1 | 0.0002 | 0.0006 | 0.0019 | +0.0001 |

- Densities 0.25 and 0.75 fall in between; at 0.75 two of Halo's light cells are 0.006 darker in L.
- Bands, Blooms, Rim and Streaks, each pack at seed 1, densities 0, 0.5 and 1: light cells change by 0 to +0.004 in L in every frame. Bands' worst cell is 0.019, Blooms' 0.003. Streaks Bold and Atmospheric reach 0.026; Streaks Elemental 0.083 at density 0, 0.046 at 0.5 and 0.020 at 1. Rim's worst cells are 0.09 to 0.12 at every density; its 95th percentile is 0.034 to 0.039 at 0, 0.018 to 0.020 at 0.5 and 0.007 to 0.008 at 1.
- The worst cells are near-black cells beside a hot line or shaft, lit by the soft edge. Near black a little light moves Oklab a lot, so the numbers there are large; on the sheets it reads as the LED's light spilling into the next cell, like the original line's own glow.

Files: `artifacts/pixel/density/cells.json`, `check-other-looks.json`.

Sweep (`artifacts/pixel/density/sweep.json`; density 0 to 1 in 0.01 steps at 960 x 540; Ramp, Halo, Beam): 54 cell-count steps (18 to 72) for each frame, and nothing changes between counts. No step is more than 1.25 times the median of its neighbours. The change per count step drifts smoothly with the cell size; Halo's mean change in linear light goes from 0.0043 at the coarse end to 0.0029 at the fine end.

Cost (`artifacts/pixel/density/cost.json`): see Cost above.

The first version's color, GPU and preview checks are in this note at commit 0462813.

## Sheets

- `artifacts/pixel/density/sheet-crops.jpg`: Ramp, Halo and Beam at 1:1: the Figma tile scaled to 1080p, off, and density 0, 0.25, 0.5, 0.75 and 1.
- `artifacts/pixel/density/sheet-full.jpg`: the same frames whole, shown 480 wide.
- `artifacts/pixel/density/check-other-looks.jpg`: Bands, Blooms, Rim and Streaks in all three packs: whole frames off and at density 0, 0.5 and 1, and 1:1 crops of the busiest part at 0.5 and 1.
- `artifacts/pixel/exp/out/`: the candidate rounds (r1 to r6), whole frames and 1:1 crops.
- First version: `artifacts/pixel/sheets/`.

## Decisions

- Pixel is back (SHARED.md). Thin Contour lines become rows of LEDs: accepted.
- 2026-11-05: the slider sets the density, like ASCII's, and the filter is fully on at every value. Each cell keeps its average color and light areas are not dimmed. Near-black cells beside a hot line may take a little of its light (it reads as the LED's light spilling).
- Later option: a frame copy per density (see Cost).

## Commands

- `node artifacts/pixel/exp/density.mjs [--skip sheets,sweep,cost]`: sheets, per-cell numbers, sweep and cost through the tool's renderer (Ramp, Halo, Beam).
- `node artifacts/pixel/exp/others.mjs`: Bands, Blooms, Rim and Streaks sheet and per-cell numbers.
- `node artifacts/pixel/exp/run.mjs --round r6 [--samples 2] [--frames halo-elemental-s2]`: candidates from `variants.mjs` through the scratch stage, with per-cell numbers.
- First version: `node prototypes/pixel/gpu.mjs`, `scale.mjs`, and the CPU prototype (`frames.mjs`, `measure.mjs`, `full.mjs`, `run.mjs`).
