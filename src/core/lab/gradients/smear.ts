// Unequal held regions of an image. Each run has its own start,
// length and pressure; fine interruptions occupy only part of the frame.
export const SMEAR_GLSL = `
struct SmearSample { vec2 point; float hold; float row; float blur; };
SmearSample smearCoordinates(vec2 p,vec2 s,vec2 aspect) {
  vec2 point=p;
  float held=0.0,rowKey=0.0;
  float travel=(reflow-.5)*5.0;
  vec2 frame=p/aspect;
  // Start spreading before the midpoint while retaining the 65% default.
  float soft=softness<.65?softness*(2.0-softness/.65):softness;
  float diffusion=(soft*.4225+.5775*smoothstep(.65,1.0,soft))*1.495*(1.0+2.0*smoothstep(.65,1.0,soft));
  for(int i=0;i<8;i++) {
    float activation=i==0?1.0:smoothstep(float(i),float(i+1),1.0+complexity*7.0);
    float key=float(i)*71.0;
    float random=hash(vec2(key+7.0,seed+13.0));
    float side=mod(float(i),2.0)*2.0-1.0;
    float rowY=side*(.10+floor(float(i)*.5)*.115)+(random-.5)*.16;
    rowY+=(noise(vec2(frame.x*4.0,key+seed))-.5)*folds*folds*1.75;
    float start=hash(vec2(key+51.0,seed))*.6-.65;
    float length=.35+hash(vec2(key+31.0,seed+19.0))*.7;
    float focus=hash(vec2(key+83.0,seed));
    float width=.003+diffusion*(.02+focus*.10);
    float height=(.055+random*random*.15)*mix(.1,3.2,pow(warpScale,1.5))*mix(1.8,.65,complexity);
    height+=pow(bleed,3.0)*.18;
    height*=1.0+.85*smoothstep(.5,1.0,complexity);
    float d=frame.y-rowY+(noise(vec2(frame.x*3.0+key,seed))-.5)*distortion*.035;
    float edge=.003+diffusion*.06*(.2+focus);
    float area=smoothstep(-height-edge,-height+edge,d)*(1.0-smoothstep(height,height+edge*2.5,d));
    float strand=hash(vec2(floor((frame.y+2.0)*(150.0+complexity*600.0)),key+seed));
    float release=length+(noise(vec2(d*23.0+key,seed))-.5)*(.12+folds*.25);
    release+=(strand-.5)*complexity*.075;
    float tail=.035+diffusion*(.07+focus*.15);
    float onset=start+(noise(vec2(d*29.0+key,seed+19.0))-.5)*(.03+distortion*.09);
    onset+=(strand-.5)*complexity*.018;
    float run=smoothstep(onset-width,onset+width,frame.x)*(1.0-smoothstep(start+release-tail,start+release+tail,frame.x));
    float pressure=run*area*(.08+distortion*1.15+depth*.1)*activation;
    pressure*=exp2((distortion-.45)*.8);
    pressure*=1.0-complexity*.12*pow(strand,6.0);
    pressure=clamp(pressure*mix(.65,1.55,complexity),0.0,1.0);
    float anchor=(hash(vec2(key+91.0,seed))-.5)*.9;
    anchor+=sin(travel*.6+key)*.16;
    float carriedY=-rowY-side*.18+(hash(vec2(key+121.0,seed))-.5)*(.10+folds*folds*2.4)+d*.65;
    carriedY+=sin((frame.x-start)*(2.5+random*6.0)+key)*folds*folds*(.6+.5*smoothstep(.32,1.0,folds));
    if(pressure>held) {
      point=vec2(anchor+(frame.x-start)*(.04+focus*.12),carriedY)*aspect;
      rowKey=key;
    }
    held=max(held,pressure);
  }
  float fiber=hash(vec2(floor((p.y+2.0)*(240.0+complexity*520.0)),seed+7.0))-.5;
  point=mix(p,point,.19+distortion*1.8*exp2((distortion-.45)*.8));
  point.x+=fiber*held*(.006+distortion*.025);
  point+=vec2(sin(travel*.7)*.45,sin(travel*.8)*.3)+(s-vec2(seed,seed*.718))*.3;
  return SmearSample(point,held,rowKey,.25+.75*noise(p*.9+s+11.0));
}
`
