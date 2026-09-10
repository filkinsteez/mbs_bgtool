# MBS Background Generator handoff

## September 10, 2026 current application update

Application snapshot: `2805622` on branch `mbs-background-generator`.

### Current status

The active app is the standalone MBS Background Generator at `/`. It has
Background (2D) and Material (3D) modes, four Look-version tabs, approved color
packs, motion controls, separate 2D/3D transforms, local autosave, portable
recipe presets labeled as Looks, and fixed-size PNG export.

Since the original August 27 handoff, the Look catalogs and 3D renderer have
been replaced, V4 work has started, palettes were corrected, a Symbol switch
was added, Look presets were added, and export feedback moved to a fixed toast.

No current Look should be described as user-approved unless the user approves
the rendered result directly. Passing tests is not evidence of visual quality.

### Owner directives

- Use plain language. Do not use poetic, marketing, or inflated wording in
  chat, code comments, docs, commits, or UI.
- This is a raster background tool. Raster texture, dithering, grain,
  halftones, and per-cell effects are the intended medium.
- Do not add passive status badges or explanatory UI text.
- Use the official canonical Meta geometry from `META_SYMBOL_PATH` exactly.
- Never mirror, rotate, approximate, redraw, or substitute the Meta symbol.
- Preserve its real orientation in 2D, 3D, preview, and export.
- The symbol must influence a full-frame composition. Do not present it as a
  centered badge, outline, cutout, or isolated logo treatment.

Read `AGENTS.md` and `.cursor/rules/meta-look-rendering.mdc` before changing
rendering code.

### Current Look catalogs

The UI labels and stored version IDs differ for saved-recipe compatibility:

- UI **V1** → stored `v1`
- UI **V2** → stored `v1b`
- UI **V3** → stored `v2`
- UI **V4** → stored `v4`

#### V1 (`v1`)

The ten historical Looks:

Frame, Pixels, Scanlines, Streams, Brushwork, Beads, Quilt, Weave, Marks, and
Trails.

V1 dispatches through `src/core/lab/v1/render.ts`.

#### V2 (`v1b`)

The same ten names rebuilt as full-frame, raster-first variants. V2 dispatches
through `src/core/lab/v1b/render.ts`.

#### V3 (`v2`)

Four newer systems:

- Pattern
- Mandala
- Stitch
- Dither

They dispatch through `src/core/lab/v2/render.ts`.

#### V4 (`v4`)

Three systems:

- Composite
- Plates
- Loom

They dispatch through `src/core/lab/v4/render.ts`. The V4 commits are explicitly
marked WIP. Do not treat this catalog as finished.

The default recipe is Background mode, seed 1913, 16:9 at 3840 × 2160, UI V3
Pattern at 50 complexity, motion off, Symbol on, Clean material, and material
Look overlay off.

In 2D, Looks act as a radio group. In 3D, clicking a Look enables its overlay;
clicking the active Look again disables it. Material thumbnails and 3D
Variations use a fixed generic frame rather than the live material, camera, or
surface colors.

### Current 2D rendering

The active path is:

1. `src/features/background-generator/render2d.ts`
2. `src/core/lab/render.ts`
3. The renderer selected by `lab.look.version`

`renderLab` dispatches in this order:

1. V1
2. V2 / stored `v1b`
3. V3 / stored `v2`
4. V4 / stored `v4`
5. The older fallback renderer

V3 and V4 are Canvas2D raster systems. The earlier shared WebGL field renderer
is not the current V3/V4 architecture.

The Symbol switch appears in Background mode. It keeps the curve source in the
recipe but disables it so each renderer uses its mark-free fallback.

The format presets are 16:9, 9:16, 1:1, and 4:5. PNG export uses a fixed
3840-pixel long edge.

Motion is preview-only and 2D-only. Export renders the static phase-zero base
frame rather than the currently visible animation phase. Imported recipes can
contain a 30-second loop even though the visible slider stops at 20 seconds.

### Current 3D rendering

The procedural Three.js GPU Look pipeline was rejected and removed.

Every current Look version uses the same material-overlay flow:

1. Render the raw lit OBJ viewport in Three.js.
2. Capture the current frame and silhouette.
3. Capture depth and view-space normal planes on settled frames and export.
4. Build a `LabSource` from those captures.
5. Run that source through the same Canvas2D Look renderer used by 2D.
6. Display the treated canvas over the viewport.

Plates and Loom consume captured depth. Current V3/V4 renderers do not consume
the captured `normalX` or `normalY` planes.

