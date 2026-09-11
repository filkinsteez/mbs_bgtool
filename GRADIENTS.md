# Gradients

Open **Looks → Gradients**. The selected brand palette stays in use.

The renderer combines continuous color fields with independent positions, widths, deformation, and internal color variation. The fields have no opaque interior or contour threshold. Their normalized overlap determines color throughout the image. A separate spatially varying blur and scatter pass follows, then fine grain.

- **Diffusion** uses overlapping fields at different scales.
- **Halo** forms one irregular, partly open loop. Color changes around the loop while its center stays quieter. Width and focus vary around the perimeter.
- **Flow** uses long streams with independent bends, widths, and endpoints. Complexity changes stream width and secondary streams; Bleed changes color along their length.
- **Smear** displaces selected areas of the underlying color image in correlated horizontal strips. Its final blur is mostly horizontal to retain streak detail.

## Controls

Complexity changes field scale and streak density. Softness changes field width and the final variable blur; new gradient settings start at 65%. Even at zero, fields retain gradual transitions. Existing saved values are retained. Bleed controls internal color variation, saturation variation within fields, and wider scatter. Depth changes the concentration of the fields without darkening the palette. Below 45%, its expanded range reaches a nearly flat wash at zero, including at low Softness and high Complexity. The range above 45% retains the previous concentration. Internal highlights and density variation also fade toward zero Depth. Distortion, Distortion size, and Folds control spatial deformation. Grain changes fine texture.

All selected swatches, including the lead, supply fields weighted by the color mix. Halo additionally uses the lead as the ground beneath its loop. Repeated samples of a swatch cluster loosely, with smaller secondary fields elsewhere, so selected colors retain a visible region instead of averaging across the whole image. A fixed hue interval anchored to the lead gives continuous hue interpolation; brand blue blends toward warm colors through violet and pink. These intermediate hues are generated mixtures. Highlights develop inside fields instead of outlining color boundaries. Single-color recipes preserve the exact selected color without grain; neutral colors remain neutral. No reference images or raster backgrounds are shipped.

## Distortion brush

The brush controls sit below Complexity, the gradient settings, and Symbol. Select **Distort** below the canvas, enable **Distortion brush**, or press **B**.

- Push carries color along a drag; Twirl turns it; Inflate expands it; Restore reduces painted distortion locally.
- Size and strength are independent of the global distortion settings. Pen pressure changes strength.
- `[` and `]` change size. Alt restores. Shift reverses Twirl or Inflate.
- Escape cancels a stroke. Undo/redo treats a completed stroke as one operation.
- Clear brush strokes can be undone. Space temporarily pans; V selects the artwork; H pans.

Painting is available in 2D. Strokes remain in artwork coordinates through look, palette, seed, format, and framing changes. The cursor accounts for artwork translation, scale, rotation, canvas zoom, and pan. Strokes persist in autosave, saved looks, motion, and 4K export.

## Implementation

One reusable WebGL 2 context renders two fullscreen passes. The first combines the color fields into an output-sized RGBA exposure texture. The second samples that texture with an uneven blur radius, blends neighboring colors while preserving their brightness, and adds grain. The result enters the existing Canvas2D preview and export pipeline.

The exact canonical Meta geometry remains the source for symbol influence; it is sampled and diffused, never redrawn. Captured 3D imagery supplies its own influence field. Brush deformation is a 192 × 192 backward displacement field with signed 16-bit coordinates packed into RGBA. Successive strokes advect the existing field. The serialized map is about 192 KiB, regardless of stroke count. Existing history is capped at 100 states.

