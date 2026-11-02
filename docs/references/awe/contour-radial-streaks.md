# contour-radial-streaks

Node 41:19 "image 62", 925×617 target (a 735×490 fill shown whole, enlarged 1.26×; no `-full` file), recipe hint `contour.beam`.

Angles are measured around the convergence point in image coordinates: 0° right, 90° down, 180° left, 270° up. S is the short side (617 px).

## What the light is physically doing

This is a digital image, not a photo. The sky is smeared along lines through one point and the floor sideways, which a single zoom exposure would not produce. It was saved as a 735×490 JPEG, so nothing is sharper than about 3 px, and the darks show 8 px source blocks when brightened.

It reads as rays through haze converging on a bright horizon, but it is built like a zoom (radial motion) blur of a cloudy light field, not crepuscular rays from a source at the point:

- Streak contrast is at most 2.5 L×100 within 200 px of the point and 5 to 15 L×100 near the frame edge.
- Above the point the sky is darkest 100 to 200 px out (L 0.25 to 0.41) and brightest 350 to 450 px out (L 0.60 to 0.84). Rays from a source would be brightest near it.
- The streaks are irregular soft smears, and some end before the edge (the one at 231° stops 450 px out, 90 px short of the edge).
- There is no sun disc or local peak at the point, which sits on the upper edge of the horizon glow (L 0.77). The hottest light is a floor pool 73 px below and 35 px left of it.
- Floor streaks run within ±5° of horizontal (up to 9° just under the horizon at left), a different smear direction from the sky.

It is not a long exposure: there are no trails with bright cores. It is one blue at different intensities. Hue stays at 245 to 258° wherever chroma is above 0.02. Chroma is set by lightness, with the 10th to 90th percentile within about ±0.006 at any L. There is no halation, no second hue, and no bloom beyond the horizon line's tail.

So the recipe should model a streak field that brightens away from the point, plus a separate horizon line and floor pool, all in one blue. It should not model a source at the point.

## Structure

- Profile axis 161° (black top right to bright left horizon), R² 0.57. The image is polar around the point plus a horizontal floor, so a 1D ramp explains little. The axis curvature (bow −0.41 H) describes the fan, not a warped horizon.
- Convergence point (340, 425), ±20 px in x and ±25 px in y; that is (0.368 W, 0.689 H), or (270, 338) in the source. It is in frame, on the horizon or up to 25 px above it. With the low-frequency ramp removed, only 6% of the gradient energy runs along rays from this point, and drawn rays follow the streaks.
- Streaks: 6 to 7 bright ones, at about 207, 231, 244, 270, 284 and 312 to 321°, with darker ones between. They are 5 to 8° wide at half contrast (36 to 48 px at 380 px out), with lumps of 14 to 15° at 300 to 320°. Spacing is 8 to 29°, 19° on average, and angles hold within 2° from 300 to 460 px out. The top right (330 to 352°) is a near-black sector.
- Horizon line, only right of the point: y 447 to 448 from x 420 to 720, rising to 442 at the right edge. Left of x 400 there is no line. The brightest sky there is a glow band whose crest rises about 6° to the left, from (340, 442) to (40, 412).
- Right floor: a second smear at y 505 (x 470 to 600) slopes to 525 at the edge, separated from the line by a dip at y 475 to 490. The pool is centered at (305, 498).

## Color stops

The profile stops are means of bands that run top to bottom through sky, horizon and floor, so each one mixes several places. I replaced them with local 9×9 medians on the same axis, merged the knees, and added two vertical paths.

| Path, position | Target px | Hex | Color | L | C | Change from profile |
| --- | --- | --- | --- | --- | --- | --- |
| axis 0–30% | (925,149)–(648,245) | `#050E17` | near-black navy | 0.16 | 0.024 | `#0A1323` was a band mean |
| axis 50% | (463,309) | `#102135` | dark navy | 0.24 | 0.045 | added |
| axis 60% | (370,340) | `#284976` | navy blue | 0.40 | 0.086 | merges `#223C5B`, `#36577D` |
| axis 70% | (278,372) | `#5689C0` | steel blue, top chroma | 0.62 | 0.100 | replaces `#7C9DC3` |
| axis 85% | (139,420) | `#D9E9F8` | blue-white, left glow crest | 0.93 | 0.027 | merges 71, 85, 93% stops |
| axis 100% | (0,468) | `#88B5E0` | light blue, left floor | 0.76 | 0.079 | replaces `#689CCD` |
| x 305 | y 0 | `#97C1E8` | light blue, streak field | 0.80 | 0.072 | |
| x 305 | y 290 | `#274C79` | dark blue, gap above point | 0.41 | 0.087 | |
| x 305 | y 436 | `#D6E6F7` | blue-white, sky glow | 0.92 | 0.029 | |
| x 305 | y 498 | `#F4F9FD` | near-white, pool core | 0.98 | 0.008 | |
| x 700 | y 300 | `#050A10` | near-black, dark sector | 0.14 | 0.016 | |
| x 700 | y 447 | `#B4D5F0` | pale blue, line core | 0.86 | 0.052 | |
| x 700 | y 482 | `#5F90C3` | mid blue, dip under line | 0.64 | 0.094 | |
| x 700 | y 515 | `#93BDE7` | light blue, floor band | 0.78 | 0.075 | |

