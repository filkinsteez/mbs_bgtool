export const GPU_SDF_GLSL = /* glsl */ `
float sminPoly(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

vec4 sampleInfluence(sampler2D textureId, vec2 uv) {
  return texture(textureId, clamp(uv, 0.0, 1.0));
}

float signedDistanceFromInfluence(vec4 influenceSampleValue) {
  float inside = influenceSampleValue.r;
  float edgeDistance = influenceSampleValue.g;
  float signValue = mix(-1.0, 1.0, step(0.5, inside));
  return signValue * edgeDistance;
}

float smoothBand(float sd, float center, float width) {
  float d = abs(sd - center);
  return 1.0 - smoothstep(width, width * 1.45, d);
}

float sdfOffsetCurve(float sd, float offset, float blur) {
  return 1.0 - smoothstep(blur, blur * 1.6, abs(sd - offset));
}
`
