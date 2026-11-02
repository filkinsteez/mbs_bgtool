# Lens diffusion, glare, bloom and halation

What diffusion filters, lenses, eyes and film actually do to bright light, measured where possible, and turned into point-spread formulas and settings for the light engine's lens stage ([`src/light/engine/lens.ts`](../../../src/light/engine/lens.ts), settings in `LensSettings` in [`src/light/scene.ts`](../../../src/light/scene.ts)). The basics (energy-conserving bloom mix, why one Gaussian is wrong, how pyramid weights set the tail, a first halation sketch) are in [`research-techniques.md`](../research-techniques.md) sections 4 and 5. This file goes further and does not repeat them.

Conventions:

- **S** is the frame's short side. Lengths are fractions of S unless marked px.
- "Linear" means scene-linear RGB with Rec. 709 primaries. Reference pixels were decoded from sRGB to linear only to measure them. Nothing here feeds reference pixels to the renderer.
- A **point spread** (PSF) is what one point of light becomes. A **line spread** is what a thin line becomes: the point spread summed along the line. A glow measured across a rim or a light line is a line spread.
- "Nominal" means intensity 1: a pack color at nominal encodes to its exact hex.
- **Level i** is the lens pyramid level i. Its blur is about a Gaussian with σ = 0.9 · 2^i / 512 of S (`levelSigma` in `lens.ts`): L0 0.0018, L1 0.0035, L2 0.0070, L3 0.0141, L4 0.0281, L5 0.0563, L6 0.1125, L7 0.2250.

How this was checked: sources were opened directly with curl and the GitHub API (search engines refuse scripted queries). Papers that could not be downloaded are cited by DOI and marked as such. Measurements come from scratch Node scripts using `sharp`, kept with their plots in `artifacts/lens-research/` (gitignored, not committed).

---

## Summary

- **All three references share one glow shape on the dark side of their lines.** A sharp core, then a shoulder that starts at 1.5–2.5% of the line's displayed peak and falls by a factor e every 0.020–0.028 S (mean 0.024), out to about 0.1 S. That is what an exponential point spread of length about 0.020 S produces. No frame-wide veil is visible.
- **Tiffen's own Glimmerglass test** (a bare bulb on black, six grades) shows the same length, 0.022–0.029 S, at every grade. Grade changes the amount of halo (×1.5 to ×1.8 per doubling of grade), not its shape. The halo carries the bulb's real warm color while the clipped bulb reads white.
- **The engine's current bloom weighting can already make this shoulder**: bloomRadius 0.52–0.62 with bloomWidth 0.5–0.8. What is missing is a power-law tail term for mist-type looks.
- **contour-light-line's glow is a different mechanism.** It appears only where the line's core has turned white (above nominal), and it grows about 35× between mid-frame and the lower quarter while the displayed core stays flat. That is halation-like (fed by light above a threshold), not bloom.
- **The halation path has three problems:** it is fed by grey luminance and then tinted (so a blue rim would get an orange fringe), its dark mask cuts the halo 2–7× right next to the source, and its threshold ignores exposure (so the Intensity control never changes which light halates).

---

## 1. What the Contour references show

### Method

The targets are the 925 px wide Figma screenshots in `public/references/awe/contour/`. For each light, the ridge (the brightest line) was found along its normal, and the profile across it was taken as the median of linear RGB over 50–180 ridge points. The far end of each profile gave the background level, which was subtracted.

Limits: an 8-bit file holds nothing below about 0.0003 linear near black. A tail below about 5·10⁻⁴ of a 0.5 peak disappears, so nothing beyond 0.1–0.16 S can be measured. The cores are tone-compressed in the reference, so the energy share of a glow is "display-referred": it is measured against the displayed core, not the true one.

### Outer side: the lens part

Luminance on the dark side of each line, relative to the line's displayed peak:

| distance (S) | rim-edge, diagonal | rim-edge, top edge | rings, small ring | light-line, rows 40–50% |
| --- | --- | --- | --- | --- |
| 0.0065 | 0.022 | 0.019 | 0.015 | 0.024 |
| 0.011 | 0.025 | 0.015 | 0.014 | 0.019 |
| 0.022 | 0.012 | 0.0085 | 0.011 | 0.013 |
| 0.032 | 0.0070 | 0.0053 | 0.0078 | 0.0082 |
| 0.043 | 0.0042 | 0.0030 | 0.0059 | 0.0053 |
| 0.065 | 0.0011 | 0.0012 | 0.0022 | 0.0025 |
| 0.087 | 0.00053 | 0.00064 | 0.00093 | 0.00081 |
| e-folding length, 0.011 to 0.087 | 0.020 | 0.024 | 0.028 | 0.024 |
| glow share of the line's displayed energy | 0.21 | 0.32 | 0.26 | 0.21 |

What this says:

- The core is crisp: it falls to half within 1–4 px (0.001–0.004 S).
- Right after it, a shoulder at about 2% of the peak takes over. It falls in a straight line on a log scale (exponentially) until the 8-bit floor. All four profiles have nearly the same slope.
- An exponential point spread e^(−r/λ) gives a line spread whose e-folding length over this range is longer than λ: λ = 0.016 gives 0.019, λ = 0.018 gives 0.022, λ = 0.020 gives 0.025, λ = 0.024 gives 0.030. The measured 0.020–0.028 therefore means **λ ≈ 0.020 S (0.016–0.023)**.
- In energy terms the shoulder holds 20–30% of the line's displayed light. Spread thin, it is faint.

Fitted onto the pyramid's levels (non-negative weights, error measured on the log of the line spread), the shoulder sits on levels 3–5:

| profile | L3 | L4 | L5 | L6 | best single bump (current engine) |
| --- | --- | --- | --- | --- | --- |
| rim-edge diagonal | 0.40 | 0.41 | 0.15 | — | center 3.73, width 0.85 (bloomRadius 0.53) |
| rim-edge top edge | 0.39 | 0.37 | 0.21 | — | center 3.80, width 0.93 (bloomRadius 0.54) |
| small ring | — | 0.72 | 0.22 | 0.07 | center 4.43, width 0.30 (bloomRadius 0.63) |
| light-line rows 40–50% | 0.16 | 0.58 | 0.20 | — | center 4.11, width 0.57 (bloomRadius 0.59) |

A Gaussian bump over levels, a power law over a level range, and free weights all fit about equally well over the range we can measure (log error 0.12–0.23). The current engine's parameterization is good enough for these references.

### Inner side and the light line: scene light

