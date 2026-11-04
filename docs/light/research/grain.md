# Grain: what the moodboard shows and what the tool makes

Measured on 2026-11-04 with `scripts/light/grain-measure.mjs`, the same code for the reference images and for our renders (usage in `scripts/light/README.md`, "Grain measurement"). Numbers, sheets and crops are in `artifacts/grain/measure/` (`refs.md`, `renders.md`, `sheets/`, `crops/`); the script writes them again.

How to read the numbers:

- **Grain** is each image minus its gaussian blur at 0.65 % of the short side (6 px on a 925 px tile, 7 px at 1080p, 14 px at 4K), on the pixels away from edges, folds and text.
- **L std** is the standard deviation of that residual in Oklab lightness, in % of L. **Code values** is the same for 8-bit luma.
- **Half width** is the clump size: the distance at which the residual's autocorrelation falls to half. One-pixel noise is 0.5 px; soft clumps are larger. It is also given per 1000 of the short side, which is the size relative to the picture.
- **High-frequency share** is the share of the residual's power above 0.25 cycles per pixel: about 0.8 for one-pixel noise, near 0 for soft clumps.
- **Mono** is the share of the residual in lightness rather than in color (1 is fully mono).
- **Skew** and **dark specks** (residuals more than 3 standard deviations below) separate dark speckle from film grain, which is symmetric.

## Summary

- Only the three riso prints have real grain. The poster has a printed halftone screen, the sky photos and the Contour images have JPEG noise, and the deck's Grain tile is Figma's Noise effect on a photo.
- The riso prints, at the size they show on the moodboard (925 px wide), have mono, symmetric, soft grain:
  - 0.98 to 1.70 % L overall: 2.2 to 2.3 % in dense ink (L 0.4 to 0.5) and 0.7 to 1.0 % on paper;
  - clumps 1.9 to 2.4 px across at half height, which is 2.1 to 2.6 per 1000 of the short side.
- The deck's Grain tile at 1x, the size a 1080p export shows it, is 2.5 % L of one-pixel noise. Most pixels move about 1.3 %; the rest is sparse dark specks, up to 28 code values deep, with almost no light ones. Exported at 2x and 4x it gets stronger and finer relative to the picture, so its look depends on the export size, not on the picture.
- Our grain at strength 1 matches the riso prints at their size. Measured the same way, it is 4 % stronger and has 5 % larger clumps than the prints' average, while the three prints differ from their own average by up to 30 %. In dense ink and on paper it is within 11 % of the prints' average.
- Our grain at strength 0.5 is fine film grain: 1.1 to 1.2 % L in shadows and mid-tones, easing to 0.6 % near white, mono and symmetric.
  - At 1080p it is about one pixel across, like the deck tile, but half its strength and without its dark specks.
  - At 4K it is 1.6 px across, the same size relative to the picture.
- The preview shows the same grain as the export at the same viewing size. The same seed gives the same grain, nothing repeats across the frame, and grain removes banding on dark ramps.

## Where grain is in the Figma file

| Where | Node | What it is |
| --- | --- | --- |
| Sunset moodboard, riso prints | 41:26, 41:27, 41:28 (`sunset-green-riso`, `-blue-`, `-pink-`) | One 567 x 1134 scan of three prints, each tile the scan turned 90° and enlarged about 3x by Figma. The grain is the scan's pixels, enlarged. |
| Sunset moodboard, poster | 41:25 (`sunset-film-poster-bands`) | A printed halftone screen (one-pixel structure with spectral peaks), not grain. |
| Filters slide, Grain tile | 44:271 in the current deck (12 Filters), 26:241 and 33:240 on page 26:2 (11 Filters) | A sky photo with Figma's Noise effect: dark one-pixel specks. Labelled "Fine film grain, 1 to 2 percent, applied last at output size". |
| Contour moodboard, rings photo | 41:30 (`contour-iridescent-rings`) | Faint camera noise, 0.6 % L. |
| Everything else on the boards and slides | | JPEG noise only (0.1 to 0.4 % L); the sky photos also band (sky-peach: 13 % of its pixels in flat 8-bit runs). |
| Bottom of page 26:2 | 132:29 to 132:46 | Copies of moodboard images, Trails bokeh photos (a dropped mood) and early procedural sketches. No grain to match. |

