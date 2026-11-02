# Findings — image & graphics research lab

Evaluation capture per study. Updated as studies land; the recommendation
section stays empty until the stop gate (all four studies rendered and
compared). Judged against the brief's criteria: visual range, brand
leverage, source robustness, art direction, predictability, serendipity,
composability, legibility control, complexity cost, distinctiveness.

## Study 1 — Mark Translation

**Hypothesis.** A source image translated through the brand-shape
vocabulary feels more specific and useful than generic ASCII, halftone,
or dot conversion.

**Implemented.** Uniform cell grid over the fitted source; per-cell
evidence (tone, edge strength, edge orientation, fine detail) sampled
bilinearly from a ~1MP analysis raster; density-ordered mark ramps
(DOTS = generic halftone baseline, GEO = built-in glyphs, BRAND = the
editor's own drawn shapes + meta); tone drives presence weight and mark
size, structure drives mark choice and rotation, EVIDENCE slides
selection between them; a seeded regional-coherence field shifts the
pick and shares a tilt per neighborhood; three color modes (ink /
quantized tints / source color). Debug views: tone, edges, direction
(hue), regions, marks-only. Deterministic per (source hash, params,
seed) with independent chan channels.

- Source images tested: synthetic fixture (tonal gradient + dark silhouette +
  hard bar + checker texture). Real photography/portrait/illustration still to
  run — the fixture proves mechanics, not aesthetics.
- Parameter ranges that produced useful results: defaults (cell 26, evidence
  35%, occupancy 85%, coherence 45%) already separate the three banks clearly
  on the fixture; contact sheet `.devshots/lab-{dots,geo,brand}-composite.png`.
- Behaviors that felt generic: the DOTS baseline reads as exactly the
  commodity halftone it is meant to be — good, that is the control condition.
- Behaviors that felt brand-specific: with two drawn shapes + meta, output is
  immediately recognizable as this vocabulary (`lab-brand-user-shapes.png`);
  regional coherence makes neighborhoods commit to a mark family instead of
  sprinkling, which is the poster-reference behavior. Edge-driven rotation on
  asymmetric marks (halves, ellipses) visibly traces contours.
- Where direct art direction was needed: not yet exercised — masks/focus
  fields arrive in study 3.
- Performance observations: 640×480 fixture renders imperceptibly; analysis is
  one-time per load. No jank at drag-rate with the 0.5× preview gate. Untested
  at 2048² with sub-10px cells (thousands of stamps) — profile in M2.
- Primitives that recurred (so far, within one study): the Field closure
  carried both image evidence and the coherence lattice with the same
  interface; the fit-rect coordinate contract; chan channels per decision.
- Open questions: does tone→size + structure→selection stay legible on real
  photographs? Should presence use blue-noise-ish dither instead of per-cell
  chan (current sparkle is uniform)? Is one detail scale enough, or does the
  coarse map earn its place?
- Recommendation (continue / revise / merge / stop): continue — mechanics
  verified; judgment needs real sources and the M2 compare grid.

## Study 2+3 — Territory composition (Regional Encoding + Shared Territory, fused)

**Why fused.** Study 1 landed as "a really simple pixel filter" (direct quote,
and correct): a uniform grid with one rule everywhere is a filter no matter the
vocabulary. Regional Encoding's multiscale scaffold and Shared Territory's
relationship map turned out to be the SAME mechanism — a territory field that
decides which law applies where — so they shipped as one engine rather than two
studies that would each have half of it.

**Implemented.** A composable stack of masking field sources — THE CURVE's
distance field (snapshotted from the editor's autosave, meta ∞ fallback),
linear/radial gradients, a paintable brush mask (128-wide byte raster living in
the recipe), image tone, image detail — each with weight/invert/combine
(add·multiply·max), folding into one territory field. The territory quantizes
into 2–5 bands; each band owns a treatment: EMPTY, FLAT ink, MOSAIC (source
quantized to the cell grid), PHOTO (source revealed cell-by-cell), MARKS
(study 1's evidence machinery), or CONTOURS (marching-squares hairlines of the
territory itself, clipped to the band). Boundaries resolve HARD (stepped,
grid-aware), DITHER (8×8 Bayer over cell coords — stable across render
scales), or POROUS (seeded per-cell). Cells subdivide up to 2 levels where
image detail × SUBDIVIDE earns it; empty/flat bands never split. Marks gain
FLOW: orientation hands over from image edges to the curve's tangent field.

- Source images tested: synthetic portrait fixture (silhouette + gradient +
  texture + halo). Real photography still owed.
- What worked: the default recipe (curve 0.8 + tone 0.35 → empty/marks/
  contours/photo, hard) produces a composed poster on first load — the curve
  organizes, the photo survives only in its territory, stepped boundaries read
  as designed rather than filtered. The brush paints LAWS, not pixels: a
  stroke through the empty field carves regions that arrive fully dressed in
  contour rings and mosaic cores. One stroke = one undo entry.
- Behaviors that felt brand-specific: territory contours wrap the curve's
  lobes (the ∞ is legible in the hairlines); dither boundaries quote the
  print-logic research without a "dither filter" existing anywhere.
- Costs measured: 900×1200 export ≈ 32ms with all six treatments active.
- Primitives confirmed recurring: the Field carried image evidence, the
  coherence lattice, gradients, the curve SDF, and the painted mask through
  ONE interface — the abstraction hypothesis is holding. bandAt is the
  "representation ownership" primitive from the research map (§3.6).
- Open questions: should treatments be per-band parameterized (marks band with
  its own bank)? Do gradient handles belong ON canvas? Does the contour
  treatment want its own line-weight/count dials? Reciprocity is still one-way
  (image→graphics) except through the shared field — the displacement
  direction (graphics→image) is Study 4's territory.
- Recommendation: continue — build the compare grid next so variants of one
  recipe can be judged side by side, then Material Field as the shared
  finishing pass over all treatments.

## Study 4 — Flow (the process dimension)

**Source.** are.na/frederic-fornini/p5_inspiration (69 blocks, ~24 studied
individually). Taxonomy of the channel, by primitive rather than look:

| Reference | Surface read | Underlying primitive |
| --- | --- | --- |
| slit-scan portrait (b01) | face from warped scanlines | lines + displacement field |
| dab spirals (b40) | Van Gogh stroke vortices | walkers + deposition |
| magnetic field (b38) | hairline field lines | walkers, longer integration |
| Vasarely checker (b48) | bulged grid | same displacement, applied to a carrier |
| circle trails / growing rects (b25/b46) | motion unfolded into space | one walk step, echoed with a ramp |
| gradient→bars (b26) | continuous quantizing regionally | ALREADY OURS — bands over color resolution |
| type walls (b04/b07/b08) | text as texture on warped baselines | lines primitive + type protos (future) |
| grainy gradients (b06/b44/b50) | print-noise surfaces | shared finishing pass |

**The non-literal leap.** Four of five families reduce to one missing
core: the lab had scalar fields (WHERE a law applies) but no VECTOR
field (WHICH WAY things move). Implemented as `flow.ts`: one composed
vector field — curve tangents / seeded curl noise / territory-contour
flow (perpendicular to ∇T, i.e. along the band edges) / fixed angle,
with CURL turbulence blended over any basis — consumed by three new
band treatments (SCAN, DABS, STREAMS), an ECHO dial on marks, and a
GRAIN finish. Everything is territory-native: the bands and brush
still decide where, flow decides which way. Walkers resolve the mod-π
tangent sign ambiguity by direction continuity (the smear-shader trick,
now in its third home).

- What worked (devshots p5-scan-portrait / p5-streams-curve / p5-dabs /
  p5-echo): the slit-scan figure emerges from displaced ruling with the
  background staying flat; streams wrap the photo territory like wood
  grain; dabs swirl with tone-driven density and source color; echo
  trails marks in decaying comets. All four reads land on the first
  recipe attempt — evidence the primitive is right, not tuned-to-fit.
- Deliberate scope cuts: no carrier warp (the Vasarely bulge needs
  non-square cells — noted for later), scan lines don't yet bend along
  the flow (buildScanlines has the parameter, UI doesn't expose it),
  no type-on-flow-lines yet (the type-wall family is protos + the
  lines primitive — the pieces now exist).
- Streams deliberately ignore band clipping: territory SEEDS them, the
  walk is free. Reads as intentional escape, not a bug.
- Grain is indexed on device pixels, so preview grain differs from
  export grain in pattern (not in amount) — acceptable for a surface
  pass, noted.
- Primitive map update: Field (scalar) + FlowField (vector) + walk +
  echo now cover: territory, evidence, coherence, masks, displacement,
  deposition, and trails. The "process" dimension the p5 channel is
  actually about is: ITERATION MADE VISIBLE.

## Study 5 — The color system (palette + color field + fill treatments)

**Trigger.** The flow proofs were judged "horrifically bad" against a
second reference sheet — correctly. Every reference is a PALETTE
SURFACE: cells filled with color, not marks floating on paper. The lab
had one ink. Diagnosis per reference: quantized aurora = generated
gradient field + coarse mosaic; the flat quilt = palette blocks with
neighbor coherence; the pegboard = a circle grid where EMPTY CELLS ARE
STILL DRAWN, with column runs; gradient shingles/circles = per-cell
gradient fills, direction alternating.

**Implemented.**
- `colors.palette: string[]` in state, with six curated presets (Bold /
  Perler / Aurora / Blues / Fluoro / Sunset) as one-click chips, plus a
  full palette editor (add/remove/edit swatches).
- `colorField.ts` — the generated COLOR FIELD: each palette color claims
  territory (color k happiest where T ≈ (k+0.5)/K), so the palette
  orders itself along the composition; anisotropic seeded noise (taller
  than wide — the light-shaft read) breaks banding into weather.
- Three fill treatments: BLOCKS (flat palette quilt, coherent neighbor
  deals merge cells into runs, rare nested-square accents), BEADS
  (pegboard: ground beads everywhere, palette runs down columns,
  concentric inner dots), SHINGLE (per-cell linear gradients between
  palette neighbors, weave-alternating direction).
- MOSAIC with no photo quantizes the color field — the pixel-gradient
  reference exactly.
- Marks and dabs gain the 'palette' color mode (coherent regional deal).
- Shuffle's Colors scope now deals curated palettes + grain.
- New default recipe: mosaic/shingle/beads/blocks under the curve with
  the Bold palette — the first-load composition is a color surface.

**Judged against the references** (devshots ref1c-aurora, ref2-quilt,
ref3-beads, ref6-shingles, ref-default-mix): beads and quilt land
hardest — near-peer with their references on first recipes. The aurora
lands on color story and quantization; its weather is blobbier than the
reference's directional shafts even after anisotropy — a flow-driven
color advection would close it (future: advect the color field along
the vector field). Shingles read as in-family; larger panel rhythm
(row-height variation) would close the remaining gap. HMR NOTE: the
__lbsLabExportPng hook holds stale module closures after edits (the
round-77 lesson recurs in the lab) — hard reload before trusting
devshot comparisons.

## Cross-study primitive map

_Filled at the stop gate. Candidates being watched: the Field
(sample(x,y)→0..1 over output space), the fit-rect coordinate contract,
chan-channel seeded decisions, the density-ordered mark ramp, the
single stamp function._
