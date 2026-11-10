export const MAX_LIGHTS = 11
export const MAX_TONGUES = 4
/** How far (in run lengths) the ends of a bend, fan or taper round off, so a band turns in a wide arc, never a corner. */
export const SOFT_TURN = 0.4

/** The steepest the flow's bend gets, per run length: a wide arc, never a fold. */
export const BEND_SLOPE = 0.8

/** The flow's bend at t (run lengths along it), per run length: the shader's `bendArc` and `bendLean`. */
export function bendAt(t: number, arc: number, lean: number): number {
  return arc * BEND_SLOPE * BEND_SLOPE * (Math.sqrt(1 + (t * t) / (BEND_SLOPE * BEND_SLOPE)) - 1) + (lean * t * t * t) / (1 + t * t)
}

/** A clamp whose ends round off over `k`; the shader's `softClamp`, for the parts and the layout. */
export function softClamp(x: number, lo: number, hi: number, k: number): number {
  let h = Math.min(1, Math.max(0, 0.5 + (0.5 * (x - lo)) / k))
  const above = lo + (x - lo) * h + k * h * (1 - h)
  h = Math.min(1, Math.max(0, 0.5 - (0.5 * (above - hi)) / k))
  return hi + (above - hi) * h - k * h * (1 - h)
}

/**
 * Rush: light moving too fast to hold its shape. Streaks of light fill the frame side by side: one or two wide soft
 * bands, each with its own gradient and core, and thinner bright streaks. One or two pairs of neighbours meet in a wide
 * soft white bridge, the others through a soft dim trough; some seeds keep a black gap between two streaks. They flow
 * along a shared run that bends more and more toward its far end or runs nearly straight, and may fan out; each streak
 * widens or narrows along it. Each streak has a hot core and a long dim skirt that lights the room beside it; fine
 * streaks run inside it along its motion.
 *
 * The light and dark layout never depends on the colors: each streak's luminance is set by the layout (from fixed
 * stand-in colors per role), and the color list only gives its hue, which turns as the light dims (Yellow to
 * Orange-red to deep red, Lime to Forest, Ice to Steel). A white streak is white in its middle, with one color running
 * into it on each side.
 */