The ASCII and Pixel tiles on the Filters slides are drawn in Figma ("stand-ins"); they are the ASCII and Pixel agents' targets.

## Reference numbers

| Image | Size | L std % | Code values | Shadows L % | Mids L % | Highlights L % | Half width px | per 1000 of short side | High-frequency share | Mono | Skew | Dark specks % |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| green riso | 925x1447 | 0.98 | 3.09 | - | 1.11 | 0.85 | 2.43 | 2.63 | 0.01 | 0.98 | -0.03 | 0.40 |
| blue riso | 925x1447 | 1.70 | 5.11 | - | 1.86 | 1.12 | 1.94 | 2.10 | 0.01 | 0.99 | -0.05 | 0.51 |
| pink riso | 925x1447 | 1.26 | 3.82 | - | 1.55 | 0.70 | 2.06 | 2.23 | 0.01 | 0.97 | 0.03 | 0.83 |
| riso scan, its own pixels | 567x1134 | 1.63 | 4.97 | - | 2.00 | 1.03 | 0.55 | 0.98 | 0.70 | 0.98 | -0.17 | 0.80 |
| poster (halftone) | 925x1296 | 1.13 | 3.17 | 1.15 | 1.13 | 1.01 | 0.66 | 0.72 | 0.51 | 0.96 | 0.02 | 0.38 |
| sky-peach | 925x1001 | 0.17 | 0.55 | - | 0.19 | 0.16 | 1.93 | 2.09 | 0.13 | 0.60 | -0.01 | 0.34 |
| iridescent rings | 925x1233 | 0.59 | 1.34 | 0.59 | 0.67 | 0.40 | 1.26 | 1.37 | 0.25 | 0.86 | -0.31 | 0.79 |
| deck Grain tile, 1x | 544x440 | 2.51 | 7.38 | - | 2.27 | 3.13 | 0.47 | 1.06 | 0.86 | 0.96 | -1.90 | 1.97 |
| deck Grain tile, 2x | 1088x880 | 3.37 | 9.84 | - | 3.05 | 4.20 | 0.60 | 0.68 | 0.63 | 0.96 | -2.45 | 2.73 |
| deck Grain tile, 4x | 2176x1760 | 4.40 | 12.72 | - | 3.98 | 5.50 | 0.91 | 0.51 | 0.31 | 0.97 | -3.01 | 3.71 |
| deck tile's photo, no effect | 1200x1575 | 0.42 | 1.28 | 0.61 | 0.45 | 0.31 | 1.31 | 1.09 | 0.19 | 0.58 | -0.07 | 0.57 |

Riso grain by lightness (L std %, by the blurred L of each pixel):

| | L 0.4 | 0.5 | 0.6 | 0.7 | 0.8 | 0.9 |
| --- | --- | --- | --- | --- | --- | --- |
| green riso | - | - | 1.11 | 0.85 | 0.83 | 1.01 |
| blue riso | 2.27 | 2.16 | 1.63 | 1.53 | 1.02 | 0.85 |
| pink riso | 2.23 | 1.84 | 1.09 | 0.69 | 0.67 | 0.74 |

Notes:

- These riso numbers are higher than the grain study's (0.87 to 1.23 %, `prototypes/grain-study/README.md`). The study, and the first version of this script, left out pixels where the blurred image curves more than 0.012 L. On the prints that takes out their coarsest mottle, which is in the densest ink: the blue print was measured on 21 % of its pixels (1.03 %) instead of 92 % (1.70 %). The script now uses 0.04, which still leaves out ink edges, folds, rims and bands.
- In 8-bit code values the prints are 3.1 to 5.1 code values (1.2 to 2.0 % of 255); SHARED.md's "1.0 to 1.7 % of 255" came from the narrower mask.
- The scan behind the prints has white one-pixel grain (half width 0.55 px). The soft clumps on the moodboard come from Figma enlarging it about 3x.

