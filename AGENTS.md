<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Non-negotiable Meta symbol fidelity

- The symbol must use the official canonical Meta geometry from `META_SYMBOL_PATH` exactly.
- Never mirror, rotate, approximate, redraw, or substitute the symbol.
- Orientation must match the real Meta logo at every stage (sampling, SDF bake, shader mapping, 2D, 3D, preview, export).

## This is a RASTER tool (owner directive)

- This is a raster graphics background creator. There is no need for
  vector/SVG output, vector-crisp purity, or designs constrained to
  vector-friendly primitives — do not bake that in.
- Per-pixel and per-cell raster effects (dithers, grain, halftones,
  pixel textures) are the native medium and are preferred.
- The canonical Meta geometry above is still the source of FORM; render
  it however raster techniques serve the look.

## Plain language only (owner directive)

- No poetic or marketing phrasing anywhere: chat replies, commit
  messages, comments, docs, UI copy. Say what the code does in plain
  words ("old saves get the new colors when the page loads", not
  "sessions self-heal").

## No status badges or explanatory chrome (owner directive)

- Never add passive UI labels, status badges, or explanatory meta text
  ("Custom mix", "Generic previews", "Relative weight", and the like).
  If it isn't a control or a value the user acts on, leave it out.
