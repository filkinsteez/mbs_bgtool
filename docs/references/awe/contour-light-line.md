# contour-light-line

Figma node 41:20 "image 51"; target 925 × 1644 (source fill 736 × 1308 shown whole at 1.257x, no `-full` file); recipe hint `contour.rim`.

## What the light is physically doing

A clean digital image (render or digital artwork), not a photo or print. 76% of pixels are exactly `#000000` with no noise. The line is a flat-topped 4-px bar in the source with 1-px antialiased edges, like a drawn stroke. The faint glow edges sit on the 8 × 8 JPEG block grid.

One straight vertical line of light runs through the frame center and off the top and bottom. Its color shifts along its length: blue, pale mint-white at 37% of the height, yellow from about halfway, peach at the bottom. Below 34% of the height a warm glow spreads sideways, widening and brightening downward. It is brightest beside the line at 79%, and the bottom edge crops it at nearly full strength.

It reads as a colored light, not lens halation or flare. The glow does not follow the line's brightness. The white section is the line's brightest part (luminance 0.74 vs 0.70 for the yellow) but has about 1% of the glow at y = 1300. From y = 800 to 1400 the line's center stays near lin (0.95, 0.68, 0.09) while the glow beside it grows from lin (0.05, 0.02, 0.01) to (0.85, 0.33, 0.03). The glow's colors are not the line's (red to violet beside a yellow line), and the two sides differ. A lens glow would scale with the source, keep one radius and be symmetric.

What looks optical is the falloff: a thin hard core and a long soft tail that turns redder with distance, as with halation. In linear light the glow fits as three gaussians: narrow yellow-green, medium red-orange, wide faint blue. The left has more yellow-green and almost no blue. The right has less yellow-green and 2 to 3 times the blue, so its crimson and violet are red plus blue light. The line behaves as if drawn over the glow: its center does not brighten as the glow under it grows.

## Structure

- The profile axis is horizontal (0.25°), across the line. A ramp along it explains 55% (R² 0.55) because everything also changes with height. Read it as a vertical line plus a glow whose strength and width depend on y.
- The line is at x = 462 of 925 (0.4995), straight and vertical within ±1 px.
- The glow is a wedge opening downward: traces at y ≈ 460–500 (8x gain), 8/255 beside the line at y = 560 (34%), 64/255 at y = 800 (49%). Its visible edge (max channel ≥ 8/255) moves out 0.18 px per px of height, a half-angle near 10°. The profile's curvature (bow 0.063, radius 2.0 frame heights) measures this widening, not a curved light.
- Non-black pixels lie only in x 240–723. The left 26%, the right 22% and the top 30% (apart from the line) are black.

| y (% of height) | half-width at ≥ 8/255, L / R | full width (% of frame width) | half-width at ≥ 128/255, L / R |
| --- | --- | --- | --- |
| 640 (39%) | 36 / 39 px | 75 px (8%) | none |
| 940 (57%) | 95 / 100 | 195 px (21%) | 9 / 9 |
| 1240 (75%) | 139 / 141 | 280 px (30%) | 53 / 52 |
| 1640 (100%) | 200 / 230 | 430 px (46%) | 77 / 58 |

## Color stops

The line, top to bottom (mean of the 5 center columns):

| % of height | y px | hex | color | L | C |
| --- | --- | --- | --- | --- | --- |
| 0–9 | 0–150 | `#1F648F` | medium blue | 0.48 | 0.096 |
| 18 | 300 | `#6E97BA` | light blue | 0.66 | 0.069 |
| 27 | 450 | `#94BCC8` | pale blue | 0.77 | 0.046 |
| 37 | 610 | `#CCDCC9` | pale mint-white (least saturated) | 0.88 | 0.031 |
| 43 | 700 | `#EBE09C` | pale yellow | 0.90 | 0.088 |
| 52–82 | 850–1350 | `#F8D755` | yellow | 0.88 | 0.150 |
| 91 | 1500 | `#FCC768` | amber | 0.86 | 0.128 |
| 100 | 1640 | `#F8B47C` | peach | 0.82 | 0.108 |

