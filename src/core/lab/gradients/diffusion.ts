// Unequal open fronts share a transport field. Weights control density continuously.
export const DIFFUSION_GLSL = `
vec2 dyeVelocity(vec2 p,vec2 s) {
  float e=.035;
  vec2 z=p*1.6+s;
  vec2 curl=vec2(noise(z+vec2(0,e))-noise(z-vec2(0,e)),noise(z-vec2(e,0))-noise(z+vec2(e,0)))/(2.0*e);
  vec2 a=p-vec2(.22,-.11),b=p-vec2(-.37,.24);
  return curl*.065+vec2(-a.y,a.x)*.075/(.12+dot(a,a))-vec2(-b.y,b.x)*.055/(.12+dot(b,b))+vec2(.035,-.012);
}
vec3 diffuseDye(vec2 p,vec2 s,vec2 aspect) {
  vec2 q=p/sqrt(aspect)+(s-vec2(seed,seed*.718))*.28;
  q*=mix(1.65,.60,warpScale);
  float dt=(.35+reflow*(7.0+3.0*smoothstep(.5,1.0,reflow)))*(0.35+distortion)/10.0;
  dt*=.25+complexity*1.5;
  for(int i=0;i<10;i++) {
    vec2 v=dyeVelocity(q,s);
    q+=dyeVelocity(q+v*dt*.5,s)*dt;
  }
  vec3 light=vec3(0.0); float total=0.0,value=0.0;
  float power=mix(.20,3.4,pow(depth,.48))*exp2((depth-.45)*2.0);
  power*=exp2((.65-softness)*1.2);
  for(int i=0;i<49;i++) {
    if(i>=pigmentCount) break;
    vec3 ink=pigments[i].rgb;
    float key=dot(ink,vec3(137.3,78.17,241.53));
    float mass=0.0;
    for(int j=0;j<6;j++) {
      float activation=j==0?1.0:smoothstep(float(j),float(j+1),1.0+complexity*5.0);
      float k=key+float(j)*37.73;
      vec2 rnd=vec2(hash(vec2(k,seed+9.7)),hash(vec2(seed+31.1,k)));
      vec2 center=(rnd-.5)*vec2(2.5,1.8);
      float angle=hash(vec2(seed,k+17.0))*6.283185;
      vec2 d=mat2(cos(angle),-sin(angle),sin(angle),cos(angle))*(q-center);
      float radius=(.10+hash(vec2(k+4.0,seed))*.36)*mix(1.65,.60,complexity);
      radius+=(pow(softness,3.0)*(.36+.3*smoothstep(.65,1.0,softness))+pow(bleed,3.0)*.30)*mix(1.0,.42,complexity);
      float uneven=.68+.54*noise(q*(1.2+complexity*2.1)+s+k);
      float reach=.15+bleed*.85;
      float front=smoothstep(-reach,reach,d.x+noise(q*1.4+s+k*.13)*.34);
      float length=.25+hash(vec2(k+91.0,seed))*.8;
      float release=.08+softness*softness*.30+bleed*bleed*.20;
      float taper=exp(-pow(max(0.0,d.x-length)/release,2.0));
      float deposit=exp(-min(d.y*d.y/(radius*radius*uneven),35.0))*(.02+.98*front)*(.5+rnd.x);
      deposit*=mix(1.0,taper,smoothstep(0.0,.75,complexity));
      // Concentrate each finite deposit before combining it. Raising the
      // sum amplified overlap and made high Complexity average into a wash.
      mass+=activation*pow(max(deposit,1e-12),power);
    }
    float tonalFront=.5+q.y*.8+q.x*.24;
    tonalFront+=(noise(q*mix(.65,4.4,complexity)+s+vec2(7.3,19.7))-.5)*mix(.08,1.35,complexity);
    float target=(dot(ink,vec3(.2126,.7152,.0722))-lumaProfile.x)/max(.01,lumaProfile.y-lumaProfile.x);
    float monochrome=exp(-pow((tonalFront-target)/(.12+pow(softness,3.0)*(1.0+.7*smoothstep(.65,1.0,softness))),2.0)*power);
    float dispersed=exp(-pow((tonalFront-target-.30-pow(bleed,4.0)*.30)/.65,2.0)*power);
    monochrome=mix(monochrome,dispersed,pow(bleed,3.0)*.90);
    float density=mix(mass,monochrome,toneProfile.w);
    float weight=(density+.000002)*pigments[i].a;
    light+=pow(ink,vec3(2.2))*weight;
    value+=max(ink.r,max(ink.g,ink.b))*weight; total+=weight;
  }
  vec3 h=rgbToHsv(pow(light/max(total,1e-20),vec3(1.0/2.2)));
  h.z=value/max(total,1e-20);
  // Exposure has a separate, limited footprint. It does not outline the joins.
  vec2 glow=q-vec2(-.18,.19);
  float exposure=exp(-dot(glow/vec2(.32,.21),glow/vec2(.32,.21)))*.24;
  h.y*=1.0-exposure*bleed*paletteSpread*smoothstep(0.0,.2,depth);
  return colorMix(flatWash(),hsvToRgb(h),.25+.75*smoothstep(0.0,.12,depth));
}
`
