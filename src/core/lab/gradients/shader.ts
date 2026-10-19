import { COLOR_GLSL } from './color'
import { SOURCE_GRADIENT_GLSL } from './source'
import { GRADIENT_FAMILIES_GLSL } from './families'
import { DIFFUSION_GLSL } from './diffusion'
import { FLOW_GLSL } from './flow'
import { FLOW_SOURCE_GLSL } from './flowSource'
import { SMEAR_GLSL } from './smear'

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
uniform vec2 gradientCenter;
uniform float seed, complexity, softness, distortion, warpScale, folds, grain, bleed, depth, reflow, sourceMode, orientation;
uniform int style;
uniform vec4 pigments[49];
uniform vec2 pigmentIntervals[49];
uniform int pigmentCount;
uniform int sourceInk, sourceGround;
uniform vec3 averagePigment;
uniform vec3 lumaProfile;
uniform vec3 groundPigment;
uniform vec3 darkPigment, lightPigment;
uniform vec3 darkTip, lightTip;
uniform sampler2D lookPalette;
uniform float paletteSpread;
uniform vec4 toneProfile;
uniform sampler2D influence;
uniform vec4 sourceRect;
uniform vec4 sourceFocus;
uniform vec2 sourceAxis;
uniform sampler2D transportStats;
uniform float transportMeasure, transportStatsReady;
uniform sampler2D transportRank;
uniform float transportRankMeasure;
uniform sampler2D flowEmission;
uniform float flowEmissionMeasure,flowEmissionReady;
uniform sampler2D deformation;
uniform float painted;
uniform float useSpatialField;
uniform vec4 spatialSources[3];
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
  // Complexity changes the size and number of visible bends, not just which
  // pigment occupies an otherwise identical distortion field. The midpoint
  // keeps the established composition.
  float structureScale=exp2((complexity-.5)*2.4);
  p*=structureScale;
  float scale=mix(7.5,0.32,warpScale);
  float amount=distortion*exp2((distortion-.45)*2.0);
  float bendDetail=mix(.2,1.0,smoothstep(0.0,.5,complexity));
  float foldAmount=folds*(.55+folds*1.4)*(1.0+.7*smoothstep(.32,1.0,folds))*bendDetail;
  vec2 q=p;
  q.x+=pow(folds,3.0)*.70*bendDetail*sin(p.y*3.0+seed*.1);
  q.y+=pow(folds,3.0)*.80*bendDetail*sin(p.x*2.8+seed*.23);
  for(int i=0;i<4;i++) {
    vec2 z=q*scale+s;
    float e=0.035;
    vec2 curl=vec2(noise(z+vec2(0,e))-noise(z-vec2(0,e)),noise(z-vec2(e,0))-noise(z+vec2(e,0)))/(2.0*e);
    q+=curl*(0.014+foldAmount*0.065)*amount/scale;
  }
  q+=(vec2(noise(q*scale+s+5.1),noise(q*scale+s+vec2(15.8,3.4)))-0.5)*amount*(0.18+foldAmount*0.45+distortion*distortion*.50);
  vec2 center=(vec2(hash(s+41.0),hash(s+59.0))-.5)*.5;
  vec2 d=q-center;
  float radius=mix(.10,.85,warpScale);
  float angle=pow(folds,1.7)*distortion*15.0*bendDetail*exp(-dot(d,d)/(radius*radius));
  q=center+mat2(cos(angle),-sin(angle),sin(angle),cos(angle))*d;
  center+=vec2(-.42,.18);
  d=q-center;
  angle=-folds*folds*distortion*16.0*bendDetail*exp(-dot(d,d)/(radius*radius*.56));
  q=center+mat2(cos(angle),-sin(angle),sin(angle),cos(angle))*d;
  return q/structureScale;
}

${FLOW_GLSL}
${SMEAR_GLSL}
${GRADIENT_FAMILIES_GLSL}
${DIFFUSION_GLSL}
vec3 coloredSourceFlow(vec2 p,vec2 s,vec2 aspect);
${SOURCE_GRADIENT_GLSL}
${FLOW_SOURCE_GLSL}
vec4 exposureColor(vec3 color) {
  color=clamp(color,0.0,1.0);
  return vec4(color,max(color.r,max(color.g,color.b)));
}

