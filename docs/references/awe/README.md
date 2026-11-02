# Awe reference targets

Exact copies of what each moodboard tile shows in the Figma file `9TlfqUvSxIonSEgmcoHFfF` (Sunset 63:658, Contour 63:659, Warp Speed 63:660), for recreating them 1:1.

- Targets: `public/references/awe/<mood>/<id>.png`, 925 px wide, square corners. `<id>-full.png` is the same crop at the fill's own resolution when it has more than 925 px across.
- Manifest: `public/references/awe/manifest.json` (format in `artifacts/agent-context/SHARED.md`). Ignore rects are in pixels of the 925-wide target; scale them for `-full` files.
- Notes: `docs/references/awe/<id>.md`, a visual analysis of each Sunset and Contour reference.
- Profiles: `docs/references/awe/profiles/<id>.json` (numbers) and `<id>.png` (plot).
- Contact sheets: `contact-sunset.png`, `contact-contour.png`, `contact-warp.png`.

Reference images are visual targets only. Never sample their pixels into anything a renderer reads.

## Targets

"Source" is the Figma image fill the target is cut from. "Scale" is target px per source px.

| id | node | size | recipe | source | scale | full file | masked |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `sunset-sky-peach` | 41:14 image 39 | 925×1001 | sunset.ramp | fill 541×812, top 72% | 1.71 | - | - |
| `sunset-violet-wave` | 41:31 image 58 | 925×617 | sunset.ramp | fill 1200×800, whole | 0.77 | 1200×800 | - |
| `sunset-red-yellow-arcs` | 41:15 image 40 | 925×1370 | sunset.ramp | fill 600×750, region 437×647 at (82, 52) | 2.12 | - | caption text tops, bottom 10 rows |
| `sunset-blue-diagonal` | 41:22 image 41 | 925×1214 | sunset.ramp | fill 1200×1575, whole | 0.77 | 1200×1575 | - |
| `sunset-film-poster-bands` | 41:25 image 42 | 925×1296 | sunset.bands | fill 960×1345, whole | 0.96 | 960×1345 | poster title and credits (2 rects) |
| `sunset-green-riso` | 41:26 image 50 | 925×1447 | sunset.bands | fill 567×1134 (scan of 3 prints), print 1, turned 90° | 3.07 | - | paper fold |
| `sunset-blue-riso` | 41:27 image 63 | 925×1447 | sunset.bands | same scan, print 2, turned 90° | 2.93 | - | paper fold |
| `sunset-pink-riso` | 41:28 image 64 | 925×1447 | sunset.bands | same scan, print 3, turned 90° | 2.92 | - | paper fold |
| `contour-rim-edge` | 41:21 image 47 | 925×1644 | contour.rim | fill 1200×2133, whole | 0.77 | 1200×2133 | - |
| `contour-yellow-halo` | 41:23 image 57 | 925×1309 | contour.halo | fill 735×1040, whole | 1.26 | - | poster text; light last column |
| `contour-iridescent-rings` | 41:30 image 48 | 925×1233 | contour.halo | fill 1000×1333, whole | 0.925 | 1000×1333 | audience silhouettes |
| `contour-radial-streaks` | 41:19 image 62 | 925×617 | contour.beam | fill 735×490, whole | 1.26 | - | - |
| `contour-beam-pool` | 41:18 image 49 | 925×1850 | contour.beam | fill 736×1472, whole | 1.26 | - | - |
| `contour-light-line` | 41:20 image 51 | 925×1644 | contour.rim | fill 736×1308, whole | 1.26 | - | - |
| `warp-long-exposure-streaks` | 41:29 image 52 | 925×1645 | warp | fill 1013×1801, whole | 0.91 | 1013×1801 | - |
| `warp-refracted-column` | 41:9 image 53 | 925×1805 | warp | fill 1200×1658, region 600×1171 at (300, 329) | 1.54 | - | - |
| `warp-curved-spectral-bands` | 41:8 image 55 | 925×1156 | warp | fill 686×970, region 554×693 at (66, 139) | 1.67 | - | - |
| `warp-film-poster-columns` | 26:486 image 28 | 925×1295 | warp | fill 735×1029, whole | 1.26 | - | poster title and credits (2 rects) |

