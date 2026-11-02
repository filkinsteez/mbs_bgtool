# Artists and products: how they make light and color

Who has made images like our references, how they did it, and what we take for the engine. Built from an agent research report (2026-11-02) plus sources fetched for this file. Every link was opened. Speculation is marked as such.

Main findings:

- Images that look like light add color as light (in linear RGB), spread it with blur or distance falloff, and let the brightest colors go to white. Images that look muddy or "stock" average a few colors in sRGB through noise masks.
- In the physical world, smooth light comes from haze, defocus and long exposure: Eliasson's mist, McCall's fog, Sugimoto's three-hour exposures, Rothko's thin layers.
- Zach Lieberman, the owner's named inspiration, treats colors as light sources and spends most of his time on small parameter changes while looking at the output.

## Artists

### Zach Lieberman (the owner's named inspiration)

What he made: a code sketch every day since 2016 (openFrameworks and GLSL shaders); light studies; Color Blind Studies (Verse, 2022, shown in London and at the Toledo Museum of Art); Horizon(te)s with Iskra Velitchkova (fxhash, 2022); Box Light Studies (Art Blocks, 2024); the Cone Gradient Study; 100 Sunsets; Color Push for WeTransfer.

Technique, from his own write-ups:

- Color spots and cone gradients: "you define the color of a pixel in relationship to a series of spots of color, that can move around" (2019). The Cone Gradient Study mixes points that each have "a hue, an intensity and a direction". He has not published the formula.
- Color painting: draw the last frame into the next one with a small noise offset on the texture lookup. Repeated, "you can actually make colors move and spread" (2019).
- Sunset colors: "a clever algorithm for simulating the colors of sunset and atmosphere in glsl […] the constants involve things like the size of the earth, the position of the sun" (2020). He does not name it. Speculation: [`glsl-atmosphere`](https://github.com/wwwtyro/glsl-atmosphere) matches his description.
- Poisson light: "poisson filling which extends a color outward, blending it with other colors" (2020). He found it in the [Rendu](https://github.com/kosua20/Rendu) library and used Lingdong Huang's openFrameworks version, [`ofxPoissonFill`](https://github.com/LingDong-/ofxPoissonFill).
- Distance fields: he computes distance images of arbitrary shapes (type, bodies) and passes them to shaders (2020).
- Bands: `floor` and `fract` on noise over a grid give stripes like light through Venetian blinds (2021). In 2023 he "tried to integrate sunset colors and explore how different forms would work in bands."
- Blur: he blurred each character many times so he could fade from sharp to fully out of focus. "I'm always attracted to the relationship between soft and hard things, like a sharp edge and a blurry middle." (2021)
- Horizons: in Horizon(te)s he worked on "how to portray a horizon line and create work with feeling and depth", made "very soft lines", and "curtains of color that mix and create new forms — all oriented along the horizon." On method: "the real work was endless tweaking. Turning 0.8 into 0.81 and 0.82". To get the same image in every browser he kept the inputs to his random functions small, because GPUs differ in float precision (2022).
- Light research (2022 to 2024): simulating neon reflected on walls; "a kind of 2d raymarching, where the pixel shoots off in random directions to figure out its color. It means the image develops slowly, over time"; jump flood to build distance maps quickly; lights treated as "giant pixels"; "chromatic aberation in the flares" and "directional light" (2023); one prism-based palette pushed in different directions (Box Light Studies).
- In 2025 he made circles and rectangles that are "really about light", with Turrell and Tadao Ando's Church of Light in mind.
- Not found: which color space he mixes in.

What we take:

- Treat each color as a light with a position, an intensity and a falloff, and add the lights. Do not interpolate between swatches.
- A physical sky model as a starting point for sunset colors (the `sunset-scattering` prototype tests this).
- Diffusion fill to spread a few colored seeds into one seamless field (the `sunset-diffusion` prototype tests this).
- Soft horizon lines, and color that hangs along the horizon.
- A sharp core with a blurry body for rims and lines.
- Chromatic aberration around the hottest light (light line, Warp Speed).
- Expect most of the work to be small parameter changes made while looking at images.
- Keep shader random inputs small so exports match on every GPU.

Links: daily sketching in [2019](https://zachlieberman.medium.com/daily-sketching-in-2019-c1c801045577), [2020](https://zachlieberman.medium.com/daily-sketching-in-2020-c2b4a59057e5), [2021](https://zachlieberman.medium.com/daily-sketching-in-2021-fc92220aa3f4), [2022](https://zachlieberman.medium.com/daily-sketching-in-2022-4160eac26aa8), [2023](https://zachlieberman.medium.com/daily-sketching-in-2023-b4c0e31c8acb), [2025](https://zachlieberman.medium.com/daily-sketching-in-2025-60189ffd6b60); [horizon(te)s](https://zachlieberman.medium.com/horizon-te-s-f180d164368a); [box light studies](https://zachlieberman.medium.com/box-light-studies-ce51ef00d82b); [Cone Gradient Study](https://verse.works/series/color-gradient-study-by-zach-lieberman). Jason McGhee rebuilds his 2D light method in the browser: [part 1](https://jason.today/gi), [part 2](https://jason.today/rc).

### James Turrell

What he made: Skyspaces (rooms open to the sky through an opening in the roof), Ganzfeld rooms, light projections, Aten Reign (Guggenheim rotunda, 2013), and Roden Crater.

Technique: real light in built spaces. A Skyspace makes the sky look "stretched like a canvas across an opening in the ceiling" (New York Times, quoted on Wikipedia). A Ganzfeld room is "an unstructured, uniform stimulation field": no visible edges and no visible source. The Guggenheim describes Aten Reign as "Red light projected in concentric rings, with a progressive lightening of intensity in the color of each ring towards the center." At the Walker's Sky Pesher, LEDs replaced cold cathode tubes in 2023 to allow more colors. The research report recalls the rings being fabric lit by LEDs; that is not verified.

What we take: color fields with no visible source and no edges, which is why Sunset has no shapes; and concentric rings that get lighter toward the center, which is what `sunset-red-yellow-arcs` and `contour-yellow-halo` show.

Links: [Guggenheim exhibition](https://www.guggenheim.org/exhibition/james-turrell), [Wikipedia: James Turrell](https://en.wikipedia.org/wiki/James_Turrell), [Wikipedia: Ganzfeld effect](https://en.wikipedia.org/wiki/Ganzfeld_effect).

### Olafur Eliasson

What he made: The Weather Project (Tate Modern, 2003), Room for one colour (1998), Beauty (1993).

Technique: for The Weather Project he "used humidifiers to create a fine mist in the air via a mixture of sugar and water, as well as a semicircular disc (reflected by the ceiling mirror to appear circular) made up of hundreds of monochromatic lamps which radiated yellow light." Room for one colour is a corridor lit by low-pressure sodium lamps, so everything turns one yellow. Beauty is a rainbow made by a spotlight shining through falling mist.

What we take: haze is what makes light visible, so the beam recipe needs a haze term. A sun seen through mist is a wide, flat glow rather than a sharp disc (Sunset's "flat glow"). One dominant color reads stronger than many (Sunset's "one warm color at most").

Links: [Wikipedia: Olafur Eliasson](https://en.wikipedia.org/wiki/Olafur_Eliasson).

### Anthony McCall

What he made: Line Describing a Cone (1973) and the later "solid light" works; vertical works starting with Breath (2004); slanted beams in Coming About and Crossing (2016).

Technique: a projector draws a slowly growing circle on a wall. Dust and cigarette smoke, later fog machines, make the beam visible as a cone. When the work was shown in Lund, the clean Swedish air made it invisible. The later works use digital projection. In the vertical works a ceiling projector points straight down, making a "ten-metre-tall, tent-like" volume of light with a footprint on the floor. In the slanted works two beams meet in one footprint.

What we take: `contour-beam-pool` is a small version of a McCall vertical work, a beam through haze with a bright footprint where it lands. Beam brightness depends on haze density, the footprint is the brightest part, and the beam's edges are soft.

Links: [Wikipedia: Line Describing a Cone](https://en.wikipedia.org/wiki/Line_Describing_a_Cone), [Wikipedia: Anthony McCall](https://en.wikipedia.org/wiki/Anthony_McCall).

### Mark Rothko

What he made: the "multiforms" (1946 to 1949) and, from 1949, stacked rectangles of color with soft edges.

Technique: he "applied a thin layer of a binder mixed with pigment directly onto uncoated and untreated canvas and painted significantly thinned oils directly onto this layer", and made "the various layers of the painting dry quickly, without mixing of colors". Wikipedia describes the multiforms as "blurred blocks of various colors", and a green bar in one painting that "appears to vibrate against the orange around it, creating an optical flicker."

What we take: build bands as stacked translucent layers, not per-pixel averages of colors; give band edges uneven softness; let neighboring bands glow against each other. This is the `sunset.bands` recipe.

Links: [Wikipedia: Mark Rothko](https://en.wikipedia.org/wiki/Mark_Rothko).

### Hiroshi Sugimoto

What he made: Seascapes (from 1980): sea and sky in black and white, the horizon exactly in the middle. Theaters (from 1978): one exposure for a whole film, so the screen is a white glow. Architecture (from 1997): buildings photographed out of focus. Opticks (from 2009): prism light photographed on Polaroid.

Technique: "an old-fashioned large-format camera to make exposures of varying duration (up to three hours)". He built a "simultaneous vertical-horizontal agitator" to stop the Seascape negatives developing unevenly. For Architecture he set the focus to "twice-infinity". For Opticks, sunlight passes through a prism onto a mirror that he tilts by hand into a dim room, where he photographs single hues on Polaroid: "With light as my pigment", and "Particularly when the colors fade and fuse into darkness, the gradation seems to melt away into pure mystery." He also writes that he could "discern many more different colors in between" Newton's seven. Speculation: the long exposures smooth the water into a flat tone.

What we take: a horizon can be the only structure in an image. Long smooth gradients need even processing; for us that means float buffers and dither. Defocus is a tool, not a defect. For Warp Speed, Opticks shows spectral color fading into dark, and the "nameless hues" between named colors are the pale bridges the brief asks for.

Links: [Wikipedia: Hiroshi Sugimoto](https://en.wikipedia.org/wiki/Hiroshi_Sugimoto), [Seascapes](https://www.sugimotohiroshi.com/seascapes-1), [Colors of Shadow](https://www.sugimotohiroshi.com/colors-of-shadow) (the agitator), [Polarized Color](https://www.sugimotohiroshi.com/polarized-color), [Opticks](https://www.sugimotohiroshi.com/polarized-color-1).

### Jeremy Blake

What he made: the painted abstract interludes in Paul Thomas Anderson's Punch-Drunk Love (2002), and "time-based paintings" shown as projected DVD installations (the Winchester series, SFMOMA, 2005).

Technique: his time-based paintings combined hand-painted imagery, film footage and vector graphics into slowly changing color fields (SFMOMA). The New York Times called the interludes "trippy, fluid sequences of abstract art" (quoted on Wikipedia). The Japanese Punch-Drunk Love poster on our Sunset moodboard credits "ARTWORK JEREMY BLAKE"; we have not confirmed who designed the poster's layout.

What we take: very blurred bands of color (`sunset-film-poster-bands`, horizontal) and soft columns (`warp-film-poster-columns`, vertical). Each band changes brightness along its length, edges wave, and dark bands sit inside the stack without making the blends between bands muddy.

Links: [Wikipedia: Jeremy Blake](https://en.wikipedia.org/wiki/Jeremy_Blake), [Wikipedia: Punch-Drunk Love](https://en.wikipedia.org/wiki/Punch-Drunk_Love), [SFMOMA exhibition page (archived)](https://web.archive.org/web/20080518205713/http://www.sfmoma.org/exhibitions/exhib_detail.asp?id=200).

## Graphics programmers and products

### Inigo Quilez

What he made: Shadertoy (co-creator) and long-running articles on rendering.

Technique: all light math in linear RGB, gamma applied once at the end. Horizon glow: the fog color moves from blue to warm yellow with `pow(dot(viewDir, sunDir), 8)`, with a separate exponential falloff per color channel. `pow(vec3(shadow), vec3(1.0, 1.2, 1.5))` turns one falloff value into a warm red-orange fringe.

What we take: per-channel falloff gives warm, ordered fringes on horizons, rims and halation. A sun-direction term makes a glow brighter on one side, as in `sunset-sky-peach`.

Links: [fog](https://iquilezles.org/articles/fog/), [outdoor lighting](https://iquilezles.org/articles/outdoorslighting/).

### Matt DesLauriers

What he made: generative prints (Subscapes) and open-source shader tools.

Technique: palettes picked in Oklab's polar form (fixed lightness, limited chroma, any hue) and from real riso ink colors. He found low-contrast palettes looked "dull and washed out". His film grain is 3D noise blended with soft light that fades out in bright areas.

What we take: grain that depends on brightness, for the riso references and the Grain filter; judge palettes in Oklab.

Links: [Subscapes part 3](https://mattdesl.substack.com/p/subscapes-part-3), [glsl-film-grain](https://github.com/mattdesl/glsl-film-grain).

### Jason McGhee: 2D light simulation in the browser

What he made: write-ups that rebuild 2D global illumination in WebGL, first as noisy ray marching (the method Lieberman describes), then noise-free with radiance cascades (a method by Alexander Sannikov).

What we take: physically based 2D light, with soft shadows and light spreading through a scene, runs in WebGL. It costs the most of anything here and suits still images.

Links: [part 1](https://jason.today/gi), [part 2](https://jason.today/rc).

### Paper Design shaders (paper.design)

Technique, read from the source code:

- Mesh Gradient: each pixel averages up to 10 colored points weighted by `1/d^3.5`, after sine and swirl warps, on raw sRGB values. Paper ships an OKLCH mixing helper, but none of the gradient shaders checked use it.
- Grain Gradient: noise is added before the color band is chosen, so the grain forms the band edges. That gives the riso look. Grain size is fixed in pixels.
- God Rays: noise sampled along the angle around a center. A "bloom" slider fades from normal to additive blending. A random dither of plus or minus half a step hides banding.

What we take: add noise before choosing a band to get riso-like band edges; dither by half a step before 8-bit output. Avoid weighted averages of many colors in sRGB.

Links: [paper-design/shaders](https://github.com/paper-design/shaders).

### Stripe homepage gradient (what to avoid)

Technique (from reverse-engineered copies): a tilted plane bent by simplex noise. About three colors are mixed per vertex through `pow(smoothstep(noise), 4)` masks, in sRGB, with no light model and no grain.

What we take: this is the "Instagram gradient" the brief rules out. Noise blobs, colors averaged in sRGB, no light.

Links: [Kevin Hufnagl](https://kevinhufnagl.com/how-to-stripe-website-gradient-effect/), [whatamesh](https://github.com/jordienr/whatamesh).

### Blender AgX (Troy Sobotka)

Technique: Blender's notes say "bright colors go towards white, similar to real cameras." The steps are an inset matrix on linear RGB, a log2 encode over about 16.5 stops, a sigmoid curve, then the inverse matrix. A GLSL port is about 30 lines, and three.js ships `AgXToneMapping`.

What we take: the idea of a path to white for light above nominal. AgX on its own changes every color, mid-tones included, so it cannot keep pack hexes exact at nominal. Our curve has to be exact up to nominal and only then roll toward white.

Links: [Blender 4.0 notes](https://developer.blender.org/docs/release_notes/4.0/color_management/), [minimal GLSL](https://iolite-engine.com/blog_posts/minimal_agx_implementation).

### Dehancer and spektrafilm (film emulation)

Technique: halation is light bouncing back into film's red-sensitive layer. Brighter light also reaches the green layer, so halos are orange near the source and red farther out. They show "only against the darker backgrounds." Dehancer's bloom "inherits the hue and saturation of a light source", and its grain is driven by the local brightness of the image. spektrafilm sets a separate halation blur size and strength for each color channel.

What we take: Contour's halation is warm, wide, set per channel and strongest against dark. Grain responds to brightness.

Links: [Dehancer: halation](https://www.dehancer.com/learn/learn_articles/halation-in-dehancer), [spektrafilm](https://github.com/andreavolpato/spektrafilm).

### Game-engine bloom and light shafts

Technique: Unreal adds five Gaussian blurs at 1/2 to 1/32 resolution, each with its own tint. Call of Duty: Advanced Warfare blurs the whole HDR image with no brightness threshold and mixes about 4% of the blur back in. GPU Gems 3, chapter 13, blurs each pixel along a line toward the light's position on screen.

What we take: a bloom pyramid with a tint per level gives a core, a glow and haze. No threshold means no visible ring where bloom starts. A radial blur pass makes beams and converging streaks.

Links: [Unreal](https://dev.epicgames.com/documentation/en-us/unreal-engine/bloom-in-unreal-engine), [LearnOpenGL](https://learnopengl.com/Guest-Articles/2022/Phys.-Based-Bloom), [GPU Gems 3](https://developer.nvidia.com/gpugems/gpugems3/part-ii-light-and-shadows/chapter-13-volumetric-light-scattering-post-process).

### Björn Ottosson (Oklab)

Technique: he shows that "sRGB darkens colors significantly when mixing saturated opposing colors"; mixing in linear RGB gives a brighter midpoint; Oklab keeps lightness even and is now Photoshop's default for gradients.

What we take: mix light in linear RGB; use Oklab to measure and to ease, not to mix light.

Links: [color mixing](https://bottosson.github.io/posts/colorwrong/), [Oklab](https://bottosson.github.io/posts/oklab/).

### Checked and not needed

- Figma shader fills and effects (WGSL): fill shaders make pixels, effect shaders change the layer below. The detail comes from Figma's plugin documentation for AI tools; the public [release notes](https://www.figma.com/release-notes/) only confirm that shaders exist.
- TouchDesigner's [Feedback TOP](https://docs.derivative.ca/Feedback_TOP) is the same loop as Lieberman's color painting.
- Apple wallpapers: `sunset-violet-wave` looks like one, but no technical write-up was found.

## Techniques ranked for Sunset and Contour

1. Add light in linear RGB, then apply a tone curve that rolls bright light toward white. Overlaps get brighter instead of muddy.
2. Bloom at several blur sizes, each with its own tint. This gives Contour its falloff and halos, and it is also how Sunset's "bands blurred hard" can work.
3. A different falloff per color channel, for warm, ordered fringes on horizons, rims and halation.
4. Brightness from the distance to one source shape (a distance field; jump flood builds one for any shape), for rims, rings, arcs and light lines.
5. Poisson or diffusion fill, to spread a few colored seeds over the whole frame with no visible shapes. A uniform input stays uniform.
6. Radial blur toward a light, for beams, floor pools and streaks converging on a horizon.
7. Grain that depends on brightness, plus dither. This gives the riso look and stops long ramps from banding. Grain is added at output size.
8. Stacked translucent bands instead of per-pixel color averages, as Rothko did.
9. Feedback displacement, to warp the horizon and smear bands. Fix the seed and the number of steps so exports repeat exactly.
10. 2D light simulation (radiance cascades): the most convincing beams and soft shadows, the highest cost; best for stills.

For Warp Speed, the closest leads are Lieberman's chromatic aberration in flares, per-level bloom tints, Sugimoto's Opticks, and [Zucconi's formulas for turning wavelengths into RGB](https://www.alanzucconi.com/2017/07/15/improving-the-rainbow/).

## Why gradients look muddy

- Mixing in sRGB darkens the midpoint between saturated opposite colors ([Ottosson](https://bottosson.github.io/posts/colorwrong/)). Mixing in linear RGB keeps it brighter.
- Averaging many colors per pixel, as Paper's and Stripe's mesh gradients do, pulls in-between pixels toward the palette's average, which is grey when the palette spans opposite hues. This is an inference from the math.
- Clipping flattens bright saturated colors and shifts their hue. A tone curve can move them toward white instead.
- Long 8-bit ramps band. Mikkel Gjøl calls banding "most noticeable on anything creating gradients: fog, falloffs, glow" ([talk slides](https://loopit.dk/banding_in_games.pdf)). Noise added to each channel before 8-bit output fixes it.

How the artists avoid it:

- Turrell, Eliasson and McCall use real light, so overlapping colors add up.
- Rothko never mixes his layers while they are wet.
- Lieberman treats his colors as light sources.
- Film and AgX turn extra light into white or a warm halo.
- Real skies lose blue first, so the middle of a sunset ramp is pale and bright, not grey-dark. Quilez's per-channel falloff reproduces this, and our references show it: in `sunset-sky-peach` the blue-to-peach bridge drops to near-zero chroma while its lightness keeps rising (see `BRIEF.md`, section 6).

## Not found or not verified

- Which color space Lieberman mixes in, and the formula behind his cone gradients.
- Whether his atmosphere shader is `glsl-atmosphere` (speculation).
- How Turrell built the rings in Aten Reign (the report's "fabric lit by LEDs" is from memory).
- Who designed the Japanese Punch-Drunk Love poster's layout (it credits Blake for the artwork).
- How Apple makes its wallpapers.
