# Rings and edges of light that read as light, not as objects

Why this note: in the first side-by-side review (2026-11-02, round 01), `contour.halo` read as a planet seen from orbit in half of its seeds, and the corner seeds of `contour.rim` read as the corner of a phone or tablet. This note collects what real rings of light look like, and what makes the eye see a solid object instead, and turns both into rules for the two looks. It adds to [`lens-glare-halation.md`](lens-glare-halation.md) and [`light-art.md`](light-art.md), which cover glow shape, halation and edges without corners.

## Short answer

- A thin bright curve with its light falling off only on the inside, over a disc that is lighter than the ground, is how a backlit sphere looks. The eye takes the curve as the outline of a convex solid and gives the edge to the disc. That is the planet.
- Rings of light in the sky do the opposite. A 22° halo is darkest inside its circle, brightest just at the circle, and fades outward over a long distance. A corona is a glow centered on the light itself. Neither has a filled disc.
- The look's own reference, `contour-yellow-halo`, has the halo layout: its yellow crest sits outside the disc's edge, falls halfway to the sky in 170 to 200 px outward and only 38 to 80 px toward the disc (at 925 px wide).
- In both sky phenomena the color changes with distance from the edge: the 22° halo's inner edge is red, then orange and yellow, and the rest washes out toward white; a corona's aureole is bluish-white and turns reddish-brown at its edge. That is per-channel falloff, which the engine already supports.
- An outline that is evenly lit along its whole length closes into a shape. Light that fades 10 to 100 times along the edge, as in `contour-rim-edge`, leaves the shape open.

## The 22° halo

From Les Cowley's Atmospheric Optics ([22° halo formation](https://www.atoptics.org.uk/halo/circ1.htm), ["Disk with a hole" in the sky](https://www.atoptics.org.uk/halo/circ2.htm)) and [Wikipedia: 22° halo](https://en.wikipedia.org/wiki/22%C2%B0_halo):

- Ice crystals in thin cloud refract sunlight through two faces at 60° to each other, which deflects it by 22° to 50°. Most rays cluster near the smallest deflection, about 22°, so "the 22º halo extends from 22º out to 50º - a disk with a hole - but it is brightest at the inner edge".
- "Rays deviated more strongly produce the outer halo light which fades away with increasing angular distance from the sun until it is undetectable."
- "No light is refracted through smaller angles and so the area inside the halo is dark - a 'hole in the sky'."
- "Red light is refracted less strongly than other colours and so the halo's inner edge is red hued sometimes tapering away through oranges and yellows to blue. All but red are indistinct and washed out because they overlap considerably."
- Its radius is about 22°, roughly an outstretched hand at arm's length.

The profile across the ring: dark inside, a fairly sharp rise at the circle, a peak just outside it, and a long fade outward. The sharp side faces the center, and the light lies on the far side of the edge from the center.

## The corona

