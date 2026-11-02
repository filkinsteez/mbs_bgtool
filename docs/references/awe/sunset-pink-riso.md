# sunset-pink-riso

Figma node 41:28 "image 64", target 925×1447 (no `-full` file), recipe hint `sunset.bands`.

## What the light is physically doing

This is a scan of a risograph print, not a photo of a sky. There is no light source, lens, bloom, haze or halation. The scanner lamp reflects off cream paper through semi-transparent inks, so the paper is the white point and each ink only removes light. The fill is a 567×1134 JPEG scan of three riso prints stacked one above the other (siblings: `sunset-green-riso`, `sunset-blue-riso`). This tile is the third print turned 90° counterclockwise, a 317.2×496.3 px region enlarged 2.92× (Catmull-Rom).

The colors fit three inks:
- Pink, thickening from nothing at the top to full at 41-51% down. One ink getting denser on paper (paper × (magenta / paper)^t per linear channel) fits the top ramp to mean ΔE 0.9. A linear-light mix of cream and magenta fits worse (ΔE 1.7) and makes the pale pinks 10-20° too warm.
- Orange, printed as a stripe with a soft top and a stencil-hard bottom. Full orange `#E2624B` can't be orange over full pink, because the orange ink would have to pass more than 100% of the red light. So the pink is mostly absent under it.
- Below the edge, full pink again, then a blue-violet ink from about 65% down that turns it mauve, violet and slate. One ink getting denser does not fit this ramp (ΔE 3.2).

Where the pink fades out and the orange fades in, both inks are partial and more paper shows, so that zone is lighter and paler than either ink. The light line on the hard edge is the same effect over 1-2 scan pixels, most likely a small registration gap.

As a sunset it reads as a pale sky darkening toward a hard horizon (a real sky brightens toward it), an orange band on that horizon, and a magenta-to-slate ground. The orange is the most saturated color (C 0.164) but not the brightest: at L 0.652 it is darker than the magenta above it.

## Structure

- Axis 90°, R² 0.994. Iso-lines are horizontal.
- The horizon is the hard bottom edge of the orange band: midpoint y 893.9 (61.8%), 0.25 px RMS over 37 column groups, tilt 0.09 px across the width. It is ruler straight.
- The band's soft top: midpoint y 821 (56.7%), straight to 1.6 px RMS, 5 px higher at the right edge.
- No curvature to model. The profile's bows (−0.014 and −0.015 frame heights) on the lower transitions and the −0.019 tilt of the top one are small next to ramps 165-450 px wide, and come from uneven tone: at the right edge the cream is 0.026 L darker and yellower and the slate 0.04 L darker. Mid-tones are even across the width.
- 10-90% widths as % of frame height: cream to magenta 31% (y 107-555), magenta to orange 6.65% (y 763-859), orange to magenta 0.75-0.86% (y 887-899), magenta to violet 16.6% (y 954-1195), violet to slate 11.4% (y 1252-1417).

## Color stops

Row means over the full width; position = y / 1447. "Shape" rows are not new colors; a linear-light ramp needs them to follow the curved color paths. Through all 16 rows, mixed in linear light with no blur, the ramp matches the image to mean ΔE 0.60 (0.43-0.85 per zone, worst 3.2 at y 898).

| pos | y | hex | color | L | C | source |
| --- | --- | --- | --- | --- | --- | --- |
| 0% | 0 | #F4EDE8 | cream paper | 0.951 | 0.010 | profile |
| 4.8% | 70 | #F1E6E3 | cream, first pink | 0.933 | 0.013 | shape |
| 14.5% | 210 | #F0D0DF | pale cool pink | 0.888 | 0.042 | profile |
| 22.8% | 330 | #EBAED0 | light pink, coolest hue (h 345) | 0.816 | 0.083 | shape |
| 33.2% | 480 | #E48AB7 | pink | 0.742 | 0.122 | shape |
| 44.9% | 650 | #D6699E | magenta pink, plateau | 0.665 | 0.148 | profile |
| 51.1% | 740 | #DA70A0 | end of plateau | 0.680 | 0.143 | shape |
| 54.5% | 788 | #E47E96 | salmon pink bridge | 0.712 | 0.127 | profile |
| 58.1% | 840 | #E47169 | coral | 0.680 | 0.144 | shape |
| 60.3% | 873 | #E2624B | orange (C ≥ 0.160 over y 865-883) | 0.652 | 0.164 | profile |
| 61.4% | 888 | #DA6154 | darker red rim | 0.640 | 0.156 | added |
| 61.9% | 895 | #EF7883 | light coral seam, 4 px | 0.712 | 0.145 | corrected |
| 62.3% | 902 | #D36096 | magenta | 0.645 | 0.155 | profile |
| 75.2% | 1088 | #A96499 | mauve | 0.597 | 0.114 | shape |
| 84.9% | 1229 | #7E6995 | dusty violet | 0.558 | 0.070 | profile |
| 99.9% | 1446 | #4C4D6A | slate blue-violet | 0.432 | 0.048 | profile |

