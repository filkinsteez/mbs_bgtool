# MBS Background Generator

This fork is focused on generating export-ready Meta backgrounds with a
simplified workflow:

- Format aspect selection (16:9, 9:16, 1:1, 4:5, custom) + export resolution presets
- Looks (Frame, Pixels, Scanlines, Streams, Brushwork, Beads, Quilt, Weave, Marks, Trails)
- Approved color packs + normalized ratio mixing
- Direct canvas move, scale, rotate, crop, pan, zoom, snapping, and undo/redo
- Independent Background and Material transforms with framing presets and numeric precision
- Licensed Shaders.com Glass/Liquid/Stainless Steel 1 finishes with a Clean fallback
- Static 4K PNG export, capability-gated experimental 8K, and loop-safe motion preview

## Stack

Next.js (App Router) · TypeScript · React · Zustand · Canvas/WebGL2 fallback ·
licensed `shaders` WebGPU runtime · Vitest.

## Develop

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # core math + determinism tests
npm run lint    # eslint
```

Everything runs client-side. `BackgroundRecipeV2` is deterministic from seed +
settings, migrates the previous recipe format, and is autosaved independently
from the original LAB. Background Looks re-render at requested export dimensions;
GPU materials use a separate offscreen renderer at the requested target size.

Commercial deployment of the Shaders.com finish layer requires an active Pro,
Team, or applicable OEM license. Unsupported WebGPU environments keep the
base-color canvas usable; Clean remains available as the guaranteed treatment.

## Material rendering fidelity

- The installed Shaders `3.0.452` runtime is WebGPU-only. Preview canvases use
  their visible CSS dimensions and the runtime's device-pixel ratio backing
  (capped at 2× on desktop and 1.5× on mobile), so a small frame is not enlarged.
- GPU material export uses the runtime's recording-resolution path at a 1:1
  pixel ratio and must produce the selected dimensions exactly. It fails instead
  of silently resampling when GPU texture-size or memory limits are exceeded.
- Stainless Steel 1 is procedural except for the Meta signed-distance field.
  Shaders `3.0.452` natively consumes that field at 512 × 512 in `r16float`;
  there is no compressed color texture to upscale.
- The preset's static `FilmGrain` (`strength: 0.1`) provides subtle,
  deterministic breakup of 8-bit gradients without softening detail. Browser
  Canvas PNG encoding remains limited to 8 bits per channel; the WebGPU
  intermediate math and SDF textures retain higher precision before encoding.

## Reference inputs

Source visual references used for this fork are in `docs/references/`.
