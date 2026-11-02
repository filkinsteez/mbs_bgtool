export const COMMON_GLSL = /* glsl */ `
#define PI 3.141592653589793
#define TAU 6.283185307179586

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

float luminance(vec3 c) { return dot(c, LUMA); }
float saturate(float x) { return clamp(x, 0.0, 1.0); }
vec2 saturate(vec2 x) { return clamp(x, 0.0, 1.0); }
vec3 saturate(vec3 x) { return clamp(x, 0.0, 1.0); }
float maxComponent(vec3 c) { return max(c.r, max(c.g, c.b)); }

// 0 at a, 1 at b, clamped.
float remap01(float x, float a, float b) { return saturate((x - a) / (b - a)); }

// Rotates by angle radians (counterclockwise with y up, clockwise on screen with y down).
mat2 rotate2(float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return mat2(c, s, -s, c);
}

vec2 dirFromDegrees(float degrees) {
  float a = radians(degrees);
  return vec2(sin(a), cos(a));
}
`
