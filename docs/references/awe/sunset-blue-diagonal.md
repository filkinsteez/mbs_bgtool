# sunset-blue-diagonal

Figma node 41:22 "image 41", target 925×1214 (the 1200×1575 source reduced to 925 wide), recipe hint `sunset.ramp`.

## What the light is physically doing

A camera JPEG, probably from a phone, of a clear twilight sky taken toward the afterglow. The sun is below the horizon and off-frame to the left, and the horizon is just below the bottom edge. There is no ground, cloud or haze layer.

- **Color by height:** light near the horizon has crossed the most air, so the bottom edge is red-orange. Above it come amber, yellow and cream, then blue sky, darkest at the top. At every height the sky is brighter toward the sun (left).
- **Where blue meets warm:** on the sun side, the warm band and the blue sky add up to a near-white bridge, with a faint lavender tint above it. On the far side, a dimmer blue meets a dim tan band through a slightly green grey.
- **Camera effects:** the red channel clips in the bottom-left, which shifts those colors toward yellow and flattens their brightness. The texture is 8×8 JPEG blocks. There is no flare, bloom or halation.

## Structure

- **Blue part:** the profile's 123.5° axis (r² 0.94) fits the blue upper two-thirds. The blue contours run 35° below horizontal on the left half (0.70 px down per px) and 29° on the right half (0.55). They are smooth.
- **Warm part:** the lower third is level bands, not a diagonal.
  - The a = 0.08 contour (red-orange) stays at y 1163 to 1181 from x 0 to 500, and a = 0.10 stays at y 1187 to 1200 from x 0 to 400.
  - The blue-to-warm boundary (Oklab b = 0) is at y 763, 871, 924, 972, 1010 and 1029 for x 0, 300, 450, 600, 750 and 900. It rises 22% of the frame height (H) toward the left in one bend and is level over the right third.
  - The warm zone is 2.4 times taller at the left edge (451 px) than at the right (187 px).
- **Brightest band:** it sits at y 1038 to 1065 (86% H) for x ≥ 250 and rises to y 962 at the left edge. Lightness contours in the lower half are nested lobes that close on the left edge, tips pointing right along this band.
- **Left-to-right brightness:** luminance is nearly separable. At every height the left edge is 2.6 to 3.6 times brighter than the right edge (about 1.75 stops), and the log ratio falls linearly with x.
- **Not a corner source:** ellipses centered on the bottom-left corner fit the red-channel contours at 25 px rms. The best fit puts the center more than a frame width to the left, with a 5:1 aspect, at 7 px rms. The curves come from level bands multiplied by the falloff.
- **Horizon:** level, just below the frame.

## Color stops

Profile stops (123.5° axis): #093179 0%, #254E9E 25%, #5176C2 42%, #899BC3 58%, #F7BF88 83%, #FEAB46 94%, #FE7636 100%.

- I merged the 25% stop: it is a knee in one long blue ramp.
- I kept 42%: chroma starts to fall there.
- I replaced the three warm stops. They are averages along diagonals that cut across level bands; #F7BF88 is a mix of cream, yellow and orange that is not a band anywhere.

The table gives stops from the same simplification, run down the left edge (sun side, x 0 to 23) and the right edge (far side, x 901 to 924).

| edge | y px (% H) | hex | color | L | C |
|---|---|---|---|---|---|
| left | 0 (0) | #3762AB | medium blue | 0.502 | 0.127 |
| left | 454 (37) | #829CDB | light periwinkle | 0.697 | 0.098 |
| left | 712 (59) | #C5C8DA | pale blue-grey, lavender tint | 0.836 | 0.025 |
| left | 763 (63) | #D4CECE | near-neutral pale grey (lowest chroma) | 0.857 | 0.007 |
| left | 942 (78) | #FDDEAA | pale cream-yellow (brightest) | 0.913 | 0.075 |
| left | 1125 (93) | #FFC44D | amber yellow | 0.852 | 0.147 |
| left | 1213 (100) | #FE7636 | red-orange | 0.719 | 0.182 |
| right | 0 (0) | #0A3179 | deep blue (darkest) | 0.338 | 0.130 |
| right | 590 (49) | #3065B7 | medium blue | 0.515 | 0.141 |
| right | 930 (77) | #698DB1 | steel blue | 0.630 | 0.068 |
| right | 1030 (85) | #7E918B | grey-green | 0.641 | 0.024 |
| right | 1121 (92) | #968262 | khaki tan | 0.618 | 0.052 |
| right | 1213 (100) | #7E5541 | brown-orange | 0.489 | 0.063 |

