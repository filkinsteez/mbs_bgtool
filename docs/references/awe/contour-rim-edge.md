# contour-rim-edge

Figma node 41:21 "image 47", target 925×1644 (the 1200×2133 source shown whole), recipe hint `contour.rim`.

## 1. What the light is physically doing

A CG render (or heavily retouched studio shot) of the rounded corner of a dark slab, like a phone or glass panel, lit from behind on black and saved as JPEG at 1200 wide: straight edges (±1 px over 1300 px), no sensor noise, black clipped to 0, a sharpened silhouette.

One light, off-frame up and to the right of the corner, behind the object:

- A 1 px bright line on the silhouette along the whole edge; at the bottom-left it is all that is left.
- A glow just inside the silhouette, strongest at the corner and weaker along both edges.
- Overexposure at the corner: the rim rolls off to a flat, pale blue-white top. 20 px inside the edge, the glow above the fill is 23× stronger there than at y 1000; the peak is only 4.6× brighter.
- A dim navy glow on the face, brightest near the corner, cut at the silhouette. Not lens glare: the black outside has none.
- A faint halo outside the silhouette, the only bloom. No halation.
- One hue: Oklab 253 to 262° from the glow to the fill (Meta Blue `#0064E0` is 258.8°). Only the overexposed core drifts toward cyan (239 to 245°).

## 2. Structure

- Axis: the profile's 26.75° (R² 0.52, low because this is a line light, not a ramp) is the normal to the diagonal, which sits at 51.8% ± 0.3% along it. No warp; the reported bow is an averaging artifact.
- Top edge: level at y 202.9 (12.3% H), from x 0 to x ≈ 657.
- Diagonal: x = 904.1 − 0.4977·y, 26.5° from vertical, straight to ±1 px, leaving the bottom edge at x 86 (9.3% W).
- Corner: the straight edges would meet at (803, 203) at 63.5°. The curve leaves them about 147 px from there and reaches x 748.6 (80.9% W) at y ≈ 285. A circle tangent at the same points has r ≈ 90 px, but the middle of the curve fits r ≈ 77 px (0.083 W) and runs about 4 px outside that circle: squircle-like, tightest in the middle.
- The face covers 42% of the frame. The frame cuts it on the left and bottom.
- Profile ridge points: all on the rim within 1 px; (740, 247) and (748, 293) of the diagonal set lie on the corner curve. The profile's upper-diagonal, top-edge and lower-diagonal figures match the local values at y ≈ 600, x ≈ 350 and y ≈ 1200.

## 3. Color stops

The profile's stops average bands parallel to the diagonal across the whole frame, and none of them occurs in the image. 0 to 7% is the top-left corner, and 48 to 50% is face fill mixed with black. 51.5% (`#516888`, flagged as a bridge) and 51.8% (`#475C7A`) are the rim averaged from `#D6E8F5` at the corner to `#0E1B2D` at the bottom: the "bridge" is the light itself. Replaced with a cross-section at y 600 (edge at x 605.5) along the outward normal (0.895, 0.446). d is px from the edge, negative inside:

| pos | d | x, y | hex | color | L | C |
| --- | --- | --- | --- | --- | --- | --- |
| 32.6% | −300 | 337, 466 | `#071228` | navy fill | 0.186 | 0.048 |
| 49.2% | −40 | 570, 582 | `#081731` | navy, foot of the glow | 0.209 | 0.055 |
| 50.5% | −20 | 588, 591 | `#1A437F` | deep blue | 0.389 | 0.112 |
| 50.9% | −13.5 | 593, 594 | `#3265AC` | mid blue, most saturated | 0.509 | 0.125 |
| 51.3% | −8 | 598, 596 | `#73A0D8` | light blue | 0.695 | 0.096 |
| 51.8% | 0 | 605.5, 600 | `#C2D9EC` | blue-white core | 0.874 | 0.036 |
| 51.9% | +2 | 607, 601 | `#111F37` | dark seam (sharpening) | 0.240 | 0.050 |
| 52.1% | +4 | 609, 602 | `#122743` | halo | 0.271 | 0.058 |
| 53.7% | +30 | 632, 613 | `#050E15` | halo tail, grey-blue | 0.158 | 0.021 |
| 58.2% | +100 | 695, 645 | `#000000` | black | 0 | 0 |

Core along the rim: corner (749, 284) `#CBE0F0` (L 0.896, C 0.031); diagonal y 400 `#D6E8F5` (0.921, 0.027), y 800 `#92B4DE` (0.759, 0.071), y 1000 `#4C73AA` (0.550, 0.098), y 1580 `#091220` (0.183, 0.033); top edge x 500 `#B8D6F0` (0.862, 0.048), x 60 `#294A83` (0.415, 0.104).

