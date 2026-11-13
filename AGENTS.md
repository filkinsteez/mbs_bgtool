<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

3D mode and the Meta symbol were removed on 2026-11-02 by owner decision. Do not bring them back unless the owner asks.
Later on 2026-11-02 the owner asked for crops of the Meta logo outline as Contour light shapes. Use the official path from git history (`git show 5efa956^:public/icon-fill.svg`). Never show the whole logo, and no 3D.
Contour's Halo layout of separate circles (a big ring with smaller rings beside it) was removed on 2026-11-11 by owner decision ("dont think we need this one"). Do not bring it back unless the owner asks.
On 2026-11-12 at 8:26 AM the owner asked for no major changes ("i think we're getting into a decent place so i dont want any major changes going in. i feel like we were flip flopping on quality yesterday"). The pictures at git tag `saved-2026-11-12` are the baseline. Only small fixes go in, each shown to the owner next to the baseline first. Rush's fixed color order and the Sunrise Elemental top-edge fix stay out unless he asks for them.

## Backgrounds are light (owner directive, 2026-11-02)

- Every background is light. Add light in linear RGB so colors blend
  seamlessly without mud: the bridge between two hues is lighter, never
  darker than both sides; every edge is soft; bright light goes smoothly
  to white.
- Boundaries between colors are organic. They curve, drift and change
  softness along their length, and neighbouring boundaries are not
  parallel. No straight, ruler-like or evenly spaced boundaries.
