<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

3D mode and the Meta symbol were removed on 2026-11-02 by owner decision. Do not bring them back unless the owner asks.
Later on 2026-11-02 the owner asked for crops of the Meta logo outline as Contour light shapes. Use the official path from git history (`git show 5efa956^:public/icon-fill.svg`). Never show the whole logo, and no 3D.
Contour's Halo layout of separate circles (a big ring with smaller rings beside it) was removed on 2026-11-11 by owner decision ("dont think we need this one"). Do not bring it back unless the owner asks.

## Backgrounds are light (owner directive, 2026-11-02)

- Every background is light. Add light in linear RGB so colors blend
  seamlessly without mud: the bridge between two hues is lighter, never
  darker than both sides; every edge is soft; bright light goes smoothly
  to white.
- Boundaries between colors are organic. They curve, drift and change
  softness along their length, and neighbouring boundaries are not
  parallel. No straight, ruler-like or evenly spaced boundaries.
- Use the exact pack hexes from Figma slide 33:200, in pack order. Packs
  never mix.
  - Bold: Meta Blue `#0064E0`, Cyan `#1FCDF0`, Yellow `#FFD61E`,
    Orange-red `#FF4F00`
  - Elemental: Meta Blue `#0064E0`, Lime `#D6F26C`, Forest `#0F3D33`,
    Tan `#B8996E`, Plum `#4A0A3C`
  - Atmospheric: Meta Blue `#0064E0`, Ice `#F2F4F7`, Steel `#6A7788`,
    Slate `#384753`, Near-black `#1C2B33`
- Changing the color pack keeps the design (owner, 2026-11-09): the same
  mood, seed, drag and format give the same shapes, light positions and
  light and dark layout in every pack, and only the colors change. Shuffle
  gives a new design. One exception (owner, 2026-11-10): where two colors
  far apart in hue meet, the light along that thin meeting line rises so
  the meeting reads lighter instead of grey, and how much it rises may
  differ by pack. Shapes, light positions and the light and dark layout
  stay the same. The Meta Blue toggle and the mix control, once
  built, also change only the colors.
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
  ASCII on 2026-11-09.
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
  fixed value, now that its slider is gone. Mood is picked from
  small pictures, Filter from icons and Format from shapes, each with its
  name, not dropdowns; the pictures are fixed renders from
  `scripts/light/panel-pictures.mjs`, not live, in the Atmospheric pack
  whichever pack is picked. No free color pickers: Colors shows each pack
  as a strip of its exact hexes, and you pick a pack. Every option's name
  shows under its picture or strip, and inside the Filter and Format
  squares; a card's title has no value beside it, since the ring marks
  the pick.
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