vec3 spatialFieldColor(vec2 sampleUv, vec2 aspect) {
  if (pigmentCount <= 0) return vec3(0.0);
  if (pigmentCount == 1) return pigments[0].rgb;
  vec3 accum = vec3(0.0);
  float total = 0.0;
  for (int i = 0; i < 3; i++) {
    if (i >= pigmentCount) break;
    vec4 source = spatialSources[i];
    if (source.w < 0.5) continue;
    vec2 delta = (sampleUv - source.xy) * aspect;
    float spread = max(0.05, source.z);
    float field = exp(-dot(delta, delta) / max(0.0016, spread * spread));
    float share = max(0.001, pigments[i].a);
    float weight = field * share + share * 0.035;
    accum += pigments[i].rgb * weight;
    total += weight;
  }
  if (total <= 1e-5) return pigments[0].rgb;
  return accum / total;
}
void main() {
  vec2 aspect=resolution/min(resolution.x,resolution.y);
  float ang = orientation * 0.017453292519943295;
  mat2 orient = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
  vec2 s=vec2(seed,seed*0.718);
  vec4 packed=texture(deformation,uv)*255.0;
  vec2 displacement=(vec2(dot(packed.rg,vec2(256.0,1.0)),dot(packed.ba,vec2(256.0,1.0)))-32768.0)/16383.75;
  vec2 p=orient*((uv+displacement*painted-gradientCenter)*aspect);
  vec2 sampleUv = clamp(uv + displacement * painted, 0.0, 1.0);
  if (useSpatialField > 0.5) {
    vec3 fieldColor = spatialFieldColor(sampleUv, aspect);
    if (sourceMode > 0.5) {
      vec3 sourceColor = sourceGradient(p, s, aspect);
      float luma = dot(sourceColor, vec3(0.2126, 0.7152, 0.0722));
      fragColor = exposureColor(mix(fieldColor, colorMix(fieldColor, sourceColor, 0.7), clamp(luma, 0.0, 1.0)));
    } else {
      fragColor = exposureColor(fieldColor);
    }
    return;
  }
  if(style==2 && flowEmissionMeasure>.5) { fragColor=sourceFlowEmission(vec2(uv.x,1.0-uv.y)); return; }
  if(style!=2 && transportMeasure>.5) {
    vec4 field=transportSource(p,s,aspect,vec2(0.0)).field;
    float exposure=log(max(.0001,field.a)+.05);
    fragColor=vec4(field.r,field.r*field.r,exposure,exposure*exposure);
    return;
  }
  if(style!=2 && transportRankMeasure>.5) {
    vec4 moments=textureLod(transportStats,vec2(.5),7.0);
    float deviation=max(.035,sqrt(max(0.0,moments.w-moments.z*moments.z)));
    float target=moments.z+(uv.x-.5)*8.0*deviation;
    float rank=0.0;
    for(int y=0;y<32;y++) for(int x=0;x<32;x++) {
      vec2 point=(vec2(x,y)+.5)/32.0;
      float exposure=textureLod(transportStats,point,0.0).z;
      rank+=smoothstep(exposure-deviation*.035,exposure+deviation*.035,target);
    }
    fragColor=vec4(vec3(rank/1024.0),1.0);
    return;
  }
  if(sourceMode>0.5) {
    if(pigmentCount==1) { fragColor=exposureColor(pigments[0].rgb); return; }
    fragColor=exposureColor(sourceGradient(p,s,aspect));
    return;
  }
  vec2 q=warp(p,s);
  if(style==1) { fragColor=exposureColor(aperture(p,s,aspect)); return; }
  if(style==2) { fragColor=exposureColor(ribbons(flowCoordinates(p,s),s,aspect)); return; }
  if(style==3) { fragColor=exposureColor(heldBands(p,s,aspect)); return; }
  vec3 c=diffuseDye(q,s,aspect);
  fragColor=exposureColor(c);
}`

// Scatter the combined image after the deposits overlap. Brighter neighbors
// spill into darker regions, with focus changing across the frame.
export const GRADIENT_SCATTER = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 fragColor;
uniform sampler2D exposure;
uniform vec2 resolution;
uniform vec2 gradientCenter;
uniform float softness,bleed,grain,seed,orientation;
uniform int style;
${COLOR_GLSL}
float hash(vec2 p) {
  vec3 q=fract(vec3(p.xyx)*0.1031);
  q+=dot(q,q.yzx+33.33);
  return fract((q.x+q.y)*q.z);
}
vec3 sampleExposure(vec2 p,float lod) {
  vec4 sampleColor=textureLod(exposure,vec2(p.x,1.0-p.y),lod);
  // Bilinear RGB filtering at a thin red/blue break used to add a dark seam.
  // Interpolate brightness independently, recorded by the exposure pass.
  float value=max(sampleColor.r,max(sampleColor.g,sampleColor.b));
  return sampleColor.rgb*sampleColor.a/max(value,1e-8);
}
void main() {
  vec2 aspect=resolution/min(resolution.x,resolution.y);
  float ang = orientation * 0.017453292519943295;
  mat2 orient = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
  mat2 sampleOrient = mat2(cos(ang), sin(ang), -sin(ang), cos(ang));
  vec2 p=orient*((uv-gradientCenter)*aspect);
  float focus=0.5+0.25*sin(p.x*3.1+seed)+0.25*sin(p.y*4.3-seed*0.71+p.x*1.1);
  vec2 radius=(0.001+softness*softness*0.038*focus*focus)/aspect;
  if(style==0) radius*=mix(2.0,20.0,pow(softness,4.0));
  if(style==1) radius*=mix(.2,26.0,pow(softness,4.0));
  if(style==2) radius*=.3;
  if(style==3) {
    float soft=softness<.65?softness*(2.0-softness/.65):softness;
    float broad=smoothstep(.65,1.0,soft);
    float horizontal=soft*.4225+.5775*broad;
    float vertical=soft*soft*.4225+.5775*broad;
    radius=vec2(.001+horizontal*.48*(.3+focus*focus),.0005+vertical*.30*(.4+focus))/aspect;
  }
  if(style==3) radius*=1.0+1.4*smoothstep(.65,1.0,softness);
  float lod=style!=2?max(0.0,log2(max(1.0,min(radius.x*resolution.x,radius.y*resolution.y)*.65))):0.0;
  vec3 original=sampleExposure(uv,0.0);
  float originalShare=style!=2?mix(.2,.015,pow(softness,3.0)):.2;
  vec3 blurred=original*originalShare;
  vec2 saturationValue=rgbToHsv(original).yz*originalShare;
  int samples=style!=2?32:12;
  for(int i=0;i<32;i++) {
    if(i>=samples) break;
    float angle=float(i)*2.399963;
    vec2 disk=vec2(cos(angle),sin(angle))*sqrt((float(i)+0.5)/float(samples));
    vec2 sampleOffset=sampleOrient*(disk*radius);
    vec3 nearColor=sampleExposure(uv+sampleOffset,lod);
    vec3 farColor=sampleExposure(uv+sampleOffset*(2.0+bleed*2.0),lod);
    vec3 scattered=colorMix(nearColor,farColor,bleed*0.16);
    blurred+=scattered*((1.0-originalShare)/float(samples));
    saturationValue+=rgbToHsv(scattered).yz*((1.0-originalShare)/float(samples));
  }
  vec3 c=blurred*saturationValue.y/max(1e-8,max(blurred.r,max(blurred.g,blurred.b)));
  vec2 pixel=uv*resolution;
  float g=hash(pixel+seed*15.0)+hash(pixel*1.317+vec2(31.7,seed))-1.0;
  float density=0.45+0.55*sqrt(max(0.0,dot(c,vec3(0.2126,0.7152,0.0722))));
  c+=g*grain*0.19*density;
  fragColor=vec4(clamp(c,0.0,1.0),1.0);
}`