The earlier optical-density approximation and broad shadow layers were removed after feedback that they muddied the colors. The current renderer separates brightness, saturation, and hue across normalized fields. It uses one fixed hue interval across the image rather than selecting a new shortest hue path at each overlap. This removes the branch seams and automatic pale outlines exposed in previous revisions. This is an artistic color model, not a physical pigment simulation. The supplied [Are.na board](https://www.are.na/eric-filkins/mb-transform) and four additional references guided visual review.

## Visual review

Run `npm ci` and `npm run dev`. The development-only `/gradient-review` route compares four looks across all six brand palettes. It exposes seed, aspect, brush study, softness, folds, bleed, depth, complexity, and distortion. **Save snapshots** re-renders before capturing, then writes individual PNGs, editable JSON looks, and a contact sheet under `.devshots/`. **Save depth study** writes a three-look comparison and a grid at 0%, 15%, 45%, and 100% Depth. **Open look** in the generator loads the individual JSON files. The review page and snapshot API return 404 in production.

Passes 01–08 documented the earlier ramp-based renderer and brush. After feedback that those results felt one-dimensional, passes 09–20 rebuilt the color renderer. The deposit renderer still darkened and dulled colors despite sequential layering; that remained unresolved through pass 20. Later passes corrected excessive lead-color coverage, added independent internal color variation, and introduced the separate scatter pass. Seeds 1913, 9027, 14023, and 31991 were inspected in landscape and portrait.

Passes 21–25 document the color correction. Passes 21–22 were rejected internally for harsh rainbow edges; 23–24 preserved brightness with softer complementary-color transitions. Pass 25 checks a painted portrait. The user rejected the remaining flat islands and pale outlines after pass 25. Passes 26–36 replace the deposit model with continuous fields, adjust color coverage, and move highlights into field interiors. Final snapshots include default landscape, painted portrait, and the low-softness/high-depth control combination from the reported failure. Existing recipes use the revised renderer when loaded. The visual checks are not a claim of user approval; the selected palette and brush deformation still strongly affect the result.

Passes 37–48 document the differentiation of Diffusion, Halo, and Flow and the expanded low end of Depth. Comparisons include default landscape, a painted portrait, and the reported 4% Softness / 100% Complexity combination. The review caught and corrected a Flow Complexity setting that initially had no effect, and a pinched Halo center at low Depth. Pass 48 contains the final landscape comparison and Depth grid.

Passes 49–54 compare every palette. Close-hue and neutral mixes now recover more of their selected light–dark range after blending. This uses the actual selected swatches and weights, including custom mixes. Brightness stays within the selected endpoints; no new shadow color is added. Internal highlights are stronger for close hues. Halo distributes lighter and darker selected tones around its loop, and Smear now starts from a broad horizontal composition. Both changes improve differentiation when hue differences are small. Depth zero still produces a nearly flat wash.

**Check palettes** evaluates all six palettes, four looks, and three seeds at the current aspect and brush setting. It measures the central brightness range, pairwise image differences, and the loss of contrast at zero Depth, and compares every palette/look against a native 4K export for seed 1913. These are regression checks alongside visual inspection, not a measure of aesthetic quality. Final landscape and painted portrait checks passed; the largest portrait preview/export error was 0.50 channel levels out of 255.

## Verification

- 378 unit tests pass across 60 files, including gradient settings, saved looks, brush geometry, map precision, history, and palette sampling.
- TypeScript, lint, and production build pass.
- Real-browser checks cover deterministic repeats, seed changes, symbol influence, lead-color weight, every gradient control, painted distortion, motion, energy, exact loop closure, and native 4K exports. GPU checks also compare the three organic looks and verify that zero Depth substantially lowers spatial color variance. Further checks verify exact single-color output (blue, orange, gray, black, white within 2 channel levels without grain) and ensure bright selected swatches do not acquire dark overlaps.
- With final landscape seed 1913, average preview/export differences without grain were 0.17, 0.14, 0.15, and 0.34 channel levels out of 255 for Diffusion, Halo, Flow, and Smear respectively.
- Four 1200-pixel render-and-readback samples per look averaged 11.8–14.8 ms on this machine. This is not a cross-device frame-rate guarantee.
- The brush's UI position was verified after the user's requested move. Earlier live checks covered painting, exact undo/redo, clear/undo, and reload persistence.

The complete legacy browser test suite was not run. Checks used the real browser through the generator and development review page.

The earlier dependency lockfile repair, no-op renderer stub type cleanup, and canonical LookId import in the browser parity test remain part of this branch. Verification was performed locally; deployment is separate.
