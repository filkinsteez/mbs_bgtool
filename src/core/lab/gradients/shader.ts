// Preserve the input saturation and brightness through color overlaps.
// Use the RGB mixture's hue to avoid shortest-hue branch seams in layered fields.
const COLOR_GLSL = `
vec3 rgbToHsv(vec3 c) {
  vec4 K=vec4(0.0,-1.0/3.0,2.0/3.0,-1.0);
  vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g));
  vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r));
  float d=q.x-min(q.w,q.y);
  return vec3(abs(q.z+(q.w-q.y)/(6.0*d+1e-10)),d/(q.x+1e-10),q.x);
}
vec3 hsvToRgb(vec3 c) {
  vec3 p=abs(fract(c.xxx+vec3(0.0,2.0/3.0,1.0/3.0))*6.0-3.0);
  return c.z*mix(vec3(1.0),clamp(p-1.0,0.0,1.0),c.y);
}
vec3 colorMix(vec3 a,vec3 b,float t) {
  vec3 x=rgbToHsv(a),y=rgbToHsv(b);
  vec3 blend=rgbToHsv(mix(a,b,t));
  vec2 target=mix(x.yz,y.yz,t);
  // Opposing hues meet through a bright transition. Forcing full saturation
  // at that crossing would turn tiny hue changes into hard rainbow outlines.
  blend.y=mix(blend.y,target.x,0.65*smoothstep(0.08,0.65,blend.y));
  blend.z=target.y;
  return hsvToRgb(blend);
}
`

export const GRADIENT_VERTEX = `#version 300 es
precision highp float;
out vec2 uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  uv = vec2(p.x, 1.0-p.y);
  gl_Position = vec4(p*2.0-1.0, 0.0, 1.0);
}`

export const GRADIENT_FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 fragColor;
uniform vec2 resolution;
uniform vec2 motion;
uniform float seed, complexity, softness, distortion, warpScale, folds, grain, bleed, depth;
uniform int style;
uniform vec4 pigments[12];
uniform vec4 pigmentTints[12];
uniform vec3 groundPigment;
uniform float groundShare;
uniform sampler2D influence;
uniform sampler2D deformation;
uniform float painted;
${COLOR_GLSL}

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx)*0.1031);
  q += dot(q,q.yzx+33.33);
  return fract((q.x+q.y)*q.z);
}
float noise(vec2 p) {
  vec2 i=floor(p), f=fract(p);
  vec2 u=f*f*f*(f*(f*6.0-15.0)+10.0);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);
}
float fbm(vec2 p) {
  float v=0.0,a=0.57;
  for(int i=0;i<3;i++) { v+=a*noise(p); p=mat2(0.8,-0.6,0.6,0.8)*p*2.03+7.31; a*=0.43; }
  return v;
}
vec2 warp(vec2 p,vec2 s) {
  float scale=mix(4.8,0.65,warpScale);
  vec2 q=p;
  for(int i=0;i<4;i++) {
    vec2 z=q*scale+s;
    float e=0.035;
    vec2 curl=vec2(noise(z+vec2(0,e))-noise(z-vec2(0,e)),noise(z-vec2(e,0))-noise(z+vec2(e,0)))/(2.0*e);
    q+=curl*(0.014+folds*0.065)*distortion/scale;
  }
  q+=(vec2(noise(q*scale+s+5.1),noise(q*scale+s+vec2(15.8,3.4)))-0.5)*distortion*(0.18+folds*0.45);
  return q;
}

// A deposit has its own footprint, focus, density and scattering radius. The
// colors are not positions on one ramp: they can meet in any direction.
vec3 deposits(vec2 q,vec2 s,vec2 aspect) {
  vec3 light=groundPigment;
  vec2 offset=vec2(hash(vec2(seed,91)),hash(vec2(seed,57)));
  for(int i=0;i<12;i++) {
    float fi=float(i);
    vec2 rnd=vec2(hash(vec2(fi+7.0,seed+4.0)),hash(vec2(seed+11.0,fi+13.0)));
    vec2 center=(fract(vec2(fi*0.754877,fi*0.56984)+offset)-0.5)*aspect*1.55;
    vec2 d=q-center;
    float angle=(rnd.x-0.5)*4.0;
    if(style==2) angle=(rnd.x-0.5)*0.9-0.35;
    d=mat2(cos(angle),-sin(angle),sin(angle),cos(angle))*d;
    vec2 radii=(vec2(0.2,0.24)+rnd*vec2(0.46,0.48))*sqrt(aspect);
    radii*=mix(1.25,0.72,complexity);
    radii*=clamp(pow((1.0-groundShare)/0.6,0.55),0.12,1.5);
    if(i>=6) radii*=0.7;
    if(style==2) { radii*=vec2(1.7,0.62); d.y+=sin(d.x*2.0+fi)*0.12*distortion; }
    vec2 local=d/radii;
    float irregular=(fbm(d*2.0+s+fi*7.3)-0.5)*(0.16+distortion*0.35);
    float power=2.1+rnd.y*1.7;
    float distance=pow(pow(abs(local.x),power)+pow(abs(local.y),power),1.0/power)+irregular;
    float focus=noise(q*1.45+s+vec2(fi*3.1,fi*7.7));
    float feather=(0.035+softness*0.36)*(0.16+focus*focus*focus*7.5);
    feather*=mix(1.3,0.65,depth*focus);
    // Diffusion keeps just occasional focused edges; other treatments expose
    // more of the deposits' boundaries without sharpening the whole image.
    if(style==0) feather*=1.3;
    float body=1.0/(1.0+exp(clamp((distance-0.95)/feather,-35.0,35.0)));
    if(style==1 && i<6) {
      float inner=1.0/(1.0+exp(clamp((distance-(0.42+rnd.y*0.2))/(feather*1.35),-35.0,35.0)));
      body=max(0.0,body-inner*0.88);
    }
    float gain=mix(0.92,1.2,rnd.y)*(i<6?1.0:0.9);
    float wetness=0.68+noise(d*1.7+s+fi*3.7)*0.64;
    float w=clamp(pow(body,mix(1.1,1.8,depth))*gain*wetness,0.0,0.995);
    // Wider, slightly displaced tails let colors bleed beyond a focused edge.
    vec2 tail=local+vec2(0.18,-0.12)*(rnd-0.5);
    float fog=exp(-dot(tail,tail)*mix(1.6,0.48,bleed))*gain;
    float seep=bleed*noise(q*1.7+s+fi*5.2)*0.3;
    vec3 ink=colorMix(pigments[i].rgb,pigmentTints[i].rgb,seep);
    w=1.0-(1.0-w)*(1.0-clamp(fog*bleed*0.05,0.0,0.15));
    light=colorMix(light,ink,w);
  }
  return light;
}

