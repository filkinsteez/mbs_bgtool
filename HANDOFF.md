# MBS Background Generator handoff

Updated: August 27, 2026

## Bottom line

The user rejected the current V2 Looks as genuinely horrible. That judgment should override the automated checks and the earlier internal claims that the Looks had reached the reference bar.

Do not continue polishing the current visual direction. The main failure was not a missing test or one weak renderer. The work converged on flat, diagrammatic, genre-literal patterns that do not match the depth, restraint, color behavior, or visual surprise of the reference material.

No V2 Look in the current tree should be treated as user-approved.

## Product intent

This is a background-creation tool based on the Meta symbol, not a Meta-logo generator.

The intended result is:

- Full-frame, visually rich generative artwork.
- The exact official Meta geometry influencing the composition without appearing as a centered badge, obvious fill, outline, cutout, or target.
- A useful quiet area for layout, without reducing the whole artwork into an inset rectangle.
- Distinct Looks with genuinely different composition systems, not one shared background with different overlays.
- Deterministic output for a fixed recipe, seed, size, and animation phase.
- V1 preserving the Look behavior from commit `67f7de1`.
- V2 reserved for new work.
- Low complexity as a complete composition. Mid and High must retain the lower-level structure and add visible secondary systems.
- Palettes behaving consistently in 2D and 3D.
- Motion that is organic, visibly composed, performant, and exactly loopable.
- 3D Looks applied as real GPU post-processing over the lit model, not as a hidden WebGL scene replaced by a Canvas2D image.
- A simple 4K PNG export matching the preview.

The user also asked for direct communication. Do not describe technical progress as aesthetic success unless the rendered result actually supports that claim.

## Reference material

Primary board:

- <https://www.are.na/eric-filkins/mb-transform>

The board and connected channels were researched during this session. A local reference contact sheet was generated at:

- `/tmp/mb-transform-contact-current.jpg`

That path is temporary and may not survive a reboot. Re-fetch the board if it is missing.

The relevant qualities in the references were:

- Optical depth from blur, glow, diffusion, interference, and value transitions.
- Strong low-frequency composition before fine detail.
- Controlled irregularity rather than evenly distributed noise.
- Material specificity.
- Restrained accents and intentional color hierarchy.
- Cropped and off-center events.
- Real negative space.
- Ambiguous source imagery integrated into a field rather than displayed as an icon.
- Variation in visual density and scale within one frame.

## What was attempted

### Look versioning

The UI and recipe model were changed to support V1 and V2 Looks. V1 was intended to preserve the commit-era renderers from `67f7de1`; V2 became the experimental redesign.

### Composition and color systems

The work introduced or expanded:

- Composition planning.
- Look-specific color plans.
- Territory/source influence fields.
- Deterministic seed handling.
- Source-aware masking for material/3D input.
- Additive complexity checks.
- Motion phase handling.
- Preview/export and 2D/3D parity tests.

### V2 renderers

Most active V2 Canvas2D rendering is centralized in:

- `src/core/lab/backgroundLookRenderers.ts`

Brushwork is primarily in:

- `src/core/lab/brushworkRender.ts`

The V2 Looks were repeatedly rewritten as:

- Frame
- Pixels
- Scanlines
- Streams
- Brushwork
- Beads
- Quilt
- Weave
- Marks
- Trails

The later passes added seed-selected layouts, aspect-aware placement, more full-frame activity, source-field steering, and additive detail. These changes improved structural test scores, but they did not solve the visual problem.

### Brushwork

`p5.brush` was added and used for Brushwork because the prior custom translucent-stroke implementation looked synthetic and performed poorly.

The resulting renderer reused brush resources and became more stable, but its compositions still tended to be dominated by one or two large gestures. The user did not approve it.

### 3D

The current material viewer renders a lit OBJ in Three.js, captures that frame and silhouette, runs the source through the Canvas2D Look pipeline, then displays a second canvas over the viewer while hiding the WebGL canvas.

Important files:

- `src/components/background/MaterialModelViewer.tsx`
- `src/features/background-generator/lookProcessor.ts`
- `src/features/background-generator/material/materialFrameCapture.ts`
- `src/features/background-generator/material/exportMaterial.ts`

