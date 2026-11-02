# Prior art for each reference

For each of the 14 Sunset and Contour references: the closest existing shaders, articles and papers, with link, author, license, the key formula, how it compares with the reference, and how to fit it into a recipe. General techniques (tone curve, bloom, halation, the segment glow integral, erf bands, dithering, grain) are in [`../research-techniques.md`](../research-techniques.md), cited below as "techniques §N", and are not repeated. Sky physics per reference is in [`twilight-sky-color.md`](twilight-sky-color.md), lens glow in [`lens-glare-halation.md`](lens-glare-halation.md), Paper's controls in [`products.md`](products.md).

The recipe contract used below: a recipe defines `vec3 radiance(vec2 uv, vec2 p)`. `uv` runs 0 to 1 with `uv.y = 0` at the top row of the exported image; `p = (uv − 0.5) · aspect` is centered, in short-side units, with y growing downward; the result is scene-linear light. After it come optional recipe blur passes, the lens (bloom pyramid, halation), exposure and tone curve, then grain and dither at output size.

## How this was checked

- Shadertoy answers scripted requests with 403. Shadertoy code was read from [`GabeRundlett/shadertoy-api-shaders`](https://github.com/GabeRundlett/shadertoy-api-shaders), a GitHub mirror of Shadertoy API records (name, author and code of shaders published to the API; last updated May 2025), searched with GitHub code search, which covers only part of it. Shaders missing from it are marked "not opened".
- A Shadertoy shader's license is the one in its code header. Without a header, Shadertoy's default applies: CC BY-NC-SA 3.0, which rules out commercial copying.
- GitHub files were read directly. Licenses come from the repository license file or the file header.
- Papers were looked up through Crossref; DOIs are given.
- iquilezles.org returned 404 for every page on 2026-11-02, so iq's article pages were not re-checked. His Shadertoy versions were.
- Statements marked "inference" are mine and need a render to confirm.

License labels:

- **Copy**: MIT, Apache-2.0, BSD, CC0 or Unlicense. Keep the copyright and license notice with the code (for Apache-2.0, also any NOTICE text).
- **Idea only**: no license, CC BY-NC-SA, CC BY-NC or GPL. Read it, then write our own code from the description here.
- **Formula**: a paper, spec or textbook result. Reimplement freely.

Two license notes:

- A correction to the general guide: iq's 2D distance Shadertoys carry MIT headers ("Copyright © Inigo Quilez"), for example `4llXD7`, `wlcXD2` and `fs3yDM` below. Code from those shaders can be copied with the notice. Techniques §7 says to reimplement iq's formulas; that still holds for code taken from his article pages, which state no license.
- The most complete small twilight shader found, Stardroid's v2 `sky.frag`, is GPL-3.0 (`stardroid-v2/LICENSE.md`), although the repository's older v1 app is Apache-2.0 and GitHub shows no license for the repository as a whole.

---

## Sunset

### `sunset-sky-peach`

Must reproduce (from the notes): a neutral grey bridge (`#B1B1B1`) near 39% of the height (H), a flat pale-peach glow at 56% with no core, transitions that tighten from 32% to 4% H toward the bottom, a crimson bottom with a blue floor, and a right side about 1.4× brighter.

**1. Production Sky Rendering**. [Shadertoy slSXRW](https://www.shadertoy.com/view/slSXRW) · Andrew Helmer · MIT: copy. Not opened (not in the mirror). The MIT notice is stated by independent ports: [dnlzro/horizon](https://github.com/dnlzro/horizon) ("Andrew Helmer, MIT License") and [ill-inc/biomes-game `sky_functions.glsl`](https://github.com/ill-inc/biomes-game/blob/main/src/client/game/shaders/postprocessing/sky_functions.glsl) ("Code adapted from … (MIT License)"); Bevy, AnKi and Sebastian Lague's Geographical Adventures credit it too. Check the header in a browser before copying.

- Idea: Hillaire 2020 in one shader: a transmittance table, a multiple-scattering table and a sky-view table. Rayleigh scattering (5.802, 13.558, 33.1) per megameter with an 8 km scale height; Mie scattering 3.996 and absorption 4.4 with a 1.2 km scale height; an ozone layer absorbing (0.650, 1.881, 0.085); Mie phase with g = 0.8.
- Against the reference: the structure comes out of the physics. Ozone keeps the top blue, the blue-to-warm bridge passes through pale grey, and the transitions tighten toward the horizon because the air mass climbs steeply there. A sun azimuth past the right edge gives the brighter right side. Wrong for us: it makes real-sky colors, not these stops, and its brightness range needs per-scene exposure.
- Port: don't run it per pixel. Bake its sky-view table once, on the CPU or in a setup pass, from preset parameters (sun 2° to 6° down, sun azimuth, aerosol amount) into a small RGBA16F texture over (elevation, azimuth). `radiance()` turns `p` into a view direction with a pinhole camera and samples it. Use it as the "what a real sky does" target when fitting the cheap added terms of techniques §3; production stays on palette-driven terms. A table computed from parameters is allowed; it never sees reference pixels.

**2. horizon** (the sky as a CSS gradient). [`dnlzro/horizon` `src/gradient.ts`](https://github.com/dnlzro/horizon/blob/main/src/gradient.ts) · dnlzro · MIT: copy.

- Idea: a JS port of the same single scattering, run for 32 view rays from the horizon up to 37.5° (half of a 75° field of view). Each ray becomes one stop of a CSS `linear-gradient`. Post: exposure 25, a "sunset bias" (red +5%, green −5%, blue +10%, scaled by 1 / (1 + 2 · luminance)), Narkowicz ACES per channel, gamma 2.2.
- Against the reference: shows that this kind of sky collapses into a 1D ramp of about 32 stops, which is sky-peach's structure (its hue lines are level). Wrong: per-channel ACES shifts hue and can't keep pack hexes; the bias is a paint step; there is no side brightening; it looks 90° away from the sun.
- Port: run the same loop in TS but write linear radiance into the 1×1024 monotone-cubic ramp texture (techniques §2) instead of CSS. Drop ACES and the bias (our tone curve handles bright light) and multiply by a lateral gain (`sunset-blue-diagonal`, entry 1). It is fast enough to rerun on every parameter change.

**3. Realy simple atmospheric scatter**. [Shadertoy 4tVSRt](https://www.shadertoy.com/view/4tVSRt) · robobo1221 · no license stated: idea only.

- Idea: an optical depth that grows like 1/height, `depth = 0.25 · mix(sunDist, 1, y) / y`; sky = depth × (0.3, 0.5, 1.0); then `pow(c, 1 − c)` pulls channels above 1 down, which turns long paths orange and red; a sun glow `max(exp(−sunDist^0.25) − 0.4, 0)`; output `c / (c + 0.5)`.
- Against the reference: a dozen lines give blue → pale → orange → red with transitions that tighten toward the horizon, because depth ∝ 1/height. Wrong: the reddening comes from the tone curve, so the hue depends on exposure (P_Malin's [Blackbody Palette, llSyRD](https://www.shadertoy.com/view/llSyRD), no license, explains why that is fragile), and its bridge is yellow-white, not neutral grey.
- Port: keep only the spacing. Let the path length run like `path(e) = p0 / (e + e0)` above the horizon and feed it to the Beer–Lambert powers of one warm color from techniques §3 (`pow(warm, vec3(path))`). The 32, 13, 14, 8, 6 and 4% H widths then come mostly from `e0`, not from extra stops.

### `sunset-violet-wave`

Must reproduce: an off-center warm-white glow above the right hill; a thin saturated pink band hugging the land under the glow, fading to the left; two ridges on the left (a far lavender-grey one and a dark front one); softness that changes along the horizon; curvature that fades with depth; saturated violet land.

**1. Monterey wannabe**. [Shadertoy NdVfzK](https://www.shadertoy.com/view/NdVfzK) · mrange · CC0 (header "CC0 - Monterey wannabe"): copy the CC0 parts. Helper functions inside carry their own notes: `hsv2rgb` WTFPL (Sam Hocevar), `vnoise` MIT (iq), `alphaBlend` and `sRGB` "license unknown". Rewrite those; they are a few lines each.

- Idea: 12 planes stepped in depth, each with a ridge line from 5-octave value noise (taller toward the sides). Coverage `smoothstep(aa, −aa, y − ridge)`. A glow above each ridge from a 2-octave copy of the same ridge: `tanh(exp(−2 · (y − ridgeLow)))`. Hue and brightness set by distance: near planes dark blue, far planes brighter, with the hue moving through magenta. Planes are composited front to back and fade in and out with distance; ACES at the end.
- Against the reference: layered ridges, a glow hugging each ridge top, farther ridges paler and pinker. That is the lit right hill, the pink band and the lavender-grey far ridge. Wrong: HSV hues and alpha blending of display colors (a mud risk), a glow on every ridge, ridges symmetric about the center.
- Port: drop the 3D camera and use 2 or 3 layers in 2D: `ridge_i(x) = base_i + amp_i · fbm(x · f_i + seed)`, with smaller `amp_i` for farther layers (the notes measured curvature fading with depth). Coverage `softStep(y − ridge_i(x), σ_i(x))` with σ changing along x (about 36 px at the right edge, 60 to 90 in the trough, over 100 on the upper-left diagonal). Each layer has its own linear-light color. Occlusion by coverage is right here: the land is a surface in front of the sky, so this mixes two surfaces, not two lights. Add the ridge glow only above the front ridge and only near the sun's x.

**2. Hazy Morning Golf**. [Shadertoy XfSczV](https://www.shadertoy.com/view/XfSczV) · draradech · no license: idea only.

- Idea: about ten 2D ridge lines from a 1D fbm of x, each layer 0.8× the horizontal scale of the one before and a little higher. The first layer covering a pixel sets its brightness from the layer index. 28 lines in total.
- Against the reference: plain 2D layering with a brightness per layer already reads as distance and haze. Wrong: hard edges, one flat color per layer, no glow.
- Port: the same loop with soft coverage, as in entry 1.

**3. Stardroid v2 twilight terms**. [`sky.frag`](https://github.com/sky-map-team/stardroid/blob/master/stardroid-v2/render/gles3/src/main/assets/shaders/sky.frag) · Sky Map team (commit by John David Taylor, October 2026) · GPL-3.0: idea only.

- Idea: twilight added on top of a fading Preetham sky. A warm band `(0.85, 0.36, 0.12) · exp(−|altitude| / 9°) · towardSun²`. Earth's shadow and the Belt of Venus as smoothstep pairs whose top rises at twice the sun's depth (`clamp(−2 · sunAltitude, 0, 22°)`), the belt running from 1° below to 14° above that top. A dim blue wash. A tone map that scales by a luminance ratio, so chroma is kept. Dither.
- Against the reference: the pink here sits under the glow, on the sun side, so it is the low part of the bright segment and the purple light, not the Belt of Venus (which sits opposite the sun; `twilight-sky-color.md` §7 reaches the same reading). The structure still transfers: a narrow warm band riding just above a dark edge. Wrong: fixed colors, and the exponential band has a cusp at the horizon.
- Port: our own term above the front ridge: `pink · g(x) · exp(−0.5 · ((ridge_0(x) − y − off) / w)²)`, with `g(x)` falling to the left of the glow (the notes: the pink stays within 40 to 80 px of the land and fades leftward).

### `sunset-red-yellow-arcs`

Must reproduce: one parabolic dome (every band about 6% H lower at the sides, about 7.5% in the top 250 px), widths 22, 8, 18, 5 and 13% H, a cream band lighter than the yellow and the blue, a crimson band, no grain or bloom.

The notes rule out the obvious prior art: a radial glow around a sun below the frame (three.js Sky's Mie lobe, iq's `pow(dot(rd, sun), 8)`) draws concentric rings whose lower arcs bend twice as much. One check against the camera explanation in `twilight-sky-color.md` §7 (an upward-tilted photo turned 180°), computed here: with a pinhole camera pitched up 60°, a 5° elevation line rises about 0.01 focal lengths at x = 0.5 f while a 50° line rises about 0.16, so the horizon-side lines are nearly straight. In this reference the horizon side (the maroon top) bends the most. The dome is a design choice, so keep the notes' fixed parabola. The closest primitives are gradients whose circles change center and radius together.

**1. Canvas two-circle radial gradient**. [WHATWG HTML, `createRadialGradient`](https://html.spec.whatwg.org/multipage/canvas.html#dom-context-2d-createradialgradient) · spec: formula. Skia's `SkTwoPointConicalGradient` implements it under BSD-3 (not opened).

- Idea: circles `c(ω) = c0 + ω · (c1 − c0)`, `r(ω) = r0 + ω · (r1 − r0)`. A pixel takes the largest ω whose circle passes through it, which is a quadratic in ω.
- Against the reference: iso-lines are circles whose centers drop and radii grow along the ramp, which is what the notes measured (centers move down about as fast as the arcs; radius 0.72 H at the top to 1.0 H at the bottom). Wrong: still circles, and on 16:9 the arcs turn into half circles unless r is tied to the width. The notes' parabola fits within 4 px with one number.
- Port: only if the plain dome `t = (y − d · u²) / H` can't reach the extra drop in the top 250 px. Solve the quadratic per pixel in `radiance()` and use ω as the ramp coordinate. Set both circles from the drop at the frame edges, in short-side units, so other aspect ratios keep the same sag.

**2. Paper Static Radial Gradient**. [`static-radial-gradient.ts`](https://github.com/paper-design/shaders/blob/main/packages/shaders/src/shaders/static-radial-gradient.ts) · Paper Design · Apache-2.0: copy.

- Idea: a radial gradient with a focal point (entry 1's family with r0 = 0). A ray–circle intersection normalizes the distance, a falloff exponent shapes it, and an angular sector mask handles a focal point outside the circle. Colors chain through smoothsteps in display space.
- Against the reference: tested GPU code for the geometry. Wrong: sRGB mixing and smoothstep plateaus, which make bands where the reference has smooth knees.
- Port: take only the normalized-distance code as the ramp coordinate. Colors stay in the monotone-cubic linear ramp.

**3. Production Sky Rendering with the sun 3° to 5° down**. As in `sunset-sky-peach`, entry 1 · MIT: copy.

- Against the reference: a physics check, not a recipe. Sunlight after longer and longer paths runs maroon, crimson, scarlet, orange, golden, cream, then blue sky; the cream bridge is aerosol glow above the bright segment. The poster is that order upside down, with uneven widths.
- Port: render it once with matching settings and compare the order and relative widths with the notes' stop table. No runtime use.

### `sunset-blue-diagonal`

Must reproduce: level warm bands multiplied by a horizontal falloff (the left edge 3.3× brighter), a warm zone 2.4× taller on the left, blue contours sloping 29° to 35°, a pale near-grey bridge, a cream-yellow lobe where the camera clipped red.

**1. three.js Sky**. [`examples/jsm/objects/Sky.js`](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/objects/Sky.js), installed at `node_modules/three/examples/jsm/objects/Sky.js` · three.js authors, after Preetham et al. via Simon Wallner's implementation (per its references) · MIT: copy.

- Idea: extinction `Fex = exp(−(βR · sR + βM · sM))` with optical lengths from the air-mass fit `1 / (cos z + 0.15 · (93.885 − z°)^−1.253)`. In-scatter `Lin = (sunE · (βR · phaseR + βM · phaseHG) / (βR + βM) · (1 − Fex))^1.5`, multiplied by a factor that moves toward `(… · Fex)^0.5` as the sun gets low. Henyey–Greenstein phase with g = 0.8. Sun intensity cut off at a zenith angle of about 92.3° (the "earth shadow hack", `cutoffAngle = π / 1.95`).
- Against the reference: the Henyey–Greenstein lobe is the sun-side brightening. With the sun 1° to 2° down and past the left edge, the sky is brighter toward the sun at every height and the warm light reaches higher on that side, which tilts the contours while the bands stay level. Wrong: real-sky colors, constants tuned for a 3D skybox and three's own tone mapping, and the Preetham family is weak with the sun below the horizon.
- Port: copy `hgPhase` and the air-mass fit. In `radiance()`, build a view direction from `p` with a narrow pinhole camera, yawed so the sun's azimuth sits past the left edge; compute the elevation and `cosθ` to the sun; multiply the warm and haze terms by `hgPhase(cosθ, g)` and the sky term by a weaker copy. The measured falloff (linear in stops across x, about 1.75 stops edge to edge) sets g and the yaw. The same term gives `sunset-sky-peach` its brighter right side.

**2. Production Sky Rendering with the sun about 90° to the left and 1° down**. `sunset-sky-peach`, entry 1 · MIT: copy.

- Against the reference: its sky-view table holds both the level bands and the sun-side lobe. Use it to check how much higher the warm zone should reach on the sun side (2.4× here). Same caveats as before.

**3. Realy simple atmospheric scatter**. `sunset-sky-peach`, entry 3 · idea only.

- Against the reference: `mix(sunDist, 1, y)` shortens the effective path near the sun, so that side is paler and brighter: a 2D version of the side brightening. Wrong: brightness is set by the distance to a point, so pushed hard it draws circles around the sun instead of level bands.

The clipped-red lobe needs no prior art: it is the tone curve's path to white (techniques §1). Don't clamp.

### `sunset-film-poster-bands`

Must reproduce: five bands; edges with the short tails of a defocus disc (the 10–90% width is 1.73 to 1.77× the 25–75% width; a disc gives 1.70, a Gaussian 1.90); a different wave and softness on each edge; round patches 200 to 300 px across; a dusty tan bridge at grey → red; fine mono print grain at 1.2% of 255.

No Rothko or color-field shader was found. The Book of Shaders [noise chapter](https://thebookofshaders.com/11/) only sets it as an exercise.

**1. The edge of a disc blur**. Geometry (the area of a circular segment): formula.

- Idea: blurring a straight edge with a uniform disc of radius R gives `ESF(x) = 0.5 + (u · sqrt(1 − u²) + asin(u)) / π`, with `u = clamp(x / R, −1, 1)`. Its 10–90% width is 1.374 R and its 25–75% width 0.806 R: a ratio of 1.70.
- Against the reference: matches the measured tail shape (1.73 to 1.77) better than the erf of techniques §2 (1.90), and it reaches exactly 0 and 1 at ±R, so any band wider than 2R keeps its exact color at its center (a Gaussian with the same 10–90% width needs about 3.2R). Wrong: real defocus discs have soft rims, and the slightly higher measured ratio points to about 80% disc plus 20% Gaussian of the same width.
- Port: in `sunset.bands`, replace each band weight `erf(e1 − t) − erf(e0 − t)` with `ESF(e1 − t) − ESF(e0 − t)`. The weights still sum to 1 and never go negative. Give each edge its own R, and let R change along x.

**2. Bokeh disc**. [Shadertoy 4d2Xzw](https://www.shadertoy.com/view/4d2Xzw) · David Hoskins · CC BY-NC-SA 3.0 (stated in the code): idea only.

- Idea: sample a disc along a golden-angle spiral (rotate 2.39996 rad per tap, radius stepping by `r += 1/r`, which grows like the square root of the tap index), 150 taps, weighted by `pow(col, 4)` to boost highlights.
- Against the reference: a real 2D disc blur, which the 1D formula can't give for the round patches and the wavy edges. Wrong: the `pow(col, 4)` weighting is not light, and 150 taps per pixel at 4K is heavy.
- Port: if needed, a recipe blur pass at quarter resolution over sharp bands plus noise patches, with plain weights. The spiral is Vogel's sunflower layout, free to reimplement.

**3. Paper Warp**. [`warp.ts`](https://github.com/paper-design/shaders/blob/main/packages/shaders/src/shaders/warp.ts) · Paper Design · Apache-2.0: copy.

- Idea: displace `uv` by `4 · distortion · n2 · (cos 2πn1, sin 2πn1)` from two value noises, add swirl passes `uv.x += s/i · cos(t + 1.5i · uv.y)`, then map a stripe or edge shape through chained smoothsteps.
- Against the reference: noise plus swirl gives single uneven waves like the black/blue edge (one wave, 110 px peak to peak). Wrong: one warp field moves every edge alike, where each edge here has its own wave; sRGB mixing.
- Port: apply the idea per edge, in 1D: `e_i(x) = mean_i + A_i · fbm(x · f_i + seed_i)`, with the amplitudes and wavelengths the notes measured for each edge.

### Riso prints: `sunset-green-riso`, `sunset-blue-riso`, `sunset-pink-riso`

Shared: these are scans of riso prints, so ink filters reflected light. Paper is the white point, inks thin out smoothly, places where two inks are both partial come out lighter and duller than any blend of the two, and the grain is mono, 4 to 5 px at 925 px wide, stronger where ink is denser (`sunset-blue-riso`: about 0.9% of 255 on paper, 2.3% on slate). Per print: green has two inks crossing over and a yellow tint in the light ramp; blue has a two-step top edge on the slate band (it greys, then darkens) and a 4× softer bottom; pink has a ruler-straight hard edge with a 4 px light seam.

No riso shader found models a scanned print with no visible screen. The ones found draw CMYK halftone dots, for example [douglasgoodwin/shader-playground `riso.glsl`](https://github.com/douglasgoodwin/shader-playground/blob/main/src/shaders/palette/riso.glsl) (no license).

**1. Yule–Nielsen halftone model**. J. A. C. Yule and W. J. Nielsen, "The penetration of light into paper and its effect on halftone reproduction", Proc. TAGA 3 (1951), 65–76; the transform is analysed in [Hébert and Hersch 2009](https://doi.org/10.2352/cic.2009.17.1.art00029) · formula.

- Idea: with coverage a of ink A and b of ink B, the four areas are bare paper (1−a)(1−b), A only a(1−b), B only (1−a)b, and both ab (Demichel). Reflectance per channel: `R^(1/n) = Σ area_k · R_k^(1/n)`, where n = 1 is plain area mixing and n near 2 models light spreading sideways inside uncoated paper.
- Against the reference: explains the notes' bridges. Green → mustard is lighter and duller in the middle than any mix of the two inks; the salmon bridge above the pink print's orange is lighter than both sides; the blue print's grey corners appear where both inks are partial; and the pink print's seam is a 1 to 2 px gap where neither ink covers. Wrong: it is a print model that removes light, outside the brief's "light adds" rule, so keep it to these three reference presets.
- Port: in each riso reference preset, two or three coverage ramps `a_i(y) = softStep(...)` with their own edges and σ, the four Demichel areas, and `R = pow(Σ area_k · pow(R_k, 1/n), n)` per linear channel, with n one parameter. The pink seam is the orange coverage ending 1 to 2 px before the magenta starts.

**2. Paper Grain Gradient**. [`grain-gradient.ts`](https://github.com/paper-design/shaders/blob/main/packages/shaders/src/shaders/grain-gradient.ts) · Paper Design · Apache-2.0: copy.

- Idea: grain is added to the gradient coordinate before the color is picked: `shape += intensity · 2/n · (grainDist + 0.5) + noise · 10/n · clamp(rawNoise, 0, 1)`, where the grain terms are pixel-scale simplex noise times a lower octave, minus fbm. Colors then chain through smoothsteps of width `softness`.
- Against the reference: grain appears where ink density changes, so edges look printed. Wrong: flat bands stay perfectly clean, while the scans have grain everywhere; the grain size is fixed in device pixels; sRGB mixing.
- Port: use it only to jitter the ink coverages `a_i` near their edges by a small blue-noise amount at output size. The surface grain belongs in the output filter (entry 4).

**3. Paper Paper Texture**. [`paper-texture.ts`](https://github.com/paper-design/shaders/blob/main/packages/shaders/src/shaders/paper-texture.ts) · Paper Design · Apache-2.0: copy.

- Idea: separate fields for `roughness` (fine grain, optionally in laid-paper rows), `fiber` (curly thread-like noise), folds, wrinkles, crumples and drops, lit from an angle.
- Against the reference: paper tooth and the faint 20 to 60 px mottle exist as separate fields. Wrong: folds and crumples are exactly the print damage we must ignore, and it lights a relief rather than reducing ink.
- Port: take only roughness and fiber, as a small reduction of ink coverage, `a_i *= 1 − tooth · fiber(p)`, at output size.

**4. Risograph grain shader**. [Robpayot/risograph-grain-shader](https://github.com/Robpayot/risograph-grain-shader) (a Codrops tutorial, per the repo) · Robpayot · MIT: copy.

- Idea: simplex noise at screen pixels divided by a scale, multiplied by a clamped power of the lighting, then combined with the color by `max(noise, color)`.
- Against the reference: grain strength is tied to tone. Wrong: `max()` lifts toward white and the grain grows with light, while in the scans it grows with ink density.
- Port: keep the idea, change the law. Mono grain with σ (in % of 255) ≈ 0.9 + 1.5 · D, where D = −log10(Y / Y_paper), blobs about 0.45% of the frame width, applied in the output filter.

---

## Contour

### `contour-rim-edge`

Must reproduce: a hard outer edge with a soft inner glow whose width follows its brightness; brightness falling more than 100× from the corner along both edges; a flat overexposed band at the corner; a navy face; a faint outer halo; a corner tighter in the middle than a circle (up to 3.5 px outside the circle with the same tangent points).

**1. iq's 2D distances with gradients**. [Rounded Box - distance 2D, 4llXD7](https://www.shadertoy.com/view/4llXD7) (2015), [Box - gradient 2D, wlcXD2](https://www.shadertoy.com/view/wlcXD2) (2020), [Squircle - gradient 2D, fs3yDM](https://www.shadertoy.com/view/fs3yDM) (2022) · Inigo Quilez · MIT (headers): copy with the notice.

- Idea: `sdRoundBox(p, b, vec4 r)` takes one radius per corner. `sdgBox` returns the distance and its gradient together, analytically. The squircle version is brute force; iq notes it is not a good way to blend a circle into a square.
- Against the reference: exact distance and outward normal along straight edges, so the one-source term `pow(0.5 + 0.5 · dot(n, L), q)` needs no `dFdx` (techniques §13 warns against derivatives across tiles). Wrong: the reference corner is 63.5°, not a box corner.
- Port: build the slab as the intersection of two half-planes (the top edge at 0.1234 H and the diagonal) joined by a smooth maximum. With half-plane distances a and b, the engine's quadratic `smax(a, b, k)` has its zero line at `s = −k/2 − u²/(2k)`, where u = a − b and s = a + b: a parabola tangent to both edges where |a − b| = k, tighter in the middle than a circle. (For a right angle it passes 0.354 k from the vertex against the circle's 0.414 k.) The engine's `sdRoundedTriangle` gives the circular arc. Blend the two distances to hit the measured 3.5 px bulge. The normal is the two half-plane normals blended with the same weight `h`, also analytic, following `sdgBox`'s pattern.

**2. Shader Art Coding Introduction**. [Shadertoy mtyGWy](https://www.shadertoy.com/view/mtyGWy) · kishimisu · no license stated: idea only (the formula is one line).

- Idea: the common neon glow `pow(0.01 / d, 1.2)`.
- Against the reference: a long tail close to 1/d, like a line seen through a lens. Wrong: soft on both sides, which the notes call the neon-tube look to avoid, and no falloff along the edge.
- Port: use it only inside the silhouette, as the longest of the tail terms. Outside, keep the 2 to 5% halo from the notes.

**3. Paper Pulsing Border**. [`pulsing-border.ts`](https://github.com/paper-design/shaders/blob/main/packages/shaders/src/shaders/pulsing-border.ts) · Paper Design · Apache-2.0: copy.

- Idea: a rounded-rectangle distance for the frame edge with margins; a band from a smoothstep on |d| with a softness control; colored spots placed by angle around the center (`atan`), each a smoothstep sector.
- Against the reference: brightness that changes along an edge. Wrong: the band is soft on both sides, the spots repeat, and the look is the "AI glow" border, close to the science-fiction interface the brief rules out.
- Port: replace the angular spots with one smooth function of arc length from the corner, fitted in linear light to the notes' table (the notes give displayed values and a 23× linear ratio between the corner and y 1000).

### `contour-yellow-halo`

No notes file yet. From the image: a pale yellow arc from the left edge at about 60% of the height up to the top right, centered off-frame at the lower right; saturated blue inside the circle, pale cream and light blue outside; the yellow fades slowly outward and faster inward. The poster text is masked (manifest rect `[290, 1027, 346, 244]`).

**1. The 22° ice halo**. [Wikipedia, "22° halo"](https://en.wikipedia.org/wiki/22%C2%B0_halo), citing Les Cowley's [Atmospheric Optics](https://www.atoptics.org.uk/halo/circ1.htm) (not opened) · physics: formula.

- Idea: ice prisms bend light by at least the minimum deviation, 21.54° for red (n = 1.306) and 22.37° for blue (n = 1.317). No refracted light lands inside the ring, so the sky inside is darker; the inner edge is sharp and reddish, the outer edge bluish and diffuse. Near the minimum, deviation is quadratic in the incidence angle, so brightness rises like a fold caustic, about `1 / sqrt(θ − D_min)` just outside the ring, then falls off slowly (inference from the geometry; the same caustic makes a rainbow).
- Against the reference: the same structure. Darker inside, a firmer inner edge, a long soft outer tail. Wrong: a real halo is thin, faint and whitish; here the arc is wide and yellow and the inside is saturated blue. It is art, not ice.
- Port: in `contour.halo`, a one-sided profile in the signed distance d from the ring (positive outward): `I = d > 0 ? inversesqrt(1 + d / w) · exp(−d / tail) : exp(d / wIn)`, which is 1 on both sides at d = 0 and falls like `sqrt(w / d)` outside, blurred by the core width. A small per-channel shift of the ring radius (red inward) gives a warm inner edge. Fill the inside with its own, deeper color.

**2. Paper Smoke Ring**. [`smoke-ring.ts`](https://github.com/paper-design/shaders/blob/main/packages/shaders/src/shaders/smoke-ring.ts) · Paper Design · Apache-2.0: copy.

- Idea: ring = `(1 − smoothstep(R, R + thickness, r)) · smoothstep(R − innerShape³ · thickness, R, r)`, so the inner and outer widths differ; the radius is warped by polar fbm, `uv *= 0.8 + 1.2 · noise(angle, r)`; colors spread across the ring's thickness.
- Against the reference: separate inner and outer softness and a color change across the band. Wrong: smoky noise and display-space colors.
- Port: `contour.halo` already has separate inner and outer tails. Take only the polar warp, at a small amplitude, so the arc is never a perfect circle (the brief bans complete geometric shapes).

**3. Paper Static Radial Gradient**. `sunset-red-yellow-arcs`, entry 2 · Apache-2.0: copy.

- Against the reference: the blue inside the ring is lighter near the arc and deeper away from it. A focal-point gradient with its focal point toward the arc gives that off-center fill with one function.
- Port: use its normalized distance to drive the inside fill in linear light.

### `contour-iridescent-rings`

No notes file yet. From the image: three overlapping cropped circles on near-black. Each has a firm silhouette with a glow just inside it that fades toward the center. The rim's hue walks around each ring: blue-violet to cyan-teal on the large ring, lavender with pale pink highlights on the top ring, coral on the bottom ring. Overlaps add up to white. The dark shape at the bottom is masked (manifest rect `[265, 1070, 350, 163]`).

**1. Lovely Bubbles**. [Shadertoy Nl2SRc](https://www.shadertoy.com/view/Nl2SRc) · P_Malin (Paul Malin) · no license stated: idea only.

- Idea: thin-film reflectance from SoapFlow's amplitude formula (entry 2), summed over 9 wavelengths from 380 to 780 nm with the Wyman–Sloan–Shirley 2013 color-matching fits, converted XYZ → sRGB, and baked into a lookup texture over (cosθ, thickness 100 to 1500 nm). The code also carries the cheaper RGB form from The Last of Us Part II (entry 3).
- Against the reference: near a bubble's silhouette cosθ goes to 0, so the rim's colors differ from the center's: a ring with an iridescent rim, which is what each reference ring looks like. Wrong: physical spectra bring hues that aren't pack colors, and it is a 3D scene.
- Port: a 2D bubble. For a disc of radius R, `cosθ = sqrt(1 − (r / R)²)`. Schlick's Fresnel `F0 + (1 − F0) · (1 − cosθ)^m` rises toward the rim, which gives the inner glow and the hard silhouette at once; with m = 5 the glow sits in the outer 10% of the radius, and a smaller m widens it. Film thickness varies with the angle around the ring (seeded low-frequency noise), so the hue walks around the ring. Bake the (cosθ, thickness) → RGB table on the CPU with entry 2's formula into a small RGBA16F texture. Rings add, and the tone curve turns the overlaps white. For production, map the film phase through pack colors (techniques §8).

**2. SoapFlow thin-film notebook**. [`amandaghassaei/SoapFlow`, `python/Thin Film Interference.ipynb`](https://github.com/amandaghassaei/SoapFlow/blob/main/python/Thin%20Film%20Interference.ipynb) · Amanda Ghassaei · MIT: copy.

- Idea: unpolarized Fresnel (`getRs`, `getRp`), Snell's law for the inner angle, and `getAmplitude(λ, thickness, angle)`, which adds the front and back reflections with the phase delta `2 · n · d · cosθt · 2π / λ` plus the π shift at the first surface.
- Against the reference: small, readable and permissive: the natural source for our CPU table. Wrong: Python, and color matching has to be added (the Wyman fits).
- Port: one TS function that fills the table above.

**3. Cheap RGB thin film**. [Simple thin film interference, fsGfz3](https://www.shadertoy.com/view/fsGfz3) · Suslik · no license; and the RGB form from Waylon Brinck and Steven Tang, "The Technical Art of The Last of Us Part II", SIGGRAPH 2020 ([talk at 47:53](https://youtu.be/tvBIqPHaExQ?t=2873), as cited in P_Malin's code) · idea only.

- Idea: fsGfz3 sets `ω = thickness / λ` with λ = (612, 535, 465) nm, takes `0.5 + 0.5 · cos(20000 · ω)`, then `mix(0.25, col, exp(−1000 · ω))` fades thick films toward grey. The TLOU2 form takes `abs(cos(π · (thickness / cosθ) / λ))` per channel with λ = (700, 510, 440) nm and a coherence term `1 − clamp(path / 1500 nm)` that fades to white.
- Against the reference: both fix the pitfall in techniques §8 (three-wavelength cosines never wash out to pastel) with one fade. Wrong: arbitrary constants, and three samples still alias at large thickness.
- Port: a GPU fallback if the table isn't ready. Write our own three lines.

### `contour-radial-streaks`

No notes file yet. From the image: soft blue rays converging on a bright point near the horizon, left of center at about 75% of the height; darkness at the top right; below the horizon, a bright pool and long horizontal streaks that crowd toward the horizon; everything heavily blurred.

**1. Paper God Rays**. [`god-rays.ts`](https://github.com/paper-design/shaders/blob/main/packages/shaders/src/shaders/god-rays.ts) · Paper Design · Apache-2.0: copy.

- Idea: `ray = noise(angle · f, r − t)^k · noise(angle · f', 0.5 · r · (1 + spots) − t)^k`, up to five layers, each rotated and with its own frequency. The seam at ±π is hidden by blending with a copy that uses `fract(angle / 2π) · 2π`, weighted by a smoothstep on x. A center glow `pow(1 − smoothstep(...), 5)`.
- Against the reference: resolution-independent rays whose brightness changes along each ray (the second noise), like the reference's uneven rays. Wrong: rays all the way around the center, where the reference has them over the upper-left half only; alpha blending of display colors; a noise texture.
- Port: in `radiance()`, take the angle and radius around the vanishing point; ray field = the product of two `gradientNoise` lookups as above, times an angular window for the lit sector, times a radial falloff that brightens toward the vanishing point; add it to a blue sky term; bloom comes from the lens. Keep the lit sector away from ±π, or keep the seam blend.

**2. Perspective floor mapping**. For example [Synthwave grid, dt2SDt](https://www.shadertoy.com/view/dt2SDt) · sdclibbery (a fork of 7lKyDD) · no license; the math is standard: formula.

- Idea: below the horizon, floor depth `z = k / |y − h|` and floor position `X = x · z`. Anything that depends on X alone converges on the vanishing point; anything that depends on z alone makes horizontal bands that crowd toward the horizon.
- Against the reference: the lower part is exactly that: horizontal streaks crowding toward the horizon and a pool under the vanishing point. Wrong: the grid's hard lines; we want smooth functions only.
- Port: `floorLight = pool(X, z) + streaks(z)`, with the streaks from 1D noise in z, kept long by a very low frequency in X, then bloom.

**3. glfx.js Zoom Blur**. [`src/filters/blur/zoomblur.js`](https://github.com/evanw/glfx.js/blob/master/src/filters/blur/zoomblur.js) · Evan Wallace · MIT: copy.

- Idea: 41 samples from the pixel toward the center (`percent = (t + offset) / 40`), weights `4 · (p − p²)`, a random start offset per pixel to hide the fixed sample count, premultiplied alpha.
- Against the reference: smearing a field of soft blobs toward one point gives converging, blurred streaks. Wrong: 41 samples over long smears show noise at 4K, and the strength is in pixels.
- Port: a recipe blur pass at half resolution after the analytic rays, with strength as a fraction of the distance to the center (the same look at every output size) and the offset from our seeded hash. The final dither hides what noise is left.

Hyperspace streak shaders ([MlKBWw](https://www.shadertoy.com/view/MlKBWw) by WAHa_06x36, [XdBBDz](https://www.shadertoy.com/view/XdBBDz) by Ethan Alexander Shulman, both without licenses) draw one trail per angular slice. They suit Warp Speed, not this soft reference.

### `contour-beam-pool`

Must reproduce: a parallel column (a box blurred by σ 0.05 to 0.09 of the short side, no cone); U-shaped brightness along the beam (bright under the source and again where the pool lights the haze); a straight 2 to 3 px near-white pool line at 0.714 H with two hot spots; a floor fan of two broad rays at ±29° around a dark wedge, plus side rays cut by the frame edges; lit haze; no bloom.

**1. Floor perspective mapping, applied to the fan**. `contour-radial-streaks`, entry 2: formula.

- Idea: lines on the floor that run toward the camera all meet at one vanishing point at eye level. The two main rays leave the pool's ends (x ≈ 380 and 526) at ±29°; extended upward they meet about 73 px / tan 29° ≈ 130 px (0.07 H) above the floor line. That is an eye level a little above the wall–floor junction, as with a camera looking slightly down.
- Against the reference (inference): with `X = (x − x_c) / (y − y_eye)`, every function of X alone is a fan from that point. The pool's two hot spots (0.405 W and 0.568 W) sit where the main rays start, so two peaks of floor light at their X give the two main rays, the dark wedge between them and the widening with distance: the rays read as glossy-floor reflections of the hot spots. Wrong: perspective alone doesn't fade the rays, so a z term is needed; and the side rays (8° to 12° and 24° to 28° below horizontal from the pool's ends) don't pass through the same point, so they need their own terms.
- Port: below the floor line, `floor = Σ_k a_k · exp(−0.5 · ((X − X_k) / w_k)²) · exp(−(z − z0) / L)` with `z = 1 / (y − y_eye)`; the pool line a `softStep` with σ about 1 px; the pool's hot spots at the same X_k. Keep straight soft streaks at fixed screen angles for the side rays. This would replace `contour.beam`'s `streakPattern` (noise in angle around the pool), which can't make a dark wedge.

**2. Analytic single scattering from a light in fog**. Pegoraro and Parker, ["An Analytical Solution to Single Scattering in Homogeneous Participating Media"](https://doi.org/10.1111/j.1467-8659.2009.01372.x), Computer Graphics Forum 28(2), 2009; Pegoraro, Schott and Parker, ["A Closed-Form Solution to Single Scattering for General Phase Functions and Light Distributions"](https://doi.org/10.1111/j.1467-8659.2010.01732.x), Computer Graphics Forum 29(4), 2010 · formula.

- Idea: closed-form in-scattered light along a view ray from a point light in uniform fog, with extinction and anisotropic scattering (2009), extended to any angular light distribution such as a spotlight (2010).
- Against the reference: the right physics for the U-shaped beam if the pool is treated as a second light that lights the haze above it. Wrong: heavier than we need, and the reference (most likely AI-generated) is a parallel column that no real spotlight makes.
- Port: haze lit by the pool = Macklin's point-light form from techniques §6, with the light just above the floor line, added to a column made of a box blurred by a Gaussian (a difference of two `softStep`s across x, σ shrinking toward the floor). The notes' brightness law along the column, `Y(y) ≈ 0.133 · exp(−y / 0.114 H) + 0.53 · exp(−(0.711 H − y) / 0.086 H)`, sets the two gains.

**3. VolumetricIntegration**. [Shadertoy XlBSRz](https://www.shadertoy.com/view/XlBSRz) · Sébastien Hillaire (SebH) · no license stated: idea only. The formula is from his SIGGRAPH 2015 Frostbite talk, slide 28, cited in the code.

- Idea: when marching through fog, integrate each step's scattering against extinction, `S_int = (S − S · exp(−σt · dt)) / σt`, instead of `S · dt`.
- Against the reference: only matters if the haze is marched, for example a few steps through fog noise to give it texture. This reference's haze has no texture, so the analytic forms are enough.
- Port: skip for the 1:1. Keep it for a later dusty-haze variant.

### `contour-light-line`

Must reproduce: a thin hard line (5.3 px) whose color walks blue → mint-white → pale yellow → yellow → amber → peach along its length; a warm glow below 34% of the height that opens downward at about 10°; on the left, yellow-gold → orange → brown; on the right, orange → red → crimson → magenta → violet → indigo; the line drawn over the glow; no bloom.

The segment glow integral (techniques §7) covers the falloff. The reference notes read the glow as scene light; `lens-glare-halation.md` §1 reads it as a spread fed only by light above nominal. The color terms below work under either reading. `perception-additive-light.md` §7.3 covers warm tails that redden as they fade. What is specific here is the two-sided color.

**1. Spectral dispersion by summing samples**. [Dispersion, XlscDH](https://www.shadertoy.com/view/XlscDH) · tdhooper · no license; [Fast Thin-Film Interference, ld3SDl](https://www.shadertoy.com/view/ld3SDl) · cornusammonis · no license (six wavelengths, down-sampled to RGB) · idea only.

- Idea: render N copies, each with its own wavelength and its own refractive index (so its own offset), weight each by a wavelength-to-RGB curve, and sum.
- Against the reference: a sideways offset per sample makes a glow whose hue changes with distance from the line instead of one flat tint. Wrong: a physical spectrum has green and cyan bands. The reference's right side walks red → magenta → violet, which are not spectral colors (they are red plus blue light), and its left side is yellow.
- Port: three art-directed samples per side instead of a spectrum: the notes' narrow green, medium red-orange and wide blue Gaussians, each with its own width and gain per side, all growing with y. Added in linear light, red plus the wide blue makes the magenta and violet on the right by itself.

**2. Planck's law**. [Solar spectrum AM0 approx., 4XjGDK](https://www.shadertoy.com/view/4XjGDK) · FordPerfect · Unlicense (public domain, stated): copy. Related: [Blackbody Palette, llSyRD](https://www.shadertoy.com/view/llSyRD) · P_Malin · no license: idea only.

- Idea: 4XjGDK implements Planck's law with CODATA constants (`c1 = 3.741771852e-16`, `c2 = 1.438776877e-2`). llSyRD argues for authoring colors along the blackbody curve instead of letting a tone curve shift the hue.
- Against the reference: only the order transfers. The line runs blue → white → yellow → peach, the same order as the blackbody curve from hot to about 3000 K, a path that passes through white and never through olive (the notes: "never olive or saturated green"). Wrong: blackbody colors are pale, while the reference's top blue (C 0.096) and yellow (C 0.150) are far more saturated, and its mint-white is greener than the curve. Production must use pack colors anyway.
- Port: probably skip. The pale middle also comes from adding a blue emission that fades out along the line to a yellow one that fades in (two lights added, techniques §2), or from the measured line stops (allowed: colors picked from the reference) in a monotone-cubic linear ramp.

The neon glow (`contour-rim-edge`, entry 2) is the look to avoid here: a symmetric glow around a line reads as a neon tube or a lightsaber.

---

## Searched, nothing useful

- Rothko or color-field shaders: none beyond the Book of Shaders exercise. Paul Batchelor's [tiziku](https://github.com/PaulBatchelor/tiziku) (MIT, "inspired by Rothko paintings") draws vector rectangles with NanoVG.
- Belt of Venus shaders: none in the Shadertoy mirror. Stardroid v2 (GPL) is the only one found.
- Apple's Monterey and Big Sur wallpapers: only fan recreations, like mrange's above. `products.md` covers what Apple has published.
- Ice-halo shaders found on GitHub are recent and unlicensed; the optics source above is better.
- lygia (Prosperity license, not copyable without a sponsor license) has `lighting/iridescence.glsl` (by Paniq, a fit to a published chart), `lighting/blackbody.glsl`, `lighting/atmosphere.glsl` (after GPU Gems 2, Alan Zucconi, Dimas Leenman, and mrange's CC0 stars), `filter/radialBlur.glsl` and `filter/fibonacciBokeh.glsl` (after XorDev's fljyWd). Where the originals they credit are permissive, use those.

---

## Port first

Ranked by how much each should move the 1:1 matches for the work involved.

| # | Snippet or technique | References | License | Copy or reimplement |
| --- | --- | --- | --- | --- |
| 1 | iq's 2D distances with analytic gradients (`sdRoundBox`, `sdgBox`), plus the quadratic smooth-max corner | rim-edge; also rings and halo | MIT | Copy, keep the notice |
| 2 | 2D bubble thin film: SoapFlow's amplitude baked into a (cosθ, thickness) table, mapped by cosθ = sqrt(1 − (r/R)²) with Schlick Fresnel | iridescent-rings | MIT (SoapFlow); P_Malin's layout has no license | Copy SoapFlow; reimplement the rest |
| 3 | Floor perspective mapping, light as a function of X and z | beam-pool fan and wedge; radial-streaks floor | standard math | Reimplement |
| 4 | Helmer's Production Sky Rendering as the physical sky reference and table baker | sky-peach, blue-diagonal, red-yellow-arcs (order check), violet-wave sky | MIT (confirm the header in a browser) | Copy |
| 5 | Edge of a disc blur (the ESF above) as the band weight | film-poster-bands; riso edges | geometry | Reimplement |
| 6 | three.js Sky's Henyey–Greenstein lobe and air-mass fit as a lateral gain | blue-diagonal, sky-peach | MIT | Copy, keep the notice |
| 7 | Paper God Rays: noise in angle and radius around a point | radial-streaks | Apache-2.0 | Copy, keep the notice |
| 8 | mrange's ridge layers with a glow above each ridge | violet-wave | CC0 (two helpers of unknown license) | Copy the CC0 parts |
| 9 | 22° halo profile: dark inside, 1/sqrt rise, long outer tail | yellow-halo | physics | Reimplement |
| 10 | Riso print model: Yule–Nielsen with Demichel areas, plus Paper's roughness and fiber | the three riso prints | formula; Apache-2.0 | Reimplement Yule–Nielsen; copy Paper's noise |

Next after these: glfx.js zoom blur (MIT, copy) to smear the streaks; the canvas two-circle gradient (spec, reimplement) if the arcs' top needs more drop than the parabola gives. Planck's law (FordPerfect, Unlicense) is not worth porting for the light line; two added emissions along the line do the same job.