## The deck's Grain tile: Figma's Noise effect at 1x

The tile is a 544 x 440 frame on a 1920 x 1080 slide, so at 1x its pixels are the size of a 1080p export's pixels.

- **Strength:** 2.5 % L, 7.4 code values. The typical pixel moves 1.3 % (the median-based spread). The rest is sparse dark specks.
- **Specks:** subtracting the tile's source photo (scaled to fill and aligned) leaves the effect alone. 13 % of pixels are more than 8 code values darker than the mean, 5 % more than 16, and 1 % more than 28. Almost none are lighter. The specks are about one pixel across (runs of 1.2 px along rows). Skew -1.9.
- **Size:** one pixel. The half width is 0.47 px and 86 % of the power is above 0.25 cycles per pixel, which is white noise.
- **Color:** mono (0.96). It is stronger on the light parts of the sky than on the darker blue (3.1 % against 2.3 %), as dark specks are.
- **At other export sizes:** at 2x it is 3.4 % and at 4x 4.4 %. Relative to the picture it gets finer: 1.06, then 0.68, then 0.51 per 1000 of the short side. The noise is drawn per output pixel, so how it looks depends on the export size and on zoom (sheet `deck-tile.jpg`).

What this means for us:

1. At 1080p our grain and the deck's are the same kind of fine texture. Our strength 0.5 is also about one pixel across at 1080p (half width 0.56 px) and mono. It is about half the deck's strength (1.1 % at mid-tones, 2.5 code values against 7.4), and symmetric.
2. We don't copy the dark specks. They read as dust or digital noise, and the brief asks for film grain.
3. We don't copy the fixed pixel size. Grain drawn per output pixel is a third as strong when a 4K export is shown at screen size (`prototypes/grain-study`), and the preview would not match the export. Ours is sized to the short side, so a 4K export shows the same grain relative to the picture as a 1080p one.
4. The deck tile is stronger than anything on our slider at 1080p. Strength 1 (the riso prints) reaches 1.8 % at mid-tones and 2.1 % in dark colors with soft clumps, but on light colors it stays near 0.8 %, where the tile has 3 %. If the owner expects the deck tile's amount of grain, that is a decision about the slider (see the questions at the end).

## Targets

- **Strength 1 = the riso prints** (coordinator decision, 2026-11-04): mono, symmetric, the prints' strength by lightness (2.2 % in dense ink, about 1 % on paper), and clumps about 2.1 to 2.6 per 1000 of the short side, at every export size.
- **Strength 0.5 = fine film grain**, "1 to 2 percent" in the brief: about 1 % L at mid-tones, mono, symmetric, fading to 0 at black and easing near white.
- At every strength: the preview and the export show the same grain at the same viewing size; the same seed gives the same grain; no repeats, no banding.

## Our grain

### Strength against lightness (a black to white ramp)

| Render | L std % | Code values | Shadows L % | Mids L % | Highlights L % | Half width px | per 1000 of short side | High-frequency share | Mono | Skew |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1080p, grain 0 (dither only) | 0.12 | 0.38 | 0.16 | 0.12 | 0.11 | 0.51 | 0.48 | 0.81 | 0.45 | 0.11 |
| 1080p, grain 0.5 | 0.82 | 2.48 | 1.09 | 1.04 | 0.68 | 0.56 | 0.52 | 0.70 | 0.98 | 0.01 |
| 1080p, grain 1 | 1.27 | 3.76 | 2.11 | 1.78 | 0.87 | 2.68 | 2.48 | 0.02 | 0.99 | 0.01 |
| 4K, grain 0.5 | 0.89 | 2.71 | 1.19 | 1.13 | 0.74 | 1.60 | 0.74 | 0.13 | 0.98 | 0.01 |
| 4K, grain 1 | 1.28 | 3.78 | 2.11 | 1.80 | 0.88 | 5.30 | 2.46 | 0.01 | 0.99 | 0.01 |

