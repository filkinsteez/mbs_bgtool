# The brief

The Figma deck cut down to what the build needs. Quotes are verbatim. The ID in backticks after each quote is its node in Figma file `9TlfqUvSxIonSEgmcoHFfF` ("MBS Background Tool"). Read in Figma on 2026-11-02.

Sources:

- Current deck: page `0:1` "-> Share Out 10/26" (slides `44:*`, `147:*`, `150:*`, `162:*`; moodboards `63:658` Sunset, `63:659` Contour, `63:660` Warp Speed).
- Earlier deck: page `26:2` "Concept Deck (WIP)" (slides `33:*`). It holds the color pack slide `33:200`, the Simple Sunset slide `33:101`, and three lines the current deck left out: Contour's and Warp Speed's "must not" lines and the flow line. It also has a fourth mood, Trails (`33:122`), which the current deck removed. Do not build Trails.
- `MBS Transform— Replacing the Gradient.pdf` at the repo root holds the stakeholders' feedback notes (September and October 2026), not the deck. It is the source of the aspect ratios and of the older brand hexes listed in section 5.

## 1. Context

What the deck says the project is for (`147:885`):

- "We've deprecated the Meta Gradient"
- "This will cause a gap in the system that needs to be filled at scale"
- "The Background Tool allows teams at large to replace the gradient at scale"
- "Awe is the new emotional northstar"
- "We're introducing color packs to the brand system"

How the deck frames it:

- Awe: "Awe is a specific thing. It's the gut-level realization that your frame of reference suddenly just expanded, that the world is bigger, more connected, or even more possible than you thought. […] Awe is the feeling that anyone experiencing the Meta brand should walk away with." (`44:46`)
- Who it is for: "Awe is the feeling every Meta surface is asked to deliver, and most surfaces are made by people who aren't designers. This tool exists for them. Every background it produces is on-brand by construction and calibrated to one of three volumes of awe, so the only decision left is how much the background has to carry. The rest is handled." (`150:1053`)
- Why light: "Light is what awe looks like in the world." (`162:1139`) "Light triggers awe. Not a shape, metaphor or pattern." (`162:1140`) "Every awe image in the positioning deck is a light phenomenon. The backgrounds borrow the trigger, not the photo." (`162:1143`)
- Title slide: "Backgrounds built from light" and "Awe, light, three moods, three layers." (`44:37`, `44:38`)

For the build this means: the tool makes images of light and nothing else (no shapes, patterns or symbols), and every output has to be on-brand without the user making design decisions.

## 2. Principles

1. "Every background is light. One phenomenon, not a library of styles." (`44:84`)
   Build one light engine. Moods and recipes are settings of that engine, not separate effects.
2. "The glasses are a lens, and a lens is a machine for catching light. Every background is light, seen the way a lens sees it." (`162:1145`)
   Lens behavior (bloom, halation, defocus, bright light going to white) is part of every image.
3. "Light has no edges to fight a product shot, a logo or a headline. A non-designer cannot compose badly with it." (`162:1147`)
   Every edge is soft, large areas stay calm, and nothing reads as an object.
4. "Packs do not mix, Meta Blue leads, and the role picks the pack so the user never picks a color." (`33:203`)
   No color picker. One pack per image. Meta Blue is the first color of every pack.
5. "The Mini to Major slider is gone. The moods carry the range now, and every recipe has the same three controls: Intensity, Softness, and one control per mood." (`44:107`)
   Three sliders per recipe, plus the seed.
6. "It changes the surface, never the color." (`44:224`)
   Filters keep the image's colors.
7. "Non-designers never see a color, and the seed is always visible." (`33:197`)

## 3. The three moods

"Sunset, Contour, Warp Speed. Three distances between the light and the lens." (`44:89`) "Each one is a different distance between the light and the lens, and a different kind of awe." (`44:113`)

| Mood | Distance | Awe | Build order |
| --- | --- | --- | --- |
| Sunset | "FAR" (`44:115`) | "Awe of vastness" | now |
| Contour | "IN THE ROOM" (`44:123`) | "Awe of the reveal" | now |
| Warp Speed | "THROUGH" (`44:127`) | "Awe of transformation" | later, direction only |

### Sunset

Slides `33:101` (Simple Sunset) and `44:132`; moodboard `63:658`.

