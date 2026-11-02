# Perception pitfalls when light adds up and goes to white

What the eye does to light that is added, brightened or pushed to white, measured on our pack colors, with fixes that run in a fragment shader. The tone curve under discussion is `toneCurve` in `src/light/engine/output.ts`; the color math is `src/light/color/`. Related docs: [`../research-techniques.md`](../research-techniques.md) (section 1, tone curve; section 2, mixing; section 3, skies) and [`../BRIEF.md`](../BRIEF.md).

Conventions:

- "Linear" means scene-linear RGB with sRGB primaries. Values can exceed 1.
- "Nominal" means intensity 1. A flat pack color at nominal must encode to its exact hex.
- "Knee" is the intensity where the largest channel reaches 1. The tone curve is the identity below it.
- Oklab L, C and h are lightness, chroma and hue angle in degrees. An Oklab ΔE of about 0.02 is one just-noticeable difference.
- J and J_HK are lightness without and with the Helmholtz–Kohlrausch effect, from the Hellwig 2022 color appearance model (0 to 100). Viewing conditions: adapting luminance 20 cd/m², background 20%, average surround, display white D65.

How this was checked:

- Every web source was opened directly: Wikipedia pages, Ottosson's posts, Brejon's article, Levien's review, the ACES 2.0 docs, the AgX and Tony McMapface READMEs, the Blender 4.0 notes, and the Frostbite GDC 2017 slides (the `.pptx` from EA, including speaker notes and code).
- Paper DOIs were checked against the Crossref API. Where Crossref had an abstract, it is quoted. Papers without an accessible abstract are cited only for what their title or a secondary source says.
- The Hellwig 2022 model with its Helmholtz–Kohlrausch extension, and the Nayatani 1997 estimate, were ported from the colour-science library (`colour/appearance/hellwig2022.py`, `hke.py`). The port matches the library's own test values to 7 digits.
- Numbers come from scratch scripts in `artifacts/research-perception/`, which is gitignored, so the results are copied here: `lib.mjs` (color math, tone curves), `paths.mjs`, `mixes.mjs`, `extra.mjs`, `strips.mjs` (images), `gpu-check.mjs`. sRGB and Oklab use the same exact formulas as `src/light/color/`. `toneCurrent` in `lib.mjs` is a line-by-line port of the engine's curve.
- The GLSL in section 7 was compiled together with the engine's own chunk library in WebGL2 (system Chrome, ANGLE Metal on an Apple M4 Pro). It was then run on the GPU against the JS version: the largest difference was 2.3e-6, 0 of 160 test colors differed in 8 bits, and all 12 pack hexes came out exact at nominal.

---

## 1. What the eye does to added light

### 1.1 Adding white shifts hue (Abney effect)

