# contour-beam-pool

Node 41:18 "image 49", 925×1850 (source fill 736×1472 shown whole, enlarged 1.26x), recipe hint `contour.beam`.

## What the light is physically doing

A digital render, most likely AI-generated, saved as a JPEG. One light above the frame shines straight down through thin haze in a dark room; the haze scatters it toward the camera, so the beam reads as a soft column. It lands against the back wall: the straight line at y 1321 reads as the floor–wall junction, with a pool and a fan of soft rays on the floor below it. Units: H = height, S = short side (925 px), W = width, Y = display-linear luminance.

The beam is lit from both ends: by the source above (brightest at the top edge, L 0.51, falling about 10x by y 550) and by the pool below, which lights the haze so the beam rises about 40x from y 550 to the floor line (L 0.74). It is dimmest at 0.30 H (L 0.23).

The background is lit haze, not a flat fill. The frame edges change with height: L 0.114 at the top, 0.095 at 0.1–0.3 H, 0.146 at 0.54 H, and a darker band (L 0.064–0.08) in the 25 px above the floor line. That is about 1% of the beam center at the top, 6% where the beam is dimmest, and under 1% near the floor. Direct beam light is steel blue (h 238), floor-lit haze teal (h 226), the pool near-white cyan (h 220), the darks violet-navy (h 252). There is no bloom, halation, flare or film grain. The rays follow no single optical rule: a glossy floor would reflect the beam straight down, where this floor is darkest.

## Structure

- Axis vertical; a 1D ramp explains only r² 0.44 (a column plus a floor fan).
- Beam: centered at x 463, within ±5 px down to y 1110, shifting up to 13 px right near the floor where the right side is brighter. Half-max width is 292–344 px (0.32–0.37 S) at every height with no trend: no taper, no cone. Flat top, steep shoulders: the 50/10/1% distances match a box of half-width 0.16 S blurred by σ 0.07–0.09 S (y 150–590) or 0.05–0.065 S (y 670–1110). At y 1150–1250 a skirt widens the 10% half-width from 0.23–0.28 S to 0.29–0.31 S, and rows look like one gaussian of σ≈0.14 S.
- Floor line: y 1321–1323 (0.714 H), straight to ±1 px across the pool, no warp. Outside the pool the lit floor starts lower (y≈1355 at the frame edges), where the side rays begin; the profile's bow (−0.093 H) comes from the rays and wedge.
- Pool: a half-ellipse below the line, as wide as the beam (half max x 300–610), with two hot spots; it falls to half 46 px below the line.
- Rays: a main pair from x≈380 and 526, outward at 28–30° from vertical, widening and fading with distance. The left fades near (160, 1775); the right is still faint at the bottom edge. Per side, a thin ray at 8–12° below horizontal and a wider one at 24–28° run from the pool's ends and are cut by the side edges at y≈1370 and ≈1435, still bright (L 0.48–0.54 and 0.35–0.39).
- Dark wedge between the main pair, with a rounded top about 50 px below the line: L 0.33 at y 1450, 0.14 at 1600, 0.106 at the bottom.

## Color stops

Profile stops are row means across the full width, mixing the beam with the black sides into colors that appear nowhere. I replaced them with sampled 9×9 px colors, added a teal stop at 55% that the profile folded into a straight segment, and treat its 71% and 72% stops as the two sides of one step.

| y px (% of H) | where | hex | color | L | C | replaces |
|---|---|---|---|---|---|---|
| 0 (0) | beam center | #3A6B8B | steel blue | 0.51 | 0.074 | #1F4258 |
| 400 (22) | frame edge | #000309 | near-black navy | 0.095 | 0.023 | |
| 555 (30) | beam center, dimmest | #0F202A | very dark slate blue | 0.23 | 0.030 | #081621 @31% |
| 1018 (55) | beam center | #31515E | dark teal | 0.42 | 0.043 | added |
| 1203 (65) | beam center | #5F87A1 | muted mid blue | 0.61 | 0.059 | #2D4857 @62% |
| 1316 (71) | beam just above line | #8AB1CC | light steel blue | 0.74 | 0.058 | #5B788C @71% |
| 1323 (71.5) | pool hot spots | #E6FBFE | near-white ice blue | 0.97 | 0.02 | #859DAC @72% |
| 1372 (74) | thin side ray at frame edge | #447694 | medium steel blue | 0.54 | 0.072 | |
| 1430 (77) | main ray, x 312 | #7CA7C2 | light steel blue | 0.71 | 0.061 | #6E94AC @74% |
| 1600 (86) | dark wedge | #020B14 | blue-black | 0.14 | 0.027 | #112A3B @84% |
| 1840 (99) | bottom center | #01040B | near-black navy | 0.11 | 0.023 | #020B15 @100% |

## Transitions

No two distinct hues meet, so the lighter-bridge rule does not apply; the profile's one bridge (72%) is the pool line itself. Widths are 10–90% on the row-mean profile, as % of H.

