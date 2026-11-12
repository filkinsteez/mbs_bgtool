import { MEET_GLSL } from '../../engine/meet'

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
${MEET_GLSL}
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
// A hue (at luminance 1) whitened by t the way hot light whitens: a warm hue first through yellow, a cool one through
// pale cyan, then to white, so Orange-red never passes through salmon or pink.
vec3 hotWhiten(vec3 n, float t) {
  float warmth = clamp((n.r - n.b) / max(n.r + n.b, 1e-5), -1.0, 1.0);
  vec3 mid = mix(vec3(0.55, 0.9, 1.0), vec3(1.0, 0.85, 0.25), 0.5 + 0.5 * warmth);
  mid /= luminance(mid);
  return t < 0.5 ? mix(n, mid, 2.0 * t) : mix(mid, vec3(1.0), 2.0 * t - 1.0);
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
  float coreBurn[MAX_LIGHTS];
  float thinOf[MAX_LIGHTS];
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
    coreBurn[i] = 0.0;
    vec4 A = uLA[i];
    vec4 B = uLB[i];
    vec4 C = uLC[i];
    thinOf[i] = C.w < 0.5 ? 1.0 - smoothstep(0.02, 0.035, A.y) : 0.0;
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
      // Toward a warm white for a warm side and a cool white for a cool one, so Orange-red whitens through pale orange
      // and yellow, never through salmon.
      fixedHue[i] = hotWhiten(side / max(luminance(side), 1e-5), 0.85 * pow(glow, 6.0));
      lum[i] = C.x * glow * env;
      total += lum[i];
      continue;
    }
    // A streak: a body falling off to its skirt at its edges (softer in a wide band), and a hot core. Every color but
    // the lead (Meta Blue, which dims softly into navy) keeps a broad bright top and falls faster on both sides, so it
    // never sits at mid lightness over a wide area (Lime would read olive or teal, Tan grey-brown).
    float x2 = x * x;
    float body = exp(-G.y * (F.w > 0.5 ? 0.5 * x2 + 0.6 * x2 * x2 : x2));
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
      float oc = o / max(0.8 * D, 1e-4);
      float coreW = exp(-0.5 * oc * oc);
      // The two edge colors blend into each other across the white middle, so no line runs down the streak.
      vec3 lowEdge = vec3(1.0);
      vec3 highEdge = vec3(1.0);
      for (int j = 0; j < 4; j++) {
        if (j >= uComps) break;
        if (uSpectrum[j] < 0.25) lowEdge = dimHue(j, clamp(body, 0.0, 1.0));
        if (uSpectrum[j] > 0.75) highEdge = dimHue(j, clamp(body, 0.0, 1.0));
      }
      vec3 edge = mix(lowEdge, highEdge, smoothstep(-0.8 * D, 0.8 * D, o));
      col[i] = -1;
      fixedHue[i] = mix(edge, vec3(1.0), 0.85 * coreW);
      // Its hot core: white light that reaches white at the peak.
      hot += vec3(C.x * C.z * body * coreShape * env);
    } else if (C.z > 0.0) {
      // A lead streak's core in its own color, hottest at one place along it (H.w) and on its bright side. Its middle
      // line (about an eighth of the band's width) burns white where the core is hottest, as bright light does on
      // film, with the color at its edges; there its light rises up to two and a half times, so the white reads as
      // light, not grey.
      float along = (u - H.w) / (1.8 * reach);
      float level = coreShape * body * env * grad * exp(-along * along);
      float mid = (s / max(halfW, 1e-4) - F.z) / 0.3;
      float burn = exp(-0.5 * mid * mid) * smoothstep(0.5, 0.95, level);
      // A thin streak's core is white all across, so beside it no ring of its own blue darker than the light around
      // it shows; its glow fades from white into the colors around it.
      coreBurn[i] = max(burn, thinOf[i]);
      coreLum[i] = 1.6 * C.x * C.z * level * (1.0 + 1.5 * burn);
    }
  }
  // Each light's color, read at the level of all the light here against that light's peak (its own hue where it is
  // bright, dimming along its own path, Lime into Forest and Ice into Slate, only where the picture gets dark, never
  // in a thin rim where it fades under a brighter neighbour), gathered per pack color, with white light (white
  // streaks, bridges) as a fifth. Each color leads by its lights' light over the square root of their peaks, so where
  // a light color (Lime, Yellow) meets a dark one (Meta Blue) the hand-over sits near the middle between them, and the
  // lead goes by the layout's light, so a hand-over sits in the same place in every pack. A thin streak adds light but
  // doesn't lead, so beside its white core the color around it carries on, with no darker line along it.
  float thinTotal = 0.0;
  for (int i = 0; i < MAX_LIGHTS; i++) {
    if (i >= uLights) break;
    thinTotal += thinOf[i] * lum[i];
  }
  vec3 gathered[5];
  float gatheredLum[5];
  float gatheredLevel[5];
  float peakHere = 0.0;
  for (int k = 0; k < 5; k++) {
    gathered[k] = vec3(0.0);
    gatheredLum[k] = 0.0;
    gatheredLevel[k] = 0.0;
  }
  for (int i = 0; i < MAX_LIGHTS; i++) {
    if (i >= uLights) break;
    if (lum[i] <= 1e-7) continue;
    vec3 h = col[i] >= 0 ? dimHue(col[i], clamp(total / max(peak[i], 1e-4), 0.0, 1.0)) : fixedHue[i];
    int k = col[i] >= 0 ? min(col[i], 3) : 4;
    gathered[k] += h / max(luminance(h), 1e-5) * lum[i];
    gatheredLum[k] += lum[i];
    gatheredLevel[k] += (1.0 - thinOf[i]) * lum[i] / sqrt(max(peak[i], 1e-4));
    peakHere += lum[i] * peak[i];
    // A lead streak's core shines where its light leads, so it never lays blue over Orange-red (pink). A thin streak's
    // light doesn't count against it, so a wide band's core doesn't dip along both sides of a thin streak.
    if (coreLum[i] > 0.0) {
      vec3 own = compColor(col[i]);
      float share = min(lum[i] / max(total - thinTotal + thinOf[i] * lum[i], 1e-5), 1.0);
      share *= share;
      share *= share;
      hot += hotWhiten(own / max(luminance(own), 1e-5), 0.95 * coreBurn[i]) * coreLum[i] * share * share;
    }
  }
  vec3 colorsHere[5];
  for (int k = 0; k < 5; k++) colorsHere[k] = gatheredLum[k] > 1e-7 ? gathered[k] / max(luminance(gathered[k]), 1e-6) : vec3(1.0);
  // White light takes the temperature of the colored light it meets, so Orange-red meeting it goes pale orange, not
  // salmon pink.
  vec3 coloredHere = gathered[0] + gathered[1] + gathered[2] + gathered[3];
  float warmthHere = clamp((coloredHere.r - coloredHere.b) / max(coloredHere.r + coloredHere.b, 1e-5), -1.0, 1.0);
  vec3 temperedWhite = mix(vec3(0.9, 0.98, 1.0), vec3(1.0, 0.92, 0.6), 0.5 + 0.5 * warmthHere);
  colorsHere[4] = mix(colorsHere[4], temperedWhite / luminance(temperedWhite), smoothstep(0.0, 0.3 * total, total - gatheredLum[4]));
  // The colors near the leading one in hue add as plain light, and so do the rest; the two groups then meet by the
  // shared meeting rule (engine/meet.ts), so far hues meet through the leading color's pale tint and white and never
  // mix into violet or olive, even where three colors meet.
  int top = 0;
  for (int k = 1; k < 5; k++) {
    if (gatheredLevel[k] > gatheredLevel[top]) top = k;
  }
  vec3 groups[5];
  float groupLevel[5];
  for (int k = 0; k < 5; k++) {
    groups[k] = vec3(0.0);
    groupLevel[k] = 0.0;
  }
  for (int k = 0; k < 5; k++) {
    float q = gatheredLevel[k];
    if (q <= 0.0) continue;
    float apart = meetApart(colorsHere[k], colorsHere[top]);
    groups[0] += (1.0 - apart) * q * colorsHere[k];
    groupLevel[0] += (1.0 - apart) * q;
    groups[1] += apart * q * colorsHere[k];
    groupLevel[1] += apart * q;
  }
  for (int k = 0; k < 2; k++) groups[k] = groupLevel[k] > 1e-7 ? groups[k] / max(luminance(groups[k]), 1e-6) : vec3(1.0);
  float shownHere = total < 0.5 ? total : 0.5 + 0.4 * (1.0 - exp(-(total - 0.5) / 0.4));
  // Where the two groups meet in light that is up, light rises along the meeting (the shared rule's bridge), so its
  // white middle reads light, never grey; where they meet in dim light they fade toward their own dark shades and meet
  // near black (the rule's dark half), so a dim meeting never reads grey or olive either.
  float levels = max(groupLevel[0] + groupLevel[1], 1e-6);
  float meetHere = meetBridgeShares(groupLevel[0] / levels, groupLevel[1] / levels) * meetApart(groups[0], groups[1]);
  // A meeting counts as lit by the light here against the peaks of the lights that make it, not by its light alone,
  // since Meta Blue is dark even at its peak: two bands meeting on their bright sides hand over softly and lift,
  // and only a meeting far down their dim sides (a dark band, the dark room) fades through their dark shades.
  float litHere = smoothstep(0.05, 0.25, total * total / max(peakHere, 1e-6));
  float metShown = meetDarkLight(meetBridgeLight(shownHere, meetHere * litHere), meetHere * (1.0 - litHere));
  vec3 leadHue = meetColors5(groups, groupLevel, 2, mix(meetSharpness(metShown), 3.0, litHere));
  vec3 sum = leadHue / max(luminance(leadHue), 1e-5) * total * metShown / max(shownHere, 1e-5);
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