| | L 0.2 | 0.3 | 0.4 | 0.5 | 0.6 | 0.7 | 0.8 | 0.9 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1080p, grain 0.5 | 1.09 | 1.09 | 1.09 | 1.07 | 0.97 | 0.82 | 0.67 | 0.57 |
| 4K, grain 0.5 | 1.19 | 1.20 | 1.19 | 1.17 | 1.06 | 0.90 | 0.73 | 0.62 |
| 1080p, grain 1 | 2.16 | 2.09 | 2.11 | 1.87 | 1.45 | 1.03 | 0.82 | 0.80 |
| 4K, grain 1 | 2.16 | 2.11 | 2.12 | 1.88 | 1.47 | 1.04 | 0.83 | 0.80 |

Grain is the same at 1080p and 4K relative to the picture: the strength by lightness agrees within 10 %, and the clump size per 1000 of the short side agrees at strength 1. At strength 0.5 the 1080p grain is near one pixel, where the finest octaves lose some of their variance, so it is slightly weaker and relatively coarser than at 4K.

### The riso prints against strength 1, at the print's size

Each riso reference preset (`src/light/presets/references/sunset-*-riso.json`) rendered at 925 x 1447 and measured the same way as the print. "Strength 1" turns off the preset's ink weight, so the grain is what the tool's Grain filter at 1 gives. The preset rows are the presets as of c06c684 (measured again at 4:45 PM).

| Image | L std % | Code values | Mids L % | Highlights L % | L 0.4 | 0.5 | 0.6 | 0.7 | 0.8 | 0.9 | Half width px | per 1000 of short side |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| green riso, print | 0.98 | 3.09 | 1.11 | 0.85 | - | - | 1.11 | 0.85 | 0.83 | 1.01 | 2.43 | 2.63 |
| green riso, preset (even grain) | 1.20 | 3.85 | 1.42 | 0.98 | - | - | 1.42 | 1.03 | 0.82 | 0.81 | 2.24 | 2.43 |
| green riso, strength 1 (the tool) | 1.20 | 3.85 | 1.42 | 0.98 | - | - | 1.42 | 1.03 | 0.82 | 0.81 | 2.24 | 2.43 |
| blue riso, print | 1.70 | 5.11 | 1.86 | 1.12 | 2.27 | 2.16 | 1.63 | 1.53 | 1.02 | 0.85 | 1.94 | 2.10 |
| blue riso, preset (even grain) | 1.48 | 4.43 | 1.63 | 0.88 | 2.09 | 1.92 | 1.40 | 1.03 | 0.82 | 0.81 | 2.25 | 2.44 |
| blue riso, strength 1 (the tool) | 1.48 | 4.43 | 1.63 | 0.88 | 2.09 | 1.92 | 1.40 | 1.03 | 0.82 | 0.81 | 2.25 | 2.44 |
| pink riso, print | 1.26 | 3.82 | 1.55 | 0.70 | 2.23 | 1.84 | 1.09 | 0.69 | 0.67 | 0.74 | 2.06 | 2.23 |
| pink riso, preset (light ink weight) | 1.38 | 4.20 | 1.66 | 0.88 | 2.10 | 1.80 | 1.41 | 1.02 | 0.76 | 0.74 | 2.28 | 2.46 |
| pink riso, strength 1 (the tool) | 1.42 | 4.33 | 1.70 | 0.93 | 2.12 | 1.84 | 1.45 | 1.07 | 0.81 | 0.81 | 2.28 | 2.46 |

