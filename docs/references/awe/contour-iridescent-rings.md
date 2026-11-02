# contour-iridescent-rings

Figma node 41:30 "image 48"; target 925 × 1233 px (source 1000 × 1333, shown whole at 0.925×); recipe hint `contour.halo`.

## What the light is physically doing

A photo, most likely a phone JPEG, of a light installation or projection in a dark room: three ellipses of light on navy-black, with the head and shoulders of a person in the audience at the bottom center. Each ring is brightest at its outer edge, and its light spreads only inward. Outside the edge there is almost nothing.

The camera shapes most of what we see. The rim cores are past its clip point, so they come out pale and nearly grey (C 0.005 to 0.04), and the whole image tops out at a light grey (L 0.77; no channel above 200, 206 in the source). A ring's hue shows only below that ceiling, inside the falloff, where the color channels fade at different depths (blue lasts on the lavender and cyan rings, red on the coral ring). So the hue turns as the light fades. That is the "iridescence": a 25 to 55° hue turn across each rim and 10 to 20° along it, not a spectrum around the ring.

Lens effects are weak: a 1 to 5% halo just outside each rim, and no wide bloom, haze or halation. Overlapping light adds: coral and cyan glows make a mauve lighter than either, and the two crossings reach the ceiling as a pale X. Near each crossing both glows also brighten beyond their sum. This is not lens glare, because the dark quadrant outside both rings rises only 0.01 in linear Y. Either the content or the phone's processing does it.

## Structure

There is no single axis: the profile's 1D fit (103.75°) explains 30% of the image. The image is three ellipses with no warp (outer half-maximum edge, target px):

- Lavender: center (504.5, 321.9), semi-axes 232.3 × 217.7, entirely inside the frame (x 270–737, y 104–540).
- Cyan: center (587.9, 317.7), semi-axes 674.7 × 626.7. Only 25% of the outline is in frame: the bottom arc from the left edge at y 625, lowest at (588, 944), to the right edge at y 861, plus a piece across the top-left corner from (6, 0) to (0, 10).
- Coral: center (392.7, 1106.4), semi-axes 357.4 × 398.9 (taller than wide). Top at y 708, widest near y 1115, cut by the bottom edge with two thirds of its height visible.

The cyan and coral rims cross at (161, 803) and (715, 933), at about 78°. The coral ring's cap lies inside the cyan ring and forms a lens about 570 px long and up to 220 px tall. Light covers 28% of the frame above L 0.25 and 11% above L 0.5.

From the peak to 10% (luminance), the outer side of every ring takes 2 to 5 px (0.2–0.4% of frame height). The inner side takes 27–46 px on the lavender ring (2.2–3.7%), 55–74 px on the cyan ring (4.5–6%) and 23–33 px on the coral ring (1.9–2.7%).

## Color stops

The profile's 13 axis stops are band means across all three rings (`#4F4E57` at 57% averages cyan rim, coral glow and dark interior). None of them is a color in the image, and its "bridges" are only where the band crosses a rim. I replaced them with stops measured along each rim's normal (median over clean stretches), as depth inward from the outer edge.

| Where | Depth or sample | Hex | Color | L | C |
| --- | --- | --- | --- | --- | --- |
| Base, outside all rings | box 850–920, 1150–1230 | `#050507` | near-black | 0.118 | 0.005 |
| Base, inside cyan ring | box 800–860, 250–370 | `#06090E` | near-black navy | 0.140 | 0.013 |
| Base, lavender ring to top edge | box 450–550, 20–70 | `#0D101C` | dark navy | 0.178 | 0.025 |
| Base, inside coral ring | box 120–200, 1100–1180 | `#0A0709` | warm black | 0.136 | 0.008 |
| Lavender line | 2 px (top: x 504, y 106) | `#A6A7B2` | pale grey-lavender | 0.731 | 0.016 |
| Lavender | 10 px | `#7677AB` | periwinkle | 0.589 | 0.079 |
| Lavender | 20 px | `#645B91` | violet | 0.503 | 0.085 |
| Lavender | 40 px | `#423759` | plum | 0.364 | 0.059 |
| Cyan line | 3 px (left part, rim at 87, 738) | `#AFB3BA` | pale grey | 0.766 | 0.011 |
| Cyan | 10 px | `#95ADB1` | pale cyan-grey | 0.731 | 0.027 |
| Cyan | 20 px | `#76A8AF` | cyan | 0.699 | 0.054 |
| Cyan | 30 px | `#6AA5B0` | cyan-teal | 0.686 | 0.063 |
| Cyan | 40 px | `#588CB0` | sky blue | 0.618 | 0.078 |
| Cyan | 50 px | `#406B92` | steel blue | 0.514 | 0.079 |
| Cyan | 80 px | `#1C2D46` | navy | 0.295 | 0.051 |
| Coral line | 1 px (left side, rim at 40, 1044) | `#A2897E` | pale peach-grey | 0.650 | 0.035 |
| Coral | 5 px | `#99675A` | dusty coral | 0.563 | 0.068 |
| Coral | 10 px | `#8B5248` | coral red | 0.502 | 0.079 |
| Coral | 20 px | `#6B3539` | rose maroon | 0.400 | 0.077 |
| Coral | 50 px | `#341319` | wine | 0.240 | 0.053 |
| Left crossing, brightest 1% | within 40 px of 161, 803 | `#BAB3B7` | pale pink-grey | 0.774 | 0.010 |
| Lens near the crossings | 70–110 px from a crossing | `#ABA1AB` | pale mauve | 0.721 | 0.018 |
| Lens, middle depths | inside both rings | `#816981` | mauve | 0.552 | 0.047 |
| Lens center | box 430–490, 800–840 | `#171726` | dark violet-navy | 0.212 | 0.029 |

