// Color helpers: exact piecewise sRGB, Oklab (for measuring only), hex parsing,
// and the engine's tone curve.

export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c) {
  if (c <= 0) return 0;
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
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

export function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function linearToOklab(r, g, b) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

// Tone curve. Colors with max channel <= 1 pass through unchanged, so a pack
// color at nominal intensity encodes to its exact hex. Brighter light keeps its
// hue at max channel 1 and mixes toward white; the mix rate is chosen so the
// luminance slope is continuous at the threshold (no visible ring).
export function toneMap(r, g, b) {
  const m = Math.max(r, g, b);
  if (m <= 1) return [Math.max(0, r), Math.max(0, g), Math.max(0, b)];
  const br = r / m;
  const bg = g / m;
  const bb = b / m;
  const y0 = luminance(br, bg, bb);
  const a = y0 / Math.max(1e-4, 1 - y0);
  const t = 1 - Math.exp(-a * (m - 1));
  return [br + (1 - br) * t, bg + (1 - bg) * t, bb + (1 - bb) * t];
}