- Top → dimmest: 2.5–17.2% (14.7%). Chroma peaks at the top (0.074) and falls with brightness. The midpoint equals the linear-light and sRGB mixes (ΔC +0.004).
- Dimmest → floor: 43.6–60.8% (17.1%), then 63.1–69.9% (6.8%). Teal (h 226–230) appears only inside, at 50–60%, where a straight mix stays at h 236. Mid chroma is −0.002, then +0.006, against the linear mix.
- Beam → pool line: a 2–3 px step (0.1–0.16%); the profile's 0.66% averages rows where the lit floor starts lower. C drops from 0.058 to 0.02.
- Pool line → dark floor: 74.2–82.6% (8.4%). Saturation peaks just below the line (#6E94AC, C 0.056, above both ends). Midpoint C is +0.021 over the linear mix and +0.014 over sRGB: the white line rolls off into saturated blue.
- Dark floor → bottom: 85.1–96.5% (11.4%). Midpoint matches both mixes; hue drifts from 240° to 250°.

## Softness and edges

- Beam sides: soft. The 50%→10% distance is 66–97 px at y 0–550 and 56–74 px at y 750–1110, sharpening toward the floor (a real cone would soften).
- Pool line top: hard, straight, 2–3 px. It is the only hard edge and the one break of the Contour "no hard edges" line. The 1–2 px above it are slightly darker (ΔL −0.015), so there is no bloom.
- Pool ends 75–100 px (90→10%), pool bottom and wedge 50–100 px, ray sides gaussian-like, top of the lit floor outside the pool 15–37 px.

## Grain and texture

- Haze and beam: no grain. Local high-pass std is 0.04–0.17% of 255 (L×100 0.09–0.16). The profile's 0.18% and 3.45 px measure compression, not grain.
- JPEG 8×8 blocks in the source (block-edge steps 2–4x the others), about 10 px at 925 wide. At 8x gain the darks show purple and teal chroma blocks (~20 px) and vertical striations under 0.2 of an 8-bit level. No visible banding.
- Floor texture, only where the floor is lit: mono (98% lightness), L×100 0.50–0.71 and 0.54–0.80% of 255 at 925 wide (0.62–0.93% at the source); blob about 2 px at 925 and 1 px at the source. On the main rays it behaves like 3–4% multiplicative noise in linear light; it is weaker on the pool and absent in the dark wedge.

## Highlights

- Brightest 0.5%: #CFEAFA (L 0.92), all inside x 315–597, y 1321–1389 (the pool line and the floor under it). Brightest pixel (241, 255, 255) at (523, 1323). 0.017% of pixels reach 255 in G or B, on rows 1323–1339; none reach it in R, so none are white: near-white cyan, not clipped. C along the line is 0.016–0.022 at the hot spots and 0.058 at the ends: a smooth roll-off with no ring.
- Darks: darkest 1% #010209 (L 0.092); 85% of those pixels lie along the side edges above y 1250 (#000309) and 9% in the band above the floor line (#000106). No pure black, but red is 0 in 11% of pixels. Median L 0.197.

## What to ignore

The manifest has no ignore rects and no corners. Ignore the JPEG blocks and striations, the 1–2 px dark seam above the pool line, and small left/right differences (the right main ray is about 20% brighter and longer; the wedge minimum sits at x≈437).

## Recipe and light model

`contour.beam` fits: it is the brief's "beam through haze with a pool where it lands". Following SHARED.md, add these terms in linear light, model glows as a few radii, and leave the whitening to the tone curve:

1. Haze: base #000309 plus a very wide, weak glow whose strength changes with height. Edge Y relative to its minimum: 1.7x at the top, 1x at 0.1–0.3 H, 3.6x at 0.54 H, about 0.5x in the 25 px above the floor line.
2. Beam: center 0.5 W; box half-width 0.16 S blurred by σ 0.08 S (top) to 0.055 S (0.6 H); steel blue #3A6B8B at the top. Y(y) ≈ 0.133·exp(−y / 0.114 H) + 0.53·exp(−(0.711 H − y) / 0.086 H).
3. Floor bounce glow: teal (#31515E family), gaussian across with σ≈0.14 S, strongest at the line, within 0.1 H above it.
4. Pool: top edge at 0.714 H, 2–3 px; half max x 0.32–0.66 W; hot spots at 0.405 W and 0.568 W; ends 90→10% in 75–100 px; downward three gaussians, σ 0.040 S (73%), 0.070 S (25%), 0.148 S (2%). Y is 2–2.3x the beam just above it; push it into the roll-off so it lands near #E6FBFE.
5. Rays: main pair from 0.41 W and 0.57 W at ±29° from vertical, half-max width 0.09 S near the pool to 0.12 S lower down, halving every 0.05–0.09 S along the ray. Per side, rays at 8–12° below horizontal (0.02 S wide, Y 0.12–0.17 at the edge) and 24–28° (0.04 S, Y 0.04–0.06). Nothing in the wedge. A directional blur along each ray softens the sides.

Lens: bloom near zero (it would soften the pool step), halation off. Grain: none in the haze; optional mono floor texture, about 2 px, 3–4% multiplicative on floor light only. Dither before 8-bit.

## Five things a recreation must get right

1. A parallel column: half-max width 0.32–0.37 S at y 200, 700 and 1200 alike. No cone.
2. U-shaped brightness along the beam: L 0.51 at the top, 0.23 at 0.30 H, 0.74 just above the floor.
3. The pool line: a straight 2–3 px step at 0.714 H, the beam's width, near-white (C≈0.02), hot spots at 0.405 W and 0.568 W, nothing glowing above it.
4. The floor fan: two broad rays at ≈29° from vertical around a dark wedge (L 0.14 by 0.86 H), side rays still bright where the frame cuts them, and the floor under the line more saturated (C 0.06–0.07) than the line.
5. Lit haze: edges at L≈0.095 at 0.1–0.3 H, ≈0.146 at 0.54 H, ≈0.07–0.08 just above the floor line; darks blue-black navy with red ≈ 0, never neutral.

## What would make it look like a stock or Instagram gradient

- A cone widening downward over an elliptical pool: the stock stage-light image.
- A beam as one gaussian or a plain top-to-bottom fade.
- A mirror reflection straight down the floor instead of the dark wedge.
- Bloom or a lens streak on the pool line; a pool clipped to flat white or saturated blue.
- A flat navy fill or vignette instead of lit haze; grey-black darks; a cyan-to-navy wash.
- Thin, hard, evenly spaced rays: a laser grid or sci-fi interface.
- Dust, grain or flares in the haze.
