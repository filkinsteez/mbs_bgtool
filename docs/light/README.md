# Light docs

## `docs/light/`

| File | What it is |
| --- | --- |
| [`BRIEF.md`](BRIEF.md) | The Figma brief: context, principles, the three moods and their references, layers, controls, output, filters, the color pack hexes, and visual attributes per mood |
| [`ROADMAP.md`](ROADMAP.md) | Phases 0 to 7, what each delivers and how it is judged, the visual audit loop, open questions for the owner |
| [`research-artists.md`](research-artists.md) | Artists and products that make similar light (Lieberman, Turrell, Eliasson, McCall, Rothko, Sugimoto, Blake, and graphics tools): what they made, how, what we take |
| [`research-techniques.md`](research-techniques.md) | Technical research: the rendering methods and math behind the light engine |

## `docs/light/research/`

| File | What it is |
| --- | --- |
| [`twilight-sky-color.md`](research/twilight-sky-color.md) | Measured twilight skies: where the brightest band sits, how color follows brightness, how wide transitions are at each height, the sideways falloff around the sun, color tables for sun +2° to −6° |
| [`products.md`](research/products.md) | Gradient and light products (Paper, Stripe, ShaderGradient, Unicorn Studio, Deep Glow, the Windows 10 hero image and more): technique, light or paint, controls, panel patterns, what we take |
| [`lens-glare-halation.md`](research/lens-glare-halation.md) | Lens diffusion, glare, bloom and halation: the Contour references share one exponential glow (length about 0.020 of the short side), halation fed by each channel's light above nominal, proposed lens settings and engine fixes |
| [`light-art.md`](research/light-art.md) | How light artists blend colored light (Turrell, Eliasson, Wheeler, Eversley, Barth and others): overlaps go lighter, color lives in the falloff, per-channel falloff, path length sets color depth |
| [`light-photography.md`](research/light-photography.md) | Camera-less and abstract light photography (Fabian Miller, Welling, Sugimoto, Fuss, Kasten): softness comes from the light's path; a "paper" response curve with a shoulder and an optional toe |
| [`prior-art-per-reference.md`](research/prior-art-per-reference.md) | Existing shader code and techniques for each of the 14 references, with license, formula and how to port, plus a ranked top 10 |
| [`perception-additive-light.md`](research/perception-additive-light.md) | How added light looks: hue shifts on the way to white, within-pack mixes that go grey, the bridge term, warm glow tails, recipe rules for bright and dark pack colors |
| [`halos-and-edges.md`](research/halos-and-edges.md) | Why a lit disc reads as a planet and a lit corner as a device: natural halos and coronas light the outside of their circle, edges belong to filled convex regions; rules for `contour.halo` and `contour.rim` |

## `docs/references/awe/`

One notes file per reference, named after its ID in [`public/references/awe/manifest.json`](../../public/references/awe/manifest.json). The target images are in `public/references/awe/<mood>/<id>.png`.

| Mood | Notes files |
| --- | --- |
| Sunset | [`sunset-sky-peach`](../references/awe/sunset-sky-peach.md), [`sunset-violet-wave`](../references/awe/sunset-violet-wave.md), [`sunset-red-yellow-arcs`](../references/awe/sunset-red-yellow-arcs.md), [`sunset-blue-diagonal`](../references/awe/sunset-blue-diagonal.md), [`sunset-film-poster-bands`](../references/awe/sunset-film-poster-bands.md), [`sunset-green-riso`](../references/awe/sunset-green-riso.md), [`sunset-blue-riso`](../references/awe/sunset-blue-riso.md), [`sunset-pink-riso`](../references/awe/sunset-pink-riso.md) |
| Contour | [`contour-rim-edge`](../references/awe/contour-rim-edge.md), [`contour-yellow-halo`](../references/awe/contour-yellow-halo.md), [`contour-iridescent-rings`](../references/awe/contour-iridescent-rings.md), [`contour-radial-streaks`](../references/awe/contour-radial-streaks.md), [`contour-beam-pool`](../references/awe/contour-beam-pool.md), [`contour-light-line`](../references/awe/contour-light-line.md) |
| Warp Speed | [`warp-long-exposure-streaks`](../references/awe/warp-long-exposure-streaks.md), [`warp-refracted-column`](../references/awe/warp-refracted-column.md), [`warp-curved-spectral-bands`](../references/awe/warp-curved-spectral-bands.md), [`warp-film-poster-columns`](../references/awe/warp-film-poster-columns.md) |

The same folder has contact sheets of each moodboard (`contact-sunset.png`, `contact-contour.png`, `contact-warp.png`) and measured color profiles per reference in `profiles/`.

## Elsewhere

- `docs/references/`: the brand palette cards and the stakeholder notes PDF.
- `prototypes/<name>/README.md`: what each light-model prototype tried and its verdict.
- `docs/archive/`: docs from the app before the 2026-11-02 rebuild.