void main() {
  vec2 aspect=resolution/min(resolution.x,resolution.y);
  vec4 packed=texture(deformation,uv)*255.0;
  vec2 displacement=(vec2(dot(packed.rg,vec2(256.0,1.0)),dot(packed.ba,vec2(256.0,1.0)))-32768.0)/16383.75;
  vec2 p=(uv+displacement*painted-0.5)*aspect;
  vec2 s=vec2(seed,seed*0.718)+motion;
  vec2 q=warp(p,s);
  vec2 source=texture(influence,uv).rg;
  q+=vec2(0.045,-0.075)*source.r;
  q.y+=(source.g-0.5)*0.24;
  if(style==3) {
    float row=floor((p.y+2.0)*mix(100.0,310.0,complexity));
    float coarse=noise(vec2(floor((p.y+2.0)*17.0),seed+3.0));
    float fine=hash(vec2(row,seed+7.0));
    float pocket=smoothstep(0.35,0.75,fbm(p*vec2(0.9,1.8)+s));
    q.x+=((coarse-0.5)*0.6+(fine-0.5)*0.32)*distortion*pocket;
    q.y+=(fine-0.5)*distortion*0.025*pocket;
    float band=floor((p.y+2.0)*(8.0+complexity*13.0));
    float hold=smoothstep(0.68,0.98,hash(vec2(band,seed+53.0)))*distortion*(1.0-softness);
    float origin=(hash(vec2(seed+31.0,band))-0.5)*aspect.x;
    q.x=mix(q.x,origin,hold*pocket*smoothstep(origin-0.1,origin+0.15,p.x));
  }
  vec3 c=deposits(q,s,aspect);
  fragColor=vec4(clamp(c,0.0,1.0),1.0);
}`

// Scatter the combined image after the deposits overlap. Brighter neighbors
// spill into darker regions, with focus changing across the frame.
export const GRADIENT_SCATTER = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 fragColor;
uniform sampler2D exposure;
uniform vec2 resolution;
uniform float softness,bleed,grain,seed;
uniform int style;
${COLOR_GLSL}
float hash(vec2 p) {
  vec3 q=fract(vec3(p.xyx)*0.1031);
  q+=dot(q,q.yzx+33.33);
  return fract((q.x+q.y)*q.z);
}
vec3 sampleExposure(vec2 p) { return texture(exposure,vec2(p.x,1.0-p.y)).rgb; }
void main() {
  vec2 aspect=resolution/min(resolution.x,resolution.y);
  vec2 p=(uv-0.5)*aspect;
  float focus=0.5+0.25*sin(p.x*3.1+seed)+0.25*sin(p.y*4.3-seed*0.71+p.x*1.1);
  vec2 radius=(0.001+softness*softness*0.038*focus*focus)/aspect;
  if(style==3) radius.y*=0.08;
  vec3 original=sampleExposure(uv);
  vec3 blurred=original*0.2;
  vec2 saturationValue=rgbToHsv(original).yz*0.2;
  for(int i=0;i<12;i++) {
    float angle=float(i)*2.399963;
    vec2 disk=vec2(cos(angle),sin(angle))*sqrt((float(i)+0.5)/12.0);
    vec3 nearColor=sampleExposure(uv+disk*radius);
    vec3 farColor=sampleExposure(uv+disk*radius*(2.0+bleed*2.0));
    vec3 scattered=colorMix(nearColor,farColor,bleed*0.16);
    blurred+=scattered*(0.8/12.0);
    saturationValue+=rgbToHsv(scattered).yz*(0.8/12.0);
  }
  vec3 c=hsvToRgb(vec3(rgbToHsv(blurred).x,saturationValue));
  vec2 pixel=uv*resolution;
  float g=hash(pixel+seed*15.0)+hash(pixel*1.317+vec2(31.7,seed))-1.0;
  float density=0.45+0.55*sqrt(max(0.0,dot(c,vec3(0.2126,0.7152,0.0722))));
  c+=g*grain*0.19*density;
  fragColor=vec4(clamp(c,0.0,1.0),1.0);
}`
