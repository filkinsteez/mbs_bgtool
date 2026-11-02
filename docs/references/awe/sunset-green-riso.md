# sunset-green-riso

Figma node 41:26 "image 50", target 925×1447 (no `-full` file), recipe hint `sunset.bands`.

## What the light is physically doing

This is a scan of a risograph print, not a photo. There is no light source, horizon or glow. The only light is the scanner lamp reflecting off the paper through semi-transparent ink, so lighter means less ink. The fill is a 567×1134 JPEG scan of three riso prints stacked one above the other (siblings: `sunset-blue-riso`, `sunset-pink-riso`), each running left to right. This tile is the top print turned 90° counterclockwise (the scan's right edge is the tile's top), a 301.5×471.7 px region enlarged 3.07× (Catmull-Rom). All fine detail is scan noise and JPEG blocks at 3× size. The riso screen is not resolved.

- Light end: the green thins out to paper over the top third. No dots or paper-white specks show. Coverage reads as a continuous tint, with faint 12-40 px patches where thicker ink is greener. The tint is more saturated and yellower than a halftone mix of paper and the full green (see Transitions). Either a yellow layer reaches the light end at low strength or thin green ink reads yellower. The scan can't tell which.
- Green to mustard: this reads as two ink layers cross-fading, with green thinning while mustard thickens, not one ink changing. The middle is lighter and duller than any blend of the two end colors, including one film of mixed ink. Lightness also changes before hue: from y 900 to 1240, L rises 0.106 while hue moves 19°; from 1240 to 1447, L rises 0.029 while hue moves 13°. That fits two separately graded layers with some paper showing where both are partial. The mustard's red channel is 5.3× the green's in linear light, so little green ink remains at the bottom.
- Paper: warm light grey. In the scan, the nearly bare paper just past the tile's top is #EBE9E9 (L 0.936). The tile's top rows (#E3E2DE) still carry a trace of tint.

## Structure

- Axis: vertical. The profile's 88.25° fit (R² 0.979) comes from a left-to-right lightness falloff of about 0.03 L, which darkens the bare paper too (top-left L 0.924, top-right 0.905; green floor 0.655 left, 0.630 right). Chroma and hue lines are nearly level.
- Three zones, no horizon line:
  - Paper-to-green ramp, y 0-505 (0-35%). L falls almost linearly (0.047-0.061 per 100 px) to y≈470, then flattens within about 50 px (3.5% of frame height). Beyond the top 12 px there is no flat paper: the frame cuts the ramp near where the ink ends.
  - Flat green floor, y≈510-900 (35-62%), with L within ±0.005.
  - Green-to-mustard ramp, y≈900 to the bottom edge (62-100%), still turning at the edge. In the scan it continues to #DBBA14 (h 96).
- 10-90% widths (x 300-625): top ramp 28% of frame height by L (y 56-460), 24% by chroma; bottom ramp 27% by L (y 956-1344), 31% by hue (y 949-1395), measured to the frame edge.
- Edge shape: bow ≤0.9% of frame height, waviness RMS 0.3-0.5% (4-7 px). The top ramp sits 1-2% lower on the left. The bottom ramp starts up to 6% higher on the left (hue below 128 at y 952 left, 1038 right) and ends level (hue below 104 at y 1391-1396 across all column bands).

## Color stops

Vertical axis, so position = y / 1447. Colors are means over x 300-625. The left edge is about 0.012 L lighter and the right edge about 0.012 L darker.

| pos | y | hex | color | L | C | h |
| --- | --- | --- | --- | --- | --- | --- |
| 0% | 0-12 | #E3E2DE | warm light grey paper | 0.913 | 0.006 | 96 |
| 15% | 220 | #B5C889 | pale yellow-green tint | 0.803 | 0.087 | 122 |
| 35-62% | 510-900 | #5FA225 | grass green, flat | 0.644 | 0.168 | 134 |
| 82% | 1180 | #A2B53E | dull yellow-green | 0.736 | 0.144 | 118 |
| 100% | 1447 | #CDBA23 | mustard | 0.781 | 0.155 | 101 |

Changes from the profile:
- Merged the 27% stop (#89B145, y≈389) and the 85% stop (#ACB842, y≈1234) into their ramps. They are knees, not separate colors: at the first, chroma growth slows; at the second, L stops rising fast while hue keeps turning.
- Replaced the first and last stops (#E7E6E3, #C9B422) with center values. They were taken at the corners, so they carry the lateral falloff.
- Added the 15% and 82% tints, because a linear-light blend between neighbors misses both.

## Transitions

Paper to green, through #B5C889: 10-90% is 28% of frame height. It is not a lighter bridge; L falls steadily. Chroma peaks on the floor, not inside the ramp. One hue appears only inside the ramp: yellow-green (h 108-123), yellower than both the near-neutral paper and the green (134). At L 0.803 the real color is C 0.087, h 122; a linear-light mix is C 0.050, h 133, and an sRGB mix is C 0.077, h 129. Through most of the ramp the real tint has 1.3-1.7× the linear-light chroma and a hue 7-14° yellower. sRGB and thin-ink-film mixes come closer in chroma but are still 3-11° too green. A two-color linear-light blend looks grey-green here.

Green to mustard, through #A2B53E: 10-90% is 27% (L) to 31% (hue) of frame height, measured to the frame edge. It is not lighter than both ends; L rises steadily from 0.644 to 0.781. Chroma dips to 0.143 at y≈1200-1250, below both ends (0.168, 0.155). At hue 118 (y 1180) the real color is L 0.736, C 0.144. A linear-light mix there is #99AC24 (L 0.707, C 0.153), an sRGB mix #9BAF24 (L 0.715), and one film of mixed ink L 0.721. So the middle is 0.015-0.03 L lighter and slightly duller than any mix. No extra hue appears. Hue falls steadily from 134 to 101, fastest at the bottom (7.5° per 100 px at y 1360-1440).

The profile's mixing checks hide both effects, because they compare each knee stop with its neighbor rather than with the real end colors. Its flag for a point lighter than both ends in the last transition comes from the last stop sitting at the darker bottom-right corner. In the center band, L rises all the way to the bottom edge.

## Softness and edges

There are no hard edges except the fold. The firmest edge is the shoulder at the bottom of the top ramp (y 470-520), where the straight ramp meets the flat floor over about 50 px. It is still soft, but visibly firmer than the rest. The frame cuts off the top ramp's start and the bottom ramp's end. Softness varies along each edge. The top ramp is about 10% wider on the left (C 0.03 to 0.16 over 401 px on the left, 362 px on the right). The bottom ramp is about 15% wider on the left (508 px vs 436 px), because its yellow starts earlier there.

## Grain and texture

- Strength: 1.03% of 255 overall (Oklab L×100 0.83). By zone, after a sigma-4 high-pass: paper 0.76, light tint 0.71, green floor 0.96-1.0, green to yellow-green 0.88, mustard end 0.60. The green has about 1.6× the mustard's grain.
- Size: half-correlation lag 2.2-2.4 px, so blobs are about 5 px at 925 wide (0.55% of the width). At scan resolution that is about 1.5 px: single scan pixels smeared by the 3.07× enlargement.
- Mono: 97-99% of the residual is lightness (chroma std about 0.09 ×100). It does not lean toward the ink colors and is symmetric (skew ≈ 0). It is scan noise, not ink coverage, dots or paper specks.
- Compression: the scan is a JPEG with 8×8 blocks (luma steps are 50% larger at block boundaries) and 4:2:0 chroma. In the target the blocks are about 24.6 px and show as stripe and checker patches in a high-passed crop. Chroma is stored at half resolution, and its pixel-to-pixel steps are about a tenth of the luma's, which is why the grain has no color.
- Coarse mottle (12-40 px) is weak (0.16-0.32 L×100) and barely visible. There is no banding.

## Highlights

There is no roll-off and no clipping; no channel reaches 255. The brightest 0.5% is #E7E7E2 (L 0.926), the paper at the top-left. The paper is the white point, about 8% below white in L. The darkest 1% is #56991E (L 0.615), on the right side of the green floor. Only the fold line (L 0.57) and one speck go lower. The whole frame sits within L 0.61-0.93, so it is low contrast.

## What to ignore

- Fold crease, manifest rect [0, 728, 925, 34]: a 2-3 px light ridge at y≈738-740 (+0.03 L) above a dark line at y≈744-746, with slightly lower chroma over y 736-756. The line is darkest at x 230-460 (about 57 luma code values below its surroundings), nearly gone at x 460-575, and moderate elsewhere.
- A dust speck at x 398-401, y 1246-1250 (about 5 px, 18 code values dark).
- JPEG 8×8 blocks (about 24.6 px in the target).
- The left-to-right falloff of about 0.03 L, paper included. It comes from scanner lighting or uneven ink across the drum, not from the light in the image. Leave it out of the recipe.

## Recipe and light model

Use `sunset.bands`, as the manifest says: three stacked bands (paper grey, grass green, mustard) with unequal edges around a flat middle band. There is no horizon line and no glow, so `sunset.ramp` and `sunset.blooms` don't fit.

Light model: flat bands of emitted color in linear RGB, blended along y only, with one bridge tint inside each transition. The two bridges depart from linear-light mixing in opposite directions: the top one is more saturated and yellower, the bottom one lighter and duller. No lens (bloom 0, halation 0). Tone: the paper band at nominal intensity encodes to #E3E2DE, and nothing reaches the white roll-off. Apply grain last at output size, then dither.

Starting parameters, as fractions of frame height:
- axis 90°; colors `#E3E2DE`, `#B5C889`, `#5FA225`, `#A2B53E`, `#CDBA23`
- paper center at -0.03 (just above the frame); bridge 1 at 0.15; green floor 0.35-0.62; bridge 2 at 0.815; mustard center at about 1.07 (below the frame, so the bottom is still turning)
- top edge: 10-90 width 0.28, L close to linear, ending in a 0.035 shoulder; bottom edge: width 0.30, with L leading hue by about 0.05
- warp: lowest frequency only. Top edge 0.01-0.02 lower on the left. Bottom edge starts 0.04-0.06 higher on the left and ends level. Waviness RMS ≤0.005.
- glow: none
- grain: mono, 1.0% of 255 (L×100 ≈ 0.85), blob about 0.55% of frame width (5 px at 925); ×1.2 in the green, ×0.9 on paper, ×0.7 in the mustard

## Five things a recreation must get right

1. Values: the top is paper grey #E3E2DE (L 0.91), never white. The flat green floor #5FA225 (L 0.644, C 0.168) runs from y≈510 to 900 (35-62%). Nothing is lighter than L 0.93 or darker than L 0.61.
2. Top ramp shape: L falls almost linearly from the top edge to y≈470 and lands on the floor within about 50 px (10-90% is 28% of frame height). There is no paper plateau at the top and no S-curve into the green.
3. Top ramp color: at y≈220 the tint is #B5C889 (h 122, C 0.087), yellower and 1.7× more saturated than a linear-light mix of paper and green. The light end looks yellow-green, not grey-green.
4. Bottom ramp: it starts at y≈900-950. L rises first, to about 0.75 by y 1240; then hue moves from 114 to 101 at nearly constant L down to the edge. The middle (#A2B53E, C 0.143) is duller than both ends, never a bright lime.
5. Surface: mono grain of about 1% of 255 in roughly 5 px blobs everywhere, strongest in the green, with no color speckle or dots. Band edges are soft and nearly level, the bottom ramp starts slightly higher on the left, and there is no seam or line.

## What would make it look like a stock or Instagram gradient

- Clean digital end colors: pure white at the top, lemon yellow (#FFE800, Bold #FFD61E) at the bottom, or a neon lime. The reference is paper grey, a muted grass green and a dull mustard.
- Three evenly spaced stops with no flat floor. Here the flat green covers 27% of the height, and the two ramps differ in shape.
- Smoothstep easing on both edges, which gives soft symmetric blobs. The reference ramp runs straight into a shoulder, and the bottom ramp runs off the frame.
- White to green in linear light without the yellow tint, which gives a washed-out grey-green light end (C 0.050 instead of 0.087 at L 0.80).
- A bright chartreuse between green and mustard, where the reference is at its dullest.
- No grain, or colored RGB noise.
- Glow, bloom or a bright horizon line. Nothing in this image emits light.
- Copying the fold, the JPEG blocks or the lateral falloff, which looks like a bad scan, not a print.