export const RUSH_SPLIT_GLSL = /* glsl */ `
#define MAX_LIGHTS ${MAX_LIGHTS}
#define MAX_TONGUES ${MAX_TONGUES}
uniform vec4 uRun;                  // start x, start y (short sides from the frame center), direction (radians), reach
uniform vec2 uHook;                 // how far the flow bends across by its end: by t squared and by t cubed (per reach)
uniform vec4 uStack;                // fan (widening per reach), warp amount, warp frequency along, warp frequency across
uniform vec4 uSwell;                // a broad swell across the stack: center (warped), half-width, how far the light's ceiling drops away from it, unused
uniform vec4 uLA[MAX_LIGHTS];       // center across (warped), half-width, its variation along, core width (share of the half-width)
uniform vec4 uLB[MAX_LIGHTS];       // side asymmetry (log of left / right), raggedness, split at the start, split at the reach
uniform vec4 uLC[MAX_LIGHTS];       // luminance (layout's), brightness variation along, core gain, 1 for a white streak, 2 for a seam
uniform vec4 uLD[MAX_LIGHTS];       // across gradient (log of hot side / other side), wander, streak amount, streak frequency
uniform vec4 uLE[MAX_LIGHTS];       // fade in at (along), fade length, fade out at, color (index into the list)
uniform vec4 uLF[MAX_LIGHTS];       // drift across per unit along, bow per unit along squared, core place (half-widths), role (for the color stage's parts)
uniform vec4 uLG[MAX_LIGHTS];       // taper (log of the width at the reach over the width at the start), falloff (exponent of the body), a white streak's color order (-1 reversed), a seam's high-side color
uniform vec4 uLH[MAX_LIGHTS];       // dim skirt on the low side and on the high side (shares of the streak's light), its length (half-widths), a lead streak's hottest place along the run
uniform int uLights;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform vec4 uRamp[12];             // each color's dim path, three steps: a darker pack color's hue at luminance 1, and the level where it takes over (0: none)
uniform vec4 uSpectrum;             // each color's place on a white streak: 0 its low edge, 1 its high edge, 0.5 none
uniform vec4 uFringe;               // each color's level in a white streak
uniform int uComps;
uniform vec3 uGround;
uniform vec4 uTongue[MAX_TONGUES];  // x (short sides from the center), half-width at the base, height above the bottom edge, lean
uniform vec4 uTongueLook;           // edge softness, depth, wander, unused
uniform int uTongues;

vec3 compColor(int k) { return k == 0 ? uC0 : k == 1 ? uC1 : k == 2 ? uC2 : uC3; }
#define SOFT_TURN ${SOFT_TURN.toFixed(2)}
#define BEND_SLOPE ${BEND_SLOPE.toFixed(2)}
// The flow's bend: one wide arc that grows like t squared near the start and straightens to a slope of at most
// BEND_SLOPE per run length, and a lean that tips it to one side, so a band never folds back or turns a corner.
float bendArc(float t) { return BEND_SLOPE * BEND_SLOPE * (sqrt(1.0 + t * t / (BEND_SLOPE * BEND_SLOPE)) - 1.0); }
float bendLean(float t) { return t * t * t / (1.0 + t * t); }
// A clamp whose ends round off over k (a smooth max with lo, then a smooth min with hi), so a band turns in a wide arc
// where a bend, fan or taper stops growing, never in a corner.
float softClamp(float x, float lo, float hi, float k) {
  float h = clamp(0.5 + 0.5 * (x - lo) / k, 0.0, 1.0);
  float above = mix(lo, x, h) + k * h * (1.0 - h);
  h = clamp(0.5 - 0.5 * (above - hi) / k, 0.0, 1.0);
  return mix(hi, above, h) - k * h * (1.0 - h);
}
// A color's hue (at luminance 1) at a level of its light: its own at the peak, then each step of its dim path in turn.
vec3 dimHue(int k, float level) {
  vec3 c = compColor(k);
  vec3 above = c / max(luminance(c), 1e-5);
  float aboveAt = 1.0;
  for (int j = 0; j < 3; j++) {
    vec4 st = uRamp[k * 3 + j];
    if (st.w <= 0.0) break;
    if (level >= st.w) return mix(st.xyz, above, smoothstep(st.w, min(aboveAt, 2.0 * st.w), level));
    above = st.xyz;
    aboveAt = st.w;
  }
  return above;
}

// Soft tongues of shadow rising from the frame's bottom edge, narrowing to their tips.
float shadow(vec2 p) {
  float m = 1.0;
  float bottom = 0.5 * uFrameAspect.y;
  for (int j = 0; j < MAX_TONGUES; j++) {
    if (j >= uTongues) break;
    vec4 tg = uTongue[j];
    float up = bottom - p.y;
    float k = clamp(1.0 - up / max(tg.z, 1e-3), 0.0, 1.0);
    if (k <= 0.0) continue;
    float cx = tg.x + tg.w * up + uTongueLook.z * valueNoise(vec2(up * 4.0, float(j) * 7.3), uSeed + 211 + j);
    float hw = tg.y * pow(k, 0.8);
    float inside = gaussianCdf((p.x - cx + hw) / uTongueLook.x) - gaussianCdf((p.x - cx - hw) / uTongueLook.x);
    m *= 1.0 - uTongueLook.y * inside * smoothstep(0.0, 0.35, k);
  }
  return m;
}

vec3 radiance(vec2 uv, vec2 p) {
  vec2 dir = vec2(cos(uRun.z), sin(uRun.z));
  vec2 nrm = vec2(-dir.y, dir.x);
  vec2 q = p - uRun.xy;
  float u = dot(q, dir);
  float v = dot(q, nrm);
  float reach = max(uRun.w, 1e-3);
  float t = u / reach;
  v -= (uHook.x * bendArc(t) + uHook.y * bendLean(t)) * reach;
  float vs = v / max(1.0 + uStack.x * softClamp(t, -0.3, 1.5, SOFT_TURN), 0.25);
  float vw = vs + uStack.y * valueNoise(vec2(u * uStack.z, vs * uStack.w), uSeed + 7);
  // Each light's luminance here and what sets its hue: a pack color (its index, and its luminance at the peak), whose
  // hue is read once all the light here is added up, or a fixed hue (white streaks, bridges; color -1).
  float lum[MAX_LIGHTS];
  int col[MAX_LIGHTS];
  float peak[MAX_LIGHTS];
  vec3 fixedHue[MAX_LIGHTS];
  float coreLum[MAX_LIGHTS];
  float total = 0.0;
  // Light added after the shoulder: white streaks' cores, which reach white at their peak, and lead streaks' cores in
  // their own color (Meta Blue toward a lighter blue, white only at the hottest point).
  vec3 hot = vec3(0.0);
  for (int i = 0; i < MAX_LIGHTS; i++) {
    if (i >= uLights) break;
    lum[i] = 0.0;
    col[i] = -1;
    peak[i] = 1.0;
    fixedHue[i] = vec3(1.0);
    coreLum[i] = 0.0;
    vec4 A = uLA[i];
    vec4 B = uLB[i];
    vec4 C = uLC[i];
    vec4 Dl = uLD[i];
    vec4 E = uLE[i];
    vec4 F = uLF[i];
    vec4 G = uLG[i];
    vec4 H = uLH[i];
    float fi = float(i);
    float s0 = vw - (A.x + u * (F.x + u * F.y));
    // Behind the start (a line dragged away from the frame) the streaks go on at most of their brightness.
    float tail = 0.75 + 0.25 * exp(min(u, 0.0) / (0.5 * reach));
    float fadeIn = max(smoothstep(E.x - E.y, E.x + E.y, u), tail);
    float fadeOut = 1.0 - smoothstep(E.z - E.y, E.z + E.y, u);
    // The streak's dim skirt: its light reaching across the room beside it, each side at its own level, in the darkest
    // color of its dim path (navy, deep red, Forest, Slate), so the room between streaks is dimly lit, not black.
    // Rounded through the middle (no cusp), and from one side's level to the other's smoothly.
    float skirt = mix(H.x, H.y, 0.5 + 0.5 * tanh(s0 / max(A.y, 1e-4))) * exp(-sqrt(s0 * s0 + 0.25 * A.y * A.y) / max(A.y * H.z, 1e-4));
    float skirtLum = C.x * skirt * fadeIn * fadeOut;
    int k = int(E.w + 0.5);
    col[i] = k;
    peak[i] = C.x;
    lum[i] = skirtLum;
    float wide = A.y * (1.0 + A.z) * exp(abs(B.x) + 0.8 * abs(G.x)) * sqrt(7.0 / max(G.y, 0.3)) + 0.5 * max(B.z, B.w) + Dl.y;
    if (abs(s0) > wide) {
      total += skirtLum;
      continue;
    }
    float s = s0 - Dl.y * valueNoise(vec2(u * 1.3, fi * 4.7), uSeed + 31 + i);
    // Each streak widens or narrows along the flow by its own taper, so neighbouring edges are never parallel.
    float halfW = A.y * max(0.6, 1.0 + A.z * valueNoise(vec2(u * 1.1 + 7.1, fi * 2.7), uSeed + 61 + i)) * exp(G.x * (softClamp(t, -0.3, 1.3, SOFT_TURN) - 0.5));
    // Each side of the streak has its own width, wandering along it.
    // The two sides blend into each other across the middle, so there is no crease along the band.
    float side = tanh(s / max(0.4 * halfW, 1e-4));
    float wobble = mix(valueNoise(vec2(u * 5.5, fi * 4.1 + 1.0), uSeed + 71 + i), valueNoise(vec2(u * 5.5, fi * 4.1 + 2.0), uSeed + 71 + i), 0.5 + 0.5 * side);
    float sideScale = exp(-B.x * side) * (1.0 + B.y * wobble);
    float x = s / max(halfW * sideScale, 1e-4);
    float ta = max(u, 0.0) / max(reach, 1.0);
    // Along its length a streak's light rises in bright patches and dips only a little between them, so a light color
    // brightens toward white rather than dimming toward olive.
    // A light color's light (the cool and warm roles: Lime, Ice, Cyan, Yellow) dips least, since it reads olive or grey
    // as soon as it dims.
    float swing = valueNoise(vec2(u * 1.6 + 11.0, fi * 6.1), uSeed + 83 + i);
    float dip = F.w > 0.5 && F.w < 0.85 ? 0.2 : 0.5;
    float env = fadeIn * fadeOut * max(0.0, 1.0 + C.y * (swing > 0.0 ? swing : dip * swing)) / (1.0 + 0.3 * ta * ta);
    if (env < 1e-4) {
      total += skirtLum;
      continue;
    }
    if (C.w > 1.5) {
      // A bridge where two streaks meet: their overlap, a broad soft body under the shoulder whose middle goes white
      // as wide and soft as the bridge, with no line on top. Each side of its glow is the light of the streak on that
      // side (E.w low side, G.w high side; -1 a white streak), dimming along its own path, so the meeting goes from one
      // color through white to the other.
      float glow = exp(-G.y * x * x);
      float sideColor = s < 0.0 ? E.w : G.w;
      vec3 side = sideColor < -0.5 ? vec3(1.0) : dimHue(int(sideColor + 0.5), glow);
      // White in the middle: the shoulders keep their own hue and whiten the way hot light does in the tone curve
      // (Orange-red through yellow, not into peach).
      col[i] = -1;
      fixedHue[i] = mix(side, vec3(1.0), 0.85 * pow(glow, 6.0));
      lum[i] = C.x * glow * env;
      total += lum[i];
      continue;
    }
    // A streak: a body falling off to its skirt at its edges (softer in a wide band), and a hot core. A side facing
    // darkness (G.w: 1 the low side, 2 the high side) of every color but the lead (Meta Blue, which dims softly into
    // navy) keeps a broad bright top and falls steeply, so it never sits at mid lightness over a wide area (Lime would
    // read olive, Tan grey-brown); a side facing a neighbour falls softly into the neighbour's light.
    float x2 = x * x;
    float steepSide = s < 0.0 ? mod(G.w, 2.0) : floor(G.w / 2.0);
    float body = exp(-G.y * (F.w > 0.5 && steepSide > 0.5 ? 0.6 * x2 + 0.6 * x2 * x2 : x2));
    float cx = (s / max(halfW, 1e-4) - F.z) / A.w;
    float coreShape = exp(-0.5 * cx * cx);
    float profile = body;
    // Fine streaks along the motion at three scales, gathered in patches, mostly added light.
    float Fq = Dl.w;
    float patchy = 0.5 + 0.5 * valueNoise(vec2(u * 0.9 + 2.0, s * 3.0 + fi), uSeed + 91 + i);
    float streaks = 0.5 * gradientNoise(vec2(s * Fq, u * Fq / 14.0), uSeed + 101 + i)
                  + 0.32 * gradientNoise(vec2(s * Fq * 2.3, u * Fq * 2.3 / 11.0), uSeed + 103 + i)
                  + 0.18 * gradientNoise(vec2(s * Fq * 5.0, u * Fq * 5.0 / 9.0), uSeed + 107 + i);
    float tex = 0.95 + 1.8 * Dl.z * (0.3 + 0.7 * patchy) * max(streaks + 0.1, 0.0);
    float grad = exp(Dl.x * clamp(x, -1.0, 1.0));
    // The layout's luminance, whatever the colors.
    float luminanceHere = C.x * profile * env * tex * grad;
    lum[i] = luminanceHere + skirtLum;
    total += lum[i];
    // A white streak's colors as fringes; a colored streak's hue is read after the loop.
    if (C.w > 0.5) {
      // White in the middle, and on each side one color running into it (Cyan on one side and Yellow on the other in
      // Bold), so the two edge colors never overlap into mint or aqua. Each edge color dims along its own path.
      float D = mix(B.z, B.w, smoothstep(0.0, 1.0, t));
      float o = G.z < 0.0 ? -s : s;
      float oc = o / max(0.5 * D, 1e-4);
      float coreW = exp(-0.5 * oc * oc);
      vec3 edge = vec3(1.0);
      for (int j = 0; j < 4; j++) {
        if (j >= uComps) break;
        if ((o < 0.0 && uSpectrum[j] < 0.25) || (o >= 0.0 && uSpectrum[j] > 0.75)) edge = dimHue(j, clamp(body, 0.0, 1.0));
      }
      col[i] = -1;
      fixedHue[i] = mix(edge, vec3(1.0), 0.85 * coreW);
      // Its hot core: white light that reaches white at the peak.
      hot += vec3(C.x * C.z * body * coreShape * env);
    } else if (C.z > 0.0) {
      // A lead streak's core in its own color, hottest at one place along it (H.w) and on its bright side, so the
      // light goes toward a lighter blue and white only at the hottest point.
      float along = (u - H.w) / (1.8 * reach);
      coreLum[i] = C.x * C.z * coreShape * body * env * grad * exp(-along * along);
    }
  }
  // Where lights overlap, the overlap is their light added up, lighter than each alone. Its hue is the stronger
  // light's (each counts by its luminance to the sixteenth power, so two hues never mix into a third), and a pack color
  // is read at the light here: bright where lights overlap, dimming along its own path (Lime into Forest) only where
  // the light really falls.
  vec3 leadSum = vec3(0.0);
  float leadW = 0.0;
  float l1 = 0.0;
  float l2 = 0.0;
  vec3 h1 = vec3(1.0);
  vec3 h2 = vec3(1.0);
  for (int i = 0; i < MAX_LIGHTS; i++) {
    if (i >= uLights) break;
    if (lum[i] <= 1e-7) continue;
    vec3 h = col[i] >= 0 ? dimHue(col[i], clamp(total / max(peak[i], 1e-4), 0.0, 1.0)) : fixedHue[i];
    if (lum[i] > l1) {
      l2 = l1;
      h2 = h1;
      l1 = lum[i];
      h1 = h;
    } else if (lum[i] > l2) {
      l2 = lum[i];
      h2 = h;
    }
    // A lead streak's core shines where its light leads, so it never lays blue over Orange-red (pink).
    if (coreLum[i] > 0.0) {
      vec3 own = compColor(col[i]);
      float share = lum[i] / max(total, 1e-5);
      share *= share;
      hot += own / max(luminance(own), 1e-5) * coreLum[i] * share * share;
    }
    float w = lum[i] * 6.0;
    w *= w;
    w *= w;
    w *= w;
    w *= w;
    leadSum += h / max(luminance(h), 1e-5) * w;
    leadW += w;
  }
  vec3 leadHue = leadW > 0.0 ? leadSum / leadW : vec3(1.0);
  // Where two different hues meet at nearly the same strength, they would mix into a third (Cyan and Orange-red to
  // pink, Meta Blue and Orange-red to magenta). Where the light is up, each side keeps its own hue and whitens toward
  // the meeting the way hot light does, a warm hue through pale yellow and a cool one through pale cyan (never through
  // salmon). Only the hue changes, so the light and the design are the same in every pack.
  float meet = smoothstep(0.8, 1.0, l2 / max(l1, 1e-5));
  float lit = smoothstep(0.15, 0.45, total);
  // Only hues far apart around the color wheel mix into a third; near ones (Yellow and Orange-red) mix to their own
  // in-between.
  vec3 n1 = h1 / max(luminance(h1), 1e-5);
  vec3 n2 = h2 / max(luminance(h2), 1e-5);
  vec2 c1 = vec2(n1.r - n1.g, 0.5 * (n1.r + n1.g) - n1.b);
  vec2 c2 = vec2(n2.r - n2.g, 0.5 * (n2.r + n2.g) - n2.b);
  float clash = (1.0 - smoothstep(-0.3, 0.2, dot(c1, c2) / max(length(c1) * length(c2), 1e-5))) * smoothstep(0.05, 0.3, min(length(c1), length(c2)));
  float warmth = clamp((n1.r - n1.b) / max(n1.r + n1.b, 1e-5), -1.0, 1.0);
  vec3 hotWhite = mix(vec3(0.85, 0.97, 1.0), vec3(1.0, 0.9, 0.6), 0.5 + 0.5 * warmth);
  vec3 own = mix(leadHue / max(luminance(leadHue), 1e-5), n1, clash * lit);
  leadHue = mix(own, hotWhite / luminance(hotWhite), meet * clash * lit);
  vec3 sum = leadHue / max(luminance(leadHue), 1e-5) * total;
  // A soft shoulder on the streaks' light, below the level where the tone curve turns a near-white color (Ice) flat
  // white, while saturated colors still whiten at their cores. White streaks' cores come on top and reach white.
  // Its ceiling drops a little away from the stack's bright place, so a wide area of strong light still slopes gently
  // instead of standing flat.
  float sw = (vw - uSwell.x) / max(uSwell.y, 1e-3);
  float ceiling = 0.4 * (1.0 - uSwell.z * (1.0 - exp(-0.5 * sw * sw)));
  float shoulder = total < 0.5 ? total : 0.5 + ceiling * (1.0 - exp(-(total - 0.5) / ceiling));
  sum *= shoulder / max(total, 1e-5);
  return uGround + (sum + hot) * shadow(p);
}
`
