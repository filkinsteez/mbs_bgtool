# sunset-red-yellow-arcs

Figma node 41:15 "image 40", target 925 × 1370, recipe hint `sunset.ramp`.

## 1. What the light is physically doing

The source is a digital poster ("Caloroso"), not a photo. The Figma fill shows it on a flat #FBFBFB mat with a caption row along its bottom edge. The tile is a crop inside the poster border, enlarged 2.12x. There is no lens, film or paper: no grain, bloom, halation or vignette. The only texture is JPEG blocking.

The colors run in the order of sunlight that has crossed more and more air. Light blue sky light is at the bottom, then pale cream, golden yellow, orange, scarlet, and dim maroon at the top. Each step up has more blue and green removed, so the light gets redder and darker (L 0.896 at the cream, 0.373 in the top corners). It is a dusk sky laid out upside down. The cream between yellow and blue is lighter than both, as scattered light is. The cream-to-blue blend passes through a very pale mint-grey, which is what yellow light plus blue light gives.

Every band is domed: highest at the center, lower at the sides. The arcs are not concentric, so this is one curved horizon repeated at every height, not a falloff around a source below the frame. Because the file is clean, its natural look comes only from the uneven band widths, the light-mix midpoints and the dome.

## 2. Structure

- Axis 90° (top to bottom), 1D fit r² 0.993.
- Dome: matching each edge pixel's color to the center column's rows, the edge strips (x 12, 912) sit 67-95 px lower than the center from y 300 to 1300 (median 77). That is about 81 px, 5.9% of H, at the frame edges. In the top 250 px the drop is 95-130 px (about 7.5% of H). Across the width it is a parabola, d = 81·u² px with u = (x − 462)/462, within 4 px. Symmetric within 5 px, no tilt, waviness ≤ 3 px RMS.
- Not concentric. Circle fits to iso-lines through the center column: y 344 (red) has its center at (463, 1605), R 1257; y 693 (red-orange) at (461, 1972), R 1279; y 1205 (cream to blue) at (459, 2550), R 1345. The top arc (y 71) has R 991. The centers move down as fast as the arcs, and the radius grows from 0.72 H at the top to 1.0 H at the bottom. There is no common center. The best single center, (462, 2000), would give the cream-to-blue arc 134 px of drop at x 25 (measured 69) and the top arc 51 px (measured 89).
- No vignette: at equal L, edge and center match in C/L (within 0.002) and hue (within 1°). One exception: the cream band peaks at L 0.896 across the middle two thirds and 0.887 in the outer 25 px.
- No horizon line or source in the frame. The closest thing to a horizon is the yellow-to-cream edge at y 1070 at the center and y 1152 at x 25.
- The ramp runs past the frame. The top corners (#722014) are darker than the top center (#7B2116). The bottom corners only reach #B0DAD8; the bottom center is #96D4EE.

## 3. Color stops

Center column (x 437-488). "y edge" is where the same color sits at x 0-25.

| t = y/1370 at center | y center | y edge | hex | name | L | C |
|---|---|---|---|---|---|---|
| −7.3% | (−100) | 0 | #722014 | dark maroon | 0.373 | 0.117 |
| 0% | 0 | 140 | #7B2116 | maroon | 0.391 | 0.126 |
| 12.3% | 168 | 258 | #8D2117 | dark red (knee) | 0.426 | 0.145 |
| 26.1% | 358 | 438 | #BA191A | crimson | 0.506 | 0.193 |
| 41.9% | 574 | 660 | #E42E18 | scarlet | 0.595 | 0.219 |
| 51.8% | 710 | 785 | #E96214 | red-orange (knee) | 0.658 | 0.185 |
| 62.3% | 853 | 922 | #F39C0B | orange | 0.763 | 0.164 |
| 74.4% | 1019 | 1113 | #FCD32E | golden yellow | 0.878 | 0.170 |
| 81.1% | 1111 | 1194 | #ECE07A | pale cream (lightest) | 0.896 | 0.125 |
| 93.4% | 1280 | below | #A9D8DE | pale blue-grey (knee) | 0.851 | 0.049 |
| 99.4% | 1361 | below | #95D4EF | light sky blue | 0.836 | 0.074 |

Changes from the profile:
- The profile stops are full-width band means. The dome puts them 1-3% lower than at the center and mixes two heights: its last stop #9FD5E7 averages the center's #96D4EE with the corners' #B0DAD8. I measured on the center column and keep the dome as a separate parameter.
- #882116 (12.4%) and #E95D15 (52.9%) are knees of a smooth curve, not separate colors.
- Added crimson #BA191A (hue 27.6°, the bluest red). Its green channel (0x19) is lower than both neighbors (0x21, 0x2E), so no blend of maroon and scarlet produces it.
- Added orange #F39C0B (optional; it is 0.006 C purer than a linear-light blend of its neighbors), #722014 for the top corners, and the #A9D8DE knee, where yellow fades faster than blue builds.

## 4. Transitions

10-90% widths at the center column, as % of frame height. None of the warm pairs is a bridge.

- Maroon → dark red: 8.1%. A slow start, with L rising only 0.035 and hue flat at 30°. The midpoint equals both mixes.
- Dark red → scarlet: 21.9%. The hue dips to 27.6° at the midpoint (#BA191A, y 358), a crimson found only here. The midpoint is 0.010 C more saturated and 0.004 L darker than the linear-light and sRGB mixes (both #B82717). Chroma peaks at 0.222 (#E12418, y 530).
- Scarlet → red-orange: 7.9%. The midpoint #E64C16 equals the linear-light mix; sRGB is within 0.001.
- Red-orange → golden yellow: 17.6%. Chroma stays at 0.164 or above. The midpoint #F39C0B has the mixes' L with 0.006 C more than linear-light (#F19D21) and 0.005 more than sRGB. Its blue channel is 0x0B against 0x21.
- Golden yellow → cream: 5.0%, the sharpest edge. L rises into the bridge (0.878 → 0.896) while C falls 0.170 → 0.125 and hue moves 94° → 103°. The midpoint is within 0.003 of the linear-light mix.
- Cream → light blue: 13.4%. The cream is the bridge, lighter than the yellow (0.878) and the blue (0.836). Inside, the hue passes through mint: midpoint #C6DFC1 (y 1216), chroma minimum 0.041 at y 1251. The midpoint is 0.007 L lighter than the linear-light mix (#C9DABE) and 0.018 L lighter than the sRGB mix (#BFDAB7, also greener).

## 5. Softness and edges

Every edge is soft. The hardest is yellow → cream at 69 px (5% of H), about 33 px in the source. Softness does not change along the arcs: per-strip widths vary ±5% from center to edge (yellow → cream 64-71 px, scarlet → red-orange 98-110 px). The stops are knees of one smooth curve, with no kinks and no bright or dark lines.

## 6. Grain and texture

No grain. The high-pass residual is 0.148% of 255 (L × 100 0.113). Along the iso-lines it is 0.118% of 255 (L × 100 0.091, chroma × 100 0.076, 59% mono), the same at every lightness. In the source fill it is 0.115-0.154% of 255, under the 0.3% floor. The residual blobs (4.3-5.5 px here, 2-2.6 px in the source) are JPEG noise enlarged 2.12x.

What shows at 6x or with gain is JPEG 8 × 8 blocking. In the source, steps across block boundaries are 5x larger than inside blocks, which makes 17 px blocks here. The maroon also has 8-bit steps (runs of 2-14 identical source rows). These horizontal steps are why the residual correlates over 4.3 px across but only 1.3 px down.

## 7. Highlights

None. The brightest 0.5% is #EBE07F (L 0.896), the cream band, well short of white. The 223 pixels (0.018%) with a channel at 255 are the red channel of the golden yellow near the apex (#FFCD20, y 996-1075): the yellow is at the edge of sRGB, not overexposed. The darkest 1% is #742115 (L 0.378), and the corners are #722014. There is no black: the frame spans L 0.37 to 0.90.

## 8. What to ignore

- Rows 1362-1369: the tops of the poster's caption text, up to 0.04 L lighter ("Caloroso" at x 0-47, text columns at x ≈ 509-640, 660-755 and 800-880, a logo at x 912-925). The manifest masks them with `{ "kind": "text", "rect": [0, 1360, 925, 10] }`.
- JPEG blocks, 8-bit steps, and the softening from the 2.12x enlargement.

## 9. Recipe and light model

Use `sunset.ramp`: a vertical ramp, a bent horizon, and a flat glow (the cream band). A bloom centered below (`sunset.blooms`) would draw concentric rings. `sunset.bands` can't give widths from 5% to 22% with one blur.

Light model: one ramp in linear light, displaced by a fixed dome.
- Ramp coordinate: t = (y − d(x)) / H, with d = 0.059·H·u² and u = (x − 0.5W)/(0.5W). Raise the drop to about 0.075 H where t < 0.18. Set the dome by its drop at the frame edges, not by a radius, so wide formats don't become a half circle. Never use distance from a point below the frame.
- Stops: the table above, at those t values. Interpolate in linear light along a smooth curve so stops don't show as kinks, and check the midpoints against section 4.
- Horizon: 0.78 H at the center (the yellow-to-cream midpoint), drop 0.059 H at the edges, noise warp 0, constant softness.
- Flat glow: the cream stop (peak L 0.896, L ≥ 0.886 over t 0.764-0.848). Optionally fade it by 0.009 L in the outer 3% of the width.
- Lens: no bloom or halation, exposure 0, no roll-off. Keep #FCD32E from drifting toward white.
- Output: grain 0. Dither on: the maroon changes one red level every 9-17 px and will band without it.

## 10. Five things a recreation must get right

1. One dome, not rings: every band sits about 80 px (6% of H) lower at the sides than at the center, at every height (about 100 px in the top 250 px), symmetric about x 462. The cream-to-blue midpoint is at y 1216 at the center and y 1290 at x 12. Lower arcs must not bend more than upper ones.
2. Uneven widths in the right places: scarlet at y 574, golden yellow at y 1019 and cream at y 1111 at the center. The 10-90% widths are 22%, 8%, 18%, 5% and 13% (dark red → scarlet → red-orange → yellow → cream → blue).
3. The cream (#ECE07A, L 0.896) is the lightest band, lighter than the yellow above (0.878) and the blue below (0.836). The cream-to-blue midpoint is a very pale mint-grey (#C6DFC1, C 0.048): not a green stripe, not a grey dip.
4. Saturation holds through the warm half: chroma peaks at 0.222 (y 530) and stays at 0.164 or above down to the yellow. The orange has an almost empty blue channel, and a crimson band (#BA191A) sits at y 358.
5. A dark, slow top and a bottom still changing: #7B2116 at the top center and #722014 in the corners, with L up only 0.035 in the top 170 px. The bottom center is #96D4EE and the bottom corners #B0DAD8. No grain, bloom or vignette.

## 11. What would make it look like a stock or Instagram gradient

- Straight horizontal bands: the CSS `linear-gradient` look.
- A radial gradient centered below: concentric rings look like a target, and the bottom arcs bend twice as much.
- Evenly spaced stops and equal widths.
- Yellow straight into blue with no cream band, which leaves a green stripe (C above 0.07). sRGB blending gives a milder version.
- A dull, brownish orange, or pure primaries (#FF0000, #FFFF00) in place of the warm scarlet and golden yellow.
- A light top: the maroon must stay at L 0.37-0.39.
- Added grain, bloom, halation, vignette or wavy arcs.
- In production, the brief's "one warm color at most, Meta Blue holds the sky" applies. What transfers from this five-warm-band reference is the dome, the uneven widths and the light cream bridge.
