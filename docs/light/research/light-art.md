# Light art: how artists blend colored light

How light artists mix colored light, what the light actually does in their work, and what the renderer takes from it. This adds to [`research-artists.md`](../research-artists.md), which covers Lieberman, Turrell, Eliasson, McCall, Rothko, Sugimoto and Blake; they appear here only where there is something new.

How this was checked: every link was opened on 2026-11-02. A few sites refuse scripted requests; for those, archived copies on the Wayback Machine were read and are linked as "archived". Quotes are verbatim. "Photo (viewed)" lines describe installation photos that were downloaded and looked at; they are our descriptions, not quotes. Statements marked "Physics" are standard optics added by us, not claims by the artist. Reference IDs are the ones in [`BRIEF.md`](../BRIEF.md); measured numbers come from the reference notes in [`docs/references/awe/`](../../references/awe/).

Main findings:

- Where colored lights overlap, the artists get a lighter, paler color, never a darker one. Red and green walls meet in yellow (Cruz-Diez), pink and yellow tubes fill a room with orange (Flavin), red, green and blue light in fog meets in cyan, magenta and yellow, then white (Eliasson). The overlap comes from both lights reaching the same place at full strength, not from one fading out as the other fades in.
- The brightest part of a colored light reads almost white, and the color is in the spill around it. Flavin's green tubes "appeared to be empty of almost all color" in a green room. Our Contour references show the same: chroma peaks a few pixels into the falloff, not on the core.
- Edges disappear when nothing in the light changes abruptly. Wheeler curves the corners of his rooms, Pashgian tapers her lenses so the color "goes to nothing" at the edge, and Irwin overlaps four soft shadows so no single outline exists.
- Depth of color follows how much material the light crosses: resin wedges go from nearly clear to nearly opaque (Alexander), and a concave disc is deepest at its thick rim (Valentine). The sky does the same with air, which is why sunset colors crowd together near the horizon.
- Haze makes light visible in the air and lowers contrast with distance (Janssens). Without haze, light shows only where it lands (Flavin).
- Measured sky light is pale. Finch rebuilds measured sunsets with dozens of filtered tubes whose light adds up to a pale, nearly white glow.

## Dan Flavin

What he made: from 1963 to 1996, works made only of standard fluorescent tubes. "He confined himself to a limited palette (red, blue, green, pink, yellow, ultraviolet, and four different whites) and form (straight two-, four-, six-, and eight-foot tubes, and, beginning in 1972, circles)" (National Gallery of Art). Corner pieces such as *pink out of a corner (to Jasper Johns)* (1963), barriers and corridors, and whole buildings: *untitled (Marfa project)* (1996, Chinati), where "Each fixture holds two differently colored bulbs shining in opposite directions" in pink, green, yellow and blue, and Richmond Hall at the Menil, where "pink, yellow, green, and blue, and ultraviolet fluorescent lamps line the perimeter of the 6,400-square-foot space."

How the light behaves:

