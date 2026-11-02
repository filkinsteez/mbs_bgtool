# Light engine: technique research

How to build each part of the light engine in WebGL2: the options, the one we should use, the parameters it needs, what goes wrong, and which code we may copy. The pipeline these parts plug into is in [`ROADMAP.md`](ROADMAP.md) ("How an image is made"). Artists and products are in [`research-artists.md`](research-artists.md).

Conventions used below:

- "Linear" means scene-linear RGB with sRGB (Rec. 709) primaries. Values can exceed 1.
- "Nominal" means intensity 1: a flat field of a pack color at nominal must encode to its exact hex.
- Oklab L, C and h are lightness, chroma and hue angle in degrees. An Oklab ΔE of about 0.02 is one just-noticeable difference.
- "Short edge" is the shorter side of the output image. Sizes given as a fraction of it look the same at every aspect ratio and resolution.

How this was checked:

- Links were opened directly, not taken from search snippets. Two exceptions: Shadertoy blocks automated requests, so its shader IDs come from the articles that link them; Hable's blog was unreachable.
- Numbers marked "measured" come from scratch scripts run on this machine (Apple M4 Pro, Chrome 156, Node). The scripts live in `artifacts/research-techniques/`, which is gitignored, so the results are copied into this file.
- Every GLSL sketch below compiles under WebGL2 in Chrome 156. The tone curve sketch was also run on the GPU and matches the JS version to 2e-7.

---

## 1. Tone curve

### What we need

A flat pack color at nominal must come out as its exact hex, so the curve must leave every color with max(R, G, B) ≤ 1 unchanged. Above 1, light must move toward white like overexposed film: no clipping to a flat saturated color, no hue swing (blue must not turn purple or cyan), and no visible ring where the roll-off starts.

One constraint follows from exact pass-through. At max channel = 1 the brightest channel cannot rise any further, so its slope drops from 1 to 0 there. The curve can keep the slope of lightness continuous across the knee, but chroma always has a corner there: it rises below the knee and falls above it. The goal is to make lightness continuous and keep that chroma corner small.

### Options