While the camera is moving, the raw Three.js viewport stays visible. The
Canvas2D overlay is regenerated after the view settles. Material motion is
disabled in `sourceAwareLabForRecipe`.

Material PNG export uses the same contract: capture the raw lit frame at target
size, attach depth/normal data when available, then process it through the
shared Canvas2D renderer. With the Look overlay off, export returns the raw
material frame.

Important files:

- `src/components/background/MaterialModelViewer.tsx`
- `src/features/background-generator/lookProcessor.ts`
- `src/features/background-generator/material/materialFrameCapture.ts`
- `src/features/background-generator/material/exportMaterial.ts`

Do not claim current 3D Looks use a GPU post-processing shader. Do not resurrect
the deleted `materialLookGpu.ts` path without direct user approval.

### Current controls and persistence

- Background/Material view mode lives separately from the saved recipe.
- A reload starts in 2D because view mode is not autosaved.
- Recipe edits are undoable; view-mode switching is not. History is in memory,
  stores whole recipes, and is capped at 100 entries.
- Undo is Cmd/Ctrl-Z and redo is Cmd/Ctrl-Shift-Z. Ctrl-Y is not wired.
- Autosave stores the recipe in local storage.
- **Save look** downloads the entire recipe, not only the selected Look. The
  file includes seed, colors, transforms, motion, material, and camera.
- **Open look** validates and loads a preset, restores its saved mode, replaces
  the recipe, and clears undo history.
- Preset filenames use stored version IDs, so UI V3 files contain `v2`.
- Old saved sessions and preset files have pre-correction brand colors
  migrated to the current official palette values.
- Palette packs deal every enabled color rather than silently dropping colors.
- **Export image** downloads the current PNG.
- Save, open, and export results appear as a fixed toast.

**Variations** opens a deterministic 3 × 3 seed sheet. Its first page includes
the current seed; Deal produces another deterministic page. Selecting a seed
is undoable.

The always-visible Saved/Saving status conflicts with the owner rule against
passive status chrome.

The 2D scale handle announces an 800% maximum while recipe normalization allows
1200%.

### Current color behavior

- Visible packs are Primary, Neutrals, Bold, Harmonious, Atmospheric, and
  Neutral Flex.
- Selecting a pack enables every color in that pack.
- Weights do not need to total 100; rendering normalizes them. Weight zero
  disables a color.
- Manual color or weight changes switch to an internal custom state without
  adding a visible Custom badge.
- V1 2D derives paper and ink from its weighted mix.
- V2 / stored `v1b` uses a fixed paper ground.
- Material Look processing uses the stored Background and Marks roles.

### Meta fidelity gaps to verify

The project rule requires `META_SYMBOL_PATH` everywhere, but current code still
has paths that need explicit verification:

- V1 uses the archived `V1_META_SYMBOL_PATH` in
  `src/core/lab/v1/metaSymbol.ts`.
- V2 / stored `v1b` rotates the symbol field in
  `src/features/background-generator/recipe.ts`.
- V3 Pattern mirrors, rotates, and non-uniformly stretches cropped
  canonical-derived geometry. V3 Mandala and Dither also rotate
  canonical-derived fields.
- The Material mode loads a separate OBJ through
  `src/app/api/material-model/route.ts`; its exact equivalence to
  `META_SYMBOL_PATH` has not been proven in the current tests.

Do not weaken the fidelity rule to accommodate these paths. Treat mismatches as
bugs.

### Known current issues

#### Lint failure

`src/core/lab/render.ts` contains five empty no-op placeholders:

- `paintPixelField`
- `renderQuilt`
- `renderWeaveField`
- `renderFrameLook`
- `renderTrails`

Their `any[]` parameters produce 5 ESLint errors and 5 warnings. Do not only
change the type to silence lint. Determine whether the unreachable fallback
branches should be removed or whether real fallback implementations are still
required.

#### V4 is unfinished

V4 was committed as work in progress. Verify Composite, Plates, and Loom across
formats, seeds, palettes, complexity values, Background mode, Material mode,
preview, and export before calling them complete.

No Vitest file imports the V4 renderers, and no Playwright test selects V4,
Composite, Plates, or Loom. Existing V4 tests cover only catalog and recipe
plumbing.

Composite caches fields and geometry without including Symbol/source state in
its cache key. A warmed cache can retain symbol influence after Symbol is
switched off.

#### Browser tests use stale Look catalogs

Current Playwright setup still treats stored `v2` as the old ten-Look catalog.
Stored `v2` now means UI V3 and defaults to Pattern, so tests that look for
Frame, Pixels, Quilt, or Trails can fail before exercising their target
behavior. A palette assertion also still expects the older 60-weight deal.

