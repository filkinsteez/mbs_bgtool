# sunset-blue-riso

Figma node 41:27 "image 63"; target 925×1447, no `-full` file; recipe hint `sunset.bands`.

## What the light is physically doing

This is a flat scan of a risograph print, not a photo. Nothing in the frame emits light: the scanner lights the paper evenly and two translucent inks filter what the paper reflects. The tile is the second of three prints in one scan, turned 90° counterclockwise and enlarged 2.93× (Catmull-Rom). It looks like a sky: bare paper at the top, cyan-blue ink getting denser downward, a dark slate band from about 41% down, lighter blue below.

The slate band reads as a second ink, not a darker shade of the blue. Its hue is 14-24° more violet (Oklab h 254-264 against 240) and its chroma less than half (0.048 against 0.115). At its top edge the two inks overlap in three steps (center columns):

1. y 550-584: the cyan darkens by about 0.03 L at nearly full chroma, as if the first thin dark ink were printed on full blue.
2. y 584-618: the cyan thins. Red rises from 74 to 113 (sRGB), which in a print means less blue ink over the paper, while the dark ink is still thin. The result is grey-blue #6F91B6 at the cyan's lightness (L ≈ 0.65, C ≈ 0.07).
3. y 623-678: the dark ink reaches full density; L falls to 0.46.

Below the band the dark ink fades out toward the bottom while the blue builds back; around y 1130, where both are partial, the color is grey lavender-blue #7C94B6 at L 0.66. Whether the blue runs at full strength under the band can't be told from the colors: a slate ink alone and a warmer second ink over full blue both fit the measured colors within a few 8-bit levels. The recreation doesn't depend on it.

How this differs from light: ink subtracts, so overlaps get darker and greyer, and a bright area never spills into a dark one. Light adds: overlaps get brighter, bright areas bloom outward, and a light mix keeps its saturation. At L 0.63 on the band's top edge, a linear-light or sRGB crossfade from #499ED4 to #475973 has chroma 0.104; the print has 0.058. Below the band at L 0.66 the crossfade gives 0.098, the print 0.058. The print changes chroma and lightness at different heights; a light mix changes both together.

## Structure

- Axis 90.25° (top to bottom), 1D fit R² 0.983. Iso-color lines are straight and level: bow 5 px, no visible curvature. The slate's top edge is level within ±2 px across eight column strips; the soft edges wander ±8-12 px, which is invisible at their 200+ px widths. No warp.
- Read as a sky, the horizon is the top of the slate band: greying centered at y 591 (40.8%), darkening at y 649 (44.9%).
- Layout: paper 0-4%, ramp to cyan centered at 16.7%, flat cyan 27-39%, slate edge 41-45%, flat slate 47-61%, lightening centered at 69%, grey lavender-blue near 78%, blue saturating toward the bottom (centered at 86%).
- Lateral drift: from the left edge to the right, L rises 0.016 on paper, 0.034 on cyan and 0.046 on slate, and the slate turns more violet (h 254 to 264). This is uneven ink and scan lighting.

## Color stops

| Position | y (px) | Hex | Color | L | C |
| --- | --- | --- | --- | --- | --- |
| 0-4% | 0-58 | #F3EFEC | warm paper white | 0.954 | 0.006 |
| 10.7% | 155 | #DBDFED | pale lavender | 0.905 | 0.020 |
| 15% | 217 | #C2D3EA | pale periwinkle | 0.861 | 0.037 |
| 27-39% | 390-565 | #499ED4 | cyan-blue | 0.670 | 0.115 |
| 42.3% | 612 | #6F91B6 | grey-blue | 0.645 | 0.068 |
| 47-61% | 680-880 | #475973 | slate navy | 0.460 | 0.048 |
| 78% | 1130 | #7C94B6 | grey lavender-blue | 0.660 | 0.058 |
| 100% | 1447 | #5CA2D5 | light blue | 0.687 | 0.104 |

