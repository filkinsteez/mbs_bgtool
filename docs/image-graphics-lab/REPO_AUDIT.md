# Repo audit — image & graphics research lab

> Archived planning document for the original editor. It does not describe the current MBS generator route or its fixed 4K export.

Milestone 0 of the exploratory build. Six subsystem audits (structure/state, rendering,
shape system, export/persistence, perf/tests, routing isolation) with file:line evidence,
followed by the implementation plan. Everything below was verified against the code, not
recalled from memory.

## 4.1 Application structure

- **Framework**: Next.js 16.2.10 (exact pin, empty `next.config.ts`), React 19.2.4,
  TypeScript strict, `@/*` → `./src/*`. Zustand ^5, dialkit ^1.4.3, lz-string, motion.
  Scripts: `dev` / `build` / `lint` / `test` (`vitest run`).
- **State**: one Zustand store (`src/core/state/store.ts`) holding `{ project, ui, historyVersion }`.
  Change discipline: `apply(patch)` = discrete change with one undo entry;
  `setTransient(patch)` + `commitTransient()` = drags collapse to one entry and flip
  `ui.quality` 'live'→'hq'; `mergeDeep` patches (objects merge, **arrays replace wholesale,
  explicit `undefined` deletes the key**). History is a module-level class storing 100 whole-state
  JSON snapshots (`src/core/state/history.ts`).
- **Panels/controls**: thin wrappers over dialkit in `src/components/controls/`
  (Slider, Toggle, SegmentedControl, ColorField, TextField, `useCommitOnRelease`). They need a
  `.dialkit-root` class ancestor for tokens; `dialkit/styles.css` + `<DialRoot/>` are already
  global via the root layout, so the controls work on any route.
- **Routing**: exactly two routes — `/` (renders `EditorShell`, all modes are ui state) and
  dev-gated `POST /api/devshot` (writes any canvas dataURL to `.devshots/`). Root layout mounts
  the Optimistic variable font, dialkit css, `globals.css`, `editor.css`, `<DialRoot/>`.
- **Persistence**: EditorShell's mount effect restores share-hash → `localStorage['lbs-autosave']`
  → defaults, and a debounced (500ms) subscriber writes autosave + rewrites the URL hash
  (`history.replaceState`) on every project change. `deserializeProject` hard-rejects
  `version !== 1` (no migration chain) but heals partial saves by `mergeDeep` over defaults.

## 4.2 Rendering

- **Live**: WebGL2 renders only the background field (field → smear → bloom → composite chain in
  `src/render/backgroundGL.ts`, frozen time, on-demand — no rAF for the artboard). Shapes/clones/
  tiles render as **SVG**, images as `<img>` DOM, text as DOM; only Organic and Array layers own
  live Canvas2D. A shared rAF bus exists (`src/render/renderController.ts`, with a hidden-tab
  watchdog) but only motion/path labs subscribe.
- **Offscreen**: the GL renderer takes any canvas + explicit size (`renderToCanvas`); export
  builds entirely fresh canvases and never touches live ones. **Contexts leak by design** —
  renderers cache per-canvas in a WeakMap and `dispose()` has no call sites, so repeatedly
  creating GL canvases exhausts the browser context limit.
- **Preview vs export**: every layer type has TWO painters — a live SVG/DOM component and a
  Canvas2D function in `src/core/export/png.ts`. Anything added to the main composition must be
  implemented twice or it diverges. (The lab avoids this entirely: one raster painter is both
  preview and export.)
- **Resolution model**: artboard units are model space everywhere; export scales with one
  `ctx.scale(scale, scale)` and draws in artboard units. The GL background re-renders natively
  at output size. Live Organic/Array canvases are *not* DPR-aware (soft under zoom) — only the
  GL layer is.
- **Existing image handling**: `importImageFile` (decode → downscale to 1600px → **lossy JPEG
  data URL**) is what `project.images` stores; `ArrayLayer`/`buildImageCells` already sample an
  image into per-cell `{glyph, color, alpha}` records — a proto-Mark-Translation.

## 4.3 Shape system

- **ShapeProto** (`src/core/canvas/shapeProtos.ts`): two-member union `{kind:'path', d, fill,
  opacity}` | `{kind:'text', …}`, normalized into a 100-unit origin-centered box (`PROTO_SIZE`).
  Geometry is colorless — fill/opacity are ctx-level at stamp time, so **color override and
  alpha-only masks are already possible**. `resolveProjectProtos(project, sourceIds)` maps bound
  ids → protos; `consumedShapeIds(layers)` is the "bound objects stop rendering" contract.