- Line: "Light at the edge of the world: the sky, the horizon, the band of color before dawn. Awe of vastness. The quiet default." (`63:665`, `44:117`)
- Slide: "Light at the edge of the world. The sky and its bands, the color before dawn. The quietest mood and the natural default." (`33:105`)
- Take: "Horizontal structure, no shapes, long smooth ramps, a little grain. Holds text on any third of the canvas." (`33:115`)
- Technique: "Soft gradient. A vertical ramp with a warped horizon line and a flat glow, or three to five stacked bands in pack order blurred hard, or no horizon at all and a few wide blooms." (`33:117`)
- Must not: "A stock sunset or an Instagram gradient. One warm color at most, Meta Blue holds the sky, and the horizon is never a ruler line." (`33:119`)
- Recipes (one per clause of the technique line): `sunset.ramp` (vertical ramp, warped horizon, flat glow), `sunset.bands` (three to five bands in pack order, blurred hard), `sunset.blooms` (no horizon, a few wide blooms).
- Owner, 2026-11-02: making the Simple Sunset look feel organic and natural, obeying real properties of light, "would be a massive step forward."

References (moodboard `63:658`; slide `33:101` shows the same images, with the riso prints rotated for layout; the moodboard orientation is the real one):

| ID | Node | What it shows | Recipe |
| --- | --- | --- | --- |
| `sunset-sky-peach` | `41:14` | Blue sky turning grey-beige, then peach, orange and deep red at the bottom; lighter on the right | ramp |
| `sunset-violet-wave` | `41:31` | Light blue sky, a near-white and pink glow above a wavy horizon on the right, violet to indigo to navy below | ramp |
| `sunset-red-yellow-arcs` | `41:15` | Maroon, red, orange, yellow, pale cream and light blue in wide arcs around a center below the frame | ramp |
| `sunset-blue-diagonal` | `41:22` | Deep blue at the top right, lavender-grey across the middle, peach and orange in the bottom-left corner | ramp |
| `sunset-film-poster-bands` | `41:25` | Japanese Punch-Drunk Love poster (credits "ARTWORK JEREMY BLAKE"): blurred red, black, blue, grey and red bands that wave and vary along their length; ignore the text | bands |
| `sunset-green-riso` | `41:26` | Riso print: paper white, green, mustard; heavy grain; ignore the fold | bands |
| `sunset-blue-riso` | `41:27` | Riso print: paper white, cyan-blue, a slate navy band, light blue; ignore the fold | bands |
| `sunset-pink-riso` | `41:28` | Riso print: cream, pink, magenta, a thin orange band with a crisper lower edge, magenta, slate purple; ignore the fold | bands |

`sunset.blooms` has no direct reference. It is built from the technique line and the packs.

### Contour

Slide `44:169` (earlier `33:138`); moodboard `63:659`.

- Line: "One light and the edge it catches: a rim, a beam, a ring. Awe of the reveal." (`63:667`, `44:125`)
- Slide: "One light and the edge it catches. A rim, a beam, a ring, a line. The product mood: the glasses-in-darkness slide, abstracted." (`44:173`)
- Take: "One source only, off-frame or at an edge, everything else dark, every edge soft. The dark two-thirds are safe for text by construction." (`44:181`)
- Technique: "Contour. A gaussian along one curve or edge, a beam through haze with a pool where it lands, or a halo cropped by the frame so it never reads as a full circle." (`44:183`)
- Must not: "A product render or a science-fiction interface. No object silhouette, no complete geometric shape, no hard edges, one source per image." (`33:154`; the current slide `44:169` leaves this line out)
- Recipes: `contour.rim` (a gaussian along one curve or edge), `contour.beam` (a beam through haze with a pool where it lands), `contour.halo` (a halo cropped by the frame).
- Owner, 2026-11-02: Contour needs natural light falloff, bloom and halation.

References (moodboard `63:659`):

| ID | Node | What it shows | Recipe |
| --- | --- | --- | --- |
| `contour-rim-edge` | `41:21` | Blue-white rim along the top and diagonal edges of a cropped rounded triangle on black; navy interior; brightest at the corner | rim |
| `contour-light-line` | `41:20` | Thin vertical line, blue at the top, white then yellow lower down, with a widening warm halo: yellow-orange on the left, red-magenta to purple on the right | rim |
| `contour-beam-pool` | `41:18` | Vertical beam through haze onto a bright floor pool, with streaks spreading on the floor; dark teal-navy elsewhere | beam |
| `contour-radial-streaks` | `41:19` | Soft blue streaks converging on a white point on a bright horizon; top right black | beam |
| `contour-yellow-halo` | `41:23` | Huge cropped halo: pale yellow arc over light blue that deepens to saturated blue; ignore the poster text | halo |
| `contour-iridescent-rings` | `41:30` | Three cropped rings with lavender, cyan and coral rims on near-black; overlaps add up to white | halo |

### Warp Speed (later)

