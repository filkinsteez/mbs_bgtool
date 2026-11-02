# Camera-less light photography, and how film and paper render color

What photographers who expose film or paper directly to light actually do, how much of the look comes from the light and how much from the material, and a "photographic paper" output response we can test after our linear-light rendering.

Related notes: [`../research-artists.md`](../research-artists.md) (Sugimoto's Seascapes, Turrell, Eliasson), [`../research-techniques.md`](../research-techniques.md) (tone curve in section 1, halation in section 5), [`lens-glare-halation.md`](lens-glare-halation.md) (film halation in section 5), [`perception-additive-light.md`](perception-additive-light.md) (hue-held tone curve in 7.1, bridge light in 7.2, warm tails in 7.3), [`twilight-sky-color.md`](twilight-sky-color.md).

How this was checked:

- Every link below was opened. Quotes come from artist sites, museum catalogue records (V&A, Guggenheim, Tate), interviews, a Kodak manual and data sheet, a Kodak patent and a journal abstract. Where no source was found, the text says so. Inferences are marked.
- The numbers in "Proposed output response" come from scratch scripts in `artifacts/research-light-photography/` (gitignored: `paper.mjs`, `paper2.mjs`, `bridge.mjs`, `warmlag.mjs`, `same.mjs`). The results are copied here.
- One reference, `contour-light-line`, was measured for this note only (a row of pixels across its warm halo), along with a core color that [`lens-glare-halation.md`](lens-glare-halation.md) measured on `contour-rim-edge`. The renderer never reads them.

## Main findings

- The softness in these photographs comes from the light's path: the distance from source to paper, a mask held above the paper, colored glass and water, defocus, and long exposures. The paper adds almost no blur.
- Exposures add up in the emulsion before any dye forms, so the mixing happens in light, as it does in our engine. Mud comes from the material: negative paper makes overlapping light darker, and chemistry (chemigrams) makes browns.
- The material sets the direction. Positive materials (dye destruction paper such as Cibachrome, slide film, Polaroid) go from black to color to white as light increases, like our engine. Negative color paper exposed directly (Tillmans, Welling, Carey's photograms) goes from white to the light's complementary color to dark, and overlaps get darker.
- On positive material a color is purest in the middle of the curve. Above that, the strongest channel saturates first, so warm light passes through gold on its way to white (and on film, blue light passes through cyan). Below it, the weaker channels drop first, so dim warm light reads redder and dim blue reads deeper, not olive or grey.
- A paper-like response that keeps pack hexes exact is possible. It has two parts: a shoulder that only acts above nominal (exact by construction) and an optional toe that acts below nominal (exact for flat pack fields if the light colors are pre-inverted). A full film model with channel crosstalk cannot keep the hexes.

## The artists

Each entry covers what they made and how, what the light looks like, which reference it informs, and links with photos.

### Wolfgang Tillmans: Blushes, Freischwimmer, Lighter

What and how:

- **Blushes** (2000–01). Tate Britain, 2003: "fine, thread-like lines, apparently drawn with light, swim over the surface of the photographic paper … made using the photographic process, manually exposing photo-sensitive paper to different light sources in the darkroom."
- **Freischwimmer** (from 2003). The Hirshhorn, 2007: made "through the direct manipulation of light on paper rather than the use of a camera", with "sinewy or hair-like lines".
- **Lighter** (2005–08). Tillmans to Frieze, 2008: "Some of them I expose to different coloured light sources in the darkroom after first folding them in the dark, and some are made in reverse order." The Guggenheim on Lighter 46 (2008, chromogenic print): "choreographing the diaphanous washes of color using chemicals and homemade light sources on light-sensitive paper", then "a rigid fold that lifts the work into its Plexiglas enclosure".
- On the method in general (Frieze, 2008): "When I work on the non-figurative pictures in the darkroom … it is a direct engagement with physical realities: the colour and intensity of my light sources". The Silver works are different: sheets fed through a processor while it is being cleaned, "only half fixed", so "they slowly change hue over a few days".
- The paper is chromogenic (C-type), which is negative-working: more light makes more dye, and colored light prints as its complementary color.

What the light looks like:

- One or two dye colors per sheet, in washes that fade smoothly into paper white, and thin lines with soft halos.
- In Freischwimmer 26 the light-drawn threads are dark magenta on pale pink, and the area that got the least light is nearly white. That fits negative paper (an inference from the process): drawn light shows as dark lines.
- In Lighter, the folds make flat facets of slightly different density.

Informs: `sunset-pink-riso` and the blooms recipe (one hue fading to white, no shapes), and `contour-light-line` (a thin drawn line inside a soft wash). In our positive engine the same light would be a bright line on dark, not a dark line on white.

Links: [Freischwimmer 26](https://commons.wikimedia.org/wiki/File:Freischwimmer_26.jpg) and [Lighter V](https://commons.wikimedia.org/wiki/File:Lighter_V.jpg) (Wikimedia Commons); [Guggenheim: Lighter 46](https://www.guggenheim.org/artwork/24031) ([2016 copy with the text](https://web.archive.org/web/20160304002331/http://www.guggenheim.org/new-york/collections/collection-online/artwork/24031)); [Tate Britain 2003 room text](https://web.archive.org/web/2012/http://www.tate.org.uk/whats-on/tate-britain/exhibition/wolfgang-tillmans-if-one-thing-matters-everything-matters/wolfgan-2); [Frieze 2008 interview](https://web.archive.org/web/20120421223152/http://www.frieze.com/issue/print_article/look_again/); [Hirshhorn 2007 release](https://web.archive.org/web/20110629175219/http://hirshhorn.si.edu/info/press.asp?key=90&subkey=34); Tillmans, ["On Paper"](https://cdn.sanity.io/files/fvguglqc/production/343d95f6b59ab929ea1ded3611c30cd6357176cc.pdf) (2022, on his print materials; linked from [his texts page](https://www.tillmans.co.uk/texts)).

### James Welling: Degradés and Light Sources

What and how:

- **Degradés** (1986–2006 on his site). Welling to Steel Stillman, Art in America, 2011: "The first 'Degrades' were actually 20-by-24-inch Polaroids of printed backdrops, but I soon discovered I could create the same color effects more easily and dramatically in the darkroom, using a color enlarger and a piece of cardboard for burning and dodging." Stillman describes them as "mostly vertical images, divided horizontally into two color zones". Welling: "When I work on photograms, I'm in the dark and can't see what I'm doing."
- **Light Sources** (1992–2001 in the interview, 1993–2013 on his site): mostly black-and-white camera photographs of lamps, the sun, buildings and water. The early ones were made around Antwerp and Brussels.
- **Hexachromes** (2005), from the same interview: six exposures on one sheet of color film, through red, green, blue, cyan, magenta and yellow filters. "Everything that remained stationary registered in normal color; but anything that moved … took on the color of whichever filter was in front of the camera during that exposure." Exposures add up on film.

What the light looks like:

- The 1997 Degradé on his site is an orange field over a blue-violet field.
- The edge between the fields is soft: burning and dodging means holding the card above the paper and moving it.
- Where the fields meet there is a dark maroon band, darker than both sides. On negative paper, more dye forms where two exposures overlap. That is an inference: the interview doesn't name the paper type.
- The Light Sources sun pictures show a burnt-out white disc with a soft halo in a grey sky.

Informs: `sunset-film-poster-bands` and `sunset-blue-riso` (two or three soft bands with burned edges). The dark band is what to avoid: in light, the same overlap would be lighter than both sides.

Links: [Degradés](https://jameswelling.net/works/degrades), [Light Sources](https://jameswelling.net/works/ls), [Art in America: In the Studio, James Welling (2011)](https://www.artnews.com/art-in-america/features/james-welling-4-62874/).

### Garry Fabian Miller: light through colored liquid and glass onto Cibachrome

What and how:

- V&A: "In 1985, he stopped using a camera." He works by "shining light through coloured glass vessels and over cut-paper shapes to create forms that record directly onto photographic paper".
- On *Exposure (five hours of light) 1 July 2005*, nine dye destruction prints tiled into one image, the V&A writes: "projecting light through a coloured vessel filled with water and onto light sensitive paper. The light's path is shaped and interrupted by cardboard stencils punctured with holes."
- His site lists recent works as "Light, oil, water, c-type print from unique dye destruction print". The original is a unique Cibachrome (Ilfochrome), and editions are chromogenic prints made from it.
- From his journal: "In the last decade of the Dark Room the burning of a flame in its darkness became an important tool to both erase exposed colour and bring a focused intensity of white light". The Colour Seeds (2019–20) were "the culmination of my Dark Room Cibachrome work". The BBC programme on his site (2020) follows him using up the last Cibachrome chemistry before he closed the darkroom.
- Dye destruction paper is positive. The dyes are in the paper from the start and are bleached where light hits. No light leaves full dye, which is black. Colored light leaves that color. Strong white light bleaches every layer, which is white. [Wikipedia (Ilfochrome)](https://en.wikipedia.org/wiki/Ilfochrome) credits the azo dyes with "an anti-light-scattering layer" that keeps the image sharp.

What the light looks like:

- *Night Tower 3* (2001): a deep blue field with a column of dots whose cores are white and whose rims are blue.
- *Exposure (five hours of light)*: soft red dots on a purple-black ground, with a brighter red point in the center.
- *Becoming Magma 2* (2004): a soft-edged red ring on dark red.
- Halos stay fully saturated down into the dark, and only the hottest spots reach white.
- Edges are soft because the stencils and vessels sat at a distance from the paper (a penumbra), not because the paper blurs.

Informs: this is the closest match to Contour, as the brief suggests. `contour-yellow-halo` and `contour-iridescent-rings` (glowing circles and rings, overlaps to white), `contour-light-line` (lines and the flame), and `contour-rim-edge` (a hot edge on dark).

Links: V&A [Exposure (five hours of light)](https://collections.vam.ac.uk/item/O1457788/), [Night Tower 3](https://collections.vam.ac.uk/item/O249412/), [Becoming Magma 2](https://collections.vam.ac.uk/item/O131471/); [artist site](https://www.garryfabianmiller.com/).

### Barbara Kasten: Constructs

What and how:

- **Constructs** (late 1970s to 1986): studio sets of glass, mirrors, plexiglass, metal and wire, lit and photographed on Polaroid 8×10 and 20×24 film. Some were printed as Cibachromes: ICA Philadelphia lists *Construct VIII* (1982) as a Polaroid and *Construct 32* (1986) as a Cibachrome.
- The Polaroid 20×24 Studio on her sessions: "shooting at an aperture of f64 … with multiple point sources covered with colored gels. Each color required a different exposure, and due to the close down aperture, some colors needed to be fired up to twenty times. … White light might require one exposure, yellow two, red four, green ten and deep blue the most, sometimes up to twenty. The instant feedback was critical here, one could never prejudge how strongly a color would render as it bounced off objects and through silk scrims."
- Polaroid color film is positive. Each layer "releases a complementary subtractive dye", and "Only dyes from the unexposed areas of the film will reach the receiving layer to produce a positive color image" (20×24 Studio). No light means black.

What the light looks like: planes washed with colored light, each gel's pool soft-edged, shadows filled by another color, and mirrors that repeat a pool elsewhere. ICA: "her palette becoming bolder in response to the lush, saturated quality of the medium."

Informs: `contour-beam-pool` (a pool of colored light on a surface), and how to balance several lights (lesson 8).

Links: [ICA Philadelphia: Barbara Kasten: Stages (2015)](https://icaphila.org/exhibitions/barbara-kasten-stages/), [20×24 Studio: Barbara Kasten 20×24 Constructs (2015 copy)](https://web.archive.org/web/20150103215538/http://www.20x24studio.com/?page_id=1724), [20×24 Studio FAQ on the instant process (2015 copy)](https://web.archive.org/web/2015/http://www.20x24studio.com/?page_id=1653), [Art21](https://art21.org/artist/barbara-kasten/).

### Ellen Carey: Pulls and color photograms

What and how:

- **Photography Degree Zero** (Polaroid 20×24 Pulls from 1996, later Rollbacks). From her 2015 statement: "A single Pull, with its signature black shape, is a different form of photographic document—that of the exhausted and unexposed — Polaroid dyes pulled out from the camera's rollers."
  - The colors come from "gel-colored light or no light at all", and she describes "feather-blended colors".
  - A Rollback is "a Pull … rolled up, re-fed back through the camera for one or more exposures".
  - The shapes are parabolas, like "the frontal curve of a comet".
- **Struck by Light** (color photograms, 1992–2019 on her site): "made in a darkroom, without a camera and in color".
  - She uses "overlapping exposures … the mixing of light known as photographic color theory (RGB = CMY)".
  - She uses "metal push pins, glass marbles, or a photographic grey card, to interrupt the light or penlights that strike the paper".
  - Wikipedia adds that she crumples and creases the paper.

What the light looks like: Pulls are long tongues of one color with feathered edges where the developer thins, ending in black (dye that was never exposed). The photograms are saturated fields crossed by penlight lines, with folds that make fine light and dark veins.

Informs: `contour-yellow-halo` (one curved, cropped form of color fading out) and `contour-light-line` (penlight strokes).

Links: archived [Photography Degree Zero](https://web.archive.org/web/20210214011728/http://www.ellencareyphotography.com/photography-degree-zero) and [Struck by Light](https://web.archive.org/web/20210513201805/http://www.ellencareyphotography.com/struck-by-light) pages (her current domain is parked), with the full statements for the [Pulls](https://web.archive.org/web/2021if_/http://www.ellencareyphotography.com/s/Carey_ArtistStatement_PhotographyDegreeZero_2015.doc) and the [photograms](https://web.archive.org/web/2021if_/http://www.ellencareyphotography.com/s/Carey_ArtistStatement_StruckByLight_2015.doc).

### Adam Fuss: water and flash on paper

What and how:

- *Ark* (1990, gelatin silver), V&A: "placing a sheet of photographic paper in a tray of water, letting a single drop from a pipette fall into the still surface and firing a flash to record the event."
- *Invocation* (1992, dye destruction print), V&A: "a mother briefly placed her child on photographic paper that had been submerged in a tray of shallow water. The resulting image – created by firing flashlight directly at the paper – captures not only the child's outline but also the ripples in the water caused by its movements."
- Fraenkel Gallery: "color photograms that picture babies floating in what look like pools of gold or blue light. Placing infants in warm, shallow water with unexposed photo paper beneath them, Fuss used a quick burst of light". Many are listed as unique Cibachrome photograms.

What the light looks like:

- The water surface acts as a lens: ripples focus the flash into thin bright rings, with darker rings beside them.
- Behind the rings, the flash falls off smoothly across the sheet. In *Ark* it is dark at one side and pale at the other.
- In *Invocation* the field is saturated yellow, the body's shadow is deep red-brown, and the strongest ripple lines are paler, toward white.

Informs: `contour-iridescent-rings` (thin rims of light over a smooth field) and `contour-yellow-halo` (a saturated yellow field with paler light).

Links: V&A [Invocation](https://collections.vam.ac.uk/item/O82744/) and [Ark](https://collections.vam.ac.uk/item/O195078/); [Fraenkel Gallery](https://fraenkelgallery.com/artists/adam-fuss).

### Liz Deschenes: photograms made with night light

What and how:

- Aperture, 2014: "she makes use of dim nighttime light on photosensitive paper, to be later washed with silver toner."
- The silvered sheets act as dim mirrors and keep changing. At the Walker (*Gallery 7*, 2014) the light-sensitive photograms oxidized over the year-long show (Wikipedia).
- Earlier, her *Blue and Green Screens* (2001–02) were chromogenic prints of the chroma-key colors used in film.

What the light looks like: near-monochrome silver and grey-blue fields, very slow, faint gradients, and color picked up from the room.

Informs: little about color blending. It shows that a long, dim exposure of a whole sheet gives an even field with no visible structure, and it fits the Atmospheric pack's silvery tones.

Links: [Aperture: Liz Deschenes at the Walker Art Center](https://aperture.org/editorial/liz-deschenes-walker-art-center/).

### Pierre Cordier: chemigrams

What and how:

- His site: the chemigram "combines the physics of painting (varnish, wax, oil) and the chemistry of photography (photosensitive emulsion, developer, fixer); without a camera, without an enlarger, and in full light". He invented it on 10 November 1956 and began color research in 1961.
- V&A: shapes come from "'localising' products, including varnish, wax, oil, glue, syrup, egg … often made after repeatedly dipping the paper in developer and fixer", and the chemigram "does not rely solely on light to produce the image".

What it looks like: this is not light. It is crisp cellular and marbled patterns, with blacks, browns and ochres where developer and fixer meet.

Informs: the counter-example. Color made by chemistry and resists looks like paint, with hard cell edges and brown mixes. There is nothing to copy for gradients.

Links: V&A [Chemigram 25/1/66 V](https://collections.vam.ac.uk/item/O1225948/); [Cordier's site, English biography (2020 copy)](https://web.archive.org/web/2020/http://www.pierrecordier.com/6.html).

### Marco Breuer: heat, abrasion and color paper

What and how:

- John Yau, Hyperallergic, 2012, writes about works on chromogenic paper "exposed, folded, burned" and "scratched, burned".
- Breuer, quoted there from an interview with Tiffany Jow: he is "attempt[ing] to strip down the photographic process, to remove the distractions of equipment, and to force imagery out of photographic paper itself."
- Yau: "Exposing the black paper to light as well as heating its surface caused other changes and colors to emerge."
- Wikipedia lists his tools: "12-gauge shotguns, the guts of electric frying pans, modified turntables, razor blades, and power sanders".

What it looks like: black or "luminous turquoise blue" fields with sharp scratches, folds and burns. The color comes from fogging and damage, not from an image made by light.

Informs: later surface filters (scratch and grain texture), not gradients. It is also a reminder that color paper is a stack of separate dye layers, each responding on its own.

Links: [Hyperallergic: A Man Without a Camera](https://hyperallergic.com/a-man-without-a-camera/).

### Uta Barth: blur and light

What and how:

- **Ground** (1992–95) and **Field** (1995–96), as Wikipedia dates them: places framed as if for a portrait, with the subject left out and the background out of focus.
- **…and to draw a bright white line with light** (2011), to Paul Soto, Art in America:
  - Sunlight crosses a windowsill and a curtain, and the light's form varies "from slender strands to wide swathes spilling through its gauzy texture".
  - "The line of light grows with the setting of the sun."
  - She included pictures of her own arm drawing the curtain.
- **Compositions of Light on White**: blinds project beams onto closet doors, giving "a hazy, intense monochrome".
- Of her earlier sequences, she says they trace "optical fatigue, retinal memory and melting, fading afterimages".
- The Getty (2022): she "explores the ephemeral qualities of light and its ability to overwhelm and entirely destabilize human vision."

What the light looks like: defocus is the gradient. There are whole fields of soft color with no edge, sun lines that burn white at the center and spread warm through fabric, and white on white.

Informs: Sunset (fields with no shapes, made by defocus); `contour-light-line` and `contour-rim-edge` (a bright line whose width grows); and `contour-beam-pool` (light falling on a surface).

Links: [Art in America interview (2011)](https://www.artnews.com/art-in-america/interviews/uta-barth-56233/), [Getty: Uta Barth: Peripheral Vision (2022)](https://www.getty.edu/art/exhibitions/barth/index.html).

### Hiroshi Sugimoto: Opticks and Colors of Shadow

The prism light on a wall is *Opticks*. *Colors of Shadow* is daylight and shadow on plaster. Both are on his site.

What and how:

- **Opticks** (prints dated 2018): "It has been fifteen years since I started recreating Newton's prism experiment. … the light is split, then drawn into the dim observation chamber, where it is projected on the white plaster wall at exaggerated size."
  - He photographed single areas of the spectrum on Polaroid: "With light as my pigment".
  - "Particularly when the colors fade and fuse into darkness, the gradation seems to melt away into pure mystery."
- **Colors of Shadow** (2004): walls in a Tokyo penthouse finished in shikkui plaster and set at 90°, 55° and 35°. "In the morning light, the shadows play freely over the surfaces … I've discovered a sublime variety in shadow hues."

What the light looks like:

- *Opticks 121* goes from red to deep maroon to black, with no brown on the way.
- *Opticks 106* goes yellow, then orange, then red at one edge, all fully saturated.
- *Colors of Shadow*: near-white walls with grey gradients of slightly different hues.

Informs: `warp-curved-spectral-bands` (prism light); the warm halo of `contour-light-line` and the yellow-orange-red run of `sunset-red-yellow-arcs`; and, through *Colors of Shadow*, the grey-beige bridge in `sunset-sky-peach`.

Links: [Opticks](https://www.sugimotohiroshi.com/polarized-color-1), [Colors of Shadow](https://www.sugimotohiroshi.com/colors-of-shadow).

### Light leaks

No first-hand technical source was found for the colors of light leaks. What follows is inferred from how film is built:

- Color negative film stacks its layers with the blue-sensitive layer on top and the red-sensitive layer nearest the base ([`lens-glare-halation.md`](lens-glare-halation.md) section 5).
- Light that enters from the back or along the edge reaches the red layer first. Stronger light reaches green too, and only very strong light reaches blue.
- Printed, that reads as a flare that goes red, then orange, then yellow, then white. Halation follows the same order (Dehancer: "at the overexposed border the halos have an orange tint, and as we move away, they become red").
- Leaks are large, soft (the light spreads inside the camera and the film base) and warm.
- On slide film the same leak reads as a pale, washed-out patch.

Informs: Warp Speed (warm flares from the edge of the frame), and the warm order of the path to white (lesson 4).

### Long-exposure light painting

History (Wikipedia, "Light painting"):

- Marey and Demenÿ traced a walk with lights in 1889.
- Frank and Lillian Gilbreth put small lights on workers' hands in 1914.
- Man Ray's *Space Writing* (1935) used a penlight. Carey found his hidden signature in it in 2009: "the artist draws in the air with a penlight, creating looping designs and curlicues of light".
- Gjon Mili photographed Picasso drawing with a flashlight in 1949.

How it works:

- Exposure is illuminance times time (Kodak).
- A moving light leaves exposure along its path in proportion to its brightness divided by its speed.
- Where the light moves slowly or stops, the trace overexposes to white. Where it moves fast, the trace stays thin and colored.
- The trace's cross-section is the light's spot, plus any defocus.

Informs: `contour-light-line` (a white core where the light is strongest, colored edges) and `warp-long-exposure-streaks`.

Links: [Carey on Man Ray's Space Writing (archived)](https://web.archive.org/web/20220222212413/http://www.ellencareyphotography.com/pictus-writ-man-ray/), [Wikipedia: Light painting](https://en.wikipedia.org/wiki/Light_painting).

## Light or medium?

| What you see | Where it comes from | Example |
| --- | --- | --- |
| Soft edges and long falloffs | The light: distance, a mask held off the paper, liquid and glass, defocus, long exposure | Fabian Miller's circles, Welling's burned edges, Barth's blur |
| Overlaps lighter than both sides | Light adding up on a positive material | Fuss's ripple rings, Fabian Miller's white cores |
| Overlaps darker than both sides | Negative paper exposed directly | Welling's maroon band, Tillmans's dark threads |
| White cores | The material's shoulder: every dye bleached, or none formed | *Night Tower 3*, the Light Sources sun |
| Hot warm light turning gold; hot blue turning cyan on film | Each layer's shoulder (and, by inference, the warm spectra of real light sources) | The film-like model below |
| Dim warm light reading redder; dim blue reading deeper | The material's mid-curve contrast, and longer light paths through colored liquid | `contour-light-line`'s halo; *Opticks 121* |
| Warm halos around hot points | Film halation (material) and lens glare (light) | Light Sources; [`lens-glare-halation.md`](lens-glare-halation.md) |
| Color with no light image | Chemistry, heat, damage | Cordier, Breuer, Tillmans's Silver works |

## How film and paper respond

### The characteristic curve

From Kodak's *Basic Photographic Sensitometry Workbook* (H-740, 2006):

- Exposure is illuminance times time. Density is log10 of opacity, which is 1/transmission. The characteristic curve plots density against log exposure.
- The curve has three parts: the toe, the straight line and the shoulder. On a negative, "the shadows fall on the toe", "the highlights fall on the shoulder", and the midtones fall on the straight line. Gamma is the slope of the straight line.
- "Negative curves have slopes well below 1.0 (typically around 0.45 to 0.65) to give the photographer more exposure latitude. To compensate for the low slope of negative, printing papers have a slope grater [sic] than 1.0 (from about 1.5 to 3.5, depending upon the grade of the paper)." Color paper has three curves and no grades.
- For color negative film, "It is important that the three curve shapes are as similar to each other as possible". The orange mask is there "to compensate for dye characteristics".
- "The characteristic curve for reversal films is like a mirror image of the curve for negative film. … At small log E exposures, the densities are high. At large log exposures, the densities are low." With no orange mask, the three color curves "lie almost on each other".

In display terms (an inference from those slopes): a negative compresses a wide range of light onto its long straight line, and the paper's steep slope expands the middle back out. So a print's midtones have more contrast than the scene, and the ends are compressed: deep shadows into the paper's black, bright light into the paper's white.

### Dye layers, crosstalk and interimage effects

- Three layers record red, green and blue light. Each forms the complementary dye: cyan, magenta or yellow (20×24 Studio FAQ; Kodak H-740).
- The layers' sensitivities overlap, and the dyes are not ideal: each absorbs some light outside its own band. Left uncorrected, this makes colors greyer. Negative films carry the orange mask to cancel it (Kodak).
- Interimage effects couple the layers. Hanson and Horton (1952): "many processes have 'interimage effects' which cause each dye image to be a function of all three exposure densities", and "most of the interimage effects occurring should give an improvement in color reproduction over that which would be obtained in their absence."
- Kodak made the coupling deliberate with development-inhibitor-releasing (DIR) couplers. In patent US 3,227,554 (Barr, Williams and Whitmore; priority 1959, published 1966), a coupler "releases a diffusible development inhibitor which inhibits development in layer 51 as a function of the development taking place in layer 52", used "for color correction".
- Kodak still lists "Proprietary DIR Couplers" on Portra 400 for "Distinct edges, fine detail" (data sheet E-4050, 2016).
- What this means for color (inference): overlapping sensitivities mix the channels, which lowers saturation. Interimage effects push them apart, which raises saturation, cleans up hue and adds a little edge contrast. In log terms both act as a 3×3 matrix on densities.
- Long exposures shift color. Portra 400 needs no correction "from 1/10,000 second to 1 second. For critical applications with longer exposure times, make tests under your conditions." Exposures of minutes or hours, like Fabian Miller's, fall outside that range, and the three layers lose speed by different amounts.

### How saturation behaves as exposure rises

On a positive material, for one colored light:

1. **Very little light:** every layer is near its maximum density, so the result is black with little color.
2. **Onto the straight line:** color appears. Where the per-layer slope is above 1, the ratio between channels is raised to that power, so the color is purer than the light's own ratio. This is why dim light on positive material keeps its hue or deepens it, instead of going grey.
3. **The strongest channel reaches the shoulder first** (that layer is fully bleached or fully clear), while the others keep rising. The color gets lighter and less saturated and moves toward the next channel: orange toward yellow, blue toward cyan.
4. **Every layer in the shoulder:** white.

Measured with a simple film-like model (an S-curve per layer, a little spectral overlap and a small interimage push; it is not exact at nominal, see below):

- Orange-red goes `#FFA737`, `#FFD65E`, `#FFF192` at +1, +2 and +3 stops: gold, then pale yellow.
- Meta Blue goes `#34BBFF`, `#5BE4FF`, `#8EF7FF`: cyan.

The references show half of this:

- In `contour-light-line`, the warm halo next to the core is golden (`#EFA330`, Oklab hue 72°). As it fades over about three stops it reddens to 62°, 52°, 47° and 42°. Much further out it turns a dark warm grey.
- In `contour-rim-edge`, the hot rim sits at hue 248–254° (`#C7DAED`, `#68ACFF`), against Meta Blue's 259°. That is a small shift toward cyan, nowhere near cyan itself (about 200°).

### Highlights to white: paper versus film

- **Negative film and a print.** The negative records highlights high on its long straight line, and the light end of the print compresses them into paper white. The roll-off to white is gradual, and a negative can be overexposed and still print (Kodak's workbook works through an example with two steps of latitude either way).
- **Slide film and positive papers** (Cibachrome, Polaroid). Strong light goes straight to the clear base or paper white. There is little latitude above, so cores burn out to white early, and the most saturated color sits in the ring just outside the burnt core (*Night Tower 3*).
- **Negative paper exposed directly.** Paper white is where no light fell, and strong light goes dark.
- **Halation and scatter.** Film adds a warm ring around burnt highlights ([`lens-glare-halation.md`](lens-glare-halation.md) section 5). Dye destruction paper should add little, given the anti-scattering effect Wikipedia credits its dyes with (not measured here).

### Why these blends look vivid, not muddy

1. Mixing happens in light: the exposures from two lights add up in each layer before any dye forms.
2. Softness comes from the light's path and from time. Both are blurs of light, so they cannot make a mix darker than its two sides.
3. On a positive material the middle of the curve raises channel ratios, so color stays pure into the dim parts. The shoulder sends overlaps and cores to white instead of to a flat, clipped color.
4. Masks and interimage effects remove the grey that imperfect dyes would add.
5. The deep toe gives dense blacks, so a glow on black has contrast all the way out.

Where photographs do go muddy:

- Complementary exposures on negative paper, which make dark overlaps.
- Chemistry mixed on the paper, as in Cordier's browns.
- Layer curves that cross, giving one color cast in the highlights and another in the shadows. Kodak's "as similar to each other as possible" guards against this.
- Color shifts in long exposures.

## Proposed output response: "paper"

This runs where `toneCurve` runs today (`src/light/engine/output.ts`): after the lens and exposure, before the sRGB encode. It has two parts, each with its own switch.

- **Paper shoulder (above nominal).** Identity while max(rgb) ≤ 1. Above that, the largest channel stays at 1 and the others walk to white along Lottes's indirect path, as in [`../research-techniques.md`](../research-techniques.md) section 1. Two additions come from film:
  - In warm light the blue channel lags, so warm cores pass through gold before white.
  - Whitening can run per stop instead of per unit of light, which gives film's longer shoulder.

  With `s = 1`, `warmLag = 0` and `q = 1` it is today's curve: the largest difference over 200,000 random colors at 1–32× was 3.4e-7.
- **Paper toe (below nominal, an optional look).** Below max(rgb) = 1, the weaker channels fall faster than the strongest: `d = m·(c/m)^p`, where `p` grows with the number of stops below nominal. The strongest channel, and so the shape of the falloff, is unchanged. Dim warm light reads amber and red instead of olive and brown, and dim blue reads navy. Flat pack fields stay exact only if the recipe's light colors are pre-inverted (closed form, below).

```glsl
// Photographic paper response. Scene-linear in, display-linear out.
// Identity at max(rgb) == 1, so flat pack colors at nominal keep their hex.
// With the toe on, the recipe's light colors must be pre-inverted (paperToeInverse on the CPU).
uniform float uPaperS;        // path shape: 1 = today's direct path, 2 = research-techniques default
uniform float uPaperWarmLag;  // extra lag of blue in warm light (red above blue): 0 = off, 1 = gold before white
uniform float uPaperQ;        // 1 = whiten per unit of light (short, like paper); 0.35 = per stop (long, like film)
uniform float uToeTau;        // 0 = off; 1 = dim warm light reads amber and red
uniform float uToeN0;         // stops below nominal where the toe reaches half strength, e.g. 2

const vec3 PAPER_LUMA = vec3(0.2126, 0.7152, 0.0722);

// Both forms have slope 1 at m = 1, so the knee stays continuous for any q.
float shoulderAmount(float m, float q) {
  return q < 1e-3 ? log(m) : (pow(m, q) - 1.0) / q;
}

vec3 paperShoulder(vec3 c, float m) {
  vec3 r = c / m;
  float sB = uPaperS * (1.0 + uPaperWarmLag * clamp(r.r - r.b, 0.0, 1.0));
  vec3 s = vec3(uPaperS, uPaperS, sB);
  vec3 rs = pow(r, 1.0 / s);
  // The floor is only for the slope; flooring the output path would lift zero channels at the knee.
  vec3 rf = max(r, vec3(1e-6));
  float slope = dot(PAPER_LUMA, s * pow(rf, (s - 1.0) / s) * (1.0 - pow(rf, 1.0 / s)));
  // Whitening rate that keeps the luminance slope continuous at the knee.
  float k = clamp(dot(PAPER_LUMA, r) / max(slope, 1e-4), 0.05, 50.0);
  float w = 1.0 - exp(-k * shoulderAmount(m, uPaperQ));
  return pow(mix(rs, vec3(1.0), w), s);
}

// Zero slope at the knee (n = 0), rising to 1 + uToeTau deep below nominal.
float paperToePower(float m) {
  float n = -log2(max(m, 1e-12));
  return 1.0 + uToeTau * n * n / (n * n + uToeN0 * uToeN0);
}

vec3 paperResponse(vec3 c) {
  c = max(c, vec3(0.0));
  float m = max(c.r, max(c.g, c.b));
  if (m > 1.0) return paperShoulder(c, m);
  if (m <= 0.0 || uToeTau <= 0.0) return c;
  return m * pow(c / m, vec3(paperToePower(m)));
}
```

On the CPU, when the toe is on, each preset color is turned into the light color that prints as that hex at nominal. It uses the same `p`, inverted:

```ts
/** Light color that the paper toe prints as `c` at nominal. Keeps the max channel; zero stays zero. */
export function paperToeInverse(c: Rgb, tau: number, n0: number): Rgb {
  const m = Math.max(c[0], c[1], c[2])
  if (m <= 0 || m >= 1 || tau <= 0) return [c[0], c[1], c[2]]
  const n = -Math.log2(m)
  const p = 1 + (tau * n * n) / (n * n + n0 * n0)
  return [m * (c[0] / m) ** (1 / p), m * (c[1] / m) ** (1 / p), m * (c[2] / m) ** (1 / p)]
}
```

Parameters to test:

| Uniform | Today | Proposed | What it changes |
| --- | --- | --- | --- |
| `uPaperS` | 1 | 2 | Blue whitens through pale blue, not lavender |
| `uPaperWarmLag` | 0 | 1 | Deep warm colors pass through gold before white |
| `uPaperQ` | 1 | 1 for Contour, 0.35 for Sunset (to test) | At 0.35, Meta Blue reaches near-white at +5 stops instead of +3 |
| `uToeTau` | 0 | 1 | How much purer dim light gets |
| `uToeN0` | n/a | 2 | How far below nominal the toe reaches half strength |

### Fit with the exact-hex rule

- **Shoulder.** It is the identity at and below the knee, so it fits by construction and changes only light above nominal. The twelve-hex test passes with any settings.
- **Toe.** It changes light below nominal, so it breaks "identity below 1". It does not break the actual rule (a flat pack color at nominal prints its hex), as long as the engine pre-inverts every preset color with `paperToeInverse` before the recipe uses it. Checked: 12 of 12 exact. The costs:
  - The dark pack colors become much paler light colors inside the engine. Near-black, Forest, Plum and Slate sit 3.5–4.9 stops below nominal, where `p` is 1.76–1.86, so any mix that involves them changes.
  - Reference presets with picked colors need the same inversion.
  - The Intensity control moves flat fields off their hex in both directions. It already does so above nominal.
- **Recommendation for the toe:** keep it an optional "paper" look until the owner has seen it.
- **The per-glow alternative.** `warmTail` in [`perception-additive-light.md`](perception-additive-light.md) section 7.3 applies the same power to one light's color by distance and needs no inversion. The global toe also reaches bloom and halation tails. Use one or the other, not both at full strength.
- **A full film model** (crosstalk matrix, an S-curve per layer, interimage) cannot keep the hexes. In my version all 12 missed (Meta Blue became `#1B85FC`, Yellow `#F8E951`, Ice `#EAEBEC`), and it turns hot blue cyan. Use it only for studies, or perhaps for 1:1 reference presets, which use picked colors and don't need exact hexes.

How it relates to the other tone-curve proposals:

- **Lottes path with s = 2** ([`../research-techniques.md`](../research-techniques.md)): this is the paper shoulder with `warmLag = 0` and `q = 1`.
- **Hue-held curve with a 0.35 warm drift** ([`perception-additive-light.md`](perception-additive-light.md) 7.1): it holds the Oklab hue for blue exactly and takes Orange-red through peach. Photographic materials take warm light further, through gold, and the light-line halo sits at 72°.
- Render all three on the same sheets and judge them by eye.

### Test results

From the scratch scripts. Glows used a core, glow and haze profile at 16× nominal on black.

- **Exact at nominal:** 12 of 12 for every exact variant, with the toe through pre-inversion.
- **Orange-red at +1, +2, +3 stops:**
  - Today: `#FFA297`, `#FFD9D5`, `#FFF7F6` (pink).
  - s = 2: `#FFBEA3`, `#FFF5F1`, `#FFFFFF` (peach).
  - Paper (warmLag 1, q 1): `#FFBE67`, `#FFF5E4`, `#FFFFFE` (gold, then cream).
  - Paper (warmLag 1, q 0.35): `#FFAF4C`, `#FFE0AF`, `#FFF6E6`, reaching white at about +5.
- **Meta Blue at +1, +2, +3 stops:**
  - Today: `#5E8CFF`, `#A6B9FF`, `#DAE1FF` (hue 265° to 275°, lavender).
  - Paper, q 1: `#4497FF`, `#B3D3FF`, `#F1F7FF` (256°).
  - Paper, q 0.35: `#3C93FF`, `#8FBFFF`, `#C6DEFF` (256°).
- **warmLag only changes deep warm colors.** Orange-red's hue at +1 stop is 43° without it and 68° with it. Yellow and Tan move 4–5°, coral 7–14°, and hot pink, lavender and Meta Blue 0–2°.
- **Toe (τ 1, n0 2), tails at −2, −3 and −5 stops:**
  - Yellow: `#896801`, `#634700`, `#312100` (hue 86° to 80°, amber-brown), instead of `#89720B`, `#635205`, `#312801` (94°, olive).
  - Orange-red: `#891100`, `#630600` instead of `#892600`, `#631900` (redder).
  - Lime: `#6A8220`, `#4A5E10` instead of `#728236`, `#525E25` (greener).
- **At the knee:**
  - The Oklab L slope per stop, below and above the knee, is 0.136 → 0.119 for Meta Blue with the paper shoulder, 0.138 → 0.121 with the toe added, and 0.136 → 0.130 today.
  - Yellow's chroma slope just above the knee is −0.041 per stop with the paper shoulder against −0.505 today, so yellow glows show a much weaker saturated ring.
- **Bridge rule with the toe:** weighted blends between seven pack pairs (Forest to Plum, Slate to Near-black, Meta Blue to Forest, Steel to Ice, Meta Blue to Plum, Tan to Forest, Lime to Forest) dip at most 0.007 in Oklab L below the darker end (Meta Blue to Forest). That is inside the roadmap's 0.01.
- **By eye:**
  - Today's curve gives lavender cores to blue glows and pink cores to Orange-red glows.
  - s = 2 and the paper shoulder give blue glows blue-white cores.
  - The paper shoulder gives Orange-red a gold ring before white.
  - The long shoulder with the toe gives the light-line test a white core, then gold, orange and deep red. That is the closest of the exact variants to the left side of `contour-light-line`.
  - The film-like model turns blue cyan.
- **What no curve fixes:** a column of Meta Blue sky plus an Orange-red glow goes magenta-pink in the middle under every variant, because that color is in the light sum. The fix belongs in the light (bridge haze, the warm color's pale family), as described in [`perception-additive-light.md`](perception-additive-light.md) 7.2 and [`twilight-sky-color.md`](twilight-sky-color.md).

### How to try it in the engine

1. Port `paperResponse` with a CPU twin. The default uniforms (`s` 1, `warmLag` 0, `q` 1, `tau` 0) reproduce today's output, so the twelve-hex test and the current sheets stay as they are.
2. Render the tone and glow test sheets at `s` 2 and `warmLag` 1, with `q` at both 1 and 0.35, next to `contour-light-line`, `contour-rim-edge`, `contour-yellow-halo` and `sunset-red-yellow-arcs`.
3. Add the toe as an option, with pre-inverted colors. Check the twelve hexes, the bridge rule and the tails.
4. Decide per mood. Contour probably wants the short shoulder (crisp white cores, like Cibachrome), and Sunset a longer one.

## Eight lessons for the renderer

1. **Mix in light, respond once, and stay positive.** All of these images are light adding up in the emulsion, and the material responds once to the sum. Keep all mixing in linear light before the output response, as now. Never copy a negative-paper look: there, overlapping light gets darker (Welling's maroon band, Tillmans's dark threads). In our engine an overlap must always be lighter than both sides.
2. **Put softness in the light, not in the curve.** Fabian Miller's circles are soft because the vessels and stencils were held off the paper, Welling's edges because of a moving card, Barth's fields because of defocus, and Fuss's rings because water acts as a lens. The paper itself is sharp. Model soft edges as penumbra, blur, distance falloff and motion in linear light, and keep blur out of the response.
3. **Make white only at the hottest spot, with color just outside it.** On positive material the most saturated color sits in the ring around a burnt-out core (*Night Tower 3*, the Light Sources sun). Give each source a small, very hot core over a wider colored body, so the response whitens the core and leaves the body's color.
4. **Above nominal, whiten in film order but keep blue blue.** Film and paper saturate the strongest channel first, so warm light passes through gold: next to its core, the light-line halo sits at Oklab hue 72°. The paper shoulder with `s = 2` and `warmLag = 1` takes Orange-red through `#FFBE67` (gold) and `#FFF5E4` to white. Meta Blue goes through `#4497FF` and `#B3D3FF` at hue 256°, close to the rim-edge reference's 248–254° and far from film's cyan. At `s = 1`, `warmLag = 0` it is today's curve.
5. **Make shoulder length a setting.** Paper, slides and Cibachrome go to white within one or two stops, while negative film holds color over four or more. `q = 1` gives the short shoulder and `q` ≈ 0.35 the long one (Meta Blue near-white at +5 stops instead of +3), both with a continuous knee. Try short for Contour and long for Sunset.
6. **Below nominal, let dim light get purer.** In the light-line reference the warm halo reddens from 72° to 42° over about three stops of falloff, and Sugimoto's red fades to maroon and black with no brown. The paper toe (τ = 1, n0 = 2) does the same:
   - Dim Yellow goes amber: `#634700` at −3 stops instead of olive `#635205`.
   - Dim Orange-red goes deep red, dim Lime greener, and dim Meta Blue navy.

   Pre-invert the light colors so flat pack fields stay exact, and don't stack the toe at full strength with halation or `warmTail`.
7. **Keep pack hexes exact with the right method for each part.** Changes above nominal keep the hexes by construction. Changes below nominal need `paperToeInverse` on every preset color (12 of 12 exact). A film model with crosstalk misses all 12 hexes and turns blue cyan, so keep it for studies.
8. **Balance colored lights by luminance, and fix pale bridges in the light.** Kasten fired white once, yellow twice, red four times, green ten times and deep blue up to twenty times to make them read alike. Our Meta Blue at nominal has a luminance of 0.145 against Yellow's 0.694, so yellow dominates any sum. Set light gains by luminance or Oklab L, not by equal RGB scaling. No response curve removes the magenta between Meta Blue and Orange-red: that needs pale light in the bridge ([`perception-additive-light.md`](perception-additive-light.md) 7.2).

## Not found or not verified

- Which light sources Tillmans uses for Freischwimmer and Blushes. The sources say only "different light sources" and "homemade light sources".
- Whether Welling's Degradés are on negative chromogenic paper. The dark overlap band suggests so, but that is an inference.
- Fabian Miller's exposure times beyond what the titles say ("five hours of light"), and how he chooses the liquids. The V&A says colored vessels filled with water, and his own captions say oil and water.
- A first-hand source on the colors of light leaks. The order given above is inferred from the order of the film's layers.
- Curve numbers for color paper and Ilfochrome (slope, density range). Kodak's workbook gives slopes for black-and-white paper only, and the Kodak Endura and Ektachrome E100 data sheets were not at the URLs tried (404).
- The exact steps of Deschenes's process beyond "dim nighttime light" and "silver toner".
- Whether Breuer's scratches expose individual dye layers. This is likely, but not confirmed.
- MoMA's pages (its Tillmans exhibition and collection) refuse scripted requests (403), so none are cited.

## Sources not linked above

- Kodak, [*Basic Photographic Sensitometry Workbook*](https://www.kodak.com/content/products-brochures/Film/Basic-Photographic-Sensitometry-Workbook.pdf), publication H-740, 2006.
- Kodak Alaris, [*Kodak Professional Portra 400 Film*](https://imaging.kodakalaris.com/sites/default/files/files/products/e4050_portra_400.pdf), technical data E-4050, 2016.
- W. T. Hanson and C. A. Horton, ["Subtractive Color Reproduction: Interimage Effects"](https://opg.optica.org/josa/abstract.cfm?uri=josa-42-9-663), *J. Opt. Soc. Am.* 42, 663–669 (1952), [doi:10.1364/JOSA.42.000663](https://doi.org/10.1364/JOSA.42.000663).
- C. R. Barr, J. Williams, K. E. Whitmore (Eastman Kodak), [US 3,227,554](https://patents.google.com/patent/US3227554A/en), "Photographic elements and processes utilizing mercaptan-forming couplers", 1966.
- Wikipedia: [Ilfochrome](https://en.wikipedia.org/wiki/Ilfochrome), [Chromogenic print](https://en.wikipedia.org/wiki/Chromogenic_print), [Light painting](https://en.wikipedia.org/wiki/Light_painting).