Face fill by distance from the corner: `#091B38` (L 0.225, C 0.061) at 100 px, `#071329` (0.190, 0.048) at 400 px, `#040C19` (0.153, 0.032) at 800 px, floor `#020814` (0.134, 0.030). Background `#000000`.

## 4. Transitions

| pair | 10–90% | notes |
| --- | --- | --- |
| fill → core | to 10% at 24 px (1.5% H) at the corner, 18 px (1.1%) at y 600, 10–17 px (0.6–1.0%) where dim | No lighter bridge (one hue). Midpoint at y 600 `#73A0D8` (C 0.096); a linear-light blend of the ends at the same L is `#8E9FAE` (C 0.030), sRGB `#8BA0B3` (C 0.037). Chroma peaks (C 0.125, h 257°) 12–18 px inside where bright, 2 px inside at y 1000. |
| core → halo | about 1 px (0.06% H) | Hard step, a 1–2 px darker seam, then the halo at 2–5% of the peak. |
| halo → black | half at about 16 px, 10% at 40 px, black by 60–95 px | Blue near the edge (C 0.07), grey-blue past 30 px (C 0.02), grey-teal on the lower diagonal. |
| along the rim | diagonal: 90% at y ≈ 560, 10% at y ≈ 1105; top edge: 90% at x ≈ 600, 10% at x ≈ 75 | Relative to the corner peak (Y 0.81). The core goes pale blue-white, then mid blue (C ≈ 0.10 near y 1000 and x 200), then a navy line. |

No hue appears only inside a transition. The falloff carries the light's own saturated blue; the core is that blue overexposed, not a second, lighter color.

## 5. Softness and edges

- Outer edge: hard everywhere. At 4×, at both 925 and 1200 wide, the light drops from the peak to 1 to 2% across one intermediate pixel; outer d50 is 0.75 to 1.5 px at all 14 points measured. Just outside, a 1 to 2 px seam is darker than the halo, with red clipped to 0 in the source, e.g. (0, 14, 42): sharpening undershoot.
- Inner side: soft, with a width that follows the brightness (px at 925 wide):

| where | peak Y | d50 | d10 | d2% |
| --- | --- | --- | --- | --- |
| corner | 0.77–0.81 | 13 | 24 | 33 |
| top x 620 / diag y 400 | 0.73 / 0.79 | 9.5 / 10.5 | 17 / 21 | 26 / 30 |
| top x 500 / diag y 600 | 0.67 / 0.68 | 7.3 / 8.0 | 15 / 18 | 25 / 28 |
| top x 350 / diag y 800 | 0.49 / 0.45 | 3.8 / 5.0 | 11 / 15 | 21 / 25 |
| top x 200 / diag y 1000 | 0.21 / 0.17 | 2.0 / 3.5 | 10 / 13 | 23 / 25 |
| top x 60 / diag y 1200 | 0.071 / 0.044 | 2.0 / 2.5 | 12 / 17 | 25 / 31 |

- The 2% reach hardly changes; the flat top does. At the corner the glow stays within 5% of Y 0.64 from 1 to 6 px inside, under the line. From y ≈ 1000 and x ≈ 200 on, only the line and its tail remain. The profile's d50 (0.009 of the short side) is the y 600 value, not a constant.
- The profile's "very wide tail" (σ 241 px) is the face fill: past 40 to 50 px the profile is flat across the edge (at y 600, Y 0.0078 at 50 px and 0.0070 at 200 px).
- The face keeps a hard edge even at the bottom-left: `#020814` against black.

## 6. Grain and texture

No grain and no sensor noise. In flat face patches the residual after a 9×9 blur is 0.36 to 0.41 of an 8-bit level (0.14 to 0.16% of 255), Oklab L×100 0.19 to 0.21, the same at both sizes. The profile's figures (0.124%, L×100 0.18, mono share 0.72, size 3.3 px) measure JPEG:

- 8 px blocks at the source (every 8th column has 4.8× the average pixel step), 6.2 px at 925 wide, plus 16 px chroma blocks (12.3 px). Visible only at gain 4 to 8.
- No banding at 16× gain. The black is exactly 0, with no noise.

## 7. Highlights

- Brightest 0.5%: `#AECAE8` (L 0.828, C 0.052), on the rim from x 296 on the top edge, around the corner, to y 896. Brightest pixel `#E6F9FF` (230, 249, 255) at (717, 376).
- 31 target px and 1357 source px (0.05%) have a channel at 255: blue, and in the brightest also green. Red stays below 245, so nothing is white. The roll-off goes from saturated blue (257°) to pale blue-white (`#D6E8F5`, 239°) to cyan-white, with no ring.
- 45.7% of pixels are pure black, all outside the face beyond the halo. Inside the face nothing is darker than `#020814` (L 0.134).