Slide `44:188` (earlier `33:157`); moodboard `63:660`. Direction only; not a priority now.

- Line: "Light passing through glass, water or speed and breaking into its colors. The loudest mood: hero slides, not body slides." (`63:669`, `44:192`)
- Three-moods slide: "Light passing through glass or speed and breaking into its colors. Awe of transformation. The loud mood." (`44:129`)
- Take: "The pack's colors in order, as soft-edged bands on a dark base, with a direction: vertical, horizontal or curved. Meta Blue is the largest band." (`44:197`)
- Technique: "Warp speed. A refracted column with soft flame-like edges, long-exposure streaks with a white core, or wide curved spectral bands filling the frame." (`44:199`)
- Must not: "A rainbow, a flag or a phone wallpaper. Never the full spectrum: only the pack's colors in pack order, bridged through pale tints." (`33:170`)
- References: `warp-long-exposure-streaks` (`41:29`), `warp-refracted-column` (`41:9`), `warp-curved-spectral-bands` (`41:8`), `warp-film-poster-columns` (`26:486`, a Punch-Drunk Love poster with soft vertical color columns).

## 4. Layers, volumes, controls, flow, output, filters

### Three layers (`44:204`)

"A color pack, a technique, and a filter on top. The tool asks for each in turn, and the render is the sum." (`44:207`)

1. Color pack: "Bold, Elemental or Atmospheric. Picked by the role, never by the user. Packs never mix." (`44:220`)
2. Light: "One of the three light approaches: Soft gradient, contour, or warp speed." (`44:222`)
3. Filter: "Grain, ASCII or pixel, one at a time, with a strength slider. It changes the surface, never the color." (`44:224`)

### Volumes (`150:1049`)

- Everyday: "A phone lighting a face. Light under a door. Morning sun on a plaster wall. Light you notice without stopping. Quiet enough to set type on, and most of what the tool will ever make." (`150:1056`)
- Drumbeat: "A beam through a window. Headlights at dusk. The first streetlights coming on. Light with a source and a direction, enough to make you pause. Shares the page with a headline." (`150:1057`)
- Tentpole: "A stage before the show. The sky before sunrise. City lights at speed. Light you stop for. Full-bleed, and nothing else on the page." (`150:1059`)

The deck does not say how volumes map to moods or controls. Our reading, to confirm with the owner: since "the moods carry the range now" (`44:107`), Sunset ("the quiet default") is mostly Everyday, Contour ("a source and a direction") is mostly Drumbeat, and Warp Speed ("hero slides") is Tentpole.

### Controls and flow

- "every recipe has the same three controls: Intensity, Softness, and one control per mood." (`44:107`)
- "Role (which picks the pack) → Mood → Recipe → Filter and strength → Intensity and Softness → Export. Non-designers never see a color, and the seed is always visible." (`33:197`)
- The deck does not name the per-mood control and does not list the roles.

### Output

- "Rendered at 2x, filter applied last at output size, exported to the preset sizes with the seed in the file name." (`44:226`)
- The stakeholder notes PDF (pages 12 and 13) asks for 16:9, 9:16, 1:1 and 4:5, and "Resolutions up to 4K". Working preset sizes, 3840 px on the long edge: 16:9 = 3840×2160, 9:16 = 2160×3840, 1:1 = 3840×3840, 4:5 = 3072×3840. JPEG at quality 1 (the owner asked for JPG instead of PNG on 2026-11-06; quality 1 since 2026-11-10, because at 0.95 dark gradients came back as 8 px blocks; a 4K export is about 4 MB).

### Filters (`44:267`)

- "Three surface treatments over any technique with a strength slider. They change the surface, never the color or the technique." (`44:270`)
- Grain: "Fine film grain, 1 to 2 percent, applied last at output size so it never scales with the image. Doubles as dither on dark gradients. Off by default until it is settled." (`44:274`)
- ASCII: "The render re-drawn as a character grid, pack-colored text on the dark base. The developer and builder surfaces." (`44:279`)
- Pixel: "The render quantized to a coarse grid, like an LED wall seen up close. Keep the contrast low so it reads as light, not pattern." (`44:323`)
- "The ASCII and pixel tiles are stand-ins drawn in Figma; the tool renders the real thing from the frame buffer." (`44:324`)
- Owner, 2026-11-02: filters come after the gradients are locked down.

## 5. Color packs (slide `33:200`)

"The packs are the weather" (`33:202`). "Same light, three weathers. Packs do not mix, Meta Blue leads, and the role picks the pack so the user never picks a color." (`33:203`)

Hexes are the swatch fills read from Figma. The current deck's pack slide (`44:231`) uses the same twelve values. Order is the slide's left-to-right order, and it is the pack order.

