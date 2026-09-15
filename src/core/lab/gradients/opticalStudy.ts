import { COLOR_GLSL } from './color'
import { SOURCE_GRADIENT_GLSL } from './legacySource'

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
uniform float seed, complexity, softness, distortion, warpScale, folds, grain, bleed, depth, reflow, sourceMode;
uniform int style;
uniform vec4 pigments[12];
uniform vec4 pigmentTints[12];
uniform vec3 groundPigment;
uniform vec3 darkPigment, lightPigment;
uniform sampler2D lookPalette;
uniform float paletteSpread;
uniform vec4 toneProfile;
uniform sampler2D influence;
uniform vec4 sourceRect;
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

// Unevenly focused color volumes. Broad diffusion, focused blooms, folded
// sheets, and horizontal exposure drag have separate spatial constructions.
vec3 deposits(vec2 q,vec2 s,vec2 aspect) {
  float travel=(reflow-0.5)*6.0;
  // Travel carries the field continuously; it does not reroll the recipe.
  q+=vec2(sin(travel*0.7),cos(travel*0.6)-1.0)*0.32;
  float total=0.0;
  vec2 tone=vec2(0.0);
  vec3 lightSum=vec3(0.0);
  float illumination=0.0;
  vec2 offset=vec2(hash(vec2(seed,91)),hash(vec2(seed,57)));
  float strength=smoothstep(0.0,0.45,depth);
  float concentration=depth<0.45
    ?mix(0.001,1.8,pow(depth/0.45,1.6))
    :mix(1.8,3.0,(depth-0.45)/0.55);
  // Large disturbances affect the whole exposure; smaller ones travel through
  // it. Their scales and directions differ, avoiding uniformly wobbly outlines.
  vec2 drift=vec2(fbm(q*0.83+s),fbm(q*0.91+s+17.3))-0.5;
  vec2 eddy=vec2(fbm(q*1.65+drift*2.2+s+31.4),fbm(q*1.3+drift*1.8+s+9.2))-0.5;
  vec2 volume=q+(drift*0.9+eddy*0.4)*(0.3+distortion*1.7);
  if(style==2) {
    // Two unequal moving vortices stretch and fold the same material. The
    // transport acts before color mixing, so seams do not get painted on top.
    for(int step=0;step<4;step++) for(int vortex=0;vortex<2;vortex++) {
      float side=vortex==0?1.0:-1.0;
      vec2 pivot=vec2(side*0.32,-side*0.16)+(offset-0.5)*0.3;
      vec2 relative=volume-pivot;
      float turn=side*(0.3+folds*0.85)*distortion*exp(-dot(relative,relative)*mix(1.5,3.1,float(vortex)));
      volume=pivot+mat2(cos(turn),-sin(turn),sin(turn),cos(turn))*relative;
    }
  }
  float flowAngle=-0.48+(offset.x-0.5)*0.7;
  vec2 stream=mat2(cos(flowAngle),-sin(flowAngle),sin(flowAngle),cos(flowAngle))*volume;
  for(int i=0;i<12;i++) {
    float fi=float(i), ci=pigments[i].a;
    vec2 rnd=vec2(hash(vec2(fi+7.0,seed+4.0)),hash(vec2(seed+11.0,fi+13.0)));
    float compositionAngle=(offset.x-0.5)*1.8;
    vec2 center=vec2(sin(ci*2.15+0.2)*0.32,cos(ci*1.7+0.4)*0.4);
    center=mat2(cos(compositionAngle),-sin(compositionAngle),sin(compositionAngle),cos(compositionAngle))*center;
    center+=(offset-0.5)*0.35;
    center*=sqrt(aspect);
    center+=vec2(sin(ci*2.4+travel)-sin(ci*2.4),cos(ci*1.7+travel)-cos(ci*1.7))*0.38;
    if(i>=8) center+=(rnd-0.5)*aspect*0.85;
    vec2 d=volume-center;
    float angle=(rnd.x-0.5)*4.0;
    d=mat2(cos(angle),-sin(angle),sin(angle),cos(angle))*d;
    float focus=noise(volume*0.74+s+ci*9.4);
    vec2 radii=(vec2(0.24,0.27)+rnd*vec2(0.36,0.52))*sqrt(aspect);
    radii*=mix(1.3,0.82,complexity);
    if(i>=8) radii*=0.6;
    vec2 local=d/radii;
    float distance=dot(local,local);
    // Focus is spatial, so a field can have one clear edge and disappear on
    // the other side. The long tail carries color far beyond the focused core.
    float falloff=mix(0.65,1.6,smoothstep(0.2,0.8,focus));
    falloff=mix(falloff,0.68,softness*0.45);
    float profile=pow(max(distance,0.0001),falloff);
    if(style==1) {
      vec2 lightCenter=(offset-0.5)*aspect*0.8;
      // Crop the broad bloom and offset its focused mass. No central hole or
      // prescribed ring: the halo comes from differently focused exposures.
      center=lightCenter+vec2(sin(ci*2.4+seed+travel)*0.32,cos(ci*1.9-seed+travel*0.7)*0.5);
      local=(volume-center)/(vec2(0.25,0.42)+rnd*0.28);
      distance=dot(local,local);
      profile=pow(max(distance,0.0001),mix(0.55,2.0,focus));
    } else if(style==2) {
      float lane=(fract(ci*0.618034+offset.y)-0.5)*1.15+0.48*(sin(travel+ci)-sin(ci));
      float sweep=sin(stream.x*1.25+seed*0.2+ci*0.35)*0.32;
      sweep+=(noise(vec2(stream.x*1.1+ci,s.y))-0.5)*(0.3+folds*0.55);
      float width=(0.11+softness*0.12)*mix(1.5,0.7,complexity);
      width*=0.5+noise(vec2(stream.x*1.6+fi,s.x))*1.7;
      float across=(stream.y-lane-sweep)/width;
      float along=(stream.x-(rnd.x-0.5)*aspect.x)/(0.55+rnd.y*1.8);
      local=vec2(along,across*0.3);
      profile=pow(abs(across),mix(1.1,3.2,focus))+along*along*0.18;
    }
    float weight=exp(-min(profile*concentration,45.0));
    if(style==1) {
      weight+=exp(-min(distance*concentration*0.18,45.0))*(0.02+bleed*0.06);
      if(ci==0.0) weight+=0.28*strength;
    }
    if(i>=8) weight*=0.38+complexity*0.3;
    weight*=1.0+(noise(volume*1.4+s+ci*6.4)-0.5)*0.8*strength;
    float seep=bleed*(0.05+noise(d*0.9+s+ci*5.2)*0.18);
    vec3 ink=colorMix(pigments[i].rgb,pigmentTints[i].rgb,seep);
    vec3 hsv=rgbToHsv(ink);
    // Broad light wells belong inside the material, independently of its edge.
    vec2 well=local*vec2(0.8,0.55)-(rnd-0.5)*1.7;
    float light=exp(-dot(well,well)*0.7);
    light*=0.3+0.7*noise(volume*1.1+s+fi*3.7);
    hsv.y*=1.0-light*(0.18+bleed*0.95)*paletteSpread*strength;
    float exposure=ci==0.0?0.18+light*0.65:1.0;
    illumination+=exposure*weight;
    lightSum+=pow(hsvToRgb(hsv),vec3(2.2))*weight;
    tone+=hsv.yz*weight; total+=weight;
  }
  vec2 target=tone/max(total,1e-30);
  vec3 mixed=rgbToHsv(pow(lightSum/max(total,1e-30),vec3(1.0/2.2)));
  float hue=mixed.x;
  target.x=mixed.y;
  float delta=target.y-toneProfile.z;
  float span=delta>=0.0?toneProfile.y-toneProfile.z:toneProfile.z-toneProfile.x;
  float gain=1.0+3.5*toneProfile.w*strength;
  target.y=toneProfile.z+delta*gain/(1.0+(gain-1.0)*abs(delta)/max(span,1e-5));
  target.y*=mix(1.0,illumination/max(total,1e-30),paletteSpread*strength);
  vec2 lightPoint=volume-(offset-0.5)*aspect*0.65;
  vec2 lightRadius=style==1?vec2(0.24,0.42):vec2(0.42,0.32);
  float flare=exp(-dot(lightPoint/lightRadius,lightPoint/lightRadius)*0.9);
  flare*=(style==1?1.4:0.5)*paletteSpread*strength*(0.4+bleed*0.6);
  target.y=1.0-(1.0-target.y)*exp(-flare);
  target.x*=exp(-flare*0.9);
  return hsvToRgb(vec3(hue,target));
}

${SOURCE_GRADIENT_GLSL}
void main() {
  vec2 aspect=resolution/min(resolution.x,resolution.y);
  vec4 packed=texture(deformation,uv)*255.0;
  vec2 displacement=(vec2(dot(packed.rg,vec2(256.0,1.0)),dot(packed.ba,vec2(256.0,1.0)))-32768.0)/16383.75;
  vec2 p=(uv+displacement*painted-0.5)*aspect;
  vec2 s=vec2(seed,seed*0.718)+motion;
  if(sourceMode>0.5) {
    fragColor=vec4(clamp(sourceGradient(p,s,aspect),0.0,1.0),1.0);
    return;
  }
  vec2 q=warp(p,s);
  if(style==3) {
    // Give Smear its own broad horizontal composition before scanline offsets.
    q=vec2(q.x*0.38+q.y*0.16,q.y*1.35);
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
  vec2 radius=(0.002+softness*softness*0.16*focus*focus)/aspect;
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
