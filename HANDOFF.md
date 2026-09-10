# MBS Background Generator handoff

Updated: September 10, 2026

Application snapshot: `2805622` on branch `mbs-background-generator`.

## Current status

The active app is the standalone MBS Background Generator at `/`. It has
Background (2D) and Material (3D) modes, four Look-version tabs, approved color
packs, motion controls, separate 2D/3D transforms, local autosave, portable
recipe presets labeled as Looks, and fixed-size PNG export.

The old August 27 handoff no longer described the app. Since then, the Look
catalogs and 3D renderer have been replaced, V4 work has started, palettes were
corrected, a Symbol switch was added, Look presets were added, and export
feedback moved to a fixed toast.

No current Look should be described as user-approved unless the user approves
the rendered result directly. Passing tests is not evidence of visual quality.

## Owner directives

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

## Current Look catalogs

The UI labels and stored version IDs differ for saved-recipe compatibility:

- UI **V1** → stored `v1`
- UI **V2** → stored `v1b`
- UI **V3** → stored `v2`
- UI **V4** → stored `v4`

### V1 (`v1`)

The ten historical Looks:

Frame, Pixels, Scanlines, Streams, Brushwork, Beads, Quilt, Weave, Marks, and
Trails.

V1 dispatches through `src/core/lab/v1/render.ts`.

### V2 (`v1b`)

The same ten names rebuilt as full-frame, raster-first variants. V2 dispatches
through `src/core/lab/v1b/render.ts`.

### V3 (`v2`)

Four newer systems:

- Pattern
- Mandala
- Stitch
- Dither

They dispatch through `src/core/lab/v2/render.ts`.

### V4 (`v4`)

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

## Current 2D rendering

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

Motion is preview-only and 2D-only. Export renders the static base frame rather
than the currently visible animation phase. Imported recipes can contain a
30-second loop even though the visible slider stops at 20 seconds.

## Current 3D rendering

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

## Current controls and persistence

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

## Current color behavior

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

## Meta fidelity gaps to verify

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

## Known current issues

### Lint failure

`src/core/lab/render.ts` contains five empty placeholders:

- `paintPixelField`
- `renderQuilt`
- `renderWeaveField`
- `renderFrameLook`
- `renderTrails`

Their `any[]` parameters produce 5 ESLint errors and 5 warnings. Do not only
change the type to silence lint. Determine whether the unreachable fallback
branches should be removed or whether real fallback implementations are still
required.

### V4 is unfinished

V4 was committed as work in progress. Verify Composite, Plates, and Loom across
formats, seeds, palettes, complexity values, Background mode, Material mode,
preview, and export before calling them complete.

No Vitest file imports the V4 renderers, and no Playwright test selects V4,
Composite, Plates, or Loom. Existing V4 tests cover only catalog and recipe
plumbing.

Composite caches fields and geometry without including Symbol/source state in
its cache key. A warmed cache can retain symbol influence after Symbol is
switched off.

### Browser tests use stale Look catalogs

Current Playwright setup still treats stored `v2` as the old ten-Look catalog.
Stored `v2` now means UI V3 and defaults to Pattern, so tests that look for
Frame, Pixels, Quilt, or Trails can fail before exercising their target
behavior. A palette assertion also still expects the older 60-weight deal.

The parity harness also labels classic IDs as `v2`, and its “2D” and “3D”
functions call the same source-aware renderer. Byte equality there is not
independent proof of 2D/3D or preview/export parity.

Repair catalog setup before relying on the default browser suite or opt-in
contact sheets.

### Missing workflow coverage

- `SeedSheet.tsx` has no tests.
- Look preset serialization has unit tests, but Save/Open has no browser
  workflow test.
- Fixed toast feedback has no direct test.
- Current V3/V4 renderer behavior lacks direct unit coverage.

### Documentation lag

`README.md` still describes only V1 and V2 tabs. The code now exposes four UI
tabs and should be treated as the source of truth.

## Verification at this snapshot

Run on September 10, 2026:

- `npm test`: **362 passed**.
- `npx tsc --noEmit`: **passed**.
- `npm run build`: **passed**.
- `npm run lint`: **failed** only on the five placeholder functions described
  above.

Focused Playwright checks confirm stale catalog failures: current tests cannot
find Frame or Pixels while the default UI is on V3 Pattern. One focused V3
material-overlay case passed. The full Playwright suite was not used as a gate
for this handoff upload.

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

## Recent application changes

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

## Files to inspect first

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

## Next work

1. Keep the canonical Meta geometry and owner directives intact.
2. Finish and visually review one V4 system before expanding the catalog.
3. Resolve the five placeholder functions and restore a clean lint run.
4. Repair browser fixtures so they select the intended stored/UI catalog.
5. Add direct V3/V4 renderer and workflow coverage.
6. Verify all four catalogs in Background and Material modes.
7. Run the default browser suite.
8. Show rendered output to the user before making any claim about visual
   quality.
