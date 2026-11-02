# sunset-violet-wave

Node 41:31 "image 58", 925×617 (the whole 1200×800 fill, reduced), recipe hint `sunset.ramp`.

## What the light is physically doing

Most likely a heavily blurred photo of hills at dusk: only light and silhouettes remain. There is no sensor noise, so it was blurred in software or shrunk, and the 32 px JPEG block grid suggests it was enlarged from a smaller file.

The sun is below the horizon behind the right hill. The brightest sky is a broad warm-white glow (#F2EFEA, L 0.953) just above that hill, at about (839, 145–175). Away from it the sky cools to light blue overhead (#8DC9E8) and a deeper blue at the upper left (#578ECC), farthest from the sun. A thin pink band of low scattered light (#F4CFE7) lies just above the land under the glow and fades to the left.

The land is violet because only the sky lights it. The right hill, under the glow, is the lightest and most saturated purple (#BE84DB to #4A35AD, chroma up to 0.18); blur and haze spread glow light over its top. On the left, a lavender-grey haze band (#8984C3) sits above a darker indigo ridge (#3E3891). A lighter blue swell at (700–760, 445) is probably another ridge. Everything darkens to navy at the bottom. There is no bloom, halation, vignette or grain.

## Structure

The gradient is vertical. The profile's 95° axis (R² 0.94) is tilted 5° only because the glow is on the right. Lateral spread peaks at the horizon (std 0.108) and is close to zero at the bottom.

The horizon (where the light sky ends) is highest at the right edge (y ≈ 222). It falls at 25–40° through y ≈ 282 at x = 810 into a flat trough at y ≈ 330–345 over x ≈ 610–760, lowest near x = 685. It then rises slowly to y ≈ 308 at x = 435. Left of x ≈ 420 it splits:

- The light's lower edge turns up-left as a soft diagonal: y ≈ 300 at x = 410, 250 at x = 310, 200 at x = 235 and 155 at x = 135.
- The land's top is a dark ridge, lowest at y ≈ 375 for x ≈ 285–360 and rising to 290 at the left edge. The lavender-grey band fills the wedge between the two.

The bow is confirmed, but it is asymmetric. The L = 0.5 iso-line runs y ≈ 301 (x = 10), 384 (x = 370–505), 413 (x = 685–730) and 362 (x = 910). The sides sit 18% and 8% H above the low point, about 13% on average, matching the profile's −0.119. Curvature fades with depth: parabola fits give `curve` 0.55 at L 0.75, 0.21 at L 0.6, 0.17 at L 0.5 and 0.14 at L 0.4, and the bottom transition is flat. The lines wander about 10 px around the fits.

The profile's 10–90 widths are 15.8, 9.0, 8.7, 15.8, 20.0 and 11.4% of H.

## Color stops

On the center column (x ≈ 460). Axis % follows the profile, where 0 is the top-right corner.

| axis % | y | hex | color | L | C |
| --- | --- | --- | --- | --- | --- |
| 6 | 0 | #8DC9E8 | light sky blue | 0.806 | 0.076 |
| 32 | 185 | #D8E1EA | blue-white | 0.905 | 0.016 |
| 46 | 278 | #DAC5DD | pale pink-lilac | 0.849 | 0.039 |
| 54 | 339 | #8F6FBE | violet | 0.607 | 0.121 |
| 66 | 419 | #433E94 | indigo | 0.419 | 0.136 |
| 88 | 571 | #111B4C | navy | 0.248 | 0.091 |
| 94 | 614 | #0E1036 | near-black navy | 0.200 | 0.073 |

Off the column: right hill #BE84DB (905, 260), #8859CD (905, 330) and #4A35AD (905, 400); blue swell #3E439F (700, 450).

Changes from the profile:

- #AFC9E2 at 0% is the grey top-right corner, not the sky.
- The bridge #CADCE9 at 24% is real but misplaced. The bins slope down 5° to the right, so this one passes through the glow core and averages the blue left side with the white right side. The lightest point on the center column is at y ≈ 185, and the core is 0.07 L lighter than #CADCE9.
- #CAC8E1 and #B5A2D6 are knees of one curve, averaged across the frame, so I merged them into #DAC5DD and added #8F6FBE.
- I kept #413C96, #13194A and #0F0D33 (the bottom-left corner).

## Transitions

Center column:

- **Sky blue to blue-white:** 105 px (17% H). Chroma falls from 0.076 to 0.016. The midpoint has 0.011 C more than a linear-light mix.
- **Blue-white to pink-lilac:** 62 px (10% H). This is the lower half of the bridge, which is lighter than both its neighbors. The hue swings 250 → near-neutral (C 0.014) → 321. The midpoint (h 318) is pinker than both the linear and the sRGB mix (h 302).
- **Pink-lilac to violet** (the horizon): core 41 px (6.6% H). The midpoint has C 0.086, against 0.074 for a linear mix and 0.078 for an sRGB mix. Taken as one step from blue-white to violet, the midpoint is #BFA1D1 (h 312), while a linear mix gives #B1A9D1 (h 294): the real path bends through pink.
- **Violet to indigo:** 63 px (10% H). The hue goes 301 → 281, and chroma peaks at 0.137 at y ≈ 401.
- **Indigo to navy:** 120 px (20% H). The midpoint #242D71 (h 273) is bluer than the linear mix (h 278).
- **Navy to bottom:** 11% H, matching the linear mix.

Right column (x ≈ 905): warm white, pink #F2CEDF (h 349–360, a hue found only inside this transition), then purple. The midpoint #DBA8E0 (h 323, C 0.096) is pinker and more saturated than the linear mix #CCB1DE (h 312, C 0.070). The chroma peak (0.18) is 140–170 px below the hill top.

Violet midpoints carry 0.01–0.026 C more than linear-light mixes; sRGB mixes are only 0.002–0.007 C better than linear. No midpoint is darker than both of its ends.

## Softness and edges

No edge is hard. Core 10–90 widths, measured vertically:

- Right hill top: 36 px at x = 910 (the sharpest edge), 46–49 px at x ≈ 785–885.
- Trough, x ≈ 635–760: 60–90 px, where the edge merges with the violet-to-indigo step.
- x ≈ 435–585: 32–42 px.
- The upper-left diagonal: 100–150 px with low contrast (ΔL 0.1–0.2). This is the softest edge.
- Left dark ridge: 32–38 px at x ≈ 210–285, 40–65 px elsewhere.

Each edge has a narrow core and long soft shoulders. With the shoulders, the full sky-to-land change takes 57–90 px.

## Grain and texture

There is no grain. The high-pass luma std is 0.09–0.19% of 255 at both 925 and 1200 wide; the profile's along-iso value (0.153%, L×100 0.127) is below the 0.3% threshold. Its "grain size 2.48 px" is really banding steps and block seams running along the iso-lines. JPEG seams fall every 32 px in the source (about 25 px at 925) and show with gain in the dark lower third, together with 8-bit banding.

## Highlights

Nothing clips (maximum RGB 249/239/241). The brightest pixel is #F2EFEA (L 0.953) at (839, 143), and the brightest 0.5% averages #F2EEEB. The core is broad and flat: L ≥ 0.95 over x 805–869, y 140–180, and L ≥ 0.925 over x 644–924, y 98–225, with no ring. The darkest 1% averages #0E0F33 (L 0.195) and the minimum is #0A0D2C. Blue never drops below 44, so nothing is black.

## What to ignore

There are no ignore rects and no corners. Ignore the JPEG seams and the banding. The lavender-grey band and the blue swell are real structure.

## Recipe and light model

Keep `sunset.ramp`: the core of this image is a vertical ramp with a curved, warped horizon and a glow. `sunset.bands` has ridges but no glow, and `sunset.blooms` has a stretched off-center glow but no horizon. A 1:1 match needs four things the ramp lacks: glow brightness that varies along x, softness that varies along the horizon, a second ridge on the left, and curvature that fades with depth.

Light model, in linear light: the sky is a blue base ramp plus an additive warm-white glow plus a thin additive pink band above the land. The land is blended over the sky in linear light through a soft coverage edge whose sigma varies along x; its own light is a violet-to-indigo-to-navy ramp plus haze under the glow. Bloom 0–0.04, no halation, no roll-off (the core is nominal).

Starting parameters (t = y/H at x ≈ 460, angle 0, `uv.y = 0` at the top):

- **Stops:** the table's first six at t 0, 0.30, 0.45, 0.55, 0.68 and 0.925, plus #0E1036 at 1.0 if a seventh slot exists.
- **Horizon:** curve 0.18 with curveCenter 0.25 (x ≈ 615) fits the land iso-lines to about 10 px. The top of the land at the right edge is about 95 px above that parabola, so the warp or a hill shape has to lift the right 200 px. Warp 0.03–0.04, warpScale 1.2.
- **Softness:** 0.025 (σ ≈ 15 px) where crisp, σ 27–35 px in the trough, 45–60 px on the upper-left edge.
- **Glow:** #F2EFEA at t ≈ 0.26, x ≈ 0.9 W. Flat over y 143–175, then roughly gaussian upward with σ ≈ 80 px (d50 0.16 and d10 0.24 of the short side). Horizontally it holds at 70–90% of its excess for 560 px to the left, then a soft diagonal cuts it off (d50 ≈ 1.0 short side, near zero at x ≈ 40).
- **Grain:** 0, with dither on.

## Five things a recreation must get right

1. The glow is off center (L 0.95 at (839, 145–175)). Nothing left of x = 260 reaches L 0.88, and the left 120 px stay medium blue (#5D9FD6–#578ECC) down to the land.
2. The horizon is y ≈ 222 at the right edge, rises steeply over x 725–925, dips to a trough at y ≈ 330–345 over x 610–760, and sits at y ≈ 308–315 over x 435–490. The left ridge runs from (0, 290) to (330, 377).
3. Softness varies along the horizon: 36 px at the right edge, 32–42 px at x 435–585, 60–90 px in the trough, over 100 px on the upper-left diagonal.
4. The band between the white and the violet is saturated pink (#F4CFE7, h 339), not grey lilac.
5. The violet's hue shifts with depth: magenta-violet (h 309–314, C 0.18) on the right hill, then blue-violet, then navy (h 269) at y ≈ 570, down to #0E1036. The blue swell is present, and nothing is black.

## What would make it look like a stock or Instagram gradient

- A symmetric smile or sine-wave horizon, which reads as a vector wave wallpaper.
- One blur width along the whole horizon.
- A full-width white band instead of a blue left sky.
- A grey-lilac or muddy midpoint between white and violet (sRGB mixing, or linear mixing without the pink).
- Neon magenta over all the land. The left land is blue-violet and the bottom is navy.
- Pink climbing more than 40–80 px above the land.
- Grain, a vignette, or pure black.
