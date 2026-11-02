// Distances and radii share units (usually fractions of the frame's short side).
export const FALLOFF_GLSL = /* glsl */ `
float gaussian(float d, float sigma) {
  float x = d / max(sigma, 1e-6);
  return exp(-0.5 * x * x);
}

// Weighted sum of three gaussians: radii and weights for core, glow and haze.
float gaussianSum(float d, vec3 radii, vec3 weights) {
  vec3 x = d / max(radii, vec3(1e-6));
  return dot(weights, exp(-0.5 * x * x));
}

// 1 at d = 0, falling as 1 / d^2 far away.
float softInverseSquare(float d, float radius) {
  float x = d / max(radius, 1e-6);
  return 1.0 / (1.0 + x * x);
}

float expHaze(float d, float scale) {
  return exp(-max(d, 0.0) / max(scale, 1e-6));
}

// Sharp gaussian core plus a long inverse-square tail.
float coreTail(float d, float core, float tail, float tailWeight) {
  return gaussian(d, core) + tailWeight * softInverseSquare(d, tail);
}

// Standard normal CDF (Abramowitz and Stegun 7.1.26, error below 1.5e-7).
float gaussianCdf(float x) {
  float z = abs(x) * 0.70710678;
  float t = 1.0 / (1.0 + 0.3275911 * z);
  float poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  float erfZ = 1.0 - poly * exp(-z * z);
  return 0.5 * (1.0 + sign(x) * erfZ);
}

float gaussianPdf(float x) { return 0.39894228 * exp(-0.5 * x * x); }

// A unit step at 0 blurred by a gaussian of the given sigma.
float softStep(float x, float sigma) {
  return sigma <= 0.0 ? step(0.0, x) : gaussianCdf(x / sigma);
}

// max(x, 0) blurred by a gaussian of the given sigma.
float softRamp(float x, float sigma) {
  if (sigma <= 0.0) return max(x, 0.0);
  float z = x / sigma;
  return x * gaussianCdf(z) + sigma * gaussianPdf(z);
}
`