Every target comes from the raw image fill; none uses a screenshot. Warp Speed has targets only, with no notes or profiles.

## How the targets were made

1. For each tile, Figma MCP `get_design_context` gave the image fill and its placement: "cover" (scaled to fill the tile, centered) or an explicit crop box. The fills were downloaded with the MCP asset URLs, which are short-lived and are not stored in the repo.
2. `scripts/references/build-targets.mjs` cuts the visible region out of each fill and resamples it to 925 px wide with an exact affine map. It uses Catmull-Rom when enlarging and Mitchell when shrinking, the kernels that matched Figma's own rendering best.
3. Each target was compared with Figma's render of the tile at native size (`get_screenshot`), with the 30 px rounded corners left out. The mean difference is 0.07 to 1.24 levels of 255 and 99% of pixels are within 6 levels. Each pair was also checked by eye.

Details that matter:

- The three riso tiles crop one 567×1134 scan that holds three prints stacked vertically, each with its gradient running left to right. The tiles show each print turned 90° counterclockwise: the scan's right edge is the tile's top. Figma's code output drops that rotation (its crop box looks like a 2.45× vertical stretch); the rotated crop matches Figma's render to about 1 level. The riso nodes are also flipped vertically on the board, which is why their metadata y is the tile's bottom edge.
- `sunset-sky-peach` shows only the top 72% of its photo. The tile stops about 8 px above a thin horizon line; the sea reflection below it is not in the tile.
- Fills with fewer pixels than the tile are enlarged (scale > 1 in the table), so their fine texture is that much larger than in the source. The riso scans are enlarged about 3×.

To rebuild: download the fills into `artifacts/references-raw/<node>-fill.png` (and `<node>-shot.png` for the check), then run:

```
node scripts/references/build-targets.mjs
node scripts/references/profile.mjs
node scripts/references/contact-sheets.mjs
node scripts/references/summary.mjs
```

`scripts/references/references.mjs` holds the table above (tile sizes, fill placement, ignore rects). `scripts/references/crop.mjs` makes zoomed crops for inspection.

## Profiles

`profile.mjs` measures every target with the exact sRGB transfer curve and Oklab, averaging in linear light and leaving out ignore rects:

- the main gradient axis (best 1D fit), the curvature of the iso-color lines, and color stops from a simplified Oklab profile;
- per transition: 10-90% width, the midpoint against linear-light and sRGB blends at the same progress, lighter bridges, chroma peaks, and per-strip bow, tilt and waviness;
- row and column means (64 each), colors every 5% along the axis, and lateral spread;
- the brightest 0.5% and darkest 1%, and the share of pixels at 255 and at 0;
- grain: high-pass residual by lightness, mono share, and size from autocorrelation. Sunset also gets an along-iso-line version that removes the ramp and 8-bit banding;
- Contour glows: falloff perpendicular to the light on each side, fitted with sums of two and three gaussians and a power law, as fractions of the short side.

The notes correct the profiles where the eye disagrees. The axis stops for Contour and the diagonal sky are band averages that do not occur in the image, and the grain figures for the clean images measure JPEG blocks. Use the notes first and the profiles for detail.

## Observations across references

Grain

- Only the riso prints and the film poster have real texture. It is mono (96-99% in lightness).
  - Riso: 1.0-1.7% of 255 overall. It follows ink density: about 0.9% on paper and pale tints, 1.6% on cyan, 2.2-2.3% on slate and violet. Blobs are 4-5 px at 925 wide, from scan noise enlarged 3×, about 1.5 px in the scan.
  - Poster: 1.2% of 255 in about 1.5 px blobs, an aliased halftone screen.
- The skies and all Contour images have no grain: 0.06-0.4% of 255, all JPEG blocks (8 px in the source) and 8-bit steps.

Darks

- Sunset has no black.
  - The skies bottom out in saturated deep colors at L 0.19-0.38: crimson `#6D1E23`, navy `#0E0F33`, maroon `#742115`, deep blue `#0C357F`.
  - The poster's ink black is L 0.15. The riso prints stay above L 0.41, or L 0.61 for the green.