- **No shared stamp function exists.** The translate/rotate/`scale(size/PROTO_SIZE)`/
  `fill(path,'evenodd')` idiom is inlined at three sites with three private Path2D caches
  (png.ts, imageArray.ts, organic/paint.ts). The lab adds ONE stamp helper locally rather than
  refactoring the editor's three (live/export parity there is a guarded invariant).
- **Curve is numerically pure**: `sampleCurve(liss, w, h, count)` → `{x, y, t, angle, curvature}[]`;
  `buildArcLUT(samples)` → `{total, posAt(s)}`; unit-space `unitPos/unitVel/unitAcc`.
- **Per-cell engines** all emit pure, extensible data records (SheetClone, OrganicPoint — which
  already carries its density-field value "for downstream use" — ArrayCell) except tiles/lattice,
  whose built-ins batch into concatenated path strings (per-cell overrides impossible there
  without a format change).

## 4.4 Export & persistence

- `exportPNG(project, scale: 1|2|4)` composites per-layer scratch canvases with opacity/blend,
  awaits images and embeds fonts for the type rasterizer. **It can never produce transparency**
  (unconditionally fills the background first) — the lab needs its own small compositor for
  alpha PNG, which it needs anyway (one painter, arbitrary dimensions).
- **Recipes**: whole `ProjectState` as JSON; partial states heal via `mergeDeep` over defaults.
  Share links are lz-string in the URL hash with data-URL images stripped.
- **Seeded RNG**: `mulberry32` streams (`src/core/math/random.ts`) and — the pattern to
  standardize on — `chan(seed, stableId, channelName)` / `chanGauss` (`src/core/organic/random.ts`),
  FNV-1a based, designed so editing one control never reshuffles unrelated decisions. Four other
  hash variants exist (sin-fold in sheet/tiles/effectors; imageArray's takes **no seed** — a
  defect the lab must not inherit). The render path has zero `Math.random`/`Date.now`; ids and
  user-triggered seed minting are generate-once-store-in-state.

## 4.5 Performance & risk

- **Tests**: vitest 4, `environment: 'node'` — no DOM, no canvas. 156 tests, all pure-function
  suites (determinism via byte-identity, geometry invariants, serialization round-trips). Lab
  kernels must be pure typed-array in/out or they are untestable under this config.
- **Proven CPU budgets**: full-canvas per-pixel loops run today at commit-time only
  (organic's blur→threshold→grain, gated on `quality==='hq'`); `boxBlur`
  (`src/core/math/blur.ts`) is an existing deterministic Float32Array separable blur.
  ~2.4k Canvas2D stamps per state-change is proven (organic); 5k+ went to batched SVG.
  Per-frame re-stamping is new territory — the lab renders on-demand, never per-frame.
- **Memory ceiling**: 4× export is 7680×4320 ×3 Canvas2D surfaces + six RGBA16F GL targets,
  unguarded (no MAX_TEXTURE_SIZE query). Lab analysis rasters stay at a fixed ~1MP, never
  export-scaled.
- **React 19 lint**: refs only in effects/handlers; property reads off ref-carrying objects
  count as render-time access (the ColorField tuple workaround). Copy existing idioms.

## Decision: where the lab lives

**An isolated route — `src/app/lab/page.tsx` — not a fourth mode.** This is what the code
structure says, not a preference: EditorShell's mount effect owns global side effects scoped to
the editor document (autosave writes, URL-hash `replaceState` on every change, Ctrl+Z/Y window
handler, renderController start/stop), and all modes share one project store + one undo history.
A fourth mode inherits all of it; a route inherits only the root layout (font, css tokens,
DialRoot) — which is exactly the part the lab wants (controls + typography for free).

Consequences accepted:
- The lab gets its **own Zustand store + own History instance + own storage key**
  (`lbs-lab-autosave`), no URL-hash writeback. Importing the editor store module for *reading*
  (mark-bank import from the autosaved project) is fine; lab edits never enter the editor's
  undo/autosave.
- `editor.css` classes are global and unprefixed — lab markup uses `.lab-*` names, adopting
  editor classes only deliberately.
- Bitmaps and analysis rasters live in a **module-level cache outside the store** (history
  snapshots are `JSON.stringify` of state; raster data in state would make every commit O(image
  bytes)). Lab state holds only `{filename, dims, contentHash}` + params + seed — which is the
  recipe contract the brief asks for anyway.
- The lab does **not** reuse `importImageFile` (lossy 1600px JPEG): it decodes the file
  full-res to an ImageBitmap for compositing and a capped ~1MP ImageData for analysis.

## Dependency decision

**None.** No new rendering framework, no workers, no ML. Studies are Canvas2D + typed-array
kernels. Rationale: the studies' costs (≤ a few thousand stamps + one-time ~1MP analysis per
image) sit inside budgets the repo already proves on the main thread at commit-time. The GL
stack is deliberately avoided for study rendering: per-canvas context leaks, the
`EXT_color_buffer_float` fallback, and no-`preserveDrawingBuffer` readback rules add risk
without buying anything the studies need. If profiling later shows a measured blocker
(§15.1 of the brief), the first escalation is a worker for analysis kernels — they are already
pure typed-array functions, so the move is mechanical. That decision gets documented here
before it happens.