## 8. What to ignore

- Manifest ignore rects: none. No tile corners.
- A faint strip at x 0 to 96, y 0 to 8 (at most `#090D10`), left over at the source edge. Treat as black.
- JPEG blocks.
- The dark seam outside the rim (sharpening). Skip it, or use one slightly darker pixel at most. The same sharpening slightly boosts the 1 px line near the corner; don't exaggerate the line.
- The abrupt end of the halo at 60 to 95 px, where the source clips its blacks. Fade smoothly, but reach `#000000` by about 100 px.

## 9. Recipe and light model

`contour.rim` fits: one light along a curve (two straight edges and a rounded corner) with a lit face on one side. The brief's Contour rules forbid hard edges and object silhouettes, but the 1:1 preset needs both; softening them for production is the owner's call.

Add in linear RGB, all at hue about 258°:

1. Rim glow, inside the silhouette only, cut with a 1 px antialiased edge: core σ ≈ 0.9 px (0.001 of the short side) plus σ 5.7 px (0.006) at 65% and 12 px (0.013) at 35% (upper-diagonal fit; the top edge fits 3.3, 8.3 and 17.5 px at 74, 22 and 4%).
2. Rim intensity along the curve, as displayed peak relative to the corner's Y 0.81: diagonal 0.97 at y 400, 0.84 at 600, 0.56 at 800, 0.21 at 1000, 0.055 at 1200, 0.013 at 1400; top edge 0.83 at x 500, 0.61 at 350, 0.26 at 200, 0.087 at 0. In linear light make the corner about 23× the rim at y 1000 and let the tone curve squeeze the peak to 4.6×. That makes the flat 12 px band; don't widen the kernel instead.
3. Outer halo, outside only: 2% at σ 12 px (0.013) plus 1% at σ 31 px (0.033) of the displayed peak, 1.5× that around the corner. It grows only 6× from y 1000 to the corner, so drive it from the displayed rim brightness.
4. Face fill, hard-cut at the silhouette: floor Y 0.0024 plus a gaussian of Y 0.0092 centered at the sharp vertex (803, 203) = (0.868 W, 0.123 H), σ 410 px (0.44 of the short side); fit error 4.3%.
5. No other bloom, no halation. Blue clips first in the tone curve, so the core turns pale cyan-white.

Starting parameters: light `#3265AC`; core up to `#D6E8F5` and `#E6F9FF`; face `#091B38` to `#020814`; background `#000000`; top edge at 0.1234 H; diagonal from (803, 203) to (86, 1644); corner radius 0.083 W at its middle, tangent points 0.16 W from the vertex; grain 0, dither on. Meta Blue `#0064E0` has the same hue but 1.6× the chroma.

## 10. Five things a recreation must get right

1. Hard outer edge: at 4× near y 600 on the diagonal, peak to under 5% in one pixel, then only a faint halo (about 3% at 4 to 5 px) that is black by 60 to 95 px. Inside, half brightness at 8 px.
2. The rim fades away from the corner: half at y ≈ 865 on the diagonal and x ≈ 285 on the top edge, about 1% at the bottom-left (line `#091220`; the top-left end is `#294A83`).
3. The bright part rolls off to pale blue-white (`#C2D9EC` to `#E6F9FF`, C ≤ 0.04): a flat band about 12 px wide at the corner, narrowing to a bare line by y ≈ 1000. The falloff passes through saturated blue (`#3265AC`, C ≈ 0.125) 12 to 18 px inside, not grey.
4. The face is navy, never black: `#091B38` near the corner to `#020814` at the bottom-left, flat across the edge beyond 40 px, visibly lighter than the black outside.
5. Geometry: level top edge at y 203, straight diagonal at 26.5° from vertical leaving the bottom at x 86, corner reaching x ≈ 749, and only black and halo right of x 749 or above y 203.

## 11. What would make it look like a stock or Instagram gradient

- A glow line that is soft on both sides: a neon tube. Here the outside is hard and dark.
- Even brightness along the rim: a UI outline or a sci-fi interface. Here it falls more than 100× from the corner to the bottom-left.
- A grey falloff from blending the core into the fill (linear light gives `#8E9FAE` at the midpoint; the reference is `#73A0D8`), or a core that clips to flat blue instead of pale blue-white.
- A wide outer bloom (over about 5% of the peak, or past 100 px), or any light on the black background.
- A uniform navy face, a face fading to black, or a vignette.
- Warm halation, purple or cyan fringes, or grain in the black.
- A large circular corner, a sharp corner, or the whole triangle in frame.
