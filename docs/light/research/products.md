# Products and tools: light-like gradients and minimal controls

What gradient and light tools do, why their output reads as light or as flat paint, which controls they show, and what we take for the engine and for the panel. Paper Design's Mesh Gradient, Grain Gradient and God Rays, and the Stripe gradient, are already described in [`../research-artists.md`](../research-artists.md); this file only adds to them. Rendering methods are in [`../research-techniques.md`](../research-techniques.md).

How this was checked (2026-11-02):

- Every link was opened. Source code was read for Paper Design shaders, ShaderGradient, a copy of the Stripe gradient (whatamesh), CSS Hero's Mesher, ray.so, and DialKit 1.4.3 (in `node_modules`).
- Pages that block scripted requests were read another way: OpenAI's brand page and Ian Spalter's Instagram post through the Internet Archive; the Figma, Arc and Midjourney help articles through their help-center APIs.
- "Observation" marks what we saw in an image or inferred from code, not what a source says.

## Main findings

- Almost every tool here interpolates between colors: sRGB averages, stacked alpha layers, Oklab or OkLCh ramps. That output reads as paint. The products that read as light add light in linear values and let highlights go to white: Deep Glow, After Effects glows in 32-bit projects, Photoshop's Light Bokeh, and the Windows 10 hero image, which is a photograph of projected light in fog.
- The best-documented light image here, the Windows 10 hero, was built in passes: the beams, the haze and the flares were shot separately, added, and then graded to the brand color once. That is our pipeline: recipe light, lens passes, then a tone curve that lands on the pack hexes.
- Tools for non-designers share one shape: a designer builds the look and publishes a few named controls and a few named presets; users pick a preset, shuffle, nudge one or two amounts, and pick a size.
- A seed only works as a control if it is stable: the same seed must give the same composition at every format and in later versions of the tool. Generative image tools document where this breaks.

---

## Shader and gradient tools

### Paper Design shaders (additions)

