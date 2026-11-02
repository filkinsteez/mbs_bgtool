# contour-yellow-halo

Figma node 41:23 "image 57"; target 925x1309 (a 735x1040 JPEG fill shown whole, enlarged 1.26x); recipe hint `contour.halo`.

## What the light is physically doing

A digital film poster ("contemporary.", a 02.02.2030 date, credits), not a photo or a scan. It is a clean computer gradient: the main edge is a circle to within 1 px, the blends match linear-light mixes of a few colors to within 0.01 L, and there is no grain, bloom, halation or clipping. JPEG blocks are the only texture.

Read as light: one warm source hidden behind a very large blue disc, like the sun just behind the edge of a planet. Pale lemon light shows just outside the disc's edge and spills outward into a pale sky-blue ground. The glow is strongest and widest at the lower left, where it leaves the frame, so the source sits behind the disc, off-frame toward the lower left. Inside the edge, the blue deepens over about 900 px to Meta Blue in the bottom-right corner.

The yellow band is a glow spilling outward, not a ring centered on the disc's edge. The crest sits 52 to 120 px outside the edge circle. It falls halfway toward the disc in 38 to 80 px, but takes 170 to 200 px to fall halfway to the sky. A strip of sky-colored light blue (`#A0CFEB`, L 0.83 like the sky) separates it from the disc's saturated blue. On the axis the crest's linear blue (0.37) is half the sky's (0.78): the yellow covers the sky instead of adding to it, like a glowing haze that also blocks what is behind it.

It is the only high-key Contour reference: median L 0.83, and the darkest pixels are saturated Meta Blue.

## Structure

- Profile axis 51° (top-left corner toward bottom-right), R² 0.926. A 1D ramp explains most of it because the axis passes within 30 px of the circle's center, so it runs along a radius. What it misses is the curvature (profile bow 0.20 H, iso-line radius 0.86 H = 1126 px) and the change along the arc.
- Edge circle (Oklab b = 0 on the disc side, where yellow turns blue): center (1060, 1440), radius 1120 px (0.86 H, 1.21 W), 1.0 px rms, 2.4 px max. The center is 135 px right of and 131 px below the bottom-right corner. The edge meets the left edge at y ≈ 1075 and the right edge at y ≈ 330, so 64° of the circle is visible.
- Crest: its own circle, center (997, 1525), r 1249 (4.7 px rms), shifted 106 px toward the lower left. It meets the left edge at y ≈ 750 and the right edge at y ≈ 270. Its gap outside the edge circle is 120 px at the left edge, 88 px on the axis and 52 px at the right edge.
- 10-90% widths as % of H: outer tail 26%, inner flank 4.4 to 9.2%, disc soft edge 14 to 16%, disc interior 31%.
- No warp: the change is in width and color along the arc. The profile's transition-0 shape (bow 0.30 H, radius 0.58 H, waviness 0.023 H) comes from the crest's color changing along the arc, not from a bent line.

## Color stops

t is the profile's axis position (0 = top-left corner, 1 = bottom-right corner, projected over the whole frame; the in-frame axis line runs from t 0.04 at (0, 83) to t 0.96 at (925, 1226)). r is the distance from (1060, 1440). Colors are sampled on the axis line.

| t | x, y | r | hex | color | L | C |
| --- | --- | --- | --- | --- | --- | --- |
| 0.00 | 0, 0 | 1788 | `#A0CEE6` | pale sky blue | 0.827 | 0.059 |
| 0.24 | 204, 334 | 1398 | `#D4E3CC` | pale sage (outer half point) | 0.898 | 0.035 |
| 0.36 | 324, 483 | 1207 | `#FBF5A6` | pale lemon (crest) | 0.957 | 0.099 |
| 0.42 | 379, 552 | 1119 | `#C5DEDA` | grey-mint (edge circle) | 0.881 | 0.027 |
| 0.45 | 416, 597 | 1060 | `#A0CFEB` | light sky blue | 0.831 | 0.063 |
| 0.61 | 574, 792 | 810 | `#43A0FD` | bright azure | 0.693 | 0.162 |
| 0.78 | 740, 997 | 546 | `#1D80F5` | strong blue | 0.611 | 0.196 |
| 1.00 | 925, 1309 | 190 | `#0B66E1` | deep blue, near Meta Blue | 0.540 | 0.203 |