- Averages over the three prints: L std 1.31 % for the prints and 1.37 % for strength 1 (+4 %); half width 2.14 px and 2.26 px (+5 %). The prints differ from their average by up to 30 % in strength and 14 % in size.
- By lightness, strength 1 is within 11 % of the prints' average in dense ink (L 0.4 to 0.5: 2.1 % against 2.25 %), in the mid-tones and on paper (L 0.8 to 0.9: 0.81 % against 0.84 %). Between them (L 0.6) it is 13 % stronger than the average, close to the blue print.
- All three are mono (0.97 to 0.99) and symmetric (skew within 0.05), with soft clumps (high-frequency share 0.01 to 0.04).
- The presets' grain follows the prints since c06c684 (Bands agent): green and blue use even grain, the same as strength 1, and pink keeps a light ink weight (`grainInk` 0.5, 0.8). Paper is now 0.74 to 0.81 % against the prints' 0.67 to 1.01 %, and dense ink 2.09 to 2.10 % against 2.23 to 2.27 %. Before that change their ink weight left the paper at 0.16 to 0.58 %.

### Every look and pack at 4K, strength 0.5

Each look's own scene from its compose (controls at 0.5, seed 1, 16:9), measured on the pixels the same frame without grain leaves after the edge mask.

| Look | Pack | L std % | Code values | Shadows L % | Mids L % | Highlights L % | Half width px | Mono | Flat runs, grain 0 % | Flat runs, grain 0.5 % |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sunset.ramp | bold | 0.95 | 3.37 | - | 1.11 | 0.79 | 1.61 | 0.98 | 0.00 | 0.00 |
| sunset.ramp | elemental | 1.05 | 3.44 | 1.20 | 1.14 | 0.83 | 1.62 | 0.99 | 0.00 | 0.00 |
| sunset.ramp | atmospheric | 1.03 | 3.34 | - | 1.15 | 0.77 | 1.61 | 0.99 | 0.00 | 0.00 |
| sunset.bands | bold | 0.94 | 3.49 | - | 1.14 | 0.82 | 1.61 | 0.98 | 0.00 | 0.00 |
| sunset.bands | elemental | 1.16 | 3.50 | 1.20 | 1.15 | 0.97 | 1.62 | 0.99 | 0.00 | 0.00 |
| sunset.bands | atmospheric | 1.07 | 3.23 | 1.20 | 1.14 | 0.84 | 1.61 | 0.99 | 0.00 | 0.00 |
| sunset.blooms | bold | 0.96 | 3.02 | - | 1.12 | 0.83 | 1.61 | 0.99 | 0.00 | 0.00 |
| sunset.blooms | elemental | 1.04 | 3.11 | 1.20 | 1.13 | 0.90 | 1.61 | 0.98 | 0.00 | 0.00 |
| sunset.blooms | atmospheric | 1.11 | 3.29 | - | 1.15 | 0.87 | 1.61 | 0.99 | 0.00 | 0.00 |
| contour.rim | bold | 0.94 | 1.35 | 0.93 | 1.19 | - | 0.65 | 0.81 | 0.00 | 0.00 |
| contour.rim | elemental | 1.00 | 1.45 | 0.99 | 1.19 | 1.00 | 0.64 | 0.84 | 0.00 | 0.00 |
| contour.rim | atmospheric | 0.97 | 1.48 | 0.94 | 1.20 | 0.94 | 0.69 | 0.79 | 0.00 | 0.00 |
| contour.halo | bold | 0.98 | 3.06 | 0.92 | 1.13 | - | 0.99 | 0.93 | 0.00 | 0.00 |
| contour.halo | elemental | 1.11 | 1.75 | 1.13 | 1.24 | 0.81 | 0.66 | 0.80 | 0.00 | 0.00 |
| contour.halo | atmospheric | 0.97 | 2.32 | 0.89 | 1.20 | - | 1.55 | 0.94 | 0.00 | 0.00 |
| contour.beam | bold | 0.99 | 2.72 | 0.93 | 1.14 | 0.77 | 1.51 | 0.94 | 0.00 | 0.00 |
| contour.beam | elemental | 0.99 | 1.91 | 1.15 | 1.20 | 0.56 | 0.73 | 0.86 | 0.00 | 0.00 |
| contour.beam | atmospheric | 1.09 | 3.13 | 1.11 | 1.16 | 0.77 | 1.62 | 0.97 | 0.00 | 0.00 |
| contour.streaks | bold | 1.12 | 3.56 | 1.14 | 1.16 | 0.76 | 1.63 | 0.98 | 0.00 | 0.00 |
| contour.streaks | elemental | 0.99 | 2.70 | 0.97 | 1.17 | 0.70 | 1.35 | 0.89 | 0.00 | 0.00 |
| contour.streaks | atmospheric | 1.14 | 3.48 | 1.19 | 1.17 | 0.76 | 1.63 | 0.98 | 0.00 | 0.00 |