The profile's "bridges" at 71% and 93% are brightness bumps from the pool and the glow band, inside one hue.

## Transitions

With one hue there are no hue bridges, no hue that appears only inside a transition, and no lighter bridge. Wherever a transition passes L 0.55 to 0.65, chroma peaks there (C 0.095 to 0.103). The midpoint is up to 3 times more saturated than either a linear-light or an sRGB mix of the ends. These are intensity changes of one blue, not blends of two colors.

Three dips are darker than both neighbors on purpose:

- the gap above the point (x 305, y 290: L 0.41, between 0.80 and 0.92);
- the 0.02 L dip between the glow band and the pool (x 305, y 448);
- the dip under the line on the right (L 0.64, between 0.86 and 0.78).

They are gaps between separate lights, so the harness check for blends darker than both sides should treat them as sides.

| Transition | 10–90% width (% of H) | Chroma peak | Midpoint C vs linear / sRGB mix |
| --- | --- | --- | --- |
| axis near-black → dark navy | 34.5 | navy end, 0.046 | 0.039 vs 0.035 / 0.034 |
| axis dark navy → steel blue | 26.5 | 68%, 0.102 | 0.086 vs 0.071 / 0.072 |
| axis steel blue → glow crest | 18.0 | steel end, 0.100 | 0.076 vs 0.056 / 0.062 |
| axis glow crest → left floor | 16.5 | floor end, 0.079 | 0.056 vs 0.050 / 0.052 |
| x 305 streak field → gap | 26.3 | y 221, 0.095 | 0.092 vs 0.071 / 0.078 |
| x 305 gap → sky glow | 17.0 | y 383, 0.103 | 0.096 vs 0.043 / 0.056 |
| x 305 sky glow → pool | 4.7, after a 0.02 L dip at y 448 | glow end | 0.022 vs 0.022 / 0.023 |
| x 700 dark sector → line | 8.4, half of it in the last 6 px | y 433, 0.102 | 0.097 vs 0.031 / 0.033 |
| x 700 line → dip | 3.7 | y 480, 0.095 | 0.073 vs 0.068 / 0.071 |
| x 700 dip → floor band | 2.9 | y 491, 0.096 | 0.087 vs 0.083 / 0.084 |

## Softness and edges

- The crispest edge is the top of the horizon line. Above the core, light falls to half in 6 px, to 10% in 31 px and to 1% in 71 px (x 420 to 660). The line widens from 5 px at half max (x 430) to 21 px (x 760 to 910) while its peak drops from L 0.94 to 0.69.
- Softness changes along the horizon: a thin line right of the point, and left of it a 150 px tall bright zone (glow band, shallow dip, pool) with no line.
- Streak profiles are rounded. The dark sector's edge (316 to 330°) spans 13° at 10–90% when 300 px out (68 px) and 19.5° when 500 px out (170 px).
- The right floor band fades into the dark floor over 65 px. The pool has no edge.

## Grain and texture

There is no grain. The profile's 0.19% of 255 (L×100 0.18, size 3.3 px here and 2.6 px at 735) is compression noise plus structure. It grows with the high-pass radius, from 0.10 at σ 1 px to 0.29 at σ 8 px, which grain does not do. Flat areas are smooth at 6×. At 8× gain the dark sector shows JPEG blocks about 10 px across (8 px in the source) with teal and purple-navy shifts between blocks, which is why the darkest lightness bin reads 0.29.

## Highlights

- The brightest 0.5% (`#F2F7FC`, L 0.973) is all in the pool core, which peaks at `#F4F9FD` (L 0.980, linear Y 0.94) at (305, 498). Nothing is pure white, and 0.036% of pixels have one channel at 255. Chroma falls smoothly from 0.10 at L 0.6 to 0.044 at L 0.875 and 0.013 at L 0.975, with no clipped flat and no ring.
- Pool size: 122×55 px at L≥0.96 (13% W × 9% H), 292×95 at L≥0.90, and 457×110 at L≥0.85. The core is symmetric, but the outer levels reach further right (263 px) than left (193 px). A linear-luminance fit to the left half gives a horizontal core σ of 105 px (0.17 S, weight 0.3) plus a wide σ of 290 px (0.47 S, weight 0.7). Vertically below the center it is close to one gaussian, σ 66 px (0.107 S). The pool's top merges into the horizon glow.
- The line core, `#DBECFF` (L 0.94) at x 560, is the second-brightest light.
- The darkest 1% is `#020204` (L 0.089), and the dark sector runs `#02070A` to `#050A10`. Nothing is pure black. Below L 0.2 the darks are slightly more neutral than a dimmed blue (C/L 0.13 to 0.15, against 0.20).

## What to ignore

- The manifest lists no ignore rects, and there are no corners.
- JPEG blocks with their hue shifts, and the softening from the 1.26× enlargement.
- Exact positions of streaks and floor smears, which come from a random texture. Match their counts, widths, spacing and contrast.

