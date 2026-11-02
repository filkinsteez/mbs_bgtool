// Exact piecewise sRGB transfer and Oklab (Björn Ottosson's matrices).

export function srgbToLinear(v) {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(v) {
  if (v <= 0.0031308) return 12.92 * v;
  return 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

export function linearToOklab(r, g, b, out, o = 0) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  out[o] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  out[o + 1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  out[o + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
}

export function oklabToLinear(L, a, b, out, o = 0) {
  const l = L + 0.3963377774 * a + 0.2158037573 * b;
  const m = L - 0.1055613458 * a - 0.0638541728 * b;
  const s = L - 0.0894841775 * a - 1.291485548 * b;
  const l3 = l * l * l;
  const m3 = m * m * m;
  const s3 = s * s * s;
  out[o] = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  out[o + 1] = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  out[o + 2] = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3;
}

export function hexToSrgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}

export function hexToLinear(hex) {
  return hexToSrgb(hex).map(srgbToLinear);
}

export function srgbToHex(rgb) {
  return (
    '#' +
    rgb
      .map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

export function linearToHex(rgb) {
  return srgbToHex(rgb.map(linearToSrgb));
}