Center column (x 451 to 474): #1B4290 0%, #3257AA 21%, #738BC9 53%, #C4B3AB 79% (grey pink-beige), #DDB38E 86% (brightest), #E7AB70 91%, #EC914C 96%, #D97244 100%. The blues have Meta Blue's hue (259° to 262°) at about 0.7 of its chroma: #3065B7 has C 0.142, #0064E0 has C 0.205.

## Transitions

Midpoints are taken at 50% Oklab progress and compared with linear-light and sRGB blends of the same two stops.

| pair | 10-90% y | width % H | midpoint vs blends | notes |
|---|---|---|---|---|
| left #3762AB→#829CDB | 46–412 | 30.1 | C +0.019 vs linear, +0.016 vs sRGB | holds chroma, then lightens |
| left #829CDB→#C5C8DA | 477–690 | 17.5 | matches both | hue drifts 267°→278°, toward lavender |
| left #C5C8DA→#FDDEAA | 735–919 | 15.2 | linear: C −0.003, L +0.003; sRGB: L +0.006 | passes #D4CECE with a faint pink cast (h 17° to 25°) |
| left #FDDEAA→#FFC44D | 970–1112 | 11.7 | L +0.010, C +0.009 vs linear | stays yellow (h 86°) longer because red is pinned |
| left #FFC44D→#FE7636 | 1137–1202 | 5.3 | matches both | chroma peaks at the bottom edge (0.182) |
| right #0A3179→#3065B7 | 76–551 | 39.1 | C +0.009 | one long ramp |
| right #3065B7→#698DB1 | 623–892 | 22.2 | C +0.015, L +0.010 | hue drifts 259°→249°, toward cyan |
| right #698DB1→#7E918B | 936–1025 | 7.3 | matches both | grey-green (h 150° to 187°) appears only here |
| right #7E918B→#968262 | 1042–1112 | 5.8 | matches both | sage, then olive, then khaki |
| right #968262→#7E5541 | 1136–1205 | 5.7 | C +0.016 | gains chroma toward the bottom |

Every column has a lighter bridge in the warm zone:

- Left: #FDDEAA, L 0.913 against 0.836 above and 0.852 below.
- Center: #DDB38E, 0.796 against 0.778 and 0.785.
- Right: #7E918B, 0.641 against 0.630 and 0.618, only barely lighter.

In the center, the blue-to-warm step passes faint mauve (h 300° to 350°, C 0.015 to 0.023) at y 900 to 950. Across all columns, the blue-to-warm midpoint is 0.002 to 0.018 L lighter than a linear-light blend. Its chroma is 0.005 below to 0.015 above that blend, depending on x.

## Softness and edges

Every edge is soft.

- **Blue ramps:** the widest, 18% to 39% H.
- **Blue to warm:** widest on the sun side. Oklab b goes from −0.06 to +0.06 over 27% H at x 0, 21% at x 450 and 20% at x 900.
- **Bottom step:** the narrowest is amber/orange to red-orange along the bottom, 3% to 6% H. It is still a ramp, not a line.
- **Along the warm boundary:** height and softness change together in one bend. Contour wobble is under 1% H.

## Grain and texture

There is no film grain; the texture is JPEG compression.

- **Blocks:** in the 1200 px source, the luma step across 8 px block edges averages 1.44 code values, against 0.38 to 0.52 inside blocks, both ways. The residual amplified 16 times shows only 8×8 blocks with DCT stripes and pink and green chroma blotches (`full-res-top-right-residual-x16.png`). Chroma is stored at half resolution. In the target the blocks are about 6.2 px, on no fixed grid.
- **Strength:** σ is about 1.0 code value, which is 0.41% of 255 and Oklab L×100 0.34. It is strongest in the deep blue at the top right (1.46, 0.57%) and weakest in the clipped bottom-left (0.56, 0.22%), where red has no noise.
- **Size:** luma texture is about 2.7 px at 925 and 2.8 px at 1200. It does not scale with the image the way grain would. Chroma blotches are about 5 px at both sizes.
- **Mono or color:** 55% to 62% of the residual is lightness; the rest is chroma blotches.
- **Banding:** none is visible, because the blocks hide the 8-bit steps. The deep-blue ramp moves one code value every 10 to 25 px, so a clean render needs dither there.

## Highlights

- **Brightest pixels:** the brightest 0.5% average #FDDCA3 (L 0.909). 90% of them lie at x 2 to 61 and y 912 to 1014, against the left edge. The peak pixel is #FCE3AB (L 0.923) at (29, 944).
- **Red-only clip:** the warm end is a clipped highlight in the red channel only. R is 255 on 2.8% of pixels and at least 250 on 6.6%, in a lobe covering x < 400, y > 915 (`red-clip-map-half.png`). G and B never reach 255, and no pixel is white.
- **Inside the lobe:** the ramp continues through G and B alone, from cream-yellow to yellow, amber, orange and red-orange, with R at 254 to 255. This pushes the hue toward yellow (85° to 86° at y 1000 to 1100) and flattens brightness: along y 1205, L stays at 0.726 to 0.730 from x 0 to 225.
- **Clip edge:** there is no ring. On the left edge R reads 230, 242, 250, 253 and 255 at y 850, 900, 925, 950 and 975.
- **Darks:** the darkest 1% average #0C357F (L 0.352), in the top-right corner. The minimum is #0A2D73 (L 0.323), and no channel reaches 0.

