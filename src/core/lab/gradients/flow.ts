// Backtrace through a changing velocity field. Turning subsides as the
// through-flow carries color onward, avoiding a fixed spiral at every fold.
export const FLOW_GLSL = `
vec2 flowVelocity(vec2 p,vec2 s,float time) {
  vec2 first=vec2(.14,-.12)+(vec2(hash(s+61.0),hash(s+73.0))-.5)*.30;
  vec2 second=vec2(-.52,.26)+(vec2(hash(s+83.0),hash(s+97.0))-.5)*.24;
  vec2 a=p-first,b=p-second;
  vec2 ra=a/vec2(.52,.38),rb=b/vec2(.32,.55);
  vec2 velocity=vec2(.16+.40*p.y+.15*sin(p.y*2.5),.015);
  float turning=exp(-time*3.5)*1.5;
  velocity+=vec2(-a.y,a.x)*exp(-dot(ra,ra))*(.08+folds*folds*4.5)*turning;
  velocity-=vec2(-b.y,b.x)*exp(-dot(rb,rb))*(.08+folds*folds*3.2)*turning;
  // Additional local currents split the broad stream into unequal folds.
  // Their positions remain fixed while their contribution grows continuously.
  for(int i=0;i<4;i++) {
    float k=float(i);
    float activation=smoothstep(k,k+1.0,complexity*complexity*4.0);
    activation*=1.0+smoothstep(.5,1.0,complexity)*.65;
    vec2 center=vec2(-.60+k*.36,(mod(k,2.0)-.5)*.40);
    center+=(vec2(hash(s+k+118.0),hash(s+k+143.0))-.5)*.20;
    vec2 d=p-center;
    vec2 radius=vec2(.24+k*.035,.30-k*.025);
    vec2 r=d/radius;
    velocity+=vec2(.12+d.y*1.6,.35)*exp(-dot(r,r))*(mod(k,2.0)*2.0-1.0)*activation*3.6*turning;
  }
  return velocity;
}
vec2 flowCoordinates(vec2 p,vec2 s) {
  float scale=mix(2.6,.45,warpScale);
  vec2 q=p*scale;
  q.y+=sin(q.x*1.8+seed*.13)*distortion*distortion*.55;
  q.y+=sin(q.x*2.8+seed*.13)*pow(folds,3.0)*.35;
  float stepSize=(.59+distortion*1.2+reflow*.7)/24.0;
  for(int i=0;i<24;i++) {
    float time=float(i)/24.0;
    vec2 middle=q-flowVelocity(q,s,time)*stepSize*.5;
    q-=flowVelocity(middle,s,time+.5/24.0)*stepSize*(1.0+.4*smoothstep(.32,1.0,folds));
  }
  return q/scale;
}
`