Changes from the profile: its band means run across the frame and cut the curved arc at several radii, which flattens the crest and lightens the disc. Its 0.38 stop `#EEEFB7` (L 0.937, C 0.072) is replaced by the real crest `#FBF5A6` at 0.36. Its 0.59 stop `#64B0F6` (L 0.737, though the axis line there is `#4AA3FB`, L 0.70) is replaced by the light blue at 0.45 and the azure at 0.61, which its straight segment skipped. The 0.24 and 0.42 rows are mid-transition colors, not separate stops.

Crest color along the arc (angle from the center; 180° = left, 270° = up): 214° `#FDF6A3` (L 0.960, C 0.104), 234° `#FBF4A4` (0.956, 0.100), 250° `#F7F3B4` (0.952, 0.080), 262° `#F4F2C1` (0.951, 0.063). Lightness holds; chroma drops 40% toward the right edge.

## Transitions

- **Sky to crest (outer tail):** 10-90 is 26% of H (345 px along the radius; profile 27.8%). Not a lighter bridge: L rises steadily from 0.827 to 0.957. Chroma dips to 0.028 at t 0.21 (`#C6DDD3`); the pale sage-mint (hue 130 to 190°) exists only inside this transition. Saturation peaks at the crest. The midpoint `#D3E3CB` (L 0.898) matches the linear-light mix (`#D3E2CA`). An sRGB mix would be `#CBE0C7` (L 0.885), darker and greener. Shape from the crest: 0.25 x gaussian(σ 60 px) + 0.75 x gaussian(σ 195 px), 1% rms; a single gaussian misses by 5%.
- **Crest to light blue (inner flank):** 10-90 is 120 px at the left edge, 88 px on the axis and 58 px at the right edge (9.2% to 4.4% of H). Not a bridge. It passes neutral (`#C5DEDA`, C 0.027) on the edge circle, and the grey-mint zone with C below 0.04 is only about 50 px wide on the axis (35 px at the right edge, 75 px at the left). The midpoint `#D7E5CE` (L 0.906) is 0.007 lighter than the linear-light mix (`#D4E3CC`); sRGB would be 0.016 darker and greener (`#CDE2C9`). The profile's transition 1 (18% of H) merges this flank with the next one.
- **Light blue to azure (disc soft edge):** 10-90 is 184 to 213 px (14 to 16% of H), with the half point at r 950 to 990. Chroma rises from 0.063 to 0.162 with no extra hue. The midpoint `#6FB9F8` is 0.007 C more saturated than either mix.
- **Azure to deep blue (disc interior):** 10-90 is 404 px (31% of H). L goes from 0.693 to 0.540 and C from 0.162 to 0.203. The midpoint `#2485F6` is 0.009 C above the linear mix, and the profile's transitions 2 and 3 match linear light within 0.001 L.

## Softness and edges

No hard edge anywhere. The sharpest is the yellow's inner flank at the right edge (58 px, 10-90); the softest is the outer tail (345 px). Only the disc side changes along the arc. From the right edge to the left edge the inner flank doubles (58 to 120 px), the crest plateau (within 5% of peak) widens from 60 to 90-100 px, and the gap to the edge circle grows from 52 to 120 px. The outer half-width stays at 171 to 202 px. There is no thin bright core. At equal radius the disc is slightly lighter at the lower left (L 0.734 against 0.707 at r 900).

## Grain and texture

None. The profile's 0.21% of 255 (L x 100 = 0.16, "size 3.5 px") is below the no-grain line, and it grows with the high-pass radius (0.08 at σ 1 px, 0.19 at σ 8 px). It measures block-sized structure, not pixel noise. The source has 8x8 JPEG blocks (luma steps across block edges are 4 to 5x those inside), which are 10 px at 925 wide, with colored blocks about 20 px in the sky. Flat 64 px source patches vary by 0.5 to 1.1 levels per channel and hold 5 to 23 distinct values. There is no visible banding, because the JPEG error breaks up the 8-bit steps. The blocks only show at 4x zoom or with a contrast stretch.

## Highlights

The brightest 0.5% is `#FDF6A9` (L 0.961, C 0.096), on the crest near the left edge. 0.05% of pixels have one channel at 255 and none are white. There is no roll-off to white and no clipping ring: the crest is a flat pale lemon. The darkest 1% is `#0C6AE7` (L 0.552, C 0.206) in the bottom-right corner. That is Meta Blue's hue and chroma (`#0064E0`, L 0.533, C 0.205), 0.02 lighter. Nothing is dark.

## What to ignore

