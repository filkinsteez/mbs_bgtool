# sunset-film-poster-bands

Figma node 41:25 "image 42" · target 925×1296 (source fill 960×1345, shown whole) · recipe hint `sunset.bands`.

## What the light is physically doing

A scan (or flat photo) of a printed Japanese poster for *Punch-Drunk Love* (credits: "ARTWORK JEREMY BLAKE"). No light source is in frame; every value is ink on evenly lit paper. The image is five horizontal bands blurred so hard that no edge is under about 60 px wide: dark red (cut off by the top edge), black, muted blue, grey, and red filling the bottom third.

The bands look like out-of-focus light, not painted blur. There are no brush marks or streaks, and the patches inside the bands are round (lightness stays correlated over 125 px across and 115 px down). The edges have the short tails of a defocus disc: the 10–90% width is 1.73–1.77 × the 25–75% width (disc 1.70, gaussian 1.90). There are no point lights to show bokeh discs. One thing does not match a physical defocus: the edges are nearly symmetric in Oklab. A linear-light blur would push the midpoints of the three main edges 15–45 px into the darker band, but the black band keeps its width. The print and scan tone curves (or a digital blur) did that, so match the measured edge positions.

The print sets the limits: ink black at L 0.15–0.17, nothing above L 0.76, moderate chroma, and no bloom, halation or glow.

## Structure

- Axis 92.25° (top to bottom), R² 0.94. The 2.25° tilt and the profile's curvature (bow −0.055 H) both come from the black→blue edge alone. That edge is an uneven wave, not a symmetric bow. The other edges are level within ±2 px.
- There is no horizon line and no light core. The grey→red edge (65% down) is the closest thing to a horizon.
- Band spans (full-width average, between Oklab 50% edges): top red 0–67 px, black 67–326, blue 326–589, grey 589–846, red 846–1296.
- Edge shapes, traced per 5 px column:
  - red/black: y 79 at the left edge, 35 at x 400–450, 66 at the right edge, so it arches up about 40 px in the middle.
  - black/blue: 260 at the left edge, 369 at x≈550, 341 at the right edge. One uneven wave, 110 px peak to peak.
  - blue/grey: ±15–20 px, wavelength 250–500 px. Furthest down at x≈350 and 650 (601, 610), furthest up at x≈250, 475 and the right edge (571, 577, 565).
  - grey/red: one wave of ±15 px, wavelength 650–700 px (864 at x≈250, 895 at x≈600–650, 865 at the right edge).
  - Ripples of about ±8 px sit on the first two.
