<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

3D mode and the Meta symbol were removed on 2026-11-02 by owner decision. Do not bring them back unless the owner asks.
Later on 2026-11-02 the owner asked for crops of the Meta logo outline as Contour light shapes. Use the official path from git history (`git show 5efa956^:public/icon-fill.svg`). Never show the whole logo, and no 3D.

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
- Build systems, not copies. Shapes, light and packs combine with the
  seed into endless backgrounds. The moodboard references test whether
  the system reaches the needed quality; matching them is not the goal,
  so no special cases that only serve one reference.
- Light behaves like real light, or close to it. Light from every point
  of a source adds up, seen through haze and a lens. No glow computed
  from the distance to the nearest edge: it makes creases at corners
  and pinch points that real light never has.
- Reference images are visual targets only. Never feed reference pixels
  to the renderer.
- Every visual change gets a visual audit: render it, put it next to the
  target, and look at the images. Code checks are not enough.
- Sunset and Contour first. Warp Speed later. Filters (Grain, ASCII,
  Pixel) after the gradients are locked down.
- Controls stay minimal for non-designers: Intensity, Softness, one
 control per mood, and Shuffle (no Seed slider and no Back button; owner,
 2026-11-06). The panel labels Intensity and the filter's slider both
 "Strength" (owner, 2026-11-06); their keys stay `intensity` and
 `density`. Mood and Look are picked from small pictures, Filter from
 icons and Format from shapes, each with its name, not dropdowns; the
 pictures are fixed renders from `scripts/light/panel-pictures.mjs`, not
 live. Each mood's first look is the one on its Mood picture and the one
 picking the mood switches to (Sunset: Bands, Contour: Halo). No free color pickers:
 Colors shows each pack as a strip of its exact hexes, and you pick a
 pack. Filter sits near Format at the bottom of the panel.
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
  first drag (`src/tool/Preview.tsx`). Keep it. Since 2026-11-06 it shows on
 every page load, not once per browser (owner).