- Contour darks are pure `#000000` in the digital images: 46% of `contour-rim-edge` and 76% of `contour-light-line`. The photographic ones bottom out at blue-black L 0.09-0.11 (`#010209`, `#040406`).   `contour-yellow-halo` is high-key: its darkest 1% is Meta Blue `#0C6AE7` at L 0.55.
- Highlights never clip to white: no pixel in any reference is 255 in all three channels. The brightest 0.5% sits at L 0.71-0.97. Under 0.04% of pixels have any channel at 255, except the red channel of the warmest orange in `sunset-blue-diagonal` (2.8%).

Transition widths (10-90%, as a share of frame height)

- Sky photos: 12-40% for the main changes, tightening toward the warm or horizon end. `sunset-sky-peach` runs 32, 13, 14, 8, 6, 4%; `sunset-red-yellow-arcs` 22, 8, 18, 5, 13%.
- Poster bands: 58-175 px (4.5-13.5%).
- Riso: soft ramps of 15-30%, plus ink edges.
  - Blue riso slate band: top 3.8% (55 px), bottom 15% (217 px).
  - Pink riso orange band: top 6.7%, bottom 0.75% (11 px). The pink riso bottom edge is the one hard edge in the Sunset set.

Lighter bridges

Where two distant hues meet in the light references, the middle is a pale, desaturated color that is lighter than a blend of the two ends.

- `sunset-sky-peach`: blue to peach crosses a neutral grey `#B0B1B1` (C 0.001) at 39%. It is 0.011 L lighter than any blend of the two; a linear-light blend gives faint mauve. The brightest band is a flat pale peach at 56% (L 0.80).
- `sunset-red-yellow-arcs`: cream `#ECE07A` (L 0.896) is lighter than the yellow (0.878) and the light blue (0.836). Its blend into the blue is a pale mint-grey `#C6DFC1`.
- `sunset-blue-diagonal`: blue meets warm through near-white grey `#D4CECE` on the bright side, 0.002-0.018 L lighter than linear light, with no dip.
- `sunset-violet-wave`: a warm-white glow `#F2EFEA` (L 0.95) sits off center, with a saturated pink band `#F4CFE7` between it and the violet.
- `sunset-film-poster-bands`: grey to red passes through tan-salmon `#8F6252`, 0.028 L lighter and 0.039 less saturated than linear light.
- The riso prints subtract ink, so their bridges come from paper showing through where both inks are partial. The pink riso's salmon zone (L 0.71) is lighter than both neighbors. The blue riso greys at constant lightness before its dark band.

Glow widths in Contour (fractions of the short side S; S is 925 px except 617 px for `contour-radial-streaks`)

- Cores are hard or near hard.
  - Ring rims and the rim edge go from peak to under 10% within 1-5 px on the outside.
  - The light line is a constant 5.3 px bar (0.006 S).
  - The beam's pool line is a 2-3 px step.
- Inner and side falloffs:
  - Rim edge: inside, half at 0.009 S and 10% at 0.02 S. A faint wide fill stays inside the object.
  - Rings: 10% at 0.025-0.08 S inward, depending on the ring.
  - Light-line glow, bottom third: two or three gaussians at about 0.0025, 0.033 and 0.058 S, with the half-width growing linearly down the frame from 37 to 215 px.
  - Streaks' horizon line: 3.7, 16.6 and 37.8 px.
- Outside halos are faint: 1-5% of the peak, gone by about 0.1 S. There is no wide bloom or halation in any Contour reference.
- Large soft lights have no long tails.
  - Beam: a flat-topped column of half-width 0.16 S with σ 0.05-0.09 S shoulders.
  - Yellow halo band: falls halfway in 0.18-0.22 S toward the sky and 0.04-0.09 S toward the disc.

Where the references differ from the brief

- Hard outer edges: `contour-rim-edge` and `contour-iridescent-rings`.
- More than one light, and one complete ring: `contour-iridescent-rings`.
- An object silhouette and face: `contour-rim-edge`.
- Text: `contour-yellow-halo`, `sunset-film-poster-bands`, and the bottom rows of `sunset-red-yellow-arcs`.
- People: `contour-iridescent-rings`.

A 1:1 preset has to reproduce the hard edges and the extra lights; whether production presets soften them is the owner's call.
