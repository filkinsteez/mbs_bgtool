# Reference Assets

This folder contains source artifacts used to build the forked MBS Background Generator:

- `MBS Transform— Replacing the Gradient.pdf`
- `primary-palette-reference.png`
- `bold-palette-reference.png`
- `harmonious-palette-reference.png`
- `atmospheric-palette-reference.png`
- `neutral-palette-reference.png`
- `extended-palette-reference.png`
- `approved-looks-reference.png`

`extended-palette-reference.png` is sampled at each swatch center into
`src/features/background-generator/palette/extended.ts`: 336 core colors,
24 neutral greys, 24 product blues, and 7 deep blues (391 total).
The picker exposes a curated 49-color subset grouped into seven useful
color families; the full sample remains here as source reference data.

The official `public/icon-fill.svg` is also the source for
`public/meta-symbol.sdf.bin`, generated through the authenticated Shaders.com
MCP for the licensed Glass and LiquidMetal shape effects.