## Recipe and light model

Keep `contour.beam`. This is its "beam through haze with a pool", here a fan of beams from one point. Its current streak term does not fit: it radiates from the pool center and fades with distance, for sky and floor alike. Here the sky streaks radiate from a point 0.12 H above the pool and brighten away from it, the floor streaks are horizontal, and a horizon line term is needed.

Light model, following the SHARED.md rules: add one blue light at different intensities in linear RGB, with near-white light only in the line and pool cores.

1. Sky: blue × angular envelope × radial envelope × (1 + m(r)·n(θ)) around the point, where n is smooth 1D noise in angle. Alternatively, run the engine's radial blur pass on a lumpy field, with a smear length of 0.4 to 0.5 of the distance to the point. Never brighten toward the point.
2. The horizon line as a sum of three gaussians, the left glow band, the pool as an anisotropic glow, and the floor through a horizontal directional blur.
3. Weak bloom and no halation, which would add a warm second hue.
4. Tone: a per-channel exponential shoulder on one blue fits everything up to L 0.6 within 0.008 C. It leaves highlights too blue (C 0.072 at L 0.875, against 0.044), so the line and pool cores need their own near-white color.

Starting parameters (positions as fractions of W and H, widths in S):

- Point (0.368, 0.689). Streak spacing averages 19°, and widths are 5 to 8° plus a few 14 to 15° lumps. Contrast is 0 inside 0.25 S and grows about linearly with distance. Bright streaks are +3 to +6 L×100 at 0.5 S and +5 to +14 at 0.65 to 0.9 S. The deepest dark streak (216°) is −11 at 0.5 S and −15 at 0.65 S.
- Angular envelope at 0.57 to 0.73 S: L 0.6 to 0.84 at 195 to 285° (the 216° dark streak dips to 0.53), 0.46 to 0.60 at 290 to 320°, an edge at 316 to 330°, and 0.11 to 0.16 at 330 to 352°. Radial envelope above the point: lowest at 0.2 to 0.32 S, highest at 0.57 to 0.73 S.
- Horizon line at y 0.726 for x 0.45 to 0.78, rising to 0.716 at the right edge. Above it, σ 0.006 S (weight 0.64), 0.027 S (0.29) and 0.061 S (0.06). Peak linear Y falls from 0.82 at x 0.6 to 0.33 at the edge, as the half-max width grows from 0.008 S to 0.034 S.
- Glow band crest from (0.368, 0.716) to (0.043, 0.668), L 0.90 to 0.93, 0.02 to 0.04 S thick at L≥0.90.
- Pool at (0.33, 0.807), 0.08 H below `floorY` rather than on it. Horizontal σ 0.17 S (weight 0.3) plus 0.47 S (weight 0.7); vertical σ 0.107 S.
- Floor band at y 0.82 for x 0.5 to 0.65 (L 0.84 to 0.89), sloping to 0.85 at the right edge as L falls to 0.52. Floor smears run within ±5° of horizontal (−8 to −9° just under the horizon at left). The floor bottom is L 0.67 to 0.74 at left and 0.18 to 0.22 at right.
- Colors: dark `#050A10`, nominal blue `#5689C0` (C 0.10, h 251°), line `#DBECFF`, pool `#F4F9FD`, light floor `#88B5E0`. In display luminance relative to the nominal blue, the dark sector is 0.01×, the line core 3.5× and the pool 4×.
- Grain 0, dither on. For production, Atmospheric is the closest pack, but Meta Blue (C 0.205) is twice as saturated as this blue.

## Five things a recreation must get right

1. Rays drawn from (340, 425) follow the sky streaks to within about 5°, and streak angles hold from 300 px out to the frame edge.
2. No streaks within about 150 px of the point. The sky above it is darkest 100 to 200 px out (L 0.25 to 0.41) and brightest at the top left (L 0.80 to 0.84).
3. The horizon line exists only right of the point, at y 447 to 448 with a core σ of about 4 px. It widens to 21 px and dims to L 0.69 at the right edge, and left of the point it becomes a broad glow band rising to y 412.
4. The hottest light is the floor pool at (305, 498): `#F4F9FD`, unclipped, 122×55 px at L≥0.96, over horizontal floor smears.
5. One blue throughout: hue 245 to 258°, chroma peaking at 0.10 near L 0.6, and the top right sector (330 to 352°) near-black at L 0.08 to 0.16.

## What would make it look like a stock or Instagram gradient

This reference is itself a stock-style image, so the risk is copying its clichés:

- An even sunburst: equal wedges at equal spacing with crisp sides, instead of soft streaks 5 to 15° wide and 8 to 29° apart.
- A god-ray filter look: rays brightest at the point, or a sun disc or lens flare there. The reference is dimmest near the point.
- A full-width horizon line of constant thickness, or a neon-thin line that reads as a sci-fi interface.
- The sky fan mirrored onto the floor.
- Mid-tones at full Meta Blue chroma, or a flat clipped white pool.
- A warm halation fringe, or banding and blocks in the dark sector.
