/**
 * Glyph shapes for the ASCII filter: the ramp ' .:-=+*#%@' from the deck's
 * filter slide (Figma 44:275), as signed distances in em. Proportions follow
 * Optimistic VF Regular, the deck's font, measured from src/fonts/OptimisticVF.ttf
 * (docs/light/research/ascii.md); '#', '%' and '@' are narrowed to the 0.6 em
 * cell the way a monospace font narrows them, keeping the stroke. Needs the
 * chunk library (sdBox, sdCircle, PI, TAU).
 */
export const ASCII_GLYPHS_GLSL = /* glsl */ `
// Baseline above the bottom of a 1.3 em line: half the leading plus Optimistic's descent.
const float ASCII_BASELINE = 0.42;
const float ASCII_HALF_STROKE = 0.04;

// Signed distance to an ellipse outline (Quilez's first-order estimate), good within a few pixels of it.
float asciiEllipse(vec2 q, vec2 r) {
  float k0 = length(q / r);
  float k1 = length(q / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-6);
}

// Ring along an ellipse of mid radii r from angle a0 to a1 (radians on the circle the ellipse maps to), round ends.
float asciiEllipseArc(vec2 q, vec2 r, float a0, float a1, float halfWidth) {
  float a = atan(q.y / r.y, q.x / r.x);
  float mid = 0.5 * (a0 + a1);
  float rel = mod(a - mid + PI, TAU) - PI;
  if (abs(rel) <= 0.5 * (a1 - a0)) return abs(asciiEllipse(q, r)) - halfWidth;
  vec2 e0 = r * vec2(cos(a0), sin(a0));
  vec2 e1 = r * vec2(cos(a1), sin(a1));
  return min(length(q - e0), length(q - e1)) - halfWidth;
}

// A bar from the origin along dir, length len, flat ends.
float asciiArm(vec2 q, vec2 dir, float len, float halfWidth) {
  vec2 r = vec2(dot(q, vec2(dir.y, -dir.x)), dot(q, dir));
  return sdBox(r, vec2(0.0, 0.5 * len), vec2(halfWidth, 0.5 * len));
}

// A slanted stroke from y0 to y1 whose centre line is x = x0 + slope * (y - yc), cut level at both ends.
float asciiSlant(vec2 q, float x0, float slope, float yc, float y0, float y1, float halfRun) {
  float across = (abs(q.x - (x0 + slope * (q.y - yc))) - halfRun) / sqrt(1.0 + slope * slope);
  float along = abs(q.y - 0.5 * (y0 + y1)) - 0.5 * (y1 - y0);
  return length(max(vec2(across, along), 0.0)) + min(max(across, along), 0.0);
}

// Glyph g (1 '.', 2 ':', 3 '-', 4 '=', 5 '+', 6 '*', 7 '#', 8 '%', 9 '@') at q in em: x from the cell centre,
// y up from the baseline.
float asciiGlyph(int g, vec2 q) {
  float h = ASCII_HALF_STROKE;
  if (g == 1) return sdCircle(q, vec2(0.0, 0.0575), 0.065);
  if (g == 2) return min(sdCircle(q, vec2(0.0, 0.0575), 0.064), sdCircle(q, vec2(0.0, 0.455), 0.064));
  if (g == 3) return sdBox(q, vec2(0.0, 0.2725), vec2(0.1675, h));
  if (g == 4) return min(sdBox(q, vec2(0.0, 0.2512), vec2(0.21, 0.0397)), sdBox(q, vec2(0.0, 0.4512), vec2(0.21, 0.0397)));
  if (g == 5) return min(sdBox(q, vec2(0.0, 0.35), vec2(0.2155, h)), sdBox(q, vec2(0.0, 0.35), vec2(h, 0.21)));
  if (g == 6) {
    vec2 c = q - vec2(0.0, 0.531);
    float d = 1e9;
    for (int k = 0; k < 5; k++) {
      float a = radians(72.0 * float(k));
      d = min(d, asciiArm(c, vec2(sin(a), cos(a)), 0.199, 0.039));
    }
    return d;
  }
  if (g == 7) {
    float d = min(asciiSlant(q, -0.12, 0.195, 0.35, 0.0, 0.7, h), asciiSlant(q, 0.12, 0.195, 0.35, 0.0, 0.7, h));
    d = min(d, sdBox(q, vec2(-0.027, 0.215), vec2(0.241, 0.0356)));
    return min(d, sdBox(q, vec2(0.027, 0.4875), vec2(0.241, 0.0356)));
  }
  if (g == 8) {
    float d = abs(asciiEllipse(q - vec2(-0.15, 0.515), vec2(0.105, 0.14))) - 0.0385;
    d = min(d, abs(asciiEllipse(q - vec2(0.15, 0.187), vec2(0.105, 0.14))) - 0.0385);
    return min(d, asciiSlant(q, 0.0, 0.55, 0.35, -0.005, 0.705, 0.05));
  }
  if (g == 9) {
    float d = asciiEllipseArc(q - vec2(0.0, 0.254), vec2(0.268, 0.4), radians(-16.0), radians(290.0), h);
    d = min(d, abs(asciiEllipse(q - vec2(-0.009, 0.253), vec2(0.112, 0.185))) - 0.0385);
    d = min(d, sdBox(q, vec2(0.111, 0.3225), vec2(0.042, 0.1525)));
    return min(d, asciiEllipseArc(q - vec2(0.188, 0.17), vec2(0.077, 0.115), radians(180.0), radians(346.0), h));
  }
  return 1e9;
}

// Ink of glyph g at q (em), box-filtered over one pixel of pxEm em.
float asciiInk(int g, vec2 q, float pxEm) {
  if (g <= 0) return 0.0;
  return saturate(0.5 - asciiGlyph(g, q) / pxEm);
}
`
