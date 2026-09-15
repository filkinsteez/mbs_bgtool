// Mix light rather than walking around the hue wheel. Preserve brightness,
// while allowing distant hues to meet through a less saturated transition.
export const COLOR_GLSL = `
vec3 rgbToHsv(vec3 c) {
  vec4 K=vec4(0.0,-1.0/3.0,2.0/3.0,-1.0);
  vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g));
  vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r));
  float d=q.x-min(q.w,q.y);
  return vec3(abs(q.z+(q.w-q.y)/(6.0*d+1e-10)),d/(q.x+1e-10),q.x);
}
vec3 hsvToRgb(vec3 c) {
  vec3 p=abs(fract(c.xxx+vec3(0.0,2.0/3.0,1.0/3.0))*6.0-3.0);
  return max(vec3(0.0),c.z*mix(vec3(1.0),clamp(p-1.0,0.0,1.0),clamp(c.y,0.0,1.0)));
}
vec3 colorMix(vec3 a,vec3 b,float t) {
  vec3 blend=pow(mix(pow(max(a,vec3(0.0)),vec3(2.2)),pow(max(b,vec3(0.0)),vec3(2.2)),t),vec3(1.0/2.2));
  float value=mix(max(a.r,max(a.g,a.b)),max(b.r,max(b.g,b.b)),t);
  return blend*value/max(1e-8,max(blend.r,max(blend.g,blend.b)));
}
`
