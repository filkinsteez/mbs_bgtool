# Motion lab — design/brand critique and the standing plan

Critique standard: how a VP of Design and a VP of Brand at a large tech
company would tear this down. Recorded so the fixes don't regress.

## The product's one promise

"The marked arc is what the speed graph reads." Every panel, caption, and
demo hangs off this identity. Anything that quietly transforms the curve
between the figure and the graph breaks the product, not just a view.

## Findings

| # | Severity | Finding | Fix (shipped) |
| --- | --- | --- | --- |
| 1 | P0 | Default presets shipped with STRENGTH baked in, so the played curve never matched the marked arc — the caption was false on first load | Presets carry zero treatment; strength/decay are explicit dials. Pinned by test: every preset's `lut === rawLut` |
| 2 | P0 | Two curves rendered with no legend when shaping is active | Note switches to "Solid: what plays. Dashed: the arc before strength/decay." |
| 3 | P1 | Square figure vs wide graph — identical math couldn't look identical | Speed panel uses the figure panel's exact square frame and padding; the arc and the curve are the same drawing at the same proportions |
| 4 | P1 | Bottom-half harvesting + absolute value flipped the drawing (arc pointed down, graph pointed up) | Top-half harvesting: x-falling windows, positive-y preference, screen-x orientation. No transform sits between the arc and the curve |
| 5 | P1 | Degenerate 1:1 line presented as the source of "easing" | Only LINEAR may use the line; eases source from the circle's quarter |
| 6 | P2 | Tokens (STANDARD/ENTER/EXIT/EMPHASIS) carry curated treatment | Allowed: loading a token shows its dials set, so the treatment is visible and inspectable |

## Standing rules

1. **The identity is inviolable**: marked arc ↔ speed curve, one drawing,
   no abs/flip/reparameterization between them.
2. **Defaults demo the story**: zero hidden treatment anywhere a first-time
   viewer lands.
3. **Treatments are staged, never silent**: when a dial is non-zero the raw
   arc stays visible (dashed) and the caption says so.
4. **The figure must justify the curve**: never show a source figure that
   couldn't visually produce the easing beside it.
5. **One clock**: playhead, ruler circle, vignettes, ambient — one tempo,
   aligned assemblies.