The parity harness also labels classic IDs as `v2`, and its “2D” and “3D”
functions call the same source-aware renderer. Byte equality there is not
independent proof of 2D/3D or preview/export parity.

Repair catalog setup before relying on the default browser suite or opt-in
contact sheets.

#### Missing workflow coverage

- `SeedSheet.tsx` has no tests.
- Look preset serialization has unit tests, but Save/Open has no browser
  workflow test.
- Fixed toast feedback has no direct test.
- Current V3/V4 renderer behavior lacks direct unit coverage.

#### Documentation lag

`README.md` still describes only V1 and V2 tabs. The code now exposes four UI
tabs and should be treated as the source of truth.

### Verification at this snapshot

Run on September 10, 2026:

- `npm test`: **362 passed**.
- `npx tsc --noEmit`: **passed**.
- `npm run build`: **passed**.
- `npm run lint`: **failed** only on the five placeholder functions described
  above, with 5 errors and 5 warnings.

Focused Playwright checks confirm stale catalog failures: current tests cannot
find Frame or Pixels while the default UI is on V3 Pattern. One focused V3
material-overlay case passed. The full Playwright suite was not used as a gate
for this handoff update.

Playwright currently collects 85 tests. Seventeen visual jobs are
environment-gated by default, with one additional capability-dependent skip.
Do not claim broad browser coverage or release readiness.

```sh
npm run test:browser
```

Visual artifact tests remain opt-in; inspect
`tests/browser/look-contact-sheet.spec.ts` for the current environment flags.

Export dimensions are:

- 16:9: 3840 × 2160
- 9:16: 2160 × 3840
- 1:1: 3840 × 3840
- 4:5: 3072 × 3840

Export filenames omit the Look version. Material filenames also omit the
enabled overlay Look.

### Recent application changes

The commits after the original GPU snapshot added:

- V2 (`v1b`) full-frame comparison Looks.
- V3 Pattern, Mandala, Stitch, and Dither.
- V4 Composite, Plates, Loom, and Seed Sheet work.
- Shared captured-frame material overlays for every Look catalog.
- Depth and normal capture for material processing.
- Portable Look JSON save/open.
- A Background-mode Symbol switch.
- Correct official Atmospheric, Bold, and Harmonious palette values.
- Migration of old saved and preset colors.
- Use of every enabled pack color.
- Fixed export-panel toast feedback.

See commits `32d2054` through `2805622`.

### Files to inspect first

- `AGENTS.md`
- `.cursor/rules/meta-look-rendering.mdc`
- `src/app/page.tsx`
- `src/components/background/BackgroundShell.tsx`
- `src/components/background/MaterialModelViewer.tsx`
- `src/components/lab/LabCanvas.tsx`
- `src/components/lab/LooksPanel.tsx`
- `src/components/lab/LabExportPanel.tsx`
- `src/components/lab/SeedSheet.tsx`
- `src/features/background-generator/recipe.ts`
- `src/features/background-generator/store.ts`
- `src/features/background-generator/lookPreset.ts`
- `src/features/background-generator/lookProcessor.ts`
- `src/features/background-generator/material/exportMaterial.ts`
- `src/core/metaSymbol.ts`
- `src/core/lab/looks.ts`
- `src/core/lab/render.ts`
- `src/core/lab/v1/`
- `src/core/lab/v1b/`
- `src/core/lab/v2/`
- `src/core/lab/v4/`
- `tests/browser/background-generator.spec.ts`
- `tests/browser/look-parity.spec.ts`
- `tests/browser/material-look-overlay.spec.ts`
- `tests/browser/look-contact-sheet.spec.ts`

### Next work

1. Keep the canonical Meta geometry and owner directives intact.
2. Finish and visually review one V4 system before expanding the catalog.
3. Resolve the five placeholder functions and restore a clean lint run.
4. Repair browser fixtures so they select the intended stored/UI catalog.
5. Add direct V3/V4 renderer and workflow coverage.
6. Verify all four catalogs in Background and Material modes.
7. Run the default browser suite.
8. Show rendered output to the user before making any claim about visual
   quality.

## Original August 27 handoff context (preserved verbatim)

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
  - SUPERSEDED (2026-08-28, owner): 3D Looks are a render layer over the
    viewport — the captured frame processed by the shared Canvas2D look
    renderer, same path for every catalog. The procedural GPU pipeline was
    rejected by the owner and removed. Later GPU-requirement notes in this
    file are historical.
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