### Bold (`bold`): "Blue amplified" (`33:210`)

"Sunlit and electric. Noon sun, neon, a sunrise." (`33:211`) "Where the field is crowded and attention has to be won." (`33:212`)

| # | Name | Hex | Node |
| --- | --- | --- | --- |
| 1 | Meta Blue | `#0064E0` | `33:205` |
| 2 | Cyan | `#1FCDF0` | `33:206` |
| 3 | Yellow | `#FFD61E` | `33:207` |
| 4 | Orange-red | `#FF4F00` | `33:208` |

### Elemental (`elemental`): "Blue contextualized" (`33:220`)

"Lamplight and earth. Candlelight, dusk over fields, the green of a real aurora." (`33:221`) "Where Meta's own substance is the subject and attention has to be held." (`33:222`)

| # | Name | Hex | Node |
| --- | --- | --- | --- |
| 1 | Meta Blue | `#0064E0` | `33:214` |
| 2 | Lime | `#D6F26C` | `33:215` |
| 3 | Forest | `#0F3D33` | `33:216` |
| 4 | Tan | `#B8996E` | `33:217` |
| 5 | Plum | `#4A0A3C` | `33:218` |

### Atmospheric (`atmospheric`): "Blue distilled" (`33:230`)

"Overcast, blue hour, moonlight. Frosted glass, fog, an overcast dawn." (`33:231`) "Where the hero is the product and the attention is already ours." (`33:232`)

| # | Name | Hex | Node |
| --- | --- | --- | --- |
| 1 | Meta Blue | `#0064E0` | `33:224` |
| 2 | Ice | `#F2F4F7` | `33:225` |
| 3 | Steel | `#6A7788` | `33:226` |
| 4 | Slate | `#384753` | `33:227` |
| 5 | Near-black | `#1C2B33` | `33:228` |

Rules: Meta Blue leads every pack, packs never mix, and pack order is the order of bands (Sunset bands, Warp Speed). A pack color at nominal intensity must come out of the renderer as exactly its hex.

The owner chose these slide hexes on 2026-11-02 over the older brand-card values, even though the slide itself says "Non-blue hex values were eyeballed from the brand slide. Replace them with the real ones before anything ships." (`33:233`). Do not bring back these older values:

| Older value | Source | Slide value now |
| --- | --- | --- |
| Bold Teal `#25C8EE` (`#26C8EE` in the card image) | brand card, notes PDF page 10, old registry | Cyan `#1FCDF0` |
| Atmospheric Light blue-gray `#D7E7EE` (`#D6E7EE` in the card image) | brand card, notes PDF page 11, old registry | Ice `#F2F4F7` |
| Atmospheric Medium blue-gray `#7CA0B7` (`#7CA0B8`) | brand card, notes PDF page 11 | Steel `#6A7788` |
| Atmospheric Meta gray 700 `#53606A` (`#526069`) | brand card, notes PDF page 11 | Slate `#384753` |
| Elemental Lime `#D5F57A` | old registry | Lime `#D6F26C` |
| Elemental Forest `#174A3A` | old registry | Forest `#0F3D33` |
| Elemental Sand `#B69D74` | old registry | Tan `#B8996E` |
| Elemental Plum `#410840` | old registry | Plum `#4A0A3C` |
| Bold Yellow `#FFD61E`, Orange `#FF4F00`, Atmospheric Meta gray `#1C2B33` | brand card | unchanged |
| Packs Blues (`#0064E0`, `#132682`), Primary (`#0064E0`, `#FFFFFF`), Harmonious (`#1AC5ED`, `#AF4EC5`, `#814DFF`, `#5043FF`), Neutral Flex, and the 391-color extended palette | old app | removed; not in the new tool |

The brand cards are `docs/references/bold-palette-reference.png` and `docs/references/atmospheric-palette-reference.png`. The old registry is `src/features/background-generator/palette/registry.ts` (deleted; read it with `git show d13530c:src/features/background-generator/palette/registry.ts`).

## 6. Visual attributes per mood

Colors and Oklab lightness (L, 0 to 1) below are approximate. They were sampled from the moodboard screenshots (925 px wide) with a small averaging window. They describe the references; they are not pack colors.

### Sunset