Changes from the profile:
- Its 61.7% stop (`#E06969`, L 0.664) is the seam sampled at 12 px steps. The peak row, y 895, is `#EF7883` (L 0.712), 4 px tall at half height. It is a line on the edge, not a band.
- I kept the 14.5% pale pink although it is a knee of the ramp, because no mix of cream and magenta gives that cool pink.
- I added the red rim and the shape rows. The slate is not an end color; L still falls through the last row.

## Transitions

- Cream to pale pink (10.7%): no bridge; chroma is highest at the pink end. A faint peach (`#F0E0DE`, h 23-29°) appears only inside it. The midpoint `#F1DEDF` matches linear-light and sRGB mixes in L and C within 0.003 but is 16° warmer.
- Pale pink to magenta (21.6%): no bridge. Hue dips to 343-345° over y 230-360, cooler than both ends (347.5° and 351.6°). The midpoint `#E89FC5` is 0.012 C above the linear-light mix (`#E3A0BE`) and 0.008 above the sRGB mix.
- Magenta to orange (6.65%; the profile splits it in two at the bridge): a lighter bridge. L peaks at 0.713 at y 788, 0.048 above the magenta and 0.061 above the orange, while chroma drops to 0.127. At equal hue it is 0.05 L lighter and 0.02 C duller than both a linear-light and an sRGB mix (y 805: real `#E57E8E`, linear-light mix `#DD667C`). Chroma peaks at the orange end, and hue climbs steadily from 352° to 32°.
- Orange to magenta, the hard edge: 10-90% over 11-12.5 px, steepest 3 px at y 893-895. A darker red rim (y 885-890, −0.011 L) comes first, then the seam, 0.057 L above a linear-light mix of the two sides at its hue. So this edge also has a lighter bridge, 4 px tall. The profile's 0.55% and 0.71% widths are the two halves of the seam. By y 902 the hue is back to 353°, so no orange shows below.
- Magenta to dusty violet (16.6%): no bridge. L falls 0.645 → 0.598 (flat at 71-75%) → 0.558. The midpoint, mauve `#A96499`, matches both mixes within 0.007 C.
- Dusty violet to slate (11.4%): steady darkening. The midpoint `#625E81` is 8-9° bluer and 0.004 C duller than either mix.
- A single magenta-to-slate mix misses by up to 45° of hue (plum where the print is violet), so the violet stop is required.

## Softness and edges

The two long ramps (30-31% of frame height) are S-shaped and slow at both ends; the top 4% is nearly bare paper. The band's soft top is 80-104 px wide per 25 px column group. The hard edge has a core one scan pixel wide (3 px) with about 4 px shoulders from the rim and the seam, mostly 8-13 px per column group. Neither edge's softness changes along its length. The top of the band is about 8× softer than its bottom.

## Grain and texture

- Size: soft blobs 4-5 px at 925 wide (half-correlation 1.9-2.5 px), 1.3-1.7 px in the scan. They are scan pixels smeared by the resize, so there is no single-pixel noise.
- Strength after a 4 px high-pass (L×100 / % of 255): cream 0.65 / 0.85%, pinks 0.55-0.58 / 0.7%, magenta 0.73 / 0.9%, orange 0.74 / 1.0%, magenta below the edge 0.82 / 1.05%, violet 1.84 / 2.1%, slate 2.17 / 2.4%. Overall 1.2-1.3%. It steps up where the blue-violet ink starts, with light specks where that ink's coverage breaks.
- Mono: 93-99.7% of the residual is lightness.
- Mottle at 8-40 px: 0.5-0.9 L×100, 1.5 in the slate.
- Compression: JPEG 8×8 blocks (about 23.3 px in the target, a clear peak in the spectrum along x), the 2.92 px resize pitch, and light rings around single dark specks. All are visible only at 6×. No banding.
- The profile's along-iso autocorrelation dip (−0.33 at 5-6 px) comes from its one-direction high-pass, not from the grain.

## Highlights

