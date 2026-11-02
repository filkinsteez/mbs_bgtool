# Twilight sky color: what real skies do, and rules for Sunset

How real sunset and twilight skies are colored and graded, from measurements, turned into numbers and rules for the Sunset recipes. It gives color sequences for five sun positions, rules for the ramp, how pack colors map onto sky roles, and which effect explains each Sunset reference.

The rendering methods these rules feed are in [`../research-techniques.md`](../research-techniques.md) (section 3 has the cheap 2D sky form and the "powers of one warm color" trick). The brief is [`../BRIEF.md`](../BRIEF.md).

Contents:

1. [Conventions](#1-conventions)
2. [Sources and method](#2-sources-and-method)
3. [What the measurements say](#3-what-the-measurements-say)
4. [Color sequences, zenith to horizon](#4-color-sequences-zenith-to-horizon)
5. [Rules for our ramp](#5-rules-for-our-ramp)
6. [Driving it with pack colors](#6-driving-it-with-pack-colors)
7. [Which effect explains which reference](#7-which-effect-explains-which-reference)
8. [The 8 most useful facts](#8-the-8-most-useful-facts)
9. [Sources](#9-sources)
10. [Appendix: the model](#10-appendix-the-model)

---

## 1. Conventions

- **Elevation `e`**: degrees above the horizon. 0° is the horizon, 90° the zenith.
- **Sun elevation `h0`**: degrees; negative means below the horizon. Depression `δ = −h0`. Civil twilight runs from 0° to −6°, nautical twilight from −6° to −12°. Civil twilight lasts about 35 minutes at mid-latitudes ([Lee 2015](#src-lee2015)).
- **Azimuth `φ`**: degrees from the sun's azimuth. 0° faces the sun, 180° faces away.
- **Linear RGB**: linear sRGB with a D65 white, which is roughly a camera on fixed daylight white balance.
- **Exposed for the glow**: scaled so the brightest sky more than 8° from the sun has its largest channel at 1.0. Values above 1 are brighter than that and go to white through the tone curve.
- **Oklab L, C, h**: lightness, chroma, hue angle in degrees. For scale, Meta Blue `#0064E0` is L 0.533, C 0.205, h 259.
- **AOD**: aerosol optical depth at 550 nm, i.e. how hazy the air is. 0.02 to 0.05 is very clear, about 0.1 an ordinary clear day, 0.3 hazy.
- **Auto white balance (AWB)**: the channels are scaled so the average of a sun-side frame (0° to 40° up, ±25° wide) comes out neutral. This is the classic gray-world method ([Buchsbaum 1980](#src-buchsbaum1980)) and approximates what phone cameras do.
- **Positions in a frame** are measured down from the top as a fraction of the frame height, the same convention as the reference profiles in [`docs/references/awe/profiles/`](../../references/awe/profiles/). Two frames are used. A whole-sky frame spans 0° to 90°. A normal photo frame has the horizon at the bottom and its top 40° up. Rows above 40° are marked "above" for the photo frame.

---

## 2. Sources and method

The primary sources are listed in [section 9](#9-sources). The core is Raymond L. Lee Jr.'s measurement papers on twilight colors, the purple light, the Belt of Venus, ozone and haze. Full texts came from Lee's own copies on his archived US Naval Academy pages. Hernández-Andrés, Lee and Romero cover sky color asymmetry and color temperature, [Hulburt 1953](#src-hulburt1953) covers ozone, and [Saito et al. 2013](#src-saito2013) cover haze and twilight photos. [Patat et al. 2006](#src-patat2006) give twilight zenith brightness and [Spitschan et al. 2016](#src-spitschan2016) twilight ambient light. [Zerefos et al. 2007](#src-zerefos2007) and [Volz 1969](#src-volz1969) cover volcanic sunsets. Several older modeling papers were read through their abstracts only, and these are marked in the list.

Measurements give positions, timing and brightness at a few points, and they report color as chromaticity (u′v′) or color temperature (CCT), not RGB. To get full zenith-to-horizon sequences in linear RGB and Oklab, I wrote a small spectral twilight model and checked it against the measurements. The sequences in [section 4](#4-color-sequences-zenith-to-horizon) come from it.

The model has a round Earth, an observer at sea level, and air up to 100 km. It includes Rayleigh scattering, low haze (scale height 1.2 km), a thin background stratospheric aerosol layer at 20 km, and 300 Dobson units of ozone with its measured visible absorption (the Chappuis band). Sunlight is the measured spectrum above the atmosphere, sampled at 41 wavelengths. Sunlight is scattered once, with exact Earth shadowing and attenuation, and multiple scattering is added with [Hillaire's (2020)](#src-hillaire2020) approximation. The spectra are converted to color with the CIE 1931 color matching functions. There is no refraction. Details are in the [appendix](#10-appendix-the-model).

| Check | Measured | Model (AOD 0.04 / 0.1) |
| --- | --- | --- |
| Zenith luminance, sun −4.5° | 1 to 2 cd/m² ([Lee 2011](#src-lee2011)) | 4.9 / 4.9 cd/m² |
| Zenith luminance, sun −5° | V = 11.84 mag/arcsec², about 2 cd/m², at 2.6 km altitude; sea-level sites run about 30% brighter ([Patat 2006](#src-patat2006)) | 2.8 / 2.8 cd/m² |
| Zenith dimming from sun +4.5° to −5.2° | more than 100× ([Lee 2011](#src-lee2011)) | 234× / 251× |
| Zenith dimming rate near −5° | about 1.5 magnitudes (4×) per degree ([Patat 2006](#src-patat2006)) | 3.3× per degree from −5° to −6° |
| Zenith color, sun −5.2° | bluer than infinite CCT, measured with a spectroradiometer ([Lee 2011](#src-lee2011)) | bluer than infinite CCT from −5° on |
| Purple light, 20° up toward the sun | starts at −1.4°, purest at −3.9° (mean of 35 evenings, [Lee 2003](#src-lee2003)) | starts at −1.5°, purest at −4.0° |
| Belt of Venus, reddest elevation | 6.1° at sun −1.56°, 11.0° to 11.3° at −2.78° (Monte Carlo, [Lee & Mollner 2017](#src-lee2017)); 14.2° at −3.87° (measured, [Lee 2015](#src-lee2015)) | 6° at −1.56°, 10° at −2.78°; gone by −3.9° |
| Brightness opposite the sun, 0° to 30° up, sun −2.78° | 35 to 85 cd/m² ([Lee 2015](#src-lee2015)) | 26 to 59 cd/m² |
| Sun-side glow, sun −2° | peak 1.7° up, half brightness from 0.2° to 5.1° (one post-Pinatubo evening, [Lee 1994b](#src-lee1994b)) | peak 5.25°, half brightness from 1.75° to 15° |

Zenith brightness at −5°, zenith color, purple light timing, Belt of Venus height and brightness opposite the sun all match within about 30% or 1°. Lee's rough figure of 1 to 2 cd/m² at −4.5° is 2.5 to 5 times below the model, so the model's zenith may run somewhat bright late in civil twilight. There are two other known differences. The model's Belt of Venus fades about 1° of sun depression early; real twilight runs slightly behind the model because refraction lets sunlight reach a little farther into the shadow. The model's sun-side glow also sits about 3° higher than Lee's one measured arch. Its shape is the same, though: the top of the half-brightness band is at about 3× the peak elevation in both. Glow height depends strongly on haze ([section 3.2](#32-the-sun-side-the-glow)), so treat the glow heights below as typical values, not exact ones.

I also looked at the model's renders as camera views next to the references. Sun-side views at 0° to −4° show the familiar sunset structure: an orange band on the horizon, a peach or cream glow, a pale bridge and a darker sky. Views facing away from the sun at −2° show the blue-grey Earth's shadow with the pink Belt of Venus above it. Haze and post-volcanic runs behave as the papers describe.

---

## 3. What the measurements say

### 3.1 Color follows brightness

- **Clear-sky color is low in purity.** The daytime sky's spectrum is "a metameric match to unsaturated blue light" ([Smith 2005](#src-smith2005)). Lee gives a theoretical upper limit of about 42% purity for clear skylight without selective absorption, and measured 3% to 23% within 15° of the horizon in daytime ([Lee 1994b](#src-lee1994b)).
- **Twilight widens the range of colors.** Lee's normalized color gamut was 0.013 to 0.083 for five daytime skies and 0.131 to 0.172 for two twilights ([Lee 1994b](#src-lee1994b)).
- **Color and brightness change together.** In Lee's scans up the sky, the bends in the color curve coincide with brightness maxima. The clear sky is least saturated a little above the horizon, where it is brightest, not at the horizon itself. In his words, "we cannot divorce luminance changes from chromaticity changes" ([Lee 1994b](#src-lee1994b)).
- **Real skies are lopsided.** On most clear days, color and brightness differ visibly between directions mirrored about the sun's azimuth. The difference grows at twilight because long sunlight paths amplify uneven haze. The mean luminance difference between mirrored directions was 13.5% with the sun at −2.1°, against 8.6% with the sun at 60° ([Hernández-Andrés et al. 2003](#src-hernandez2003)).
- **Sky colors do not follow the blackbody curve.** Color paths up the twilight sky vary a lot from day to day and are often S-shaped or hooked ([Lee 1994b](#src-lee1994b)). The same paper has a perceptual caveat: naked-eye color estimates of twilight overstate purity, reaching an "unrealistically high" 80% at the zenith in an earlier study.

### 3.2 The sun side: the glow

The glow is also called the bright segment or twilight arch.

- **The brightest sky is a few degrees above the horizon, not at it.** In daytime there is a brightness maximum 1.5° to 8° above the horizon. It sits higher and wider when the sun is low or the air hazy: 2.1° with the sun at 27° in very clear air, 8.3° with the sun at 4° ([Lee 1994a](#src-lee1994a)). Looking lower means looking through more air that scatters light toward you, until the dimming of sunlight along those low paths wins.
- **At twilight the glow is sharper.** With the sun 2° below the horizon (post-Pinatubo), Lee measured a "yellow twilight arch" peaking 1.7° up. It fell to half brightness at 0.2° and 5.1°, "a much more sharply defined feature" than the daytime maximum ([Lee 1994b](#src-lee1994b)).
- **Clean air versus haze, in photos.** [Saito et al. 2013](#src-saito2013) photographed twilight at sun elevations from 0° to −6°. In clean air (AOD below 0.06) the bottom 0° to 7° "reddened and gradated from red to grayish-blue with increasing" elevation, and that band got thinner as the sun sank. With AOD above 0.1 the sky near the horizon was darker and bluer: a dull bluish band 3° to 5° tall formed under the glow, and the brightest elevation moved up (2° to 15° in their simulations).
- **Vivid sun-side colors need some haze, but not much.** A little aerosol makes the sun side redder. More makes it paler and spreads the glow: "the bright glow has its largest vertical extent although its lower edge is dull-looking and desaturated" ([Lee & Mollner 2017](#src-lee2017)).
- **Model numbers.** The glow peak sits 4° to 5° up in clean air, about 7° in typical air and 11° to 13° in hazy air, with the sun between 0° and −4°. By −6° it drops to 2.75° (clean) or 4° (typical). The half-brightness band runs from about 0.3× to 3× the peak elevation. The horizon line itself is 0.1 to 0.4 of the peak brightness, darker and redder than the glow just above it. The exception is clean air with the sun still up, where the horizon is as bright as the glow.
- **Color up the glow.** The lowest band (0.5° to 1° up) is the most saturated: orange-red, Oklab C 0.15 to 0.19. The hue moves to yellow-orange at the peak (h 60 to 68), and chroma falls inside and above the peak. All the warm colors come from one source, sunlight, which is redder where its path through the air is longer.
- **Sideways.** The glow is centered on the sun's azimuth. In the model, at 2° to 5° up it falls to half brightness about 29° to each side; at 10° up about 32°, and at 20° up about 50°. Moving away from the sun's azimuth, its hue turns from yellow-orange to orange-red at 90° and pink toward the anti-sun side.
- **One reddish ring.** The reddest band of the twilight sky is one ring around the horizon. It touches the horizon at the sun's azimuth and is highest opposite the sun, at an elevation `h_max`, following `h = h_max · sin(φ/2)`. `h_max` grows as the sun sinks and as haze increases ([Lee & Mollner 2017](#src-lee2017); [Lee 2015](#src-lee2015) shows the ring in a fisheye photo).

### 3.3 The zenith and ozone

- **The zenith is the darkest part of the sun's vertical at twilight** ([Lee & Mollner 2017](#src-lee2017), luminance along the sun's vertical).
- **It dims fastest.** In the model it falls from 157 cd/m² at sunset to 50 at −2°, 8.6 at −4° and 0.84 at −6°, which matches [Lee 2011](#src-lee2011) and [Patat 2006](#src-patat2006). The glow dims more slowly, so the glow-to-zenith ratio grows from about 17× (4.1 stops) at sunset to about 80× (6.4 stops) at −6° in clean air.
- **It stays blue because of ozone.** Hulburt: "in the absence of ozone the zenith sky would be a grayish green-blue at sunset becoming yellowish in twilight, but with ozone the zenith sky is blue at sunset and throughout twilight" ([Hulburt 1953](#src-hulburt1953)). Ozone's Chappuis band absorbs most near 575 to 600 nm. During twilight, the sunlight that lights the air overhead has crossed the ozone layer on a long, nearly horizontal path. Its yellow and orange are removed, so the zenith gets bluer than plain scattering can make it. Lee's spectroradiometer measured zenith colors at sun −5.2° "with nearly all of them lying beyond infinite CCT" ([Lee 2011](#src-lee2011)). Spectra opposite the sun, in the shadow, the belt and the sky above, all show the ozone dip near 600 nm ([Lee 2015](#src-lee2015)).
- **Model check.** With ozone removed, the zenith from sunset to −6° comes out a neutral grey (6,200 to 6,950 K, chroma under 0.01), and the sky 30° up on the sun side turns yellowish (h 57 to 75). With 300 Dobson units it is blue (13,400 K at sunset, bluer than infinite CCT by −5°), and 30° up on the sun side turns lavender-purple (h 283 to 301). In daytime (sun at 10°) ozone hardly matters; the zenith is blue either way.
- **Haze pushes the zenith toward purple.** Aerosols redden the sunlight that lights the air overhead. Lee found aerosol "at least as significant" as ozone for zenith color, and on an evening with a vivid purple light the zenith looked "distinctly lavender or purplish" at −3° ([Lee 2011](#src-lee2011)).
- **The eye stops seeing color at the zenith around −4.5°**, when it is 1 to 2 cd/m² ([Lee 2011](#src-lee2011)). Cameras still record it.
- **The light falling on the ground also gets bluer** through civil and nautical twilight. At a dark rural site it was bluest near −12° ([Spitschan et al. 2016](#src-spitschan2016)). This is the "blue hour".

### 3.4 The purple light

From [Lee & Hernández-Andrés 2003](#src-lee2003), who measured 100 twilights, 35 of them with a distinct purple light:

- **Timing** (sun elevation, mean of 35): it starts at −1.4° (range −0.2° to −3.3°), is purest at −3.9° (range −1.4° to −4.7°, standard deviation 0.7°) and ends at −7.4°. Before it, the sky tens of degrees up reddens until the sun is 1° to 2° up, then turns bluer until a few minutes after sunset.
- **Where**: "a broad, vaguely eyelid-shaped region centered on the Sun's azimuth". They measured at 20° up. It is 90° to 150° wide, sometimes covers the whole sky, and can include the zenith. Older descriptions start it as a 10° to 15° spot about 25° up.
- **Color**: "a proper purple". Its spectrum has less energy in yellow and yellow-green than in red, orange and blue: two broad peaks at the two ends of the spectrum. It is blue skylight plus reddened sunlight. That sunlight has crossed the lower atmosphere beyond the horizon and is scattered down by the stratosphere above the observer.
- **What controls it**: the air beyond the sunset horizon. A hazy lower atmosphere (visibility 5 km) makes it redder and as vivid as post-volcanic purples. Clouds anywhere along the sun's azimuth, even hundreds of kilometers away, remove it. Crepuscular rays show as alternating pink-purple and blue bands across the sky.
- **It is not a brightening.** Sky brightness keeps falling smoothly through it; older texts used "intensity" to mean purity.
- **Perception**: "the temporal chromaticity curve's shape matters more than chromaticity values per se". A small shift toward purple relative to its neighbors reads as purple.
- **Second purple light** (around −7.4°): too dim to see, except after volcanic eruptions. [Volz 1969](#src-volz1969) measured a strong one after the Agung eruption.
- **Model**: at −4° the purple zone (Oklab h 285 to 360, C above 0.015) runs from 16° to 42° up in clean air and 17° to 40° in typical air, with C 0.026 to 0.034. At −2° it covers 19.5° to 26°; at −6° only a trace remains at 9° to 12°. Sideways it fades to blue-violet 45° to 60° from the sun's azimuth. With post-volcanic stratospheric aerosol (AOD 0.1) it spreads over 15° to 50°: rose at 15° to 20° (`#A45C53`, C 0.10), wine and purple above (`#68444E` at 25°, `#3F3142` at 40°).

### 3.5 Opposite the sun: the Earth's shadow and the Belt of Venus

From [Lee 2015](#src-lee2015) (hyperspectral scans of 12 twilights), [Lee & Mollner 2017](#src-lee2017), and [Lynch et al. 2017](#src-lynch2017) (abstract):

- **What they are.** The dark segment, or Earth's shadow, is a bluish-grey band on the horizon opposite the sun. The antitwilight arch, or Belt of Venus, is the reddish band just above it.
- **Where they sit.** Both rise as the sun sinks. Because of extinction, the shadow's edge sits higher than both the geometric shadow and the sun's depression angle, and it can be seen when the sun is still about 0.5° above a level horizon. Lynch et al. single out "the rapid rising of the Belt of Venus with solar altitude".
  - Reddest elevation of the belt: 5.1° to 7.8° with the sun at −1.56° (higher with more haze), and about 11° at −2.78° ([Lee & Mollner 2017](#src-lee2017)).
  - [Lee 2015](#src-lee2015) measured the belt at 14.2° with the sun at −3.87°, with the bluest part of the shadow at 5.9°.
  - Rule of thumb: the bluest part of the shadow is at about 1.5 × the sun's depression, the edge between shadow and belt at about 2.5 ×, and the belt's reddest point at about 4 ×.
- **When they fade.** Color and brightness contrast fall as the sun sinks, and the belt's color turns bluer. In one time-lapse the belt disappeared at −4.7°.
- **Colors.** "Color differences between the dark segment and the sunlit sky above the antitwilight arch are small or nil." The shadow is the same blue as the sky above the belt, only darker; its "apparently distinctive blue is a perceptual artifact likely caused by its much lower luminance". The belt's spectrum has just a little more energy above 630 nm than the sky around it.
- **The belt is seen by color, not brightness.** Its brightness peak sits higher than its color: at 21° when the reddest point is at 14.2°.
- **Haze.** The belt is a "Goldilocks phenomenon". Too little aerosol gives pastel reds or even yellows; too much hides it. It was most vivid at AOD(440 nm) of 0.02 to 0.05 ([Lee 2015](#src-lee2015)). The purest colors opposite the sun would occur in air with no aerosol at all, and from an airplane above the haze the belt is much more vivid ([Lee & Mollner 2017](#src-lee2017)).
- **A second, dim band.** A "lower antitwilight arch" can appear inside the shadow near −4°, 2° to 3° up ([Lee 2015](#src-lee2015)).
- **The edge is soft.** Lee's simpler scattering model made the change from sunlit to shaded sky "too rapid"; scattering from all over the sky smooths it ([Lee 2015](#src-lee2015)). In our model at −2°, the change from shadow to belt spans about 4° (bluest at 2° to 3°, reddest at 6° to 7°).
- **Brightness.** The shadow is about 2.4× darker than the sky above the belt (model at −2°). Lee's measured profile at −2.78° spans roughly 35 to 85 cd/m² from the horizon to 30° up.

### 3.6 Haze, aerosols and volcanic dust

- **Plain air gives yellow-orange sunsets; normal haze gives orange-red.** A single-scattering model with no aerosol makes only yellowish-orange sunset skies; adding normal low-level aerosol makes them orangish-red ([Adams et al. 1974](#src-adams1974), as summarized by [Lee & Mollner 2017](#src-lee2017)).
- **Too much haze removes the red band.** The reddish light scattered once near the horizon is blocked, bluish light scattered many times takes over, and the horizon goes darker and bluer ([Saito et al. 2013](#src-saito2013)).
- **More haze lifts and widens the glow** ([Lee 1994a](#src-lee1994a); [Saito et al. 2013](#src-saito2013); model, [section 4.3](#43-brightness-range-and-glow-shape-for-three-haze-levels)).
- **The brightest sun-side glow and the most vivid belt occur at low but nonzero haze** ([Lee & Mollner 2017](#src-lee2017)).
- **Haze lowers the brightness range.** In the model at sunset the glow-to-zenith ratio is 17× in clean air, 11× in typical air and 4.5× in hazy air.
- **Haze pales the blue** and lowers the contrast of distant objects ([Lee 2015b](#src-lee2015b)).
- **Haze strengthens the purple light** when it is in the lower atmosphere beyond the horizon ([Lee 2003](#src-lee2003)).
- **Volcanic aerosol in the stratosphere makes twilights vivid.**
  - Post-eruption twilights are "extraordinarily vivid, often purplish" ([Lee 2003](#src-lee2003)).
  - After the 1963 Agung eruption, the red/green ratio 20° up toward the sun rose strongly between 1° and 4.5° of sun depression. The dust peaked near 20 km, and a strong second purple light appeared beyond 6° ([Volz 1969](#src-volz1969)).
  - Six months after Pinatubo, Lee measured an "unusually vivid" twilight, the only one in that study with both a wide color range and high purity ([Lee 1994b](#src-lee1994b)).
  - Sunsets painted after major eruptions have higher red/green ratios (r = 0.8 against the dust veil index). The inferred AOD runs from 0.05 in normal years to about 0.6 after Tambora and Krakatau ([Zerefos et al. 2007](#src-zerefos2007)).
- **Model, stratospheric AOD 0.1.**
  - The horizon band at −6° turns a deep, saturated red (`#FF4F15`, C 0.22, close to Orange-red).
  - The purple light at −4° widens to 15° to 50° up: rose with C up to 0.10 at the bottom, wine and purple above.
  - The whole sky is about half as bright, and the Belt of Venus disappears.

### 3.7 Why the bridge between blue and warm is pale, not mud

- **Light adds.** On the sun side, the sky's light is the sum of blue skylight scattered from high up, ozone-filtered, and reddened sunlight scattered low down. Where the two overlap in similar amounts, the sum is near white. Blue light plus orange light is neutral, not grey-brown, because both are bright.
- **The overlap sits on the glow's bright slope.** Brightness rises steadily from the zenith (darkest) to the glow peak (brightest). The bridge is therefore always lighter than the blue above it and darker than the glow below it, never darker than both.
- **The palest point sits where the hue changes.** The sky is least saturated near its brightness maximum ([Lee 1994b](#src-lee1994b)). Along the sun's vertical, chroma has one minimum, at the change from warm to cool hues.
- **Model numbers, clean air, sun 0°:**

  | Elevation | Color | Oklab L | Oklab C |
  | --- | --- | --- | --- |
  | 30° | `#656470` | 0.51 | 0.019 |
  | 20° (bridge) | `#8A8184` | 0.61 | 0.012 |
  | 15° | `#A99690` | 0.69 | |
  | 6° (glow) | `#FFBE83` | 0.85 | |

  At −2° the bridge, 16° to 20° up, is `#A49A9B` to `#87838D`: L 0.62 to 0.70, C 0.012 to 0.015.
- **The bridge's hue varies; its chroma stays low.**
  - In clean air with the sun up it is a warm grey.
  - Once the sun is below the horizon it leans lavender-pink: ozone removes the yellow-green between the two sources, and reddened light is added to the blue (the purple light).
  - Through a camera on auto white balance it can lean pale cyan or green-grey (`#C3CFC9`, h 165, in the model).
  - Its chroma stays low in every case: 0.02 or less at daylight white balance, 0.06 or less under auto white balance.
- **Near the horizon the sky is whiter.** Long paths make every wavelength's scattered light approach the color of the light doing the lighting ([Bohren & Fraser 1985](#src-bohren1985)).

### 3.8 Brightness range

- The glow is 3.5 to 6.4 stops brighter than the zenith in clean and typical air, and 2.1 to 2.8 stops in hazy air (table in [section 4.3](#43-brightness-range-and-glow-shape-for-three-haze-levels)).
- **The sun itself** at 2° elevation, seen through about 19 air masses, is roughly 10⁵ times as bright as the zenith (about 17 stops). This estimate uses a luminance of 1.6×10⁹ cd/m² for the sun above the atmosphere and a transmittance of about 0.04.
- **The aureole** within a few degrees of the sun is much brighter than the glow. The model underestimates it, because its haze scattering pattern is too flat near the sun's direction.
- [Lee & Mollner 2017](#src-lee2017) displayed twilight brightness as its square root because "twilight's overall luminance dynamic range far exceeds that of most computer displays".

### 3.9 What cameras do

- **Exposure.** Sunset photos are exposed for the glow or the sun, so the zenith comes out 3 to 6 stops darker in clear air. That is why the upper sky in photos looks deep, and why most of our references darken toward the top or the edges.
- **Overexposure near the sun.** Sensor channels clip one at a time, which causes color errors ([Zhang & Brainard 2004](#src-zhang2004)). Warm light clips red first, so orange turns yellow and then white.
  - Example, in the model at sun 0° and two stops brighter than "exposed for the glow": the orange band 1° up (linear 1.07, 0.21, 0.02) becomes yellow `#FFEC55`, and the glow 6° up (1.00, 0.52, 0.23) becomes cream-white `#FFFFF4`.
  - This is the pale yellow-cream band that sits on the glow in many photos. darktable's documentation names the same effect, "yellow sunsets", for per-channel tone mapping ([`research-techniques.md`](../research-techniques.md), section 1). Our tone curve takes orange through peach to white instead. That difference is a choice to make on purpose.
- **White balance.**
  - Fixed daylight balance (5,200 to 5,500 K, as Saito et al. used) keeps the sky close to the D65 values in [section 4](#4-color-sequences-zenith-to-horizon).
  - Auto white balance neutralizes the warm average of a sunset frame. In the model, the upper sky goes from grey-lavender (C 0.01 to 0.03) to a clear blue (C 0.06 to 0.12, h 255 to 264). The glow goes from orange-yellow (h 60 to 68) to yellow-cream or khaki (h 85 to 115, lower chroma). The low sky just above the glow goes pale cyan or green-grey (h 165 to 245). See the auto white balance column in section 4.
- **Saturation.** Phone and film pipelines add saturation with S-shaped tone curves. Lee notes that slide film saturation could compress color ranges at the highest purities ([Lee 1994b](#src-lee1994b)).
- **The references show all three effects**: dark tops, pale clipped glows, and blues and cyans much more saturated than the real sky.

### 3.10 What changes where, from sunset to nautical twilight

Measurements, with model numbers where the papers give none.

| Part of the sky | Sunset (sun +2° to 0°) | Civil twilight (0° to −6°) | Nautical twilight (−6° to −12°) |
| --- | --- | --- | --- |
| Zenith | grey-blue, about 13,000 K; 160 to 320 cd/m² | dims about 190×, faster than any other part; bluer than infinite CCT by −5° because of ozone; lavender with haze or a strong purple light; the eye loses its color near −4.5° | keeps dimming, about 4× per degree at first; too dark for the eye to see color; cameras still record deep blue |
| Mid-sky, sun side (15° to 40°) | warm grey at the bottom, a near-neutral bridge, lavender-grey above | the purple light, from −1.5° to −6°, strongest at −4°, 15° to 40° up; then blue again | blue-grey; a second purple light near −7.4°, too dim to see except after eruptions |
| Horizon, sun side | glow peak 4° to 7° up, yellow-cream; orange-red band 0.5° to 3° | the glow lowers to about 3° and narrows; its color deepens from yellow to orange-red | a thin arch on the horizon that keeps shrinking (Neuberger defines the twilight arch at 7° to 16° of depression, per [Lee 1994b](#src-lee1994b)) |
| Horizon, opposite the sun | a warm low band; the Earth's shadow appears at about +0.5° | the shadow rises (bluest at 1.5 × the depression) with the Belt of Venus above it (about 4 ×); the belt fades by −4° to −5°; a dim lower arch can appear near −4° | dark |
| Ground light (horizontal) | warm | turns bluer | bluest near −12° at a dark site ([Spitschan et al. 2016](#src-spitschan2016)) |

---

## 4. Color sequences, zenith to horizon

These come from the model in clean air (AOD 0.04), along the sun's vertical (φ = 0°). Each row gives:

- the elevation;
- the position down from the top, for the whole-sky frame and the 40° photo frame;
- linear RGB, exposed for the glow;
- Oklab of that color;
- a hex for a quick look;
- the same color under auto white balance (hex, chroma, hue);
- a label.

Use the tables for relations: the order of colors, relative lightness, the hue path and positions. Don't treat them as exact colors. Real skies vary a lot from day to day ([Lee 1994b](#src-lee1994b), [Lee 2003](#src-lee2003)). Values above 1 are brighter than the exposure and go to white.

### 4.1 Sun side

#### Sun +2°, just above the horizon

| Elev. | From top, 0–90° sky | From top, 0–40° frame | Linear RGB | Oklab L, C, h | Hex | Auto white balance: hex, C, h | What it is |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 90 | 0.00 | above | 0.015, 0.020, 0.032 | 0.270, 0.023, 262 | `#202732` | `#172A52` 0.077, 263 | zenith |
| 60 | 0.33 | above | 0.023, 0.029, 0.043 | 0.307, 0.021, 264 | `#2A303B` | `#1F345F` 0.081, 263 | upper sky |
| 40 | 0.56 | 0.00 | 0.047, 0.051, 0.066 | 0.372, 0.015, 272 | `#3D4049` | `#2E4574` 0.084, 263 | upper sky |
| 30 | 0.67 | 0.25 | 0.082, 0.079, 0.088 | 0.432, 0.008, 303 | `#514F54` | `#3E5685` 0.083, 263 | bridge, near neutral |
| 20 | 0.78 | 0.50 | 0.179, 0.143, 0.125 | 0.532, 0.018, 51 | `#756A63` | `#5B729C` 0.071, 263 | warm grey-beige |
| 15 | 0.83 | 0.63 | 0.291, 0.209, 0.150 | 0.607, 0.037, 63 | `#937E6C` | `#7387A9` 0.056, 260 | pale peach |
| 10 | 0.89 | 0.75 | 0.498, 0.312, 0.165 | 0.702, 0.068, 69 | `#BB9871` | `#93A3B0` 0.026, 245 | cream-peach glow |
| 6 | 0.93 | 0.85 | 0.788, 0.415, 0.137 | 0.785, 0.109, 70 | `#E6AD67` | `#B5B9A2` 0.032, 115 | yellow glow |
| 3 | 0.97 | 0.93 | 1.122, 0.466, 0.071 | 0.841, 0.155, 68 | `#FFB64B` | `#D4C378` 0.097, 97 | aureole near the sun, overexposed |
| 1 | 0.99 | 0.97 | 1.333, 0.423, 0.022 | 0.850, 0.185, 62 | `#FFAE29` | `#E5BB45` 0.140, 88 | aureole, gold |
| 0.5 | 0.99 | 0.99 | 1.314, 0.384, 0.015 | 0.835, 0.189, 60 | `#FFA720` | `#E4B337` 0.144, 86 | horizon at the sun |

#### Sun 0°, at the horizon

| Elev. | From top, 0–90° sky | From top, 0–40° frame | Linear RGB | Oklab L, C, h | Hex | Auto white balance: hex, C, h | What it is |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 90 | 0.00 | above | 0.028, 0.036, 0.058 | 0.330, 0.029, 268 | `#2F3544` | `#233A5B` 0.066, 258 | zenith |
| 60 | 0.33 | above | 0.043, 0.051, 0.078 | 0.371, 0.028, 270 | `#3A404F` | `#2C4569` 0.069, 258 | upper sky |
| 40 | 0.56 | 0.00 | 0.080, 0.087, 0.121 | 0.445, 0.024, 275 | `#505362` | `#3E5A81` 0.072, 256 | upper sky |
| 30 | 0.67 | 0.25 | 0.129, 0.128, 0.163 | 0.509, 0.019, 287 | `#656470` | `#4E6D93` 0.071, 255 | lavender-grey |
| 20 | 0.78 | 0.50 | 0.254, 0.219, 0.232 | 0.612, 0.012, 352 | `#8A8184` | `#6D8BAD` 0.062, 252 | bridge, near neutral |
| 15 | 0.83 | 0.63 | 0.395, 0.305, 0.277 | 0.688, 0.024, 40 | `#A99690` | `#85A2BC` 0.050, 246 | pale pink-beige |
| 10 | 0.89 | 0.75 | 0.655, 0.430, 0.299 | 0.780, 0.056, 58 | `#D3AF95` | `#A8BDC2` 0.024, 214 | pale peach |
| 6 | 0.93 | 0.85 | 0.999, 0.515, 0.226 | 0.848, 0.106, 63 | `#FFBE83` | `#CBCDAB` 0.045, 110 | cream-yellow glow, brightest |
| 3 | 0.97 | 0.93 | 1.254, 0.431, 0.083 | 0.846, 0.163, 59 | `#FFAF51` | `#E1BD6C` 0.108, 86 | gold, near the sun |
| 1 | 0.99 | 0.97 | 1.071, 0.210, 0.023 | 0.742, 0.188, 47 | `#FF7E2A` | `#D1893A` 0.128, 65 | orange |
| 0.5 | 0.99 | 0.99 | 0.866, 0.142, 0.025 | 0.678, 0.181, 42 | `#EF692B` | `#BF723B` 0.119, 54 | orange-red horizon band |

#### Sun −2°

| Elev. | From top, 0–90° sky | From top, 0–40° frame | Linear RGB | Oklab L, C, h | Hex | Auto white balance: hex, C, h | What it is |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 90 | 0.00 | above | 0.029, 0.034, 0.061 | 0.327, 0.033, 275 | `#2F3446` | `#263754` 0.057, 262 | zenith |
| 60 | 0.33 | above | 0.043, 0.049, 0.083 | 0.370, 0.033, 275 | `#3A3E51` | `#304262` 0.059, 261 | upper sky |
| 40 | 0.56 | 0.00 | 0.080, 0.086, 0.131 | 0.446, 0.031, 278 | `#505365` | `#425779` 0.062, 260 | upper sky |
| 30 | 0.67 | 0.25 | 0.127, 0.129, 0.179 | 0.511, 0.026, 283 | `#646575` | `#536A8C` 0.061, 258 | lavender-grey |
| 20 | 0.78 | 0.50 | 0.243, 0.227, 0.265 | 0.617, 0.015, 305 | `#87838D` | `#718AA8` 0.053, 254 | lavender bridge, purple light starting |
| 15 | 0.83 | 0.63 | 0.372, 0.324, 0.329 | 0.696, 0.012, 10 | `#A49A9B` | `#8AA2B9` 0.043, 247 | pale warm grey |
| 10 | 0.89 | 0.75 | 0.618, 0.477, 0.382 | 0.796, 0.035, 60 | `#CEB8A6` | `#AEC1C5` 0.022, 214 | pale peach |
| 6 | 0.93 | 0.85 | 0.936, 0.588, 0.317 | 0.867, 0.082, 68 | `#F8CA99` | `#D2D4B5` 0.041, 110 | cream glow, brightest |
| 3 | 0.97 | 0.93 | 1.034, 0.445, 0.123 | 0.826, 0.135, 64 | `#FFB262` | `#DBBB76` 0.095, 85 | yellow-orange |
| 1 | 0.99 | 0.97 | 0.528, 0.135, 0.043 | 0.608, 0.129, 46 | `#C0673A` | `#A26C47` 0.087, 55 | orange |
| 0.5 | 0.99 | 0.99 | 0.316, 0.077, 0.043 | 0.511, 0.104, 36 | `#984E3A` | `#805347` 0.065, 35 | rust-red horizon band |

#### Sun −4°

| Elev. | From top, 0–90° sky | From top, 0–40° frame | Linear RGB | Oklab L, C, h | Hex | Auto white balance: hex, C, h | What it is |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 90 | 0.00 | above | 0.011, 0.013, 0.028 | 0.242, 0.032, 276 | `#1B1E2F` | `#132240` 0.061, 262 | zenith |
| 60 | 0.33 | above | 0.018, 0.020, 0.040 | 0.277, 0.033, 279 | `#252738` | `#1A2B4C` 0.065, 262 | upper sky |
| 40 | 0.56 | 0.00 | 0.038, 0.036, 0.065 | 0.340, 0.032, 287 | `#373648` | `#283B60` 0.069, 263 | dusky blue-violet |
| 30 | 0.67 | 0.25 | 0.067, 0.057, 0.089 | 0.396, 0.029, 301 | `#494354` | `#374A70` 0.068, 263 | purple light |
| 20 | 0.78 | 0.50 | 0.150, 0.105, 0.130 | 0.492, 0.026, 342 | `#6C5B65` | `#526486` 0.058, 263 | purple light, mauve |
| 15 | 0.83 | 0.63 | 0.256, 0.161, 0.163 | 0.570, 0.034, 17 | `#8A7070` | `#6B7A94` 0.044, 260 | dusty rose |
| 10 | 0.89 | 0.75 | 0.483, 0.271, 0.202 | 0.683, 0.058, 44 | `#B98E7C` | `#8F9BA3` 0.018, 235 | dusty peach |
| 6 | 0.93 | 0.85 | 0.825, 0.405, 0.198 | 0.789, 0.098, 57 | `#EAAA7B` | `#B7BAA2` 0.034, 114 | peach-orange glow |
| 3 | 0.97 | 0.93 | 1.008, 0.370, 0.087 | 0.796, 0.145, 59 | `#FFA453` | `#C8B36E` 0.091, 93 | orange, brightest |
| 1 | 0.99 | 0.97 | 0.497, 0.105, 0.018 | 0.580, 0.140, 47 | `#BB5B24` | `#916432` 0.088, 67 | burnt orange |
| 0.5 | 0.99 | 0.99 | 0.267, 0.050, 0.019 | 0.466, 0.113, 38 | `#8D3F26` | `#6D4534` 0.061, 44 | deep rust horizon band |

#### Sun −6°, end of civil twilight

| Elev. | From top, 0–90° sky | From top, 0–40° frame | Linear RGB | Oklab L, C, h | Hex | Auto white balance: hex, C, h | What it is |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 90 | 0.00 | above | 0.003, 0.004, 0.011 | 0.168, 0.028, 270 | `#0A0E1B` | `#051228` 0.050, 259 | zenith |
| 60 | 0.33 | above | 0.005, 0.007, 0.016 | 0.195, 0.030, 270 | `#0F1422` | `#081932` 0.055, 258 | upper sky |
| 40 | 0.56 | 0.00 | 0.010, 0.014, 0.029 | 0.242, 0.033, 269 | `#191F2F` | `#0F2543` 0.063, 257 | upper sky |
| 30 | 0.67 | 0.25 | 0.016, 0.022, 0.043 | 0.282, 0.034, 268 | `#22293A` | `#163052` 0.069, 255 | upper sky |
| 20 | 0.78 | 0.50 | 0.032, 0.041, 0.071 | 0.347, 0.033, 268 | `#32394B` | `#214368` 0.075, 253 | blue |
| 15 | 0.83 | 0.63 | 0.053, 0.062, 0.095 | 0.398, 0.028, 271 | `#414757` | `#2D5277` 0.075, 250 | grey-blue |
| 10 | 0.89 | 0.75 | 0.123, 0.104, 0.123 | 0.480, 0.015, 326 | `#625B62` | `#456986` 0.062, 244 | grey-mauve bridge |
| 6 | 0.93 | 0.85 | 0.393, 0.178, 0.117 | 0.609, 0.072, 43 | `#A87560` | `#798783` 0.016, 180 | dusky peach |
| 3 | 0.97 | 0.93 | 0.948, 0.243, 0.047 | 0.737, 0.163, 50 | `#F9873D` | `#B59B56` 0.094, 89 | orange, brightest |
| 1 | 0.99 | 0.97 | 0.646, 0.091, 0.001 | 0.605, 0.174, 44 | `#D25502` | `#986204` 0.115, 72 | red-orange |
| 0.5 | 0.99 | 0.99 | 0.356, 0.038, 0.004 | 0.485, 0.149, 39 | `#A1370C` | `#744014` 0.091, 57 | deep red horizon band |

#### Opposite the sun, sun −2°

Exposure as in the sun −2° table above, so the two can be compared directly.

| Elev. | From top, 0–90° sky | From top, 0–40° frame | Linear RGB | Oklab L, C, h | Hex | Auto white balance: hex, C, h | What it is |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 90 | 0.00 | above | 0.029, 0.034, 0.061 | 0.327, 0.033, 275 | `#2F3446` | `#263754` 0.057, 262 | zenith |
| 40 | 0.56 | 0.00 | 0.056, 0.060, 0.095 | 0.396, 0.030, 280 | `#434557` | `#374968` 0.058, 262 | upper sky |
| 25 | 0.72 | 0.38 | 0.081, 0.079, 0.112 | 0.435, 0.024, 290 | `#514F5E` | `#435471` 0.053, 261 | blue-violet sky above the belt |
| 15 | 0.83 | 0.63 | 0.104, 0.085, 0.103 | 0.451, 0.016, 327 | `#5B525A` | `#4B576C` 0.038, 263 | top of the belt |
| 10 | 0.89 | 0.75 | 0.106, 0.073, 0.078 | 0.434, 0.021, 7 | `#5C4C4F` | `#4C505F` 0.024, 273 | Belt of Venus |
| 6 | 0.93 | 0.85 | 0.076, 0.045, 0.053 | 0.378, 0.026, 0 | `#4E3C41` | `#40404F` 0.025, 287 | Belt of Venus, reddest |
| 4 | 0.96 | 0.90 | 0.041, 0.035, 0.048 | 0.335, 0.018, 308 | `#39343E` | `#2F374B` 0.037, 266 | shadow edge |
| 2 | 0.98 | 0.95 | 0.033, 0.034, 0.045 | 0.327, 0.014, 283 | `#33343C` | `#2A3749` 0.036, 256 | Earth's shadow, bluest |
| 0.5 | 0.99 | 0.99 | 0.035, 0.033, 0.041 | 0.325, 0.011, 301 | `#353339` | `#2B3645` 0.031, 258 | Earth's shadow at the horizon |

### 4.2 Where the main transitions sit

Model, clean air. Each cell gives the elevation, then the position down from the top for the 40° photo frame and the whole-sky frame.

| Sun | Glow peak | Glow half-brightness band | Warm hues end | Bridge (lowest chroma) | Purple light |
| --- | --- | --- | --- | --- | --- |
| +2° | at the sun (0° to 3°); 5° outside the aureole (0.88 / 0.94) | 0.25° to 13° (0.68–0.99 / 0.86–1.00) | 18° (0.55 / 0.80) | 28° (0.30 / 0.69) | none |
| 0° | 4.5° (0.89 / 0.95) | 0.75° to 15° (0.63–0.98 / 0.83–0.99) | 14° (0.65 / 0.84) | 22° (0.45 / 0.76) | faint, 18.5° to 30° (0.25–0.54 / 0.67–0.79) |
| −2° | 5.25° (0.87 / 0.94) | 1.75° to 15° (0.63–0.96 / 0.83–0.98) | 10.5° (0.74 / 0.88) | 16° (0.60 / 0.82) | 19.5° to 26° (0.35–0.51 / 0.71–0.78) |
| −4° | 4.25° (0.89 / 0.95) | 1.5° to 11° (0.73–0.96 / 0.88–0.98) | 15° (0.63 / 0.83) | 22°, inside the purple light (0.45 / 0.76) | 16° to 42° (0.00–0.60 / 0.53–0.82) |
| −6° | 2.75° (0.93 / 0.97) | 1° to 6.5° (0.84–0.98 / 0.93–0.99) | 8° (0.80 / 0.91) | 10° (0.75 / 0.89) | trace, 9° to 11.5° (0.71–0.78 / 0.87–0.90) |

Opposite the sun:

| Sun | Earth's shadow, bluest | Belt of Venus, reddest | Source |
| --- | --- | --- | --- |
| −1.56° | 2.25° | 6° | model (Lee & Mollner's Monte Carlo: 6.1°) |
| −2° | 2.75° | 6.5° | model |
| −2.78° | 4.5° | 10° | model (Lee & Mollner: 11.0° to 11.3°) |
| −3.87° | 5.9° | 14.2° | measured, [Lee 2015](#src-lee2015) (the model's belt is already gone) |
| about −4.7° | | belt gone | measured, one evening |

### 4.3 Brightness range and glow shape for three haze levels

Sun side, model. "Stops" is log₂ of the glow-to-zenith ratio.

| Air | Sun | Zenith (cd/m²) | Glow peak (cd/m²) | Glow / zenith | Stops | Glow peak elev. | Half-brightness band | Horizon (0.25° up) / glow |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| clean, AOD 0.04 | +2° | 315 | 8,000 | 25.4 | 4.7 | 5.25° | 0.25° to 13° | 1.05 |
| clean, AOD 0.04 | 0° | 157 | 2,710 | 17.2 | 4.1 | 4.5° | 0.75° to 15° | 0.38 |
| clean, AOD 0.04 | −2° | 50 | 946 | 18.8 | 4.2 | 5.25° | 1.75° to 15° | 0.14 |
| clean, AOD 0.04 | −4° | 8.6 | 322 | 37.5 | 5.2 | 4.25° | 1.5° to 11° | 0.12 |
| clean, AOD 0.04 | −6° | 0.84 | 69 | 81.6 | 6.4 | 2.75° | 1° to 6.5° | 0.16 |
| typical, AOD 0.1 | +2° | 323 | 6,600 | 20.5 | 4.4 | 5.25° | 0.75° to 16° | 0.40 |
| typical, AOD 0.1 | 0° | 157 | 1,750 | 11.2 | 3.5 | 7° | 2.25° to 20° | 0.11 |
| typical, AOD 0.1 | −2° | 50 | 579 | 11.5 | 3.5 | 7.25° | 2.75° to 20° | 0.09 |
| typical, AOD 0.1 | −4° | 8.6 | 174 | 20.2 | 4.3 | 6° | 2.5° to 15° | 0.06 |
| typical, AOD 0.1 | −6° | 0.86 | 28 | 32.0 | 5.0 | 4° | 2° to 10° | 0.04 |
| hazy, AOD 0.3 | +2° | 328 | 2,330 | 7.1 | 2.8 | 11° | 4.75° to 27° | 0.10 |
| hazy, AOD 0.3 | 0° | 155 | 691 | 4.5 | 2.2 | 12° | 5.25° to 35° | 0.14 |
| hazy, AOD 0.3 | −2° | 50 | 215 | 4.3 | 2.1 | 13° | 5.5° to 37° | 0.14 |
| hazy, AOD 0.3 | −4° | 8.7 | 51 | 5.9 | 2.6 | 11° | 5° to 29° | 0.11 |
| hazy, AOD 0.3 | −6° | 0.88 | 5.1 | 5.8 | 2.5 | 10° | 4° to 32° | 0.10 |

Where the zenith goes in nautical twilight: 0.25 cd/m² at −7° in the model. It dims about 4× per degree at first, then more slowly ([Patat 2006](#src-patat2006)), until the night sky takes over around −15° to −18°, roughly 1,000 times dimmer than at −7°. The glow shrinks to a thin band on the horizon.

### 4.4 How typical, hazy and post-volcanic air change the tables

The colors below come from the same model with more aerosol.

- **Typical air (AOD 0.1), sun 0°:**

  | Elevation | Color | What it is |
  | --- | --- | --- |
  | 0.5° | `#794B49` | dark red-brown horizon |
  | 2° | `#EA7C47` | orange |
  | 6° to 8° | `#FFCB86` to `#FFCF9B` | glow |
  | 20° | `#AFA1A2` | bridge |
  | zenith | `#40485C` | |

  The horizon is darker and the glow higher than in clean air.
- **Hazy air (AOD 0.3), sun −2°:**

  | Elevation | Color | What it is |
  | --- | --- | --- |
  | 0.5° | `#5E5A61` | dull grey-mauve horizon |
  | 10° to 15° | `#FFCEAF` to `#F1D5CA` | glow |
  | 20° | `#D9CACF` | pale pink-grey |
  | 25° | `#C3BDCC` | pale lavender |
  | zenith | `#677193` | |

  Everything is pastel and low in contrast, and the upper sky is bluer and relatively brighter.
- **Post-volcanic (stratospheric AOD 0.1), sun −4°:**

  | Elevation | Color | What it is |
  | --- | --- | --- |
  | 3° to 6° | `#F47222` to `#F78045` | glow |
  | 15° | `#A45C53` | rose |
  | 25° | `#68444E` | wine |
  | 40° | `#3F3142` | plum-grey |

---

## 5. Rules for our ramp

The rules are written for the added-light sky in [`research-techniques.md` section 3](../research-techniques.md) (sky term, glow, purple light, Earth's shadow, belt, haze). Elevations are in degrees above the warped horizon.

1. **Brightness has one peak on the sun side.** From the zenith down, brightness must rise steadily to the glow peak, then fall over the last few degrees to the horizon, which is darker but more saturated. The zenith is the darkest part of the sky. The technique doc's glow, `exp(−e/H)`, peaks at the horizon itself. Multiply it by a term that dims the horizon. A form that fits the model, with one peak at `e_p`:

   `g(e) = ((e + e0) / (e_p + e0)) · exp((e_p − e) / (e_p + e0))`

   - `e_p` = 2° to 5° in clean air, about 7° in typical air, 11° to 13° in hazy air (sun 0° to −4°). It drops to 2.75° to 4° by −6°.
   - `e0` = 0.05 × `e_p` leaves the horizon at 0.12 of the peak; `e0` = 0.25 × `e_p` leaves it at 0.45. Use 0.45 or more only with the sun above the horizon in clean air.
   - The half-brightness band then runs from about 0.2 × to 2.8 × `e_p`. The model gives 0.3 × to 3 ×, and Lee's measured arch 0.12 × to 3 ×.
2. **Bridges get lighter where blue and warm cross.** Blue sky and warm light must overlap on the glow's bright slope, so the bridge is lighter than the blue above it. Chroma has exactly one minimum between the blue and the warm: near neutral (C 0.02 or less) at daylight white balance, 0.06 or less under auto white balance.
   - Bridge position: 28° (sun +2°), 22° (0°), 16° (−2°) and 10° (−6°) in clean air. That is about 3 to 5 × `e_p`. It sits a few degrees higher in hazy air.
   - Saturation peaks below the glow, in the horizon band 0.5° to 3° up (C 0.10 to 0.19), and drops inside the glow.
   - Check: Oklab L along the vertical never dips below both neighbors.
3. **Warm colors come from one light, reddened by path length.** With Orange-red `#FF4F00` as the warm color `W`, the model's sun-side warm light at sun 0° follows `W^p` with `p ≈ 0.75 · exp(−e / 6°)`:
   - horizon band ≈ `W^0.7`;
   - glow peak ≈ `W^0.27` (near `#FFC089`);
   - cream above it ≈ `W^0.15`.

   At −4° and −6° use `p ≈ 0.7` to `0.9` × `exp(−e / 5°` to `7°)`: redder at the bottom, and the color changes faster. With Yellow `#FFD61E` as `W`, the same light is about `W^4.5` at the horizon band, `W^1.7` at the glow peak and `W^0.6` to `W^1` above it, where the sky adds blue. These exponents are fits to the model in clean air, not measurements.
4. **Transitions are thin low and wide high.** Oklab change per degree of elevation in the model:

   | Elevation | Oklab ΔE per degree |
   | --- | --- |
   | 1° | 0.12 to 0.27 |
   | 2° | 0.06 to 0.16 |
   | 5° | 0.02 to 0.06 |
   | 10° | about 0.024 |
   | 20° | about 0.013 |
   | 40° | about 0.005 |
   | 70° | about 0.002 |

   A transition centered at elevation `e` is about 0.5 to 1 × `e` wide. Lay ramps out in a variable that stretches the bottom, such as `log(e + 0.5°)` or air mass, never in equal steps of height. Equal-width bands only belong in the bands recipe.
5. **The purple light belongs above the glow, from −1.5° to −6°.**
   - It appears at sun −1.5°, is strongest at −4° (measured mean −3.9°, standard deviation 0.7°), and is gone by −6° to −7°.
   - It is centered on the sun's azimuth, 15° to 40° up, centered near 20° to 30°. It spans 90° to 150° in azimuth: half-strength about 45° to 60° to each side.
   - Make it a hue shift of the bridge toward pink-purple (Oklab h 300 to 350), with low chroma: 0.02 to 0.04 normally, up to 0.10 in post-volcanic or very hazy air.
   - Brightness must keep its smooth fall through it. It is a hue change, not a bright band.
   - Its spectrum is red plus blue with a dip in yellow-green. In RGB that means adding warm-pink light to the blue sky; the purple comes from the sum.
6. **Sideways falloff.** At a fixed elevation, the glow's brightness away from the sun's azimuth follows

   `L(φ) / L(0) ≈ f + (1 − f) / (1 + (φ / φ½)^1.6)`

   - `φ½` ≈ 29° up to 5° elevation, about 32° at 10° and about 50° at 20°.
   - The floor `f` is the brightness opposite the sun over the brightness toward it at that elevation: 0.03 to 0.2 near the horizon, 0.2 to 0.5 at 20°.
   - This tail is heavier than a Gaussian's.
   - The glow's hue turns from yellow-orange (h 55 to 68) at the sun's azimuth to orange-red (h 30 to 40) at 90°, and pink (h 340 to 10) toward 180°.
   - The reddish band rises as it goes around: `h = h_max · sin(φ/2)`, with `h_max` ≈ 4 × the sun's depression.
   - Add mild, low-frequency asymmetry between left and right. Real skies are lopsided ([Hernández-Andrés et al. 2003](#src-hernandez2003)).
7. **Opposite the sun.**
   - The Earth's shadow has the same hue as the sky above the belt, about 2.4 × darker (Oklab L about 0.1 lower). Its bluest part is at about 1.5 × the sun's depression, and its edge with the belt is centered at about 2.5 ×.
   - The Belt of Venus is a pastel pink (h 0 to 10, C 0.02 to 0.03 at daylight white balance), about as bright as the sky above it. Its reddest point is at about 4 × the depression: 6° at −1.5°, 10° to 11° at −2.8°, 14° at −3.9°. Its half-height is about 2 × the depression.
   - Both rise and fade as the sun sinks. The belt is gone by −4° to −5°, and earlier in haze.
   - The edge between them is 3° to 5° wide (10% to 90%), never a line.
   - The technique doc puts the shadow edge at `e = δ`. Measurements put it higher, at about 2.5 × δ.
8. **The zenith darkens fastest.**
   - Glow-to-zenith ratio: 4 stops at sunset, 5 stops at −4°, 6.4 stops at −6° (clean air); 3.5 to 5 stops in typical air; 2 to 3 stops in hazy air.
   - Its hue stays blue (h 262 to 276 at daylight white balance, 255 to 264 under auto white balance). Ozone, not plain scattering, keeps it blue as it darkens.
   - Haze and the purple light can push it toward lavender.
9. **Haze is one control that moves many things together.** More haze should:
   - raise and widen the glow (`e_p` 5° → 12°);
   - dull and darken the horizon band under the glow and turn it bluish-grey;
   - shrink the brightness range (17× → 4.5× at sunset);
   - make bridges paler and bluer;
   - strengthen the purple light somewhat;
   - remove the Belt of Venus.

   Moving these together keeps any setting physical. It is a candidate for what "Softness" does in Sunset.
10. **Sun depression is the other control.** It lowers and thins the glow and deepens its color (yellow → orange → red). It turns the purple light on and off (strongest at −4°), darkens the zenith (a wider brightness range), and raises the belt (4 × δ). It is a candidate for the one Sunset mood control. A ramp built from these rules stays physical at any depression from +2° to −6°.
11. **Exposure.**
    - Set exposure so the glow peak is at nominal or up to one stop over. Its core then whitens a little through the tone curve, and the zenith falls 3 to 6 stops below it, as in the references.
    - The sun and its aureole, within about 8° of the sun when it is up, are far brighter and go to white.
    - If we want the camera's pale yellow-cream core, the tone curve must move warm light toward yellow before white. Our current curve goes orange → peach → white.

Starting values for the parameters of the 2D form in `research-techniques.md` section 3:

| Parameter | Physical value | Source |
| --- | --- | --- |
| Glow peak `e_p` (add the horizon dimming term) | clean 2° to 5°, typical 7°, hazy 11° to 13°; 2.75° to 4° at −6° | model; [Lee 1994b](#src-lee1994b); [Saito 2013](#src-saito2013) |
| `glowWidth` (sideways half-brightness) | 29° below 5° up, 50° at 20° up; power-law tail, exponent 1.6 | model |
| `purpleE`, `purpleW` | center 20° to 30°, half-height about 10° to 13°; on from −1.5° to −6°, peak at −4° | [Lee 2003](#src-lee2003); model |
| Purple light half-width in azimuth | 45° to 60° | [Lee 2003](#src-lee2003) (90° to 150° full width) |
| `sunDepth + beltOffset` (belt center) | about 4 × δ | [Lee & Mollner 2017](#src-lee2017); [Lee 2015](#src-lee2015) |
| `beltW` | about 2 × δ (half-height) | model |
| Shadow edge, `shadowSoft` | centered at about 2.5 × δ (bluest point at 1.5 × δ); 3° to 5° wide | [Lee 2015](#src-lee2015); [Lee & Mollner 2017](#src-lee2017); model |
| `shadowDim` | about 0.4 of the sky above, same hue | [Lee 2015](#src-lee2015); model |
| Glow/zenith range | 4 to 6.4 stops clean, 3.5 to 5 typical, 2 to 3 hazy | model; [Lee 2011](#src-lee2011); [Patat 2006](#src-patat2006) |

---

## 6. Driving it with pack colors

A real twilight sky has one light source. It has blue skylight on top, one family of warm colors from the reddened sun, and shadows that are darker versions of the sky's own blue. A pack drives that structure by giving each role a pack color. The roles:

| Role | Where | Physical color (daylight white balance) | Through a camera (auto white balance) |
| --- | --- | --- | --- |
| Zenith | top | deep blue, L 0.17 to 0.33, C 0.03, h 262 to 276 | h 255 to 264, C 0.05 to 0.08 |
| Upper sky | 20° to 60° | grey-blue to lavender, C 0.02 to 0.03 | clear blue, C 0.06 to 0.08 |
| Bridge | where the hue crosses | computed from the sum, not a pack color; C 0.02 or less | pale cyan or green-grey, C 0.06 or less |
| Glow | 2° to 13° | cream-yellow to peach, L 0.74 to 0.87 | yellow-cream or khaki, h 85 to 115 |
| Horizon band | 0.5° to 3° | orange-red to rust, C 0.10 to 0.19, h 36 to 50 | ochre-orange, h 35 to 72 |
| Purple light | 15° to 40°, sun −1.5° to −6° | mauve to purple, h 300 to 350, C 0.02 to 0.04 | mostly neutralized to blue |
| Shadow | opposite the sun, or terrain | the sky's own hue, darker | same |

How the three packs fit. Oklab values of the pack colors are in parentheses.

- **Bold.** In pack order, Bold is the clear twilight as a camera on auto white balance sees it, top to bottom.
  - Meta Blue (L 0.53, C 0.205, h 259) is the zenith; its hue matches the camera's twilight zenith, h 255 to 264.
  - Cyan (L 0.78, C 0.135, h 217) is the cool side of the bridge; the camera's low sky above the glow is h 214 to 245.
  - Yellow (L 0.89, C 0.177, h 94) is the glow; the camera's glow is h 85 to 115.
  - Orange-red (L 0.67, C 0.222, h 37) is the horizon band, matching h 36 to 50.

  "One warm color at most" is physical, because one sun makes all the warm tones. Pick Yellow or Orange-red as the light `W` for an image and derive the other warm tones as `W^p` (rule 3). Orange-red as `W` gives a red-orange band with a peach glow. Yellow as `W` gives a yellow glow with an orange band (`W^3` = `#FF9600`).
- **Elemental.**
  - Meta Blue is the zenith.
  - Tan (L 0.70, C 0.069, h 75) is a dusty, hazy sun: the pale warm band of a hazy sunset. `sunset-sky-peach` has `#D4B088` (L 0.78, C 0.068, h 69) 65% of the way down, almost Tan.
  - Lime (L 0.91, C 0.162, h 120) only fits as a camera-shifted glow. The model's auto-white-balanced glow at −4° to −6° is h 89 to 114, but at C 0.03 to 0.09. Keep its use pale and small.
  - Plum (L 0.29, C 0.110, h 339) matches the dark end of a vivid purple light (post-volcanic model at 25° to 40° up: h 319 to 1).
  - Forest (L 0.33, C 0.052, h 175) is a dark band: terrain or a shadowed layer, as in the poster's black bands.
- **Atmospheric.** This pack is the physical blue hour.
  - Steel (L 0.57, C 0.031, h 255) matches the model's upper sky at sunset under daylight white balance in lightness and chroma (L 0.45 to 0.54, C 0.024 to 0.028). Its hue is about 20° bluer (255 against 275).
  - Slate (L 0.39, C 0.028, h 243) is the civil-twilight zenith or the Earth's shadow.
  - Near-black (L 0.28, h 232) is the zenith around −6° and beyond.
  - Ice (L 0.97, C 0.005) is the light itself: a cool white, as in haze, overcast or moonlight.

  A twilight with no warm color is physical too. Clouds beyond the sunset horizon that shade the sun's path make "the sky blue during much of civil twilight" ([Lee 2011](#src-lee2011); [Lee 2003](#src-lee2003)). Read top to bottom, the pack order (Meta Blue, Ice, Steel, Slate, Near-black) matches the sky opposite the sun: sky, a pale band where the belt would be, the darkening shadow, then the ground.
- **Brightness range of the packs.** With Meta Blue at the zenith, the bright pack colors at nominal are only 0.9 to 2.6 stops brighter. Yellow over Meta Blue is 4.8× (2.3 stops), Ice over Meta Blue 6.2× (2.6 stops), Orange-red over Meta Blue 1.9× (0.9 stop). That is the range of hazy air. A clear-evening sky needs 4 to 6 stops: the glow must go above nominal and whiten, and/or the zenith must sit below nominal Meta Blue (Meta Blue × 0.25 to 0.5). Pack colors stay exact wherever they are at nominal.
- **Meta Blue is about twice as saturated as any real twilight blue**, even through a camera: C 0.205 against 0.05 to 0.12. The references go past physics too (`sunset-blue-diagonal`'s top is C 0.13). This is fine as long as the other relations hold.

These behaviors must survive any palette:

1. Light adds in linear RGB. The bridge is lighter than the darker side and has the lowest chroma along the ramp.
2. There is one brightest band, a few degrees above the horizon on the sun side. The zenith is the darkest part of the sky, with brightness rising steadily between them.
3. Bands are thin low and wide high (width about 0.5 to 1 × elevation).
4. Warm colors appear only low on the sun side, plus a pastel pink low opposite the sun. They are most saturated just below the glow; the glow core is pale.
5. There is one light direction. Brightness falls off sideways from it with a heavy tail, and the warm band rises and turns pink as it goes around.
6. Shadow bands are darker versions of the neighboring hue, not new hues, with edges at least 3° wide.
7. Light brighter than nominal goes smoothly to white.
8. No ruler lines. Brightness and softness vary along the horizon, and left and right are not mirror images.

---

## 7. Which effect explains which reference

Profile numbers are from [`docs/references/awe/profiles/`](../../references/awe/profiles/), with positions measured down from the top.

**`sunset-sky-peach`** (ramp)
- Profile: blue at the top (`#6B93C7`, L 0.66, C 0.09, h 255). A neutral grey bridge 40% down (`#B1B1B0`, C 0.001, L 0.76). The peak at 55% (`#CFB9A1`, L 0.80). Orange at 85% (`#C4724A`), and deep red at the bottom (`#7B2026`, L 0.39). It is lighter on the right.
- Effect: the sun side at about sunset (sun 0° to −2°) in moderately hazy air, from the horizon to roughly 30° up, with the sun's azimuth to the right of the frame (sideways falloff).
  - The deep red bottom is the long-path horizon band, darker than the glow above it.
  - The neutral bridge is blue skylight plus reddened glow, at the palest point just above the brightest band ([Lee 1994b](#src-lee1994b)).
  - The top's blue is more saturated than the physical sky, which points to a cooler white balance than daylight.
  - The bridge sits closer to the glow than in the model (about 1.3 × `e_p` instead of 3 to 5 ×), so its upper falloff should be a parameter.

**`sunset-violet-wave`** (ramp)
- Profile: light cyan-blue at the top (`#8CC8E8`, h 232, L 0.80). Near-white 30% down (L 0.91, C 0.014), then pink-white (h 313 to 322) and violet at 55% (`#9071BF`, C 0.12). Indigo, then navy at the bottom (`#0F1235`, L 0.20). There is a wavy ridge, and the brightest point (`#F2EEEB`, L 0.95) is on the right.
- Effect: a hazy sun-side twilight, sun about −1° to −3°, with the glow behind a ridge of hills.
  - Near its brightest the glow is pale and almost white, from haze plus a camera exposed slightly over.
  - The pink fringe below the white is the warm glow and purple light.
  - The violet-to-navy lower half is the purple-blue twilight light scattered by haze in front of dark land, darker for nearer ridges ([Lee 2015b](#src-lee2015b) on haze lowering the contrast of distant objects).
  - The cyan-ish top is the low sky as a camera on auto white balance renders it (model: h 214 to 245 just above the glow).
- Another reading would be the view opposite the sun: sky, Belt of Venus, Earth's shadow, ground. It fits less well, because the belt is not brighter than the sky above it ([Lee 2015](#src-lee2015)), while this pink-white band is the brightest part.

**`sunset-red-yellow-arcs`** (ramp)
- Profile: maroon at the top (`#7B2116`, L 0.39). Red at 40% (`#E12917`, C 0.22), orange at 60%, yellow at 70% (`#FCC216`). Pale cream at 80% to 85% (`#EEDE6E`, L 0.89, brightest). Pale green-grey at 90% (`#BCDDCA`, h 160), and light blue at the bottom (`#94D4EF`, L 0.84). Arcs of radius about one frame height curve around a center below the frame.
- Effect: the clean-air sun-side sequence at sun 0° to −2° (model: `#EF692B` → `#FFAF51` → `#FFBE83` → `#D3AF95` → bluer above), upside down.
  - The arcs are lines of equal elevation, which are circles around the zenith. They curve around a center below the frame when the view looks up with the top of the frame toward the sun's horizon, which is a normal upward-tilted sunset photo turned 180°.
  - The green-grey is how auto white balance renders the yellow-to-blue crossing (model: h 165 to 214 there). Physically the crossing is near neutral and never a saturated green.
  - The red and orange are more saturated than clean-air physics (C 0.22 against 0.19), which suggests camera saturation or a vivid sunset.
  - For production, keep the warm colors low.

**`sunset-blue-diagonal`** (ramp)
- Profile: deep blue at the top right (`#0C337C`, L 0.35, C 0.13, h 261). Lavender-grey 65% to 70% along the axis (h 278 to 313, C 0.025 to 0.045). Cream-peach at 80% to 85% (`#FFCD8E`, L 0.88, brightest), then yellow-orange, and orange at the bottom-left corner (`#FE7937`). The axis tilts 33° from vertical.
- Effect: the sun side at about −2° to −4° in clean air.
  - The deep upper sky is the darkening, ozone-blue zenith side, with exposure set for the glow and a camera pushing its saturation.
  - The lavender bridge is the purple light starting (model at 20° to 30° up: h 283 to 342).
  - Then come the cream glow and the orange horizon band.
  - The diagonal is the sideways falloff: the sun's azimuth is off the bottom-left, and brightness falls both upward and sideways, so lines of equal color tilt.

**`sunset-pink-riso`** (bands)
- Profile: cream paper, pink (`#ECB7D4`), magenta (`#D66A9E`, C 0.15, h 352). A thin orange band 60% down (`#E06351`, h 30) with a crisper lower edge, then magenta (`#CE5E96`), purple (`#976998`), and slate purple at the bottom (`#4E4F6D`, h 283).
- Effect: the sun side at about −3° to −5°, printed. The glow has shrunk to a thin orange band on the horizon, with a broad purple light above it (strongest at −4°, centered 20° to 30° up).
  - The crisp lower edge of the orange band is the horizon cutting it. Its top edge is soft because the glow fades upward.
  - Below the horizon line, water reflecting the purple sky, or land in purple twilight haze, darkens to slate purple.
  - The magenta is far more saturated than a real purple light (C 0.15 against 0.03 to 0.10); that is riso ink.

**`sunset-blue-riso`** (bands)
- Profile: paper white, cyan-blue (`#4099D1`, h 240, C 0.12), a slate navy band 50% down (`#42526B`, L 0.44, C 0.046, h 259), then lighter blue at the bottom (`#5EA4D8`).
- Effect: like the Earth's shadow or a blue-hour band. The dark band has the same hue family as the blues around it and differs mainly in lightness, which is exactly how the shadow relates to the sky above it ([Lee 2015](#src-lee2015)). Its edges are soft over several degrees. It also reads as a distant dark band of land or cloud between bright sky and its reflection on water.
- This is the Atmospheric pack's natural reference: Ice, Meta Blue, Slate, Steel.

**`sunset-green-riso`** (bands)
- Profile: paper white (`#E3E2DE`), green (`#5CA124`, L 0.64, C 0.17, h 135), and mustard at the bottom (`#CDB823`, L 0.78, h 100).
- Effect: not a sky color. It is a riso ink ramp. As light it behaves like a glow at the bottom (lightness rises again toward the bottom, L 0.64 → 0.78) under a pale top.
  - The nearest real cases are a camera-shifted deep-twilight glow, which can read khaki to yellow-green (model under auto white balance: h 89 to 114), and Elemental's Lime.
  - Take the structure from it, not the hues.

**`sunset-film-poster-bands`** (bands)
- Profile: Jeremy Blake's artwork, not a sky. It has blurred red, black, blue, grey and red bands.
- Effect: it reads like a sunset seen past cloud decks. The red bottom band is the horizon glow, the black and grey bands are layers that block light (clouds or land), the blue band is open sky, and the red at the top is lit cloud.
- The physics that applies: dark bands are shadows and blockers, not mixtures. Bright bands bleed into dark ones (bloom), never the reverse. Bridges between bands are lighter than the darker band; the profile's bridges at 39% (L 0.56 against 0.49 and 0.50) and 70% (L 0.64 against 0.59 and 0.62) show it.

---

## 8. The 8 most useful facts

1. **The brightest sky is a band a few degrees above the horizon on the sun side, never at the top.** It peaks 2° to 5° up in clean air, about 7° in typical air and 11° to 13° in haze. The horizon below it is darker and redder, the zenith is the darkest part of the sky, and brightness rises steadily from the zenith to the band.
2. **Color follows brightness.** The palest colors sit in and just above the brightest band, and the most saturated warm colors in the thin band below it (0.5° to 3° up). The blue-to-warm bridge is near neutral (chroma 0.02 or less physically, 0.06 or less through a camera) and lighter than the blue, because light adds.
3. **Transition width grows with elevation.** It is about 1° near the horizon, about 5° at 10° up and about 20° at 40° up. Color changes about 0.15 Oklab per degree at 1° and 0.002 per degree at 70°.
4. **One light direction.** The glow falls to half brightness about 30° to the side near the horizon and about 50° at 20° up, roughly as `1 / (1 + (φ/29°)^1.6)` over a floor. Going around, it turns pink and rises; opposite the sun it ends as the Belt of Venus, at about 4 × the sun's depression. Under the belt, the Earth's shadow is the same blue as the sky, about 2.4 × darker, with a soft 3° to 5° edge.
5. **As the sun goes from 0° to −6°, the glow drops and narrows.** Its half-brightness band shrinks from 1°–15° to 1°–6.5°, and it deepens from yellow-cream to orange-red. The zenith dims about 200 × (157 to 0.84 cd/m²), faster than the glow, so the range grows from 4 to 6.4 stops in clean air. Ozone keeps the darkening zenith blue; without it the zenith would turn grey and then yellowish.
6. **The purple light** is a broad, low-chroma pink-purple shift centered on the sun's azimuth, 15° to 40° up. It appears at about −1.5°, is strongest at −4° and is gone by −6° to −7°. It is blue skylight plus reddened light from high up. It gets stronger with haze beyond the horizon and after volcanic eruptions, and disappears when distant clouds shade the sun's path.
7. **Haze is the main control.**
   - More aerosol raises and widens the glow, dulls the horizon under it, shrinks the range (17 × to 4.5 × at sunset), pales the bridges and removes the Belt of Venus.
   - Very clean air gives a low, compact glow and the reddest belt.
   - Volcanic dust high up gives deep reds and wide, vivid purples.
8. **Photos, including our references, are camera renderings.**
   - They are exposed for the glow, so the sun and aureole clip toward white, with orange turning yellow as channels clip.
   - Their white balance is cool, which turns the physically grey-lavender upper sky into a clear blue (chroma 0.06 to 0.12, hue 255 to 264; Meta Blue's hue is 259) and the orange glow into yellow-cream.
   - Meta Blue is about twice as saturated as any real twilight blue. That is fine if the other relations hold.

---

## 9. Sources

Measurement papers (full text read):

- <a id="src-lee1994a"></a>Lee 1994a: R. L. Lee Jr., "Horizon brightness revisited: measurements and a model of clear-sky radiances," Appl. Opt. 33, 4620–4628. [doi:10.1364/AO.33.004620](https://doi.org/10.1364/AO.33.004620)
- <a id="src-lee1994b"></a>Lee 1994b: R. L. Lee Jr., "Twilight and daytime colors of the clear sky," Appl. Opt. 33, 4629–4638. [doi:10.1364/AO.33.004629](https://doi.org/10.1364/AO.33.004629)
- <a id="src-lee2003"></a>Lee 2003: R. L. Lee Jr. and J. Hernández-Andrés, "Measuring and modeling twilight's purple light," Appl. Opt. 42, 445–457. [doi:10.1364/AO.42.000445](https://doi.org/10.1364/AO.42.000445)
- <a id="src-hernandez2003"></a>Hernández-Andrés et al. 2003: J. Hernández-Andrés, R. L. Lee Jr., J. Romero, "Color and luminance asymmetries in the clear sky," Appl. Opt. 42, 458–464. [doi:10.1364/AO.42.000458](https://doi.org/10.1364/AO.42.000458)
- <a id="src-hernandez1999"></a>Hernández-Andrés et al. 1999: "Calculating correlated color temperatures across the entire gamut of daylight and skylight chromaticities," Appl. Opt. 38, 5703–5709. Skylight spans 3,000 K to about 10⁶ K; the model uses its CCT formula. [doi:10.1364/AO.38.005703](https://doi.org/10.1364/AO.38.005703)
- <a id="src-lee2011"></a>Lee 2011: R. L. Lee Jr., W. Meyer, G. Hoeppe, "Atmospheric ozone and colors of the Antarctic twilight sky," Appl. Opt. 50, F162–F171. [doi:10.1364/AO.50.00F162](https://doi.org/10.1364/AO.50.00F162)
- <a id="src-lee2015"></a>Lee 2015: R. L. Lee Jr., "Measuring and modeling twilight's Belt of Venus," Appl. Opt. 54, B194–B203. [doi:10.1364/AO.54.00B194](https://doi.org/10.1364/AO.54.00B194)
- <a id="src-lee2015b"></a>Lee 2015b: R. L. Lee Jr., "Tropospheric haze and colors of the clear daytime sky," Appl. Opt. 54, B232. Abstract and introduction read. [doi:10.1364/AO.54.00B232](https://doi.org/10.1364/AO.54.00B232)
- <a id="src-lee2017"></a>Lee & Mollner 2017: R. L. Lee Jr. and D. C. Mollner, "Tropospheric haze and colors of the clear twilight sky," Appl. Opt. 56, G179–G187. [doi:10.1364/AO.56.00G179](https://doi.org/10.1364/AO.56.00G179)
- <a id="src-saito2013"></a>Saito et al. 2013: M. Saito, H. Iwabuchi, T. Hayasaka, "Physical explanation of tropospheric aerosol effects on twilight sky color based on photographic observations and radiative transfer simulations," SOLA 9, 15–18. [doi:10.2151/sola.2013-004](https://doi.org/10.2151/sola.2013-004) (open access)
- <a id="src-patat2006"></a>Patat et al. 2006: F. Patat, O. S. Ugolnikov, O. V. Postylyakov, "UBVRI twilight sky brightness at ESO-Paranal," A&A 455, 385–393. [doi:10.1051/0004-6361:20064992](https://doi.org/10.1051/0004-6361:20064992), [arXiv:astro-ph/0604128](https://arxiv.org/abs/astro-ph/0604128)
- <a id="src-spitschan2016"></a>Spitschan et al. 2016: M. Spitschan, G. K. Aguirre, D. H. Brainard, A. M. Sweeney, "Variation of outdoor illumination as a function of solar elevation and light pollution," Sci. Rep. 6, 26756. [doi:10.1038/srep26756](https://doi.org/10.1038/srep26756) (open access)
- <a id="src-zerefos2007"></a>Zerefos et al. 2007: "Atmospheric effects of volcanic eruptions as seen by famous artists and depicted in their paintings," Atmos. Chem. Phys. 7, 4027–4042. [doi:10.5194/acp-7-4027-2007](https://doi.org/10.5194/acp-7-4027-2007) (open access). Follow-up: [Zerefos et al. 2014](https://doi.org/10.5194/acp-14-2987-2014).

Read from abstracts, or through the papers above:

- <a id="src-hulburt1953"></a>Hulburt 1953: E. O. Hulburt, "Explanation of the brightness and color of the sky, particularly the twilight sky," J. Opt. Soc. Am. 43, 113–118. [doi:10.1364/JOSA.43.000113](https://doi.org/10.1364/JOSA.43.000113)
- <a id="src-volz1969"></a>Volz 1969: F. E. Volz, "Twilights and stratospheric dust before and after the Agung eruption," Appl. Opt. 8, 2505–2517. [doi:10.1364/AO.8.002505](https://doi.org/10.1364/AO.8.002505)
- <a id="src-adams1974"></a>Adams et al. 1974: C. N. Adams, G. N. Plass, G. W. Kattawar, "The influence of ozone and aerosols on the brightness and color of the twilight sky," J. Atmos. Sci. 31, 1662–1674. [doi:10.1175/1520-0469(1974)031<1662:TIOOAA>2.0.CO;2](https://doi.org/10.1175/1520-0469(1974)031%3C1662:TIOOAA%3E2.0.CO;2)
- Dave & Mateer 1968: "The effect of stratospheric dust on the color of the twilight sky," J. Geophys. Res. 73, 6897–6913. The purple light needs stratospheric dust in single-scattering models. [doi:10.1029/JB073i022p06897](https://doi.org/10.1029/JB073i022p06897)
- <a id="src-lynch2017"></a>Lynch et al. 2017: D. K. Lynch, D. S. P. Dearborn, S. C. Richtsmeier, "Antitwilight I: structure and optics," Appl. Opt. 56, G156. [doi:10.1364/AO.56.00G156](https://doi.org/10.1364/AO.56.00G156). Also "Antitwilight II: Monte Carlo simulations," [doi:10.1364/AO.56.00G169](https://doi.org/10.1364/AO.56.00G169).
- Haber, Magnor, Seidel 2005: "Physically-based simulation of twilight phenomena," ACM Trans. Graph. 24, 1353–1373. A graphics simulation of twilight with multiple scattering, refraction and the Earth's shadow. [doi:10.1145/1095878.1095884](https://doi.org/10.1145/1095878.1095884)
- Gedzelman 2005: "Simulating colors of clear and partly cloudy skies," Appl. Opt. 44, 5723. Ozone, refraction, cloud shadows; volcanic aerosol scattering modeled as λ⁺¹. [doi:10.1364/AO.44.005723](https://doi.org/10.1364/AO.44.005723)
- Hernández-Andrés et al. 2001: "Color and spectral analysis of daylight in southern Europe," JOSA A 18, 1325. [doi:10.1364/JOSAA.18.001325](https://doi.org/10.1364/JOSAA.18.001325)
- <a id="src-smith2005"></a>Smith 2005: G. S. Smith, "Human color vision and the unsaturated blue color of the daytime sky," Am. J. Phys. 73, 590–597. [doi:10.1119/1.1858479](https://doi.org/10.1119/1.1858479)
- <a id="src-bohren1985"></a>Bohren & Fraser 1985: C. F. Bohren and A. B. Fraser, "Colors of the sky," Phys. Teach. 23, 267–272. [doi:10.1119/1.2341808](https://doi.org/10.1119/1.2341808)

Cameras:

- <a id="src-zhang2004"></a>Zhang & Brainard 2004: "Estimation of saturated pixel values in digital color imaging," JOSA A 21, 2301. [doi:10.1364/JOSAA.21.002301](https://doi.org/10.1364/JOSAA.21.002301)
- <a id="src-buchsbaum1980"></a>Buchsbaum 1980: "A spatial processor model for object colour perception," J. Franklin Inst. 310, 1–26. The gray-world method. [doi:10.1016/0016-0032(80)90058-7](https://doi.org/10.1016/0016-0032(80)90058-7)

Model inputs:

- <a id="src-hillaire2020"></a>Hillaire 2020: "A scalable and production ready sky and atmosphere rendering technique," Comput. Graph. Forum 39(4). [PDF](https://sebh.github.io/publications/egsr2020.pdf)
- Bruneton, [precomputed atmospheric scattering](https://github.com/ebruneton/precomputed_atmospheric_scattering) (BSD-3): ASTM G-173 solar irradiance, ozone cross sections from the [Bremen database](http://www.iup.uni-bremen.de/gruppen/molspec/databases/referencespectra/o3spectra2011/index.html) (233 K), Rayleigh coefficient, CIE 1931 color matching functions.

---

## 10. Appendix: the model

- **Geometry**: a round Earth (radius 6371 km), air up to 100 km, an observer at sea level. Sunlight travels in straight lines, with no refraction; real twilight runs about 0.5° to 1° of sun depression behind the model.
- **Air and haze**:
  - Rayleigh scattering ∝ λ⁻⁴, scale height 8 km.
  - Low haze: exponential, scale height 1.2 km, Ångström exponent 1.3 (Lee measured a mean of 1.52 near Annapolis), single-scattering albedo 0.95. Its scattering pattern is Henyey–Greenstein with g = 0.7.
  - Background stratospheric aerosol: a Gaussian layer at 20 ± 4 km, AOD 0.005, Ångström exponent 1. The post-volcanic run uses AOD 0.1.
  - Ozone: 300 Dobson units in a tent profile from 10 km up to a peak at 25 km and down to 40 km. Its absorption peaks at about 0.040 vertical optical depth near 600 nm.
  - Ground albedo 0.1.
- **Light**: 41 wavelengths from 380 to 780 nm. Sunlight is scattered once, with exact shadowing by the Earth and attenuation along each sunlight path. Multiple scattering comes from Hillaire's isotropic lookup table (28 altitudes × 120 sun angles × 96 directions).
- **Color**:
  - CIE 1931 2° color matching functions; luminance = 683 × Y.
  - XYZ is converted to linear sRGB (D65). Out-of-gamut colors are pulled toward the grey of the same luminance.
  - CCT comes from the Hernández-Andrés et al. 1999 formula.
  - Auto white balance is gray-world over a sun-side frame.
- **What it does not include**: refraction, clouds, a solar disc (point sun), observer altitude, and a realistic forward peak in the haze scattering pattern. Henyey–Greenstein is too flat near the sun, so the aureole is too dim.
- **Code**: scratch scripts in `artifacts/research-twilight/` (gitignored, not committed):
  - `twilight.mjs`: the model;
  - `validate.mjs`: the checks in section 2;
  - `profiles.mjs`, `analyze.mjs`, `glow.mjs`, `final.mjs`: the tables;
  - `render.mjs`: camera views for the visual check.

  A full run takes under a minute per haze level on an M4 Pro.