From [Atmospheric Optics: Coronae](https://www.atoptics.org.uk/droplets/corona.htm) and [Wikipedia: Corona (optical phenomenon)](https://en.wikipedia.org/wiki/Corona_(optical_phenomenon)):

- Thin cloud in front of the sun or moon diffracts its light into a bright central aureole, "almost white and fringed with yellows and reds", sometimes with fainter rings around it.
- The rings are "bluish on the inside grading through greens and yellows to red outermost. The colours are subtle mixtures rather than the more direct hues of the rainbow." A corona can be about 15° across and "shrinks and swells as different clouds scud across the moon".
- Seen alone, the aureole is "a bluish-white disk which fades to reddish-brown towards the edge". The brightness follows an Airy pattern; smaller droplets give a larger corona.

A corona is a glow centered on the light, with a warm fringe where it fades out. It has no edge to own.

## Why a lit disc reads as an object

- **Outlines imply solids.** [Koenderink (1984)](https://doi.org/10.1068/p130321) showed that the curvature of an object's outline tells the eye about its surface: "convexities are due to local ovoid shapes". A convex arc with light shading inside it is read as the edge of an egg-like solid.
- **Every edge is given to one side.** [Zhou, Friedman and von der Heydt (2000)](https://doi.org/10.1523/JNEUROSCI.20-17-06594.2000) found cells in visual areas V2 and V4 that signal which side an edge belongs to: "the same light-dark edge could be the left side of a dark square or the right side of a light square". The signal depends on the display far beyond the edge itself and appears within 25 ms. A closed, convex region that differs from its surround takes the edge and becomes a figure.
- **Figures glow easily, as objects.** [Bonato and Cataliotti (2000)](https://doi.org/10.3758/BF03205554): regions seen as figures, or as small, start to look self-luminous at lower luminance than regions seen as ground. A filled disc will look like a glowing object, a lit planet, rather than like loose light.
- **Ramps make light.** [Zavagno and Caputo (2001)](https://doi.org/10.1068/p3009): luminance ramps around a patch make it look self-luminous, and the ramp needed grows linearly with the background's luminance (already used in `lens-glare-halation.md`).

So a lit curve on a dark ground reads as light, and not as an object, when:

1. the brighter side is not a filled convex region;
2. light spreads past the curve into the dark side, as a ramp;
3. brightness and width change along the curve, so the outline does not close.

## Rules for `contour.halo`

1. Put the light outside the circle. The crest sits just outside the circle's edge; the outward falloff is long (half in about 0.18 to 0.22 of the short side, the yellow-halo's numbers) and the inward one short (about 0.04 to 0.09).
2. Keep the inside of the circle at the base level, or slightly darker than outside, like the halo's "hole in the sky". Never fill it with the rim's color.
3. The inner side is the sharpest part. Let the color change with distance from it: the most saturated pack color at the inner edge, paler and whiter outward (per-channel widths, red or the warm channel narrowest).
4. Keep brightness and width changing along the arc. In the yellow-halo the crest sits 120 px outside the edge at the lower left and 52 px at the right edge, its inner flank narrows from 120 to 58 px, and its color goes from `#FDF6A3` to `#F4F2C1`.
5. One arc per image, with the circle's center off-frame (the brief's "a halo cropped by the frame so it never reads as a full circle").

## Rules for `contour.rim`

1. Show a corner only when its vertex sits at or past a frame edge. Never both full edges and the corner in frame.
2. Let brightness fall by 10 to 100 times along the edge away from the hot spot (`contour-rim-edge`: about 100 times from the corner to the bottom-left), so the far parts fade out and the outline stays open.
3. Light inside the shape stays near the hot spot and fades with it (`light-art.md`: light inside a slab spreads from where it enters). No even fill.
4. Meta logo crops: at most one of the crossing, the left loop's top arch and the right loop's top arch may be in frame. Together they are the mark's identifying features, and the eye completes the rest of the outline from them (the same closure as rule 1).

## How the compare agent checks it

In each round's sheets, a frame counts as "reads as an object" when a filled convex region with a lit edge covers more than about a quarter of the frame, or when an outline is evenly lit all the way from frame edge to frame edge. Round 01: halo seeds 1, 2 and 4, rim seeds 1, 4 and 5 (`artifacts/compare/rounds/01/crops/halo-seeds.png`, `rim-seeds.png`).

Round 02: no halo or rim corner seed reads as an object. Two new cases go the other way:

- The halo, with its inside now at the base level, has no defined edge on either side, so it reads as a smudge rather than a ring (rule 3).
- A small Meta logo crop with the crossing and both loop tops (Bold 16:9 seed 15) reads as the mark itself (rule 4).

See `artifacts/compare/rounds/02/crops/halo-seeds.png` and `logo.png`.

## Sources

- Les Cowley, Atmospheric Optics: [22° Halo Formation](https://www.atoptics.org.uk/halo/circ1.htm), ["Disk with a hole" in the sky](https://www.atoptics.org.uk/halo/circ2.htm), [Coronae](https://www.atoptics.org.uk/droplets/corona.htm).
- Wikipedia: [22° halo](https://en.wikipedia.org/wiki/22%C2%B0_halo), [Corona (optical phenomenon)](https://en.wikipedia.org/wiki/Corona_(optical_phenomenon)).
- Koenderink, J. J. (1984). What does the occluding contour tell us about solid shape? *Perception* 13. [doi:10.1068/p130321](https://doi.org/10.1068/p130321)
- Zhou, H., Friedman, H. S., and von der Heydt, R. (2000). Coding of border ownership in monkey visual cortex. *Journal of Neuroscience* 20(17), 6594–6611. [doi:10.1523/JNEUROSCI.20-17-06594.2000](https://doi.org/10.1523/JNEUROSCI.20-17-06594.2000)
- Bonato, F., and Cataliotti, J. (2000). The effects of figure/ground, perceived area, and target saliency on the luminosity threshold. *Perception & Psychophysics* 62(2), 341–349. [doi:10.3758/BF03205554](https://doi.org/10.3758/BF03205554)
- Zavagno, D., and Caputo, G. (2001). The glare effect and the perception of luminosity. *Perception* 30. [doi:10.1068/p3009](https://doi.org/10.1068/p3009)
- Reference notes: [`contour-yellow-halo.md`](../../references/awe/contour-yellow-halo.md), [`contour-rim-edge.md`](../../references/awe/contour-rim-edge.md).