## What to ignore

There are no ignore rects, corners, text or folds. Ignore the JPEG blocks and chroma blotches. Keep the look of the clipped red (cream-yellow core, flat red-orange bottom-left), but not the mechanism: no hard clamp at 255.

## Recipe and light model

`sunset.ramp` fits, with level bands, a horizon that warps up toward the left, and a flat glow. `sunset.blooms` would miss the level bands. `sunset.bands` would add steps that are not there.

Light model:

- Build linear radiance as a vertical sky ramp times a horizontal falloff, with the warm band reaching higher on the sun side. Add the warm light to the blue in linear light, so the meeting zone comes out pale and near grey, with no dip in lightness.
- Use the tone curve's soft shoulder, so red saturates first and the brightest area reads cream-yellow, not white.
- Use no bloom or halation: there is no point source and no dark area next to a highlight.

Starting parameters (fractions of W and H):

- Ramp colors (center column): #1B4290 0.00, #3257AA 0.21, #738BC9 0.53, #C4B3AB 0.79, #DDB38E 0.86, #E7AB70 0.91, #EC914C 0.96, #D97244 1.00.
- Horizontal falloff: +1.0 stop at the left edge and −0.8 stop at the right, relative to the center. Linear in stops (luminance e-folding about 0.78 W) and the same at all heights.
- Horizon warp (b = 0): y 0.63 at x 0, 0.72 at 0.32, 0.76 at 0.49, 0.80 at 0.65, 0.83 at 0.81, and 0.85 from 0.97 on. Amplitude 0.22, one bend, waviness under 0.01.
- Bright band: 0.86 for x ≥ 0.27, rising to 0.79 at x 0.
- Ground horizon: level, at y 1.0 to 1.05, unseen.
- Red-orange band: the bottom 3% to 4%, level.
- Glow: no separate core. If the recipe needs one, center it at x ≤ −1.0 near y 1.0 with at least a 3:1 width-to-height aspect. Red should reach the shoulder over x < 0.43, y > 0.75, with the peak at #FDDEAA to #FCE3AB.
- Grain: mono, σ about 1 code value (0.4% of 255), at output size, as dither. No blocks and no chroma noise.

Check renders against both edge columns, not only the center.

## Five things a recreation must get right

1. The bottom edge is red-orange across the full width at one hue (43° to 50°), darkening from #FE7636 (L 0.72) at the left to #7E5541 (L 0.49) at the right. The bottom-right corner is brown-orange, not lavender.
2. The blue-to-warm boundary rises from 85% H on the right third to 63% H at the left edge in one smooth bend, so the warm zone is 2.4 times taller at the left.
3. The left side is about 3.3 times brighter than the right at every height (top-left #3762AB, top-right #0A3179). The blue contours slope 29° to 35° below horizontal.
4. Where blue meets warm, the color is pale and nearly grey: #D4CECE (C 0.007) at the left edge, faint mauve in the middle, faint grey-green #7E918B at the right edge. Lightness never dips on the way from the blue into the warm band, and it peaks inside the warm band in every column.
5. The brightest area is pale cream-yellow #FDDEAA to #FCE3AB (L 0.91 to 0.92) on the left edge at 75% to 84% H. Below it come yellow, amber, orange and red-orange, with no white and no ring at the edge of the saturated zone.

## What would make it look like a stock or Instagram gradient

- One straight 123.5° navy-to-orange gradient: ruler-straight contours, a lavender bottom-right corner and no level bands.
- Blending #3762AB straight to #FE7636 (the left edge's top and bottom): the midpoint is rose #BE6D82 in linear light or mauve-brown #9B6C71 in sRGB. Both are darker and more saturated than the real bridge at L 0.83 to 0.91.
- A saturated pink or purple band between blue and orange. In the reference, chroma in that zone stays at or below 0.025.
- Even brightness across the width, a centered radial sun glow, or a sun disk.
- A white hotspot, or a flat clamped yellow patch with an edge.
- Too much warm color. Warm hues (b > 0) cover 24.5% of the frame, and clearly blue pixels (b < −0.05) cover 67%.
- Neon orange. The most saturated area, the bottom-left corner, reaches C 0.18 to 0.185 at L 0.72, and most of the warm zone is pale (C below 0.1).
- JPEG-like blocks or coarse color noise used as grain.