- Use the exact pack hexes from Figma slide 33:200. Packs never mix.
  Each pack's colors go in hue order, so colors that are neighbours on
  the color wheel sit next to each other (owner, 2026-11-11, concept
  file node 193:160: "Order the bands by hue, and every blend stays
  clean"). The pictures and the color slider use this order, and the
  pack strips match it. Elemental no longer starts with Meta Blue;
  Atmospheric steps through lightness.
  - Bold: Meta Blue `#0064E0`, Cyan `#1FCDF0`, Yellow `#FFD61E`,
    Orange-red `#FF4F00`
  - Elemental: Tan `#B8996E`, Lime `#D6F26C`, Forest `#0F3D33`,
    Meta Blue `#0064E0`, Plum `#4A0A3C`
  - Atmospheric: Meta Blue `#0064E0`, Ice `#F2F4F7`, Steel `#6A7788`,
    Slate `#384753`, Near-black `#1C2B33`
  - Primary (owner, 2026-11-12, concept file node 188:68; first in the
    panel, while a plain link still opens on Bold): White `#FFFFFF`, Meta
    Blue `#0064E0`, Near-black `#1C2B33`, in lightness order. Its White and
    Near-black have their own ramps, so Near-black deepens through
    slate-blue, not teal, and Atmospheric's Near-black is unchanged.
- Colors that are neighbours in the hue order blend through the color
  between them, as on the owner's slide (owner, 2026-11-11): Cyan fades
  through green into Yellow, and Meta Blue through indigo into Plum. The
  blend keeps its color and never goes grey or brown. For neighbours this
  replaces the lighter bridge and the lighter meeting line.
- Changing the color pack keeps the design (owner, 2026-11-09): the same
  mood, seed, drag and format give the same shapes, light positions and
  light and dark layout in every pack, and only the colors change. Shuffle
  gives a new design. One exception (owner, 2026-11-10): where two colors
  far apart in hue meet and are not neighbours in the hue order, the
  light along that thin meeting line rises so
  the meeting reads lighter instead of grey, and how much it rises may
  differ by pack. Shapes, light positions and the light and dark layout
  stay the same. The color sliders, like the pack, change only the
  colors.
- The color sliders set the picture's color makeup: each color covers its
  set share of the picture's colored area (owner, 2026-11-11: "as long
  as the sliders represent the color makeup and they're as close as
  possible to the actual color swatches thats fine").
  - A color takes the light nearest its own swatch first and reaches into
    brighter or dimmer light only as far as its share needs, in paler or
    deeper shades of itself that stay as close to the swatch as that
    light allows.
  - Cranking a slider must make the picture mostly that color, near its
    swatch, in every mood.
  - Black backgrounds don't count toward any color.
  - On 2026-11-11 at 6:03 PM the owner had the color stage rolled back to
    the 2:36 PM version (28a0ebd2), which he had said "feels more inline
    with expected behavior". The later versions broke the gradient
    elsewhere ("the gradient and control is still fucked. it was working
    earlier today"). Change the stage only in small steps, each shown to
    the owner on a full before-and-after sheet before it lands.
  - In Contour no color paints the faint haze far from the rim in a deep
    shade of a light color. Counting shares by area over all the haze had
    painted small colors over the dark top as a maroon field ("looking
    splotchy as hell"). The fix of 7:00 PM (a9aadb02) counted shares by
    light instead, but it lost the warm colors along the rim, Elemental's
    purple haze and Atmospheric's blue arc. At 8:50 PM the owner chose to
    build out Research's proposal (report 5): near the rim colors count by
    area again, and the haze far from strong light goes to Meta Blue's dim
    glow or a darker pack color that suits it (Plum, Forest) and counts
    toward no share. It lands only after he sees it side by side. On
    2026-11-12 at 7:20 AM, after a hard refresh of his browser, the owner
    said the current Contour (a9aadb02) "looks way better now. we can keep
    whats in there currently", so that build-out is on hold.
- Small changes give small changes (owner, 2026-11-11: "colors pop in and
  out from really small adjustments"). A slider step or a drag of a few
  pixels changes the picture in proportion. No color appears or
  disappears, and nothing swaps sides. Every choice the stage or a look
  makes blends over a range instead of switching. The line sweep and a
  slider-step sweep show no color jumps.
- Dragging moves the light and keeps the picture's colors (owner,
  2026-11-11: "dragging control to change color often overrides all
  original colors to just meta blue it should retain its original"). The
  pack colors a seed shows at its default view stay in the picture under
  any drag; a drag never turns them into Meta Blue.
- The color stage is always on, with no user setting (owner, 2026-11-11:
  "should be on and not a setting surfaced to users"). The preview, the
  export and the history all render through it.
- Build systems, not copies. Shapes, light and packs combine with the
  seed into endless backgrounds. The moodboard references test whether
  the system reaches the needed quality; matching them is not the goal,
  so no special cases that only serve one reference.
- Light behaves like real light, or close to it. Light from every point
  of a source adds up, seen through haze and a lens. No glow computed
  from the distance to the nearest edge: it makes creases at corners
  and pinch points that real light never has.
- No light at pinch points (owner, 2026-11-09: "no light at these pinch
  points for contour rim"). Along a Contour outline the light fades to
  dark before a sharp tip or a corner that turns sharply, and the hot
  spot stays on smooth stretches.
- Forms are soft, organic and rounded, never hard or angular (owner,
  2026-11-10: "forms should be soft, organic, rounded, not hard and
  angular"). No straight runs, sharp corners or pinch points in a shape.
  Blur is soft and smooth, never streaky, and each color's light spreads
  into the colors around it.
- Reference images are visual targets only. Never feed reference pixels
  to the renderer.
- Every visual change gets a visual audit: render it, put it next to the
  target, and look at the images. Code checks are not enough.
- Sunrise (the old Sunset) and Contour first, then Rush (the old Warp
  Speed; its moodboard is node 4:439 of the concept file; the owner
  started it on 2026-11-09). Filters: Grain and Pixel. The owner removed
  ASCII on 2026-11-09, and a Paper filter on 2026-11-12 ("no paper"); don't
  bring either back unless he asks.
- Sunrise's gradient follows the drag arrow at any angle, like a design
  tool's gradient tool: its bands cross the frame at right angles to the
  arrow and stack along it (owner, 2026-11-11: "here i'm dragging left to
  right and the gradient is drawing bottom to top. it should follow the
  drag direction of the arrow"). The horizon tilt limits of 2026-11-04 no
  longer apply to Sunrise. The owner repeated it on 2026-11-11 at 2:46 PM:
  "sunrise drag control is not respecting drag direction again. i thought
  we fixed this? fix it."
  - The light is strongest where the drag starts and runs along the arrow;
    at the arrow's end the gradient has reached its far colors.
  - Drag left to right: upright bands, stacked left to right.
  - Drag bottom to top: level bands, stacked bottom to top.
  - Drag on a diagonal: bands at right angles to that diagonal, stacked
    along it. Drags from a corner give bands across the frame, not fans or
    a V.
  - The bands stay organic: they curve and drift and are never parallel.
  - A drag never changes which colors show or their shares.
  - The tilt comes from the drag only; seeds don't tilt the default view
    (owner, 2026-11-12: "tilt should be controlled by drag not random seed").
  - A test in the repo checks the direction. Don't change Sunrise's drag
    handling unless it passes.
  - The colors lie along the arrow in a fixed order for each pack: the
    pack's lighter end at the drag start, its dark end toward the arrow's
    end and on the dim ground at the start (navy in Bold), never brown or
    maroon. A small drag or slider step never flips the order (76cadf81,
    approved by the owner on 2026-11-11 at 8:43 PM after his report at
    7:07 PM: "unpredictability with spots and color direction flips of
    the gradient").
  - With Meta Blue set low, the dim far side of the picture turns navy
    instead of light colors stretching into it, and that navy counts
    toward no color's share, so Yellow and Cyan meet through green, not
    olive (owner, 2026-11-12). The owner accepted that the Meta Blue
    slider then barely changes the picture between about 5% and 28%.
- Rush is soft, with its light smeared along each band like a long
  exposure (owner, 2026-11-11, approving the round 27 candidate: "Yes,
  this is it"). A few seeds may look alike in Rush ("OK, a few
  near-repeats are fine"), so its alike check is reported, not a gate.
  Which way Rush's colors run comes from the pack's default mix, so a
  slider step never flips them (owner, 2026-11-12).
- Owner feedback of 2026-11-09 (concept file node 86:380) changes the
  panel:
  - Three moods, each one option with no Look picker: Sunrise, Contour
    and Rush. Each mood's looks merge into one look that keeps some
    variety, with fewer variations so the results look branded. Code ids
    such as `sunset.bands` stay.
  - Controls stay minimal for non-designers: Shuffle, and the filter's
    Strength. The light's Strength slider (removed by the owner later on
    2026-11-09), Softness and the mood controls (Light position, Horizon)
    are gone, and looks are softer in general. No Seed slider (owner,
    2026-11-06).
  - The panel is four numbered steps, top to bottom: "1. Pick a color
    pack" (the pack strips, then the color control once built), "2. Pick
    a mood" (the moods, then Shuffle), "3. Apply a filter" (None, Grain,
    Pixel and the filter's Strength), "4. Export" (Format and the Export
    button).
  - Color is the biggest piece of feedback: the pack's colors aren't
    represented properly. Build a simple control that changes the
    percentage of each pack color in the picture (a Meta Blue on/off
    toggle is asked for too). The picture must show those percentages,
    and the design stays the same. Contour shows more of the pack's
    colors, where light would naturally put them. By default Meta Blue
    is at least half of the picture (50%) and the pack's other colors
    share the rest evenly (owner, 2026-11-09, 10:03 PM). Colors come
    first: every picture shows all of its pack's colors before the
    control goes into the panel (owner, 10:01 PM). Meta Blue is never
    just a solid field behind the other colors: it carries light, with
    its own glow and gradients, and the other colors don't take all the
    attention (owner, 10:05 PM).
  - A history of recent backgrounds is wanted: build a first version and
    change it with the owner's feedback. It replaces the 2026-11-06 "no
    Back button" rule.
  - Type: a toggle that showed a sample headline over the preview was
    tried and removed by the owner on 2026-11-09. Don't bring it back
    unless the owner asks.
- Still in force from 2026-11-06 (owner): the filter's Strength slider
  keeps the key `density`; the engine's `intensity` input stays, at a
  fixed value, now that its slider is gone. With Pixel picked, the slider
  reads "Density": its low end gives bigger pixels and its high end
  smaller ones (owner, 2026-11-11: "for pixel strenght the slider is
  backwards bigger at the bottom. smaller at the top and relabel slider
  from strength to density"). Pixel's blocks take the pack color that
  covers most of each block, not a washed-out average, and come in three
  sizes on one grid: bigger where the picture is flat, smaller where the
  light or bands change. The design sets the sizes, so the color sliders
  never move them (owner, 2026-11-12, approving it side by side: "i like
  the right column"). Grain's slider still reads "Strength". Mood is picked from
  small pictures, Filter from icons and Format from shapes, each with its
  name, not dropdowns; the pictures are fixed renders from
  `scripts/light/panel-pictures.mjs`, not live, in the Atmospheric pack
  whichever pack is picked. No free color pickers: Colors shows each pack
  as a strip of its exact hexes, and you pick a pack. The strips sit in two
  rows of two (owner, 2026-11-13: "can you make the color palettes 2 rows
  of 2?"). Every option's name
  shows under its picture or strip, and inside the Filter and Format
  options. The Filter and Format options are rectangles of equal width
  that fill their row (owner, 2026-11-11: "can we have these be
  rectangular so they split the space more evenly?"). A card's title has
  no value beside it, since the ring marks the pick.
- Brief: `docs/light/BRIEF.md`. Roadmap: `docs/light/ROADMAP.md`.

## This is a RASTER tool (owner directive)

- This is a raster graphics background creator. There is no need for
  vector/SVG output, vector-crisp purity, or designs constrained to
  vector-friendly primitives — do not bake that in.
- Per-pixel and per-cell raster effects (dithers, grain, halftones,
  pixel textures) are the native medium and are preferred.

## Plain language only (owner directive)

- No poetic or marketing phrasing anywhere: chat replies, commit
  messages, comments, docs, UI copy. Say what the code does in plain
  words ("old saves get the new colors when the page loads", not
  "sessions self-heal").

## No status badges or explanatory chrome (owner directive)

- Never add passive UI labels, status badges, or explanatory meta text
  ("Custom mix", "Generic previews", "Relative weight", and the like).
  If it isn't a control or a value the user acts on, leave it out.
- One exception, asked for by the owner on 2026-11-04: the hint "Drag to
  reposition the gradient" in the middle of the preview, shown until the
  first drag (`src/tool/Preview.tsx`, `src/tool/Tool.tsx`). Keep it. Since
  2026-11-06 it shows on every page load, not once per browser (owner).
  Since 2026-11-09 using any control in the panel (pressing or clicking
  it, or a key that changes it) also hides it (owner).
- A second exception, asked for by the owner on 2026-11-09: the numbered
  step titles in the panel ("1. Pick a color pack" and the others).
- A third exception, asked for by the owner on 2026-11-12: an "i in a
  circle" at the right of the Colors card's title, with a hover tooltip
  that links to documentation ("can we add a little information icon (i
  in a circle) right aligned inline with colors that links to
  documentation – should be like a hover tool tip"). Until the owner gives
  the URL (`COLORS_DOC_URL` in `src/tool/panelPickers.tsx`), the tooltip
  only reads "documentation link here" (owner: "just a "documentation link
  here""), and that text becomes the link once the URL is set.