- Manifest text rect [282, 1019, 362, 260]: "contemporary." in the crest's lemon, "CHIDI EZE / 02.02.2030", and seven credit lines in lemon and light blue. SHARED.md does not mention this text. The rect is the glyph box plus about 18 px on each side, because JPEG ringing raises the noise up to 8 px outside the glyphs.
- The rightmost target columns (x 923 and 924) are lighter than their neighbors down the whole edge, by 10 to 37 levels at x 924. This comes from the source's last column. The manifest masks x 922-924 as `other`.
- JPEG blocks.

## Recipe and light model

Keep `contour.halo` (a halo cropped by the frame). Unlike the dark Contour references, it needs a light ground and a filled disc.

Light model: linear RGB, with the parts combined by coverage (emission plus absorption) instead of pure addition. Sky S is everywhere. The glow goes over it as `S x (1 - w_h) + Y x w_h`, and the disc D(r) goes over that with weight w_d. Adding Y on top of S would keep the crest's blue at 0.78 or more and turn it off-white (about `#FDF6E6`). The falloff is a sum of radii (glow + haze) with no core term. No warp noise. Lens bloom and halation 0, because the tail is part of the recipe. Exposure 0; nothing goes over nominal.

Starting parameters (px at 925x1309; scale with the short side):

- Center: bottom-right corner + (135, 131) = (1060, 1440). Edge radius 1120.
- Crest radius: edge + gap. The gap is 120 px at 218° and below, falling to 52 px at 262° (or use the crest circle (997, 1525), r 1249).
- w_h: 1 for 20 px at the crest. Inside: half-gaussian with σ 71 px at 214°, 52 at 234° and 34 at 258°. Outside: 0.25 x gaussian(60) + 0.75 x gaussian(195).
- Y(θ): `#FDF6A3` at 226° and below, moving to `#F4F2C1` at 262°. S: `#A0CEE6`.
- w_d: soft step with its half point at r 960, gaussian σ 75 px.
- D(r): `#43A0FD` at r 810 and above, `#1D80F5` at 546, `#0B66E1` at 250 and below, as a linear-light ramp.
- Grain 0; dither before 8-bit.

The production version maps to Bold. Meta Blue is the disc. Yellow is the glow, pushed toward white: the crest is L 0.96, C 0.10, against Yellow's 0.885 and 0.177. Cyan is the sky, much paler (L 0.83, C 0.06).

## Five things a recreation must get right

1. The yellow-to-blue edge is a clean circular arc centered past the bottom-right corner (+135, +131 px; r 1120). It meets the left edge at y ≈ 1075 and the right edge at y ≈ 330. The crest meets them at y ≈ 750 and 270.
2. The falloff is one-sided. From the crest, the yellow falls halfway to the sky in 170 to 200 px (10% at about 400 px toward the top-left corner), but halfway to the disc's light blue in 38 to 80 px. The crest is a 60 to 100 px plateau, not a line.
3. The band changes along the arc. At the lower left it is `#FDF6A3`, 120 px outside the edge, with a 120 px inner flank. At the right edge it is `#F4F2C1`, 52 px out, with a 58 px flank. Crest L is 0.95 to 0.96 at both ends.
4. The blends are clean. The outer tail passes through pale sage at L 0.88 to 0.90, C about 0.03. A light-blue strip (`#A0CFEB`) separates the yellow from the saturated disc. L falls steadily on both sides of the crest, and the crest stays lemon, not cream-white: its linear blue is 0.37 on the axis and 0.53 at the right end, against 0.78 in the sky.
5. The disc is one smooth ramp: light blue, then `#43A0FD` (r 810), `#1D80F5` (r 546) and `#0B66E1` in the bottom-right corner (L 0.54). No rim line, no grain, no bloom, max L 0.96.

## What would make it look like a stock or Instagram gradient

- A symmetric ring (a gaussian centered on the edge), or a visible full circle or center. It reads as a neon ring or UI element.
- Mixing yellow and blue in sRGB, HSV or along a hue path. That gives a darker green band at the disc edge (`#CDE2C9` instead of `#D7E5CE`) or a saturated green or cyan stripe.
- A saturated pack-Yellow crest (C 0.18), or any orange. It reads as a stock sunset ring.
- The same width and color along the whole arc. It looks like a CSS radial gradient; the left-to-right change is what makes it look lit from one side.
- A straight 51° ramp. The R² of 0.93 makes it tempting, but without the 0.20 H bow it is a stock diagonal gradient.
- A wobbly edge, grain, glare, or a white line on the crest.
- Adding the yellow on top of the sky. The crest goes off-white and the band washes out.