Across the line at y ≈ 1500 (% along the profile axis = x / 925):

| % | x px | hex | color | L | C |
| --- | --- | --- | --- | --- | --- |
| 0–26 | 0–240 | `#000000` | black | 0 | 0 |
| 39 | 362 | `#44231C` | dark brown | 0.30 | 0.052 |
| 43 | 402 | `#A14D29` | rust | 0.52 | 0.121 |
| 47 | 432 | `#DD7E31` | orange | 0.69 | 0.146 |
| 49 | 456 | `#EE9E32` | amber-orange | 0.76 | 0.150 |
| 50 | 462 | `#FACB69` | the line | 0.86 | 0.128 |
| 51 | 468 | `#E56F37` | orange-red | 0.67 | 0.163 |
| 53 | 492 | `#D34545` | red | 0.59 | 0.179 |
| 56 | 522 | `#892C52` | raspberry | 0.44 | 0.132 |
| 59 | 542 | `#4D274C` | plum | 0.34 | 0.079 |
| 61 | 562 | `#2C1F3B` | dark violet | 0.27 | 0.053 |
| 64 | 592 | `#161324` | indigo-black | 0.20 | 0.034 |
| 78–100 | 723–925 | `#000000` | black | 0 | 0 |

Higher up the glow is yellower: at y = 1300 it is `#EBBA2C` (yellow-gold) left of the line and `#E6932C` (orange) right of it; at the bottom edge `#DD7137` (orange) and `#D24641` (red).

Changes from the profile: its stops are full-height means, so they include the black top third and mix the yellow upper glow with the red lower one; every glow stop is 2 to 3 times too dark. I dropped `#B89B5F` (50%), a height average of the blue, white and yellow line that appears nowhere, and merged 51.3% `#945125` with 52.6% `#863724`. I added the plum, violet and indigo stops that the average turns into `#0F0914`. The line's own sequence runs perpendicular to the axis, so it has its own table.

## Transitions

Along the line:

- Blue → mint-white: 10–90% over 371 px (22.6% of height), y 189–560. No bridge; L rises steadily and chroma peaks at the blue end. The hue stays blue (h 235–245) to y ≈ 420, then turns through aqua and mint (h 219 → 141) at chroma 0.05 → 0.03; those tints occur only here. Midpoint `#769FC0` (C 0.066) has twice the chroma of the linear-light mix `#819CA5` (0.033); sRGB mix `#769FAB` (0.048); same L.
- Mint-white → yellow: 163 px (9.9%), y 626–789. A slight lighter bridge: L peaks at 0.903 at y ≈ 720, above both ends (0.872, 0.889). Midpoint `#EAE1A0` is 0.02 lighter than the linear mix `#E5DA98` and 0.025 lighter than the sRGB mix `#DFDA95`.
- As one change, blue → yellow is pale blue `#83B0C6` (L 0.73) at its 50% point (y ≈ 399), where mixing the two ends gives khaki `#9D9A7E` (linear) or olive `#8D9F72` (sRGB), both L 0.68. The largest departure from a straight Oklab line is 0.109 at y ≈ 598 (`#C0DACB`, L 0.87).
- Yellow → peach: 253 px (15.4%), y 1370–1623. No bridge (L 0.88 → 0.82, C 0.151 → 0.108); midpoint `#FCC46C` matches both mixes.

Across the line (one fade per side; the middle stops are knees of it):

