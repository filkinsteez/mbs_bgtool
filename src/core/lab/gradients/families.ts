// Separate constructions: a cropped exposure, curved ribbons, and held scans.
// Diffusion's transported fronts are defined separately in diffusion.ts.
export const GRADIENT_FAMILIES_GLSL = `
vec3 paletteAt(float t) {
  // Depth keeps separating the selected colors above the midpoint.
  t=.5+(t-.5)*exp2((depth-.45)*2.0);
  return texture(lookPalette,vec2(clamp(t,0.0,1.0),0.5)).rgb;
}
vec3 flatWash() {
  return averagePigment;
}
vec2 haloPosition(float t,float branch,vec2 center,vec2 ellipse) {
  float a=-1.05+t*2.5+branch*.6;
  vec2 position=center+vec2(-cos(a),sin(a))*ellipse;
  position+=vec2(sin(a*2.1+seed+branch),cos(a*1.6-seed))*(.006+distortion*distortion*.30);
  position+=vec2(cos(a),-sin(a))*folds*folds*.32*exp2((folds-.32)*1.2)*sin(t*5.0+seed+branch);
  return position;
}
vec3 aperture(vec2 p,vec2 s,vec2 aspect) {
  float travel=(reflow-.5)*4.0;
  float tonalFocus=toneProfile.w*(1.0-smoothstep(.35,.70,lumaProfile.y-lumaProfile.x));
  vec2 fixedSeed=vec2(seed,seed*.718);
  p+=(s-fixedSeed)*.25;
  float angle=(hash(fixedSeed+4.0)-.5)*1.1;
  vec2 q=mat2(cos(angle),-sin(angle),sin(angle),cos(angle))*(p/aspect);
  q+=vec2(sin(travel*.5)*.35,sin(travel*.4)*.18);
  // Bend the exposure within the frame instead of translating its focused
  // area out of view at high Distortion.
  float extraBend=smoothstep(.45,1.0,distortion);
  q.x+=sin(q.y*3.3+seed)*extraBend*.45;
  q.y+=sin(q.x*4.1-seed)*extraBend*.28;
  // More of each exposure enters the frame as Complexity rises. Keep the
  // midpoint composition, but make the upper half reveal separate forms.
  float extraStructure=smoothstep(.5,1.0,complexity);
  q*=1.0+extraStructure*.85;
  // Integrate unequal exposures along an open curve. Each contribution has
  // its own color and focus, so no shared thin rim has to contain every hue.
  vec2 center=vec2(.50+hash(fixedSeed+37.0)*.16,.08);
  vec2 ellipse=vec2(.63,.78)*mix(.72,1.34,warpScale);
  float focal=.28+hash(fixedSeed+11.3)*.35;
  vec3 lights[4]; float totals[4], levels[4], concentrations[4];
  for(int b=0;b<4;b++) { lights[b]=vec3(0.0);totals[b]=0.0;levels[b]=0.0;concentrations[b]=0.0; }
  for(int i=0;i<192;i++) {
    float branch=floor(float(i)/48.0);
    float activation=branch<.5?1.0:smoothstep(branch,branch+1.0,1.0+complexity*3.0);
    if(activation<.0001) continue;
    float t=(mod(float(i),48.0)+.5)/48.0;
    vec2 branchCenter=branch<.5?center:(branch<1.5?vec2(-.32,-.23):(branch<2.5?vec2(.60,-.38):vec2(-.24,.55)));
    vec2 branchEllipse=ellipse*vec2(1.0-branch*.16,1.0-branch*.12);
    vec2 position=haloPosition(t,branch,branchCenter,branchEllipse);
    position+=vec2(branch*.08,-branch*.06)*extraStructure;
    vec2 tangent=normalize(haloPosition(t+.002,branch,branchCenter,branchEllipse)-haloPosition(t-.002,branch,branchCenter,branchEllipse));
    vec2 normal=vec2(-tangent.y,tangent.x);
    vec2 delta=q-position;
    float along=dot(delta,tangent),across=dot(delta,normal);
    float focus=exp(-pow((t-focal-branch*.12)/.17,2.0));
    float width=(.07+softness*(.10+.20*(1.0-focus)))*mix(1.35,.7,depth);
    width*=mix(1.25,.68,complexity);
    width*=.85+.3*noise(vec2(t*4.0+seed,seed*.3));
    width*=1.0+folds*.45*sin(t*5.0+seed);
    float outer=(.012+softness*.18*pow(1.0-focus,2.0))*mix(1.35,.7,depth);
    float core=exp(-.5*pow(max(across,0.0)/width,2.0)-.5*pow(min(across,0.0)/outer,2.0));
    float spill=exp(-.5*pow((across-width*.45)/(width*2.1),2.0));
    float coverage=exp(-.5*pow(along/.072,2.0))*(core*.72+spill*(.02*bleed+.5*pow(bleed,4.0)));
    coverage*=activation*(.25+.75*exp(-pow((t-focal)/.44,2.0)))/1.5;
    float tone=(t-.12)*1.75;
    if(mod(branch,2.0)>.5) tone=1.0-tone;
    tone+=across*(.24+bleed*.55)+(noise(q*1.7+s)-.5)*.13;
    vec3 ink=paletteAt(tone);
    ink=colorMix(ink,mix(lightPigment,lightTip,tonalFocus),focus*(.55+.30*tonalFocus)*toneProfile.w);
    int b=int(branch);
    lights[b]+=pow(ink,vec3(2.2))*coverage;
    levels[b]+=rgbToHsv(ink).z*coverage;totals[b]+=coverage;
    concentrations[b]+=coverage*focus;
  }
  vec3 ground=colorMix(mix(darkPigment,darkTip,tonalFocus),groundPigment,(.08+bleed*.06)*(1.0-tonalFocus*.85));
  vec3 color=ground;
  vec3 sumLight=vec3(0.0);float sumTotal=0.0,sumLevel=0.0,sumConcentration=0.0;
  for(int b=3;b>=0;b--) {
    vec3 arc=rgbToHsv(pow(lights[b]/max(totals[b],1e-12),vec3(1.0/2.2)));
    arc.z=levels[b]/max(totals[b],1e-12);
    float focusShare=concentrations[b]/max(totals[b],1e-12);
    float alpha=1.0-exp(-totals[b]*mix(mix(3.6,1.2,toneProfile.w),.04+6.0*focusShare*focusShare,tonalFocus));
    color=colorMix(color,hsvToRgb(arc),alpha);
    sumLight+=lights[b];sumTotal+=totals[b];sumLevel+=levels[b];sumConcentration+=concentrations[b];
  }
  // Nearby hues retain the shared exposure. Distant hues keep each exposure's
  // color before compositing, so overlapping blue does not erase warm areas.
  vec3 shared=rgbToHsv(pow(sumLight/max(sumTotal,1e-12),vec3(1.0/2.2)));
  shared.z=sumLevel/max(sumTotal,1e-12);
  float sharedFocus=sumConcentration/max(sumTotal,1e-12);
  float sharedAlpha=1.0-exp(-sumTotal*mix(1.2,.04+6.0*sharedFocus*sharedFocus,tonalFocus));
  color=colorMix(color,colorMix(ground,hsvToRgb(shared),sharedAlpha),toneProfile.w);
  return colorMix(flatWash(),color,.15+.85*smoothstep(0.0,.40,depth));
}
vec3 ribbons(vec2 p,vec2 s,vec2 aspect) {
  float travel=(reflow-.5)*5.0;
  float bleedSpread=.36*bleed+.64*smoothstep(.6,1.0,bleed);
  vec2 fixedSeed=vec2(seed,seed*.718);
  p+=(s-fixedSeed)*.3;
  float a=-.38+(hash(fixedSeed+4.0)-.5)*.3;
  vec2 q=mat2(cos(a),-sin(a),sin(a),cos(a))*p;
  q+=vec2(sin(travel*.6)*.35,sin(travel*.7)*.35);
  float sweep=sin(q.x*1.8+seed*.11+travel*.2)*.2;
  sweep+=sin(q.x*3.4+seed*.31)*(.03+distortion*.1);
  vec3 color=colorMix(darkPigment,groundPigment,.12);
  for(int i=0;i<8;i++) {
    float fi=float(i), rnd=hash(vec2(fi+18.0,seed));
    float activation=i<2?1.0:smoothstep(fi,fi+1.0,2.0+complexity*6.0);
    float laneIndex=i==0?0.0:(mod(fi,2.0)<.5?-ceil(fi*.5):ceil(fi*.5));
    float lane=laneIndex*mix(.42,.16,complexity)+(rnd-.5)*.12;
    float bend=sweep+sin(q.x*(1.6+rnd)+fi*1.7+seed)*(.035+folds*.12);
    float d=q.y-lane-bend;
    float concentration=noise(vec2(q.x*(1.3+rnd),fi*9.2)+s);
    float width=(.05+rnd*.12)*(.6+concentration*.9)*mix(1.9,.65,complexity);
    float focus=noise(vec2(q.x*1.7+fi*6.3,seed*.3));
    // Extend the upper range without changing the normal 65% focus.
    float soft=softness<.65?softness*(2.0-softness/.65):softness;
    float softening=pow(soft,2.0)*.65*(1.0+3.0*smoothstep(.65,1.0,soft));
    float upper=(.002+softening*.18*(.2+focus*focus*1.8))*mix(1.5,.6,depth);
    float lower=(.015+softening*.50*(.5+focus))*mix(1.4,.65,depth);
    float alpha=smoothstep(-width-upper,-width+upper,d)*(1.0-smoothstep(width,width+lower,d));
    float tone=.5+laneIndex*.22+.24*sin(q.x*1.1+seed+fi+travel*.4);
    tone+=d*(.35+bleed*.55)+(concentration-.5)*.16;
    vec3 ribbon=paletteAt(tone);
    vec3 pulled=paletteAt(tone+(.3+bleedSpread*2.8)*(concentration-.5)+bleedSpread*.35*sin(q.x*2.0+fi*2.7+seed));
    ribbon=colorMix(ribbon,pulled,pow(bleed,2.0)*.95*(1.0-focus*.5));
    // Dye spreads beyond the original ribbon at high Bleed, including for
    // palettes whose neighboring swatches have nearly the same hue.
    alpha=max(alpha,exp(-pow(d/(width+.015+bleedSpread*.45),2.0))*bleedSpread*.9);
    color=colorMix(color,ribbon,alpha*activation);
  }
  return colorMix(flatWash(),color,.15+.85*smoothstep(0.0,.40,depth));
}
float smearTone(vec2 q,vec2 s,float travel) {
  // A monotone cross-stream contribution keeps every seed exposed to the
  // palette range. A random sine phase could leave a whole frame one color.
  return .5+q.y*.95+q.x*.24
    +.15*sin(q.x*1.7+q.y*.8+seed+travel*.4)+(noise(q*1.4+s)-.5)*.12;
}
vec3 heldBands(vec2 p,vec2 s,vec2 aspect) {
  float travel=(reflow-.5)*5.0;
  p.y+=pow(folds,3.0)*.60*mix(.2,1.0,smoothstep(0.0,.5,complexity))*sin(p.x*3.0+seed*.1);
  SmearSample scan=smearCoordinates(p,s,aspect);
  vec2 brushUv=.5+scan.point/aspect;
  vec4 packedBrush=texture(deformation,brushUv)*255.0;
  vec2 brush=(vec2(dot(packedBrush.rg,vec2(256.0,1.0)),dot(packedBrush.ba,vec2(256.0,1.0)))-32768.0)/16383.75*painted*aspect;
  vec2 q=scan.point+brush;
  float tone=smearTone(q,s,travel);
  vec2 original=p+vec2(sin(travel*.7)*.45,sin(travel*.8)*.3)+(s-vec2(seed,seed*.718))*.3+brush;
  float unshifted=smearTone(original,s,travel);
  tone=unshifted+(tone-unshifted)*mix(1.0,2.0,toneProfile.w);
  tone=.5+(tone-.5)*mix(1.0,1.5,toneProfile.w);
  vec3 color=paletteAt(tone);
  vec3 pulled=paletteAt(tone+(.24+1.4*pow(bleed,4.0))*sin(scan.row*.7+seed));
  color=colorMix(color,pulled,pow(bleed,3.0)*.95*scan.hold);
  float baseTone=.5+(unshifted-.5)*mix(1.0,1.5,toneProfile.w);
  color=colorMix(paletteAt(baseTone),color,scan.hold);
  vec3 spreading=paletteAt(smearTone(original+vec2(-.40,.55),s,travel));
  color=colorMix(color,spreading,pow(bleed,4.0)*.65);
  return colorMix(flatWash(),color,.15+.85*smoothstep(0.0,.40,depth));
}
`
