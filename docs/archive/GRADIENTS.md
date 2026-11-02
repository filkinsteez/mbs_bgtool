# Gradient looks

Open **Looks → Gradients** for Diffusion, Halo, Flow and Smear. The selected brand palette and color weights apply in both 2D and 3D.

## Current behavior

- **Diffusion:** uneven color fields with multiple scales of diffusion and deformation.
- **Halo:** a concentrated color region with locally changing focus and a broader falloff.
- **Flow:** curved color passages with unequal widths and stronger currents at high Complexity.
- **Smear:** horizontal drags with different starts, releases and fine streaks.

In 3D, the captured scene drives a full-frame raster effect. Moving, rotating, scaling or recoloring the loop changes the background beyond the original silhouette. Looks are applied after scene rendering and use the same processing for preview and export. They are never model materials or UV textures. A uniform source remains uniform apart from enabled grain.

The canonical Meta geometry stays unchanged. Generated 2D backgrounds keep the symbol off, including when older saves are loaded. Brush controls sit below the look controls.

## Controls

All controls use a 0–100 display and save as 0–1 values.

| Control | Range behavior |
| --- | --- |
| Complexity | Broad, simple structure through more numerous and smaller bends, exposures or drags. |
| Reflow | Continuously moves the color composition without changing the seed. Type a value or drag the slider; 50 is the neutral position. |
| Softness | Focused boundaries through broad spatial filtering. |
| Bleed | Increases how far neighboring color spreads. |
| Depth | Faint, diffuse composition through stronger color separation. |
| Distortion | Increases displacement and bending. |
| Distortion size | Changes the scale of the deformation. |
| Folds | Adds stronger local bends and overlapping drags. |
| Grain | Changes the amount of fine texture. |

Reflow, palette weights and the other look controls persist through autosave, look files, history and export. Exactly zero-weight swatches are excluded. A single active swatch remains that exact color apart from optional grain.

## Fixed thumbnails

Look thumbnails are static 256 × 144 WebP examples in `public/look-thumbnails`. Adjusting artwork never redraws them. The 3D gradient examples process the frozen canonical-loop capture in `scripts/fixtures/rendered-loop.png`; the other material catalogs retain their fixed generic examples.

Regenerate all 62 thumbnails with `npm run thumbnails`. The scripts require installed Chrome and the development dependencies.

## Verification

The control audit renders 0, 50 and 100 independently for every slider across four looks, six palettes and both modes. It checks the endpoints and each half of the range, with thresholds scaled to the palette's available color range. Grain uses a separate texture threshold. Single-color inputs deliberately cannot produce new color structure.

The current renderer passed 1,296 cases across standard landscape, the owner's higher-Folds settings and a second seed in portrait, plus 72 actual-UI slider ranges. [2D Complexity captures](docs/gradients/complexity-2d.png) and [3D Complexity captures](docs/gradients/complexity-3d.png) show the actual 0/50/100 results. These checks establish control response, not final artistic approval or every possible combination of settings.

Useful commands:

```sh
npm test
npm run build
npm run audit:gradient-controls
node scripts/audit-gradient-controls.mjs folded --folded
node scripts/audit-gradient-controls.mjs portrait --portrait
npm run check:gradients
node scripts/check-gradient-palette-continuity.mjs
node scripts/check-gradient-programs.mjs
npm run review:gradients
```

Source-response checks cover captured-loop movement and recoloring, uniform input, palette changes, color weights, excluded colors, single colors, Reflow continuity and preview/4K agreement. The palette regression includes yellow/cyan mixtures to catch unwanted saturated green. Program recovery checks cover renderer switching and WebGL context restoration.

Visual refinement remains ongoing. High settings can still create overly conspicuous curls or pale contours. Rejected optical and authored-texture experiments are kept outside the production renderer; no generated texture replaces the live 3D source.