- Line → glow: a step at the line's edge with no dark gap. The hue steps too (h 88 left, 66 right at y = 1300).
- Left fade to black: 10–90% (Oklab) 143 px at y = 1300 (8.7% of height). The hue drifts yellow → orange → brown (h 88 → 51–64) because red spreads wider than green; chroma falls from 0.155. Midpoint brown `#633F20` (h 60), where fading the near color in linear light or sRGB gives olive-gold `#59450A` / `#584611` (h 88).
- Right fade: 150 px at y = 1300 (9.1%). Chroma peaks inside it (at y = 1500: 0.163 at 6 px, 0.179 at 30 px). The hue walks through magenta (h 359 at 60 px) and violet (h 304–328) to indigo (h 290 at 130 px), hues that occur only here. The midpoint at y = 1300 is wine `#5E263D` (C 0.086), where a plain fade gives brown `#56340A` (C 0.073). The profile agrees: the midpoint of `#863724` → `#371427` has chroma 0.105 vs 0.084 for a linear-light mix.

## Softness and edges

- The line's edges are the only sharp ones: 5.3 px at half height (4.3 px in the source), falling from 50% to 1% in about 2.5 px. The width is constant (4 px plus 1-px edges in the source at every height). The profile's growing core sigma (1.3–1.5 px at the top, 2.2–3.3 px at the bottom) is the glow peaking under the line.
- The glow's outer fade softens downward. 10–90% widths (left / right): 91 / 95 px at y = 800, 115 / 128 at 1000, 143 / 150 at 1300, 195 / 211 at the bottom (12.8% of height).
- The glow fades in along y over about 400 px with no top edge.

## Grain and texture

None. The black is exactly 0. In the glow the residual after removing the ramp is 0.11–0.41% of 255 (Oklab L × 100: 0.13–0.37, up to 0.55 in the near-black violet tail, where L is most sensitive). It comes from JPEG blocks (10 px at 925 wide, 8 px in the source) and 8-bit steps that show as thin vertical columns in slow fades. The profile's 0.063% of 255 (L × 100 0.12, size 3.9 px) covers near-black pixels only. Its longer lag along y (2.7 vs 1.2 px) is the image's vertical structure, not grain.

## Highlights

- No white and almost no clipping. Channel maxima are R 255, G 230, B 208; 123 pixels (0.008%) reach 255, all red, in the line at y 1187–1597.
- The "white" is mint-white `#CCDCC9` to cream `#E0E0BB` (max channel 220–228). The brightest pixel is `#D9E4C7` at (461, 632).
- The yellow stays saturated (C 0.150) instead of rolling to white. The brightest 0.5% average `#F1CE6D` (L 0.86): the yellow line and the hottest glow left of it.
- Exact `#000000` covers 95.7% of the top third, 76.1% of the middle and 56.1% of the bottom.

## What to ignore

