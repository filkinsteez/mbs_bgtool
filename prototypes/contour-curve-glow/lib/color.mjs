// Color helpers: exact piecewise sRGB, Oklab (for measuring only), pack hexes.

export function srgbToLinear(v) {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(v) {
  if (v <= 0) return 0;
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

export function hexToSrgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}

export function hexToLinear(hex) {
  return hexToSrgb(hex).map(srgbToLinear);
}

export function linearToHex(rgb) {
  return (
    '#' +
    rgb
      .map((v) => {
        const s = Math.round(Math.min(1, Math.max(0, linearToSrgb(v))) * 255);
        return s.toString(16).padStart(2, '0');
      })
      .join('')
      .toUpperCase()
  );
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

export const PACKS = {
  bold: ['#0064E0', '#1FCDF0', '#FFD61E', '#FF4F00'],
  elemental: ['#0064E0', '#D6F26C', '#0F3D33', '#B8996E', '#4A0A3C'],
  atmospheric: ['#0064E0', '#F2F4F7', '#6A7788', '#384753', '#1C2B33'],
};
