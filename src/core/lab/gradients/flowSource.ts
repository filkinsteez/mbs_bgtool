// Color the captured image before filtering it, then carry that light through
// the full-frame flow. The separate emission image preserves local color breaks.
export const FLOW_SOURCE_GLSL = `
vec4 sourceFlowEmission(vec2 point) {
  vec4 average=textureLod(influence,vec2(.5),16.0);
  vec4 v=textureLod(influence,point,0.0);
  float contrast=abs(v.r-average.r);
  float mass=contrast*contrast*3.0+.00001;
  vec2 colorSlope=mix(vec2(.9,1.7),vec2(2.3,4.7),toneProfile.w);
  float tone=.5+dot(point-sourceFocus.xy,colorSlope)+.13*sin(point.x*8.0+seed)+(v.r-average.r)*.3;
  float roleStrength=smoothstep(0.0,.08,min(pigments[sourceGround].a,pigments[sourceInk].a));
  if(sourceInk>sourceGround) tone=mix(tone,1.0-tone,roleStrength);
  tone=clamp(tone,0.0,1.0);
  vec3 color=vec3(0.0);float total=0.0,brightness=0.0;
  float width=mix(.18,.008,sqrt(depth))*mix(1.0,.6,toneProfile.w);
  for(int i=0;i<49;i++) {
    if(i>=pigmentCount) break;
    float weight=sourceCoverage(pigmentIntervals[i],tone,width)+pigments[i].a*.002;
    color+=pow(pigments[i].rgb,vec3(2.2))*weight;
    brightness+=max(pigments[i].r,max(pigments[i].g,pigments[i].b))*weight;
    total+=weight;
  }
  color=pow(color/max(total,1e-12),vec3(1.0/2.2));
  color*=brightness/max(total,1e-12)/max(max(color.r,max(color.g,color.b)),1e-8);
  return vec4(pow(color,vec3(2.2))*mass,mass);
}
vec3 coloredSourceFlow(vec2 p,vec2 s,vec2 aspect) {
  vec4 average=textureLod(influence,vec2(.5),16.0);
  float response=smoothstep(.0001,.01,max(0.0,average.b-average.r*average.r));
  float travel=(reflow-.5)*4.0;
  float shift=(average.g*2.0-1.0)*.35;
  p+=vec2(shift,-shift*.35)*aspect;
  p+=vec2(sin(travel*.8)*.32,sin(travel*.67)*.28+(cos(travel*.7)-1.0)*.12);
  vec2 q=p/aspect*(.55+reflow*.9);
  float angle=-.32;
  q=mat2(cos(angle),-sin(angle),sin(angle),cos(angle))*q;
  q=flowCoordinates(q,s);
  vec2 point=.5+vec2(q.x*.70,q.y*.90);
  point+=vec2(-.26,.07)*(bleed-.6);
  vec2 focusDelta=point-sourceFocus.xy-vec2(-.13,.12);
  focusDelta=mat2(.94,-.34,.34,.94)*focusDelta/vec2(.36,.10);
  float focus=exp(-dot(focusDelta,focusDelta)*.5);
  float soft=softness<.65?softness*(2.0-softness/.65):softness;
  float softSpread=soft*.65+.35*smoothstep(.65,1.0,soft);
  vec2 radius=vec2(.015+softSpread*.09,.01+softSpread*.07)*mix(2.0,.12,focus*focus);
  // Spread at low Depth and concentrate at high Depth, retaining the default.
  radius*=exp2((.45-depth)*4.0);
  radius*=exp2((soft-.65)*3.4);
  vec2 texels=vec2(flowEmissionReady>.5?textureSize(flowEmission,0):textureSize(influence,0));
  float lod=max(0.0,log2(max(1.0,min(radius.x*texels.x,radius.y*texels.y)*.5)));
  // A broad color guide limits complementary-color averaging without tracing
  // the sharp boundaries of the source. Softness releases this preference.
  vec4 guide=flowEmissionReady>.5?flowSourceLevelFrom(flowEmission,clamp(point,0.0,1.0),5.0):sourceFlowEmission(clamp(point,0.0,1.0));
  vec3 guideColor=guide.rgb/max(guide.a,1e-12);
  float colorRetention=8.0*(1.0-softness*softness);
  vec3 light=vec3(0.0);float total=0.0,kernel=0.0;
  for(int i=0;i<64;i++) {
    float a=float(i)*2.399963;
    float r=sqrt((float(i)+.5)/64.0)*2.5;
    float weight=exp(-.5*r*r);
    vec2 offset=vec2(cos(a),sin(a))*r*radius;
    offset+=vec2(-.07,.015)*bleed*(1.8+pow(bleed,3.0)*.7+pow(bleed,4.0)*12.0)*exp2((bleed-.6)*.7)*r*r*(1.0-focus*focus*.90);
    vec2 origin=clamp(point+offset,0.0,1.0);
    vec4 emission;
    if(flowEmissionReady>.5) emission=mix(flowSourceLevelFrom(flowEmission,origin,floor(lod)),flowSourceLevelFrom(flowEmission,origin,floor(lod)+1.0),fract(lod));
    else emission=sourceFlowEmission(origin);
    vec3 colorDifference=emission.rgb/max(emission.a,1e-12)-guideColor;
    weight*=.2+.8*exp(-dot(colorDifference,colorDifference)*colorRetention);
    light+=emission.rgb*weight;total+=emission.a*weight;kernel+=weight;
  }
  vec3 color=pow(light/max(total,1e-12),vec3(1.0/2.2));
  float density=total/kernel;
  vec3 background=darkPigment;
  color=colorMix(background,color,density/(density+.012));
  return colorMix(flatWash(),color,response*(.15+.85*smoothstep(0.0,.40,depth)));
}
`
