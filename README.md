# MBS Background Generator

This fork is focused on generating export-ready Meta backgrounds with a
simplified workflow:

- Format aspect selection (16:9, 9:16, 1:1, 4:5)
- V1 and V2 tabs for Frame, Pixels, Scanlines, Streams, Brushwork, Beads, Quilt, Weave, Marks, and Trails
- Approved color packs with weighted color mixing
- Direct canvas move, scale, rotate, centered aspect editing, pan, zoom, snapping, and undo/redo
- Orthographic 3D material viewer with Clean, Liquid, Glass, and Stainless Steel finishes
- One PNG export action with a fixed 3840px long edge
- Loop-safe 2D motion preview

## Stack

Next.js (App Router) · TypeScript · React · Zustand · Canvas2D · Three.js/WebGL · Vitest.

## Develop

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # core math + determinism tests
npm run lint    # eslint
```

Everything runs client-side. `BackgroundRecipeV2` is deterministic from its seed
and settings, migrates older saved recipes, and is autosaved independently from
the original Lab editor.

## Material rendering fidelity

- Three.js renders the supplied Meta OBJ with an orthographic camera.
- 3D Looks process the rendered frame through the same Canvas2D Look pipeline
  used by 2D output.
- Preview and export share the current material, camera, and Look state.
- Browser PNG output is 8 bits per channel.

## Reference inputs

Source visual references used for this fork are in `docs/references/`.