Changes from the profile: I merged #6A97C1 (41.5%) and #708EAF (43.1%) into #6F91B6. Both lie on one corner where the chroma drop ends and the darkening starts; there is no flat grey band. The cyan is the flat-band median #499ED4 (profile #4D9CD2). The slate #475973 is the full-band mean; the profile's #495C77 is about 0.01 L lighter than the band's rows. I added #DBDFED (the profile's first midpoint) because the pale ramp is lavender (h 273), bluer than a straight paper-to-cyan mix at the same L (#DBE0E7). #C2D3EA and #7C94B6 are corners on a curve, not bands. At the left and right edges the slate is #3F546D / #52607B and the cyan #3D9AD2 / #56A1D7.

## Transitions

Widths are 10-90% in linear light, as % of frame height.

- Paper to cyan: 16.7% (y 113-354). No bridge; chroma rises steadily to its peak in the flat cyan. The only hue confined to a transition is here: pale lavender (h 270-325, C 0.005-0.02) at y 60-160. At L 0.808 the print (#A3C4E7, C 0.061, h 250) is slightly more saturated than both the linear-light mix (#A9C4DE, C 0.047, h 248) and the sRGB mix (#9FC7E0, C 0.055, h 236), with the linear mix's hue. The profile's two sub-transitions (7.3% and 9.5%) are one step in linear light.
- Cyan to grey-blue: 3.5% (y 558-609); the chroma drop alone is 2.8%. L stays within 0.03 of the cyan, so there is no lighter bridge. The profile's "midDarkerThanBoth" is the 0.03 L dip just above the grey.
- Grey-blue to slate: 3.8% (y 623-678; profile 3.3%). Chroma constant at 0.054-0.06.
- Slate to grey lavender-blue: 15.0% (y 884-1101; profile 13.8%). L 0.46 to 0.66 at nearly constant chroma (0.048 to 0.058).
- Grey lavender-blue to blue: 15.4% (y 1158-1381), slower at the end (85 px from 10% to 50%, 138 px from 50% to 90%). L stays 0.66-0.69 while chroma rises from 0.058 to 0.104 and hue turns from 257 to 242.
- The middle three midpoints match both the linear-light and sRGB mixes of their neighbors within 2 levels. The last one is 0.009 L lighter and slightly greyer (#759DC9 against #6E9BC6). There are no lighter bridges and no chroma peaks inside any transition.

## Softness and edges

- Hardest: the slate band's top, as two steps 57 px apart. The greying is 39-45 px wide; the darkening is 54-59 px in most column strips, up to about 70 px where the dark tail is slower.
- The band's bottom is about 4× softer: 213-250 px, widest in the middle columns (x 230-460).
- Paper to cyan: 231-247 px wide everywhere; its center sits 15-22 px lower on the right.
- The profile's −0.03 tilt for the lower fade comes from the right half being lighter and more violet, which moves a color-distance midpoint. Measured per column against each column's own end colors, the lightness midpoint stays at y 968-992 with no trend. Don't tilt it.

## Grain and texture

- Size: blobs about 4 px across at 925 px wide (half-correlation lag 1.9-2.0 px in x and y), about 1.4 px at the scan's resolution. This is the scan's pixel noise, softened by the enlargement. Round and roughly gaussian: in the slate, 3.0% of pixels are more than 4 L×100 above the local mean and 3.1% below.
- Strength: 1.74% of 255 overall (1.47 L×100), 99.6% in lightness.
- It follows ink density: paper 0.70 L×100 (0.9% of 255), cyan 1.25 (1.6%), light blue and grey lavender 1.5 (1.8%), slate 2.1 (2.3%). Roughly, % of 255 ≈ 0.9 + 1.5 × optical density, where density = −log10(luminance / paper luminance).
- A faint cloudy mottle at 20-60 px (0.1-0.3 L×100) shows with gain.
- The source's JPEG 8×8 blocks repeat every 23.4 px: column-to-column steps peak there at 7-11× the median of the spectrum, with a harmonic at 11.7 px. They show as faint rectangles in the paper. No banding.

## Highlights

There is no source, highlight or roll-off. The brightest area is bare paper #F3EFEC (L 0.954, warm). The brightest 0.5% is #F8F5F6 (L 0.973): grain peaks on the paper. Only 0.001% of pixels have a channel at 255, and none is white. The darkest 1% is #384B65 (L 0.408); two thirds of those pixels are in the left third of the slate, nearly all below the crease. There is no black: L spans 0.41-0.97, median 0.666.

## What to ignore

- The fold crease (manifest rect y 700-734): a 1-3 px hairline at y 715-720. It is dark (L −0.15 to −0.20) from x ≈ 300 to 660 and light (+0.05 to +0.11) from x ≈ 125 to 300. It sits about 40 px below the end of the darkening (y 678) and 65 px below its midpoint, so the edge figures above describe the ink, not the crease. The slate is 0.01-0.015 L darker just below the crease than above; render one flat slate.
- The JPEG block grid and the softness from the 2.93× resampling.
- The left-to-right drift: ink and scanner unevenness, optional for a 1:1 match.

## Recipe and light model

`sunset.bands` fits: six flat bands with soft, straight edges. One blocker: the recipe has one softness for all edges (plus random variation), and this reference needs σ from 0.014 to 0.065 per edge. With one value, either the slate's top comes out too soft or the fades too hard. `sunset.ramp` has the same single blur and would also round off the two-step top edge.

Light model: flat, even light, with band colors mixed in linear light (the measured sub-transitions match linear-light mixes within 2 levels). With no source, the glow, bloom, halation and roll-off rules don't apply; set the tone so the paper encodes to #F3EFEC and nothing is brighter. Apart from the 0.03 L cyan dip above the grey strip, no transition is darker than both sides, so the bridge rule holds. Build the grey corners as their own bands: linear-light mixing alone keeps the edges saturated, and a multiply blend would break "light adds".

Starting parameters (fractions of frame height from the top; edges are linear-light 50% points; σ = 10-90% width / 2.56):

- Bands: #F3EFEC, #499ED4, #6F91B6, #475973, #7C94B6, #5CA2D5.
- Edge / σ: 0.167 / 0.065, 0.408 / 0.014, 0.449 / 0.015, 0.690 / 0.058, 0.860 / 0.060.
- Horizon 0.408-0.449, angle 0, warp at most 0.002 (3 px), softness variation about ±10%.
- Glow: none. Lens: bloom 0, halation 0 (turn off the recipe's default bloom of 0.05).
- Grain: mono, 4 px blobs (0.45% of frame width), from 0.9% of 255 on paper to 2.3% on slate.
- Optional: +0.03 L left-to-right drift (+0.045 on slate), the 0.03 L cyan dip at y 550-584, and the lavender in the pale ramp.

## Five things a recreation must get right

1. The slate band's top is two steps. The cyan greys at constant lightness (C 0.115 to 0.068 at L ≈ 0.65, centered at y 591), then darkens to slate (L 0.65 to 0.46 over 55 px, centered at y 649). A thin pale grey-blue strip sits on top of the dark band.
2. The band is asymmetric. Its bottom fade (217 px) is about 4× softer than its top (55 px), and lightness returns before color: grey lavender-blue #7C94B6 near y 1130, with the blue's chroma back only in the last 20% of the height.
3. Edges are straight and level (the slate's top within ±2 px), and none is sharper than about 40 px.
4. Nothing glows. The brightest value is warm paper #F3EFEC (L 0.954), the slate stays at L 0.44-0.49 with no black, and the flat cyan #499ED4 is the most saturated area.
5. Grain is mono, about 4 px across, and follows the ink: about 0.9% of 255 on paper, 1.6% on cyan, 2.3% on slate.

## What would make it look like a stock or Instagram gradient

- Crossfading cyan straight into slate: the top edge turns into a saturated mid-blue (C ≈ 0.10 at L 0.6), the grey strip disappears, and it looks like a UI gradient.
- The same softness above and below the band, or a band that is just darker cyan (h 240) or near-black (L under 0.35). The real slate is greyer and more violet, at L 0.46 against the cyan's 0.67.
- Pure white at the top, a bright line along the band's top edge, or bloom.
- Clean ramps, 1 px digital noise, or grain of equal strength everywhere.
- A wavy or curved horizon added to look natural; this print's edges are straight.
- Saturated blue right under the band; the print stays grey lavender for about 250 px first.
