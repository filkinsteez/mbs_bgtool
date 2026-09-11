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
uniform float paletteSpread;
uniform vec4 toneProfile;
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

// Continuous, overlapping color fields. There is no opaque interior or contour
// threshold: every region continues to change toward its neighbors.
vec3 deposits(vec2 q,vec2 s,vec2 aspect) {
  float hueSum=0.0, hueTotal=0.0;
  vec2 tone=vec2(0.0);
  float total=0.0;
  // A fixed hue interval for the entire image prevents layer-by-layer hue
  // flips. With the brand blue, warm colors blend through violet and pink.
  float hueStart=fract(rgbToHsv(groundPigment).x-0.2);
  vec2 offset=vec2(hash(vec2(seed,91)),hash(vec2(seed,57)));
  // The lower half now reaches a shallow wash. Keep the existing default
  // concentration at 45%, then increase separation toward the right.
  float concentration=depth<0.45
    ?mix(0.001,2.54,pow(depth/0.45,1.6))
    :mix(2.54,3.2,(depth-0.45)/0.55);
  vec2 halo=(q-(offset-0.5)*aspect*0.35)/vec2(1.25,0.9);
  float haloAngle=atan(halo.y,halo.x);
  // Angular variation must disappear at the polar origin, including when
  // low Depth fills the opening. Otherwise the wash develops a pinched star.
  float haloAngular=smoothstep(0.04,0.3,length(halo));
  float haloRadius=0.42+haloAngular*(0.055*sin(haloAngle*2.0+seed)
    +0.035*sin(haloAngle*3.0-seed*0.7)*distortion);
  float flowAngle=-0.38+(offset.x-0.5)*0.6;
  vec2 stream=mat2(cos(flowAngle),-sin(flowAngle),sin(flowAngle),cos(flowAngle))*q;
  for(int i=0;i<12;i++) {
    float fi=float(i);
    vec2 rnd=vec2(hash(vec2(fi+7.0,seed+4.0)),hash(vec2(seed+11.0,fi+13.0)));
    // Repeated samples of one swatch form a loose region. Spreading every
    // swatch over the whole frame would average away the palette's extremes.
    float colorIndex=pigments[i].a;
    vec2 secondary=i>=8?vec2(0.42,0.31):vec2(0.0);
    vec2 center=(fract(vec2(colorIndex*0.618034,colorIndex*0.414214)+offset+secondary)-0.5)*aspect*1.45;
    center+=(rnd-0.5)*aspect*0.3;
    vec2 d=q-center;
    float angle=(rnd.x-0.5)*4.0;
    d=mat2(cos(angle),-sin(angle),sin(angle),cos(angle))*d;
    // Focus changes the width of the entire field, not a glow at its border.
    float focus=noise(q*0.7+s+fi*3.9);
    vec2 radii=(vec2(0.25,0.3)+rnd*vec2(0.25,0.35))*sqrt(aspect);
    radii*=mix(1.3,0.95,complexity)*mix(1.05,1.3,softness);
    radii*=mix(0.85,1.2,focus);
    if(i>=8) radii*=0.7;
    d+=(vec2(fbm(d*1.1+s+fi*5.1),fbm(d*1.3+s+fi*7.3+19.0))-0.5)*(0.25+folds*0.65)*distortion;
    vec2 local=d/radii;
    float distance=dot(local,local);
    if(style==1) {
      // All color fields share one irregular loop, each occupying a different
      // arc. The ring opens and dissolves rather than repeating in concentric bands.
      float arc=colorIndex*2.399963+seed*0.13;
      float arcDistance=1.0-cos(haloAngle-arc);
      distance=(0.6+complexity*0.8)*arcDistance*haloAngular;
      // Light variation follows the loop itself, not its empty center.
      local=vec2((length(halo)-haloRadius)/(0.1+softness*0.16),sin(haloAngle-arc)*0.5);
    } else if(style==2) {
      // Long, separate streams share a direction but have independent bends,
      // widths, and endpoints. This is not a stretched cloud field.
      float lane=(fract(colorIndex*0.618034+offset.y)-0.5)*1.35;
      float bend=sin(stream.x*1.55+seed*0.3)*0.22
        +sin(stream.x*2.9+colorIndex*1.7+seed)*0.1;
      bend*=0.35+distortion*0.65;
      lane+=(rnd.y-0.5)*0.18;
      if(i>=8) lane+=0.2*sin(stream.x*2.1+fi);
      float width=(0.065+softness*0.1)*(0.55+noise(vec2(stream.x*1.7+fi,s.y))*1.3);
      width*=mix(1.35,0.7,complexity);
      float across=(stream.y-lane-bend)/width;
      float along=(stream.x-(rnd.x-0.5)*aspect.x)/(0.65+rnd.y*1.4);
      distance=across*across+along*along*0.16;
      local=vec2(along,across*0.2);
    }
    float weight=exp(-min(distance*concentration,45.0));
    // The lead supplies Halo's open center and surrounding ground. Repeating
    // it at full strength in the loop would erase whole sections of the form.
    if(style==1 && colorIndex==0.0) weight*=0.08;
    if(i>=8) weight*=0.55;
    if(style==2 && i>=8) weight*=complexity*1.3;
    weight*=1.0+(noise(d*0.8+s+fi*4.7)-0.5)*0.5*smoothstep(0.0,0.45,depth);
    float seep=bleed*noise(d*1.25+s+fi*5.2)*0.22;
    if(style==2) seep=bleed*(0.12+noise(vec2(stream.x*1.1+fi,s.x+colorIndex))*0.6);
    vec3 ink=colorMix(pigments[i].rgb,pigmentTints[i].rgb,seep);
    vec3 hsv=rgbToHsv(ink);
    float hue=fract(hsv.x-hueStart)+hueStart;
    float chromaticWeight=weight*hsv.y;
    hueSum+=hue*chromaticWeight;
    hueTotal+=chromaticWeight;
    // Internal light variation has its own broad footprint; it never traces
    // the boundary between two different colors.
    vec2 glow=local-vec2(rnd.x-0.5,rnd.y-0.5)*1.1;
    float lightStrength=(0.12+bleed*0.8)*(1.0+toneProfile.w*1.2);
    hsv.y*=1.0-exp(-dot(glow,glow)*1.3)*min(lightStrength,0.95)*rnd.y*paletteSpread*smoothstep(0.0,0.4,depth);
    tone+=hsv.yz*weight;
    total+=weight;
  }
  vec2 target=tone/max(total,1e-30);
  float hue=hueSum/max(hueTotal,1e-30);
  if(style==1) {
    // Keep loop coverage independent of its palette. Otherwise a low-weight
    // color removes an arc and leaves unrelated floating patches.
    // In close-hue palettes, distribute their light and dark endpoints around
    // the loop so its visibility does not depend on a lucky hue assignment.
    float arcTone=smoothstep(-0.6,0.65,sin(haloAngle-seed*0.17));
    target.y=mix(target.y,mix(toneProfile.x,toneProfile.y,arcTone),0.65*toneProfile.w*haloAngular*smoothstep(0.0,0.45,depth));
    float focusAround=mix(0.5,noise(vec2(cos(haloAngle),sin(haloAngle))*1.4+s),haloAngular);
    float width=(0.075+softness*0.16)*(0.8+focusAround*0.65);
    float radial=(length(halo)-haloRadius)/width;
    float aperture=mix(1.0,smoothstep(0.16,0.32,length(halo)),smoothstep(0.05,0.4,depth));
    float opening=mix(1.0,0.35+0.65*smoothstep(-0.8,0.4,cos(haloAngle-seed*0.17)),smoothstep(0.0,0.4,depth)*haloAngular);
    float alpha=(1.0-exp(-3.2*exp(-min(radial*radial*concentration,45.0))))*aperture*opening;
    vec3 ground=rgbToHsv(groundPigment);
    float groundHue=fract(ground.x-hueStart)+hueStart;
    ground.y*=1.0-exp(-dot(halo,halo)*2.0)*0.15*paletteSpread*smoothstep(0.0,0.4,depth);
    float chroma=(1.0-alpha)*ground.y+alpha*target.x;
    hue=(groundHue*ground.y*(1.0-alpha)+hue*target.x*alpha)/max(chroma,1e-30);
    target=mix(ground.yz,target,alpha);
  }
  // Recover light/dark separation lost when similar hues overlap. The smooth
  // curve stays inside the selected brightness range and vanishes at Depth 0.
  float delta=target.y-toneProfile.z;
  float span=delta>=0.0?toneProfile.y-toneProfile.z:toneProfile.z-toneProfile.x;
  float gain=1.0+3.5*toneProfile.w*smoothstep(0.0,0.45,depth);
  target.y=toneProfile.z+delta*gain/(1.0+(gain-1.0)*abs(delta)/max(span,1e-5));
  return hsvToRgb(vec3(hue,target));
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
