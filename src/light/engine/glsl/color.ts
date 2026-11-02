export const COLOR_GLSL = /* glsl */ `
float srgbToLinear(float c) { return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4); }
vec3 srgbToLinear(vec3 c) { return vec3(srgbToLinear(c.r), srgbToLinear(c.g), srgbToLinear(c.b)); }
float linearToSrgb(float c) { return c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1.0 / 2.4) - 0.055; }
vec3 linearToSrgb(vec3 c) { return vec3(linearToSrgb(c.r), linearToSrgb(c.g), linearToSrgb(c.b)); }

vec3 signedCbrt(vec3 x) { return sign(x) * pow(abs(x), vec3(1.0 / 3.0)); }

// Ottosson's Oklab, from linear sRGB.
vec3 linearToOklab(vec3 c) {
  vec3 lms = vec3(
    0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b,
    0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b,
    0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b);
  vec3 q = signedCbrt(lms);
  return vec3(
    0.2104542553 * q.x + 0.7936177850 * q.y - 0.0040720468 * q.z,
    1.9779984951 * q.x - 2.4285922050 * q.y + 0.4505937099 * q.z,
    0.0259040371 * q.x + 0.7827717662 * q.y - 0.8086757660 * q.z);
}

vec3 oklabToLinear(vec3 lab) {
  vec3 q = vec3(
    lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z,
    lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z,
    lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z);
  vec3 lms = q * q * q;
  return vec3(
     4.0767416621 * lms.x - 3.3077115913 * lms.y + 0.2309699292 * lms.z,
    -1.2684380046 * lms.x + 2.6097574011 * lms.y - 0.3413193965 * lms.z,
    -0.0041960863 * lms.x - 0.7034186147 * lms.y + 1.7076147010 * lms.z);
}

// Perceptual easing between two linear colors. For parameters, not for light transport.
vec3 mixOklab(vec3 a, vec3 b, float t) {
  return oklabToLinear(mix(linearToOklab(a), linearToOklab(b), t));
}

#define MAX_STOPS 8

// Linear-light ramp through stops (positions ascending), blurred by a gaussian of
// the given sigma in t units. sigma = 0 gives the piecewise-linear ramp; the
// result is smooth everywhere for sigma > 0. Constant before the first and
// after the last stop.
vec3 blurredRamp(float t, vec3 colors[MAX_STOPS], float stops[MAX_STOPS], int count, float sigma) {
  vec3 result = colors[0];
  vec3 previousSlope = vec3(0.0);
  for (int k = 0; k < MAX_STOPS; k++) {
    if (k >= count) break;
    vec3 slope = vec3(0.0);
    if (k + 1 < count) slope = (colors[k + 1] - colors[k]) / max(stops[k + 1] - stops[k], 1e-5);
    result += (slope - previousSlope) * softRamp(t - stops[k], sigma);
    previousSlope = slope;
  }
  return result;
}

// Bands: colors[k] fills [edges[k-1], edges[k]); every edge is blurred by a gaussian.
// edges has count - 1 entries; sigmas holds one sigma per edge.
vec3 blurredBands(float t, vec3 colors[MAX_STOPS], float edges[MAX_STOPS], float sigmas[MAX_STOPS], int count) {
  vec3 result = colors[0];
  for (int k = 1; k < MAX_STOPS; k++) {
    if (k >= count) break;
    result += (colors[k] - colors[k - 1]) * softStep(t - edges[k - 1], sigmas[k - 1]);
  }
  return result;
}
`