Nothing is brighter than paper. The brightest 0.5% is `#F8F3F0` (L 0.967). No pixel is 255 white, and 0.002% have one channel at 255. No roll-off is needed. In the middle of the frame the lightest points are the two bridges (L 0.712). The darkest 1% is `#474865` (L 0.412); nothing is near black.

## What to ignore

- The fold crease, manifest rect [0, 700, 925, 34]: a 3-6 px dark line at y 717-720, 0.025-0.098 L darker than its surroundings. It is darkest at x 500-700, faint right of x 700, and entirely inside the rect.
- JPEG blocks, the resize pitch and its rings.
- The darker right edges of the cream and the slate (scanner or paper shading).
- Keep the seam. It comes from the print, not light, but it is visible in the tile, and dropping it raises the edge-zone error from ΔE 0.78 to 2.41. The red rim is optional.

## Recipe and light model

`sunset.bands` is the right family: ink bands stacked in order, one hard boundary, no glow. The current recipe can't reach 1:1, though. It has six flat bands, one global softness varied only by noise, and one warp amount. This reference needs per-edge widths from 0.75% to 31% of frame height, gradients inside bands, the lighter bridge, the seam, and no warp on the hard edge. The 16-row stop list mixed in linear light already matches, so the simplest extension is per-stop positions with optional per-edge softness. `sunset.ramp` mixes the same way but has six stops and one softness, and its additive glow would have to stay at 0.

Light model, in SHARED.md terms:
- Mix adjacent stops in linear light. With the rows above, every pair is within about 0.01 L and C of a linear-light mix.
- Apply the lighter-bridge rule at magenta to orange (+0.05 L, −0.02 C at the middle) and at the seam.
- The orange band is a color band, not added light. Adding orange light to the magenta would lift it well above L 0.7.
- No roll-off, bloom or halation. Set lens bloom to 0; the recipe's default 0.05 would spill light across the hard edge.
- The brief says the horizon is never a ruler line, and this reference has one. Use warp 0 on the hard edge for the 1:1 preset. The brief's rule still applies to production presets.

Starting parameters, as fractions of frame height:
- stops: the table's 16 rows at 0, 0.048, 0.145, 0.228, 0.332, 0.449, 0.511, 0.545, 0.581, 0.603, 0.614, 0.619, 0.623, 0.752, 0.849, 1.0
- horizon (hard edge) at 0.618, 10-90% width 0.0075, warp 0, tilt 0
- if the band is built as a one-sided glow: core = the orange plateau 0.598-0.610, tail upward only (10-90% 0.0665, midpoint 0.567), none below the horizon, peak C 0.164 at L 0.652
- seam: 0.0028 tall at half height, +0.057 L
- grain: mono, blob about 0.5% of frame width; 0.009 in the pinks and orange, 0.022 in the violet and slate, or 0.012 as one global value

## Five things a recreation must get right

1. The hard edge at y 894 (61.8%): ruler straight, 10-90% about 11 px (0.75%), with a 4 px light coral seam (`#EF7883`, L 0.71) along it and no orange below it.
2. The band's soft top: 10-90% about 96 px (6.65%), midpoint y 821. It passes through a salmon pink (`#E47E96`, L 0.712 at y 788) that is lighter than both the magenta above and the orange below.
3. The orange (`#E2624B`, C 0.164) is the most saturated color but no lighter than the magenta (L 0.652 vs 0.665). Hue at or above 20° covers only about 65 px (y 829-894).
4. The ramps: cream paper on top, never white; cool pale pinks (h 343-348) into the magenta plateau at 41-51%. Below the edge: magenta → mauve (75%) → dusty violet (85%) → slate `#4C4D6A`, still darkening at the bottom and nowhere below L 0.41.
5. The surface: mono, soft 4-5 px grain, about 0.9% of 255 in the pinks and orange and 2.2% in the violet and slate, with no banding, single-pixel noise or color noise.

## What would make it look like a stock or Instagram gradient

- An orange stripe blurred the same on both sides, or one that glows lighter than the magenta: the usual retro-sunset stripe.
- Mixing magenta into orange without the lift, which gives a darker hot pink-red middle (`#DD667C` where the print has `#E57E8E`).
- Two-color ramps: cream to magenta turns dusty salmon in the middle, and magenta to slate turns plum instead of violet.
- Screen-bright colors: hot pink, pure orange, pure purple, a white top, a navy or black bottom. The print's magenta is C 0.148 and its slate C 0.048.
- No grain, fine noise of one strength everywhere, or colored noise.
- Bloom or glow spilling across the hard edge.
- Copying the fold, the JPEG blocks or the edge shading.
