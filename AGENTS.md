<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## 3D Looks are render layers (owner directive, 2026-09-11)

- The owner explicitly requires: "FOR 3D ITS SUPPOSED TO BE A RENDER LAYER ON TOP NOT A MATERIAL APPLIED."
- All 3D Looks, including Gradients, operate as screen-space post-processing over the rendered scene, including its background.
- Render the 3D scene first, then apply the Look as a separate raster render layer. Use the same layer processing for preview and export.
- Do not implement a Look as a model material, UV texture, surface-normal-driven color mapping, or a treatment confined to the model's silhouette. Do not add surface shading to simulate an applied material.
- Keep 3D materials and lighting separate from the Look layer. A source-frame response is image processing, not a reason to remap the effect onto the model.
- The owner clarified: "THE LOOP SHOULD DRIVE THE BACKGROUND IN 3D." The rendered loop drives the background's spatial structure and tonal variation. Moving, rotating, scaling, or recoloring the loop must change the generated background beyond the model's original footprint.
- The Look palette and its color weights must still work in 3D. Apply those selected colors to the loop-derived image in the render layer. Do not bypass palette controls when making the loop drive the composition, or apply palette colors as a model material.
- Process the captured loop image into the background through screen-space diffusion, displacement, or stretching. Do not generate unrelated 2D gradient shapes and blend a recognizable 3D loop over or under them. An empty, uniform source must remain uniform (apart from enabled grain).

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