This is screen-space Canvas2D replacement, not GPU post-processing over the rendered model. Camera, lights, material, and silhouette affect the captured input, but the visible final frame is not the lit model with a shader effect applied.

Do not claim that the current 3D implementation satisfies the GPU requirement.

### UX work

The broader working tree also contains substantial UX work, including:

- Color grouping and ordering.
- Shared 2D/3D palettes.
- 2D role controls hidden where they are redundant.
- Accessible controls and keyboard behavior.
- Transform constraints and full-bleed framing.
- 3D camera controls and recovery states.
- Autosave and transaction changes.
- Export simplification.
- Removal of redundant framing and undo UI.

These edits are mixed with the Look work in an uncommitted tree. Preserve them unless the user explicitly asks to remove them.

## Why the visual work failed

### 1. Automated metrics became proxies for taste

The work added checks for:

- Edge coverage.
- Energy outside the canonical symbol bounds.
- Pixel differences between complexity levels.
- Determinism.
- Loop closure.
- 2D/3D parity.
- Source-mask localization.
- Performance and resource stability.

Those are useful engineering checks, but they do not prove that an image is good.

The process repeatedly interpreted passing structural metrics as evidence that a Look had reached the aesthetic bar. The user’s rejection demonstrates that this was wrong.

### 2. The renderers remained motif generators

The Looks commonly reduced to one recognizable device:

- Frame: topographic contours or angular territory wedges.
- Pixels: block bands and hard negative-space cutouts.
- Scanlines: clean horizontal lanes with a distortion pocket.
- Streams: central river or highway junctions.
- Brushwork: large diagonal or crossing hero strokes.
- Beads: necklace-like arcs.
- Quilt: low-poly facets.
- Weave: bent ladder grids.
- Marks: decorative curved strokes and scratch clusters.
- Trails: route diagrams and thin networks.

These are descriptions of effects, not art-directed compositions.

### 3. The palettes flattened the family

Many contact sheets used the same yellow ground with blue/cyan structure or the same dark ground with blue/white structure. Look-specific color-role logic existed, but the rendered family still felt mechanically uniform.

### 4. Source integration was too literal or too weak

Depending on the Look, the Meta-derived field appeared as:

- A hard negative-space knockout.
- A contour disturbance.
- A central confluence.
- A bend in a path.
- A local density change.

Some cases exposed symbol-like geometry too directly. Other cases made the source effectively unrecoverable. Neither outcome met the goal of exact but subtle structural integration.

### 5. Seed and aspect variation were added late

Later iterations introduced multiple layouts and aspect-aware reanchoring. This improved contact sheets, but the variation still happened inside narrow genre templates. A different seed often produced a different junction, grid, or stroke layout rather than a meaningfully different composition.

### 6. Complexity often meant decoration

High complexity commonly added:

- More lines.
- More dots.
- More scratches.
- More stitches.
- More small fragments.

It did not consistently introduce a new compositional scale or richer relationship.

### 7. Motion evidence was too weak

The active V2 background renderer accepted phase and amount but did not consistently use the Energy setting.

The visual audit sampled a few frames and originally asserted only that:

- A middle frame differed from the first frame.
- The final loop frame exactly matched the first.

Several effects moved only a few native pixels, which became nearly invisible in downscaled contact sheets. Byte changes were incorrectly treated as meaningful motion.

### 8. 3D evidence captured the wrong thing

The main 3D contact-sheet test captured `.lab-material-look-canvas`, which is the processed Canvas2D output. It did not prove that a Look was applied to the visible lit model through a GPU pass.

The correct product-level screenshot target is the artboard or viewer:

- `#lab-generator-artboard`
- `[data-mbs-material-model="true"]`

Even that would only prove the current browser-visible composition. A true GPU requirement still needs renderer work.

## Blunt status of the current V2 Looks

The last fully reviewed contact sheets before work was stopped were:

- `/tmp/mbs-look-complexity-contact-sheet-bold-final-five-v3-verified.png`
- `/tmp/mbs-look-complexity-contact-sheet-atmospheric-final-five-v3-verified.png`