Along the rings: the cyan ring's right part is more teal (h 204 at 30 px, against 211 on the left), the lavender ring's lower half turns mauve sooner (h 304–309 at 20 px, against 290), and the coral ring's top is pinker.

## Transitions

- Base to rim, every ring: 10–90% in 2 to 4 px. No bridge and no extra hue.
- Rim line to glow to base: the saturated color exists only inside the falloff. It peaks at 15 px on the lavender ring (C 0.09), at 40–50 px on the cyan ring (0.08) and at 10 px on the coral ring (0.08). At the same lightness, a linear-light or sRGB mix of the line and the interior has C 0.011–0.026, so the glow is 3 to 7 times more saturated than either mix. Some hues are found only here: periwinkle (h 276–283), cyan-teal (h 201–213) and orange-coral (h 30–36). The depth where each channel falls to 50% (R / G / B, px) is 9 / 9.5 / 25 for lavender, 16 / 43 / 53 for cyan and 16 / 5.5 / 4.7 for coral.
- Coral glow into cyan glow (the lens): lighter than both, with a hue between them (mauve, h 313–326). A linear-light sum of the two single-ring glows matches the colors much better (mean Oklab ΔE 0.07–0.09) than averaging (0.17–0.18). But the lens is 1.2 to 1.7 times brighter than that sum, and up to 2.5 times next to the crossings, where the coral glow brightens over the last 85–140 px of rim and the cyan glow over the last 35 px. An sRGB screen blend matches the brightness a little better (ΔE 0.05–0.06), but the light model rules forbid sRGB mixing, so use a crossing boost instead.
- Crossing plateau to its surroundings: smooth, with no ring where the compression starts.

## Softness and edges

- Outer edges are hard on all rings: 50% at 1.5–3.5 px outside the peak, 10% at 2–5 px. Beyond that there is a faint halo. On the lavender and coral rings it is 1.1–1.5% of the peak at 5–16 px out; on the cyan ring it is 5% at 6–12 px and 1.3% at 48 px, and bluer than its rim.
- Inner softness varies along each ring. The lavender glow is 1.4–1.6 times wider on its upper-left half than on its lower-right. At the left frame edge the cyan glow is brighter than the fit predicts: `#294B70`, L 0.41, at y 325–400, where the rim is about 85 px off-frame; elsewhere that depth gives L 0.25–0.30. The coral ring is even except near the crossings.
- Near the crossings the rims widen into pale bands 30–40 px across. The dark wedge outside both rings keeps a hard 2–3 px edge.

## Grain and texture

This is camera noise, not film grain. At 925 px it measures 1.06 levels of 255 std (0.41%), Oklab L×100 0.53, 93% mono, with blobs about 2.4 px across. At the 1000 px source it is 1.19 levels (0.47%), L×100 0.60, with blobs about 2.25 px. It is about twice as strong in the darks (1.1 levels at L 0.1–0.3) as on the rims (0.5–0.6).

JPEG 8×8 blocks show in the darks at gain 4–8: the step across a block boundary is 1.43 levels, against about 0.5 inside a block. The darkest areas also carry green-teal chroma blocks. The noise figures include some of this block structure. There is no visible banding.

## Highlights

Nothing is white. The brightest pixel is (193, 187, 189), and the brightest 0.5% averages `#B8B0B3` (L 0.76). Pixel counts pile up at L 0.76 and stop at 0.79, so the tone range ends in a shoulder at about L 0.77 (linear Y about 0.46). Rim cores sit at L 0.61–0.78 with C 0.005–0.04, while 10 px inside the chroma reaches 0.03–0.08: chroma falls as light nears the ceiling.

A linear sum of the two rim peaks would be `#F0E3DF` (L 0.93) at the left crossing and `#CFD5D8` (L 0.87) at the right. The image compresses them to a wide plateau at L 0.77 on the left and to L 0.73–0.75 on the right, where both rims are dimmer. In the darks, the darkest 1% is `#040406` (L 0.109), there is no pure black, and the median is L 0.175.