When white light is added to a colored light, its hue changes, not just its saturation. [Abney (1909)](https://doi.org/10.1098/rspa.1909.0085) made the first measurements: "That a change takes place in the hue of the spectrum colours when white is added to them has been noticed, but I am not aware that any measurement of the extent of the change has been made." Later studies include [Kurtenbach, Sternheim & Spillmann (1984)](https://doi.org/10.1364/JOSAA.1.000365), [Burns, Elsner, Pokorny & Smith (1984)](https://doi.org/10.1016/0042-6989(84)90045-2) and [Mizokami, Werner, Crognale & Webster (2006)](https://doi.org/10.1167/6.9.12). The data do not agree well. [Pridmore (2007)](https://doi.org/10.1002/col.20286): "The effect of purity on hue has been reported severally … over 100 years but without general agreement. For example, the number of hue shift nulls in the data vary from 2 to 6."

For display colors, these are the directions usually reported. The [Wikipedia summary](https://en.wikipedia.org/wiki/Abney_effect): "As white is added to red, it shifts slightly towards magenta; green shifts towards cyan, and blue shifts towards violet. The RGB primaries on a typical display are not monochromatic, making the effect weaker than in the usual experimental setup." [Levien](https://raphlinus.github.io/color/2021/01/18/oklab-critique.html): "Additive mixing of deep blue and white creates a hue shift towards purple."

Color spaces differ most in blue. [Hung & Berns (1995)](https://doi.org/10.1002/col.5080200506) measured constant-hue lines on a CRT and found that "the CIELAB, CIELUV, and Hunt spaces exhibited large errors in the region of the blue CRT primary". [IPT (Ebner & Fairchild 1998)](https://doi.org/10.2352/CIC.1998.6.1.art00003) was fit to constant-hue data, and [Oklab](https://bottosson.github.io/posts/oklab/) was fit to "the uniform perceived hue data used to derive IPT". Ottosson's blue-to-white test: "CIELAB, CIELUV and HSV all show hue shifts towards purple." Levien judges IPT, ICtCp and Oklab "all quite good" on hue linearity, "as they are all optimized for hue linearity with respect to the Ebner-Fairchild data set".

What this means for us: holding Oklab hue constant while a color goes to white is the best cheap model we have of "same perceived hue". Mixing toward white in linear RGB does not hold it. That mix is a straight line toward the white point in chromaticity, which is exactly Abney's case. [Brejon](https://chrisbrejon.com/articles/ocio-display-transforms-and-misconceptions/): "It was Abney's experiments which showed that a straight line to adopted white in chromaticity domain does not produce a hue isoline." Our current curve (`mix(c / m, white, s)`) is such a straight line.

### 1.2 Brightness shifts hue (Bezold–Brücke shift)

[Wikipedia](https://en.wikipedia.org/wiki/Bezold%E2%80%93Br%C3%BCcke_shift), after von Bezold (1873), Brücke (1878), [Purdy (1931)](https://doi.org/10.2307/1415157) and [Pridmore (1999)](https://doi.org/10.1016/S0042-6989(99)00085-1): "As intensity increases, the apparent hue of stimuli of a constant spectral distribution shifts towards blue, if its dominant wavelength is below around 500 nm; or yellow, if its dominant wavelength is above 500 nm. As intensity is decreased, apparent hue shifts towards red or green." A few "invariant hues", near the unique hues, do not shift. The effect also applies to surface colors: "the highlights and shadows of an object can appear to have different hues."

Dominant wavelengths of our pack colors (computed against D65 with the [Wyman, Sloan & Shirley 2013](https://jcgt.org/published/0002/02/01/) fit of the CIE matching functions):

| Color | Dominant wavelength | Brighter looks |
| --- | --- | --- |
| Meta Blue `#0064E0` | 472 nm | bluer (it is already blue) |
| Cyan `#1FCDF0` | 486 nm | bluer |
| Lime `#D6F26C` | 566 nm | yellower |
| Yellow `#FFD61E` | 576 nm | already yellow |
| Tan `#B8996E` | 580 nm | yellower |
| Orange-red `#FF4F00` | 602 nm | yellower |
| Plum `#4A0A3C` | none (purple) | — |

Meta Blue's 472 nm is next to the 474–476 nm that the daytime sky matches ([Smith 2005](https://doi.org/10.1119/1.1858479), via Wikipedia's [diffuse sky radiation](https://en.wikipedia.org/wiki/Diffuse_sky_radiation)). So the brand blue is a sky blue by hue, just more saturated than a real sky.

What this means for us: Oklab has no brightness term, so Oklab hue held fixed means "same hue as a surface color", not "same hue at every brightness". Two production display transforms add a yellow-ward shift to bright warm light on purpose:

- [Tony McMapface](https://github.com/h3r2tic/tony-mc-mapface): "Color hues are preserved during compression, except for a deliberate Bezold–Brücke shift."
- Frostbite ([Fry, GDC 2017](https://www.ea.com/technology/news/high-dynamic-range-color-grading-and-display-in-frostbite), slide 93 code): "Absolute hue preservation looks unnatural, as bright colors *appear* to have been hue shifted. Actually doing some amount of hue shifting looks more pleasing."

Bright warm light sources also shift that way physically: shorter paths through haze leave sunlight yellower, and hotter fire is yellower. Section 7.1 makes this an optional drift for reds through yellow-greens only.

### 1.3 Saturated colors look brighter (Helmholtz–Kohlrausch effect)

[Wikipedia](https://en.wikipedia.org/wiki/Helmholtz%E2%80%93Kohlrausch_effect): "Even when they have the same luminance, colored lights seem brighter to human observers than white light does." Models: [Fairchild & Pirrotta (1991)](https://doi.org/10.1002/col.5080160608) (a lightness metric, L\*\*, for object colors that look lighter than greys of the same luminance factor), [Nayatani (1997)](https://doi.org/10.1002/(SICI)1520-6378(199712)22:6%3C385::AID-COL6%3E3.0.CO;2-R), and [Hellwig, Stolitzka & Fairchild (2022)](https://doi.org/10.1002/col.22793), which adds `J_HK = J + f(h)·C^0.587` to CAM16 and Hellwig 2022, with `f(h) = −0.160 cos h + 0.132 cos 2h − 0.405 sin h + 0.080 sin 2h + 0.792`. On which hues it hits, [High, Green & Nussbaum (2023)](https://doi.org/10.1002/col.22839): "The H‐K effect is found to be quite strong in bluish colors, but negligible in yellowish colors, consistent with several previous studies. However, qualitative analysis reveals a peak H‐K effect in red‐magenta hues."

Our pack colors (Hellwig 2022):

| Color | Luminance Y | J | J_HK | Boost |
| --- | --- | --- | --- | --- |
| Meta Blue | 0.145 | 34.8 | 45.7 | +10.9 |
| Cyan | 0.503 | 67.0 | 76.4 | +9.4 |
| Orange-red | 0.269 | 51.5 | 57.3 | +5.8 |
| Plum | 0.020 | 12.5 | 17.4 | +4.9 |
| Forest | 0.037 | 15.7 | 20.3 | +4.6 |
| Lime | 0.789 | 86.4 | 89.5 | +3.1 |
| Yellow | 0.695 | 81.8 | 84.1 | +2.3 |
| Tan | 0.341 | 55.8 | 57.3 | +1.5 |

Nayatani's estimate ranks them the same way: Meta Blue's equivalent grey is L\* 52.4 against a plain L\* of 44.9.

What this means for us, in three places:

1. Meta Blue reads about a third lighter than its luminance says.
2. When a saturated color passes the knee and starts losing chroma, perceived brightness grows more slowly even if lightness is smooth (section 4.4).
3. A grey bridge between two saturated colors loses the brightness boost both ends had, so it looks duller than its lightness suggests (section 5).

The related [Hunt effect](https://en.wikipedia.org/wiki/Hunt_effect) ([Hunt 1952](https://doi.org/10.1364/JOSA.42.000190)) is that colorfulness rises with luminance. A display cannot show that above its white: past the knee, any added brightness has to come out of chroma.

### 1.4 Bright and saturated is not a surface color; dark warm colors read as brown

[MacAdam (1935)](https://doi.org/10.1364/JOSA.25.000361) computed the highest luminance factor a colored material can have at each chromaticity: the more saturated the color, the lower that ceiling. Bright and saturated do not occur together on surfaces, only in lights. [Speigle & Brainard (1996)](https://doi.org/10.1364/JOSAA.13.000436) measured, for different chromaticities, the luminance at which a test patch starts to look self-luminous. So light that whitens as it brightens matches everyday experience, and a saturated color can only look very bright by looking like a light.

The other direction matters just as much. Dark yellow, orange and yellow-green do not read as dim yellow or orange; they read as olive and brown. [Bartleson (1976)](https://doi.org/10.1111/j.1520-6378.1976.tb00041.x): "Brown is shown to be a three‐dimensional color as distinct from a one‐dimensional hue perception." See also [Fuld, Werner & Wooten (1983)](https://doi.org/10.1016/0042-6989(83)90069-X). In our images this happens in two places: the dim tails of warm glows on black (section 4.5), and mixes between warm and dark pack colors (section 5).

### 1.5 Per-channel curves: "the notorious six"

A curve applied to R, G and B separately saturates the largest channel first, then the next. Bright colors slide toward the nearest primary or secondary before they whiten. [Brejon](https://chrisbrejon.com/articles/ocio-display-transforms-and-misconceptions/): "no matter how many values you use, you will ALWAYS end up on these six values at display : Red, Green, Blue, Cyan, Magenta and Yellow", and "Any curve that asymptotes/converges/saturates at 1, like this 'filmic s-curve', will end up on the 'Notorious 6'." [Eary Chow's AgX README](https://github.com/EaryChow/AgX) gives this as the reason AgX replaced Filmic in Blender: "Filmic collapses all colors into six before attenuating to white." Frostbite's notes (slides 35 and 36): "any non-linear 1D operator applied to color channels will hue shift. Want to make a bright blue sky? It will become cyan. … Want to make a bright orange sunset? It will become yellow."

Measured, with a per-channel shoulder that is the identity up to 0.8:

| Color | 2× | 4× | 8× |
| --- | --- | --- | --- |
| Meta Blue | `#008AFE` (−5°) | `#00BDFF` (−26°) | `#00F7FF` (−60°), cyan |
| Orange-red | `#FF6E00` (+9°) | `#FF9800` (+27°) | `#FFCF00` (+54°), yellow |
| Cyan | `#2EFCFF` (−20°) | `#42FFFF` (−22°) | `#5DFFFF` (−21°) |
| Yellow | `#FFFE2D` (+15°) | `#FFFF40` (+15°) | `#FFFF5B` (+15°), lemon |

Our current curve is not per-channel: it tone-maps the largest channel and keeps the ratios. It has the opposite problem, the straight-line-to-white case from 1.1.

---

## 2. How others build the path to white

- **Ottosson.** [Oklab](https://bottosson.github.io/posts/oklab/) gives hue lines that hold perceived hue. [Gamut clipping](https://bottosson.github.io/posts/gamutclipping/) adds two rules for fitting colors into sRGB: "Keep hue constant, only change lightness and chroma" and "Only project color along straight lines in the perceptual color space". A slice of the sRGB gamut at one hue "is always close to a triangle, with two of its corners in (1,0) and (0,0)", that is black and white, with the third corner at the cusp. The upper edge, from cusp to white, is curved, so "the triangle is only an approximation and we need to refine the solution"; one Halley step is enough. Projection targets are a preference: constant L, toward L = 0.5, toward the cusp's L, or the "adaptive L0" blends.
- **AgX** (Troy Sobotka; Blender's default since 4.0). An inset matrix pulls the primaries toward white. A log2 encode covers 16.5 stops, then a per-channel sigmoid, then an outset matrix. [Sobotka's README](https://github.com/sobotka/AgX-S2O3) names the two parts that matter: "Additive stimuli" ("we can add additive energy to the opponent stimuli") and "Rotation and control over the coordinates". Eary Chow's README gives Blender's inset matrix: rows `0.85663 0.09512 0.04825`, `0.13732 0.76124 0.10144`, `0.1119 0.0768 0.8113`, applied in Rec.2020. [Blender 4.0 notes](https://developer.blender.org/docs/release_notes/4.0/color_management/): "bright colors go towards white, similar to real cameras." The inset is a form of channel crosstalk: each channel picks up a share of the others before the curve, so saturated colors have a path to white. AgX cannot reproduce the saturated pack hexes at any exposure ([`../research-techniques.md`](../research-techniques.md) section 1, ΔE 0.07–0.11), so it cannot be our curve.
- **ACES 2.0** ([rendering overview](https://github.com/aces-aswf/aces-docs/blob/main/docs/system-components/output-transforms/technical-details/rendering-overview.md)). It works in "a 'JMh' color correlate space derived using a simplified version of the [Hellwig 2022](https://doi.org/10.1002/col.22792) Color Appearance Model". "Applying the tone-mapping to only the J component and adjusting M independently allows for the hue of the original ACES value to be maintained." [Chroma compression](https://github.com/aces-aswf/aces-docs/blob/main/docs/system-components/output-transforms/technical-details/chroma-compression/index.md): "lightness (J) and hue (h) remains constant and only the colorfulness (M) is compressed. … Compression increases as J values increase, and reduces as M values increase." [Gamut compression](https://github.com/aces-aswf/aces-docs/blob/main/docs/system-components/output-transforms/technical-details/gamut-compression/index.md): "the correlate of hue should be left unchanged". It compresses within a J–M slice toward a focus J "part way between that of the cusp and that of mid grey".
- **Frostbite** (Fry, GDC 2017, [slides](https://www.ea.com/technology/news/high-dynamic-range-color-grading-and-display-in-frostbite)). It "Work[s] in luma/chroma rather than RGB", applies the shoulder "to luma only", and will "Progressively desaturate chroma depending on shoulder" in ICtCp, where "Chroma follows lines of perceptually constant hue". In the code (slide 93), the desaturation is `pow(smoothstep(1.0, 0.3, I), 1.3)` of ICtCp intensity, then `lerp(perChannelCompressed, compressedHuePreserving, 0.6)`, which puts back 40% of the per-channel hue shift. Fire effects that had relied on clipping ("red clips but green doesn't -> effect increasingly becomes yellow") were re-authored with blackbody color ramps (slide 41).
- **Lottes** (GDC 2016, slides 58–63). Tone-map max(RGB), keep the ratios, and add crosstalk: "Move colors towards white as they overexpose maintaining perception of brightness". "Direct path desaturates fast. Indirect path which moves brighter channels faster maintains more saturation." [`../research-techniques.md`](../research-techniques.md) recommends this path with s = 2. The engine today uses the direct path instead (the "identity ≤ 1, mix to white, rate matched" row of that doc's table).
- **Tony McMapface** ([README](https://github.com/h3r2tic/tony-mc-mapface)). "Brightness-equivalent luminance of the input stimulus is compressed (accounting for the Helmholtz–Kohlrausch effect)", hues are preserved "except for a deliberate Bezold–Brücke shift", and "To avoid posterization, selective desaturation is employed, with care to avoid the Abney effect." It is a LUT and the generator is not published.
- **Others.** [Mantiuk et al. (2009)](https://doi.org/10.1111/j.1467-8659.2009.01358.x) measured how much saturation correction a tone map needs ("the relation between contrast compression and the color saturation correction that matches color appearance is non-linear"). Jed Smith's [OpenDRT](https://github.com/jedypod/open-display-transform) starts from a chromaticity-linear path to white; Brejon's verdict on that approach: "Even if a 'chromaticity linear' approach is desirable, it does not create necessarily pleasing images."

What we take from them:

- Hold hue in a perceptual space while lightness goes up (ACES 2.0, Frostbite, Tony, Ottosson).
- Fit to the gamut at fixed hue by lowering chroma (Ottosson, ACES).
- Add a small, deliberate warm shift for bright warm light (Frostbite, Tony).
- Never use a per-channel curve for color (everyone).

---

## 3. The gamut problem with our pack colors

At one hue, the sRGB gamut is a near-triangle in L and C: black, white and the cusp. Above the knee a color cannot get brighter at the same hue without moving along the upper edge, from the cusp toward white. So it must lose chroma. How fast depends on how close it already sits to white.

| Color | Knee | L / C at the knee | Cusp at that hue | Headroom (1 − L) | C halves at | Near white (C < 0.02) at |
| --- | --- | --- | --- | --- | --- | --- |
| Meta Blue | 1.34× | 0.588 / 0.226 | `#0073FF`, 0.588 / 0.226 | 0.41 | 3.6× (current), 3.1× (proposed) | 11.8× / 7.8× |
| Orange-red | 1.00× | 0.670 / 0.222 | `#FF4F00` itself | 0.33 | 2.0× / 1.8× | 5.9× / 4.2× |
| Cyan | 1.15× | 0.820 / 0.142 | `#00D9FF`, 0.816 / 0.145 | 0.18 | 1.6× / 1.65× | 2.5× / 2.6× |
| Yellow | 1.00× | 0.885 / 0.177 | `#FFD500`, 0.883 / 0.181 | 0.12 | 1.2× / 1.3× | 1.8× / 1.85× |
| Lime | 1.13× | 0.951 / 0.169 | `#DBFF00`, 0.941 / 0.222 | 0.05 | 1.2× / 1.2× | 1.4× / 1.5× |
| Plum | 14.6× | 0.699 / 0.269 | `#FF00D2`, 0.677 / 0.296 | 0.30 | 29× / 25× | 64× / 58× |

What the table shows:

- Meta Blue at its knee is exactly the cusp of its hue (`#0064E0` × 1.34 = `#0073FF`). Orange-red at nominal is its own cusp. Yellow and Cyan are within 0.004 of theirs. None of the saturated pack colors can gain chroma above nominal.
- Yellow and Orange-red sit on the knee at nominal (a channel at 255). Any pixel brighter than nominal Yellow or Orange-red starts to whiten at once.
- Lime and Yellow have almost no headroom. They lose half their chroma by 1.2× and look white by 1.4–1.85×. A "bright Lime light" or "bright Yellow light" is, on screen, a white core with a thin colored ring. Meta Blue has about 8 times Lime's headroom and whitens over roughly three stops.
- A straight Oklab line from a saturated color to white leaves sRGB in the middle, because the upper edge of the gamut bends inward. The largest channel overshoots 1 by up to 8.1% for Orange-red, 7.4% for Plum and 4.8% for Meta Blue (about 1% for the others). A hue-held path needs a chroma fit at constant L (section 7.1); a plain clamp would bend the hue again.

---

## 4. Measured: the current tone curve from nominal to white

### 4.1 Every pack color at 1, 1.5, 2, 4, 8 and 16×

Each cell is the output hex, then Oklab L / C / h, then the hue change from nominal. ⚠ marks a hue change over 5° while the color still has chroma (C > 0.01).

| Color | 1× | 1.5× | 2× | 4× | 8× | 16× |
| --- | --- | --- | --- | --- | --- | --- |
| Meta Blue | `#0064E0` .53/.205/259 | `#2F7AFF` .61/.212/261 (+2) | `#5E8CFF` .66/.177/265 (+6.5) ⚠ | `#A6B9FF` .80/.102/272 (+13) ⚠ | `#DAE1FF` .91/.042/275 (+16.5) ⚠ | `#F7F8FF` .98/.009/277 |
| Cyan | `#1FCDF0` .78/.135/217 | `#A0E7FF` .89/.078/221 (+4) | `#D2F2FF` .94/.038/223 (+6.5) ⚠ | `#FBFEFF` .99/.003 | `#FFFFFF` | `#FFFFFF` |
| Yellow | `#FFD61E` .89/.177/94 | `#FFF3D8` .97/.038/87 (−7.6) ⚠ | `#FFFBF3` .99/.011/85 (−9) ⚠ | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` |
| Orange-red | `#FF4F00` .67/.222/37 | `#FF8572` .75/.152/30 (−7) ⚠ | `#FFA297` .80/.113/27 (−10) ⚠ | `#FFD9D5` .92/.043/24 (−13) ⚠ | `#FFF7F6` .98/.009/23 | `#FFFFFF` |
| Lime | `#D6F26C` .91/.162/120 | `#FDFFF8` 1.0/.009/120 | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` |
| Tan | `#B8996E` .70/.069/75 | `#DCB885` .80/.079/75 | `#FAD198` .88/.087/75 | `#FFFBF7` .99/.007/69 | `#FFFFFF` | `#FFFFFF` |
| Forest | `#0F3D33` .33/.052/175 | `#144B3F` | `#195649` | `#267866` .52/.083 | `#37A48D` .65/.105 | `#4EE0C0` .82/.132/175 |
| Plum | `#4A0A3C` .29/.110/339 | `#5A0E4A` | `#671255` | `#8F1D76` .45/.175 | `#C32BA2` .57/.220 | `#FF51D6` .72/.248/339 |
| Ice | `#F2F4F7` .97/.005/258 | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` |
| Steel | `#6A7788` .56/.031/255 | `#808FA4` | `#92A4BA` | `#C8DFFD` .90/.049/255 | `#FCFDFF` | `#FFFFFF` |
| Slate | `#384753` .39/.028/243 | `#455765` | `#4F6373` | `#6F899F` | `#99BCD9` .78/.056/243 | `#E3F2FF` .95/.024/246 |
| Near-black | `#1C2B33` .28/.025/232 | `#24353F` | `#2A3E49` | `#3D5866` | `#567A8D` | `#77A7C0` .70/.063/232 |

Largest hue change over 1–16× while C > 0.015, and where it first passes 5°:

| Color | Peak change | Past 5° from |
| --- | --- | --- |
| Meta Blue | +17.6° (toward purple) | 1.8× |
| Orange-red | −13.9° (toward pink) | 1.27× |
| Yellow | −8.9° (toward orange) | 1.22× |
| Cyan | +7.9° (toward blue) | 1.66× |
| Tan | −6.1° | 2.9× |
| Lime, Steel, Slate, Forest, Plum, Near-black, Ice | under 5° | — |

Below its knee, a color only scales, and scaling linear RGB leaves Oklab hue exactly unchanged. That is why the dark colors show no drift up to 16×: Forest's knee is at 21×, Plum's at 15×, Slate's at 12× and Near-black's at 30×.

### 4.2 The other curves at 2, 4 and 8×

| Color | Curve | 2× | 4× | 8× |
| --- | --- | --- | --- | --- |
| Meta Blue | current | `#5E8CFF` +7° | `#A6B9FF` +13° | `#DAE1FF` +16° |
| | crosstalk s = 2 | `#4497FF` −3° | `#B3D3FF` −2° | `#F1F7FF` −2° |
| | proposed (hue held) | `#4F94FF` 0° | `#ABCCFF` 0° | `#EBF3FF` 0° |
| Orange-red | current | `#FFA297` −10° | `#FFD9D5` −13° | `#FFF7F6` −14° |
| | crosstalk s = 2 | `#FFBEA3` +6° | `#FFF5F1` +5° | white |
| | proposed (hue held) | `#FFB29B` 0° | `#FFECE6` 0° | `#FFFEFD` 0° |
| | proposed + warm drift 0.35 | `#FFB48E` +10° | `#FFEDE1` +17° | `#FFFEFD` |
| Yellow | current | `#FFFBF3` −9° | white | white |
| | proposed | `#FFFCF2` 0° | white | white |
| Cyan | current | `#D2F2FF` +6° | `#FBFEFF` | white |
| | proposed | `#CCF4FF` 0° | `#FCFEFF` | white |

### 4.3 What the strips show

`artifacts/research-perception/paths-saturated.png` and `paths-dark.png` show each color as a continuous strip from 0.25× to 16×, with swatches at 1, 1.5, 2, 4, 8 and 16× and plots of Oklab hue and chroma. `glows.png` shows a glow with a sharp core and a long tail, peaking at 8×, on black.

- **Meta Blue, current curve:** between 2× and 8× the strip and the swatches turn periwinkle, then lavender-white (`#A6B9FF`, `#DAE1FF`). On the glow, a lavender band surrounds the white core. With the hue held, the same range is a clean sky blue going to a cool white (`#ABCCFF`, `#EBF3FF`), and the glow core goes blue, light blue, white.
- **Orange-red, current:** between 1.5× and 4× the strip is clearly rose-pink, and the glow has a pink ring around the white core. Held hue gives salmon, still slightly pink. The warm drift and the crosstalk path both give peach and apricot (`#FFB48E`, `#FFBEA3`), which is what the brief asks for.
- **Yellow and Lime:** all hue-keeping curves look alike. The color holds for a fraction of a stop and then turns white, which gives a hard-looking white disc with a thin colored rim on the glow. That is the lack of headroom from section 3, not a curve choice.
- **Cyan:** the current curve leans a little lavender at 1.5–2×. The difference is small.
- **Per-channel shoulder:** Meta Blue and Cyan go to pure cyan, Orange-red to orange and then yellow, Yellow to lemon. They never reach white.
- **Dark colors:** Forest becomes aquamarine (`#4EE0C0`), Plum hot magenta-pink (`#FF51D6`), Steel pale sky blue (`#C8DFFD` at 4×), Slate and Near-black light steel blue. Tan turns peach-cream (`#FAD198`) at 2× before it whitens. Ice is white as soon as it is above nominal.

### 4.4 The knee: lightness, chroma and perceived brightness

Slopes per stop of intensity, just below the knee → just above it:

| Color | Curve | Oklab L | Oklab C | J_HK / 100 |
| --- | --- | --- | --- | --- |
| Meta Blue | current | 0.136 → 0.130 | +0.052 → −0.090 | 0.176 → 0.135 |
| | proposed | 0.136 → 0.136 | +0.052 → −0.086 | 0.176 → 0.144 |
| Cyan | current | 0.190 → 0.212 | +0.033 → −0.217 | 0.290 → 0.228 |
| | proposed | 0.190 → 0.189 | +0.033 → −0.158 | 0.290 → 0.221 |
| Yellow | current | 0.205 → 0.205 | +0.041 → −0.526 | 0.313 → 0.277 |
| | proposed | 0.205 → 0.204 | +0.041 → −0.316 | 0.313 → 0.291 |
| Orange-red | current | 0.155 → 0.135 | +0.051 → −0.139 | 0.206 → 0.177 |
| | proposed | 0.155 → 0.155 | +0.051 → −0.142 | 0.206 → 0.184 |
| Lime | current | 0.220 → 0.281 | +0.039 → −1.308 | 0.353 → 0.324 |
| | proposed | 0.220 → 0.214 | +0.039 → −0.989 | 0.353 → 0.246 |
| Plum | current | 0.162 → 0.130 | +0.062 → −0.157 | 0.225 → 0.141 |
| | proposed | 0.162 → 0.161 | +0.062 → −0.198 | 0.225 → 0.174 |

- The current curve keeps luminance smooth at the knee, but not Oklab lightness. The lightness slope jumps by −20% (Plum), −13% (Orange-red), +12% (Cyan) and +28% (Lime). The proposed curve keeps the lightness slope continuous by construction.
- Chroma always turns a corner at the knee: it rises below and falls above. That corner is the "saturated ring" a glow can show, and it is sharpest for the light colors (Yellow, Lime).
- With Helmholtz–Kohlrausch counted, the brightness slope drops 7–30% at the knee with the proposed curve (8–37% with the current one), because the chroma that made the color look bright starts to go. A hue-dependent faster rate removes that drop (section 7.1, `uHK`) at the cost of a 10–28% upward bend in Oklab lightness. Which bend shows more is a question for the eye.

### 4.5 Warm glows have olive and brown tails

In `glows.png` (and the crop `zoom-glows.png`), the long tails of the Yellow and Lime glows on black read as mustard and olive, and the Orange-red tail as dark brick red. This is not the tone curve: below nominal every curve is the identity. It is section 1.4. Dim yellow light on a display is olive, because the tail keeps the core's chromaticity at a low luminance. The references go the other way: in `contour-light-line`, the halo of the yellow core turns orange and red farther out (`BRIEF.md`, Contour). Section 7.3 adds a tail rule.

---

## 5. Measured: linear-light mixes within each pack

Each pair is mixed in linear light, `mix(a, b, t)` for t from 0 to 1 (201 samples). ★ marks pairs that are adjacent in pack order, the ones bands and ramps put next to each other. "Grey" means both ends have C ≥ 0.06 and the mix drops below C 0.04. The H-K loss is the largest drop, in J units, of the Helmholtz–Kohlrausch boost compared with the boost interpolated between the two ends.

| Pair | Midpoint (t = 0.5) | Lowest chroma along the mix | H-K loss | Flags |
| --- | --- | --- | --- | --- |
| ★ Meta Blue + Cyan | `#14A4E8` L .68 C .147 h 238 | no dip | 0.9 | — |
| Meta Blue + Yellow | `#BCAAA6` L .75 C .022 h 33 | C .019 at t .47, `#B6A6AA`, L .74 | 5.2 | grey |
| Meta Blue + Orange-red | `#BC5AA4` L .61 C .154 h 337 | no dip | 1.9 | magenta, a hue the pack doesn't have |
| ★ Cyan + Yellow | `#BDD2B1` L .84 C .049 h 135 | C .045 at t .43, `#B1D1BC` | 3.7 | mint green |
| Cyan + Orange-red | `#BD9FB0` L .73 C .043 h 342 | C .031 at t .41, `#AEA8BD`, L .74 | 4.8 | grey |
| ★ Yellow + Orange-red | `#FFA513` L .79 C .169 h 70 | no dip | 1.2 | — |
| ★ Meta Blue + Lime | `#9DBDB2` L .77 C .038 h 174 | C .035 at t .46, `#97B8B7`, L .76 | 3.1 | grey |
| Meta Blue + Forest | `#0853A8` L .45 C .151 h 256 | no dip | 0.0 | — |
| Meta Blue + Tan | `#8682B3` L .63 C .073 h 288 | C .025 at t .77, `#A48F93`, L .67 | 1.7 | grey |
| Meta Blue + Plum | `#3448A9` L .44 C .156 h 270 | no dip | 0.0 | — |
| ★ Lime + Forest | `#9DB655` L .74 C .127 h 121 | no dip | 1.9 | olive green |
| Lime + Tan | `#C8CC6D` L .82 C .119 h 111 | no dip | 0.3 | khaki |
| Lime + Plum | `#A4B258` L .73 C .117 h 117 | C .032 at t .93, `#5F4A41`, L .43 | 3.8 | grey, brown |
| ★ Forest + Tan | `#877657` L .57 C .050 h 84 | C .031 at t .13, `#48503E`, L .42 | 3.0 | olive, khaki |
| Forest + Plum | `#362C38` L .31 C .025 h 321 | C .010 at t .35, `#2E3236` | 2.9 | darker than both ends in J_HK |
| ★ Tan + Plum | `#8F7059` L .57 C .052 h 57 | no dip | 1.8 | brown, mauve |
| ★ Meta Blue + Ice | `#B2BEEC` L .81 C .066 h 273 | no dip | 0.4 | — |
| Other Atmospheric pairs | blue-greys and greys | ends already C ≤ .03 | ≤ 1.1 | — |

What the numbers and the strips (`mixes-bold.png`, `mixes-elemental.png`, `mixes-atmospheric.png`) show:

- **No linear-light mix is darker than both ends in Oklab L.** That holds for all 26 pairs. Oklab L is a cube root of light, so it bows upward along any linear mix. With Helmholtz–Kohlrausch counted, one pair fails: the Forest + Plum middle (`#2E3236`, a dark grey) looks darker than both ends. Nayatani's model flags none.
- **Opposed hues pass through grey at middle lightness.** On screen, Meta Blue + Yellow sags into a grey-mauve band; Meta Blue + Lime, which are neighbors in the Elemental pack, into grey-teal; Cyan + Orange-red into grey-lavender. These are the mixes that read as mud, though none is darker than its ends. The bridge is grey, it sits below the lighter end, and it has lost the brightness boost both saturated ends had.
- **Some pairs invent a hue.** Meta Blue + Orange-red runs through violet and saturated magenta-pink, the "Instagram gradient" the brief rules out. Cyan + Yellow, which are neighbors in the Bold pack, goes through sage and mint green.
- **Elemental's dark neighbors are earth tones.** Lime + Forest goes through olive green, Forest + Tan through dark olive and khaki, Tan + Plum through taupe and brown-mauve. That fits "lamplight and earth" but is close to mud.
- **Atmospheric is clean.** Its colors are greys and blue-greys already.
- For comparison, the sRGB-encoded midpoint of Meta Blue + Orange-red is `#7F5A70` (L .51, darker than both ends), and the Oklab midpoint of Meta Blue + Yellow is `#8DA7AA`, a grey-teal. Never mix in either space.

---

## 6. Why distant hues go grey in a crossfade, and how skies avoid it

A linear-light crossfade moves along a straight line in chromaticity between the two colors, at a luminance in between. When the two colors are nearly opposite, that line passes close to the white point, so the middle has little chroma at an ordinary lightness. That is a grey. It also loses the Helmholtz–Kohlrausch boost of both saturated ends, so it looks duller still. A crossfade conserves light (the weights sum to 1), so nothing makes the middle brighter.

A real sky does not crossfade. Smith (2005): "The spectral irradiance of skylight is shown to be a metameric match to unsaturated blue light." In the bridge between the blue sky and a warm horizon glow, three things happen:

- **The lights add.** The bridge receives skylight and sunlight scattered by haze. The radiance is their sum, not their average.
- **Long paths saturate.** In-scattered light per channel grows like `1 − exp(−β·m)` with air mass `m`, so near the horizon all channels saturate and the sky goes pale.
- **The warm light at the bridge is the pale member of its family.** Sunlight after a short path is cream or peach. The deep orange and red only appear where the path is long, at the horizon.

So what meets in the bridge are two pale tints at a higher light level. The result is light and only slightly colored. The brief's measurements say the same: sky-peach goes blue, grey-beige (C about 0.015, L 0.74–0.78), peach; red-yellow-arcs crosses cream at L 0.89; violet-wave crosses near-white at L 0.92. Further reading on clear-sky colors: [Bohren & Fraser (1985)](https://doi.org/10.1119/1.2341808) and [Lee (1994)](https://doi.org/10.1364/AO.33.004629).

`artifacts/research-perception/sky-bridge.png` puts these side by side, from a Meta Blue top to a warm horizon, all through the proposed curve, with the sky-peach reference next to them (as a visual target only):

- **Crossfade Meta Blue → Orange-red:** violet, then magenta, then coral. An Instagram gradient.
- **Crossfade Meta Blue → Yellow:** a grey-mauve middle.
- **Added light, with Orange-red's Beer–Lambert family `W^p` and a pale haze term:** blue, periwinkle, a mauve-beige bridge that is lighter than both sides, then peach-tan and brick red. This has the same structure as the reference.
- **The same without the haze term:** muddy mauve-brown in the middle. The haze is what makes the bridge.
- **The same with the sky term whitening toward the horizon, hue held:** the bridge turns near-white and peach instead of mauve. Meta Blue has no red and little green, so warm light added to a saturated Meta Blue tints violet. The sky blue has to pale first.
- **Added light with Yellow:** blue, near-white, cream, ochre.
- **One more pitfall:** where the model dims the warm light without reddening it further, it reads brown (the brick-brown band, and the ochre-olive at the Yellow horizon). The reference's dark end is a deep red, not brown.

`bridges.png` tests bridge rules on the opposed pairs (section 7.2 has the numbers):

- **Adding pale haze in proportion to the pair's hue distance** turns the grey midpoints into pale cream (Meta Blue + Yellow), pale mint (Meta Blue + Lime) and pale pink-cream (Cyan + Orange-red).
- **A per-pixel "lost chroma" weight misses Meta Blue + Orange-red,** whose mix stays saturated magenta, so it is not used.
- **Scaling the haze by the local luminance puts a bright band on the light side of a light/dark pair.** An earlier render did that to Lime + Plum. Scaling by the geometric mean of the two ends' luminances, as in the final figure, keeps the bridge centered.
- **Overlap-add (both lights at full strength in the middle)** is physical, but blue + orange-red light is hot pink. Adding the two lights alone is not enough.

---

## 7. Proposed fixes

### 7.1 Tone curve: hold the Oklab hue on the way to white

Identity while max(rgb) ≤ 1, as today, so every pack color at nominal keeps its exact hex. Above the knee, with `(L0, C0, h0)` the Oklab coordinates of the unit-peak color `c / m`:

- whitening `w = 1 − exp(−(m − 1)·k)` with `k = L0 / (3(1 − L0))`, which keeps the slope of Oklab L continuous at the knee (below it, L grows as `L0·m^(1/3)`);
- `L = L0 + (1 − L0)·w`, `C = C0·(1 − w)`, `h = h0` (plus the optional warm drift);
- then lower C at that L and h until the color fits in 0..1 (two or three Newton steps on the worst channel).

```glsl
// Needs maxComponent() from COMMON_GLSL and linearToOklab() from COLOR_GLSL.
const mat3 LMS_TO_LINEAR = mat3(
   4.0767416621, -1.2684380046, -0.0041960863,
  -3.3077115913,  2.6097574011, -0.7034186147,
   0.2309699292, -0.3413193965,  1.7076147010);

// Lowers Oklab chroma at fixed L and hue until the color fits in 0..1 (Newton steps on the worst channel).
vec3 fitChromaAtL(float L, vec2 ab) {
  vec3 qa = vec3(
     0.3963377774 * ab.x + 0.2158037573 * ab.y,
    -0.1055613458 * ab.x - 0.0638541728 * ab.y,
    -0.0894841775 * ab.x - 1.2914855480 * ab.y);
  float s = 1.0;
  for (int i = 0; i < 3; i++) {
    vec3 q = vec3(L) + s * qa;
    vec3 rgb = LMS_TO_LINEAR * (q * q * q);
    vec3 slope = LMS_TO_LINEAR * (3.0 * q * q * qa);
    float worst = 1e-7;
    float value = 0.0;
    float d = 1.0;
    for (int c = 0; c < 3; c++) {
      if (rgb[c] - 1.0 > worst) { worst = rgb[c] - 1.0; value = rgb[c] - 1.0; d = slope[c]; }
      if (-rgb[c] > worst) { worst = -rgb[c]; value = rgb[c]; d = slope[c]; }
    }
    if (worst <= 1e-7) return rgb;
    s = clamp(s - value / (abs(d) > 1e-9 ? d : 1e-9), 0.0, 1.0);
  }
  vec3 q = vec3(L) + s * qa;
  return clamp(LMS_TO_LINEAR * (q * q * q), 0.0, 1.0);
}

// Angle in radians that turns reds through yellow-greens toward Oklab hue 95 deg, where pack Yellow sits.
float warmPull(float h) {
  float d = degrees(h);
  float weight = smoothstep(10.0, 30.0, d) * (1.0 - smoothstep(130.0, 165.0, d));
  return weight * (radians(95.0) - h);
}

uniform float uWarmDrift;  // 0 holds Oklab hue exactly; 0.35 takes orange-red through peach
uniform float uHK;         // 0 keeps the slope of Oklab L at the knee; 1 keeps the H-K brightness slope instead

// Scene-linear in, display-linear out. Identity while max(rgb) <= 1, so pack colors at nominal keep their hex.
vec3 toneCurve(vec3 c) {
  c = max(c, vec3(0.0));
  float m = maxComponent(c);
  if (m <= 1.0) return c;
  vec3 lab = linearToOklab(c / m);
  float chroma = length(lab.yz);
  // H-K weight 0.15 - 0.09 sin(h): strong for blues, weak for yellows; times chroma that is 0.15 C - 0.09 b
  float p = lab.x + uHK * (0.15 * chroma - 0.09 * lab.z);
  float k = min(p / (3.0 * max(1.0 - p, 0.05)), 20.0);
  float w = 1.0 - exp(-(m - 1.0) * k);
  vec2 ab = lab.yz * (1.0 - w);
  if (chroma > 1e-6 && uWarmDrift > 0.0) {
    float turn = uWarmDrift * w * warmPull(atan(lab.z, lab.y));
    ab = mat2(cos(turn), sin(turn), -sin(turn), cos(turn)) * ab;
  }
  return fitChromaAtL(mix(lab.x, 1.0, w), ab);
}
```

What it does, measured:

- Pack hexes are exact at nominal (it is the identity there; checked on the GPU for all 12). Every output is inside 0..1.
- With `uWarmDrift = 0`, the Oklab hue change is 0.000° at every intensity. Meta Blue goes `#4F94FF` (2×), `#ABCCFF` (4×), `#EBF3FF` (8×); Orange-red goes `#FFB29B`, `#FFECE6`, `#FFFEFD`.
- The slope of Oklab L is continuous at the knee for every color (table 4.4).
- With `uWarmDrift = 0.35`, Orange-red goes through peach (`#FFB48E` at 2×, +10°; `#FFEDE1` at 4×), and Lime and Tan lean slightly toward yellow. Blues, cyans, purples and pinks are not touched (the window starts at 10° and ends at 165°).
- With `uHK = 1`, the Helmholtz–Kohlrausch brightness slope at the knee is kept within 0.94–1.04 for Meta Blue, Cyan, Yellow, Orange-red and Plum (from 0.76–0.93), and Oklab L bends up by 10–28%. Lime cannot be helped either way: it has no headroom. The hue-dependent weight `0.15 − 0.09·sin h` fits the per-color values that zero the drop (0.21 Meta Blue, 0.26 Cyan, 0.04 Yellow, 0.11 Orange-red, 0.19 Plum). A single weight for all hues overshoots Yellow by 50%.
- Cost: one Oklab conversion, a few trig calls and three Newton steps, once per pixel in the output pass.
- Suggested defaults: `uWarmDrift = 0.35`, `uHK = 0`. Try `uHK = 1` against it on the glow sheet before deciding.
- The CPU twin in `output.ts` and the twelve-hex test need the same change. `toneOk` in `artifacts/research-perception/lib.mjs` is a JS version that matches the GLSL to 2.3e-6.

Compared with the crosstalk path that [`../research-techniques.md`](../research-techniques.md) recommends: crosstalk also fixes the purple and the pink (Meta Blue −3°, Orange-red +6°) and costs less. But its Oklab L slope drops 13–16% at the knee for Meta Blue and Orange-red, its brightness slope drops more than with the hue-held curve (Orange-red J_HK slope ratio 0.63 against 0.89), and it cannot hold a hue exactly when that is wanted.

### 7.2 Bridge rule for distant hues

Where two pack lights blend (a band edge, a ramp segment, two overlapping layers), add pale scattered light in the middle. The amount is set per pair, on the CPU, so the midpoint lands at the lighter end's Oklab lightness. Near hues and grey ends get none. The term is zero at both ends, so flat fields of each color are unchanged.

```glsl
// Pale scattered light where two distant pack hues blend; add it to the linear-light blend of a and b.
// t: blend position 0..1. strength: per pair from the CPU (bridgeStrength), 0 for near hues or a grey end.
// haze: a pale tint of the pack's light color, scaled to luminance 1. Zero at t = 0 and t = 1.
vec3 bridgeLight(vec3 a, vec3 b, float t, float strength, vec3 haze) {
  float level = sqrt(luminance(a) * luminance(b));
  return haze * (strength * 4.0 * t * (1.0 - t) * level);
}
```

```ts
// CPU side, once per pair and preset. linearToOklch is in src/light/color; toneCurve is the CPU twin of the
// curve in 7.1.
const luma = (c: Rgb) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** A pale member of a pack color's light family (Beer-Lambert power p < 1), scaled to luminance 1. */
function paleTint(c: Rgb, p = 0.12): Rgb {
  const m = Math.max(...c)
  const r = c.map((v) => Math.max(v / m, 0.004) ** p) as Rgb
  const y = luma(r)
  return r.map((v) => v / y) as Rgb
}

/** Strength for bridgeLight(): the blend midpoint, after the tone curve, reaches the lighter end's Oklab L. */
function bridgeStrength(a: Rgb, b: Rgb, haze: Rgb): number {
  const [la, ca, ha] = linearToOklch(a)
  const [lb, cb, hb] = linearToOklch(b)
  const half = Math.sin(((hb - ha) * Math.PI) / 360)
  const gate = smoothstep(0.2, 0.6, half * half * smoothstep(0.03, 0.08, Math.min(ca, cb)))
  if (gate === 0) return 0
  const mid = a.map((v, i) => (v + b[i]) / 2)
  const level = Math.sqrt(luma(a) * luma(b))
  const target = Math.max(la, lb)
  let lo = 0
  let hi = 20
  for (let i = 0; i < 40; i++) {
    const k = (lo + hi) / 2
    const lit = toneCurve(mid.map((v, j) => v + k * level * haze[j]))
    if (linearToOklch(lit)[0] < target) lo = k
    else hi = k
  }
  return gate * ((lo + hi) / 2)
}
```

The haze color: the pale tint of the image's one warm color in Bold and Elemental (Yellow and Orange-red give `#FFFACA` and `#FFDFBE` before scaling, Tan gives `#FFFAF0`, Lime gives `#FBFFE8`), and Ice in Atmospheric. Where to add it:

- In `blurredBands`, add `bridgeLight(colors[k - 1], colors[k], s, strength[k], haze)` with `s` that edge's soft-step weight.
- In a ramp, add it per segment.
- For two separate light layers, use the layers' normalized weights as `t`.

Midpoints (t = 0.5) after the proposed curve:

| Pair | Hue distance | Crossfade midpoint | Bridged midpoint | Strength |
| --- | --- | --- | --- | --- |
| Meta Blue + Yellow | 0.98 | `#BCAAA6` L .75 C .022, grey | `#E6D7C4` L .89 C .030, pale cream | 0.86 |
| Meta Blue + Lime | 0.88 | `#9DBDB2` L .77 C .038, grey-teal | `#D1EADA` L .91 C .034, pale mint | 0.91 |
| Meta Blue + Tan | 0.88 | `#8682B3` L .63 | `#9D99C2` L .70, lavender-grey | 0.43 |
| Cyan + Orange-red | 1.00 | `#BD9FB0` L .73, grey-lavender | `#CEAEBA` L .78, pale mauve | 0.23 |
| Cyan + Yellow | 0.77 | `#BDD2B1` L .84, mint | `#CEE1BD` L .89, pale mint | 0.18 |
| Tan + Plum | 0.49 | `#8F7059` L .57, brown | `#AB9381` L .68, light taupe | 1.57 |
| Meta Blue + Orange-red | 0.88 | `#BC5AA4` L .61, magenta | `#CA73AD` L .67, still pink | 0.36 |
| Forest + Tan | 0.25 | `#877657` | almost unchanged (gated) | 0.05 |

The rule fixes the grey bridges and leaves near-hue pairs alone. It does not fix two pairs:

- **Meta Blue + Orange-red.** Their sum is magenta-pink. In real twilight that purple only appears high in the sky; near the horizon the light that meets the blue is the pale, short-path member of the sunlight family. Build blue-to-orange-red transitions as added light instead of a crossfade: the warm color's Beer–Lambert family `m·(W/m)^p` (p about 0.1–0.3 near the bridge, rising above 1 toward the horizon; [`../research-techniques.md`](../research-techniques.md) section 3), a pale haze term at the bridge, and a sky term that pales toward the horizon with its hue held (`sky-bridge.png`). Keep Meta Blue and saturated Orange-red from ever blending directly.
- **Cyan + Yellow mint.** Both are strong in green, so any additive model gives mint ([`../research-techniques.md`](../research-techniques.md) section 2 found the same). To keep the bridge cream, let the warm haze dominate (raise the strength above the solved value) or keep the two layers from overlapping much.

### 7.3 Warm glow tails: redden as they fade

So that dim warm light reads amber or red instead of olive or brown, deepen the glow color with distance using Beer–Lambert powers of its own unit-peak color. At the core (`fade = 0`) it is the pack color itself.

```glsl
// Color of a warm glow as it fades: deeper and redder with distance (Beer-Lambert powers of the
// unit-peak color), so dim Yellow reads amber and dim Orange-red reads red instead of olive or brown.
// fade is 0 where the light is at or above nominal and rises to 1 in the far tail.
vec3 warmTail(vec3 warm, float fade) {
  float m = maxComponent(warm);
  return pow(warm / m, vec3(1.0 + 1.5 * fade)) * m;
}
```

On the glow sheet (bottom row of `glows.png`, using `fade = 1 − smoothstep(0.05, 1, I)`):

- Yellow's tail turns amber instead of mustard, and Orange-red's turns deep red instead of brick brown.
- Lime's tail turns greener rather than warmer, because green is its largest channel. That is still less olive.
- Meta Blue's tail deepens toward navy.

The halation pass in the roadmap does a similar job with a wide red-weighted glow. Use one or the other per recipe, not both at full strength.

### 7.4 Recipe rules (no new code)

- **Light pack colors have little room above nominal.** Ice is white just above nominal, Lime by 1.5×, Yellow by 1.85×, Cyan by 2.6× (C < 0.02). To show saturated Lime or Yellow light, keep it near nominal and make it larger or softer, not brighter. Meta Blue and Orange-red can be overexposed for a white core; Meta Blue keeps its color over the widest range.
- **Dark pack colors are not dim versions of a light.** Forest, Plum, Slate and Near-black are saturated colors at low luminance. Brightened, they become aquamarine, hot magenta and steel blue (table 4.1). Use them as base, shadow and band colors. If one must glow, cap its gain at about 2× and expect the hue to read differently.
- **Never let a warm color go dark without reddening.** Dark yellow and orange read as olive and brown (section 1.4). Toward the dark end, a warm band or glow should move along its Beer–Lambert family (deeper red), as in 7.3 and the sunset family in [`../research-techniques.md`](../research-techniques.md) section 3.
- **Per-channel curves anywhere in the color path are out.** That includes lens tints that clip per channel.

### 7.5 Checks to add

- **For the saturated pack colors at 1.5–8×,** the Oklab hue change stays under 2°. With warm drift on, the reds through yellow-greens stay inside the drift envelope.
- **At the knee,** the Oklab L slope ratio (above / below) is between 0.95 and 1.05.
- **For every within-pack pair,** the blend (with bridge light) is never below the darker end in Oklab L or J_HK. For pairs with hue distance over 0.6, the midpoint is within 0.03 of the lighter end's L.
- **On the visual audit sheet,** look at the glow sheet and the pair strips for every pack, next to the references, at every tone curve change.

---

## 8. The 8 most important findings

1. **Our tone curve turns Meta Blue lavender and Orange-red pink.** It mixes toward white in linear RGB, which is a straight line in chromaticity and is exactly where the Abney effect shows. Meta Blue drifts +6.5° in Oklab hue by 2× and +16.5° by 8× (`#DAE1FF`); Orange-red drifts −10° by 2× and −13° by 4× (`#FFD9D5`); Yellow −9°, Cyan +6.5°. Both are plainly visible on the strips and glows.
2. **Holding the Oklab hue fixes it and costs little.** Lightness rises with a continuous slope, chroma falls, and chroma is fit to the gamut at constant L. The hue change is 0.000°, the hex stays exact at nominal, and every output is in gamut (checked on the GPU). The current curve's lightness slope at the knee jumps by −20% to +28%; this one's does not. Exact hue-hold makes Orange-red salmon. A small warm drift (0.35, reds to yellow-greens only) takes it through peach, which matches the brief and what Frostbite and Tony McMapface found.
3. **Saturated pack colors are already at the edge of the gamut.** Meta Blue at its knee and Orange-red at nominal are the sRGB cusps of their hues, so above nominal chroma can only fall. Lime and Yellow have almost no headroom: they look white by 1.4–1.85×. A straight Oklab path to white also leaves sRGB by up to 8%, so a chroma fit at constant L is required.
4. **Dark pack colors are not dim lights.** Below its knee a color only scales, so Forest, Plum, Slate and Near-black keep their hue up to 12–30× and turn into vivid aquamarine (`#4EE0C0`), hot magenta (`#FF51D6`) and steel blue when brightened. Dim warm light is olive and brown, as in the tails of Yellow and Lime glows on black. Use dark colors as base and band colors, and redden warm tails as they fade.
5. **Linear-light mixing never makes a bridge darker in Oklab L, but opposed hues still go grey.** That holds for all 26 within-pack pairs. Five of them pass through grey: Meta Blue + Yellow (C 0.019 at L 0.74), Cyan + Orange-red, Meta Blue + Lime (neighbors in Elemental) and Meta Blue + Tan at middle lightness, and Lime + Plum as a dark brown. Two invent a hue the pack doesn't have: Meta Blue + Orange-red gives magenta, Cyan + Yellow gives mint.
6. **Saturated colors look brighter, and grey bridges lose that boost.** Meta Blue reads about 11 J units lighter than its luminance (Helmholtz–Kohlrausch); Yellow only 2. Grey bridges lose up to 5 J units of that boost, and Forest + Plum looks darker than both ends. At the knee, perceived brightness slows 7–30% even when lightness is smooth. A hue-dependent faster whitening rate fixes that, at the cost of a lightness bend, so it is an option to judge by eye, not a default.
7. **Skies make light bridges by adding light, not by crossfading.** Skylight, scattered sunlight and haze add up, so pale members of each color family meet at a higher light level. A bridge term does the same: pale haze in proportion to the pair's hue distance, a bell across the blend, the geometric mean of the ends' luminances, and a strength solved per pair so the midpoint reaches the lighter end. It turns Meta Blue + Yellow from grey `#BCAAA6` into pale cream `#E6D7C4`, and Meta Blue + Lime into pale mint `#D1EADA`. It is zero at both ends, so pack fields stay exact.
8. **Meta Blue and saturated Orange-red should never blend directly.** Their sum is magenta-pink, and no bridge term removes it. Build that transition from the warm color's Beer–Lambert family (pale near the bridge, deep red only at the horizon), plus a haze term and a sky that pales toward the horizon with its hue held. Without the haze the middle is mauve-brown. Per-channel curves are out everywhere: they send Meta Blue to `#00F7FF` cyan and Orange-red to `#FFCF00` yellow by 8×.