## Reuse plan (verbatim, not duplicated)

| Need | Existing code |
| --- | --- |
| Mark vocabulary | `ShapeProto` + `resolveProtos`/`resolveProjectProtos` (`src/core/canvas/shapeProtos.ts`) |
| Seeded decisions | `chan`/`chanGauss` (`src/core/organic/random.ts`), `mulberry32` for streams |
| Analysis blur / detail | `boxBlur` (`src/core/math/blur.ts`) |
| Curve as a field/carrier | `sampleCurve`, `buildArcLUT`, `buildDistanceGrid`+`contourAtLevel` |
| Sliders/panels | `src/components/controls/*` under a `.dialkit-root` ancestor |
| Undo | `History` class (`src/core/state/history.ts`), lab-local instance |
| Recipe healing | `mergeDeep`-over-defaults pattern (`src/core/state/serialize.ts:13-26`) |
| Verification | `POST /api/devshot` as-is with `lab-` name prefix; `window.__lbsLab` dev hook |
| Transient/commit UX | `setTransient`/`commitTransient` + `useCommitOnRelease` pattern, lab store |

What the lab does *not* reuse: `exportPNG` (no transparency, wrong compositor shape),
`importImageFile` (lossy), the three inlined stamp idioms (one lab-local `stampProto` with its
own Path2D cache instead), tiles/lattice batched outputs.

## The primitive hypothesis this build tests

The brief's four studies decompose as *field → carrier → mapping → composite*:

1. **Field** — `sample(x, y) → 0..1` over output space, backed by an image-analysis raster
   (luminance, edge magnitude, edge orientation, local detail), a generated source (Lissajous
   distance field, coarse seeded noise), or a user mask; combined with a handful of pure
   combinators. This is the one abstraction built *speculatively* (§7.6's relationship map is
   a Field; Mark Translation's regional coherence is a Field; Material Field's modulation is a
   Field). It is ~100 lines and fully unit-testable, so the speculation is cheap.
2. **Carrier** — where decisions happen (uniform cells first; nested scales in study 2).
   Not abstracted yet; each study owns its carrier until two need the same one.
3. **Mapping** — per-cell evidence → mark attributes, seeded via `chan(seed, cellId, channel)`
   so each attribute is an independent channel (positions never reshuffle when color mode
   changes).
4. **Composite** — source layer × graphic layer × ownership, one raster painter used by both
   preview and export.

Evidence this fits the codebase rather than being imported theory: the effector model already
*is* carrier+mapping with uniform params (`buildSheetClones` et al.), `OrganicPoint.field`
already records a field sample per point, `buildImageCells` already maps luminance → cell
attributes, and the type-calm feature already couples a generated field to layout
bidirectionally. The lab makes the implicit primitive explicit and tests whether it carries
four visually different studies.

## Risks & fallbacks

- **Main-thread analysis jank** → analysis runs once per image load (cached by
  content+settings), never during drags; drags re-render at reduced preview scale with a stale-
  render token. Fallback: worker (kernels are already pure).
- **Text protos are DOM-bound** (`resolveFamily` hidden span, canvas measurement) → fine in the
  browser-only lab; kernels that need testing stay DOM-free.
- **WebGL for the Lissajous *distance field*** → not needed; `buildDistanceGrid` is CPU
  marching-squares infrastructure that already exists.
- **Autosave quota** — lab autosave stores params only (no bitmaps), so the editor's
  data-URL-in-localStorage weakness is not inherited; a restored recipe asks the user to
  re-drop the matching source file (matched by contentHash).
- **Study removal** — each study is one pure build module + one params type + one panel section;
  the registry is the only shared touchpoint, satisfying the brief's removability criterion.