The user rejected the overall result after these passes.

The latest visible tendencies were:

- Frame: sparse angular terrain with contour lines.
- Pixels: hard-edged block bands with large voids.
- Scanlines: cleaner, more varied line fields but still an effect study.
- Streams: thick branching currents that still resemble diagrams.
- Brushwork: improved material edges but still gesture-led.
- Beads: draped circular chains.
- Quilt: angular planes that resemble generic low-poly abstraction.
- Weave: partial deformed grids.
- Marks: curved gestures and small scratch clusters.
- Trails: thin route networks.

Do not inherit the earlier “passes” verdicts. No Look has been approved by the user.

## Interrupted state

Two implementation tracks were stopped immediately after the user rejected the direction:

1. Another Pixels/Streams/Beads/Quilt/Weave and motion pass.
2. A true GPU 3D post-processing pass.

The structural/motion pass reported partial edits in:

- `src/core/lab/backgroundLookRenderers.ts`
- `src/core/lab/render.ts`
- `tests/browser/background-generator.spec.ts`
- `tests/browser/look-contact-sheet.spec.ts`
- `tests/browser/helpers/image-motion.ts` (new during the interrupted pass)

It also reported that Weave was stopped mid-iteration and that the nine-frame motion helper/tests were not validated.

A surgical cleanup back to the prior verified state was started, then stopped when the user requested that everything stop and be pushed. Therefore, the final pushed tree must be treated as an interrupted snapshot until independently inspected.

The GPU workstream was also interrupted. Inspect its final report and the git diff before assuming whether any partial GPU files remain.

Its stop report confirmed partial GPU changes in:

- `src/components/background/MaterialModelViewer.tsx`
- `src/components/background/BackgroundShell.tsx`
- `src/features/background-generator/material/materialLookGpu.ts`
- `src/features/background-generator/material/materialLookGpu.test.ts`
- `src/features/background-generator/material/materialFrameCapture.ts`
- `src/features/background-generator/material/exportMaterial.ts`
- `src/styles/lab.css`
- `tests/browser/material-gpu-looks.spec.ts`

It also generated local files under `test-results/material-gpu-looks/`.

The GPU pass was not completed or reverted. V1 still uses the Canvas2D path. The final typecheck was blocked by unrelated errors in the partially edited `backgroundLookRenderers.ts`, so neither the partial GPU implementation nor the final combined snapshot is verified.

Do not use `git reset --hard`, broad `git restore`, or `git checkout --` on this tree. Many files contain unrelated and earlier user-requested changes.

## Verification history

At the last verified V3 checkpoint, the reported checks were:

- 362 Vitest tests passed.
- 63 default Playwright tests passed.
- Lint passed.
- TypeScript passed.
- Optional visual artifact tests were run separately.
- Determinism and loop-seam checks passed.
- Canvas resource counts were stable.
- 4K Look exports completed.

Representative reported 4K times ranged from roughly 43 ms to 1.6 seconds, with Brushwork slowest.

These results describe an earlier checkpoint. They do not prove the final interrupted snapshot is valid, and they do not prove aesthetic quality.

Useful commands:

```sh
npm test
npm run lint
npx tsc --noEmit
npm run test:browser
```

The browser suite includes opt-in visual artifact jobs that are skipped by default. Read the environment switches in `tests/browser/look-contact-sheet.spec.ts` before relying on the default test count.

## Temporary artifacts

Many comparison sheets and reports were written under `/tmp`, including:

- Complexity contact sheets.
- Seed/aspect matrices.
- Motion strips.
- Source-aware matrices.
- 4K exports.
- Runtime and export timing JSON.

These are not durable repository artifacts. They may disappear after restart and should not be considered part of the handoff unless copied elsewhere.

`test-results/` also contains local Playwright artifacts. Those are generated files and should generally not be committed.

## Recommended next approach

### 1. Do not repair all ten at once

Freeze the current V2 output as a rejected comparison. Choose one Look and build one genuinely strong static exemplar from first principles.

Do not propagate the new system to the other nine until the user approves that exemplar.

### 2. Start from composition, not the Look name

Define:

- One dominant low-frequency mass or field.
- One intentional quiet zone.
- One focal event.
- A clear depth hierarchy.
- A color allocation.
- A material or optical behavior.

Only after that should the renderer decide whether the visual language involves pixels, lines, fibers, paint, particles, or contours.

### 3. Prototype outside the production dispatcher

Use an isolated renderer, shader sketch, or experiment route so production V2 is not repeatedly destabilized.

Render full-size stills for:

- Two seeds.
- Landscape and portrait.
- Two palettes.
- Low and High complexity.

Show those images early. Do not build motion, 3D, export, or broad tests until the static visual direction is accepted.

### 4. Use the symbol as a field constraint

Keep the exact official Meta path or the active 3D source mask as an influence field, but avoid mapping an obvious boundary directly to visible color.

Better uses include:

- Changing flow curvature across a broad region.
- Shifting phase relationships.
- Moving a transition between materials.
- Affecting blur radius or diffusion.
- Steering density over multiple scales.
- Defining where two fields interfere.

The source should be recoverable through the composition without becoming a logo cutout.

### 5. Treat color as part of the algorithm

Each Look needs a different color model, not just different palette indices.

Examples:

- Large diffused value fields with one chromatic edge.
- Sparse emissive accents on a low-chroma structure.
- Quantized regions with unequal area weights.
- Material-dependent pigment mixing.
- Optical interference that changes hue at crossings.

### 6. Add complexity by scale

For an accepted static composition:

- Low: macro structure and focal event.
- Mid: a secondary system that interacts with the macro structure.
- High: localized material detail and rare accents.

High should not simply increase global count.

### 7. Add motion after the still works

Use integer harmonics so phase 0 and 1 are identical.

Preserve topology and seeded IDs across frames. Move coherent structures at a visible meso scale. Energy should change harmonic richness or movement character, not invalidate loop closure.

Evaluate at native resolution over at least:

- 0
- 1/8
- 1/4
- 3/8
- 1/2
- 5/8
- 3/4
- 7/8
- 1

### 8. Build 3D as a separate renderer

For V2 3D, use Three.js post-processing with scene color plus model mask/depth/normal information. Preserve evidence of model lighting and curvature.

Do not satisfy the requirement by generating the Look in Canvas2D, uploading it, and displaying it as a full-screen replacement.

Test with an asymmetric non-Meta OBJ intercepted in Playwright. Verify that moving or orbiting the model moves the source-conditioned effect and does not leave a canonical Meta ghost at the center.

### 9. Keep engineering gates, but place them after visual approval

Once a still is accepted, then enforce:

- Determinism.
- Additive complexity.
- Exact loop seam.
- Preview/export consistency.
- 4K output.
- Resource stability.
- Performance.
- Source localization.
- Aspect behavior.

These checks should protect an accepted visual result, not select the visual direction.

## Files to inspect first

- `HANDOFF.md`
- `.cursor/rules/meta-look-rendering.mdc`
- `src/core/lab/backgroundLookRenderers.ts`
- `src/core/lab/brushworkRender.ts`
- `src/core/lab/render.ts`
- `src/core/lab/types.ts`
- `src/core/lab/compositionPlan.ts`
- `src/core/lab/metaInfluence.ts`
- `src/core/lab/sourceMask.ts`
- `src/core/lab/v1/`
- `src/components/lab/LooksPanel.tsx`
- `src/components/lab/LabCanvas.tsx`
- `src/components/background/MaterialModelViewer.tsx`
- `src/features/background-generator/lookProcessor.ts`
- `src/features/background-generator/material/exportMaterial.ts`
- `tests/browser/look-contact-sheet.spec.ts`
- `tests/browser/background-generator.spec.ts`

## Git warning

The repository contains a large mixed uncommitted change set from many user requests. Before editing:

1. Inspect `git status`.
2. Inspect the complete staged and unstaged diff.
3. Identify generated `test-results/` files and keep them out of source commits.
4. Do not assume that every changed file belongs to the Look redesign.
5. Do not broadly revert files with mixed ownership.

The push requested at the end of this session is a handoff snapshot, not an assertion that the current V2 implementation is correct or approved.