## What to ignore

- Ignore rect [265, 1070, 350, 163]: the head and shoulders of a person seen from behind, darker than the base, with a small highlight on the head. SHARED.md does not mention them. At gain 8, no part of them shows outside the rect.
- JPEG blocks and green chroma blocks in the darks.
- Keep the ceiling, the noise and the brightening near the crossings. They are part of the look.

## Recipe and light model

`contour.halo` fits. This reference breaks three of the brief's Contour rules ("no complete geometric shape, no hard edges, one source per image"): it has three sources, a complete ellipse and hard outer edges. BRIEF.md already flags the three sources. The reference preset must reproduce them; production presets should keep one ring cropped by the frame, with a softer outer side.

The current recipe draws circles, with one color per ring and tails shared by all rings. To reach this reference it needs an x/y aspect per ring, inner widths per ring (the cyan glow is about twice as wide), per-channel inner widths or a second, deeper color per ring, a near-zero outer tail plus the faint halo, and a light-grey white point.

The light model, in SHARED.md's terms: each ring writes linear radiance as a thin core at the outer edge (outward σ about 1.5 px) plus an inside-only falloff that is a sum of gaussians, with a separate width per RGB channel. The rings add. The tone shoulder then compresses toward L 0.77, which turns the cores grey and flattens the crossings. In the lens pass, use only a faint bloom for the halo, and no halation. Grain goes last.

Starting values: centers in uv with y down, as in the existing preset; lengths in short-side units (px ÷ 925). The falloffs were measured after the shoulder, so the core needs to be stronger before it.

| Ring | Center px (uv) | Semi-axes px (units) | Glow → deep color | Inner falloff σ px (weight) |
| --- | --- | --- | --- | --- |
| Lavender | 504.5, 321.9 (0.545, 0.261) | 232 × 218 (0.251 × 0.235) | `#6C68A1` → `#423759` | 3.9 (0.52), 21 (0.46), 54 (0.02) |
| Cyan | 587.9, 317.7 (0.636, 0.258) | 675 × 627 (0.729 × 0.678) | `#6AA5B0` → `#406B92` | 31 (0.96), 65 (0.03), 78 (0.01) |
| Coral | 392.7, 1106.4 (0.425, 0.897) | 357 × 399 (0.386 × 0.431) | `#8B5248` → `#522528` | 2.7 (0.54), 12 (0.35), 31 (0.12) |

- Put the core peak 2–3 px inside the outer edge, with the outer side down to 50% in about 2 px.
- Outer halo: 1.3% of the peak (lavender, coral) or 5% (cyan) at 5–15 px, a third of that at 40–50 px, and nothing by 100 px.
- After the shoulder, the lines should sit at L 0.70–0.77. At 20 px depth, aim for L 0.50 (lavender), 0.70 (cyan) and 0.40 (coral).
- Base: `#050507` outside, `#07090F` inside the cyan ring.
- Boost both glows within about 100 px of each crossing (up to 2–2.5 times inside the coral ring).
- Ceiling at L 0.77 (`#BAB3B7`), with no channel above about 205.
- Grain: 0.4% std, mono, about 2.4 px at 925 px, stronger in the darks. Do not add JPEG blocks.

## Five things a recreation must get right

1. Three ellipses at the measured centers and sizes: lavender complete in frame, cyan only as its bottom arc plus the top-left corner, coral cut by the bottom edge, crossings at (161, 803) and (715, 933).
2. Each rim falls to 10% within 5 px outward, but takes 27–46 px (lavender), 55–74 px (cyan) and 23–33 px (coral) inward, with only a 1–5% halo outside.
3. At 10, 20 and 40 px inside, lavender reads periwinkle, violet, plum; cyan reads pale cyan, cyan, sky blue; coral reads coral red, rose maroon, wine. The line itself is near-grey.
4. Cores and crossings top out at L 0.77 (`#BAB3B7`), with no channel above about 205.
5. The lens between the crossings is mauve (`#816981` to `#ABA1AB`) and lighter than either glow, and each crossing is a wide pale X, with the glows brightening before it.

## What would make it look like a stock or Instagram gradient

- Neon strokes, with a glow on both sides of the ring, read as a neon sign or a science-fiction interface.
- One flat color per ring reads as a vector stroke with an outer glow.
- Pure white cores or crossings, or a hard clip.
- Saturated neon colors (C above 0.1), or a rainbow cycling around each ring.
- Perfect circles, or circles that are centered, evenly spaced or all complete, read as a logo or a target.
- A big soft bloom around everything. Outside the rims there is 5% at most.
- Averaged or darkened overlaps (alpha blending).
- A clean `#000000` base without noise.