- Color
  - Cool or deep at the top, warm or pale low down.
  - Where two distant hues meet, the bridge is pale and close to grey, never darker. Sky-peach goes from blue (`#7297C7`, L 0.67) through grey-beige (`#A7ADB5` to `#BBB6AB`, chroma about 0.015, L 0.74 to 0.78) to peach (`#D0B9A1`, L 0.80). Blue-diagonal crosses lavender-grey (`#C6C6D3`, L 0.83). Red-yellow-arcs goes yellow (`#FCD12A`), cream (`#E8E084`, L 0.89), pale green-grey, light blue (`#9DD6EA`), and never through a saturated green. Violet-wave goes light blue, near-white (`#E3E6EB`, L 0.92), pink-white, violet, navy.
  - The brightest area is the warm or pale band near the horizon, not the top of the sky.
  - Production limits: "One warm color at most" and "Meta Blue holds the sky" (`33:119`).
- Light behavior
  - One wide, flat glow low in the frame or just outside it, brighter to one side. Sky-peach is lighter on the right (L 0.84 against 0.80 at the same height). Blue-diagonal's glow comes from the bottom-left corner. Red-yellow-arcs' bands curve around a center below the frame.
  - Saturation peaks just before the glow and drops inside it. Bright light goes pale, not more saturated.
  - The darkest values sit only at the far edges: deep red at the bottom of sky-peach (L 0.44), maroon at the top of the arcs (L 0.40), navy at the bottom of violet-wave (L 0.24).
- Texture and grain
  - Sky photos: almost no grain. The screenshots show some JPEG banding; do not copy it.
  - Riso prints: heavy, even, fine grain over the whole sheet, paper white at the top, soft ink edges.
  - Poster: fine print texture.
  - Production: "a little grain" (`33:115`), added at output size, plus dither so long ramps never band.
- Gradient structure
  - Lines of equal color run horizontally, or tilt and curve gently (the diagonal, the arcs, the violet-wave ridge).
  - Only large, slow changes. No small features.
  - Edge softness varies along an edge. The horizon is warped, never straight.
  - Bands: three to five, blurred hard, unequal widths. One edge can be crisper than the other (the pink riso's orange band has a soft top and a crisper bottom). Bands wave and change brightness along their length (the poster).
  - Dark bands are allowed as bands (the poster's black and grey bands). The blend between two bands is never darker than both of them.
- Composition: full-bleed. Structure spans the full width. The horizon or glow sits low or near the middle. No objects or shapes.
- Text-safe areas: "Holds text on any third of the canvas" (`33:115`). Each third is close to a single tone. Dark type goes on the pale thirds (glow band, paper white), white type on the deep ones (sky blue, navy, red).

### Contour

- Color
  - Near-black base, slightly blue (`#060A10`, `#00030A`; L 0.10 to 0.16), one light color family per image, and white where the light is hottest.
  - Rim: blue-white core on black, navy interior (`#050C1C`). Beam: a teal-blue haze column (L about 0.37) over a base at L 0.10, ending in a near-white pool (`#B2D2E5`, L 0.85). Streaks: blue to a white hot spot (`#F3F8FE`). Light line: blue at the top (`#1F648D`), pale cyan-white, then a yellow core (`#F8D655`) lower down.
  - Two references break the deck's rules. The yellow halo is light on light, not "everything else dark": pale yellow (`#FCF4A0`, L 0.96) arcing over blue that deepens to `#116FEB`, close to Meta Blue. The iridescent rings are three rings with three rim colors (lavender, cyan, coral), not "one source".
- Light behavior
  - A thin bright core with a long soft tail. On the rim the tail spreads mostly outward into the black. Falloff is more than one gaussian: a core, a glow and haze.
  - Overlapping light adds up toward white (ring overlaps are near-neutral white, L about 0.75, chroma about 0.01).
  - Halation: a warm, wide fringe around the hottest light, strongest against black. On the light line it is yellow-orange on the left and red-magenta to purple on the right, widening toward the bottom.
  - Haze makes the beam visible. The beam brightens as it nears the floor, the pool is the brightest part, and streaks spread across the floor from the pool.
  - Radial streaks converge on one white point at the horizon; the opposite corner is black.
- Texture and grain: mostly clean. The rings image has camera noise. Dark falloffs are where banding shows first, so dither matters most in this mood.
- Gradient structure: brightness falls off with distance from one curve, edge, line or point. One radial or directional structure per image.
- Composition: one source, at an edge or off-frame. Shapes are cropped by the frame so they never read as whole objects or full circles. The light covers about a third of the frame.
- Text-safe areas: "The dark two-thirds are safe for text by construction." (`44:181`) White type on the dark area.

### Warp Speed (later)

- Pack colors in pack order as soft bands on a dark base, with one direction (vertical, horizontal or curved). Meta Blue is the largest band. Neighboring colors are bridged through pale tints. Streaks have white cores.
- The references show the techniques but use the full spectrum. Production must not: "Never the full spectrum" (`33:170`).