- **Clamp.** Exact below 1. Above 1, channels saturate one at a time, so hue swings toward the nearest secondary color and never reaches white. Measured: Meta Blue at 8× becomes `#00FFFF`; Orange-red at 16× becomes `#FFFF00`.
- **Reinhard** ([Reinhard et al. 2002](https://doi.org/10.1145/566570.566575); [tech report PDF](https://www.cs.utah.edu/docs/techreports/2002/pdf/UUCS-02-001.pdf)). `x / (1 + x)` compresses everything, including values below 1, so pack colors are not exact. Applied per channel it skews hue; applied to luminance it keeps hue but never desaturates.
- **Hable / Uncharted 2** ([Hable 2010](http://filmicworlds.com/blog/filmic-tonemapping-operators/); the site was unreachable during this research, and the constants are also in [dmnsgn/shaders-tone-map](https://github.com/dmnsgn/shaders-tone-map), MIT). Per-channel filmic curve with a toe. Not identity below 1, and it skews hue per channel.
- **ACES fits** ([Narkowicz 2016](https://knarkowicz.wordpress.com/2016/01/06/aces-filmic-tone-mapping-curve/); Stephen Hill's fit in [BakingLab ACES.hlsl](https://github.com/TheRealMJP/BakingLab/blob/master/BakingLab/ACES.hlsl); `ACESFilmicToneMapping` in three.js). Per-channel curves skew hue. Saturated blue and red lights were a known problem in ACES 1: ACES added a "blue light artifact" fix and then replaced it with Reference Gamut Compression in 1.3 ([ACES RGC overview](https://github.com/aces-aswf/aces-docs/blob/main/docs/rgc/overview.md)). ACES 2.0 tone-maps lightness only, in a color-appearance space, and compresses colorfulness separately so hue is kept ([ACES 2 rendering overview](https://github.com/aces-aswf/aces-docs/blob/main/docs/system-components/output-transforms/technical-details/rendering-overview.md)).
- **AgX** (Troy Sobotka; Blender's default since 4.0, [release notes](https://developer.blender.org/docs/release_notes/4.0/color_management/)). An inset matrix, a log2 encode over about 16.5 stops, a sigmoid, then an outset matrix. Bright colors go toward white "similar to real cameras". `AgXToneMapping` in three.js follows Filament and Blender (see `node_modules/three/src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js`). [Wrensch's minimal AgX](https://iolite-engine.com/blog_posts/minimal_agx_implementation) is MIT, with a [Shadertoy cd3XWr](https://www.shadertoy.com/view/cd3XWr). Measured with a JS port of the three.js code: AgX cannot reproduce the saturated pack colors at any exposure. The closest Meta Blue it reaches is `#216EB7` (ΔE 0.072). Cyan, Yellow, Orange-red and Lime miss by ΔE 0.07 to 0.11. Dark and neutral pack colors come out close.
- **Khronos PBR Neutral** ([spec and code](https://github.com/KhronosGroup/ToneMapping/tree/main/PBR_Neutral), Apache-2.0; [write-up](https://modelviewer.dev/examples/tone-mapping)). Subtracts a 0.04 offset (a Fresnel term meant for 3D materials) and starts compressing at 0.76, then mixes toward white. It keeps hue around the RGB white axis, its derivatives are continuous, and it has an analytic inverse (`inverseNeutral` in `lut-writer.mjs`). Measured: it changes 7 of the 8 pack colors we tried at nominal (Yellow becomes `#F1CA21`, Forest `#003A2F`, Ice `#E8EAED`). Inverting the palette through it round-trips 10 of the 12 pack colors exactly. Yellow and Orange-red would need negative light, because their 255 channel is out of reach.
- **Lottes 2016** ([GDC slides](https://gpuopen.com/wp-content/uploads/2016/03/GdcVdrLottes.pdf), slides 56 to 63). Tone-map only `max(r, g, b)`, keep the ratio `rgb / max`, and add "channel crosstalk" that moves the ratio toward white as the light overexposes. A "direct path to white" desaturates fast. An "indirect path" that "moves brighter channels faster" keeps more saturation. His code does the lerp toward white inside a `pow(ratio, 1/crossSaturation)` space. This structure fits our requirement directly: identity on the max channel up to 1, and a controlled path to white above it.
- **Tony McMapface** ([h3r2tic/tony-mc-mapface](https://github.com/h3r2tic/tony-mc-mapface), MIT or Apache-2.0). A LUT-based display transform. It keeps hue apart from a deliberate Bezold–Brücke shift, and uses selective desaturation that avoids the Abney effect. It is not identity below 1, and the generator source is not published.
- **darktable sigmoid** ([manual](https://docs.darktable.org/usermanual/development/en/module-reference/processing-modules/sigmoid/), GPL-3.0). Useful as a description of the trade-off. "Per channel" mode creates "yellow sunsets and fires, magenta-looking blue lights, and cyan skies". "RGB ratio" mode keeps hue, and a "preserve hue" slider blends between the two.

Two perception effects explain why simple mixes look wrong. Adding white light to a color shifts its perceived hue: the [Abney effect](https://en.wikipedia.org/wiki/Abney_effect). Raising intensity pushes hues toward blue or yellow: the [Bezold–Brücke shift](https://en.wikipedia.org/wiki/Bezold%E2%80%93Br%C3%BCcke_shift). Mixing toward white in linear RGB is physically correct light addition, but it looks like blue turning violet and orange-red turning pink.

### Measured

Six curves were run on the pack colors (`tone-test.mjs`). The table shows output hex and Oklab hue as intensity rises:

| Curve | Meta Blue 2× | 4× | 8× | Orange-red 2× | 4× | 8× |
| --- | --- | --- | --- | --- | --- | --- |
| clamp | `#008AFF` 253° | `#00BDFF` 233° | `#00FFFF` 195° | `#FF6E00` 46° | `#FF9800` 64° | `#FFCF00` 92° |
| PBR Neutral | `#4C81F8` 264° | `#83A1FC` 269° | `#AEBFFE` 273° | `#FB7A65` 31° | `#FDA296` 27° | `#FEC3BD` 25° |
| identity ≤ 1, mix to white, rate matched | `#5E8CFF` 265° | `#A6B9FF` 272° | `#DAE1FF` 275° | `#FFA297` 27° | `#FFD9D5` 24° | `#FFF7F6` 23° |
| identity ≤ 1, crosstalk s = 2, rate matched | `#4497FF` 256° | `#B3D3FF` 256° | `#F1F7FF` 257° | `#FFBEA3` 43° | `#FFF5F1` 43° | `#FFFFFF` |
| identity ≤ 1, hue held in Oklab | `#4790FF` 259° | `#93BEFF` 259° | `#D1E3FF` 259° | `#FFA388` 37° | `#FFDACE` 37° | `#FFF7F5` 37° |

(Nominal Meta Blue is 259°, Orange-red 37°.)

The slope of Oklab L with intensity, just below and just above the knee, for Yellow:

- Fixed-rate mix to white (PBR Neutral's 0.15 with the knee moved to 1): 0.295 → 0.020. Lightness goes flat at the knee.
- Rate matched to luminance: 0.295 → 0.296.
- Crosstalk: 0.295 → 0.278.
- Hue held: 0.295 → 0.286.

The chroma corner at the knee (slope of C: +0.059 below) was smallest with crosstalk (−0.156 above), against −0.441 with hue held and −0.759 with the rate-matched direct mix.

By eye (radial glows at 7× peak, `tone-glows.png` and a zoomed crop): the fixed-rate curve shows a hard saturated ring around a flat pale core. The direct mix turns blue cores lavender. Crosstalk and hue-held both look like light. Crosstalk keeps blue blue and takes orange-red through peach, not pink.

### Recommended

Identity while max ≤ 1. Above it, keep the max channel at 1 and walk the other channels toward 1 along Lottes's indirect path. The whitening rate is set per pixel so that luminance keeps the slope it had below the knee.

```glsl
// Scene-linear in, display-linear out. Identity while max(rgb) <= 1.
// s = 1 is the direct path to white; s = 2 keeps more saturation and moves
// the brighter of the other two channels first (blue -> light blue, red -> orange -> peach).
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
vec3 toneCurve(vec3 c, float s) {
  c = max(c, vec3(0.0));
  float m = max(c.r, max(c.g, c.b));
  if (m <= 1.0) return c;
  vec3 r = c / m;                            // unit-peak ratio, max channel = 1
  vec3 rs = pow(r, vec3(1.0 / s));
  // luminance slope of the path at the knee, per unit of whitening;
  // the floor is only here, to avoid pow(0, 0) when s = 1
  vec3 rf = max(r, vec3(1e-6));
  float slope = dot(LUMA, s * pow(rf, vec3((s - 1.0) / s)) * (1.0 - pow(rf, vec3(1.0 / s))));
  float k = clamp(dot(LUMA, r) / max(slope, 1e-4), 0.05, 50.0);
  float w = 1.0 - exp(-k * (m - 1.0));       // 0 at the knee, -> 1 as light grows
  return pow(mix(rs, vec3(1.0), w), vec3(s));
}
```

Exposure (the Intensity control) multiplies the linear scene before the curve. At exposure 1, flat pack fields are unchanged. The lens passes must not change flat fields either (see sections 4 and 5).

If a later review wants hue held exactly, use the Oklab variant instead. Walk the straight Oklab line from the color toward white, reduce chroma at constant L and h until the color is inside sRGB ([Ottosson's gamut clipping](https://bottosson.github.io/posts/gamutclipping/)), and pick the point whose luminance matches the same rate. It costs a small binary search per pixel.

### Parameters

- `s` (path shape): 1 is direct (desaturates fast), 2 is the default, 3 keeps more saturation and drifts hue further toward the secondaries.
- A whitening-speed multiplier on `k`: 1 keeps the lightness slope continuous. Values above 1 whiten faster but bring back a lightness corner.
- Exposure.

### Pitfalls

- Mixing toward white in linear RGB makes blue look violet (+16°) and orange-red look pink (−14°).
- A whitening rate that doesn't depend on the color leaves a lightness plateau at the knee, which shows as a ring around every glow.
- Pure primaries (two channels at zero) make the matched slope zero. The clamp on `k` then whitens them quickly, with a small lightness corner. No pack color is a pure primary.
- Don't floor the ratio in the output path. Lifting a zero channel to even 1e-3 jumps it by about 3 code values at the knee, which shows as a faint ring.
- `pow` of a negative number is undefined in GLSL. Blur ringing and matrix conversions can produce small negatives, so clamp them first.
- If P3 output is added later, apply the knee in the output gamut.

### Licenses

- PBR Neutral: Apache-2.0 (spec text CC-BY-4.0).
- three.js AgX, Neutral and ACES fit: MIT.
- Wrensch AgX: MIT.
- dmnsgn tone maps: MIT.
- Tony McMapface: MIT or Apache-2.0.
- Lottes: slides only, so write our own code.
- darktable: GPL-3.0. Read the docs; don't copy code.

---

## 2. Color mixing without mud

### Why mud happens

- **Averaging sRGB-encoded values.** The gamma curve makes midpoints too dark. Ottosson: "sRGB darkens colors significantly when mixing saturated opposing colors" ([How software gets color wrong](https://bottosson.github.io/posts/colorwrong/)). Measured: the sRGB midpoint of Meta Blue and Orange-red is `#7F5A70`, Oklab L 0.51, darker than both ends (0.53 and 0.67). That breaks our bridge rule.
- **Straight lines in Oklab between near-opposite hues.** These pass through grey at the average lightness. Measured: Meta Blue to Yellow at the midpoint is `#8DA7AA` (C 0.03, grey-teal). [Oklab](https://bottosson.github.io/posts/oklab/) is a good ruler for lightness and hue, not a model of light.
- **Hue-angle interpolation (OkLCh).** It avoids grey but invents hues. The short way from blue to yellow passes through teal-green; the long way passes through hot pink.
- **Pigment models.** [spectral.js](https://github.com/rvanwijnen/spectral.js) (MIT) and [Mixbox](https://github.com/scrtwpns/mixbox) (CC BY-NC 4.0) mix blue and yellow to green on purpose. spectral.js's README shows `#002185` + `#FCD200` → `#3D933E`. That is paint, the wrong model for light.
- **Averaging many colors at every pixel.** Mesh gradients do this (Paper's weights up to 10 points by `1/d^3.5` in sRGB; Stripe's mixes about three), so in-between pixels drift toward the palette's average. With opposing hues that average is grey (see `research-artists.md`).
- **Darkened yellows and oranges read as olive and brown.** Any step that lowers the lightness of a warm color reads as mud.

### How real skies get lighter bridges

- **Light adds.** Where blue skylight and warm sunlit haze overlap, the eye gets the sum. The bridge is brighter than either side and less saturated, because opposite hues sum toward white.
- **Scattering saturates on long paths.** In-scattered light per channel grows like `1 − exp(−β·m)` with path length `m`. Near the horizon every channel saturates, so the color tends toward the color of the light doing the illuminating, which is pale ([diffuse sky radiation](https://en.wikipedia.org/wiki/Diffuse_sky_radiation)).
- **Aerosols scatter forward (Mie scattering).** That makes a broad whitish-yellow glow around the sun's direction.
- **At twilight, ozone keeps the zenith blue.** Chappuis absorption at 575 to 603 nm removes yellow-orange light along the long grazing path ([Chappuis absorption](https://en.wikipedia.org/wiki/Chappuis_absorption); [Hulburt 1953](https://doi.org/10.1364/JOSA.43.000113)). The zenith stays blue while the horizon is warm.

### Measured midpoints

From `color-test.mjs`, with the light sum run through the tone curve from section 1:

| Pair | sRGB lerp | Oklab lerp | Linear lerp | Two lights added |
| --- | --- | --- | --- | --- |
| Meta Blue → Yellow | `#7F9D7F` L 0.67, green-grey | `#8DA7AA` L 0.71, grey-teal | `#BCAAA6` L 0.75, warm pale grey | `#D4C0BC` L 0.82 |
| Meta Blue → Orange-red | `#7F5A70` L 0.51, darker than both ends | `#9D7093` L 0.60, dusty mauve | `#BC5AA4` L 0.61, magenta-pink | `#D467BA` L 0.67 |
| Sky blue `#3B6FB6` → beige `#D9C9B8` | `#8A9CB7` L 0.69, blue-grey | `#8B9DBA` L 0.69, blue-grey | `#A4A4B7` L 0.72, lavender-grey | `#B9BACF` L 0.80 |

In linear light the blue-to-beige blend passes through pale lavender-grey, then grey-beige nearer the beige end (`#C1B8B8` at three quarters). sRGB and Oklab stay bluer and darker. Blue light mixed with red light is magenta-pink; the violet and magenta zones of `sunset-violet-wave` and `sunset-pink-riso` are consistent with that. Watch one pair: Cyan next to Yellow (adjacent in the Bold pack) mixes to pale mint (`#BDD2B1`) in any additive model, because both are strong in green. To keep that bridge cream, let a warm haze term (section 3) or the blue sky term dominate it, or keep the two layers from overlapping much.

### Multi-stop interpolation without overshoot

- **Piecewise linear in linear light.** Corners at every stop show as faint lines (Mach bands) in long ramps.
- **Smoothstep inside each segment.** The slope is zero at every stop, so each stop becomes a flat plateau. That reads as bands: right for the bands recipe, wrong for long ramps.
- **Catmull-Rom.** Smooth and passes through the stops, but it overshoots, giving dark dips or hue spikes.
- **Uniform cubic B-spline.** Twice smooth, and it never overshoots because it stays inside its control points (`d3.interpolateRgbBasis`, [d3-interpolate](https://github.com/d3/d3-interpolate/blob/main/src/basis.js), ISC). It does not pass through the interior stops.
- **Monotone cubic Hermite per channel** ([Fritsch & Carlson 1980](https://doi.org/10.1137/0717021)). Smooth, passes through every stop, and no channel goes outside the range of its two neighboring stops.
- **Bands blurred by a Gaussian** (erf weights). Each band's weight is a difference of two error functions. The weights sum to 1 and are never negative, so there is no overshoot. A band wider than about 3σ keeps its exact color at its center. This is "three to five stacked bands blurred hard" done in linear light.

### Spectral rendering: does it help?

The RGB of a sum of spectra is the sum of their RGBs, so for adding lights linear RGB already gives the exact answer. Spectral rendering only changes results for products and powers of spectra: extinction `exp(−τ(λ)m)`, filters, thin-film interference, and dispersion.

Tools, if we need it:

- [Zucconi's wavelength → RGB fits](https://www.alanzucconi.com/2017/07/15/improving-the-rainbow-2/) ([Shadertoy ls2Bz1](https://www.shadertoy.com/view/ls2Bz1)).
- The analytic CIE fits of [Wyman, Sloan & Shirley 2013](https://jcgt.org/published/0002/02/01/).
- RGB → spectrum upsampling by [Smits 1999](https://doi.org/10.1080/10867651.1999.10487511) or [Jakob & Hanika 2019](https://doi.org/10.1111/cgf.13626) ([rgb2spec](https://github.com/mitsuba-renderer/rgb2spec), BSD-3; made for reflectances ≤ 1).

For Sunset, per-channel powers of a pack color (section 3) stand in for spectral extinction well enough, and they keep pack hexes exact. Spectral output would add hue shifts on long paths that we would then have to fight. Use 8 to 16 wavelength samples only for prisms and spectral streaks (Warp Speed) and for thin-film rims (section 8).

### Recommended

1. Build skies and glows by adding light layers in linear light (section 3), then apply the tone curve. Bright overlaps then go pale on their own.
2. For a ramp that must hit its stops exactly, use monotone cubic per channel in linear light. Bake it into a 1×1024 RGBA16F texture on the CPU from the preset's stops (this is derived from parameters, not from reference pixels).
3. For the bands recipe, use erf-blurred bands in linear light.
4. Never interpolate final colors in sRGB or Oklab. Use Oklab to place stops evenly and to check the bridge rule: Oklab L must not dip below the darker side by more than 0.01.

```ts
// Fritsch-Carlson tangents for one channel; xs strictly increasing.
function monotoneTangents(xs: number[], ys: number[]): number[] {
  const n = xs.length, d: number[] = [], m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return m; // evaluate each segment as a cubic Hermite with these tangents
}
```

```glsl
// Weight of band [e0, e1] after a Gaussian blur of width sigma (same units as t).
float erfApprox(float x) {            // Abramowitz-Stegun 7.1.26, max error 1.5e-7
  float t = 1.0 / (1.0 + 0.3275911 * abs(x));
  float y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-x * x);
  return sign(x) * y;
}
float bandWeight(float t, float e0, float e1, float sigma) {
  float k = 1.0 / (sigma * 1.41421356);
  return 0.5 * (erfApprox((e1 - t) * k) - erfApprox((e0 - t) * k));
}
```

### Parameters

- Ramps: stop positions and colors.
- Bands: band edges, blur σ (per edge if softness should vary along the horizon), layer gains for added light.

### Pitfalls

- Linear-light mixing of Cyan and Yellow gives mint. Plan the bridge as described above.
- Blurred bands narrower than about 3σ never reach their own color.
- Plateaus at stops (smoothstep chains) show up as bands at 4K.
- Interpolating in Oklab and then adding light double-counts the lift.

### Licenses

- Oklab code: public domain or MIT, per Ottosson's post.
- d3-interpolate: ISC.
- rgb2spec: BSD-3.
- spectral.js: MIT, but the wrong model for light.
- Mixbox: CC BY-NC 4.0, so it can't be used commercially without a license.

---

## 3. Skies and twilight

### Basics

- **Rayleigh scattering** by molecules goes as λ⁻⁴ with phase `3/(16π)(1 + cos²θ)`. **Mie scattering** by aerosols is nearly wavelength-independent and strongly forward. It is usually modeled with the Henyey–Greenstein phase `(1 − g²) / (4π (1 + g² − 2g cosθ)^1.5)`, with g around 0.75 to 0.9.
- Light along a path is attenuated by `exp(−β·∫density)`.
- **Air mass** relative to the zenith is `m = 1 / (sin h + 0.50572 (h° + 6.07995)^−1.6364)` ([Kasten & Young 1989](https://doi.org/10.1364/AO.28.004735)). It is about 1 at the zenith and about 38 at the horizon.

### Physical models

- **[O'Neil, GPU Gems 2 ch. 16](https://developer.nvidia.com/gpugems/gpugems2/part-ii-shading-lighting-and-shadows/chapter-16-accurate-atmospheric-scattering)**: real-time single scattering, ray-marched. [glsl-atmosphere](https://github.com/wwwtyro/glsl-atmosphere) (Unlicense) is a small GLSL version.
- **[Preetham et al. 1999](https://doi.org/10.1145/311535.311545)**: an analytic daylight sky. Poor near and below the horizon.
- **[Hosek & Wilkie 2012](https://doi.org/10.1145/2185520.2185591)** ([project page](https://cgg.mff.cuni.cz/projects/SkylightModelling/)): better sunsets, but only for the sun at or above the horizon.
- **Prague sky model** ([Wilkie et al. 2021](https://cgg.mff.cuni.cz/publications/skymodel-2021/), with a wide-spectrum version in [Vévoda et al. 2022](https://doi.org/10.1111/cgf.14677); [code](https://github.com/PetrVevoda/pragueskymodel), Apache-2.0): fitted data, valid for solar elevations from −4.2° to 90°. Large data files.
- **[Bruneton & Neyret 2008](https://doi.org/10.1111/j.1467-8659.2008.01245.x)** ([2017 reimplementation](https://ebruneton.github.io/precomputed_atmospheric_scattering/), BSD-3): precomputed multiple scattering in 4D tables.
- **[Hillaire 2020](https://doi.org/10.1111/cgf.14050)** ([PDF](https://sebh.github.io/publications/egsr2020.pdf); [code](https://github.com/sebh/UnrealEngineSkyAtmosphere), MIT): small transmittance, multiple-scattering and sky-view lookup tables, an isotropic approximation of multiple scattering, and any sun angle including below the horizon. This is the physical model worth porting.

[`prototypes/sunset-scattering`](../../prototypes/sunset-scattering) already implements a spherical-shell single-scattering model with Hillaire's multiple-scattering approximation and palette-driven media. Its README will record how it compares with the references.

Physical skies produce real-sky colors, not pack colors. A physical model has to be driven by the palette (below), or used only to decide where light goes.

### The twilight features in the references, and cheap 2D forms

Let `e` be the elevation above the warped horizon, in radians, and `az` the horizontal angle from the sun's azimuth. The sun is below the horizon by `δ` (2° to 7° in civil twilight).

- **Horizon glow, or bright segment** (sun side). A warm band hugging the horizon, brightest at the sun's azimuth, fading upward and sideways. It is orange-red at the horizon line and yellow-white higher up and close to the sun. Form: `exp(−e/H) · exp(−az²/(2w²))` times the sun color for a path that grows toward the horizon.
- **Peach and pink band before dawn.** The same glow at larger `δ`: narrower, deeper in color, with purple light above it.
- **Purple light.** With the sun 2° to 6° below the horizon, a broad pink-purple glow appears about 15° to 25° up on the sun side: reddened light scattered high up, added to blue skylight ([afterglow](https://en.wikipedia.org/wiki/Afterglow)). Form: a wide Gaussian in `e` and `az`, warm-pink colored, added to the sky. The purple comes from the addition.
- **Earth's shadow** (anti-sun side). A dark blue-grey band on the horizon whose top edge rises as the sun sinks ([Earth's shadow](https://en.wikipedia.org/wiki/Earth%27s_shadow)). Form: below a soft edge at about `e = δ`, dim the sky term and desaturate it.
- **Belt of Venus.** A pink band 10° to 20° above the anti-sun horizon, just above Earth's shadow: reddened sunlight scattered back ([Belt of Venus](https://en.wikipedia.org/wiki/Belt_of_Venus)). Form: a Gaussian band just above the shadow edge, warm-pink, added.
- **Sun below the horizon.** No disc. The brightest point sits on the horizon at the sun's azimuth, and the glow shrinks and deepens as `δ` grows.
- **Pale bridge between blue and warm.** Not a separate term. It is where the sky term and the glow term overlap and add.

### Making it respond to any palette

- **One warm color is a whole family of sunlight colors.** If warm color `W` (normalized to max 1) is sunlight after a reference path, then by Beer–Lambert sunlight after a path `p` times as long is `W^p`, per channel. Measured:

  | Warm color | p = 3 | 2 | 1 | 0.5 | 0.25 | 0.1 |
  | --- | --- | --- | --- | --- | --- | --- |
  | Orange-red `#FF4F00` | `#FF0200` | `#FF1200` | `#FF4F0D` | `#FF9047` | `#FFC089` | `#FFE4C8` |
  | Yellow `#FFD61E` | `#FF9600` | `#FFB301` | `#FFD61E` | `#FFEA5F` | `#FFF49D` | `#FFFBD2` |
  | Tan `#B8996E` | `#FF9334` | `#FFB15C` | `#FFD59A` | `#FFE9C7` | `#FFF4E1` | `#FFFAF3` |

  Deep red at the horizon, peach above it and cream near the bridge all come from one pack color. That matches the brief's "one warm color at most". Floor zero channels (0.004 in the table) so small powers can lift them. Brightness is set separately: longer paths are also dimmer.
- **The sky color as a scattering color.** Use the sky pack color (Meta Blue holds the sky) per channel as the scattering strength: `sky = A·(1 − exp(−β·m(e)))`, with `β` solved so the top of the frame equals the pack color exactly. The sky saturates and goes pale toward the horizon on its own. A zero channel stays zero, so the red for a warm-grey bridge must come from the glow and haze terms.
- **The palette as spectral bands.** Each pack color becomes its own scattering channel, with extinction falling along pack order. The image is the sum of the bands' radiance times their colors, so stacked bands appear in pack order with lighter bridges where they overlap. This is the `bandMedium` mode of the scattering prototype.
- **Packs without a warm color** (Atmospheric). Use Ice as the light (moonlight, blue hour). `Ice^p` stays a cool white, and Steel and Slate shade the shadow side.

### Recommended

For production recipes, a cheap 2D field made of added terms, with the full scattering prototype as the reference for how it should look:

```glsl
// All terms are linear light and get added. CPU-side: beta = -log(1 - skyColor / skyCeil) / airmass(eTop)
// (needs skyColor < skyCeil per channel), warm = warmColor / max3(warmColor), floored at 0.004.
float airmass(float e) {
  float h = max(e, 0.0);
  return 1.0 / (sin(h) + 0.50572 * pow(degrees(h) + 6.07995, -1.6364));
}
vec3 sunsetField(float e, float az) {
  vec3 sky = skyCeil * (1.0 - exp(-beta * airmass(e)));                  // exact pack color at the top
  float shadow = antiSun * (1.0 - smoothstep(sunDepth - shadowSoft, sunDepth + shadowSoft, e));
  sky *= mix(1.0, shadowDim, shadow);                                    // Earth's shadow
  float path = glowPath * exp(-max(e, 0.0) / glowPathHeight);            // longer path near the horizon
  vec3 sun = pow(warm, vec3(path)) * exp(-0.3 * path);                   // redder and dimmer when longer
  float ga = az / glowWidth, ge = max(e, 0.0) / glowHeight;
  vec3 glow = glowGain * sun * exp(-ge) * (exp(-0.5 * ga * ga) + glowWide * exp(-abs(ga) * 0.5));
  vec3 purple = purpleGain * pow(warm, vec3(0.6)) * exp(-0.5 * pow((e - purpleE) / purpleW, 2.0)) * exp(-0.5 * ga * ga * 0.25);
  vec3 belt = beltGain * antiSun * pow(warm, vec3(0.4)) * exp(-0.5 * pow((e - sunDepth - beltOffset) / beltW, 2.0));
  vec3 haze = hazeGain * pow(warm, vec3(0.1)) * exp(-max(e, 0.0) / hazeHeight);   // pale warm lift at the bridge
  return sky + glow + purple + belt + haze;
}
// Horizon: e = (uv.y - horizonY - warpAmp * fbm(uv.x * warpFreq + seed)) * fov, with low-frequency fbm and
// a softness that also varies along x, so the horizon is never a ruler line.
```

### Parameters

- `sunDepth` (δ).
- Glow: path, height, width, gain, wide tail.
- Shadow: softness and dim.
- Belt: offset, width, gain.
- Purple: elevation, width, gain.
- Haze: height, gain.
- Horizon: Y, warp amplitude and frequency, softness.
- `fov`, and the sky ceiling `skyCeil` (a little above the sky color's max channel).

### Pitfalls

- Preetham and Hosek–Wilkie can't do a sun below the horizon.
- Zero channels make Beer–Lambert powers stay zero, so floor them.
- Real twilight brightness ratios are huge. Set exposure so the bridge, not the glow core, sits near nominal.
- A hard Earth's-shadow edge looks wrong. Its penumbra spans several degrees.
- Too many warm terms turn a Meta Blue sky into an "Instagram gradient". Keep one warm color, and keep the glow narrow in `az`.

### Licenses

- Hillaire's code: MIT.
- Bruneton: BSD-3.
- Prague: Apache-2.0.
- glsl-atmosphere: Unlicense.
- Formulas from papers can be reimplemented freely.

---

## 4. Bloom and lens

### Options

- **One Gaussian.** Too short a tail, and it reads as fog.
- **Unreal standard bloom** ([docs](https://dev.epicgames.com/documentation/en-us/unreal-engine/bloom-in-unreal-engine)): "multiple Gaussian blurs with different radius", Blur1 to Blur5 at 1/2 to 1/32 resolution, each with its own Tint and Size.
- **Unreal convolution bloom** (same page): an FFT convolution with a kernel image that "represent[s] physically realistic bloom", "energy conserving". Meant for cinematics and high-end hardware.
- **Jimenez 2014**, Call of Duty: Advanced Warfare ([slides](https://advances.realtimerendering.com/s2014/sledgehammer/Next-Generation-Post-Processing-in-Call-of-Duty-Advanced-Warfare-v17.pptx), SIGGRAPH 2014 Advances course). A 13-tap downsample chain, a 3×3 tent upsample that adds each level back, no brightness threshold, and a lerp with the scene at a small weight. [LearnOpenGL's physically based bloom](https://learnopengl.com/Guest-Articles/2022/Phys.-Based-Bloom) gives the same method with code, including the Karis average against single-pixel "fireflies" and a mix of about 0.04.
- **Dual filter, a Kawase variant** ([Bjørge, SIGGRAPH 2015](https://community.arm.com/cfs-file/__key/communityserver-blogs-components-weblogfiles/00-00-00-20-66/siggraph2015_2D00_mmg_2D00_marius_2D00_slides.pdf)). A 5-tap downsample and an 8-tap upsample. On a Mali-T760 at 1080p, for a blur the size of a 97×97 kernel at similar quality: Gaussian 41.9 ms, Kawase 4.5 ms, dual filter 2.8 ms. Use it for a fast preview on weak GPUs.
- **Eye point-spread function** ([Spencer et al. 1995](https://doi.org/10.1145/218380.218466), read from the paper; θ in degrees). Photopic `P = 0.384 f0 + 0.478 f1 + 0.138 f2`, where:
  - `f0 = 2.61e6 · exp(−(θ/0.02)²)` is the narrow core;
  - `f1 = 20.91 / (θ + 0.02)³`;
  - `f2 = 72.37 / (θ + 0.02)²`;
  - a "lenticular halo" ring near 3° at 568 nm, scaling with wavelength.

  A sharp core plus a power-law tail between θ⁻³ and θ⁻².
- **[Ritschel et al. 2009](https://doi.org/10.1111/j.1467-8659.2009.01357.x)**: the eye's PSF from wave optics (an FFT of the pupil, with lens fibers, particles and lashes). It explains star bursts. We don't need it.
- **Camera veiling glare** ([Talvala et al. 2007](https://doi.org/10.1145/1275808.1276424)): fitted as `C0 + C1/r + C2/r² + C3/r³` (the form used in Banterle's [HDR Toolbox](https://github.com/banterle/HDR_Toolbox), GPL-3.0).

### Long tails from a blur pyramid

Summing normalized Gaussians whose σ doubles per level gives a power-law tail. Measured over r = 4 to 128 px:

- Equal weight per level gives a tail of r⁻²·⁰.
- Weight ∝ 1/σ gives r⁻³·⁰.
- Weight ∝ σ gives r⁻¹·⁰.

Spencer's photopic PSF sits between r⁻³ near the core and r⁻² farther out, so per-level weights between "equal" and "1/σ" match it. This is why the pyramid looks like a lens and a single Gaussian does not.

### Energy conservation

A lens moves light around; it doesn't make light. Mix, don't add: `out = mix(scene, bloom, strength)`, where `bloom` is the weighted sum of levels divided by the sum of weights. A blur of a flat field is the same flat field, so flat pack colors stay exact. Additive bloom with a threshold brightens the whole image, and halos switch on abruptly at the threshold.

### Recommended

- Jimenez-style pyramid in RGBA16F: 13-tap downsamples and tent upsamples.
- No threshold. Use the Karis average on the first downsample only if tiny hot sources sparkle.
- A weight and tint per level, applied while upsampling (GLSL ES 3.00 can't index sampler arrays with a loop variable, so accumulate in the upsample passes).
- Define radii as fractions of the short edge, and compute the number of levels from the largest radius. A 4K export then has the same bloom as a 1K preview.

```glsl
// Upsample pass for level k: tent-filter the accumulated coarser level and add this level's downsample.
// The final accumulated texture is divided by sum(weightK) on the CPU side (pass 1/sum as a uniform).
uniform sampler2D coarser;     // accumulated bloom from level k+1 (half this size)
uniform sampler2D thisLevel;   // downsample result at level k
uniform vec2 coarserTexel;     // 1.0 / size of coarser
uniform float weightK;         // e.g. pow(2.0, -p * float(k)), p between 0 (r^-2 tail) and 1 (r^-3)
uniform vec3 tintK;            // normalized so dot(tintK, LUMA) == 1
in vec2 uv; out vec4 o;
vec3 tent(sampler2D t, vec2 p, vec2 d) {
  vec3 s = texture(t, p).rgb * 4.0;
  s += (texture(t, p + vec2(d.x, 0)).rgb + texture(t, p - vec2(d.x, 0)).rgb
      + texture(t, p + vec2(0, d.y)).rgb + texture(t, p - vec2(0, d.y)).rgb) * 2.0;
  s += texture(t, p + d).rgb + texture(t, p - d).rgb
     + texture(t, p + vec2(d.x, -d.y)).rgb + texture(t, p + vec2(-d.x, d.y)).rgb;
  return s / 16.0;
}
void main() { o = vec4(tent(coarser, uv, coarserTexel) + weightK * tintK * texture(thisLevel, uv).rgb, 1.0); }
```

### Parameters

- `strength`: the mix, 0.02 to 0.15.
- Tail exponent `p`.
- Per-level tint: core neutral; widest levels slightly warm for haze, or slightly blue for night air.
- Largest radius, as a fraction of the short edge.
- Optionally a few explicit "core, glow, haze" weights instead of `p`.

### Pitfalls

- 3840 = 15 × 2⁸, so sizes stop halving cleanly after 8 levels. Pass the real texel size of each level, and use `CLAMP_TO_EDGE` so borders don't darken.
- A fixed level count makes bloom shrink at 4K relative to the preview.
- Half floats hold values up to 65504 with about 3 significant digits. That's fine for bloom; use RGBA32F only for FFTs.
- An FFT bloom at 4K needs a padded 4096² complex RGBA32F buffer, over 500 MB, so skip it.
- With a threshold, faint light never blooms, and the image loses the "seen through a lens" feel.

### Licenses

Formulas from papers and slides: reimplement. LearnOpenGL code is CC BY-NC 4.0 (stated on the site), so reimplement rather than copy. The HDR Toolbox is GPL-3.0.

---

## 5. Halation and film response

### What it is

Light passes through the emulsion, reflects off the film base or the camera behind it, and comes back to expose the film from behind. The red-sensitive layer sits nearest the base, so the halo is red. Very bright light also reaches the green layer, so the halo is orange next to the overexposed edge and red farther out. Halos show "only against the darker backgrounds, meaning on the dark side of the contrast borders". Film's anti-halation layer reduces the effect ([Dehancer on halation](https://www.dehancer.com/learn/learn_articles/halation-in-dehancer)).

### How tools model it

- **[spektrafilm](https://github.com/andreavolpato/spektrafilm)** (GPL-3.0; read only). Back-reflection halation is a sum of three Gaussians with widths growing as √k and strength decaying by 0.5 per bounce. Strength per channel is (R 0.05, G 0.015, B 0), and the first σ is 65 µm, about 7 px across a 36 mm frame at 3840 px. In-emulsion scatter is a Gaussian core (2.2, 2.0, 1.6 µm) plus an exponential tail (9.3, 9.7, 9.1 µm) with tail weights (0.78, 0.65, 0.67). Physical halation is small; the deck's look is larger, so treat radius as an art control.
- **[hotgluebanjo/halation-dctl](https://github.com/hotgluebanjo/halation-dctl)** (no license, so read only). It uses an exponential kernel `exp(−r/r0)` instead of a Gaussian. Its README lists "bad falloff. Often from a Gaussian or box blur", and a "banding problem where the dissipating area is split into two color swaths". Its "Proosa" method keeps energy per channel: `(rgb + blurred·(1, 0.15, 0)) / (1 + (1, 0.15, 0))`. Red becomes half sharp, half blurred; green 13% blurred; blue untouched.
- **Dehancer** (commercial). Controls for source threshold, "Background Gain" (which backgrounds allow halos), two diffusion radii, and hue shift.
- **darktable** has no halation module. Its [diffuse or sharpen](https://docs.darktable.org/usermanual/development/en/module-reference/processing-modules/diffuse/) module has a "bloom" preset (GPL-3.0). FilmConvert was not checked.

### Recommended

Additive, small, from light above nominal, with two radii (green narrow, red wide), suppressed on bright backgrounds. Place it in scene-linear after bloom and before the tone curve.

The above-nominal part needs its own blur. Compute it in the first downsample and carry it down a second, smaller pyramid; starting at 1/4 resolution is enough, since the halo is wide. Mixing two adjacent levels approximates an exponential kernel better than a single Gaussian.

```glsl
uniform vec2 halAmount;    // (red, green), e.g. (0.12, 0.03)
uniform float bgGain;      // 0..1: how much bright surroundings suppress the halo
// hotNarrow, hotWide: blurred copies of hot = c * smoothstep(1.0, 2.0, max3(c)), so flat fields at nominal give 0
vec3 halation(vec3 c, vec3 hotNarrow, vec3 hotWide) {
  float wide = dot(hotWide, LUMA), narrow = dot(hotNarrow, LUMA);
  float bg = 1.0 - bgGain * smoothstep(0.0, 1.0, dot(c, LUMA));
  return c + bg * vec3(halAmount.x * wide, halAmount.y * narrow, 0.0);
}
```

### Parameters

- Knee: 1 to 2 × nominal.
- Red radius: 1.5% to 3% of the short edge. Green radius: 0.5% to 1%.
- Amounts, and background gain.

For a strict energy-conserving version, use the per-channel mix `c + a ⊙ (blur(c) − c)` with `a = (aR, aG, 0)`. It only moves red that the source actually has.

### Pitfalls

- Gaussian halos show two color swaths; use summed levels.
- A halo tinted at the source turns the whole highlight orange; the core should go white through the tone curve.
- Halation on bright backgrounds looks like a color cast.
- Halation added before bloom gets bloomed twice.

### Licenses

spektrafilm and darktable are GPL-3.0, and the DCTL has no license, so reimplement from the descriptions above.

---

## 6. Volumetric beams in 2D

### Point light in uniform fog

[Sun et al. 2005](https://doi.org/10.1145/1186822.1073309) give an analytic single-scattering model. [Macklin 2010](https://blog.mmacklin.com/2010/05/29/in-scattering-demo/) gives the simple closed form for an isotropic medium with a point light. The light scattered toward the eye along a ray of length `d` is `σs·I·∫dt/|p + t·v − s|²`, and completing the square gives an `atan` difference:

```glsl
float inScatter(vec3 start, vec3 dir, vec3 lightPos, float d) {   // Macklin 2010
  vec3 q = start - lightPos;
  float b = dot(dir, q), c = dot(q, q);
  float s = 1.0 / sqrt(c - b * b);
  return s * (atan((d + b) * s) - atan(b * s));
}
```

[iq's fog article](https://iquilezles.org/articles/fog/) adds a cheap sun glare inside fog: the fog color moves from blue toward warm by `pow(max(dot(viewDir, sunDir), 0.0), 8.0)`.

### Cone beam seen from the side

Take a spot light pointing along +y in the image, with a Gaussian angular profile of width `s` (radians), in thin uniform fog. Integrate through the beam along the view direction. In the small-angle limit:

`L(x, y) ≈ (σs·I/4π) · √(2π)·s · exp(−x² / (2(s·y)²)) / y`

The cross-section is a Gaussian whose width grows linearly with distance. Peak brightness falls as 1/y, not 1/y², because the path through the beam lengthens. The light crossing each slice of the beam stays constant without extinction. Measured against numerical integration: within 1% to 2% for s = 0.08, with the flux identical at y = 1, 2 and 4. A hard-edged cone gives `(2/√(x²+y²))·atan(z0/√(x²+y²))`, with `z0 = √(R² − x²)` the half-chord.

### The pool where it lands

A floor point at horizontal distance ρ from the beam axis, with the light at height h, receives `E = I(φ)·h / (h² + ρ²)^1.5`, where `φ = atan(ρ/h)` (inverse square times the cosine of incidence). For a finite range and a soft edge, use Frostbite's distance window `saturate(1 − (d²/r²)²)²` and its spot angle falloff `saturate(cosφ·scale + offset)²` ([Lagarde & de Rousiers 2014](https://seblagarde.files.wordpress.com/2015/07/course_notes_moving_frostbite_to_pbr_v32.pdf), `smoothDistanceAtt` and `getAngleAtt`). In the image, the floor is foreshortened: map screen y below the floor line to floor depth by `1/q`, with `q` the camera tilt. The floor streaks in `contour-beam-pool` are glossy reflections, so mirror the beam and pool about the floor line, narrow them sideways, and smear them vertically with an exponential decay.

### Screen-space radial blur (god rays)

[GPU Gems 3, ch. 13](https://developer.nvidia.com/gpugems/gpugems3/part-ii-light-and-shadows/chapter-13-volumetric-light-scattering-post-process): march from each pixel toward the light's screen position, summing samples with exponential decay.

```glsl
vec3 godRays(sampler2D src, vec2 uv, vec2 lightUV, int n, float density, float weight, float decay, float exposure) {
  vec2 stepUV = (uv - lightUV) * density / float(n);
  vec2 p = uv; float illum = 1.0; vec3 sum = vec3(0.0);
  for (int i = 0; i < n; i++) { p -= stepUV; sum += texture(src, p).rgb * illum * weight; illum *= decay; }
  return sum * exposure;
}
```

It needs an occluder or a textured source to make visible shafts. It needs many samples at 4K, so run it at half or quarter resolution (it is smooth) and jitter the start with blue noise. For streaks that converge on a point, like `contour-radial-streaks`, an analytic form is resolution-independent and has no sample count. Use smooth 1D noise in the angle around the vanishing point, times a radial falloff that brightens toward it. Paper's God Rays shader works this way.

### Long-exposure streaks

A directional blur of the bright parts along the motion direction, with an exponential or box kernel. Or draw the streaks analytically, as segments with the line integral from section 7, so the cores stay sharp and the tails stay long.

### Recommended

For `contour-beam-pool`:

- the Gaussian beam formula, with extinction `exp(−σt·y)` and a little fog noise for haze texture;
- the floor pool from the irradiance formula;
- reflections smeared down;
- then bloom and halation.

Use radial blur only where an occluding shape must cut shafts.

### Parameters

- Apex position, spread `s`, power, extinction.
- Fog noise amount and scale.
- Floor line and tilt `q`.
- Floor albedo and gloss streak length.

### Pitfalls

- The beam is infinite at the apex. Add about 1 px to the width and clamp y.
- Radial blur at 4K with few samples shows stepping.
- If the beam gets brighter with distance, the 1/y factor is missing or inverted.

### Licenses

Formulas from papers and articles: reimplement. GPU Gems 3 is NVIDIA's free online book; reimplement the loop above.

---

## 7. Glow along curves and edges

### Profiles

- **Gaussian of distance.** The tail is too short; it looks like a soft stroke, not light.
- **Exponential.** Longer tail, with a cusp at d = 0.
- **Lorentzian `1/(1 + (d/r)²)`.** This is the exact line-spread function of a point-spread `1/(r² + a²)^1.5`, so it is what a line seen through a lens with a long-tailed point-spread looks like.
- **Sum of Gaussians.** Fits any profile. Skin rendering fits diffusion profiles with six Gaussians ([d'Eon & Luebke, GPU Gems 3 ch. 14](https://developer.nvidia.com/gpugems/gpugems3/part-iii-rendering/chapter-14-advanced-techniques-realistic-real-time-skin)). For us: a core, a glow and a haze width.

### Analytic line light

An inverse-square point kernel integrated along a segment has a closed form (the same atan as Macklin). The glow fades naturally at the segment's ends, which a distance-field profile can't do.

```glsl
// Glow at p from a uniform segment a->b; r0 softens the core (px). An infinite line gives pi / d.
float segmentGlow(vec2 p, vec2 a, vec2 b, float r0) {
  vec2 ab = b - a; float len = length(ab); vec2 t = ab / len;
  vec2 ap = p - a; float u = dot(ap, t);
  float d = sqrt(max(dot(ap, ap) - u * u, 0.0) + r0 * r0);
  return (atan((len - u) / d) + atan(u / d)) / d;
}
```

Measured: matches numerical integration exactly. For a curve, sum the segments of a polyline (20 to 40 segments per visible arc). A line drawn this way already has a 1/d tail. Add a separate thin core (smoothstep over about 1 px at high intensity) so the tone curve turns the core white while the glow keeps the line's color.

### Rim light without a 3D model

For `contour-rim-edge`, take a 2D signed distance `d` to the shape, negative inside. [iq's 2D distance functions](https://iquilezles.org/articles/distfunctions2d/) cover rounded triangles and arcs; reimplement them.

- **Inner rim:** `exp(d / wIn)` for d < 0, a short falloff into the dark interior.
- **Outer glow:** the sum-of-Gaussians profile for d > 0.
- **One source:** the outward normal is `n = normalize(∇d)` (analytic, or by central differences). Multiply by `pow(0.5 + 0.5·dot(n, lightDir), q)`, so the rim is brightest where the edge faces the light and fades around the shape ("one source only").
- **Interior:** a faint, dark fill inside, e.g. `fill·exp(d / wFill)` in navy.

For more of a 3D feel, use a height `h = smoothstep(0, −w, d)` and its gradient as a normal, with a Fresnel-like `(1 − n.z)^5`. Then bloom and the tone curve: the hottest part of the rim goes blue-white, the tail stays blue.

### Recommended

- Segment or polyline integrals for lines, as in `contour-light-line`.
- An SDF rim with a directional term for edges.
- Sum-of-Gaussians or Lorentzian profiles where a distance field is the only option.
- In every case, add a thin hot core so the tone curve makes it white.

### Parameters

- Core width and intensity.
- Glow: `r0` and gain.
- Rim: inner falloff `wIn`, outer profile weights.
- Light direction and its exponent `q`.
- Fill.

### Pitfalls

- Distance-field glows don't fade at curve ends and double up at tight bends.
- A Gaussian alone looks like a stroke.
- The core must be thin and bright, not wide and dim, or the result never whitens.

### Licenses

iq's article pages state no license, so reimplement (the formulas are short). d'Eon & Luebke: reimplement.

---

## 8. Iridescence and dispersion

### Thin-film interference

[Belcour & Barla 2017](https://doi.org/10.1145/3072959.3073620) ([project page](https://belcour.github.io/blog/research/publication/2017/05/01/brdf-thin-film.html)) give an Airy summation evaluated in Fourier space against the eye's color-matching curves. That avoids the aliasing of sampling three wavelengths. Khronos adopted it as [`KHR_materials_iridescence`](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_iridescence): film IOR 1.3, thickness 100 to 400 nm, and "pastel colored patterns for increased thickness". three.js ships it as `evalIridescence` and `evalSensitivity` in `node_modules/three/src/renderers/shaders/ShaderChunk/iridescence_fragment.glsl.js` (MIT).

A cheap version is two-beam interference with a phase flip at one interface: `R(λ) ≈ 0.5 − 0.5·cos(2π·OPD/λ)` with `OPD = 2·n·thickness·cosθt`, evaluated at λ ≈ (650, 532, 460) nm. It doesn't wash out to pastel for thick films the way real films do, so keep thickness under about 500 nm, or use the three.js function.

### Cosine palettes

[iq's palettes](https://iquilezles.org/articles/palettes/), `color(t) = a + b·cos(2π(c·t + d))` ([Shadertoy Xl2GRc](https://www.shadertoy.com/view/Xl2GRc), [ll2GD3](https://www.shadertoy.com/view/ll2GD3)), give smooth cyclic color ramps from four vectors. They are good for mapping a film phase onto chosen colors.

### Prism dispersion and chromatic aberration

- **Prism dispersion.** [Cauchy's equation](https://en.wikipedia.org/wiki/Cauchy%27s_equation) `n(λ) = A + B/λ²`, with BK7 glass at A = 1.5046 and B = 0.00420 µm², or dense flint SF10 at 1.7280 and 0.01342. Spread one ray into 8 to 16 wavelength samples, map each to RGB (Zucconi or the Wyman CIE fits), and normalize the weights so the samples sum to white.
- **Chromatic aberration.** Scale UVs radially per sample: `uv' = c + (uv − c)·(1 + k·(λ − λ0))`. With only R, G and B offsets you get three hard-edged ghosts; spectral samples give a smooth fringe.

### Recommended

For `contour-iridescent-rings`:

1. A ring SDF with a thin rim profile.
2. Film thickness varying smoothly around the ring, e.g. `mix(tMin, tMax, 0.5 + 0.5·sin(angle·k + seed))`, fed to the three.js sensitivity function. The thickness range decides which colors appear; tune it until the rim passes through the reference's lavender, cyan and coral.
3. Overlapping rims add, and the tone curve turns the overlaps white, as in the reference.

For production with pack colors, map the film phase through a cosine palette or a ramp built from pack colors instead of physical spectra.

For `contour-light-line`'s warm halo (yellow on one side, red-magenta on the other), use lateral dispersion with 8 or more wavelength samples, plus halation.

### Parameters

- Thickness range, film IOR, angle frequency.
- Rim width, overlap gain.
- Dispersion strength `k`, sample count.

### Pitfalls

- Sampling RGB at three wavelengths aliases into rainbow noise at large thickness.
- Physical spectra introduce non-pack hues, which production must avoid.
- Three-tap chromatic aberration shows ghost edges.

### Licenses

- three.js iridescence: MIT.
- Belcour & Barla and the glTF extension: reimplement from the paper or use the three.js port.
- iq: reimplement.

---

## 9. Banding

### What matters

From [Gjøl, "Banding in Games"](https://loopit.dk/banding_in_games.pdf):

- Dither "just before quantizing", "in whatever space the color will be quantized in". For our 8-bit PNG that is sRGB-encoded values.
- Dithering after quantizing does nothing: `trunc(f + rnd)` is right, `trunc(f) + rnd` is wrong.
- Triangular-distribution noise (TPDF), from two uniform randoms: `rnd1 + rnd2 − 1`, in [−1, 1) LSB, "because GPUs round". It gives the same noise level at every value; uniform noise leaves some values noisier than others.
- Near 0 and 1, clamping breaks the noise's symmetry. "lerp to a 1LSB uniform-PDF noise at boundaries".
- "Blue noise is less noticeable". Dither each intermediate 8-bit write too, although our intermediate targets are float.
- Shadertoys cited there: [MslGR8](https://www.shadertoy.com/view/MslGR8) (dither methods) and [XsfXzf](https://www.shadertoy.com/view/XsfXzf) (dithering in the right color space).

### TPDF vs blue noise

TPDF white noise is cheap (a hash) and correct. Blue noise has the same amplitude statistics but its energy sits at high frequencies, so it is less visible at 1:1. For blue noise:

- Use a tiled 64×64 or 128×128 blue-noise texture ([Peters's free blue-noise textures](https://momentsingraphics.de/BlueNoise.html), CC0), with a different offset per channel.
- Convert uniform blue noise to triangular with the inverse CDF: `u < 0.5 ? sqrt(2u) − 1 : 1 − sqrt(2 − 2u)`.
- Or generate it in code with void-and-cluster ([Ulichney 1993](https://doi.org/10.1117/12.152707); [Wolfe's walkthrough](https://blog.demofox.org/2019/06/25/generating-blue-noise-textures-with-void-and-cluster/) and [MIT code](https://github.com/Atrix256/VoidAndCluster)). A 64×64 tile takes well under a second in JS; bake 128×128 at build time.
- Interleaved gradient noise (Jimenez 2014 slides) is a cheap alternative: `fract(52.9829189·fract(dot(px, vec2(0.06711056, 0.00583715))))`.

### 8-bit vs 16-bit PNG

`canvas.toBlob` writes 8-bit PNG, and so does `OffscreenCanvas.convertToBlob`. For 16-bit, read the final display-referred float target with `readPixels(RGBA, HALF_FLOAT)` and encode with [fast-png](https://github.com/image-js/fast-png) or [UPNG.js](https://github.com/photopea/UPNG.js) (both MIT, neither installed). In Node, `sharp` (installed) writes 16-bit PNGs. Social and slide tools use 8-bit, so the dithered 8-bit PNG is the deliverable. A 16-bit file only helps someone who will grade it further.

### Recommended

The last pass at output size: display-linear → sRGB encode → grain (section 10) → TPDF dither in encoded units → write RGBA8.

```glsl
vec3 ditherTPDF(vec3 s, vec2 fragCoord) {         // s: sRGB-encoded, 0..1, before 8-bit
  vec3 u1 = hash33(vec3(fragCoord, seed)), u2 = hash33(vec3(fragCoord, seed + 17.0));
  vec3 tri = u1 + u2 - 1.0;                       // [-1, 1) LSB
  vec3 uni = u1 - 0.5;                            // [-0.5, 0.5) LSB
  vec3 v = s * 255.0;
  vec3 edge = min(clamp(v / 0.5, 0.0, 1.0), 1.0 - clamp((v - 254.5) / 0.5, 0.0, 1.0));
  return s + mix(uni, tri, edge) / 255.0;
}
```

### Pitfalls

- Dithering in linear light, before the sRGB encode, gives the wrong amplitude.
- Dither R, G and B with independent noise; Gjøl notes this gives finer luminance steps.
- Changing the seed every frame makes the preview shimmer. Use a fixed seed.
- Grain alone fails as a dither where grain fades (near black and white), so keep the TPDF step.

### Licenses

- Peters's textures: CC0.
- VoidAndCluster: MIT.
- fast-png and UPNG.js: MIT.

---

## 10. Grain

### Physical model

[Newson et al. 2017](https://doi.org/10.1111/cgf.13159) ([IPOL article and code](https://www.ipol.im/pub/art/2017/192/), GPL-3.0-or-later; [IPOL DOI](https://doi.org/10.5201/ipol.2017.192)):

- Grains are disks (radius `r`, optionally log-normal).
- Their centers come from a Poisson process with density `λ = −ln(1 − u)/(π·r²)`, so the expected covered fraction equals the gray level `u`.
- Each output pixel is the covered fraction seen through a Gaussian filter, estimated by Monte Carlo.

It is resolution-independent and looks real, but it is costly.

The cheap consequence: the variance of the covered fraction is about `u(1 − u)·(grain area / filter area)`. Grain amplitude should therefore scale as `sqrt(u(1 − u))`: strongest in midtones, fading in deep shadows and highlights.

### Cheap options

- [glsl-film-grain](https://github.com/mattdesl/glsl-film-grain) (MIT): periodic 3D noise offset by a simplex noise, blended with soft light and reduced by luminance.
- AV1 film grain synthesis ([Norkin & Birkbeck 2018](https://doi.org/10.1109/DCC.2018.00008); [AV1 spec](https://aomediacodec.github.io/av1-spec/)): an autoregressive-filtered Gaussian noise template tiled with random offsets, scaled by a piecewise-linear function of intensity.
- Dehancer drives grain by local brightness rather than laying it on top (see `research-artists.md`).

### Riso print grain

From [Wikipedia: Risograph](https://en.wikipedia.org/wiki/Risograph):

- The stencil master has "microscopic holes" burned by thermal heads.
- The inks are translucent soy inks, layered "to create unique hues".
- Tones are made either as "screen", resembling halftone dots, or as "grain touch".
- The paper is uncoated and shows its texture.

Misregistration between drums is visible in the references.

The model, in linear light:

- **Coverage per ink layer:** `cov = smoothstep(t − e, t + e, density)`, with `t` a blue-noise threshold at the stencil dot size (1.5 to 3 px at 4K for grain touch). `e` softens it like ink spread.
- **Paper tooth:** subtract fiber noise from the coverage so solids show specks of paper.
- **Misregistration:** offset each layer by 0.5 to 3 px with a tiny rotation.
- **Compose:** `paper × Π mix(1, inkColor_i, cov_i)`. Inks filter light, so they multiply.

### Recommended

The production Grain filter:

- monochrome luminance grain at output pixel size;
- standard deviation `strength·sqrt(u(1 − u))` in sRGB-encoded units (strength 0.02 to 0.04 gives the brief's 1% to 2% at midtones), from blue noise blurred by a 3×3 binomial so it clumps slightly;
- seeded by the preset seed;
- applied after the sRGB encode and before the TPDF dither.

Grain at or above 1 LSB dithers on its own, but keep the TPDF step for the dark and bright ends.

For the riso references, use the riso model above in their reference presets only.

### Parameters

- Strength, grain size in output px, clumping blur, seed.
- Riso: dot size, ink spread, paper tooth, per-layer offsets.

### Pitfalls

- Grain applied before the downsample from a 2× render gets averaged away.
- The preview is smaller than the export, so 1 px grain at 4K averages out in a 1K preview. Show a 100% crop, or scale the preview amplitude to what the export will look like at the same viewing size.
- Colored per-channel grain changes color, and the brief says the filter "changes the surface, never the color".

### Licenses

- Newson's code: GPL-3.0, so reimplement from the paper.
- glsl-film-grain: MIT. It depends on webgl-noise, which is MIT.

---

## 11. Organic diffusion

### Options

- **Poisson or membrane fill.** Colored seeds spread smoothly into the empty pixels.
  - [ofxPoissonFill](https://github.com/LingDong-/ofxPoissonFill) (MIT) is a GLSL convolution pyramid using the kernels from [Farbman et al. 2011](https://doi.org/10.1145/2024156.2024209). Down: a 5×5 separable `h1 = [0.1507, 0.6836, 1.0334, 0.6836, 0.1507]` with stride 2 on premultiplied color and alpha. Up: a 3×3 `g = [0.0312, 0.7753, 0.0312]` on the current level, plus `h2 = 0.0270` times `h1` on the upsampled coarser level. Each pass divides by the accumulated alpha, so empty pixels (alpha 0) take color from their neighbors.
  - [Diffusion curves](https://doi.org/10.1145/1399504.1360691) (Orzan et al. 2008) set colors on both sides of curves and solve the same equation, with blur along the curve. That maps well onto soft band boundaries.
  - GPU multigrid ([Bolz et al. 2003](https://doi.org/10.1145/1201775.882364)) solves it exactly in more passes.
  - Push-pull ([Gortler et al. 1996](https://doi.org/10.1145/237170.237200)) is cheaper but blockier.
- **Jump flooding** ([Rong & Tan 2006](https://doi.org/10.1145/1111411.1111431)). Distance fields and nearest-seed maps from any mask in log2(N) passes. Use it when a shape exists only as an image.
- **Domain warping** ([iq](https://iquilezles.org/articles/warp/); Shadertoys [4s23zz](https://www.shadertoy.com/view/4s23zz), [lsl3RH](https://www.shadertoy.com/view/lsl3RH)): `f(p) = fbm(p + 4·fbm(p + 4·fbm(p)))`. Low frequency and small amplitude bend horizons and band edges; high frequency looks like marble.
- **Feedback and displacement** (Lieberman; TouchDesigner's [Feedback TOP](https://docs.derivative.ca/Feedback_TOP)). Repeatedly resample the image at `p + ε·v(p)`, with `v` a curl-noise field, plus a small blur. Colors smear and spread.

### Recommended

- For "no horizon at all and a few wide blooms": a Poisson fill from a few soft colored blobs, placed and colored by parameters, in RGBA16F linear light. Then add one or two light terms and bloom.
- For warped horizons: low-frequency domain warp.
- Feedback only with a fixed seed and a fixed iteration count, with displacement in short-edge units so export and preview match.

### Parameters

- Seeds: position, color, radius, strength.
- Fill pyramid depth (log2 of the short edge).
- Warp amplitude and frequency.
- Feedback: step size, iterations, blur.

### Pitfalls

- A membrane fill from single-pixel seeds makes visible peaks at the seeds. Use soft blobs, or blur once afterwards.
- Doing the fill in 8-bit sRGB (as ofxPoissonFill does) bands and darkens. Use RGBA16F linear.
- Feedback that depends on resolution gives different exports at each size.

### Licenses

ofxPoissonFill and VoidAndCluster: MIT. iq: reimplement. Papers: reimplement.

---

## 12. Building blocks and licenses

| Library | License | Copy into the app? | What to take |
| --- | --- | --- | --- |
| [three.js](https://github.com/mrdoob/three.js) (`node_modules/three`, 0.185.1) | MIT | Yes, keep the notice | AgX, Neutral, ACES fit, thin-film iridescence |
| [Khronos ToneMapping](https://github.com/KhronosGroup/ToneMapping) | Apache-2.0 | Yes, keep the notice | PBR Neutral and its analytic inverse |
| [Wrensch minimal AgX](https://iolite-engine.com/blog_posts/minimal_agx_implementation) | MIT | Yes | Reference AgX |
| [dmnsgn/shaders-tone-map](https://github.com/dmnsgn/shaders-tone-map) | MIT | Yes | Many operators for comparison |
| [Tony McMapface](https://github.com/h3r2tic/tony-mc-mapface) | MIT or Apache-2.0 | Yes | A LUT for comparison |
| Oklab ([Ottosson](https://bottosson.github.io/posts/oklab/)) | Public domain or MIT | Yes | Conversions, gamut clipping |
| [@paper-design/shaders](https://github.com/paper-design/shaders) | Apache-2.0 | Yes | Shapes and warps only; it mixes colors in sRGB, with no tone curve |
| [lygia](https://github.com/patriciogonzalezvivo/lygia) | Prosperity 3.0.0 (non-commercial, 30-day commercial trial), or the Patron license for sponsors and contributors | No, unless Meta sponsors or licenses it | Use the original MIT sources it wraps, or reimplement |
| [webgl-noise](https://github.com/stegu/webgl-noise) | MIT | Yes | Simplex and periodic noise |
| [glsl-film-grain](https://github.com/mattdesl/glsl-film-grain) | MIT | Yes | Grain pattern |
| [ofxPoissonFill](https://github.com/LingDong-/ofxPoissonFill) | MIT | Yes | Poisson-fill kernels |
| [VoidAndCluster](https://github.com/Atrix256/VoidAndCluster) | MIT | Yes | Blue-noise generation |
| [Blue-noise textures](https://momentsingraphics.de/BlueNoise.html) | CC0 | Yes | Ready-made tiles |
| [hdr-toys](https://github.com/natural-harmonia-gropius/hdr-toys) | MIT | Yes (mpv hook format, needs porting) | HDR-to-SDR tone maps, gamut mapping |
| [glsl-atmosphere](https://github.com/wwwtyro/glsl-atmosphere) | Unlicense | Yes | Small scattering march |
| [UnrealEngineSkyAtmosphere](https://github.com/sebh/UnrealEngineSkyAtmosphere) | MIT | Yes | Hillaire's sky |
| [Bruneton](https://ebruneton.github.io/precomputed_atmospheric_scattering/) | BSD-3 | Yes, keep the notice | Precomputed scattering |
| [Prague sky model](https://github.com/PetrVevoda/pragueskymodel) | Apache-2.0 | Yes | Fitted sky data (large) |
| [rgb2spec](https://github.com/mitsuba-renderer/rgb2spec) | BSD-3 | Yes | Spectral upsampling |
| [d3-interpolate](https://github.com/d3/d3-interpolate) | ISC | Yes | B-spline basis |
| [FLIP](https://github.com/NVlabs/flip) | BSD-3 | Yes (harness) | Perceptual difference |
| [fmin](https://github.com/benfred/fmin) | BSD-3 | Yes (harness) | Nelder–Mead |
| [pycma](https://github.com/CMA-ES/pycma) | BSD-3 | Port with the notice | CMA-ES |
| [fast-png](https://github.com/image-js/fast-png), [UPNG.js](https://github.com/photopea/UPNG.js) | MIT | Yes (not installed) | 16-bit PNG |
| [spectral.js](https://github.com/rvanwijnen/spectral.js) | MIT | Allowed, but not useful | Pigment mixing, wrong for light |
| [Mixbox](https://github.com/scrtwpns/mixbox) | CC BY-NC 4.0 | No | — |
| [spektrafilm](https://github.com/andreavolpato/spektrafilm), [darktable](https://github.com/darktable-org/darktable), [HDR Toolbox](https://github.com/banterle/HDR_Toolbox), [Newson IPOL code](https://www.ipol.im/pub/art/2017/192/) | GPL-3.0 | No | Read for parameters and methods |
| [halation-dctl](https://github.com/hotgluebanjo/halation-dctl) | None stated | No | Read only |
| iq's articles | None stated | No | Reimplement the formulas |
| Shadertoy | CC BY-NC-SA 3.0 unless the shader says otherwise | Only shaders with a permissive header (e.g. Wrensch's AgX, MIT) | — |

Shadertoys worth opening (IDs taken from the pages that link them):

- [cd3XWr](https://www.shadertoy.com/view/cd3XWr): minimal AgX.
- [Xl2GRc](https://www.shadertoy.com/view/Xl2GRc), [ll2GD3](https://www.shadertoy.com/view/ll2GD3): cosine palettes.
- [4s23zz](https://www.shadertoy.com/view/4s23zz), [lsl3RH](https://www.shadertoy.com/view/lsl3RH): domain warping.
- [MslGR8](https://www.shadertoy.com/view/MslGR8): dither methods.
- [XsfXzf](https://www.shadertoy.com/view/XsfXzf): dithering in the right color space.
- [ls2Bz1](https://www.shadertoy.com/view/ls2Bz1): spectral fits.
- iq's [2D SDF playlist](https://www.shadertoy.com/playlist/MXdSRf).

Shadertoy itself blocks automated requests, so check each shader's license header in a browser before copying anything.

---

## 13. WebGL2 practicalities

### Float targets and extensions

WebGL2 can filter RGBA16F textures without an extension, but rendering into RGBA16F or RGBA32F needs `EXT_color_buffer_float` (RGB16F is not renderable). Blending into 32-bit float targets needs `EXT_float_blend`, and linear filtering of 32-bit float textures needs `OES_texture_float_linear`.

Support from [web3dsurvey](https://web3dsurvey.com/webgl2/extensions/EXT_color_buffer_float), WebGL2 contexts:

| Extension | macOS | Safari | iOS | Firefox | Chrome |
| --- | --- | --- | --- | --- | --- |
| `EXT_color_buffer_float` | 99.98% | 100% | 100% | 99.98% | 99.93% |
| `OES_texture_float_linear` | 87.15% | 59.18% | 53.92% | 98.72% | 94.04% |
| `EXT_float_blend` | 87.11% | 59.06% | 53.72% | 99.58% | 98.29% |
| `EXT_color_buffer_half_float` | 95.08% | 100% | 100% | 1.02% | 99.39% |

API support from [MDN browser-compat-data](https://github.com/mdn/browser-compat-data): `EXT_color_buffer_float` in Chrome 56, Firefox 51, Safari 15. WebGL2 in `OffscreenCanvas` in Chrome 69, Firefox 105, Safari 17. `convertToBlob` in Chrome 69, Firefox 105, Safari 16.4.

So: use RGBA16F for every intermediate target, filter them linearly, and blend into them freely. Never rely on filtering or blending RGBA32F. Firefox doesn't expose `EXT_color_buffer_half_float` in WebGL2, so always request `EXT_color_buffer_float`.

### Measured on this machine

Headless Chrome 156 through Playwright `channel: 'chrome'`, M4 Pro. A light scene pass, a 13-tap and tent pyramid, and a final pass with tone curve and dither to RGBA8:

| Output | Mip levels | RGBA16F base | Pyramid | RGBA8 out | Scene | Bloom | Final | readPixels 8-bit | readPixels half | PNG encode (`toBlob`) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 3840×2160 | 7 | 66 MB | 44 MB | 33 MB | 1.5 ms | 2.8 ms | 1.5 ms | 16 ms | 19.5 ms | 171 ms |
| 3840×3840 | 8 | 118 MB | 79 MB | 59 MB | 2.4 ms | 3.9 ms | 2.4 ms | 24 ms | 30.5 ms | 315 ms |
| 7680×4320 | 8 | 265 MB | 177 MB | 133 MB | 8.4 ms | 8.0 ms | 2.3 ms | 48 ms | 67.5 ms | — |
| 7680×7680 | 9 | 472 MB | 315 MB | 236 MB | 4.0 ms | 8.2 ms | 4.7 ms | 83 ms | 119 ms | — |

These are single runs after one warm-up, so the small numbers are noisy: the 7680×4320 scene pass came out slower than 7680×7680. `MAX_TEXTURE_SIZE` was 16384 (8192 under SwiftShader).

GPU time is not the problem; memory, readback and PNG encoding are. The roadmap reads "Rendered at 2x" as running the light passes at twice the export size. For 1:1 that means about 1 GB of float targets. It worked here, but it is a risk on 8 GB Macs and in Safari.

Three ways to keep the 2× rule cheaper:

1. Run the scene pass at 2× (it is analytic and smooth), downsample into the 1× base, and build the bloom pyramid from 1× (bloom starts at half resolution anyway).
2. Supersample in the shader (four rotated-grid samples per pixel) only in recipes with thin cores.
3. Render in tiles with a margin as wide as the largest bloom radius.

This is a Phase 1 decision.

### readPixels

- `readPixels(RGBA, UNSIGNED_BYTE)` on a float framebuffer fails with `INVALID_OPERATION`. This silently broke the first timing run.
- Float targets accept `RGBA/FLOAT`. They also accept the implementation's choice, here `RGBA/HALF_FLOAT`, which `IMPLEMENTATION_COLOR_READ_TYPE` reports.
- For export, render the final pass into an RGBA8 target and read bytes, or draw it to the canvas and call `toBlob` in the same task (or use `preserveDrawingBuffer`).
- Write alpha = 1 in the final pass, and keep `premultipliedAlpha: false`, so alpha never alters PNG pixels.
- Leave `drawingBufferColorSpace` as `'srgb'`, so canvas pixels stay the sRGB-encoded values we wrote.

### Headless Chrome for the harness

Measured:

- With Playwright `chromium.launch({ channel: 'chrome', headless: true })` and no flags, WebGL2 runs on the real GPU: "ANGLE Metal Renderer: Apple M4 Pro". All four float extensions are present, and float readback works.
- `--use-angle=metal --ignore-gpu-blocklist` changed nothing.
- `--use-angle=swiftshader --enable-unsafe-swiftshader` gives a software renderer limited to 8192 px. Use it only for machines without a GPU (Linux CI), and not for 2× exports.

On Linux CI you need a GPU-backed ANGLE backend or the SwiftShader flags. Check `UNMASKED_RENDERER_WEBGL` in the harness, and fail loudly if it says SwiftShader when a GPU was expected.

### Precision

- Use `precision highp float` in every fragment shader.
- Half floats: max 65504, about 3 significant digits. Good for light and bloom, not for accumulating thousands of small steps (use RGBA32F without blending for that).
- Derivatives (`dFdx`) are per 2×2 quad. Avoid them in analytic glows that must match across tiles.

---

## 14. Fitting renders to references

### Optimizers

- **[Nelder–Mead](https://doi.org/10.1093/comjnl/7.4.308)** ([fmin](https://github.com/benfred/fmin) `nelderMead`, BSD-3): fine for up to about 10 parameters. It stalls in narrow valleys, so restart from the best point.
- **CMA-ES** ([Hansen's tutorial](https://arxiv.org/abs/1604.00772); [pycma](https://github.com/CMA-ES/pycma), BSD-3, to port, about 200 lines of TS): the standard derivative-free method for 10 to 50 parameters. It copes with noise and scaling.
- **Coordinate search, coarse to fine:** good for a first pass and easy to follow by hand.
- Fit at low resolution first (the targets are smooth; 256 px on the short edge renders in milliseconds), then refine at the target size.

### Losses

- **Blurred Oklab ΔE.** Blur target and render with the same Gaussian (σ about 1% of the short edge, as in the roadmap) to remove grain. Skip the manifest's `ignore` rects and average the Euclidean distance in Oklab (CSS Color 4's [deltaEOK](https://www.w3.org/TR/css-color-4/#color-difference-OK)).
- **Profile losses.** For Sunset: the mean Oklab per row (horizontal structure). For halos and beams: radial or cross-beam profiles. These match structure without rewarding pixel-level copying.
- **SSIM on luminance** ([Wang et al. 2004](https://doi.org/10.1109/TIP.2003.819861)), at two or three scales, for the shape of falloffs.
- **[FLIP](https://doi.org/10.1145/3406183)** ([code](https://github.com/NVlabs/flip), BSD-3) as an extra perceptual check and error map.
- **Rule penalties:** the bridge rule (L dips no more than 0.01 below the darker neighbor), and pack hexes exact at nominal for production presets.

```ts
function loss(p: Float64Array): number {
  const img = render(decode(p), 256);                      // WebGL2 in headless Chrome
  const a = blurToOklab(img, 0.01), b = target256;         // same blur on both
  const dE = meanDeltaEOK(a, b, ignoreMask);
  const prof = rowProfileLoss(a, b);                       // or radial for Contour
  const prior = sumSquares(p, start, scales);              // stay near the hand-set start
  return dE + 0.5 * prof + 0.01 * prior + bridgePenalty(a);
}
```

### Avoiding overfitting

- Few parameters, each with bounds and a prior toward a sensible default.
- Nothing that encodes per-row colors or lookup tables (that is sampling the reference by another route).
- After fitting, render the preset at the other three aspect ratios and two other seeds. It must still look right.
- Prefer changing the model over adding parameters when a residual has structure.
- Look at the difference image, and let the visual review decide.

---

## Recommendations for this project

Ordered by how much they change the Sunset and Contour matches.

1. **Tone curve: identity up to max channel 1, then Lottes's crosstalk path to white (s = 2) with the whitening rate matched to luminance.** Pack hexes stay exact, glows whiten without a ring, blue stays blue and orange goes through peach. Every Contour glow and every Sunset glow depends on it.
2. **Build skies by adding light terms, not by interpolating colors.** A sky term that saturates toward the horizon, a warm glow from the powers of one warm pack color, purple light, Earth's shadow, the Belt of Venus and a pale warm haze. Bridges come out lighter and less saturated on their own, as in `sunset-sky-peach` and `sunset-violet-wave`.
3. **Ramps and bands in linear light only.** Monotone cubic per channel for exact stops, baked into a 1D half-float texture. erf-blurred bands for the bands recipe. Oklab only to place stops and check the bridge rule. Plan the Cyan-to-Yellow bridge (mint) for the Bold pack.
4. **Lens: a Jimenez-style pyramid without a threshold, mixed rather than added.** Per-level weights set the tail (equal weights give r⁻², 1/σ gives r⁻³, which matches the eye's spread). Tints per level, radii in short-edge units, level count from the largest radius. This is the "core + glow + haze" falloff the Contour references need.
5. **Contour sources as analytic light.** The segment atan integral for the light line, the Gaussian beam closed form (width ∝ distance, brightness ∝ 1/distance) and inverse-square floor pool for the beam, and an SDF rim with a one-sided directional term. The falloff is right before the lens even runs.
6. **Halation: small, additive, from light above nominal, red wide and green narrow, suppressed on bright backgrounds.** It gives the orange-then-red fringe on the dark side of highlights and leaves flat pack fields untouched.
7. **Output: sRGB encode, then grain, then TPDF dither in encoded units at output size,** fading to uniform noise near 0 and 1. Monochrome grain with amplitude ∝ √(u(1−u)). A separate riso model only for the three riso references.
8. **Organic structure:** a low-frequency domain warp of the horizon with softness varying along it, and a Poisson fill (Farbman kernels, RGBA16F linear) for the wide-bloom recipe.
9. **Iridescent rings:** the thin-film sensitivity function from three.js on the ring rims, with thickness varying around the ring for the reference; a palette-mapped film phase for production. Overlaps add, and the tone curve takes them to white.
10. **Export:** RGBA16F everywhere with `EXT_color_buffer_float`; float `readPixels` only with FLOAT or HALF_FLOAT; the final pass into RGBA8. Decide in Phase 1 how to meet "rendered at 2x" without 1 GB of targets at 1:1 (scene at 2×, pyramid at 1×).
11. **Fitting:** CMA-ES (Nelder–Mead for small sets) at 256 px in headless Chrome (GPU works with no flags on Mac). Blurred Oklab ΔE plus row or radial profile losses, a bridge-rule penalty and priors, then checks at other aspect ratios and seeds.
