# Gradients

Open **Looks → Gradients**. The selected brand palette stays in use.

The renderer builds overlapping color deposits with independent positions, footprints, density, edge focus, and color variation. It combines those deposits, then applies a separate spatially varying blur and light-scatter pass. Fine grain is added afterward. Color no longer comes from a single palette ramp stretched across a field.

- **Diffusion** uses broad overlapping deposits and softer boundaries.
- **Halo** introduces partial openings into some deposits. Their colors, focus, and footprints differ, so the result is not one set of concentric bands.
- **Flow** elongates and bends the deposits while retaining independent color regions.
- **Smear** displaces selected areas of the underlying color image in correlated horizontal strips. Its final blur is mostly horizontal to retain streak detail.

## Controls

Complexity changes deposit scale and streak density. Softness controls deposit boundaries and the final variable blur; new gradient settings start at 65%. Existing saved values are retained. Bleed controls color seepage inside deposits and wider scatter. Depth changes overlap density and edge focus without darkening the palette. Distortion, Distortion size, and Folds control spatial deformation. Grain changes fine texture.

The lead swatch supplies the ground. Other selected swatches supply the deposits, weighted by the color mix. The lead's weight changes deposit coverage. Nearby selected colors provide variation within deposits. No reference images or raster backgrounds are shipped. Mixtures produce intermediate hues and lighter transitions between opposing colors. Saturation follows the selected swatches; intentionally neutral colors remain neutral.

## Distortion brush

The brush controls sit below Complexity, the gradient settings, and Symbol. Select **Distort** below the canvas, enable **Distortion brush**, or press **B**.

- Push carries color along a drag; Twirl turns it; Inflate expands it; Restore reduces painted distortion locally.
- Size and strength are independent of the global distortion settings. Pen pressure changes strength.
- `[` and `]` change size. Alt restores. Shift reverses Twirl or Inflate.
- Escape cancels a stroke. Undo/redo treats a completed stroke as one operation.
- Clear brush strokes can be undone. Space temporarily pans; V selects the artwork; H pans.

Painting is available in 2D. Strokes remain in artwork coordinates through look, palette, seed, format, and framing changes. The cursor accounts for artwork translation, scale, rotation, canvas zoom, and pan. Strokes persist in autosave, saved looks, motion, and 4K export.

## Implementation

One reusable WebGL 2 context renders two fullscreen passes. The first composites the color deposits into an output-sized RGBA exposure texture. The second samples that texture with an uneven blur radius, blends neighboring colors while preserving their brightness, and adds grain. The result enters the existing Canvas2D preview and export pipeline.

The exact canonical Meta geometry remains the source for symbol influence; it is sampled and diffused, never redrawn. Captured 3D imagery supplies its own influence field. Brush deformation is a 192 × 192 backward displacement field with signed 16-bit coordinates packed into RGBA. Successive strokes advect the existing field. The serialized map is about 192 KiB, regardless of stroke count. Existing history is capped at 100 states.

The earlier optical-density approximation and broad shadow layers were removed after feedback that they muddied the colors. The current renderer separates brightness from hue mixing, retains saturation where hues agree, and lets opposing hues meet through lighter transitions. It avoids full saturation restoration at near-neutral crossings, which created hard rainbow outlines in rejected passes 21–22. This is an artistic color model, not a physical pigment simulation. The supplied [Are.na board](https://www.are.na/eric-filkins/mb-transform) and four additional references guided visual review.

## Visual review

Run `npm ci` and `npm run dev`. The development-only `/gradient-review` route compares four looks across three brand palettes. It exposes seed, aspect, brush study, softness, folds, bleed, and depth. **Save snapshots** re-renders before capturing, then writes individual PNGs, editable JSON looks, and a contact sheet under `.devshots/`. **Open look** in the generator loads those JSON files. The review page and snapshot API return 404 in production.

Passes 01–08 documented the earlier ramp-based renderer and brush. After feedback that those results felt one-dimensional, passes 09–20 rebuilt the color renderer. The deposit renderer still darkened and dulled colors despite sequential layering; that remained unresolved through pass 20. Later passes corrected excessive lead-color coverage, added independent internal color variation, and introduced the separate scatter pass. Seeds 1913, 9027, 14023, and 31991 were inspected in landscape and portrait.

Passes 21–25 document the color correction. Passes 21–22 were rejected internally for harsh rainbow edges; 23–24 preserved brightness with softer complementary-color transitions. Pass 25 checks a painted portrait. The visual checks are not a claim of user approval. Aggressive brush strokes and low softness can still produce tight or clearly defined shapes. More softness reduces them. The selected palette limits the available hues; a palette of closely related blues produces subtler hue variation than Bold or Harmonious.

## Verification

- 377 unit tests pass across 60 files, including gradient settings, saved looks, brush geometry, map precision, history, and palette sampling.
- TypeScript, lint, and production build pass.
- Real-browser checks cover deterministic repeats, seed changes, symbol influence, lead-color weight, every gradient control, painted distortion, motion, energy, exact loop closure, and native 4K exports. New GPU checks verify exact single-color output (blue, orange, gray, black, white within 2 channel levels without grain) and ensure bright selected swatches do not acquire dark overlaps.
- With painted portrait seed 9027, average preview/export differences without grain were 0.16, 0.17, 0.19, and 0.45 channel levels out of 255 for Diffusion, Halo, Flow, and Smear respectively.
- Four 1200-pixel render-and-readback samples per look averaged 13.5–14.8 ms on this machine. This is not a cross-device frame-rate guarantee.
- The brush's UI position was verified after the user's requested move. Earlier live checks covered painting, exact undo/redo, clear/undo, and reload persistence.

The complete legacy browser test suite was not run. Checks used the real browser through the generator and development review page.

The earlier dependency lockfile repair, no-op renderer stub type cleanup, and canonical LookId import in the browser parity test remain part of this branch. Verification was performed locally; deployment is separate.