- Round patches, 200–300 px across; lightness std is 0.04 after removing the bands.
  - plum #3B181A, about 300×120 px, around (560, 290), between black and blue
  - a lighter column at x 450–600, y 500–650 (L 0.58–0.61)
  - a dark left quarter of the grey band (L 0.31–0.36 vs 0.45–0.54 at center)
  - a coral patch at the red's left edge (x 0–100, y 880–1060)
  - a darker blue on the left (#456F99 vs #587BA3)

## Color stops

Full-width means; y is where the position crosses the frame center.

| pos | y (px) | hex | color | L | C |
|---|---|---|---|---|---|
| 1% | 0 | #8E2016 | dark brick red | 0.426 | 0.147 |
| 13% | 160 | #100F0E | ink black | 0.169 | 0.003 |
| 39% | 500 | #5178A1 | muted denim blue | 0.562 | 0.078 |
| 49% | 640 | #605F5A | neutral warm grey | 0.484 | 0.008 |
| 57% | 745 | #4A443D | dark olive-brown grey | 0.390 | 0.013 |
| 71% | 927 | #E4584D | coral red (rim) | 0.642 | 0.176 |
| 81% | 1040–1080 | #E53F36 | warm scarlet (core) | 0.613 | 0.205 |
| 98% | 1292 | #C22A1F | deep red | 0.531 | 0.19 |

How I merged the profile's 15 stops:
- Stops 0 and 1 are one band cut by the top edge.
- Stops 2, 4, 5, 9 and 10 are bends inside transitions.
- Stop 7 (#606566) is the neutral midpoint of the blue→grey hue change, so I used the grey's top at y 640 instead.
- Stop 12 is slightly lighter than the core because its range includes rows 1086–1160, which are only sampled beside the title.
- Stops 13 and 14 come from the margins only. They are one gradual darkening, and their 11 px step is a mask-edge artifact.
- The grey and the red keep extra stops because each changes tone from top to bottom.

## Transitions

Oklab 10–90% widths as % of frame height:
- **Red → black**, y 29–111 (6.3%). No bridge; the hue stays at 28–30°. The midpoint #491711 equals both the linear-light and sRGB mixes, because the two colors are nearly collinear in Oklab.
- **Black → blue**, y 235–419 (14.2%). No bridge. A dim plum appears only here (#302835, hue 311), strongest right of center. The midpoint #3A3D55 has the linear-light mix's L (#2C4056, +0.002) but its hue is turned 26° toward violet.
- **Blue → grey**, y 545–634 (6.9%). It passes through neutral #606566 and is slightly lighter (+0.007) and greyer (−0.006) than either mix. The profile's "bridge" at #52779E is just the blue band, lighter than its neighbors.
- **Inside the grey**, y 654–712 (4.5%): darkens to L 0.39. The midpoint has 0.007 more chroma than either mix. The grey is darker than both of its neighbors.
- **Grey → red**, y 794–898 (8.0%). The one real lighter, greyer bridge: the midpoint #8F6252 is 0.028 lighter and 0.039 less saturated than the linear-light mix #984D44 (the sRGB mix is similar). A dusty tan-orange (hue 36–52°) appears only here. The edge ends in the coral rim, which is lighter than both sides.
- **Rim → core**, y 932–1001 (5.4%): C rises 0.176 → 0.205, and the midpoint matches both mixes. Below y≈1160, the red darkens to L 0.52 at the bottom edge.

Saturation peaks inside the bands, never inside a transition.

## Softness and edges

Every edge is soft. Local 10–90% widths per column (median, range):
- red/black: 86 px (79–115), widest at the right
- black/blue: 172 px (148–210), widest at x 550–650 under the plum
- blue/grey: 74 px (66–101), about 95 px at x 200–350 and about 70 px on the right
- grey/red: 104 px (82–125), but 160–240 px in the left 150 px, where the coral patch lowers the saturation

The profile's waviness for stops 7→8 and 11→12 measures patches inside the bands, not edges.

## Grain and texture

At 925 px wide: 1.10 Oklab L × 100, 1.20% of 255, about 1.5 px, 97% mono. It is strongest in the midtones (1.33 at L 0.4–0.5) and weaker in the black (0.98) and the red (0.73). At the 960-px source it measures 1.53 L × 100, 1.71%, about 1.15 px.

It is not film grain. It is print texture plus compression:
- The autocorrelation repeats every 6 px down and 7.5 px across instead of dying out.
- The dim plum zone shows a diagonal hatch about 5 px apart, rising to the right at about 37°. Flat red shows a 2×4 px checker at the source. Both fit a halftone screen too fine for the scan.
- At the source, pixel differences peak on every 8th row and column (4.8–5.0 vs 3.4–4.5). These are JPEG 8×8 blocks, along with 16-px tinted chroma squares.

There is no visible banding.

## Highlights

There is no roll-off to white and no clipping; the channel maximums are R 245, G 146 and B 182. The brightest 0.5% averages #E67F68 (L 0.706), almost all of it in the coral patch at x 0–100, y 900–1000; the peak is L 0.76 at (27, 968). The darkest 1% averages #090B0A (L 0.146), in the black core at x 200–600, y 100–200. No pixel is pure black.

## What to ignore

- The manifest rects: the Japanese title [139, 1086, 668, 75] and the credits and logos [20, 1160, 885, 124]. Both are fully covered.
- The halftone hatch, the checker, the JPEG blocks and the chroma squares.
- Dust specks at (339, 189), (257, 215), (391, 550) and (499, 319), and a dark mark at (829, 1076).
- The left 2 px columns, which are 0.03 L darker.

## Recipe and light model

`sunset.bands` fits: this is the brief's "three to five stacked bands … blurred hard."

Write each band as emitted linear-RGB radiance at nominal intensity, with soft, warped edges whose softness varies along the edge. Use a short-tailed falloff; a disc fits the tails, and a gaussian is close. Add the grey→red bridge as a broad, low-saturation warm haze, because a straight blend gives brown-red. Turn the lens off (no bloom or halation). Apply grain at output size, then dither.

Linear light narrows the dark bands, so shift these blend edges away from the dark band: red/black about 18 px up, black/blue 40 px down, grey/red 15 px down.

Starting parameters (fractions of H, x as fractions of W):
- Stops: as in the table, at 0, 0.123, 0.386, 0.494, 0.575, 0.715, 0.80–0.83 and 1.0.
- Mean edges: 0.052, 0.252, 0.454, 0.653. There is no horizon; the 0.653 edge plays that role.
- Linear-light gaussian sigma: 0.024, 0.047, 0.022, 0.030, and 0.021 for rim → core.
- Warp, relative to each edge's mean:
  - edge 1: middle 0.02 up, left edge 0.015 down, right edge 0.005 down
  - edge 2: 0.085 peak to peak, high at x 0, low at x 0.6
  - edge 3: ±0.014, wavelength 0.3–0.5 W
  - edge 4: ±0.012, wavelength 0.75 W
  - ripples: ±0.006
- Patches: about 0.25 W across, L std 0.04, plus the specific patches under Structure.
- Bridge midpoint: #8F6252.
- No glow, so the glow core and tail widths do not apply.
- Grain: random mono, 1.2% of 255 at 925 px, about 1.5 px.

## Five things a recreation must get right

1. The ink black holds L 0.17–0.19 from y 120 to 200; the blue peaks at L 0.56 at y≈500; the grey bottoms out at L 0.39 at y≈745; the red runs from y≈850 to the bottom.
2. Black→blue is by far the widest edge (about 175 px), with a dim plum foot right of center. The others are 58–104 px.
3. Grey→red passes through dusty tan-salmon (#8F6252), not brown. A lighter coral rim (L 0.64) sits above the core (#E53F36, C 0.205), and the red darkens to #C22A1F at the bottom.
4. The black/blue edge drops from y≈260 at the left to y≈369 at x≈550, and the top edge arches up about 40 px. The dark left grey, the coral left edge and the plum patch are all present.
5. Nothing exceeds L 0.76 and there is no glow. The black is ink black at L 0.15–0.17, not #000, and the grain is fine mono at about 1.2%.

## What would make it look like a stock or Instagram gradient

- Straight, level or evenly spaced edges, or the same wave on every edge.
- Equal softness on every edge, like a five-stop linear gradient.
- Pure saturated hues: an #FF0000 red, a bright sky blue, or neon violet between the black and the blue. The real blue is muted (C 0.077), and the red sits at hue 28°.
- Brown-red mud (#984D44) at the grey→red edge.
- A sun, bloom, white highlights, or #000 blacks.
- Uniform bands with no patches.
- Copying the scan's moiré or JPEG blocks, or heavy colored noise.