- **Inner sides are much broader** than outer sides: rim-edge inner half-width 0.007 S, falling to 10% at 0.019 S; the rings' inner glows reach 0.04–0.13 S. A lens spreads light the same way in every direction, so this one-sided spread is scene light (a rim light falling into the shape, a ring's limb glow). It belongs to the recipe, not to the lens.
- **contour-light-line** has no glow at all in its top 30%, even though the line there is clearly visible (displayed luminance 0.12–0.43). The glow starts where the core turns white (rows 29–33%, core #95C4CC to #ADD4CD) and then grows steadily while the displayed core stays flat:

| row (fraction of height) | displayed core | glow at 0.03 S, left / right | glow at 0.06 S, left / right |
| --- | --- | --- | --- |
| 0.05–0.25 | #1D6893 to #89B6CA | < 0.0001 | < 0.0001 |
| 0.33 | #ADD4CD | 0.0013 / 0.0003 | 0.0003 / 0 |
| 0.41 | #E4E5B2 | 0.0042 / 0.0025 | 0.0011 / 0.0010 |
| 0.49 | #F8E071 | 0.016 / 0.012 | 0.0038 / 0.0036 |
| 0.57 | #F8DE53 | 0.052 / 0.036 | 0.014 / 0.010 |
| 0.65 | #F7D955 | 0.13 / 0.087 | 0.034 / 0.023 |
| 0.73 | #F8D751 | 0.26 / 0.16 | 0.079 / 0.046 |
| 0.81 | #FCD351 | 0.35 / 0.20 | 0.135 / 0.074 |
| 0.89 | #FDCE5D | 0.33 / 0.20 | 0.149 / 0.093 |

  Between rows 0.45 and 0.77 the glow at 0.03 S rises about 35×, doubling every 6.3% of the frame height, while the core's displayed luminance stays near 0.7. Below row 0.8 the glow at 0.03 S stops rising but the glow at 0.06 S keeps rising, so the halo widens instead of brightening. This is what a fixed-shape spread does on a line whose scene brightness keeps rising, once the near halo is tone-compressed. A spread fed by all light (no threshold) strong enough for the bottom would also put a visible glow on the dim blue top, which the reference does not have. So this glow is fed only by light above nominal.

- The bottom-third halo, relative to the displayed peak, left / right: 0.74 / 0.61 at 0.005 S, 0.67 / 0.46 at 0.01, 0.58 / 0.36 at 0.02, 0.34 / 0.21 at 0.04, 0.065 / 0.047 at 0.08, 0.0024 / 0.0027 at 0.16. Its far tail e-folds every 0.024 (left) and 0.028 S (right), the same length as the rim and ring shoulders.

### Color

- The glow carries the source's saturated color and the core is whitened. Rim-edge: the core displays #C7DAED, while its glow, scaled to its brightest channel, is #68ACFF. Small ring: the core is lavender-white #A8A8B4, the glow #5A77FF. That is what a scene-linear spread followed by our tone curve does on its own: no bloom tint is needed.
- The rim-edge glow is a little less saturated than pure Meta Blue would give (it has red at 0.35 of its luminance, Meta Blue has none). A multiplicative tint cannot add red to a source that has none, so this has to come from the recipe's rim color or from the navy interior's own spread.
- The light-line halo is orange on the left (#FFAB43) and red-orange on the right (#FF7B56), mean #FF914F. Farther right it turns magenta and then violet (#82293E at 0.064 S, #18101E at 0.125 S). The left/right difference cannot come from a symmetric lens. It is recipe light (dispersion).

### A visual check

A CPU stand-in for the lens stage (`sim-rim.mjs`) drew a synthetic rim along the measured edge geometry (Meta Blue light at 6× nominal, a band about as wide as the reference's, a navy interior), applied pyramid-style bloom with the engine's weights, then the engine's tone curve. With **bloom 0.12, bloomRadius 0.50–0.54, bloomWidth 0.7–0.9**, the outer glow matches the reference within about 20% from 0.011 to 0.043 S. At 0.065 S, radius 0.54 / width 0.9 is 2× high and 0.50 / 0.7 is 1.3× high, so 0.52 / 0.8 sits between them. Viewed side by side, the glow's reach and softness match. Bloom 0.20 is about twice as strong as the reference. The remaining differences are in the rim itself (the reference rim is wider, paler, with a smooth inner gradient), which is recipe work.

---

## 2. Diffusion filters

### How they work, by type

| Type (examples) | What is in the glass | Point spread | What the grade changes |
| --- | --- | --- | --- |
| Mist and fog (Pro-Mist, Fog, Double Fog, Smoque, CineBloom) | A scattering layer laminated between two glass plates. Tiffen calls its lamination "ColorCore": "laminating the filter substrate between 2 pieces of optical glass". Moment: "a specific particle blend that's sandwiched between two layers of HD optical glass". | Unscattered core plus a broad lobe: a shoulder near the light plus a long tail that lifts shadows across the frame | The scattered fraction. The lobe's shape stays the same. |
| "Black" mists (Black Pro-Mist, Black Satin, Black Glimmerglass, Black Soft Glow) | Tiffen does not describe the construction. spektrafilm models Black Pro-Mist as a "black-particle design". | More of the energy stays in the halo, less goes into the frame-wide veil. Tiffen: Black Soft Glow helps "hold deep, dark areas of the frame". | As above |
| Glimmer (Glimmerglass) | Not described. Tiffen lists "glowing highlights" and a "sparkle appearance". | A small halo and almost no veil (measured below) | Amplitude |
| Lenslets and dots (Soft/FX, Softar type) | Soft/FX: "an array of small lenses distributed within the surface of this filter" | Core plus a defocused disc. The disc grows with focal length and aperture. | Number or power of lenslets. Tiffen: "When higher grade numbers are applied, a halation effect around highlights can be created." |
| Nets and stockings | A woven mesh in front of or behind the lens | Diffraction. An opaque net that leaves a fraction α of the area open keeps α² of the light in the sharp core and spreads α(1 − α) into a grid of diffraction orders (angle λ/pitch). The orders blur into a soft halo with a 4- or 6-point cross, red orders farther out than blue. A thread width w sets the halo's reach (angle about λ/w). | Mesh pitch, thread width, open fraction |
| Soft-focus lenses (Imagon, Thambar, Varisoft) | Undercorrected spherical aberration | Core plus a halo disc with intensity ∝ r^(−4/3) and a defined outer edge (section 3) | Aperture: halo radius ∝ 1/N³ |

Sizes for a net, as an example: pitch 0.3 mm, threads 50 µm, 550 nm light, 50 mm lens. The orders are 1.8 mrad apart (0.4% of a 24 mm frame height) and the halo reaches about 11 mrad (2% of the frame height). A white net also reflects stray light into the lens and lifts blacks. A black net does not.

Schneider's Hollywood Black Magic page is no longer online (the URL now leads to an industrial filter page), so its construction is not verified here.

### What the makers say

- Tiffen Pro-Mist: "helps to reduce the value of the highlights while noticeably lowering the overall contrast… Pro-Mist filters provide little loss of detail across the image" ([Pro-Mist](https://tiffen.com/products/pro-mist-screw-in-filter)).
- Tiffen Black Pro-Mist: "a gauzy paint like halation… In the heavier densities the spill is quite aggressive from the practical light, with the warm tone becoming more apparent" ([Black Pro-Mist](https://tiffen.com/products/black-pro-mist-filter)).
- Tiffen Double Fog: "Maintains greater sharpness and is less affected by highlight-flare than the standard Fog filter" ([Double Fog](https://tiffen.com/products/double-fog-filter)).
- Tiffen Ultra Contrast: "distributing ambient illumination to darker areas… flare and halation around highlights is purposely limited", and its grades go "approximately twice as strong with each grade number increase". Tiffen says the same of Soft/FX ([Ultra Contrast](https://tiffen.com/products/ultra-contrast-filter), [Soft/FX](https://tiffen.com/products/soft-fx-screw-in-filter)).
- Moment CineBloom: strengths "5% (1/4), 10% (1/2), and 20% (Full)", and "Uncoated for Maximum Bloom: No coatings means a stronger glow" ([CineBloom](https://www.shopmoment.com/products/moment-cinebloom-diffusion-filters)). Moment does not say what the percentage measures.
- Dehancer separates the two effects: "Soft optics leads to a global decrease in contrast over the entire frame area, and the Bloom effect is expressed locally, at the areas of maximum exposure" ([Dehancer, Bloom](https://www.dehancer.com/learn/articles/bloom-how-it-works)).

### Measured: Tiffen's Glimmerglass test

Tiffen's [Glimmerglass page](https://tiffen.com/products/glimmerglass-filter) shows its own test: a slate reading "Tiffen diffusion filter test", director Carey Duffy, DoP Stephen Murphy, 29 Aug 2013, T2.8, 3200K. Each image puts "No Filter" next to one grade (1/4, 1/2, 1, 2, 3, 4), with a frosted tungsten bulb on a black background. The halo above the bulb was measured in a cone of ±50° from vertical (black background up to about 130 px), in linear light, as filtered minus unfiltered. The picture is 840 px tall, so 1 px is 0.0012 S.

| grade | 1/4 | 1/2 | 1 | 2 | 3 | 4 |
| --- | --- | --- | --- | --- | --- | --- |
| halo excess at 0.048 S | 0.0070 | 0.016 | 0.023 | 0.031 | 0.051 | 0.069 |
| halo excess at 0.071 S | 0.0011 | 0.0034 | 0.0042 | 0.0060 | 0.0083 | 0.012 |
| halo excess at 0.095 S | 0.0008 | 0.0011 | 0.0017 | 0.0022 | 0.0032 | 0.0042 |
| exponential length, 0.048–0.14 S | 0.024 | 0.029 | 0.024 | 0.022 | 0.025 | 0.027 |
| power-law exponent, same range | 3.0 | 3.0 | 3.6 | 4.0 | 3.6 | 3.4 |

Findings:

- **The shape does not change with grade.** The radial halo falls exponentially with a length of 0.022–0.029 S at every grade (or as r^(−3) to r^(−4) over the same range; both fit). This is the same length as the Contour references' shoulder.
- **The amount grows ×1.5 to ×1.8 per doubling of grade** (amplitude ∝ grade^0.6–0.85 in display-linear values). That is less than Tiffen's "twice as strong with each grade number" for other filter types. The camera's tone curve near black is unknown, so read this as approximate.
- **The halo is warm at every grade**: linear R : G : B ≈ 1.9 : 0.8 : 0.4 relative to luminance (#FFAE81 scaled to its brightest channel). The bulb itself clips to white. The halo shows the source's real color.
- **No frame-wide veil**: away from all lights the background moves by at most one code value. That is below 0.5% of the mean scene light up to grade 2 and 0.4–0.8% at grades 3–4.
- The bulb is not a point (about 0.04 S tall), so values inside 0.04 S include its size.

### A fitted model for four families (spektrafilm)

[spektrafilm](https://github.com/andreavolpato/spektrafilm) (GPL-3.0: read only, reimplement) models diffusion filters in `src/spektrafilm/model/diffusion.py`. A fraction p_s of the light is redistributed, and the rest stays sharp. The redistributed part is a core, a halo and a bloom group. Each group is a small geometric series of 2D exponentials e^(−r/λ)/(2πλ²). The bloom group's weights follow λ^(2−α), which gives an r^(−α) tail. The author says the values are "distilled from the private diffusion-filter characterization notes", so treat them as a considered model, not as measurements. Lengths are on the film. Converted here assuming the 24 mm short side of a 35 mm frame:

| family | p_s at grade 1/8, 1/4, 1/2, 1, 2 | core / halo / bloom share | halo length | bloom length, tail α | halo warmth |
| --- | --- | --- | --- | --- | --- |
| Glimmerglass | 0.07, 0.13, 0.23, 0.36, 0.49 | 0.60 / 0.30 / 0.10 | 50 µm (0.0021 S) | 260 µm (0.011 S), 3.2 | 0 |
| Black Pro-Mist | 0.08, 0.15, 0.26, 0.41, 0.56 | 0.40 / 0.47 / 0.13 | 95 µm (0.004 S) | 380 µm (0.016 S), 3.5 | 0.65 |
| Pro-Mist | 0.11, 0.21, 0.37, 0.58, 0.79 | 0.28 / 0.42 / 0.30 | 150 µm (0.006 S) | 650 µm (0.027 S), 2.9 | 0.40 |
| CineBloom | 0.10, 0.20, 0.35, 0.55, 0.75 | 0.22 / 0.30 / 0.48 | 200 µm (0.008 S) | 1000 µm (0.042 S), 2.5 | 0.85 |

The order matches the descriptions above. Glimmerglass keeps the most energy near the core, Black Pro-Mist concentrates a halo with a steep tail, and Pro-Mist and CineBloom put more light into a wide, shallow tail (veil). "Halo warmth" moves red toward the outer halo and blue toward the inner, keeping each channel's total: spektrafilm's comment calls this "the warm-rim / cool-core look that reference images of mist and bloom filters consistently show around practical light sources". spektrafilm's Glimmerglass bloom (0.011 S) is half the length measured in Tiffen's test (0.024 S). Halo size depends on the lens (next section), so this is not a contradiction.

### How grade, lens and aperture change the point spread

- **Grade sets the amount, the filter type sets the shape.** Measured above (×1.5–1.8 per doubling); spektrafilm's table goes from 0.10 to 0.75 scattered between 1/8 and 2 (log-interpolated).
- **Focal length scales the halo.** A filter in front of the lens scatters light by angle θ, and the lens puts that ray f·tanθ away on the sensor. As a fraction of the frame, the halo is tanθ / (2·tan(half vertical field of view)). Halving the field of view doubles the halo relative to the frame, which is why one grade looks stronger on a long lens. Our tool has no lens, so halo size is a free setting (it fits the Softness control).
- **Aperture barely matters for particle filters.** It matters for lenslets (the defocused disc scales with the aperture diameter) and for soft-focus lenses (∝ 1/N³).
- **Format** does not matter for filters at the same field of view. It does matter for film halation, which is fixed in millimetres on the film (section 5).

---

## 3. Veiling glare, flare and bloom; spherical aberration; night glow

These are different things:

- **Bloom** is the local, symmetric spread around every bright point: the point spread of lens, filter, sensor or film, and eye. It is nearly the same everywhere in the frame, so it is a convolution, which is what our pyramid computes.
- **Veiling glare** is stray light from internal reflections and scattering that lands across the whole frame and lowers contrast ([Wikipedia, Veiling glare](https://en.wikipedia.org/wiki/Veiling_glare); measured per ISO 9358, and tested for video cameras by UL 2802). McCann and Vonikakis: "Photographs, made with digital and silver halide cameras, are inaccurate records of scene luminance because of the cameras' optical veiling glare", and "A camera has an optical system that has its own glare spread function" ([McCann & Vonikakis 2017](https://doi.org/10.3389/fpsyg.2017.02079), citing McCann & Rizzi 2007). Talvala et al. measured and removed it with an occluding grid ([Talvala et al. 2007](https://doi.org/10.1145/1276377.1276424); not downloaded here). The HDR Toolbox fits camera glare as C0 + C1/r + C2/r² + C3/r³ (see `research-techniques.md` section 4): a small constant plus power-law terms, the far tail of the point spread. The Contour references show none (below 0.05% of the peak beyond 0.1 S), so leave it out of Contour.
- **Lens flare** is ghost images of the aperture from reflections between pairs of lens surfaces, lined up through the frame center, plus starbursts from the aperture blades ([Wikipedia, Lens flare](https://en.wikipedia.org/wiki/Lens_flare); "if the lens has a 6-bladed aperture, the flare may have a hexagonal pattern"). Ghosts move with the light's position, so they are not a convolution. [Hullin et al. 2011](https://doi.org/10.1145/1964921.1965003) render them by tracing ray bundles through a lens with its coatings (not downloaded here). Contour allows no complete geometric shapes and one source per image, so ghosts and starbursts are out.

### Spherical-aberration glow

A soft-focus lens "deliberately introduces spherical aberration which blurs fine texture in the image while retaining sharp edges"; it is "an image that is in focus but has a halo of out-of-focus images around it" ([Wikipedia, Soft focus](https://en.wikipedia.org/wiki/Soft_focus)). The soft effect is set by the aperture. A sieve aperture like the Imagon's is used "to change the balance of image-forming light between the relatively well-corrected center of the lens and undercorrected periphery of the lens". The Thambar came with a filter "to block light through the center of the lens", so the soft periphery dominates.

The geometry gives a formula. With third-order spherical aberration, a ray through pupil radius ρ (0 to 1) lands a·ρ³ from the sharp image. The light inside radius r is ρ² = (r/a)^(2/3), so the intensity is

```
I(r) = 1 / (3π a^(2/3)) · r^(−4/3)    for r ≤ a, zero beyond (geometric optics)
```

The halo disc has a defined edge at r = a, with a ∝ f/N³: stopping down one stop shrinks it 2.8×. This is a different shape from a diffusion filter (a steep r^(−4/3) cusp with an edge, rather than an exponential shoulder). It would suit a "pearly" highlight look, not the Contour references.

### Glow in night photography

- **Aperture diffraction**: an Airy core and rings. Stopped down, the blades add spikes. Spikes read as a star shape, so they are out for Contour.
- **Residual aberrations wide open**: halos, and coma flares toward the frame edges.
- **The atmosphere**: mist and fog scatter light forward around every lamp. [Narasimhan & Nayar 2003](https://doi.org/10.1109/CVPR.2003.1211417) ([PDF](https://cave.cs.columbia.edu/old/publications/pdfs/Narasimhan_CVPR03.pdf)) model the glow of a point light in a uniform medium with the Henyey–Greenstein phase function and the optical thickness T = σR, with σ ≈ 3.912 / visibility. Their forward-scattering parameter q is about 0.2 for small aerosols, 0.75 for haze and 0.9 for fog (their figure 7), with mist between aerosols and haze and rain near 1 (figure 5). "Fog produces narrower glows than haze." The glow is a Legendre series

  ```
  I(T, μ) = Σ_m (g_m(T) + g_{m+1}(T)) · L_m(μ),   g_m(T) = I0 · exp(−β_m T − α_m ln T),
  α_m = m + 1,   β_m = ((2m + 1) / m) · (1 − q^(m−1)),   g_0 = 0
  ```

  It is narrow for T near 1 (many terms needed). At T ≈ 4, "the glows are wide, and the shapes of glows for different weather conditions look similar". They checked it against 12-bit photographs. For a beam or pool in haze (contour-beam-pool), this is the physical reason the glow widens with denser air. The cheap closed forms for in-scattering are in `research-techniques.md` section 6.

---

## 4. Glare in the eye

- **[Spencer et al. 1995](https://doi.org/10.1145/218380.218466)** (PDF not downloadable here). Their photopic point spread, θ in degrees:

  ```
  P(θ) = 0.384·f0 + 0.478·f1 + 0.138·f2
  f0 = 2.61·10⁶ · exp(−(θ / 0.02)²)       narrow core
  f1 = 20.91 / (θ + 0.02)³
  f2 = 72.37 / (θ + 0.02)²
  ```

  These constants match Blender's implementation exactly ([`fog_glow_kernel.cc`](https://github.com/blender/blender/blob/main/source/blender/compositor/cached_resources/intern/fog_glow_kernel.cc), which cites "Equation (5)" of the paper). Blender maps the image to a visual angle of 10° to 180° (`compute_fog_glow_field_of_view`: lerp(180°, 10°, size^(1/3))) and convolves with an FFT. Past the core (about 0.05°) the tail goes as θ⁻³ up to about 1° and as θ⁻² beyond. In pyramid terms that is a weight ratio per level of 0.5 near the light and 1 far out. The paper also models the ciliary corona (radial streaks) and the lenticular halo (a colored ring near 3°); those are not verified here.
- **CIE glare spread function** (Vos & van den Berg 1999, CIE 135/1), as printed in [McCann & Vonikakis 2017](https://doi.org/10.3389/fpsyg.2017.02079), equation 2. θ in degrees, valid from 0.01° to 100°, A = age, p = iris pigmentation (0 very dark, 0.5 brown, 1.0 blue-green, up to 1.2 blue):

  ```
  L_eq / E_gl = [1 − 0.08 (A/70)⁴] · [ 9.2·10⁶ / (1 + (θ/0.046)²)^1.5 + 1.5·10⁵ / (1 + (θ/0.045)²)^1.5 ]
              + [1 + 1.6 (A/70)⁴] · { [ 400 / (1 + (θ/0.1)²) + 3·10⁻⁸ θ² ]
                                     + p · [ 1300 / (1 + (θ/0.1)²)^1.5 + 0.8 / (1 + (θ/0.1)²)^0.5 ] }
              + 2.5·10⁻³ p        (sr⁻¹)
  ```

  The paper adds that "The GSF convolution conserves the total energy". The classic Stiles–Holladay approximation, L_veil ≈ 10·E/θ² (cd/m² per lux at the eye, θ in degrees), is the same θ⁻² tail.
- **[Ritschel et al. 2009](https://doi.org/10.1111/j.1467-8659.2009.01357.x)**, "Temporal Glare" (PDF not downloadable here). They build the eye's point spread with wave optics: an image of the pupil with lens fibers, particles and eyelashes is Fourier-transformed, the result is scaled per wavelength (diffraction patterns grow with wavelength) and summed into color, and the image is convolved by FFT. That produces the star rays and colored rings, and they animate the pupil. We only need its lesson for color: **diffraction-based spreads are wider in red than in blue, in proportion to wavelength.**
- **Why glare matters on a screen.** A display cannot show light brighter than its white, but a glow around a patch makes it read as a light. [Zavagno & Caputo 2001](https://doi.org/10.1068/p3009) showed that luminance ramps around a patch make it look self-luminous, and [Yoshida et al. 2008](https://doi.org/10.1145/1394281.1394297) measured how glare raises perceived brightness on displays. Spencer et al. built their method for the same reason. This is why a Contour light needs its glow to read as light at all.

---

## 5. Film halation

### What causes it

- Color negative film stacks its layers blue-sensitive on top, then green, then red, with the red layer nearest the base ([Wikipedia, Anti-halation backing](https://en.wikipedia.org/wiki/Halation); [Dehancer, Halation](https://www.dehancer.com/learn/learn_articles/halation-in-dehancer)).
- Light that passes through the emulsion reflects off the back of the base, or off the camera's pressure plate, and comes back to expose the emulsion from behind. Because "the last and the deepest layer captures the red light", the reflected light "backlights mostly the 'red' emulsion layer… This causes red halos to appear around strong light sources" (Dehancer).
- Motion picture negative has a carbon black backing (rem-jet) that absorbs this light and is removed in processing. Kodak's data sheet for VISION3 500T: "KODAK VISION3 500T Color Negative Films 5219 and 7219 have an acetate safety base with rem-jet backing" ([5219 technical data](https://www.kodak.com/content/products-brochures/Film/VISION3_5219_7219_Technical-data.pdf)). Even with it, "most film stock still renders a slight red halo around the brightest elements" (Wikipedia).
- **CineStill 800T** is a tungsten motion-picture emulsion sold without rem-jet. CineStill's product page: "Remjet backing free… Resulting in a slight halation effect". Its blog: "Points of light surrounded by darker tones will produce a signature 'red glow' or 'halo' around strong highlights. The effect is significantly reduced with medium format film due to the larger negative… Longer focal length lenses also reduce this effect… CineStill is particularly sensitive to this effect" ([800T](https://cinestillfilm.com/products/800tungsten-c41-36exp-35mm-high-speed-color-negative-135), [800T in your toolbox](https://cinestillfilm.com/blogs/news/cinestill-800t-in-your-toolbox)).
- Kodak's High-Speed Infrared film had no anti-halation layer, which caused its glowing look (Wikipedia).

### Radius

- Light scattered in the emulsion beyond the critical angle (about 42° for a base of index about 1.48) is totally reflected at the back of the base and returns about 2·t·tan 42° ≈ 1.8·t away. With an acetate base of about 0.13 mm (a typical value; Kodak's sheet does not give it), that is about 0.24 mm: 1% of a 24 mm short side, 1.3% of Super 35's 18.7 mm height, about 3% of 16 mm's 7.5 mm height. The kernel is therefore a soft ring of fixed size in millimetres on the film, with a dimmer inside. The same halo looks bigger on smaller formats, as Dehancer and CineStill both say.
- spektrafilm's defaults: three Gaussians with σ = 65 µm × √k for k = 1, 2, 3, weights halving per bounce, strength (R, G, B) = (0.05, 0.015, 0) (`HalationParams` in `runtime/params_schema.py`). That is about 0.003–0.005 S on 35 mm.
- The deck's halos are bigger: the light-line halo's tail e-folds every 0.024–0.028 S, 3–6× the physical size. Treat the radius as an art setting.
- hotgluebanjo's halation DCTL uses an exponential kernel and warns about Gaussian ones: "Bad falloff. Often from a Gaussian or box blur. Sometimes there is a banding problem where the dissipating area is split into two color swaths" ([halation-dctl](https://github.com/hotgluebanjo/halation-dctl), no license, read only).

### Color, strength and brightness

- **Color moves with brightness.** "Sometimes reflected light is very bright… This allows to reflect back and penetrate not only into the 'red' layer, but also into the 'green' layer too… the Halation effect gets an orange tint." And: "at the overexposed border the halos have an orange tint, and as we move away, they become red" (Dehancer). So: green is weaker and narrower than red, giving orange near the source and red farther out.
- **Strength depends on the light's spectrum.** "Incandescent light bulbs produce quite obvious Halation, but around LED lamps halos may not be visible at all, because the red component in their spectrum is usually insignificant" (Dehancer). A blue light causes almost no halation. That matches contour-rim-edge, whose blue rim has no warm fringe.
- **Halation adds exposure in proportion to the light**, so it is linear in scene light. It becomes visible only where it is large compared with what is already there. For a point of energy E and an exponential kernel K(r) = e^(−r/λ)/(2πλ²) with strength a, the halo is visible out to

  ```
  r_visible ≈ λ · ln( a·E / (2π λ² · τ) )      τ = smallest visible level
  ```

  so the visible radius grows with the logarithm of brightness. A power-law kernel grows it as a power instead. Near the source the halo itself approaches the tone curve's knee and stops brightening, so it widens rather than brightens. contour-light-line shows exactly this (section 1).
- **Dark surround.** "Red-orange halos are usually distinguishable only against the darker backgrounds, meaning on the dark side of the contrast borders" (Dehancer). That follows from addition: a small added light is a large change on black and a tiny one on a bright field. Dehancer's controls expose it anyway: Source Limiter (how bright a source must be), Background Gain (how dark a background must be), Blue Comp ("If halation occurs against a cool-toned background, then such a background dampens and weakens the effect"), plus Global Diffusion for "secondary glare of the red layer… affects mostly low-contrast mid-tones".

---

## 6. Anamorphic streaks

- **What they look like**: "a kind of lens flare that has a long horizontal line, usually with a blue tint, and is most often visible when there is a bright light in the frame, such as from car headlights, in an otherwise dark scene" ([Wikipedia, Anamorphic format](https://en.wikipedia.org/wiki/Anamorphic_format)).
- **Why**: front-anamorphic lenses squeeze the image with cylindrical elements. The usual explanation: a ghost reflection between cylindrical surfaces is nearly in focus in one direction and far out of focus in the other, so a point becomes a thin line. Vantage's Hawk lenses "have their anamorphic element in the middle of the lens (not up front like Panavision), which makes them more flare-resistant… if they do flare, one does not get the typical horizontal flares" (Wikipedia). The blue color is usually put down to the anti-reflection coatings reflecting least in green; this was not verified here.
- **On spherical lenses**, streak filters or fine lines stretched across the lens give the same look: thin straight threads scatter light at right angles to themselves.
- **Shape**: thin across (a few px), long along. Many ghosts with different defocus lengths add up to a streak brightest at the source and falling off roughly exponentially along x. It is visible only for sources far above the scene's white.
- **How to render it**: Kawase's iterated streak filter (GDC 2003, "Frame Buffer Postprocessing Effects in DOUBLE-S.T.E.A.L (Wreckless)"; the slides survive only as archived PowerPoint). Blender's Streaks glare ([`node_composite_glare.cc`](https://github.com/blender/blender/blob/main/source/blender/nodes/composite/nodes/node_composite_glare.cc)) does the same. In iteration n (2 to 5 iterations), each pixel becomes the mean of itself and a weighted sum of three samples at 4ⁿ, 2·4ⁿ and 3·4ⁿ px along the streak, with weights fade^(4ⁿ), fade^(2·4ⁿ) and fade^(3·4ⁿ). The result falls roughly as fade^d with distance d, an exponential of length −1/ln(fade) px (fade 0.95 gives 20 px, 0.99 gives 100 px). Blender also dims two channels of each sample a little differently per iteration ("Color Modulation") for a spectral edge.
- **For us**: this is a Warp Speed tool, not Contour. Contour's "one source, no hard edges" rules out a sharp line through the light.

---

## 7. How compositing tools build glow and halation

| Tool | How the glow is built | Falloff | Threshold and knee | Color per radius |
| --- | --- | --- | --- | --- |
| Nuke Glow ([docs](https://learn.foundry.com/nuke/content/reference_guide/filter_nodes/glow.html)) | One blur (box, triangle, quadratic or Gaussian) of pixels above the tolerance, added back; brightness, saturation, tint. For speed "the image is scaled down, so that the blur filter is no larger than" the quality value. | One kernel | Tolerance: "the low threshold below which no glow is applied" | One tint |
| Nuke Bloom | No Bloom page was found in the Nuke 17.1 reference guide | — | — | — |
| Blender Glare, Bloom ([manual](https://docs.blender.org/manual/en/latest/compositing/types/filter/glare.html), source above) | Downsample chain of log2(short side × size) levels, then tent upsampling that adds every level with equal weight (Jimenez 2014) | Equal weights: about r⁻² | Threshold with a smooth knee, optional clamp ("Maximum") | Tint, saturation |
| Blender Glare, Fog Glow | FFT convolution with Spencer's photopic point spread | Power law | Same | None |
| Blender Glare, Streaks | Kawase-style iterated taps (section 6) | Exponential along the streak | Same | Color modulation per iteration |
| Unreal Engine ([docs](https://dev.epicgames.com/documentation/en-us/unreal-engine/bloom-in-unreal-engine)) | "multiple Gaussian blurs with different radius", Blur1 at 1/2 to Blur5 at 1/32 resolution, each with a size and a tint; or "Bloom Convolution" with a kernel image, "energy conserving" | Sum of Gaussians, weights falling with size (table below) | "there is a linear part (one unit wide) where the color only partly affects the bloom"; threshold −1 means all pixels | Each radius has its own tint |
| DaVinci Resolve, Film Look Creator ([19 New Features Guide](https://documents.blackmagicdesign.com/SupportNotes/DaVinci_Resolve_19_New_Features_Guide.pdf)) | Halation: Amount, Radius, Hue. Bloom: Amount, Radius. "Designed for scene referred workflows." | Not documented | Not documented | Hue (halation) |
| Dehancer Halation (article above) | Source Limiter, Background Gain, Smoothness, Local Diffusion (radius), Global Diffusion (mid-tone red glare), Amplify, Hue (green-layer share), Blue Comp, Impact | Not documented | Source and background limits | Orange near, red far (Hue, Amplify) |
| Dehancer Bloom | Highlights (threshold), Details (size of glowing objects), Diffusion (radius), Amplify, Save Lights. "The effect starts to appear in light areas where the white point of the original image exceeds 50%" | Not documented | Highlights | — |
| FilmConvert Halation ([Halation](https://www.filmconvert.com/halation), [Nitrate](https://www.filmconvert.com/nitrate)) | "meticulously tracing the light coming through in your image to determine where and how halation should behave" (Nitrate page; no technical documentation found) | — | — | "a red glow" |
| Deep Glow 2 (After Effects) | The vendor's product page refuses scripted downloads; the developer's site lists "image based glow" ([Plugin Everything](https://plugineverything.com/)). Falloff not verified. | — | — | — |
| spektrafilm | Diffusion: core, halo and bloom exponential mixtures with a power tail. Halation: three Gaussians at √k widths. Lengths in µm on the film. | Exponential + power law | "Boost" reconstructs light lost to clipping before spreading it | Warm outer halo per filter family |
| halation-dctl | Exponential kernel on scene-linear input ("Not just a Gaussian blur") | Exponential | None | Red and green shares |

Unreal Engine 4's defaults (`FPostProcessSettings` constructor in `Engine/Classes/Engine/Scene.h`, read from the 2016 Unreal Tournament source tree; Unreal Engine 5's defaults may differ). Sizes are diameters "in percent of the screen width", all multiplied by `BloomSizeScale` = 4. Intensity is 0.675. The code sets the threshold to −1, commented "all pixels affect bloom equally (physically correct, faster as a threshold pass is omitted)".

| radius | size (× 4) | tint (linear R, G, B) | tint luminance | tint color |
| --- | --- | --- | --- | --- |
| 1 | 0.3% | 0.3034, 0.37, 0.3668 | 0.356 | slightly cyan |
| 2 | 1% | 0.1170, 0.15, 0.1486 | 0.143 | slightly cyan |
| 3 | 2% | 0.1044, 0.13, 0.1198 | 0.124 | slightly green-cyan |
| 4 | 10% | 0.0510, 0.0732, 0.075 | 0.069 | cyan |
| 5 | 30% | 0.0750, 0.0626, 0.0626 | 0.065 | warm |
| 6 | 64% | 0.0750, 0.0643, 0.0734 | 0.067 | magenta |

Weights drop from the smallest radius to the third, then stay level over the three widest. That is a wide, roughly r⁻² veil. Smaller radii are cooler and wider ones warmer, the same "red spreads wider" pattern that diffraction predicts. The standard bloom adds light ("it is not conservative (it can result in an overall brightening of the image)", in Unreal's own docs).

Thresholds and knees in practice: Unreal fades in over one luminance unit above the threshold, Blender uses a smooth clamp with a smoothness width, and Dehancer exposes the source and background limits separately. Our engine's quadratic knee (knee = threshold / 2) is fine. The problem is what it is applied to (section 10).

---

## 8. Formulas for our renderer

### 8.1 Diffusion and lens point spread

Radial, in linear light, lengths in S:

```
P(r) = (1 − s)·δ(r) + s·[ w_h·E(r; λh) + (1 − w_h)·T(r; λt, α) ]

E(r; λ)    = exp(−r / λ) / (2π λ²)                                  exponential shoulder
T(r; λ, α) = (α − 1)(α − 2) / (2π λ²) · (1 + r / λ)^(−α),   α > 2     power-law tail
```

s is the share of light that is spread (the engine's bloom mix). It is energy-conserving: flat fields do not change.

| look | s | λh | tail share 1 − w_h | λt, α |
| --- | --- | --- | --- | --- |
| Contour references, Glimmerglass-like | 0.1–0.25 | 0.016–0.024 | 0 | — |
| Black Pro-Mist-like | 0.15 (1/4) to 0.4 (1) | 0.004–0.02 | 0.2 | 4·λh, 3.5 |
| Pro-Mist and CineBloom-like (veil) | 0.2 (1/4) to 0.6 (1) | 0.006–0.02 | 0.4–0.6 | 4–5·λh, 2.5–3 |
| Eye (Spencer), "seen by a person" | small, mostly tail | — | ≈ 1 | α 2–3 |

The Black Pro-Mist and Pro-Mist rows follow spektrafilm's family table (section 2): halo length for λh, the bloom group's share of the redistributed light outside the core for the tail share, and the bloom-to-halo length ratio for λt.

### 8.2 Halation

Fed by each channel's own light above a knee, added in linear light before the tone curve, all in exposed light (what the tone curve sees):

```
ce     = c · 2^exposure
y      = luminance(ce)
excess = kneeExcess(y, threshold)                    the current soft knee
e      = ce · excess / y                             keeps the light's own color
H      = ( aR · KR ⊛ eR,   aG · KG ⊛ eG,   aB · KB ⊛ eB )
out    = toneCurve(ce + H)
```

Starting values:

- aG ≈ 0.3·aR, aB ≈ 0: film-like, so a blue light makes almost no halo.
- KR exponential with length λR, and KG one pyramid level narrower (about half the length). This gives orange near and red far.
- λR 0.005–0.012 S for physical 35 mm film, 0.02–0.035 S for the deck's look.
- aR 0.05 for ordinary film (spektrafilm's default), 0.2–1 for a CineStill-like or deck look. It depends on how far above nominal the sources are.

There is no dark-surround mask beyond addition itself. If a fade is wanted over the hot source, make it act only above nominal (section 10).

### 8.3 As pyramid weights and tints

- **Exponential shoulder of length λ.** Fitting the line spread of E(r; λ) with the level Gaussians gives two main levels: λ = 0.012 puts 0.53 on L3 and 0.39 on L4, λ = 0.024 puts 0.53 on L4 and 0.39 on L5, λ = 0.048 puts 0.53 on L5 and 0.39 on L6, with about 0.08 on the two levels below. The current engine's bump reproduces this with

  ```
  center = 4.4 + log2(λ / 0.024)        (bloomRadius = center / 7)
  width  = 0.6 levels                    (bloomWidth)
  ```

  so λ = 0.012, 0.024 and 0.048 give bloomRadius 0.49, 0.63 and 0.77. The Contour references (λ ≈ 0.020, range 0.016–0.023) land at bloomRadius 0.54–0.62. The direct fits above gave 0.53–0.63 with widths 0.3–0.93.
- **Power-law tail.** Weights w_i ∝ σ_i^(2−α), so each level gets 2^(2−α) times the previous one: 0.71 for α = 2.5, 0.5 for α = 3, 0.35 for α = 3.5. For T(r; 0.02, α), fitted over L0–L7: α = 3.5 gives L2 0.12, L3 0.25, L4 0.27, L5 0.19, L6 0.08, L7 0.06. α = 3 gives L2 0.07, L3 0.18, L4 0.23, L5 0.24, L6 0.11, L7 0.16, with 5% falling beyond the frame. α = 2.5 puts a quarter of its energy beyond L7 (a frame-wide veil).
- **Tints per level.** A tint multiplies light that is already there; it cannot create a channel the source lacks (Meta Blue has no red). For physical color per radius, shift each channel's weights by log2(λ_channel / λ_green) levels, as diffraction does: about +0.15 to +0.25 for red and −0.25 to −0.3 for blue. That is what the engine's halation spread already does, and what Unreal's defaults and spektrafilm's warm rim approximate. Keep it off unless a reference shows a warm rim around a neutral light. The Contour references do not.
- **Converting a measured share to an engine mix.** The measured shares are relative to the displayed core. The engine's mix is relative to the scene's core, which is brighter where the tone curve whitens it. So: engine mix ≈ measured share × displayed energy / scene energy. The visual check in section 1 lands at 0.12 for a rim like the reference's.

---

## 9. Settings for the three references

In current `LensSettings` terms:

| setting | contour-rim-edge | contour-iridescent-rings | contour-light-line |
| --- | --- | --- | --- |
| bloom | 0.12 | 0.15 | 0.03 |
| bloomRadius | 0.52 | 0.62 | 0.59 |
| bloomWidth | 0.8 | 0.5 | 0.6 |
| bloomTint | #FFFFFF | #FFFFFF | #FFFFFF |
| halation | 0 | 0 | 1.0 (tune 0.5–2) |
| halationThreshold | — | — | 1.0 |
| halationRadius | — | — | 0.035 |
| halationTint | — | — | #FF914F |
| halationSpread | — | — | 0.4 |

What to check, by looking at crops and with the audit profile:

- **rim-edge and rings, outside the line**: about 2% of the line's displayed peak at 0.01 S, 1% at 0.02, 0.3–0.6% at 0.04, 0.1–0.25% at 0.065, and nothing visible past about 0.1 S.
- **The bloom numbers assume the recipe's hot line is about as wide and white as the reference's.** The reference rim is a whitened band about 0.01 S wide, which our tone curve gives from Meta Blue at about 6× nominal (blue channel about 4.5). A thinner or dimmer line needs more bloom, in proportion to the energy it lacks.
- **rim-edge and rings get no halation.** Their outer glows are blue to violet, never warm. Real halation needs red light, and with per-channel halation (section 10) the coral ring would otherwise get a red fringe the reference does not show. The rings' broad inner glows are recipe light, not lens.
- **light-line**: the recipe must make the line's scene brightness rise steeply. It should stay below nominal in the top 30% (so it has no glow, as in the reference). From there, its light above nominal should grow about 35× between 45% and 80% of the frame height (doubling about every 6% of the height). If the line is about 1.5× nominal at 45%, that puts it near 20× in the lower quarter. The halation path then grows and widens the halo on its own. The yellow-left, magenta-right split is recipe light. halationRadius 0.035 puts the halo on levels 4–5 (the measured tail e-folds at 0.024–0.028 S). The tint is the measured mean halo color.
- **Until the halation mask changes** (section 10), expect to need about twice the halation value: the current mask dims the halo where the recipe's own glow is bright.

---

## 10. Changes to the lens stage

The lens code belongs to another agent. These are proposals only.

1. **Add a tail to `bloomLevelFactors`.** Keep the bump as the shoulder and add a power-law part with its own share:

   ```ts
   // length: shoulder length (S). tail: share in the power-law tail. tailPower: alpha.
   const center = 4.4 + Math.log2(length / 0.024)
   const shoulder = levels.map((i) => Math.exp(-0.5 * ((i - center) / 0.6) ** 2))
   const tailW = levels.map((i) => (i >= center ? 2 ** ((2 - tailPower) * (i - center)) : 0))
   const weights = add(scale(normalize(shoulder), 1 - tail), scale(normalize(tailW), tail))
   ```

   Expressing the shoulder as a length in S (instead of a radius and a width over level indices) makes Softness one number with a physical meaning: how far the glow reaches. Contour uses tail 0. Mist looks use 0.2–0.5 with α 2.5–3.
2. **Feed halation each channel's own light.** `THRESHOLD_SHADER` stores the luminance excess as grey, and the composite multiplies by `halationTint`, so any bright light, including a blue one, gets an orange halo. Store `c · excess / y` instead. Then read `halationTint` as per-channel strength. The current default #FF5A1F is linear (1, 0.10, 0.014), already a film-like set of shares (spektrafilm uses 1 : 0.3 : 0). Keep green narrower than red with `halationSpread` (0.67 makes it one level narrower).
3. **Replace the dark mask.** `exp(-4.0 * luminance(c))` is 0.45 at luminance 0.2, 0.30 at 0.3 and 0.14 at 0.5, so it cuts the halo 2–7× exactly where it should be strongest: next to the source, where the recipe's glow is. Addition in linear light already hides halos on bright backgrounds. If the hot core must not be tinted, fade only above nominal:

   ```glsl
   float fade = 1.0 / (1.0 + max(luminance(c) - 1.0, 0.0));
   c += uHalation * halo * fade;
   ```

4. **Apply exposure before the threshold.** `lensAndTone` multiplies by `exp2(uExposure)` after the lens, so the threshold sees unexposed light, and raising Intensity never makes more of the image halate. Pass `threshold · 2^(−exposure)` to the threshold pass. Bloom is linear and unaffected.
5. **Keep halation's falloff exponential and its colors joined.** `halationLevelFactors` gives each channel one Gaussian bump over levels (width 0.8), which is already close to an exponential (a 0.6-level bump matches one, section 8.3). Keep it, and keep the red-to-blue separation under about one level per side, so the halo does not split into the "two color swaths" the halation DCTL warns about. If item 1 lands, reuse its shoulder weights per channel so bloom and halation share one definition of length.
6. **Optional chroma per radius for bloom**: a per-channel level offset (red +0.2, blue −0.25), default 0. Do not use `bloomTint` to make a glow warmer than its source.
7. **Later, for Warp Speed**: an x-only streak pass (Kawase iteration, fade^d weights), a mix of 0.5–2%, cool tint. Not for Contour.
8. **A falloff check in the audit harness** (`scripts/light/`): the median outer-side line spread in linear light at 0.01, 0.02, 0.04 and 0.07 S, and the e-folding length, printed next to the reference's values. It guides; the side-by-side crops decide.

---

## 11. The 8 most concrete recommendations

1. **Use the measured settings for the three references** (section 9): contour-rim-edge bloom 0.12, bloomRadius 0.52, bloomWidth 0.8; contour-iridescent-rings 0.15, 0.62, 0.5; both white tint and no halation. contour-light-line bloom 0.03 plus halation 1.0, threshold 1.0, radius 0.035, tint #FF914F, spread 0.4. Check the outer glow against the line's displayed peak: about 2% at 0.01 S, 1% at 0.02, 0.3–0.6% at 0.04, 0.1–0.25% at 0.065, nothing visible past 0.1.
2. **Give Contour one glow length**: an exponential shoulder with point-spread length 0.020 S (0.016–0.023). The three references and Tiffen's Glimmerglass test agree. In current settings, bloomRadius = (4.4 + log2(λ / 0.024)) / 7 and bloomWidth 0.6. Map Softness to λ.
3. **Add a power-law tail term** to the bloom weights (share τ, exponent α, each level 2^(2−α) times the previous). τ = 0 for Contour. τ 0.2–0.5 with α 2.5–3 for mist-type veils (Pro-Mist, CineBloom) when Sunset blooms need them.
4. **Feed halation each channel's own light above nominal**, with green at about 0.3 of red and one level narrower, and blue at 0. Blue rims then never get warm fringes, as in contour-rim-edge, and warm or white lights get the orange-near, red-far halos Dehancer describes.
5. **Replace the `exp(−4·L)` halation mask** with a fade that acts only above nominal, `1 / (1 + max(L − 1, 0))`. The current mask removes 55–86% of the halo where the composite is 0.2–0.5, right beside the source.
6. **Apply exposure before the halation threshold** (threshold × 2^(−exposure)), so the Intensity control makes highlights halate more, the way overexposing film does.
7. **Make the light-line glow from scene brightness, not from bloom.** The recipe keeps the top 30% of the line below nominal, then grows its light above nominal about 35× between 45% and 80% of the height (doubling about every 6%), and lets threshold-fed halation grow and widen the halo. A threshold-free bloom strong enough for the bottom would put a glow on the dim blue top, which the reference does not have.
8. **Add a falloff check to the audit**: the outer-side line spread in linear light at 0.01, 0.02, 0.04 and 0.07 S, and the e-folding length, next to the reference's numbers. Then look at the side-by-side crops; the look decides.