Technique, read from the [`paper-design/shaders`](https://github.com/paper-design/shaders) source. There are 30 shaders: color panels, dithering, dot grid, dot orbit, fluted glass, gem smoke, god rays, grain gradient, two halftones, heatmap, image dithering, lens distortion, liquid metal, mesh gradient, metaballs, neuro noise, paper texture, perlin noise, pulsing border, simplex noise, smoke ring, spiral, static mesh gradient, static radial gradient, swirl, voronoi, warp, water and waves.

- Every gradient shader combines colors as weighted averages or `mix` calls on premultiplied sRGB values. The library has an Oklab/OkLCh helper (`shader-color-spaces.ts`, which uses `pow(x, 2.2)` as the sRGB curve), but no shader imports it.
- **Static Mesh Gradient:** up to 10 color spots, placed by one "Positions" number from 0 to 100 (a placement seed). Each pixel is a weighted average of the spot colors with weight `1/(d^p + 0.001)`. The Mixing slider moves `p` from 2 to 1 and lowers an extra sharpness exponent (up to 8) to 1: Mixing 0 gives hard cells, 1 gives a smooth blend. Wave X and Wave Y bend the coordinates first.
- **Static Radial Gradient:** a radial ramp with a focal point (Focal Distance, Focal Angle), Falloff from −1 to 1, Mixing (0 is hard stripes, 1 is smooth) and a radial distortion (strength, shift, frequency). Presets include "Cross Section", "Radial" and "Lo-Fi".
- **Warp:** Proportion (where the blend point sits), Softness (0 is a hard edge, 1 is smooth), Shape (checks, stripes or edge), Distortion, and Swirl with 2 to 20 iterations.
- **Pulsing Border:** spots of color running along a rounded rectangle. Its Bloom slider goes from "0 = normal blending" to "1 = additive blending", the same switch God Rays has.
- **Heatmap and Gem Smoke:** Heatmap maps a blurred copy of an input shape through a color ramp (Inner Glow and Outer Glow set the size of the "heated" area inside and outside the shape). That reads as a thermal map, not as light. Gem Smoke draws noise smoke inside and outside an input shape.
- **Grain:** Mesh Gradient, Static Mesh Gradient and Static Radial Gradient have Grain Mixer (noise added to the mixing value, so color edges go grainy) and Grain Overlay (each grain cell mixed up to 35% toward black or white). Both use a fixed number of grain cells across the shape (1000 or 2000, depending on the shader), so a 4K export gets grain about four times coarser in pixels than a 1K preview of the same shape. Grain Gradient sizes its pattern from the canvas resolution instead.
- **Sizing:** every shader takes Fit (none, contain or cover), Scale, Rotation, Offset X/Y, Origin X/Y and an optional World Width/Height. Shapes default to contain, patterns to none.
- **Presets:** 4 to 6 named presets in each shader we checked, each a complete set of values. Static Mesh Gradient's "Sunset" is `#264653`, `#9c2b2b`, `#f4a261`, `#ffffff` with Wave X 0.6, Wave Y 0.7 and Mixing 0.5.

Light or paint: paint. Weighted averages in sRGB, no tone curve. The additive Bloom setting in God Rays and Pulsing Border comes closest to light, but sums above 1 clip.

Controls: 4 to 15 sliders per shader, plus a color list, the sizing group and speed. Each shader has a docs page with its presets (for example [Static Radial Gradient](https://shaders.paper.design/static-radial-gradient)).

Take:

- Engine: a world box fitted into the canvas (contain or cover) is a simple way to make one preset work at all four aspect ratios. Size grain in output pixels, not in shape units.
- UI: Paper's Mixing slider runs a single shader from hard bands to smooth ramps. Softness can do the same for the Sunset bands recipe. Presets should be complete value sets, never partial edits.

### ShaderGradient (ruucm)

Technique, read from the [repo](https://github.com/ruucm/shadergradient) (`packages/shadergradient/src`):

- A three.js `MeshPhysicalMaterial` with a custom shader, on a plane, a sphere or a "water plane". The vertex shader bends the surface with noise (Strength, Density, Frequency, Amplitude, Speed).
- The base color is `mix(mix(color1, color2, smoothstep(-3, 3, pos.x)), color3, pos.z)`. Hex values are divided by 255 and used as they are, with no sRGB-to-linear step (`utils/color.ts`).
- The surface is lit by three.js physical lighting: an environment map ("city", "dawn" or "lobby") or 3D lights with a Brightness value, clearcoat 1, metalness 0.2.
- Grain is a post pass built on three.js's halftone pass, with an on/off switch and Grain Blending.
- The whole state can live in a URL query string. The [customize page](https://www.shadergradient.co/customize) writes one, and the component reads it back with `control='query'`.

Light or paint: the color itself is a paint mix. What reads as light is the shading: highlights and reflections from the environment map move over the bent surface, so the image has a light direction.

Controls: type; three colors; the five noise values; camera azimuth, polar angle, distance and zoom; position and rotation; light type, environment preset and brightness; reflection; grain. Presets: Halo, Pensive, Mint, Interstella, Nighty night, Viola, Universe, Sunset, Mandarin, Cotton Candy.

Take:

- Engine: a highlight computed from the surface normal of a smooth height field gives form and a light direction cheaply. We already plan this for rims (techniques doc, section 7). Never feed hex/255 into light math as if it were linear.
- UI: keeping the whole look in one URL makes an image reproducible and shareable. We can do the same in the URL and in the export file name.

### Unicorn Studio

Technique ([Getting Started](https://www.unicorn.studio/docs/getting-started/)):

- A layer canvas like Figma's with "75+ configurable effects". An effect changes either everything below it or one layer. Some are utilities (Vignette, Anti-alias); others are main effects (Aurora, Blob Tracking). Bloom and blur run in several passes ([changelog](https://www.unicorn.studio/docs/changelog/)).
- Effect shaders ship inside each published scene, not in the public runtime ([unicornstudio.js](https://github.com/hiunicornstudio/unicornstudio.js)), so we could not read them. Custom shaders receive the layers beneath as `uTexture`.
- Film Grain has "amount, clumping, crush, chromatic variation, and animation speed".

Light or paint: it depends on the effects in the stack; we could not read their math.

Controls and handoff ([Variables](https://www.unicorn.studio/docs/variables/)):

- Almost any property can become a named variable (number, boolean, string, color, vec2, vec3 or texture). One variable can be bound to several properties.
- "Presets are named snapshots of variable values." A preset is applied first; explicit variable values then override it.
- `getVariableManifest()` returns each variable's type, default, current value and min/max/step, so a host page can build its own controls.
- From the Getting Started page: "teammates can generate on-brand variations without touching the design."
- Export: a still as PNG, JPG or WEBP, or a video up to 4K.
- [Performance guide](https://www.unicorn.studio/docs/performance/): "Anything soft — blurs, glows, fog, gradients, smooth noise — can usually run at 0.5 or even 0.25 with no visible difference."

Take:

- Engine: preview soft passes (wide bloom levels, haze, wide glows) at half or quarter resolution; keep thin cores and grain at full resolution.
- UI: this is our model. A recipe has dozens of parameters; the panel publishes three variables, and each one can drive several parameters. A Look is a named snapshot of all of them.

### Spline

Technique ([docs](https://docs.spline.design/)):

- Material layers stacked on a 3D object. The [Gradient layer](https://docs.spline.design/materials-shading/color-and-texture/gradient-layer) is Linear, Radial or Polar, with Blending set to Linear or Smooth, a ramp, an angle and an offset. The [Depth layer](https://docs.spline.design/materials-shading/shading-and-reflection/depth-layer-3d-gradient) is a 3D gradient keyed to world position or camera distance, meant to "simulate light effects, create fake lighting and shadows". Other layers: Noise, Rainbow, Lighting, Toon, Matcap, Fresnel, Glass, Reflection.
- Lights: directional, point and spot, soft shadows, HDRI environment.
- [Post-processing](https://docs.spline.design/cameras/effects-post-processing): Depth of Field, Pixelation, Aberration, Bloom, Hue, Brightness, Vignette, Noise.
- [Image export](https://docs.spline.design/exporting-your-scene/files/exporting-as-an-image): JPG or PNG with a pixel density ratio.

Light or paint: gradient layers alone are paint. Lit objects with Fresnel or Glass plus Bloom read as light.

Take: the Depth layer is a falloff from a point presented as a gradient, the same idea as our distance-based glows. Its Linear/Smooth switch is Softness reduced to one bit. Nothing else we need.

### Figma: built-in effects, shader fills and shader effects

Built-in effects ([Apply effects to layers](https://help.figma.com/hc/en-us/articles/360041488473)):

- Noise: Mono, Duo or Multi colors, noise size, density, and color or opacity.
- Texture: roughens a layer's edge (size, radius, clip to shape).
- Glass: light angle, light intensity, refraction, depth, dispersion ("chromatic splitting along the curved edge"), frost and splay.
- Layer and background blur, uniform or progressive (size, direction, and intensity at the start and end).

Shaders ([Find and use shaders](https://help.figma.com/hc/en-us/articles/41175721167767), [Create shaders with the Figma agent](https://help.figma.com/hc/en-us/articles/41147702210071)):

- A fill generates pixels ("patterns, gradient meshes, noise textures, and procedural backgrounds"); an effect reads the layer's pixels and changes them. Both render with WebGPU and are usually made by prompting the Figma agent.
- Control types, from Figma's shader authoring reference for agents: boolean, text, slider, numeric select, color, gradient with 2 to 8 stops, and on-canvas handles: a point, a point with a radius (relative to the layer's smaller side), two points, a point with an angle and radius, and a combined color-and-point control.
- [Review guidelines](https://help.figma.com/hc/en-us/articles/43029233324695): "Test your shader across a range of layer sizes, aspect ratios, and zoom levels. Check that the shader renders correctly at every value of each shader setting."

Light or paint: Noise is flat pixel scatter at one size, the same in shadows and highlights. Glass is the most light-like built-in: it has a light angle, refraction, and color splitting at edges.

Take:

- Engine: measure radii against the smaller side (our short-edge units), and use Figma's review rule as our slider test: every value of every setting, at every aspect ratio.
- UI: on-canvas handles would be a good way to place Contour's light, but they add a second place to make changes. We keep sliders and the seed.

### Rive

Technique ([Vector Feathering](https://rive.app/blog/introducing-vector-feathering), [how it works](https://rive.app/blog/how-rive-reinvented-feathering-for-the-vectorian-era)): Rive softens vector edges without a raster blur. The opacity at each point is "the integral of the normal distribution function" across the edge, with a 2D version for curves and corners, computed in the same triangles that antialias the shape. Controls: Amount, Offset and Inner, on any fill or stroke.

Light or paint: a soft-edged shape of one color over another is paint unless it is blended additively.

Take: an analytic Gaussian edge (erf) is exact at any size and needs no blur pass. That is our erf band weight (techniques doc, section 2), and Rive ships the same idea in production. Rive's "Inner" feather is the inner rim falloff of `contour-rim-edge`.

### Haikei

Technique: 15 SVG generators ([list](https://haikei.app/generators/)): blobs, waves, peaks, steps, scatters, low-poly grids and Blurry Gradient. The app's exporter keeps SVG `filter` and `stdDeviation` attributes, which points to an SVG Gaussian blur over shapes for Blurry Gradient (observation from the app's JavaScript).

Light or paint: blurred shapes layered in sRGB: paint.

Controls ([home](https://haikei.app/)): a few sliders per generator (complexity, contrast, number, size), one or two colors, "the dice button to generate a new visual every time", a list of common canvas sizes, a way to "compare different generators across formats", and PNG or SVG export. Blurry Gradient: "Add any two colors and randomize".

Take (UI): a dice button, preset canvas sizes and side-by-side formats are a good small set of controls.

### Mesh gradient generators

- Apple SwiftUI [`MeshGradient`](https://developer.apple.com/documentation/swiftui/meshgradient): a grid of colored vertices with Bezier control points, rendered as Bezier patches. Colors are interpolated linearly, or with cubic curves when `smoothsColors` is on, in the output space (`.device`) or in "a perceptual color space" (`.perceptual`).
- CSS Hero's [Mesher](https://csshero.org/mesher/) and [MSHR](https://www.mshr.app/): each color is a `radial-gradient(at x% y%, color 0px, transparent 50%)` layer stacked over a background color (read from Mesher's script). The layers cover each other with normal alpha blending in sRGB.
- Illustrator's [Freeform gradient](https://helpx.adobe.com/illustrator/using/gradients.html): "Points" blends colors around color stops; "Lines" blends colors around a drawn line.

Light or paint: paint. Colors are interpolated between points, so an overlap is never brighter than the colors in it.

Take:

- Engine: Apple offers cubic color interpolation for the same reason we use monotone cubic ramps: linear segments show faint lines at every stop.
- Illustrator's Lines mode spreads color from a curve (diffusion curves), close to Contour's "a gaussian along one curve or edge".

### CSS gradient tools with Oklab and OkLCh

- The spec: gradients interpolate in Oklab by default ([CSS Images 4](https://drafts.csswg.org/css-images-4/)), but "user agents must handle interpolation between legacy sRGB color formats (hex colors, named colors, rgb(), hsl() or hwb() …) in gamma-encoded sRGB space" ([CSS Color 4](https://drafts.csswg.org/css-color-4/)). So a `linear-gradient` written with hex colors is still an sRGB average. `in srgb-linear` interpolates in linear light ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/color-interpolation-method)).
- Josh Comeau's [article](https://www.joshwcomeau.com/css/make-beautiful-gradients/) and [generator](https://www.joshwcomeau.com/gradient-generator/): the gray middle of an RGB gradient is Erik Kennedy's "gray dead zone". The fix shown is interpolating in another color mode (`in oklch` takes yellow to blue through green and aqua) and passing many precomputed midpoints, spaced by an easing curve.
- Adam Argyle's [gradient.style](https://gradient.style/): a choice of 13 interpolation spaces, "Add a random color", and copy as modern or classic CSS.
- Andreas Larsen's [easing gradients](https://larsenwork.com/easing-gradients/): "Linear gradients often have hard edges where they start and/or end"; easing the mix removes them.

Light or paint: Oklab avoids the dark middle; OkLCh avoids gray by inventing hues; `srgb-linear` gives the lighter middle that adding light gives. None of them has a tone curve.

Take:

- Engine: these confirm our rules (mix in linear light, use Oklab only to measure). Ease the ends of every ramp so it never stops with a corner in its slope.
- UI: if the app draws CSS gradients as thumbnails for Looks, use `in srgb-linear` so the thumbnail is closer to the render.

### fffuel and "grainy gradients"

- Jimmy Chion, [Grainy Gradients](https://css-tricks.com/grainy-gradients/) (CSS-Tricks, 2021): put SVG `feTurbulence` fractal noise under a gradient that fades to transparent, then apply `filter: contrast(170%) brightness(1000%)`, so the gradient "gradually dithers away" into noise. He notes that the filter changes the colors ("the leftmost blue is a different blue than the pure blue we started with"), that the noise is multicolored, and that Chrome and Safari blend `mix-blend-mode` slightly differently.
- fffuel builds on it. [gggrain](https://www.fffuel.co/gggrain/): three colors with an "oversaturate" option, a blend mode, linear or radial, grain opacity and frequency (`feTurbulence`, `feComponentTransfer`, `feColorMatrix`). [ffflux](https://www.fffuel.co/ffflux/): `feTurbulence`, `feGaussianBlur` and `feBlend`, with frequency and blur in X and Y and ten blend modes. [nnnoise](https://www.fffuel.co/nnnoise/): noise lit with `feSpecularLighting`. fffuel warns that the SVGs are slow to render and suggests rasterizing them.

Light or paint: thresholded noise reads as print (riso), not light, and the contrast and brightness push shifts the hues.

Take: the thresholded-noise look is the one Paper's Grain Gradient gets (artists doc) and suits our three riso references. The production Grain filter must not use a contrast push: it "changes the surface, never the color", checked with blurred ΔE.

---

## Compositing and photo tools

### After Effects: Deep Glow, the built-in Glow, and linear blending

- [Deep Glow](https://www.plugineverything.com/deep-glow) (Plugin Everything) "simulates inverse-square falloff". Its listed features: HDR thresholding with smoothness; gamma correction for "linear results even when working in non-linear colorspace"; glow aspect ratio and angle; chromatic aberration; downsample and blur quality; tint and blend modes; "Dithering controls to reduce colour-banding artifacts"; 8, 16 and 32 bits per channel. The page lists features, not every control by name.
- The built-in [Glow](https://helpx.adobe.com/after-effects/using/stylize-effects.html): Glow Threshold (a percentage), Glow Radius (in pixels), Glow Intensity, Composite Original, Glow Operation, A & B colors with color loops, and dimensions. Adobe: "Glows tend to be brighter and more realistic in 32-bpc projects because the high dynamic range in a 32-bpc project prevents the color values of the glow from being clipped."
- [Linear blending](https://helpx.adobe.com/after-effects/using/color-management.html) ("Blend colors using 1.0 gamma") prevents "the fringing that appears when high-contrast, saturated colors are blended together". Adobe recommends it at 16 and 32 bits per channel, not 8.

Light or paint: Deep Glow reads as light: a long tail and linear math. The built-in Glow with one radius and a hard threshold looks like a soft stroke.

Take:

- Engine: this matches what we planned: long tails from several radii, no hard threshold, float buffers, linear light, dither. Radii in pixels are wrong for us; use short-edge units.
- UI: Deep Glow's pitch is that it looks right "out of the box". A good default matters more than more options.

### Photoshop and Lightroom

- Gradients: Oklab is "now the default interpolation method for gradients" in Photoshop ([Ottosson](https://bottosson.github.io/posts/oklab/)). The Gradient tool has a Dither option "to smooth the gradient and reduce banding" ([Adobe](https://helpx.adobe.com/photoshop/desktop/adjust-color/color-effects-techniques/apply-gradient-fill.html)).
- [Lens Blur](https://helpx.adobe.com/photoshop/desktop/effects-filters/blur-sharpen-filters/create-depth-of-field-with-lens-blur.html): a depth map, focal distance, iris (shape, radius, blade curvature, rotation), Specular Highlights (Brightness, Threshold) and Noise (amount, uniform or Gaussian, monochromatic).
- [Blur Gallery](https://helpx.adobe.com/photoshop/desktop/effects-filters/blur-sharpen-filters/use-blur-gallery-depth-of-field-effects.html): Field, Iris and Tilt-Shift blurs set with pins on the image. Bokeh controls: "Light Bokeh: Brightens out-of-focus highlights", "Bokeh Color: Adds saturation to brightened areas without blowing them to pure white", and Light Range. Grain restore: "Restoring grain prevents blurred areas from looking artificially smooth", with a Highlight slider that reduces noise in bright areas.
- [Diffuse Glow](https://helpx.adobe.com/photoshop/desktop/quick-actions/apply-diffuse-glow-to-images.html): Graininess, Glow Amount and Clear Amount, or a one-click quick action that "applies preset values optimized for most images".
- Lightroom Classic [Lens Blur](https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/lens-blur.html): an AI depth map; bokeh shapes Circle, Bubble, 5-blade, Ring and Anamorphic; sliders Blur Amount, Cat Eye, Boost ("the intensity of the chosen Bokeh effect") and Focus Range.
- Lightroom Classic [presets](https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/apply-presets.html): hover over a preset to preview it, then set its strength with the Preset Amount slider.

Light or paint: blur alone is paint. Brightening the highlights before or during the blur (Light Bokeh, Boost, specular Brightness) is what makes a blurred image look like light through a lens. Bokeh Color shows the same choice our tone curve makes: keep saturation, or go to white.

Take:

- Engine: brighten highlights before spreading them (bloom without a threshold already does this). Add grain after every blur, and reduce it in highlights.
- UI: a one-click preset with tuned values, a preview on hover, and one Amount slider.

---

## OS wallpapers made from light

### Microsoft: the Windows 10 hero image and Windows 11 Bloom

- [GMUNK, Windows 10 Desktop](https://gmunk.com/Windows-10-Desktop/) (2015). The team "built the actual Windows logos" and shot them with "volumetric lighting". The logo was cut into black card and into a matching sheet of acrylic, "creating a clear rim around the insides of the logo to catch light blooms and specular hits". A video projector and a laser projector shone through the holes, with "a natural fog". They shot over 3,000 photos on a 9k Phase One camera. The Photoshop composite stacked a base image, laser passes, "separately shot layers of smoke and haze", and lens flares shot "with a light source positioned in the same place as the laser projector, so the flares lined up perfectly". "The final grade was applied to bring everything into the signature 'Microsoft Blue' palette." The page links The Verge's coverage: "Windows 10's new desktop wallpaper is made out of light".
- Windows 11 Bloom: made by the Barcelona studio [Six N. Five](https://sixnfive.com/projects/windows-11/) as 3D renders, under Microsoft's creative direction; the studio also made two [theme packs](https://sixnfive.com/projects/windows-11-themes/), one of landscapes and one of abstract shapes. [Wikipedia](https://en.wikipedia.org/wiki/Windows_11) credits the studio too. No render method is published. Observation: thin translucent petals with light passing through and between them, and soft shadows.

Why it reads as light: the Windows 10 image is real light in haze, so beam edges are soft, the hottest parts go white, and the flares sit where the source is.

Take:

- Engine: build Contour the way that shoot was built: a source pass, a haze pass, a rim pass, and flare or halation at the source's position, added in linear light, then one grade (our tone curve) that lands on the pack colors. Haze is what makes a beam visible.
- The acrylic rim catching light is `contour-rim-edge`; the projector beam in fog is `contour-beam-pool`.

### Apple

- Apple has not published how its abstract macOS and iOS wallpapers are made.
- The dynamic desktop format is documented through the [`wallpapper`](https://github.com/mczachurski/wallpapper) tool: one HEIC file holds several images, each tagged with the sun's altitude and azimuth (or a time of day, or a light or dark flag), and macOS shows the image that matches the sun.
- In macOS Tahoe, Apple added dawn, dusk and night versions of its lakeside wallpaper, as separate images. [Basic Apple Guy](https://basicappleguy.com/basicappleblog/dynamic-tahoe-wallpapers) combined frames from Apple's 4K videos into dynamic files.
- On the iPhone Lock Screen: "Change the style: Swipe left or right to try different color filters" ([Apple](https://support.apple.com/guide/iphone/create-a-custom-lock-screen-iph4d0e6c351/ios)).

Take:

- Engine: Apple keys sky images to the sun's altitude. The sun's depth below the horizon (δ in the techniques doc, section 3) would make a good Sunset mood control: one number that moves the glow, the purple light and Earth's shadow together.
- UI: swipe through a few styles, with a full-screen preview.

### Google Pixel

- Material You (2021) derives the system palette from the chosen wallpaper. Android 14 (2023) added Emoji wallpaper, Cinematic wallpaper (on-device machine learning turns a photo into a 3D image), and Generative AI wallpaper, where you "answer suggested prompts" ([Google, I/O 2023](https://blog.google/products/android/new-android-features-generative-ai/)) and "choose from pre-set suggestions to create never-before-seen wallpapers in just a few taps" ([Google, Android 14](https://blog.google/products/android/android-14/)). The Verge: it lets "you generate backdrops by selecting different parameters" ([The Verge](https://www.theverge.com/2023/10/4/23901594/google-pixel-android-14-ai-generated-wallpapers)).
- A making-of for Pixel wallpapers built from rendered light: not found.

Take (UI): offer structured choices instead of free input, and let one choice set the colors. For us, the Role picks the pack.

---

## Brand gradient systems

### Stripe (additions)

In the [whatamesh](https://github.com/jordienr/whatamesh) copy (`lib/Gradient.js`), the four colors come from CSS custom properties `--gradient-color-1` to `--gradient-color-4` on the canvas, so the site sets colors in CSS while the motion and mixing stay fixed. Wave layers are combined with a normal blend, and an optional "darken top" subtracts green toward the top of the frame.

Take: a brand gradient can be a few colors plus one fixed recipe. Ours is a pack plus a recipe, with the light model the Stripe gradient lacks.

### Linear

- [How we redesigned the Linear UI](https://linear.app/now/how-we-redesigned-the-linear-ui): themes are generated in LCH instead of HSL. "Instead of having to define 98 specific variables for each theme, we defined three: base color, accent color, and contrast." The contrast variable also produces high-contrast themes for accessibility.
- [Brand page](https://linear.app/brand): the primary color is "a subtle desaturated blue", "typically reserved for backgrounds".

Take: three inputs can drive a whole system if the generator behind them is good. One quiet blue can be a brand's background.

### Vercel

[Designing and building the Vercel Ship conference platform](https://vercel.com/blog/designing-and-building-the-vercel-ship-conference-platform) (2025): the team generated "over 15,000 images and videos during the design exploration", tried "full-spectrum color, oil-slick vibes, and even a callback to our prism", found it "Too far, too shiny, and too loud", and moved to a darker "near-metallic liquid". In code, a fluid simulation in one shader feeds a ray-marched surface, with a glass prism that bends the light.

Take: the same lesson as the brief's "never the full spectrum".

### OpenAI

The 2025 rebrand was made in house, with Studio Dumbar for motion ([Wallpaper*](https://www.wallpaper.com/tech/openai-has-undergone-its-first-ever-rebrand-giving-fresh-life-to-chatgpt-interactions)). Its four values are "simplify, space, imperfection and vivid". The imagery is commissioned photography plus "textures and patterns created by Sora". An "emotive point", "a pulsing blue disc", stands for the user's interaction with the AI. The [brand page](https://openai.com/brand/) (read through the Internet Archive) covers the logo and type and says "DON'T use any effects or textures" on the logo.

Take: OpenAI uses real photographs, not generated gradients, for its main imagery, and one soft blue disc stands for the product.

### Arc

Arc's [2022 release notes](https://resources.arc.net/hc/en-us/articles/20498417809815-Arc-for-macOS-2022-Release-Notes) (read through the help-center API): "Space Themes V2! Now with more customizability, more presets, and dark mode!"; "You can now increase Intensity or Graininess in the Space Theme editor"; haptics in the theme picker; theme colors carried into menus, previews and the command bar.

Take: presets first, then Intensity and Grain as the only extra controls. That is close to our panel.

### Spotify

Collins' [case study](https://wearecollins.com/case-studies/spotify/): a "Lens" technique based on duotone screen printing turns any artist photo into a Spotify image, and the palette uses "bold, high-contrast color pairs that most brands avoid".

Take: one treatment that makes any input look on-brand is what our filter layer does. Spotify's clashing color pairs are the opposite of our pale bridges.

### Instagram (the brief's anti-reference)

Ian Spalter, [Designing a New Look for Instagram](https://web.archive.org/web/2016/https://medium.com/@ianspalter/designing-a-new-look-for-instagram-inspired-by-the-community-84530eb355e3) (2016): "the rainbow is a bridge into the colorful gradient"; "we looked at more minimal options, but ultimately we needed more warmth and energy". Inside the app, color "should come directly from the community's photos and videos".

Observation: the icon gradient runs from yellow at one corner through orange and magenta to purple. Every hue is saturated, there are several warm hues and no blue sky, and they blend like paint.

Take: the brief rules this out: one warm color at most, Meta Blue holds the sky, and bridges go pale.

---

## UI patterns for non-designers

Our panel is DialKit with Mood, Look, Colors (three packs), Intensity, Softness, one mood control, Seed with shuffle, Format and Export.

### Patterns, with examples

1. **Complete presets.** Paper ships 4 to 6 per shader, ShaderGradient ships 10, Unicorn Studio "named snapshots of variable values", and Lightroom previews a preset on hover. One click, and every preset has been approved. For us: a Look sets every hidden parameter of the recipe at once. Never apply part of a Look.
2. **An amount slider on top of a preset.** Lightroom's Preset Amount, Arc's Intensity and Graininess, Linear's contrast input. Fast, and safe when both ends of the range have been tested. For us: Intensity and Softness at 50 reproduce the Look as designed; 0 and 100 are tested limits; each slider moves several parameters together.
3. **Shuffle with a visible seed.** Coolors makes a new palette when you press the spacebar ([Coolors](https://coolors.co/)); Haikei has a dice button; gradient.style has "Add a random color"; the AUTOMATIC1111 Stable Diffusion UI has a seed field plus a "Variation strength slider and Variation seed field" ([wiki](https://github.com/AUTOMATIC1111/stable-diffusion-webui/wiki/Features)); Midjourney offers "Subtle" and "Strong" variations ([docs](https://docs.midjourney.com/hc/en-us/articles/32692978437005-Variations)). One key press, but only safe if every seed gives a usable image and you can get back to the last one. For us: a seed field and a Shuffle button, Space as the shortcut, a short back/forward history, and the seed changes composition only (horizon warp, glow position, crop), never color or softness.
4. **Fixed choices instead of free values.** ray.so offers padding as 16, 32, 64 or 128 (`store/padding.ts` in [ray-so](https://github.com/raycast/ray-so)); Google's AI wallpaper offers suggested prompts; Linear takes three theme inputs; our Colors control offers three packs, not a color picker.
5. **Swipe or compare with a full preview.** The iPhone Lock Screen swipes through styles over the same image; Haikei lets you compare generators across formats. For us: switching Format keeps the composition and shows the new crop immediately.
6. **Format and export.** Haikei lists common canvas sizes; [ray.so](https://ray.so/) exports PNG at 2x, 4x or 6x, with ⌘S to save, ⌘C to copy the PNG and ⇧⌘C to copy a link, and keeps settings such as padding in the URL hash; ShaderGradient keeps its settings in a URL query; Unicorn Studio exports PNG, JPG or WEBP stills and video up to 4K; Spline exports JPG or PNG with a pixel density ratio. For us: the four preset sizes, PNG, the seed in the file name, the settings in the URL, ⌘S to export.

### What is fast and hard to misuse

- Fast: one-click Looks, one key for Shuffle, one key for Export, settings in the URL.
- Hard to misuse: bounded amount sliders whose ends are tested, pack names instead of colors, seeds that are all usable, a way back after shuffling, the same composition at every format.
- Easy to misuse: many sliders, sliders whose ends break the brief, color pickers, free number fields, seeds that change with format or version, settings that reset without warning when Mood changes.

### DialKit specifics

- DialKit is built as a tuning panel for developers ([DialKit](https://joshpuckett.me/dialkit): "built-in presets and JSON export"). It hides itself in production builds unless `<DialRoot productionEnabled />` is set. Use `mode="inline"` for a fixed sidebar; the default popover collapses to a bubble that can be dragged around the screen.
- The panel's toolbar always shows a "Version" preset dropdown and a Copy button (it copies the values as JSON), and `DialRoot` has no option to hide them. Both are developer chrome. DialKit also exports `Folder` (which takes its own `toolbar`), `Slider`, `SelectControl`, `Toggle` and `ButtonGroup`, so the panel for end users can be assembled from those parts without that toolbar.
- `select` controls are dropdowns; DialKit's only segmented control is the Off/On toggle. A dropdown hides the three packs and the moods behind a click; `ButtonGroup` or a small custom segmented row shows them at once.
- Shortcuts registered through DialKit show a badge next to the control (for example "B+Scroll"). That is explanatory chrome, so bind Space (Shuffle) and ⌘S (Export) in app code instead.
- Don't use `color` controls. Use `persist` for the last settings (it writes to `localStorage`) and the URL hash for sharing.
- Sliders as `[50, 0, 100, 1]` for Intensity, Softness and the mood control. DialKit already provides click-to-snap, rubber-band dragging at the ends, and typing a value after hovering.

---

## The 8 most useful lessons

1. **Add light; don't interpolate colors.** Nearly every gradient product interpolates: Paper, Stripe, ShaderGradient's base color, the CSS mesh tools, Haikei, Oklab and OkLCh CSS. The ones that read as light add light in linear values and let highlights go to white: Deep Glow, After Effects glows in 32-bit projects, Photoshop's Light Bokeh, the Windows 10 photograph. Keep this as the engine's base rule. Where the browser draws a gradient (thumbnails), use `in srgb-linear`.
2. **Build light images in passes, then grade once.** GMUNK's Windows 10 image is a base pass, laser passes, haze and smoke passes and flare passes, added and then graded into Microsoft Blue. Contour should work the same way: source, haze, rim, and halation at the source's position, then the tone curve that lands on the pack hexes. Haze is what makes a beam visible.
3. **Hide the recipe; publish a few controls that each move several parameters.** Unicorn Studio binds one variable to many properties and ships named presets; Linear replaced 98 theme variables with three. A Look is a complete named snapshot; Intensity, Softness and the mood control are the only published variables.
4. **Restraint is the brief.** Vercel dropped full-spectrum color as "too loud". Instagram passed over "more minimal options" because it "needed more warmth and energy", and its many warm hues are exactly what the brief rules out. Linear keeps one desaturated blue for backgrounds. Offer no hue controls; keep one warm color and pack order.
5. **A seed is only a control if it is stable.** Every seed must give a usable image. The same seed must give the same composition at all four formats (AUTOMATIC1111's docs say that with the same seed, "when you change resolution, the image changes entirely", and offer "seed resize" to work around it), and later engine versions must not change old seeds (AUTOMATIC1111 keeps a list of seed-breaking changes; Midjourney warns a seed "may no longer work"). Put the seed and an engine version in the file name and the URL, and keep a shuffle history.
6. **Grain goes last, in output pixels, fading in highlights, and never changes color.** Photoshop adds grain back after blurring so blurred areas don't look "artificially smooth" and reduces it in highlights. The CSS grainy-gradient method shifts the colors. Paper's grain scales with the shape, so exports get coarser grain than previews. Check the filter with blurred ΔE.
7. **Define everything relative to the canvas, and test every control at every format.** Figma's shader review asks for every value of every setting at many sizes and aspect ratios; Figma measures radii against the smaller side; Paper fits a world box into the canvas. Short-edge units also let soft passes run at half or quarter resolution in the preview (as Unicorn Studio advises) and still match the 4K export.
8. **In the panel: presets first, amounts second, shuffle always, sizes as fixed choices.** One-click Looks with a preview (Lightroom's hover, the iPhone's swipe), amount sliders with tested ends, one key for Shuffle and one for Export, preset sizes, and settings in the URL (Coolors, Haikei, ray.so, ShaderGradient). With DialKit: inline and `productionEnabled`, replace the Version and Copy toolbar, no color controls, no shortcut badges.

---

## Not found or not verified

- How Apple makes its abstract wallpapers.
- How Six N. Five rendered Bloom (software, lighting, materials).
- A making-of for Pixel wallpapers built from rendered light.
- Unicorn Studio's effect shaders: they ship inside each published scene and are not in the public runtime.
- Haikei's Blurry Gradient method: inferred from its exporter, not read in its generator code.
- Deep Glow's full control list: the product page lists features only.
- Two leads found on Hacker News were not read: MakeGradient (a WebGL gradient tool), whose page shows no text without JavaScript, and an article on mesh gradients with RBF interpolation hosted on Notion.