- Mid-tones get 1.1 to 1.2 % in every look and pack, so the grain looks the same across looks at the same lightness.
- In Rim, Halo and Beam Elemental most measured pixels are near black. There the grain fades out (it is 0 at black) and the per-channel dither is most of what is left, so the half width is near one pixel and the mono share lower. That is by design: black stays clean.
- No look bands at 4K, with or without grain. At strength 1 the deepest falloff of Beam Elemental has 0.6 to 1.0 % of its pixels in flat runs; every other frame has none.

### Preview, export, seeds, repeats, banding

| Check | Result |
| --- | --- |
| Preview vs export at the same viewing size (960 x 540 render vs the 4K render shrunk to 960 x 540) | grain 0.5: 0.79 % vs 0.76 %; grain 1: 1.22 % vs 1.25 % |
| Same seed twice (4K) | identical pixels |
| Seed 1 vs seed 2 | residual correlation -0.0004 (unrelated) |
| Repeats across the frame | largest correlation of the grain with itself shifted 16 to 512 px: 0.002 |
| Dark ramp #000000 to #1C2B33 at 4K, no dither | 10.8 % of pixels in flat 8-bit runs (bands) |
| The same with dither only, grain 0.5, grain 1 | 0 %, 0 %, 0 % |
| Contour looks at 4K, grain 0 and 0.5 | 0 % (Beam Elemental at grain 1: 1 %, in its deepest falloff) |

## Changes this round

- `src/light/engine/grain.ts`: the riso end's clumps are 9 % larger (0.0011 to 0.0012 of the short side) and its strength is 5 % higher (0.016 to 0.0168). Film grain (strength up to 0.6) is unchanged. With the old setting the riso end was 3 % finer and 1 % weaker than the prints' average; with the new one it is 5 % coarser and 4 % stronger. Both are well inside the prints' spread. The new one keeps the engine check of the densest ink (`check.mjs`, "riso crops within 20 %") at -16 % instead of -20 %.
- `scripts/light/grain-measure.mjs` and `scripts/light/lib/grain.mjs`: the measurement, the sheets and the edge threshold above.

## Sheets

All in `artifacts/grain/measure/sheets/`. Crops are 1:1, with a 3x zoom of the middle under each, and each crop has its own numbers.

- `riso-native.jpg`: each riso print next to its preset (as of c06c684) and with strength 1 everywhere, all at the print's size.
- `deck-tile.jpg`: the deck Grain tile exported at 1x, 2x and 4x, then our grain at 0.5 and 1 on a Bold sky at 1080p.
- `sunset-4K.jpg`, `contour-4K.jpg`: Sunset Ramp and Contour Beam in Bold, Elemental and Atmospheric at 4K, grain 0, 0.5 and 1, next to a riso print enlarged to a 2160 px short side.
- `sunset-1080p.jpg`, `contour-1080p.jpg`: the same at 1080p, also next to the deck tile at 1x.

## Questions for the owner

1. **How much grain at the top of the slider?** The deck's Grain tile is 2.5 % L of dark one-pixel specks at 1080p, about twice our strength 0.5 and more than strength 1 on light colors. Strength 1 matches the riso prints, which are softer and weaker on light colors. Keep this, or let the slider go further, up to the deck tile's amount?
2. **Riso presets' ink weight.** Answered in c06c684: the presets no longer leave the paper clean (paper 0.74 to 0.81 %, dense ink about 2.1 %; see the riso table above).
