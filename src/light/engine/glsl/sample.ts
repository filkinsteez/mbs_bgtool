export const SAMPLE_GLSL = /* glsl */ `
vec4 bsplineWeights(float v) {
  vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v;
  vec4 s = n * n * n;
  float x = s.x;
  float y = s.y - 4.0 * s.x;
  float z = s.z - 4.0 * s.y + 6.0 * s.x;
  float w = 6.0 - x - y - z;
  return vec4(x, y, z, w) * (1.0 / 6.0);
}

// Cubic B-spline filtered sample from four bilinear taps (smooth, no ringing).
vec3 sampleSmooth(sampler2D tex, vec2 uv) {
  vec2 size = vec2(textureSize(tex, 0));
  vec2 st = uv * size - 0.5;
  vec2 fxy = fract(st);
  st -= fxy;
  vec4 xc = bsplineWeights(fxy.x);
  vec4 yc = bsplineWeights(fxy.y);
  vec4 c = st.xxyy + vec2(-0.5, 1.5).xyxy;
  vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
  vec4 offset = (c + vec4(xc.yw, yc.yw) / s) / size.xxyy;
  vec3 s0 = texture(tex, offset.xz).rgb;
  vec3 s1 = texture(tex, offset.yz).rgb;
  vec3 s2 = texture(tex, offset.xw).rgb;
  vec3 s3 = texture(tex, offset.yw).rgb;
  float sx = s.x / (s.x + s.y);
  float sy = s.z / (s.z + s.w);
  return mix(mix(s3, s2, sx), mix(s1, s0, sx), sy);
}
`