- No ignore rects, no rounded corners.
- The JPEG staircase where the faint tail meets black (95% of rows end on the source's 8-px grid). The real tail would keep fading.
- The 8-bit vertical columns in the dark tails.
- The line's brightest column alternating between x 461 and 463 from row to row (resampling from 736 to 925 px).
- The profile's frame-averaged stops.

## Recipe and light model

`contour.rim` in line mode fits: one straight emitter with a sharp core, edge to edge. `contour.beam` has the widening cone and a haze gain that grows along the beam, but it has one symmetric color and a pool this image lacks. Rim's line mode today has one core color, one tail color, and linear `fade` and `taper`. This reference also needs a color ramp along the line, separate left and right tints, three tail radii and a non-linear gain along y. There is no horizon and no warp; the line is straight.

Light model: everything is recipe light added in linear RGB. Set lens bloom and halation to 0. A glow driven by highlights would sit on the white section, put a glow around the blue top and be symmetric. Grain 0; dither before 8-bit.

Starting parameters (widths as fractions of the short side, y as a fraction of the height):

- Line at x = 0.5 from y = −0.02 to 1.02. The core is a flat bar 0.0057 wide at half max (a gaussian with sigma 0.0024 is close at 1x).
- Center colors: the line table. Above y = 0.49 the glow adds under 6%. Lower down, the glow beside the line supplies 84% of the center's red and 59% of its green (y = 0.79), so the line's own emission must drop: about lin (0.87, 0.70, 0.12) at 0.49, (0.57, 0.54, 0.07) at 0.61, (0.24, 0.32, 0.06) at 0.73, (0.15, 0.27, 0.06) at 0.79, (0.21, 0.35, 0.14) at 0.97. A full-yellow line on top of the glow pushes red past 1.0 and the center toward white.
- Glow gain beside the line (left, peak 1): 0 above 0.30, 0.02 at 0.43, 0.06 at 0.49, 0.19 at 0.55, 0.42 at 0.61, 0.68 at 0.67, 0.88 at 0.73, 1.0 at 0.79, 0.94 at 0.85, 0.81 at 0.91, 0.61 at 0.97, 0.52 at 1.0. The right is 0.66–0.74 of the left beside the line and 0.62 of it in total luminance.
- Glow half-width at half level (left): 0.025–0.029 down to y = 0.67, then 0.038 at 0.79, 0.046 at 0.91, 0.055 at 1.0. The right is 5–25% narrower at this level.
- Components (peak linear RGB at the line). These are fits, not a unique split; check them against the stop tables. The profile's bottom-third fit (glow sigma 0.033, tail 0.058) is luminance only, so it matches the red-orange part and misses the right side's blue tail (blue is 7% of luminance).

| component | left, y 0.79 | left, y 0.97 | right, y 0.79 | right, y 0.97 |
| --- | --- | --- | --- | --- |
| narrow, green (makes the yellow) | σ 0.022, (0, 0.18, 0) | σ 0.030, (0.01, 0.17, 0) | σ 0.017, (0.03, 0.24, 0) | σ 0.013, (0, 0.05, 0) |
| medium, red-orange | σ 0.037, (0.84, 0.29, 0) | σ 0.052, (0.82, 0.01, 0.01) | σ 0.039, (0.78, 0.04, 0) | σ 0.041, (0.72, 0.01, 0) |
| wide tail | σ 0.069, (0.03, 0.02, 0.03) | σ 0.084, (0, 0.03, 0.03) | σ 0.082, (0, 0.02, 0.04) | σ 0.095, (0.01, 0.03, 0.09) |

## Five things a recreation must get right

1. The top 30% is a bare blue line (`#1F648F`) with no glow: brightness falls to 1% within 5 px of the center.
2. The line's colors: blue to y = 150, pale blue by 450, mint-white `#CCDCC9` at 610, pale yellow `#EBE09C` at 700, yellow `#F8D755` from 850 to 1350, peach `#F8B47C` at the bottom. The middle of the blue → yellow change is pale (L 0.73 at its 50% point, 0.87–0.90 from y 600 to 760), never olive or saturated green.
3. The glow fades in below y = 560 and opens downward: visible half-width (max channel ≥ 8/255, mean of both sides) 37 px at y = 640, 98 at 940, 140 at 1240, 215 at 1640. It is brightest at y ≈ 1300, still bright where the bottom edge crops it, and black outside x 240–723.
4. The sides differ. Left: yellow-gold → orange → brown, with about 1.6 times the right's luminance. Right: orange → red → crimson → magenta → violet → indigo, 20–40° redder than the left at the same height and wider at the faint end (230 vs 200 px at the bottom).
5. The line is a constant 5.3-px bar whose center never exceeds the listed colors (no white, no bloom), and the tails fade to pure black without steps or grain.

## What would make it look like a stock or Instagram gradient

- A symmetric glow, or the line's color faded out: a neon tube or lightsaber.
- A glow of constant width instead of a wedge that fades in and opens downward.
- Any glow around the blue top third.
- Blue → yellow mixed in sRGB or HSV: an olive or bright green middle.
- A yellow-to-purple gradient laid behind the line. Here the hue depends on distance from the line and on height, and purple appears only far out on the right in the lower third.
- One tint per side faded to black: olive-gold and brown bands instead of the walk toward red on the left and magenta-violet on the right.
- A glow bright enough to turn the line white or flatten the area beside it into one orange.
- Visible line ends, glow reaching the side or top edges, or added grain.
