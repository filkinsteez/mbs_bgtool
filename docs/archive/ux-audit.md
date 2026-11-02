# Canvas UX audit — against the Figma-class standard

The reference bar: Figma's canvas interaction model (selection docs +
shortcut conventions), cross-checked with the patterns shared by Sketch,
Canva and basement.studio's Shader Lab. The test is simple: someone who
lives in those tools should land on this canvas and have their hands
already know it.

## The standard, and where we sit

| Convention | Status | Notes |
| --- | --- | --- |
| Click selects an object | SHIPPED (pre-audit) | plus a 16px proximity reach for tiny type |
| Click empty canvas deselects | SHIPPED | was missing — selection used to be sticky |
| Marquee drag-select | SHIPPED | touch-select semantics (band touches = selected), live highlight while dragging, shift = additive |
| Shift-click toggles membership | SHIPPED | on blocks and through the proximity reach |
| Multi-select moves as a group | SHIPPED | dragging any member moves the whole selection by the same snapped delta |
| Delete removes the selection | SHIPPED | was single-block only |
| Escape backs out | SHIPPED | armed tool first, then selection — one layer of intent per press |
| Arrow-key nudge | SHIPPED | grid units: columns horizontally, baseline steps vertically; Shift = 4 baselines |
| Cmd/Ctrl+D duplicate | SHIPPED | copies offset two baselines, copies become the selection |
| Cmd/Ctrl+A select all | SHIPPED | |
| Undo/redo keys + buttons | SHIPPED (earlier round) | Ctrl+Z/Y + top-bar arrows with live depth |
| Tool strip with armed tools | SHIPPED | SELECT (V) / TEXT (T) / IMG, floating over the stage |
| Text tool: click places + edits | SHIPPED | snaps to the grid, enters editing, returns to SELECT after placing |
| Image upload by drag-drop | SHIPPED | drop a file anywhere on the canvas — it lands on the nearest cell, selected |
| Image blocks: select/drag/resize | SHIPPED | grid-snapped moves, corner handle snaps both spans to boundaries, Delete/arrows work |
| Double-click to edit text | SHIPPED (pre-audit) | double-click empty canvas also creates |
| Drag-reorder layers panel | SHIPPED (earlier round) | ghost + insertion seam + threshold click |
| Selection box hugs content | SHIPPED (earlier round) | span stays the wrap limit and alignment anchor |

## Deliberate deviations

- Nudges move in GRID units, not pixels. Free-pixel nudging would fight
  the product thesis (everything sits on the curve's grid); one column /
  one baseline per press is the honest translation.
- Marquee reaches type blocks AND images — the selection is fully mixed
  (group drag, delete, nudge, duplicate all treat it as one). Shape
  layers stay out: they are procedural fields, not individually
  addressable objects — selecting them happens in the LAYERS stack.

| Zoom + pan viewport | SHIPPED | Ctrl/pinch wheel zooms to cursor, wheel pans, space-drag + middle-drag pan, Ctrl+0 fit / Ctrl+1 100%, zoom chip. Pointer math survives any zoom (scale derives from live rects) |
| Alt-drag duplicates | SHIPPED | text and image blocks; the copy stays at the original anchor |
| Enter enters text editing | SHIPPED | single selection only |
| Overlap selection (deep click) | SHIPPED | clicking the same spot cycles DOWN the stack (topmost first, wraps) — anything behind anything is reachable |
| Paint-order control | SHIPPED | Ctrl+] / Ctrl+[ move the selected object forward/back within its layer; text-above-images stays (the poster model) |
| Scale from any corner | SHIPPED | four image handles; the dragged corner snaps to boundaries, the opposite corner pins — growth works against grid edges |
| Primitive drawing tools | SHIPPED | Cavalry-style instrument bar below the canvas: CURSOR, TEXT, IMAGE + RECT/ELLIPSE/POLY/STAR/LINE/BLOB (keys V T R O P S L B). Drag draws with live preview, shift constrains, click stamps a default size; drawn shapes are full canvas objects (select, marquee, move free-position, corner-resize, fill swatches, alt-drag, Ctrl+D, Delete) |
| Tool arms panel context | SHIPPED | picking TEXT flips the inspector to TYPE, shape tools flip to SHAPES |

## Backlog (ordered by value)

1. Union bounding box + shared handles around a multi-selection.
2. Right-click context menu (duplicate / delete / reorder).
3. Snap guides between blocks (smart spacing hints), beyond grid snap.
4. FLIP animation when layer rows reorder.
5. Image multi-select + mixed text/image marquee.
