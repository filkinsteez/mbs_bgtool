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

`public/icon-fill.svg` uses the Symbol path copied verbatim from Meta's
[official company-brand download](https://www.meta.com/brand/resources/meta/company-brand/):
`Meta_Company-Lockup.zip` →
`Meta_Company Lockup/3 Mono Black/RGB/Meta_lockup_mono_black_RGB.svg`.
The symbol's natural bounds are `1504.8272 × 1000`; consumers must preserve
that aspect ratio with uniform scaling.