- Overlaps add up toward white. In *untitled (to Henri Matisse)* "pink, yellow, blue, and green lights mix to produce an ambient white light" (NGA). In Ottawa in 1969, in *Alternating Pink and Yellow (to Josef Halmy)*, "From these two colors, orange emerged, flooding the room entirely from floor to ceiling." Seen from the white room before it, the orange room looked "pale orange"; seen after the green room, it "appeared as a deep red rose volume, at least until the eyes re-adjusted" (Marianne Stockebrand, 1996 lecture at Dia, published by Chinati).
- The tubes look nearly colorless while the room carries the color: "Although the room was pervaded by green light, the light-providing tubes appeared to be empty of almost all color" (Flavin's 1969 Ottawa catalogue, quoted by Stockebrand). "Green is the most brilliant fluorescent light, and its intensity can be so strong that it almost appears white" (NGA).
- Each color reaches a different distance: "Red is an intense color but its reach is short. Conversely, both green and pink project greater distances, blue somewhat less. Yellow radiates even less, but its tubes keep their intense color while green, pink and blue appear pale" (Stockebrand). Red is dim because "no mixture of phosphors can make a true red, the inside of the tube must be tinted, which in turn blocks the amount of emitted light" (NGA).
- Flavin balanced colors by amount of light. In a 1975 corner piece the two horizontal tubes are pink, two verticals blue and four green: "Flavin increased the green, which by nature is the most intense color of all, thus making green occupy a large area of the corner, dominating the blue" (Stockebrand).
- In clear air the light is invisible until it lands: "color becomes visible only when it touches a reflecting plane, such as a wall, a floor, the ceiling, furniture or people" (Stockebrand). Fluorescent light "creates a soft-bordered area of color" that fades out with no visible boundary.
- Spill tints the main color. In a corridor barrier "green on one side, yellow on the other", a gap at the wall "permits a glimpse of the reverse color so that the primary color is tinged by the effects of the light spilling in from the back" (NGA).
- Photo (viewed), two Chinati corridors: the tube cores read pastel or nearly white. The strongest color is a narrow glow on the wall right beside each barrier. Farther surfaces show the sum as a pale tint: a blue and a yellow barrier give a pale lavender-white ceiling, and pink, green, yellow and blue together give a warm cream room. No overlap zone is darker or greyer than its sources.

Photos: [Chinati, *untitled (Marfa project)*](https://chinati.org/collection/dan-flavin/), [Menil, Richmond Hall](https://www.menil.org/campus/dan-flavin-installation-at-richmond-hall). Text: [Stockebrand, "Pink, Yellow, Blue, Green & Other Colors in the Work of Dan Flavin"](https://chinati.org/related_reading/pink-yellow-blue-green-other-colors-in-the-work-of-dan-flavin-by-marianne-stockebrand/), NGA 2004 retrospective, ["Hardware"](https://web.archive.org/web/20100602050505/http://www.nga.gov/exhibitions/2004/flavin/hardware/hardware.shtm) and ["Light, Space, and Architecture"](https://web.archive.org/web/20100602050153/http://www.nga.gov/exhibitions/2004/flavin/light/light.shtm) (archived; each runs over several pages).

What we take:

- Rule: the core of a light goes pale and its falloff keeps the color. Let the tone curve whiten the core, and keep the falloff below nominal so it stays saturated. Test: on every Contour render the highest chroma sits inside the falloff, not on the core. `contour-rim-edge` measures C 0.036 on the core and C 0.125 at 13.5 px inside; `contour-iridescent-rings` has near-grey lines (C 0.005 to 0.04) and C about 0.08 deeper in.
- Rule: set the reach of a light in luminance, not in RGB gain. At the same gain, a pack color's visible reach depends on its luminance (Meta Blue Y 0.145, Orange-red 0.269, Yellow 0.694, Lime 0.789). With an r⁻² tail, a Yellow glow stays visible about 2.2 times as far as a Meta Blue glow (√(0.694 / 0.145)). Parameter: scale each light's tail width from its color's luminance, so Intensity means the same visible reach in every pack. Scale the width, not the peak: raising the peak of a dark color pushes it past nominal and the tone curve turns it white. Test: render one glow per pack color at the same Intensity over the same base and compare the radius where luminance falls to a fixed level above the base (for example Y + 0.005); the radii should agree within 10% unless a preset asks otherwise.
- Test: two wide, overlapping lights of neighboring pack colors (Yellow and Orange-red in Bold) give a lighter orange-peach where they overlap, never brown.
- Audit rule: the eye adapts to a dominant color (after the green room, Flavin's orange room looked rose). Judge bridges by their Oklab numbers and side by side with the target at the same size, not by eye after looking at a saturated render.
- Informs `contour-light-line`, `contour-rim-edge`, `contour-iridescent-rings`, and the overlaps in every Sunset recipe.

## Carlos Cruz-Diez

What he made: *Couleur Additive* (from 1959), *Physichromie* (1959–2019), *Induction Chromatique* (1963), *Chromointerférence* (1964) and *Chromosaturation* (1965). The Physichromies are "colored strips of cardboard, aluminum, or Plexiglas assembled in two interspersed levels: one flat, one raised" (BOMB, 2010). "The Chromosaturation (1965) is an artificial environment composed of three colored chambers, one blue, one red and one green that immerse the visitor in a completely monochrome situation" (artist's site). The 1969 Paris version had "22 electrically lit cabins composed of red, blue, and green Plexiglas walls" (BOMB).

How the light behaves:

- Light reflected between the strips makes colors that are painted nowhere. A Physichromie gathers light between "a series of color frames ... generating new ranges of colors not present on the support. Thus, the color fills the space confined between the vertical sheets" (artist's site). Tate Papers describes the first step, *Additive Yellow* (1959). It follows Edwin Land's projection experiment, which made "a third colour appear between them without it being physically there"; the yellow is "formed by two lines of green and red". The later works combine "colour addition, reflection and subtraction".
- A hard contact between two flat colors shows a line that is not there: "When one plane of color touches another, a darker vertical line appears at the point of contact. This virtual line in fact contributes a third color that is not in the support" (artist's site, *Couleur Additive*).
- Crossing beams change each other: in the projected *Chromointerférence* environments, "rays of colored light ... intercept each other in space, causing them to change their hues" (artist's site).
- Photo (viewed), the lead photo of Arte al Día's article on the PAMM Chromosaturation: where the light of the red chamber and the light of the green chamber both reach the white wall, the wall runs salmon, orange, yellow, yellow-green, green. The yellow strip is the brightest part of the photo. A box hanging in the green chamber but lit from the red side is orange.

Photos: [Chromosaturation (artist's site)](https://cruz-diez.com/works/chromosaturation/), [Arte al Día on PAMM's Chromosaturation](https://www.artealdia.com/News/CARLOS-CRUZ-DIEZ-CHROMOSATURATION-AT-PAMM), [Physichromie (artist's site)](https://cruz-diez.com/works/physichromie-1959-2019/). Text: [Couleur Additive](https://cruz-diez.com/works/couleur-additive/), [Chromointerférence](https://cruz-diez.com/works/chromointerference/), [Tate Papers no. 32, Natalia Sassu Suarez Ferri](https://www.tate.org.uk/research/tate-papers/32/carlos-cruz-diez-physichromies), [BOMB interview, 2010](https://bombmagazine.org/articles/2010/01/01/carlos-cruz-diez/).

What we take:

- Rule: make neighboring lights overlap; don't cross-fade them. In the chamber doorway both lights reach the wall at full strength, so the bridge is their sum and brighter than either. A cross-fade whose weights sum to 1 can only give a linear mix. Parameter: an overlap gain at each band or light boundary that lets the weights sum above 1 there (1 is a plain cross-fade). Tests from the references: in `sunset-red-yellow-arcs` the cream (L 0.896) is lighter than the yellow above (0.878) and the blue below (0.836); in `sunset-pink-riso` the salmon pink (L 0.712) is lighter than the magenta (0.665) and the orange (0.652); in `contour-iridescent-rings` the mauve lens is lighter than either glow.
- Rule: a hard edge between two flat fields shows an extra line. Keep hard edges only where a reference has one (the straight lower edge of the orange band in `sunset-pink-riso`, the outer edge of `contour-rim-edge`); everywhere else, every edge has a measurable width.
- Informs `sunset-red-yellow-arcs`, `sunset-pink-riso`, `sunset-violet-wave`, `contour-iridescent-rings`, and the Bold pack's Cyan–Yellow pair (adding them gives mint; see [`research-techniques.md`](../research-techniques.md), section 2).

## Robert Irwin

What he made: discs (1966–69), scrim installations (from 1970) and cast acrylic columns (1969–71). The Whitney's 1977 catalogue lists "Untitled disc painting, 1966-67 Acrylic paint on aluminum, 60 inches diameter" and "Untitled disc painting, 1969 Acrylic paint on cast acrylic, 54 inches diameter". The Art Institute of Chicago's 1969 disc "comprises a single, spray-painted, convex plastic disk, cantilevered 12 inches from the wall. Four lights are angled toward the disk to produce a diaphanous array of overlapping shadows. These seem to merge with the painting's radiant core". Scrims include *Scrim veil—Black rectangle—Natural light* (Whitney, 1977; 144 × 1368 in., lit by the gallery's large window) and *untitled (dawn to dusk)* (Chinati, 2016), where "transparent scrim walls are stretched taut from floor to ceiling in black or white respectively, bisecting each long wing and capturing the always-changing natural light."

How the light behaves:

- The discs "meld object, shadows, and architecture into one coherent expanse" (Guggenheim). Irwin, in the 1977 catalogue: "I then questioned the frame as containment, the edge as the beginning and end of what I see."
- Photo (viewed), the AIC disc: four soft circular shadows, one per lamp, overlap in a four-leaf pattern on the wall. Where the clear disc gathers light there is a bright core. The disc's own outline cannot be found; only a thin dark horizontal band across the middle reads as a solid thing.

Photos: [AIC, *Untitled* (1969)](https://www.artic.edu/artworks/31595), [Chinati, *untitled (dawn to dusk)*](https://chinati.org/collection/robert-irwin/), [Whitney, *Scrim veil—Black rectangle—Natural light*](https://whitney.org/exhibitions/robert-irwin). Text: [Whitney 1977 catalogue (Internet Archive)](https://archive.org/details/robertirwin00irwi), [Guggenheim, *Singular Forms* (archived)](https://web.archive.org/web/20121112012705/http://pastexhibitions.guggenheim.org/singular_forms/highlights_7a.html).

What we take:

- Technique: build an edgeless halo from two to four soft copies of one shape, offset in different directions and added in linear light, with a brighter core where they all overlap. The single edge dissolves into several overlapping soft edges.
- Rule: no frame. Don't darken or fade toward the canvas edges; structure runs off the frame (Contour's off-frame source, Sunset's full-width structure).
- Test: measure a halo's 50% contour and its edge width at five points along the arc; both should vary. `contour-yellow-halo` goes from a band 120 px outside the edge with a 120 px inner flank at the lower left to 52 px out with a 58 px flank at the right edge.
- Informs `contour-yellow-halo`, the production version of `contour-iridescent-rings` (one ring, cropped, with a softer outer side), and `sunset.blooms`.

## Doug Wheeler

What he made: *Encasements* (1968–69), "broad, reflective acrylic panels that are 90½ by 90½ inches, upon which the artist sprayed lacquer. When lights embedded along the edges of the panels hit them from the side, color spreads dimensionally" (ARTnews, 2016). The materials of one are "Vacuum-formed acrylic, sprayed lacquer on acrylic, electronic transformer, and fluorescent blue neon" (David Zwirner). Rooms built with "coved plaster walls", for example *Untitled (Environmental Light)* (1969: "Steel, coved plaster walls, acrylic paint, nylon scrim, and daylight neon light"). *LC 71 NY DZ 13 DW* is a dome about 20 m across and 8 m high, "inspired by the artist's life-long experience as a pilot and his perception of the horizon and vault of the sky", where "you will see the light change almost imperceptibly along the 'horizon'" (Copenhagen Contemporary).

How the light behaves:

- The light starts at a hidden edge and spreads inward over the lacquered panel. "The corners of the spaces have been curved", so visitors notice only "the diffuse colors of the individual pieces and the way they project into the dim spaces they occupy" (ARTnews).
- On color, Wheeler says "Most people don't see the gray"; the interviewer adds that he'll "mix cool white against violet with a bit of blue" (ARTnews).
- Photo (viewed), a blue neon *Encasement* in the ARTnews piece: a thin square of light with a white core and a long pale-blue halo; the whole room is tinted blue; the curved corners show no seam; there is a soft pool on the floor below.

Photos: [ARTnews interview, 2016](https://www.artnews.com/art-news/artists/beginning-to-see-the-light-doug-wheeler-on-his-immaculate-encasements-show-at-david-zwirner-5811/), [David Zwirner](https://www.davidzwirner.com/artists/doug-wheeler), [Copenhagen Contemporary](https://copenhagencontemporary.org/en/doug-wheeler/).

What we take:

- Rule: no corners in a falloff. Where the slope of brightness changes suddenly, the eye sees a line (Mach bands), which is what Wheeler's curved corners avoid. Use falloffs and ramps whose slope is continuous. Test: plot Oklab L and its slope along each profile; the slope must have no corners wherever the reference has no hard edge (check at 8× gain).
- Model for `contour-rim-edge`: an edge-lit panel. Light enters at the boundary and spreads into the face, so the rim glow is inside only with a hard outer edge, as the reference note measures (outside, the light drops to 1–2% within one pixel).
- Sunset: changes along the horizon are slow. Brightness changes across the width by a set ratio, with no local features: `sunset-sky-peach` is about 1.4 times brighter at the right edge, `sunset-blue-diagonal` about 3.3 times brighter at the left.
- Atmospheric pack: Ice, Steel and Slate are the grays Wheeler means; a light can be Ice with a little Meta Blue.
- Informs `contour-rim-edge`, `contour-beam-pool`, `sunset-sky-peach`, `sunset-blue-diagonal`.

## Helen Pashgian

What she made: cast polyester and epoxy spheres from the 1960s; twelve molded-acrylic columns for LACMA's *Light Invisible* (2014), made by heating acrylic sheets "until they became soft, like fabric" and wrapping them around wooden molds (LACMA); and cast epoxy, later urethane, "lenses" from about 25 inches to 5 feet across.

How the light behaves (her words, Brooklyn Rail, 2020):

- The lenses "taper to a very sharp edge at the perimeter. The lenses have one or two colors embedded, or cast, into the urethane; and the colors radiate out evenly from the center. The idea is that the color goes to nothing at the ultra-thin perimeter edge. And if the lens is formed correctly, you should see just the color in space, with the edge essentially disappearing".
- The color is poured into every layer "so that it radiates evenly out from the center and ultimately dissolves into nothing at the edge." Of the small lenses, "60 or 70 have gone into the dumpster, usually because the color was too powerful and too strong, and there was no way it could diminish properly at the edge."
- Dimming shrinks the color: "As the light diminishes on the piece, the color contracts and becomes sufficiently dim as to almost totally disappear." Some viewers "see the color expand and fill the entire wall."
- Color painted onto a clear lens failed: "It was on the surface and it looked like it was on the surface".
- The columns "reveal their internal forms only on close inspection, seeming to hover above the floor as they focus, reflect, and refract light" (LACMA).
- On "edges that glow": Pashgian aims for the opposite; her edge is meant to vanish. Valentine and Eversley, below, show the case where color and light gather at a thick rim.

Photos: [Brooklyn Rail interview](https://brooklynrail.org/2020/02/art/HELEN-PASHGIAN-with-Michael-Straus), [LACMA, *Light Invisible* (archived)](https://web.archive.org/web/20230320192919/http://www.lacma.org/art/exhibition/helen-pashgian-light-invisible).

What we take:

- Rule: a falloff must reach zero with zero slope. A glow cut at a radius, or a kernel that ends abruptly (a smoothstep to zero at a fixed radius, a clamp), shows an edge as soon as it is bright enough. Use long, smooth tails: sums of gaussians or power-law tails.
- Test (Pashgian's dimmer): render a halo at Intensity 0.25, 0.5, 1, 2 and 4. The radius where it falls below 1/255 must grow smoothly with Intensity, and no ring may appear at any level (check at 8× gain). A small region with too strong a color fails this the way her rejected lenses did.
- Rule: tint the light, not the picture. Color comes from the emitted light; a color overlay or multiply laid over a neutral glow reads as a surface.
- Informs `contour-yellow-halo`, `sunset.blooms`, and the softer production version of `contour-iridescent-rings`.

## Larry Bell

What he made: glass cubes from the early 1960s ("The first cubes were made using household mirrors from which he would scratch away parts of the reflective material"), then vacuum-coated glass, using "a technology that deposited exquisitely thin films of various metallic and non-metallic substances to the glass. The resulting visual spectrum of colors is in fact light reflected in different wavelengths off the surface of the glass" (artist's site). Glass interested him because "it could transmit, absorb and reflect light, and with specific treatment, it could do all three at the same time." In 1969 his custom vacuum coating machine, "The Tank", was finished: a four-ton cylinder about ten feet long and seven feet across that coats glass up to 10 by 6 feet, built for the *Standing Walls*. The *Vapor Drawings* on paper followed from 1978. The AIC's *Untitled (Terminal Series)* (1968) is "Vacuum plated glass coated with silicon monoxide, with metal binding".

How the light behaves:

- "By the late 1960s, Larry Bell found that the most interesting part of the cubes was where the corners came together" (artist's site). Where two coated panes overlap in the line of sight, their effects compound.
- A thin metal film dims what is behind it "as by twilight or a dimmer switch. Yet at certain angles, what appears is a reflection of something brighter somewhere else" (Stanford, *Glass Cube*, 1984).
- Photo (viewed), the AIC *Terminal Series* cube: the coating is a smooth vertical gradient on each pane, denser and warmer grey at the top and clearer lower down. The corners, where two panes overlap, read darker.
- Physics: a thin film's reflected color depends on its thickness and on the viewing angle. For a film that absorbs little, the reflected and transmitted light add back up to the incoming light, so the transmitted tint is roughly the complement of the reflected one.

Photos: [AIC, *Untitled (Terminal Series)*](https://www.artic.edu/artworks/33225), [Stanford, *Glass Cube*](https://anderson.stanford.edu/collection/glass-cube-by-larry-bell/). Text: [artist's site, the work](https://larrybell.com/the_work/) and [the studios and the Tank](https://larrybell.com/the_studios/).

What we take:

- Rule: iridescence is one smooth field (thickness or distance) mapped to color, not a rainbow drawn around a shape. In `contour-iridescent-rings` the hue turns 25–55° across each rim and 10–20° along it. That comes from a different falloff depth per color channel (the lavender ring's R, G and B fall to half at 9, 9.5 and 25 px), plus a slow change along the ring. Parameters: inner widths per channel for each ring, and a low-frequency multiplier along the ring.
- Rule: decide for every layer whether it is light or a filter. Light layers add, so overlaps get brighter. Filter layers multiply, so overlaps get darker and more saturated, as at Bell's corners and in riso ink. Test: in light references, no overlap of two light layers is darker than either layer alone. The riso presets are the only place where layers multiply.
- Informs `contour-iridescent-rings` and the riso references (`sunset-green-riso`, `sunset-blue-riso`, `sunset-pink-riso`).

## Mary Corse

What she made: light paintings from the mid-1960s, first with "fluorescent tubes, which gave off an even light", then argon tubes in plexiglass boxes powered by a Tesla coil hidden in the wall (*Untitled (Space + Electric Light)*, 1968: "Argon light, plexiglass, and high-frequency generator"); from 1968, the *White Light* paintings made with glass microspheres, the reflective beads used on road lines; later, the *Inner Band* paintings (Whitney audio guide, 2018).

How the light behaves:

- The beads came from the road: "She was driving along the road in Malibu, California, when she noticed that the light coming from behind her was hitting the highway lines and illuminating them" (curator Kim Conaty). Corse: the beads "put the light in the painting, and put it in your perception—because as you move, it changes".
- The *Inner Band* paintings combine "fields of matte white acrylic paint and two different types of fields of white acrylic paint with glass microspheres", so that "an interior band ... would appear and completely disappear as the viewer passed from one side of the canvas to the next."

Photos and text: [Whitney audio guide, with transcripts](https://whitney.org/guides/42), [*Mary Corse: A Survey in Light*](https://whitney.org/exhibitions/mary-corse).

What we take:

- Rule: a band can be pure brightness. Two neighboring bands may share a hue and differ only in lightness, and a band of light inside a field is enough structure for a Sunset image. This is the brief's "flat glow".
- Parameter: in `sunset.ramp` and `sunset.bands`, an inner band set by position, width and a lightness lift, with no change of hue. Test: `sunset-sky-peach`'s brightest band is a flat pale peach that stays within 0.02 L from 46% to 64% of the height, with no core.
- Informs `sunset-sky-peach`, `sunset-violet-wave` (the near-white band), `sunset-blue-riso`.

## Peter Alexander

What he made: cast polyester resin cubes, wedges, pyramids and leaning rods (his chronology lists "1965-1972 Resin"), including *Cloud Box* (1966), a 9⅝-inch resin cube with mist injected into the resin before it hardened; then sunsets ("1973-1975 Sunsets, Chula Vista, Explosions"), many on black velvet.

How the light behaves (LA Times critic Christopher Knight, 2020):

- *Cloud Box*: "Depending on ambient light and the angle of vision, color shifts between airy blue and a smoggy, yellowish-gray hue."
- The wedges: "Color is transparent and nearly clear at the top, sliding incrementally to dense and almost opaque at the base."
- The sunsets have "a low horizon line above a narrow strip of jet-black velvet", and "the sun is never seen. Only illuminated atmosphere is."
- Physics: fine droplets in clear resin scatter short wavelengths sideways, so the cube looks blue against a dark background, and let long wavelengths through, so it looks yellow-grey when you look toward the light. The sky works the same way.

Text: [LA Times appreciation, 2020](https://www.latimes.com/entertainment-arts/story/2020-05-28/peter-alexander-artist-dies-appreciation), [artist's chronology (archived)](https://web.archive.org/web/20150216155447/http://www.peteralexander.com/pa/?page_id=4), [Getty, Pacific Standard Time (archived)](https://web.archive.org/web/20150404013148/http://blogs.getty.edu/pacificstandardtime/explore-the-era/people/peter-alexander/).

What we take:

- Rule: one scattering medium makes both the blue and the warm color. The sky color is scattered light and the glow is the light that got through, so both come from one model and always belong together ([`research-techniques.md`](../research-techniques.md), section 3: the sky as `1 − exp(−β·m)` of the sky color, the glow as powers `W^p` of the warm color).
- Rule: drive the ramp by path length. Through a wedge, color density follows thickness. Through the sky, the path length (air mass) rises steeply toward the horizon, so the colors crowd together there. Test: with the path length taken from the air-mass formula, transition widths shrink toward the horizon as in `sunset-sky-peach` (10–90% widths about 32, 13, 14, 8, 6 and 4% of the height, top to bottom).
- Rule: no sun disc, only lit air. This matches the brief.
- Informs `sunset-sky-peach`, `sunset-red-yellow-arcs`, `sunset-blue-diagonal`, `sunset-violet-wave`.

## De Wain Valentine

What he made: large cast polyester resin circles, discs, columns and walls in the 1960s and 1970s, including *Gray Column* (1975–76; 140 × 87½ × 9½ in.). He "developed a modified polyester resin so that he could cast colossal objects in a single pour, the material being sold as Valentine MasKast resin" (Getty). His aim was "to cut out large chunks of ocean or sky and say: 'Here it is.'" (2011 New York Times profile, quoted by ARTnews). He described the curing as "an exothermic reaction" and his sculptures as "self-cooking art" (1969 Artforum interview, quoted by ARTnews). The Getty Conservation Institute's 2011 exhibition studied how *Gray Column* was made and conserved; the conservator Tom Learner: "He wanted to use a polyester resin that could be highly polished to give a very pristine surface" (Guardian).

How the light behaves:

- Photo (viewed), a red-violet concave disc in the Getty's Pacific Standard Time archive: the disc is thinnest at the center and thickest at the rim. The center reads light pink and the rim deep, dark violet. A bright streak runs along the left side of the rim, where light enters and travels inside the resin.
- Physics: the same rule as Pashgian's lens, turned around. Color depth follows thickness, so a concave disc is deepest at its rim.

Photos and text: [Getty, *From Start to Finish: De Wain Valentine's Gray Column* (archived)](https://web.archive.org/web/20130122120659/http://www.getty.edu/pacificstandardtime/exhibitions-and-events/from-start-to-finish), [Getty, artist page (archived)](https://web.archive.org/web/20131220030244/http://blogs.getty.edu/pacificstandardtime/explore-the-era/people/de-wain-valentine/), [ARTnews obituary, 2022](https://www.artnews.com/art-news/news/de-wain-valentine-dead-1234619747/), [Guardian, 2011](https://www.theguardian.com/artanddesign/2011/oct/09/us-sculptor-gray-column-restored).

What we take:

- Rule: for each recipe, decide where the light's "thickness" is greatest. With a thick rim and a thin center, the deepest, most saturated color sits just inside the rim (`contour-iridescent-rings`: chroma peaks 15 px inside the lavender ring, 40–50 px inside the cyan, 10 px inside the coral). With a thick center and a thin rim, color fades to nothing outward (Pashgian; the crest of `contour-yellow-halo`).
- Rule: light inside a slab spreads from where it enters. In `contour-rim-edge` the navy face is brightest near the corner, where the rim is brightest (the reference note fits the face as a wide gaussian at the corner, σ about 0.44 of the short side, cut at the silhouette).
- Rule: a large flat field of one color shows every flaw, as a polished resin surface does. Sunset skies need a clean surface: dither so long ramps never band, and add no texture except the brief's grain.
- Informs `contour-iridescent-rings`, `contour-rim-edge`, and every Sunset ramp.

## Spencer Finch

What he made: works that rebuild the measured light of one place at one time (all quotes from the artist's site). *Sunset (South Texas, 6/21/03)* (fluorescent fixtures and filters, 16 in. × 40 ft) "recreates the light of a sunset as measured in South Texas." *Dusk (Hudson River Valley 10/30/2005)* ("Filters, clothespins, fishing line, fluorescent fixtures") "recreates light at dusk as measured on the Western shore of the Hudson River." *Paris Sky (from the top of the Eiffel Tower, 293 m, June 29, 2007)* "re-creates the light measured from the top of the Eiffel Tower." For *Sunset from the Studio Roof (12/9/11)*, "a photograph of a sunset was printed on Duratrans and overlaid with a colored filter, so that the light emitted precisely matches the color light of the sunset, as recorded with a colorimeter." *Trying to remember the color of the sky on that September morning* (2014) is 2,983 watercolor squares, and "Each square is a unique shade of blue." For *The River That Flows Both Ways* (2009), "one photograph of the surface of the Hudson River was taken each minute from a tugboat on a single day in June of 2008. The color of each pane of glass was based on a single pixel point in each photograph".

How the light behaves:

- Photo (viewed), *Sunset (South Texas)*: up close the 40-foot strip of tubes is a patchwork of small saturated filters (pink, cyan, yellow, lavender, clear). The light they throw on the wall above and below merges into a pale, nearly white, slightly warm glow; the floor reflects soft colored stripes.

Photos and text: [*Sunset (South Texas)*](https://spencerfinch.com/sunset-south-texas-6/21/03), [*Dusk (Hudson River Valley)*](https://spencerfinch.com/dusk-hudson-river-valley-10302005), [*Paris Sky*](https://spencerfinch.com/paris-sky-from-the-top-of-the-eiffel-tower-293-m-june-29-2007), [*Sunset from the Studio Roof*](https://spencerfinch.com/sunset-from-the-studio-roof-12/9/11), [*Trying to remember the color of the sky on that September morning*](https://spencerfinch.com/trying-to-remember-the-color-of-the-sky-on-that-september-morning), [*The River That Flows Both Ways*](https://spencerfinch.com/the-river-that-flows-both-ways).

What we take:

- Rule: the glow is a pale tint. Measured sunset light is close to white, and Finch reaches it by adding many saturated filters. Use pale tints of the warm pack color for the glow (`W^p` with a small `p`: Orange-red at p 0.25 is `#FFC089`, at 0.1 `#FFE4C8`), and keep the full pack saturation for small, dim areas such as a deep red at the horizon. Test: the brightest region of a Sunset render has low chroma, as in the references (`sunset-sky-peach` glow `#D1B99F`, C about 0.045; `sunset-blue-diagonal`'s brightest cream `#FDDEAA`, C 0.075).
- Rule: blur distance decides whether colors read separately or as one tint. Next to Finch's tubes each filter shows; a short distance away they merge. A band narrower than about three blur widths never shows its own color (`research-techniques.md`, section 2).
- Method: Finch's pieces are built the way our presets should be: a few measured colors for one place and time, plus parameters. His Hudson piece samples one pixel per photo; our renderer must never read reference pixels (`AGENTS.md`).
- Rule: variety comes from light, not from more swatches; the 2,983 blues are all one sky. A Sunset sky built from Meta Blue alone should still hold a wide, smooth range of blues (darker, lighter, whitened, the pale bridge) at one hue.
- Informs `sunset-sky-peach`, `sunset-blue-diagonal`, `sunset-violet-wave`, and how presets are built.

## Liz West

What she made: rooms of colored fluorescent light (all from the artist's site). *An Additive Mix* (2015, National Science and Media Museum) has "250 individual coloured fluorescent tubes combined with infinity mirrors", "saturating them in individual hues that collectively create an intense white glow". *Your Colour Perception* (2015, Manchester) used "T8 fluorescent lamps, lighting gels" over 10,000 square feet. *Vanishing Boundaries* (2013) is circular fluorescent lamps under reflective discs on the floor.

How the light behaves:

- *Your Colour Perception* "utilises the darkness outside to raise the strength of the illumination and colouration in the work. Using this enormous space to install a light work in the darkest Winter months allowed the colour to bleed with more saturation than if displayed any other time of the year."
- *Vanishing Boundaries*: "The hues of each light gently diminish creating ... soft colour mixes. Notably, the reflective discs also deny us full exposure to the source of light" (Jack Welsh, quoted on the artist's site).
- Photo (viewed), *Your Colour Perception*: the floor runs from teal-green in front through yellow-green, yellow, orange and red to magenta at the back. Yellow, where green and red light overlap, is the brightest band.
- Photo (viewed), *Vanishing Boundaries*: each hidden lamp throws a short saturated halo (cyan, pink, yellow, green, blue) on the concrete, brightest at the disc's edge and gone within about half a disc width. Neighboring halos mix softly where they meet.

Photos: [*An Additive Mix*](https://www.liz-west.com/an-additive-mix/), [*Your Colour Perception*](https://www.liz-west.com/yourcolourperception/), [*Vanishing Boundaries*](https://www.liz-west.com/vanishing-boundaries/), [*Our Colour*](https://www.liz-west.com/our-colour/).

What we take:

- Rule: saturation needs darkness. Colored light against black stays saturated, and light added everywhere washes it out. Keep Contour's base near-black navy (L 0.10–0.16 in the brief) and keep haze local to the light. Test: in `contour-beam-pool` the darks are blue-black navy with red near 0, never neutral; no render lifts the base outside the light.
- Rule: hide the source and show its spill. A Contour source sits off-frame or behind an edge; when a source is in frame it is a thin line or edge, never a blob.
- Rule: a ramp of colored light zones has bright bridges (yellow between green and red). In the Bold pack, in pack order, Meta Blue and Cyan meet in light blue, Cyan and Yellow in pale mint, Yellow and Orange-red in bright orange.
- Informs `contour-beam-pool`, `contour-rim-edge`, and the Sunset ramps.

## Ann Veronica Janssens

What she made (Pirelli HangarBicocca exhibition guide, 2023, unless noted): fog rooms since 1997 (the first "at M HKA in Antwerp in 1997, which was later followed by other versions with added artificial colored lights"); *pinkyellowblue* (2015, Wellcome Collection; "Artificial fog, artificial light, colour filters", per the photo credit on the M Woods poster); *Rouge 106–Bleu 132* (2003–07), "a cabin with intermittent blue and red lights, which combine to produce a glaring, incandescent white"; *L'espace infini* (1999), "an inaccessible concave rectangular structure without any corners", where "the eye can no longer discern boundaries and proportions"; *Stella* (2006), *Rose* (2007) and *Bluette* (2007), where "artificial beams of light cross each other to form stars with five or more points"; and *Aerogel* (2003), whose particles "emit a light similar to that of the atmosphere, offering to the observer the typical colors of the first bright rays of dawn."

How the light behaves:

- Janssens on fog: "It appears to abolish all obstacles, materiality, the resistances specific to a given context, and at the same time, it seems to impart a materiality and tactility to light." The fog causes "the dissolution of the outlines of objects and even the body of the visitor" (guide).
- Beams in fog become volumes: "Instead of flattening into simple geometric images on the wall, the intersecting rays of light seem to burst out toward the viewer" (guide).
- In *pinkyellowblue*, "As the viewer moves through the space, the colors blend and shift" (M Woods).
- Photo (viewed), *pinkyellowblue* on the M Woods poster: cyan fog on the left, pink on the right, and a pale lilac-white between them. People a few meters away are low-contrast silhouettes; nothing has an edge.
- Photo (viewed), *Rouge 106–Bleu 132* at M Woods: inside the cabin the light is a very pale pink, close to white; the room outside is saturated magenta; the wooden floor reflects deep red.

Photos and text: [HangarBicocca exhibition guide (PDF)](https://web-assets-hangarbicocca.pirelli.com/wp-content/uploads/2023/04/Exhibition-guide-Ann-Veronica-Janssens-singole.pdf), [HangarBicocca, *Grand Bal*](https://pirellihangarbicocca.org/en/exhibition/ann-veronica-janssens/), [M Woods, *pinkyellowblue*](https://mwoods.org/Ann-Veronica-Janssens-pinkyellowblue).

What we take:

- Rule: in haze two colored lights meet as a pale mix, and contrast drops with distance. That is the top of `sunset-violet-wave` (light blue, then a near-white glow, then saturated pink and violet) and the lit haze around the beam in `contour-beam-pool`.
- Rule: bright mixes go white and dim spill keeps the color (the cabin is pale pink inside and magenta outside). Test: a red plus blue overlap at 4× nominal renders near-white with a pink cast through the tone curve; the same overlap at nominal stays magenta.
- Rule: crossing beams add. Where two beams or streaks cross, the brightness is their sum, never darker (`contour-radial-streaks`, the floor fan of `contour-beam-pool`).
- Rule: no corners means no boundaries (*L'espace infini*; the same lesson as Wheeler).
- Informs `sunset-violet-wave`, `contour-beam-pool`, `contour-radial-streaks`.

## Chris Fraser

What he made: room-sized camera obscuras and slit rooms (all from the artist's site). His statement: "I construct environments modeled on historical image-making technologies, from the camera obscura to the magic lantern"; "light came into a darkened room through a hole and made a picture"; later "small apertures became elongated windows; pictures became patterns". *One line drawing the ceiling of the Mills College Art Museum* (2010): "I built a dark room inside the Mills College Art Museum, leaving a gap where one wall would have met the ceiling. This slit translated the gallery's ornate skylight into a linear image that contoured along the walls and floor of the space, changing rapidly over the course of the day." *Emanations* (2012): a wall "bisected by a horizontal opening, translating the cars, pedestrians, and buildings outside into moving bands of light and color." *Slant* (2013) used a diagonal aperture to make "a pyramid-shaped projection". In *Filament* (2018), light from a bulb through an array of pinholes repeated "the peculiar shape of the bulb's filament".

How the light behaves:

- Photo (viewed), *One line drawing* at 5:56 PM: from one bright point where the slit meets the corner, many thin lines of light fan out across the walls and floor. Each line is sharpest near the slit and wider and softer farther away. The bright end is white; the dim lines are cool grey-blue in a blue-black room.
- Photo (viewed), *Emanations*: the slit shows a row of white hot spots, with streaks fanning out sideways and a soft white haze around them.
- Physics: a slit of width w, lit by a source of angular size θ, makes a line about w + D·θ wide at distance D. The soft edge grows in proportion to the distance from the opening.

Photos and text: [statement](https://www.chrisfraserstudio.com/artist-statement), [*One line drawing the ceiling of the Mills College Art Museum*](https://www.chrisfraserstudio.com/one-line-drawing-the-ceiling-of-the-mills-college-art-museum), [*Emanations*](https://www.chrisfraserstudio.com/emanations), [*Slant*](https://www.chrisfraserstudio.com/slant), [*Filament*](https://www.chrisfraserstudio.com/filament).

What we take:

- Rule: a line of light widens in proportion to its distance from where it starts. Parameter: width = core width + slope × distance. Tests from the references: the horizon line in `contour-radial-streaks` widens from a core σ of about 4 px near the bright point to 21 px at the right edge, about 0.03 px per px; the glow of `contour-light-line` opens downward, its visible edge moving out 0.18 px per px of height.
- Rule: streaks converge on one point and stay straight, and the brightest light is near where they meet (`contour-radial-streaks`: rays from (340, 425) agree with the streaks within about 5°, with no streaks within 150 px of the point).
- Informs `contour-radial-streaks`, `contour-light-line`, and the floor fan in `contour-beam-pool`.

## Others close to the references

### Fred Eversley

What he made: parabolic lenses of cast polyester, "cast in polyester resin and polished on motorized turntables", often in layers ("3-color, 3-layer cast polyester"). The parabola comes from spinning the liquid, which he first tried as a boy with "a pie pan with water" on a phonograph turntable. Eversley: "when the focal point is in the sculpture you have sort of a band of concentrated energy" (Smithsonian National Air and Space Museum, 2021).

Photo (viewed), a blue lens in that article: a white glow at the focus that grades through pale cyan to saturated blue and then deep blue at the thick rim, with fine radial streaks spreading from the bright spot.

What we take: concentrated light goes white at its center, and saturation rises with distance from it. `contour-yellow-halo` does this: a lemon crest at L 0.95–0.96, a light-blue strip (`#A0CFEB`), then a saturated disc that deepens to `#0B66E1` (L 0.54) in the corner. Informs `contour-yellow-halo` and `contour-iridescent-rings`.

Source: [The Science of Frederick Eversley's Art](https://airandspace.si.edu/stories/editorial/science-frederick-eversleys-art).

### Uta Barth

What she made: *...and to draw a bright white line with light* (2011). Watching light through her curtains at home, "she intervened in the scene, manipulating the curtains to create lines and curves of light that she photographed" (Art Institute of Chicago).

Photo (viewed): a horizontal band of sunlight on sheer curtains. Its lower edge waves with the folds, its middle goes to white, and its edge is sharper in some places than in others. The rest of the frame is warm grey-beige.

What we take: a warped horizon is a band of light whose edge waves at low frequency and whose softness changes along its length. Test: in `sunset-violet-wave` the horizon's softness runs from 32–42 px to more than 100 px along its length; a render must vary at least twofold too. Informs `sunset-violet-wave` and `sunset-film-poster-bands`.

Source: [AIC, *...and to draw a bright white line with light*](https://www.artic.edu/artworks/208399).

### Olafur Eliasson, *Your atmospheric colour atlas* (2009)

This adds to the Eliasson entry in `research-artists.md`. "The fog is infused with the additive colours red, green and blue, emitted from hundreds of fluorescent lights that are installed in the ceiling as a colour grid ... At each colour boundary, two hues blend to create transitional slivers of cyan, magenta, or yellow, adding up to a zone of pure, white light in the middle where all the colours meet." Materials: fluorescent lights, red, green and blue filter foil, a haze machine.

What we take: the clearest statement of the bridge rule by an artist. Test: three overlapping lights in pack order go toward white where all three meet, with pale two-color bridges between them.

Source: [Studio Olafur Eliasson](https://olafureliasson.net/artwork/your-atmospheric-colour-atlas-2009/).

## Which artists inform which reference

| Reference | Artists |
| --- | --- |
| `contour-rim-edge` | Wheeler (edge-lit panel, glow inside only), Flavin (pale core), Valentine (light inside the face), West (dark base) |
| `contour-light-line` | Flavin (pale core, colored spill), Fraser (width grows with distance), Janssens |
| `contour-iridescent-rings` | Bell (falloff per channel, light versus filter), Valentine (deepest color just inside the rim), Cruz-Diez (lighter overlaps), Eversley, Eliasson |
| `contour-yellow-halo` | Pashgian (fade to nothing), Irwin (no single edge), Eversley (white focus, saturated surround) |
| `contour-beam-pool` | Janssens (haze), West (saturation needs dark), Fraser (floor fan), Flavin (color only where light lands) |
| `contour-radial-streaks` | Fraser, Janssens |
| `sunset-sky-peach` | Alexander (path length), Finch (pale glow), Corse (inner band), Wheeler (slow change along the horizon) |
| `sunset-violet-wave` | Janssens (pale mix in haze), Barth (waving edge), Finch |
| `sunset-red-yellow-arcs` | Cruz-Diez (lighter bridge), Alexander (path length) |
| `sunset-blue-diagonal` | Alexander, Finch, Wheeler |
| `sunset-pink-riso`, `sunset-blue-riso`, `sunset-green-riso` | Cruz-Diez (lighter bridge, line at a hard contact), Bell (filters multiply), Corse (bands of brightness) |
| `sunset-film-poster-bands` | Flavin ("a soft-bordered area of color"), Barth |

## Not found or not verified

- Dia, MoMA, the Hirshhorn, the Smithsonian Archives of American Art, Fondazione Prada (Flavin's Santa Maria Annunciata in Chiesa Rossa, Milan) and the National Gallery of Canada refused scripted requests. Nothing here is taken from them.
- No transcript of Larry Bell's 1980 Archives of American Art oral history is online. The only coating material we found named in a primary source is the AIC's "silicon monoxide".
- We found no text describing the light at the doorways between Chromosaturation's chambers; that description comes from one photo.
- Pashgian describes her lens edges as vanishing. We found no source describing glowing edges on her spheres or columns.
- James Turrell's Rice University Skyspace, *Twilight Epiphany* (2012), runs "an LED light sequence that projects onto the ceiling and through an aperture in the 72-foot square knife-edge roof during sunrise and at sunset" ([Moody Center](https://moody.rice.edu/james-turrell-twilight-epiphany-skyspace)). We found no source on how it changes the sky's apparent color, so nothing is taken from it.
- Josef Albers's *Interaction of Color* (overlap and transparency studies) is not readable online, so it is not used.

## What this means for the engine

1. Overlapping lights add, and both reach into the overlap at full strength. The bridge between two colors is then lighter than a plain mix and often lighter than both sides: red and green light on a wall meets in yellow, and red, green and blue light in fog meets in white. Don't cross-fade with weights that sum to 1; give bands and glows an overlap gain, and check every bridge against the references (in `sunset-red-yellow-arcs` and `sunset-pink-riso` the bridge is lighter than both neighbors).
2. The hottest light looks almost white, and the color is in the falloff. Let the tone curve whiten cores and keep falloffs below nominal so they stay saturated. On every Contour render the chroma peak sits a few pixels into the falloff, not on the core.
3. Give each light a separate falloff per color channel. When red, green and blue fade at different distances, the hue turns as the light fades: the iridescent rims, the warm fringe of the light line, a sunset going from yellow to red. Thin films and tinted resin make color this way. Don't cycle through a palette.
4. Color depth follows path length: thin is pale, thick is deep and dark. In the sky the path length rises steeply toward the horizon, so drive Sunset ramps by air mass and the colors crowd together near the horizon on their own (`sunset-sky-peach` transition widths go from 32% down to 4% of the height).
5. Falloffs die out smoothly, with no cutoff radius, no clamp and no corner in the slope. Raising Intensity pushes the visible edge outward smoothly, and lowering it shrinks the glow. Check at 8× gain at several Intensity values.
6. A soft edge never has one clean outline. Build halos from a few overlapping soft layers, and vary softness and position along every edge (at least twofold along a horizon) unless the reference edge is ruler-straight.
7. Measure the reach of a light in luminance. At the same RGB gain a Meta Blue glow fades out much closer than a Yellow one (2.2 times closer with an r⁻² tail). Scale each light's tail width (not its peak, which stays at the pack hex) from its color's luminance, so Intensity means the same reach in every pack.
8. Haze makes light visible, and darkness keeps it saturated. Beams need a haze density that sets how visible they are, and haze stays local to the light. Keep Contour bases near-black navy, add no frame-wide fog, and hide the source: show its spill, a line or an edge, never a lit blob.
9. Lines of light widen in proportion to their distance from the source or opening: width = core + slope × distance, about 0.03 px per px for the horizon line of `contour-radial-streaks` and 0.18 for the glow edge of `contour-light-line`.
10. Measured sky glow is pale. Use pale tints of the one warm pack color for glows and keep full saturation for small, dim areas. A preset is a few measured colors plus parameters, never a per-pixel table.
