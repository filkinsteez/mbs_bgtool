# sunset-sky-peach

Figma node 41:14 "image 39", target 925×1001 (top 72% of the 541×812 source, enlarged 1.71×; no `-full` file), recipe hint `sunset.ramp`.

## 1. What the light is physically doing

A digital photo of a clear sky over the sea, taken toward the glow, with the sun below the horizon to the right of the frame. The tile ends 7 to 10 target px above a thin, level horizon line in the source (`#A95856`, 2–3 source px), so it shows sky only.

- Top: blue skylight, a greyish mid blue (`#6A92C7`, L 0.65, C 0.09).
- Middle: the blue fades as warm light rises. Where they overlap the sky is a neutral grey, lighter than the blue.
- At 56% of the height: the brightest band, a flat pale peach glow (L 0.80). No sun disc, no core, nothing near white.
- Below: darker and redder toward the horizon, where light crosses more air and haze. Red holds to 75% of the height while green and blue fall; in the last 2.5% blue is above green (crimson, not brick).
- The right side is brighter at every height (about 1.4× the left edge's luminance) and pinker in the middle third. It is not vignetting: the top-right corner is lighter than the top center.
- No clouds or sensor noise. The only fine structure is JPEG compression, enlarged 1.71×.

## 2. Structure

- Axis: vertical. Hue lines are level: red (hue below 40°) starts at y 890–902 in every column, and the blue-to-warm crossover (Oklab b = 0) only moves from y 422 at the left edge to y 380–386 on the right half. Lightness lines tilt steeply (L 0.70 at y 356 on the left, y 54 on the right) because of the lateral gain. That gain pulls the profile's axis to 91.5° and gives its T1 a −10.8% tilt and 2.7% bow. Model a lateral gain, not a rotated or curved ramp.
- Lower transitions: bow −0.8 to −1.2% of frame height (H), waviness 0.2% H. Straight.
- Horizon: about y 1009 (1.008 H), straight and level in the source.
- Glow: peak at y 560 in the center, within 0.02 L from y 455 to 645 (19% H). The brightest 0.5% of pixels touch the right edge (x 732–924, y 518–606), so the light peaks at or past that edge.
- 10–90% widths shrink from 32% H at the top to 4% H at the bottom (section 4).

## 3. Color stops

Center strip (x 412–512). Position = y / 1001 on a vertical axis.

| pos | y | hex | color | L | C |
| --- | --- | --- | --- | --- | --- |
| 0% | 0–8 | `#6A92C7` | greyish mid sky blue | 0.653 | 0.091 |
| 39% | 392 | `#B0B1B1` | neutral light grey | 0.760 | 0.001 |
| 56% | 560 | `#D1B99F` | pale peach (brightest) | 0.800 | 0.044 |
| 76% | 760 | `#D09568` | light orange | 0.717 | 0.093 |
| 86% | 863 | `#C16E46` | orange | 0.622 | 0.118 |
| 94% | 943 | `#A13F2E` | red (most saturated) | 0.499 | 0.134 |
| 100% | 997 | `#792127` | deep crimson | 0.391 | 0.122 |

Left / right edges: top `#5B82C3` (L 0.61) / `#749AD8` (0.68); greyest `#A2A5A4` at y 424, faint green / `#BBB9BC` at y 380, faint lavender; peak `#BEAC91` (0.75, khaki) / `#E7C5A7` (0.845); bottom `#5C1820` (0.32) / `#862022` (0.41).

Changes from the profile:
- Merged `#739AD4` (0.2%) and `#6B91C9` (2.9%). Positions below 2.4% on the 91.5° axis contain only the top-right corner, which is lighter like the rest of the right side. There is no top band: the sky darkens steadily to the edge, and rows 0–5 differ by at most 1 level (the enlargement repeating the first source row).
- Added the neutral grey, which the fit skipped because it lies on a straight Oklab line. It is the bridge color.
- Dropped `#C3B8AA` (48.6%, a point on the ramp) and replaced `#D7B592` (61.5%, past the peak) with the peak.
- Replaced `#611922` (99.8%, the bottom-left corner) with the bottom center.

## 4. Transitions

Center strip. "Linear" means a linear-light mix at the same progress.

| pair | 10–90% (y) | width (H) | notes |
| --- | --- | --- | --- |
| blue → grey | 43–364 | 32.0% | Midpoint `#8CA4C2`: +0.005 L, +0.005 C vs linear (`#90A1BD`); +0.006 L, +0.007 C vs sRGB. The blue holds, then drops. On the right only, the hue swings to 264–273° (lavender-grey). |
| grey → peach | 407–535 | 12.8% | Midpoint `#BFB8AB`, hue 83°, yellower than the peach end (70°) and than linear (`#C1B5A9`, 69°). This yellow grey-beige appears only here, strongest on the left (khaki). |
| peach → light orange | 604–747 | 14.3% | Midpoint `#D4A97D`: +0.005 L, +0.011 C vs linear (`#D0A785`). A golden tan (`#D4AF84`, y 659) holds before the orange. |
| light orange → orange | 770–853 | 8.3% | Matches linear. |
| orange → red | 873–936 | 6.3% | +0.008 C vs linear, +0.006 vs sRGB. Chroma peak at y 934 (C 0.135). |
| red → deep red | 948–991 | 4.3% | Matches linear. |

No midpoint is lighter than both ends; the profile flags T2 only because the glow's lightness peak sits inside it. The bridge between the distant hues is the grey at 39%. Its lightness lies between its neighbors, but it is 0.011 L lighter than any two-color blend of the top blue and the peach. At the blend's greyest point, linear light gives `#B3ACAF` (L 0.750, C 0.010, faint mauve), sRGB `#AEACAC` (L 0.746) and Oklab L 0.750. The real grey is about `#B1B1B1` (L 0.76, C 0.001).

## 5. Softness and edges

There are no edges. Transitions tighten steadily toward the bottom, from 32% H (blue to grey) to 4.3% H (43 px, red to deep red). Across the width, the two lowest transitions keep their width within about 8%. The ones above vary by 20 to 30% (grey to peach 6.3–10.9% H) because the brighter right side widens the peach band. The bottom edge cuts the ramp while it is still falling (L drops 0.04 per 25 px in the last 50 rows).

## 6. Grain and texture

No film grain or sensor noise. The residual after a 10 px blur is 0.6 to 0.75 of an 8-bit level (0.23 to 0.29% of 255) everywhere, all from compression:

- JPEG blocks: 8 px at the source, 13.7 px at 925 wide. Steps on block seams are 5–7× those inside blocks (1.1 vs 0.2 levels, summed over RGB).
- Scattered blocks with a leftover checker pattern: ±2–4 levels, lobes 3–5 px (2–3 px at the source).
- 1-level 8-bit steps every 2–6 px down a column, often stepping back down a level, so the values flicker around the ramp instead of forming a staircase. No banding visible at 1×.
- Faint green and magenta chroma blotches at block size.

The profile's along-iso numbers (0.157% of 255, L×100 0.127, mono share 0.75, size 4.4 px) measure these block steps. There is no grain size to match.

## 7. Highlights

Brightest 0.5%: `#E6C5A8` (L 0.843, C 0.054), against the right edge. Channel maxima are R 237, G 199, B 220: nothing reaches 255, nothing rolls off to white, no core. The glow has about 1.8× the luminance of the top blue. Darkest 1%: `#6D1E23` (L 0.364), in the bottom 33 rows, mostly on the left; the darkest pixel is `#57141B`, at the bottom-left corner. No black: the darks are deep crimson at about a tenth of the glow's luminance.

## 8. What to ignore

- Manifest ignore rects: none.
- JPEG blocks, checker specks, chroma blotches, and the 1-level strip in rows 0–5.
- The softness from the 1.71× enlargement; there is no detail to recover.
- The source's horizon line and sea, which are outside the tile. Do not add them.
- Keep the brighter right side; it is light.

## 9. Recipe and light model

`sunset.ramp` fits: a vertical ramp, a horizon just below the frame, a flat glow brighter on one side. There are no distinct bands for `sunset.bands`, and unlike `sunset.blooms` the structure is ordered from the horizon.

Add in linear RGB (weights fitted to the center column):

1. Sky `#6A92C7` (linear 0.144, 0.287, 0.571): weight 1.0 at the top, 0.87 at 16% H, 0.59 at 32%, 0.39 at 40%, 0.23 at 48%, 0 at 56%.
2. Glow `#D1B99F` (linear 0.638, 0.485, 0.347): weight 0.03 at 4% H, 0.19 at 16%, 0.44 at 32%, 0.63 at 40%, 0.80 at 48%, 1.0 at 56%. These two alone are short of green by 0.01–0.025 linear between 30 and 50% H, which shows as mauve. Add a pale yellow-white haze there, or make the glow yellower above its peak.
3. Below the peak, per-channel falloff relative to the peach (R, G, B): 70% H 1.0, 0.79, 0.56; 80% 0.93, 0.49, 0.30; 90% 0.71, 0.20, 0.11; 95% 0.51, 0.083, 0.077; 99.5% 0.31, 0.031, 0.059. Blue levels off near 0.06 (about 0.02 linear) while green keeps falling. Keep that blue floor.
4. Lateral gain on all terms: ×0.83 at the left edge, ×1.16 at the right. In the middle third, add red to the glow on the right (Oklab a +0.012 to +0.017 over the left).

Starting parameters:
- Horizon y 1.008 H; warp at most 0.003 H (the reference is level and the horizon is off-frame).
- Glow center x 1.0–1.2 W, y 0.56 H; flat from 0.46 to 0.64 H; no core; upper tail reaches the top edge.
- Bloom and halation off. Exposure puts the glow peak at L 0.80 (center) and 0.845 (right), below the white roll-off.
- Grain 0, dither on.

## 10. Five things a recreation must get right

1. The greyest row of the blue-to-peach bridge is near 39% H in the center and neutral: about `#B1B1B1`, C ≤ 0.005, L 0.76 ± 0.01, no mauve or pink, lighter than the top blue.
2. The brightest band is a flat pale peach centered at 55–57% H (center `#D1B99F`, L 0.80), within 0.02 L from 46 to 64% H, with no core and no channel above about 240.
3. The right edge has about 1.4× the left edge's luminance at every height (top L 0.61 vs 0.68, peak 0.75 vs 0.845) and holds the brightest patch, while red still starts at about 0.9 H across the full width.
4. The ramp tightens toward the bottom (10–90% widths about 32, 13, 14, 8, 6, 4% H), with the chroma peak C 0.135 (`#A13F2E`) at 94% H and a crimson bottom (`#792127`, blue at or above green).
5. The surface is clean: no visible grain, banding or blocks; no horizon line, clouds or sun disc; lower bands straight within 0.5% H.

## 11. What would make it look like a stock or Instagram gradient

- Evenly spaced sRGB stops (blue, peach, orange, red at 0/33/66/100%). The blue-to-grey top shrinks, red covers a third of the frame, and all transitions get the same width.
- A pink or mauve middle from blending blue straight into peach: `#B3ACAF` in linear light here, and pink `#C890A7` when Meta Blue blends into `#F2A27A`.
- More saturation: a deep top blue (C above 0.15) or an orange glow. Here the glow is pale (C 0.044) and the most saturated color is the dark red near the bottom.
- The brightest light at the bottom edge, a sun disc or a round glow. Here the bottom is darkest and the glow is a flat mid-height band.
- The same color across each row, which reads as a CSS gradient.
- A white or yellow horizon line, a black bottom, or a brick-orange bottom (blue below green).
- Visible grain, a color-filter tint or a vignette.
