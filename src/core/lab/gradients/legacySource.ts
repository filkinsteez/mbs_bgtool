// Screen-space image processing. Every mass, contour and streak samples the
// captured loop frame; no silhouette, normal or material data is used.
export const SOURCE_GRADIENT_GLSL = `
vec3 sourceToSrgb(vec3 light) {
  return mix(light*12.92,1.055*pow(max(light,vec3(0.0)),vec3(1.0/2.4))-0.055,step(vec3(0.0031308),light));
}
vec4 sourceProbe(vec2 point,vec2 radius) {
  vec2 frameUv=(point-sourceRect.xy)/sourceRect.zw;
  vec2 frameRadius=radius/sourceRect.zw;
  vec2 texels=vec2(textureSize(influence,0));
  float lod=max(0.0,log2(max(1.0,min(frameRadius.x*texels.x,frameRadius.y*texels.y)*0.65)));
  vec4 value=vec4(0.0);
  for(int i=0;i<16;i++) {
    float a=float(i)*2.399963;
    vec2 disk=vec2(cos(a),sin(a))*sqrt((float(i)+0.5)/16.0);
    value+=textureLod(influence,frameUv+disk*frameRadius,lod);
  }
  value/=16.0;
  return vec4(sourceToSrgb(value.rgb),value.a);
}
vec3 sourceGrade(vec4 value) {
  // Filtering similar blues together used to remove their dark/light range.
  // The captured tonal field restores those selected endpoints after filtering.
  float gain=style==0?1.15:1.6;
  float tone=clamp(.5+(value.a-.5)*gain,0.0,1.0);
  vec3 graded=texture(lookPalette,vec2(tone,.5)).rgb;
  return colorMix(value.rgb,graded,toneProfile.w*(style==0?.62:.88));
}
vec3 sourceGradient(vec2 p,vec2 s,vec2 aspect) {
  float travel=(reflow-.5)*4.0;
  vec2 moved=p+vec2(sin(travel*.8),cos(travel*.7)-1.0)*.42;
  vec2 q=warp(moved,s+vec2(travel*.34,-travel*.19));
  float focus=noise(q*mix(1.0,3.0,complexity)+s);
  float spread=(.025+softness*softness*.13+bleed*.025)*(.55+focus*.9)*mix(1.4,.6,depth);
  vec2 point=.5+q*.67/aspect;
  vec3 color;
  if(style==0) {
    color=sourceGrade(sourceProbe(point,vec2(spread*1.7)/aspect));
  } else if(style==1) {
    vec4 edge=sourceProbe(point,vec2(.006+softness*.026*(.3+focus*1.6))/aspect);
    vec4 bloom=sourceProbe(.5+(point-.5)*.81+vec2(.03,-.025),vec2(.055+softness*.1)/aspect);
    // A narrow inner edge and broad outside exposure, derived from the loop's
    // captured tones. Low/high source regions create the dark openings.
    float d=edge.a-.48;
    float inner=1.0-smoothstep(-.015,(.035+softness*.16*focus)*mix(1.6,.6,depth),d);
    float outer=exp(-max(-d,0.0)/((.12+bleed*.22)*mix(1.4,.7,depth)));
    float rim=inner*outer;
    vec3 arc=colorMix(sourceGrade(edge),sourceGrade(bloom),.45);
    arc=colorMix(arc,lightPigment,toneProfile.w*.4);
    float glow=smoothstep(.12,.6,bloom.a)*(1.0-smoothstep(.5,.9,bloom.a));
    vec3 base=colorMix(darkPigment,sourceGrade(bloom),glow*.23);
    color=colorMix(base,arc,rim*(.7+.3*bloom.a));
  } else if(style==2) {
    float a=-.32;
    vec2 stream=mat2(cos(a),-sin(a),sin(a),cos(a))*q;
    stream.y+=sin(stream.x*2.1+travel*.4+s.x*.1)*(.17+distortion*.15);
    stream.y+=sin(stream.x*3.7-seed*.13)*(.025+folds*.08);
    // Compress a horizontal sample of the loop and stretch it across the
    // canvas. The loop's crossings become multiple curved color ribbons.
    point=.5+vec2(stream.x*.16,stream.y*1.05)/aspect;
    vec4 field=sourceProbe(point,vec2(.08+spread*1.1,(.01+softness*.026*(.3+focus))*mix(1.5,.6,depth))/aspect);
    color=sourceGrade(field);
  } else {
    vec2 scan=(uv-.5)*aspect;
    float count=8.0+complexity*20.0;
    float rows=(scan.y+2.0)*count+.75*sin(scan.y*5.3+seed)+.3*sin(scan.y*11.7-seed);
    float row=floor(rows);
    float band=hash(vec2(row,seed+3.0));
    float y=mix(q.y,scan.y+(.5-fract(rows))/count,.68+distortion*.25);
    float start=(hash(vec2(row,seed+51.0))-.5)*aspect.x;
    float hold=smoothstep(start-.015,start+.015,scan.x);
    float fine=hash(vec2(floor((scan.y+2.0)*(180.0+complexity*420.0)),seed+7.0))-.5;
    float x=mix(q.x*.25,(band-.5)*.9,hold*(.35+depth*.35+distortion*.3));
    x+=fine*(.012+distortion*.075)*hold;
    float shard=smoothstep(.13,.15,fract(rows))*(1.0-smoothstep(.17+band*.16,.19+band*.16,fract(rows)));
    y+=shard*hold*(band-.5)*(.015+complexity*.03);
    point=.5+vec2(x+sin(travel+band*2.0)*.2,y*.87)/aspect;
    color=sourceGrade(sourceProbe(point,vec2(.04+softness*.22,.0015)/aspect));
  }
  vec3 average=sourceToSrgb(textureLod(influence,vec2(.5),16.0).rgb);
  return colorMix(average,color,smoothstep(0.0,.14,depth));
}
`
