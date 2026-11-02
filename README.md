# MBS Background Tool

Makes raster background images for Meta marketing teams to use in place of the Meta gradient. Every image is light: Sunset (sky, horizon, bands of color) or Contour (one light and the edge it catches), in one of three brand color packs, exported as a PNG at a preset size with the seed in the file name. Warp Speed and the Grain, ASCII and Pixel filters come later.

## Run it

```bash
npm run dev     # http://localhost:3000
npm test        # vitest
npm run lint    # eslint
```

`/lab` is a development-only page that shows each reference image next to its render, with the preset's parameters.

## Where things are

- `src/light/`: the light engine (color math and packs, WebGL2 renderer and passes, recipes, presets)
- `scripts/light/`: render, compare and fit scripts for visual audits
- `docs/light/`: brief, roadmap and research
- `public/references/awe/`: reference target images and `manifest.json`
- `docs/references/awe/`: one notes file per reference
- `prototypes/`: CPU light-model prototypes
- `docs/archive/`: docs from the app before the 2026-11-02 rebuild

## Docs

- [Roadmap](docs/light/ROADMAP.md)
- [Brief](docs/light/BRIEF.md)
- [Index of all light docs](docs/light/README.md)
