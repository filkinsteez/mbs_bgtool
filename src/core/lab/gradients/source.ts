// Transport the captured frame in screen space, then apply the selected palette.
export const SOURCE_GRADIENT_GLSL = `
vec4 sourceProbe(vec2 point,vec2 radius) {
  vec2 frameUv=point;
  vec2 frameRadius=radius;
  vec2 texels=vec2(textureSize(influence,0));
  float lod=max(0.0,log2(max(1.0,min(frameRadius.x*texels.x,frameRadius.y*texels.y)*.65)));
  vec4 anchor=textureLod(influence,frameUv,lod), delta=vec4(0.0);
  for(int i=0;i<16;i++) {
    float a=float(i)*2.399963;
    vec2 disk=vec2(cos(a),sin(a))*sqrt((float(i)+.5)/16.0);
    delta+=textureLod(influence,frameUv+disk*frameRadius,lod)-anchor;
  }
  vec4 value=anchor+delta/16.0;
  value.g=value.g*2.0-1.0;
  return value;
}
vec4 focusedSourceProbe(vec2 point,float radius,float focus) {
  vec2 normal=sourceAxis;
  vec2 tangent=vec2(-normal.y,normal.x);
  float amount=focus;
  float across=.006+softness*softness*.05;
  float along=.08+softness*.07;
  vec2 texels=vec2(textureSize(influence,0));
  float lod=max(0.0,log2(max(1.0,across*min(texels.x,texels.y)*1.3)));
  vec4 anchor=textureLod(influence,point,lod),delta=vec4(0.0);
  float total=0.0;
  for(int i=0;i<32;i++) {
    float t=(float(i)+.5)/16.0-1.0;
    float weight=exp(-2.0*t*t);
    delta+=(textureLod(influence,point+tangent*t*along*1.7,lod)-anchor)*weight;
    total+=weight;
  }
  vec4 value=anchor+delta/total;
  value.g=value.g*2.0-1.0;
  return mix(sourceProbe(point,vec2(radius)),value,amount);
}
vec4 flowSourceLevelFrom(sampler2D inputImage,vec2 point,float level) {
  vec2 size=vec2(textureSize(inputImage,int(level)));
  vec2 pixel=point*size-.5,base=floor(pixel),f=fract(pixel);
  vec2 w0=pow(1.0-f,vec2(3.0))/6.0;
  vec2 w1=(3.0*f*f*f-6.0*f*f+4.0)/6.0;
  vec2 w2=(-3.0*f*f*f+3.0*f*f+3.0*f+1.0)/6.0;
  vec2 w3=f*f*f/6.0;
  vec2 g0=w0+w1,g1=w2+w3;
  vec2 a=(base-1.0+w1/g0+.5)/size;
  vec2 b=(base+1.0+w3/g1+.5)/size;
  vec4 top=textureLod(inputImage,vec2(a.x,a.y),level)*g0.x+textureLod(inputImage,vec2(b.x,a.y),level)*g1.x;
  vec4 bottom=textureLod(inputImage,vec2(a.x,b.y),level)*g0.x+textureLod(inputImage,vec2(b.x,b.y),level)*g1.x;
  return top*g0.y+bottom*g1.y;
}
vec4 flowSourceLevel(vec2 point,float level) { return flowSourceLevelFrom(influence,point,level); }
vec4 flowSourceSample(vec2 point,float lod) {
  float highest=floor(log2(float(max(textureSize(influence,0).x,textureSize(influence,0).y))));
  float level=min(floor(lod),highest);
  return mix(flowSourceLevel(point,level),flowSourceLevel(point,min(level+1.0,highest)),fract(lod));
}
vec4 flowSourceProbe(vec2 point,vec2 radius) {
  // Integrate the spread in both directions. Low mip levels retain smooth
  // interpolation when the palette makes faint source differences visible.
  vec2 texels=vec2(textureSize(influence,0));
  float lod=max(0.0,log2(max(1.0,min(radius.x*texels.x,radius.y*texels.y)*.65)));
  vec4 anchor=flowSourceSample(point,lod),delta=vec4(0.0);
  float total=0.0;
  for(int i=0;i<32;i++) {
    float a=float(i)*2.399963;
    float r=sqrt((float(i)+.5)/32.0)*2.5;
    float weight=exp(-.5*r*r);
    vec2 offset=vec2(cos(a),sin(a))*r*radius;
    delta+=(flowSourceSample(point+offset,lod)-anchor)*weight;
    total+=weight;
  }
  vec4 value=anchor+delta/total;
  value.g=value.g*2.0-1.0;
  return value;
}
vec4 smearSourceProbe(vec2 point,vec2 radius) {
  float lod=max(0.0,log2(max(1.0,radius.y*float(textureSize(influence,0).y)*1.3)));
  vec4 anchor=flowSourceSample(point,lod),delta=vec4(0.0);
  float total=0.0;
  for(int i=0;i<64;i++) {
    float t=((float(i)+.5)/64.0-.5)*5.0;
    float weight=exp(-.5*t*t);
    delta+=(flowSourceSample(point+vec2(t*radius.x,0.0),lod)-anchor)*weight;
    total+=weight;
  }
  vec4 value=anchor+delta/total;
  value.g=value.g*2.0-1.0;
  return value;
}
struct SourceSample { vec4 field; float focus; vec4 core; vec4 corona; vec4 spill; };
SourceSample transportSource(vec2 p,vec2 s,vec2 aspect,vec2 colorOffset) {
  float phase=reflow-.5,travel=phase*4.0;
  float colorShift=(textureLod(influence,vec2(.5),16.0).g*2.0-1.0)*.65;
  p+=vec2(colorShift,-colorShift*.35)*aspect;
  if(style==0) p+=colorOffset*aspect*1.35;
  if(style==0) {
    vec2 angle=colorOffset*5.0;
    p+=aspect*vec2(sin(travel*1.3+angle.x)-sin(angle.x),cos(travel*1.1+angle.y)-cos(angle.y))*.26;
  }
  vec2 moved=p+vec2(sin(travel*.8)*.32,sin(travel*.67)*.28+(cos(travel*.7)-1.0)*.12);
  vec2 q=(style==2?moved:warp(moved,s+vec2(travel*.34,-travel*.19)))/aspect;
  q*=.55+reflow*.9;
  if(style==0) {
    q*=exp2((.45-warpScale)*3.0);
    q+=(vec2(noise(q*3.8+s+12.0),noise(q*3.1+s+31.0))-.5)*pow(complexity,3.0)*1.4;
  }
  float focus=noise(q*(1.0+complexity*2.0)+s);
  float spread=(.04+pow(softness,3.0)*.35+pow(bleed,3.0)*.28)*(.55+focus*.9)*mix(1.4,.6,depth);
  vec4 field;
  vec4 coreField,coronaField,spillField;
  float attention=.5;
  if(style==0) {
    float a=phase*.65;
    vec2 t=mat2(cos(a),-sin(a),sin(a),cos(a))*q+vec2(.28*phase,.16*sin(3.14159*phase));
    vec2 x=.5+vec2(.72*t.x+.14*t.y-.055,.58*t.y-.09*t.x+.015);
    vec2 y=.5+vec2(.48*t.x-.12*t.y+.12,.76*t.y+.07*t.x-.07);
    vec2 z=.5+vec2(.81*t.x+.05*t.y-.13,.43*t.y+.16*t.x+.10);
    float detailSpread=mix(1.7,.50,complexity);
    float opticalSoftness=mix(.06,2.4,softness*softness);
    field=sourceProbe(x,vec2(.10+spread,.055+spread*.6)*detailSpread*opticalSoftness);
    field+=sourceProbe(y,vec2(.17+spread,.09+spread*.7)*opticalSoftness)*complexity*.65;
    field+=sourceProbe(z,vec2(.05+spread*.7,.16+spread)*opticalSoftness)*complexity*.45;
    field/=1.0+complexity*1.10;
  } else if(style==1) {
    // Unfold more of the captured exposure in the upper Complexity range.
    // This remains source transport: a uniform capture stays uniform.
    float extraStructure=smoothstep(.5,1.0,complexity);
    q*=1.0+extraStructure*.65;
    q+=vec2(sin(q.y*5.3+s.x),sin(q.x*4.7+s.y))*.18*extraStructure;
    q*=exp2((.45-warpScale)*.75);
    // Three normalized lobes spread the captured exposure: a concentrated
    // core, a wider corona, and a displaced tail. Both frame dimensions remain
    // active, rather than stretching a narrow source strip into a large arc.
    vec2 point=.5+mat2(.50,-.16,.22,.70)*q+vec2(phase*.22,sin(travel*.7)*.17)+colorOffset*.3;
    vec2 focusDelta=(point-sourceFocus.xy)/sourceFocus.zw;
    attention=exp(-dot(focusDelta,focusDelta)*.5);
    float radius=mix(.18+softness*.10,.035+softness*.03,attention)*(1.0+colorOffset.x*3.0);
    radius*=1.0+complexity*.9*(noise(q*3.0+s)-.5);
    radius*=mix(1.0,.35,extraStructure);
    vec2 direction=vec2(.88,-.48);
    float core=mix(.12,.65,attention);
    coreField=focusedSourceProbe(point,radius,attention);
    coronaField=sourceProbe(point+direction*.032,(vec2(.18,.22)+softness*.06)*mix(1.0,.45,extraStructure));
    vec4 divided=sourceProbe(point-direction*(.24+extraStructure*.18),(vec2(.06,.12)+softness*.04)*mix(1.0,.45,extraStructure));
    coronaField=mix(coronaField,divided,complexity*.80);
    spillField=sourceProbe(point+direction*(.09+pow(bleed,3.0)*.30),vec2(.32,.38)+bleed*.055);
    float spillWeight=(.68-core)*(.25+1.25*bleed*bleed);
    field=(coreField*core+coronaField*.32+spillField*spillWeight)/(core+.32+spillWeight);
  } else if(style==2) {
    float a=-.32;
    vec2 stream=mat2(cos(a),-sin(a),sin(a),cos(a))*q;
    stream=flowCoordinates(stream,s);
    stream.y+=sin(travel*.7)*.12;
    coreField=flowSourceProbe(.5+vec2(stream.x*.42,stream.y*.90),vec2(.07+spread*.8,(.025+softness*.13*(.3+focus))*mix(1.5,.6,depth)));
    coronaField=flowSourceProbe(.5+vec2(stream.x*.48-.07,stream.y*.62+.08),vec2(.18,.13)+softness*.05);
    spillField=coronaField;
    field=mix(coreField,coronaField,.30);
  } else {
    vec2 scan=(uv-gradientCenter)*aspect;
    vec2 sourceOffset=(sourceFocus.xy-.5)*aspect;
    SmearSample dragged=smearCoordinates(scan-sourceOffset,s,aspect);
    vec2 moved=(dragged.point+sourceOffset)/aspect;
    moved+=(p-scan)/aspect;
    float frameColor=(textureLod(influence,vec2(.5),16.0).g-textureLod(influence,vec2(.01),0.0).g)*2.0;
    vec2 point=.5+vec2(moved.x*.42+frameColor*1.4,moved.y*.80);
    vec2 undragged=scan/aspect+(p-scan)/aspect;
    undragged+=(vec2(sin(travel*.875)*.45,sin(travel)*.3)+(s-vec2(seed,seed*.718))*.3)/aspect;
    vec2 basePoint=.5+vec2(undragged.x*.42+frameColor*1.4,undragged.y*.80);
    coreField=smearSourceProbe(basePoint,vec2(.12+softness*.32,.018+softness*.05*dragged.blur));
    coronaField=smearSourceProbe(point,vec2(.12+softness*.32,.018+softness*.05*dragged.blur));
    vec4 pulled=smearSourceProbe(point+vec2(sin(dragged.row+seed)*(.08+pow(bleed,3.0)*.65),0.0),vec2(.34,.025));
    coronaField=mix(coronaField,pulled,bleed*bleed*.85);
    attention=dragged.hold;
    field=mix(coreField,coronaField,attention);
    spillField=field;
  }
  if(style==0) {
    vec4 broad=sourceProbe(.5+q*.55,vec2(.30,.22));
    field=mix(field,broad,.1);
  }
  if(style==0) { coreField=field;coronaField=field;spillField=field; }
  return SourceSample(field,attention,coreField,coronaField,spillField);
}
float pigmentCoverage(float x) {
  float u=clamp(x,-1.0,1.0);
  return .5+.9375*(u-(2.0/3.0)*u*u*u+.2*u*u*u*u*u);
}
float sourcePaletteTone(vec4 field,vec4 average,vec4 moments,float response,float key) {
    float travel=(reflow-.5)*4.0;
    float sourceGain=style==0?3.3:2.0;
    float tone=style==1 ? .5+(field.a-average.a)*mix(.65,1.8,toneProfile.w)+field.g*.12
      : .5+(field.r-average.r)*sourceGain+field.g*.32;
    if(transportStatsReady>.5) {
      float deviation=max(.035,sqrt(max(0.0,moments.w-moments.z*moments.z)));
      float coordinate=.5+(log(max(.0001,field.a)+.05)-moments.z)/(8.0*deviation);
      float rank=texture(transportRank,vec2(clamp(coordinate,0.0,1.0),.5)).r;
      tone=mix(.5,rank,response)+(field.g-(average.g*2.0-1.0))*.08;
    }
    tone+=(sin(travel*1.1+key*.2)-sin(key*.2))*.08*response*(1.0-toneProfile.w);
    tone+=(reflow-.5)*.4*response;
    if(transportStatsReady<.5) tone=.5+.5*tanh((tone-.5)*(style==1?1.7:1.4));
    tone=.5+(tone-.5)*exp2((depth-.45)*2.0);
    if(style==1) tone=.5+(tone-.5)*(1.0+.45*(1.0-smoothstep(0.0,.65,softness)));
    tone=clamp(tone,0.0,1.0);
    // Swapping roles reverses the source response. Do not infer a reversal
    // from their luminance: removing a trace color can change that ordering.
    float roleStrength=smoothstep(0.0,.08,min(pigments[sourceGround].a,pigments[sourceInk].a));
    if(sourceInk>sourceGround) tone=mix(tone,1.0-tone,roleStrength);
    return tone;
}
float sourceCoverage(vec2 interval,float tone,float width) {
  return pigmentCoverage((interval.y-tone)/width)-pigmentCoverage((interval.x-tone)/width);
}
vec3 sourceGradient(vec2 p,vec2 s,vec2 aspect) {
  if(style==2) return coloredSourceFlow(p,s,aspect);
  vec4 average=textureLod(influence,vec2(.5),16.0);
  vec3 light=vec3(0.0);float total=0.0,value=0.0,saturation=0.0;
  float response=smoothstep(.0001,.01,max(0.0,average.b-average.r*average.r));
  float edgeWidth=mix(.38,.055,pow(depth,.65))*mix(.6,1.0,toneProfile.w);
  if(style==0) edgeWidth*=1.0+pow(bleed,4.0)*4.0;
  vec4 moments=textureLod(transportStats,vec2(.5),7.0);
  SourceSample sharedTransport;
  if(style==2 || style==3) sharedTransport=transportSource(p,s,aspect,vec2(0.0));
  for(int i=0;i<49;i++) {
    if(i>=pigmentCount) break;
    vec3 ink=pigments[i].rgb;
    float key=dot(ink,vec3(137.3,78.17,241.53));
    vec2 offset=vec2(hash(vec2(key,71.1)),hash(vec2(key,132.7)))-.5;
    SourceSample transported;
    if(style==2 || style==3) transported=sharedTransport;
    else transported=transportSource(p,s,aspect,offset*(1.0-toneProfile.w)*.25);
    float tone=sourcePaletteTone(transported.field,average,moments,response,key);
    vec2 interval=pigmentIntervals[i];
    float width=edgeWidth;
    if(style==1) width*=mix(1.0,mix(1.3,.7,transported.focus)*mix(1.0,.42,toneProfile.w),response)*mix(.25,1.8,softness*softness)*exp2((softness-.65)*1.7);
    if(style==2) width*=mix(1.0,(.45+noise(p*2.0+s+key)*1.8)*mix(1.0,.40,toneProfile.w),response);
    if(style==3) width*=mix(1.0,.4,toneProfile.w*response);
    float fieldWeight=sourceCoverage(interval,tone,width);
    if(style==3) {
      float baseTone=sourcePaletteTone(transported.core,average,moments,response,key);
      float draggedTone=sourcePaletteTone(transported.corona,average,moments,response,key);
      fieldWeight=mix(sourceCoverage(interval,baseTone,width),sourceCoverage(interval,draggedTone,width),transported.focus);
    }
    if(style==2) {
      float broadTone=sourcePaletteTone(transported.corona,average,moments,response,key);
      float broader=sourceCoverage(interval,broadTone,width*1.7);
      fieldWeight=mix(fieldWeight,broader,(.15+bleed*.30)*mix(1.0,.3,toneProfile.w));
    }
    if(style==1) {
      float a=sourcePaletteTone(transported.core,average,moments,response,key);
      float b=sourcePaletteTone(transported.corona,average,moments,response,key);
      float c=sourcePaletteTone(transported.spill,average,moments,response,key);
      float disagreement=abs(a-b)+abs(b-c);
      float dissolve=smoothstep(.035,.35,disagreement)*(1.0-transported.focus*.7);
      float spread=sourceCoverage(interval,b,width*1.1)*.65+sourceCoverage(interval,c,width*1.35)*.35;
      fieldWeight=mix(fieldWeight,spread,.12+.4*dissolve);
    }
    float weight=mix(pigments[i].a,fieldWeight+.015*pigments[i].a,.15+.85*smoothstep(0.0,.40,depth));
    light+=pow(ink,vec3(2.2))*weight;
    saturation+=rgbToHsv(ink).y*weight;
    value+=max(ink.r,max(ink.g,ink.b))*weight;total+=weight;
  }
  vec3 h=rgbToHsv(pow(light/max(total,1e-20),vec3(1.0/2.2)));
  h.y=mix(h.y,saturation/max(total,1e-20),style==1?.12:0.0);
  h.z=value/max(total,1e-20);
  return hsvToRgb(h);
}
`