// For the color stage: where p lies across the flow (x) and along it (y), in short sides; parts.ts's rushAcrossAt
// gives the same on the CPU. x is the same all along each streak's middle (the run's bend and fan, the stack's warp
// and each streak's drift, bow and wander taken out) and runs evenly between two neighbouring middles, the k-th lowest
// middle here keeping the place the k-th lowest has at the run's start; beyond the outer streaks it follows the outer
// one. It rises toward the right-hand side of the line's direction. y is 0 at the line's start, negative behind it.
#define LOOK_ACROSS
float streakMiddle(int i, float u) {
  return uLA[i].x + u * (uLF[i].x + u * uLF[i].y) + uLD[i].y * valueNoise(vec2(u * 1.3, float(i) * 4.7), uSeed + 31 + i);
}
vec2 lookAcross(vec2 uv, vec2 p) {
  vec2 dir = vec2(cos(uRun.z), sin(uRun.z));
  vec2 q = p - uRun.xy;
  float u = dot(q, dir);
  float reach = max(uRun.w, 1e-3);
  float t = u / reach;
  float v = dot(q, vec2(-dir.y, dir.x)) - (uHook.x * bendArc(t) + uHook.y * bendLean(t)) * reach;
  float vs = v / max(1.0 + uStack.x * softClamp(t, -0.3, 1.5, SOFT_TURN), 0.25);
  float vw = vs + uStack.y * valueNoise(vec2(u * uStack.z, vs * uStack.w), uSeed + 7);
  int n = min(uLights, MAX_LIGHTS);
  if (n <= 0) return vec2(vw, u);
  float at[MAX_LIGHTS];
  float rest[MAX_LIGHTS];
  for (int i = 0; i < MAX_LIGHTS; i++) {
    if (i >= n) break;
    at[i] = streakMiddle(i, u);
    rest[i] = streakMiddle(i, 0.0);
  }
  // Both lists from low to high.
  for (int i = 1; i < MAX_LIGHTS; i++) {
    if (i >= n) break;
    float a = at[i];
    float r = rest[i];
    int j = i - 1;
    for (int s = 0; s < MAX_LIGHTS; s++) {
      if (j < 0 || at[j] <= a) break;
      at[j + 1] = at[j];
      j--;
    }
    at[j + 1] = a;
    j = i - 1;
    for (int s = 0; s < MAX_LIGHTS; s++) {
      if (j < 0 || rest[j] <= r) break;
      rest[j + 1] = rest[j];
      j--;
    }
    rest[j + 1] = r;
  }
  if (vw <= at[0]) return vec2(rest[0] + vw - at[0], u);
  for (int k = 0; k < MAX_LIGHTS - 1; k++) {
    if (k + 1 >= n) break;
    if (vw <= at[k + 1]) return vec2(rest[k] + (vw - at[k]) / max(at[k + 1] - at[k], 1e-6) * (rest[k + 1] - rest[k]), u);
  }
  return vec2(rest[n - 1] + vw - at[n - 1], u);
}
`
