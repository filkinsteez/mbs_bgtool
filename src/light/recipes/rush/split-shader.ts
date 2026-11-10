export const MAX_LIGHTS = 7
export const MAX_TONGUES = 4

/**
 * Rush: light moving too fast to hold its shape. A stack of streaks of light fills the frame, side by side with black
 * between them, flowing along a shared run that bends more and more toward its far end or runs nearly straight, and may
 * fan out. Each streak has a hot core and falls off to black at its edges; fine streaks run inside it along its motion.
 *
 * The light and dark layout never depends on the colors: each streak's luminance is set by the layout (from fixed
 * stand-in colors per role), and the color list only gives its hue, which turns as the light dims (Yellow to
 * Orange-red to deep red, Lime to Forest, Ice to Steel). A white streak shows the colors as fringes on its sides.
 * Soft tongues of shadow rise from the frame's bottom edge in some seeds.
 */
export const RUSH_SPLIT_GLSL = /* glsl */ `
#define MAX_LIGHTS ${MAX_LIGHTS}
#define MAX_TONGUES ${MAX_TONGUES}
uniform vec4 uRun;                  // start x, start y (short sides from the frame center), direction (radians), reach
uniform vec2 uHook;                 // how far the flow bends across by its end: by t squared and by t cubed (per reach)
uniform vec4 uStack;                // fan (widening per reach), warp amount, warp frequency along, warp frequency across
uniform vec4 uLA[MAX_LIGHTS];       // center across (warped), half-width, its variation along, core width (share of the half-width)
uniform vec4 uLB[MAX_LIGHTS];       // side asymmetry (log of left / right), raggedness, split at the start, split at the reach
uniform vec4 uLC[MAX_LIGHTS];       // luminance (layout's), brightness variation along, core gain, 1 for a white streak
uniform vec4 uLD[MAX_LIGHTS];       // across gradient (log of hot side / other side), wander, streak amount, streak frequency
uniform vec4 uLE[MAX_LIGHTS];       // fade in at (along), fade length, fade out at, color (index into the list)
uniform vec4 uLF[MAX_LIGHTS];       // drift across per unit along, bow per unit along squared, core place (half-widths), role (for the color stage's parts)
uniform int uLights;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform vec3 uDim0;                 // per-channel exponents of each color's light below its peak
uniform vec3 uDim1;
uniform vec3 uDim2;
uniform vec3 uDim3;
uniform vec4 uSpectrum;             // each color's place in the spectrum (for a white streak's fringes)
uniform vec4 uFringe;               // each color's level in a white streak
uniform int uComps;
uniform vec3 uGround;
uniform vec4 uTongue[MAX_TONGUES];  // x (short sides from the center), half-width at the base, height above the bottom edge, lean
uniform vec4 uTongueLook;           // edge softness, depth, wander, unused
uniform int uTongues;

vec3 compColor(int k) { return k == 0 ? uC0 : k == 1 ? uC1 : k == 2 ? uC2 : uC3; }
vec3 compDim(int k) { return k == 0 ? uDim0 : k == 1 ? uDim1 : k == 2 ? uDim2 : uDim3; }

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
  float tb = clamp(t, -0.5, 1.6);
  v -= (uHook.x * tb * tb + uHook.y * tb * tb * tb) * reach;
  float vs = v / max(1.0 + uStack.x * clamp(t, -0.3, 1.5), 0.25);
  float vw = vs + uStack.y * valueNoise(vec2(u * uStack.z, vs * uStack.w), uSeed + 7);
  vec3 sum = vec3(0.0);
  for (int i = 0; i < MAX_LIGHTS; i++) {
    if (i >= uLights) break;
    vec4 A = uLA[i];
    vec4 B = uLB[i];
    vec4 C = uLC[i];
    vec4 Dl = uLD[i];
    vec4 E = uLE[i];
    vec4 F = uLF[i];
    float fi = float(i);
    float s0 = vw - (A.x + u * (F.x + u * F.y));
    float wide = A.y * (1.0 + A.z) * exp(abs(B.x)) * 2.4 + 0.5 * max(B.z, B.w) + Dl.y;
    if (abs(s0) > wide) continue;
    float s = s0 - Dl.y * valueNoise(vec2(u * 1.3, fi * 4.7), uSeed + 31 + i);
    float halfW = A.y * max(0.3, 1.0 + A.z * valueNoise(vec2(u * 1.1 + 7.1, fi * 2.7), uSeed + 61 + i));
    // Each side of the streak has its own width, wandering along it.
    float sideScale = exp(s < 0.0 ? B.x : -B.x) * (1.0 + B.y * valueNoise(vec2(u * 5.5, fi * 4.1 + (s < 0.0 ? 1.0 : 2.0)), uSeed + 71 + i));
    float x = s / max(halfW * sideScale, 1e-4);
    // Behind the start (a line dragged away from the frame) the streaks go on at most of their brightness.
    float tail = 0.75 + 0.25 * exp(min(u, 0.0) / (0.5 * reach));
    float fadeIn = max(smoothstep(E.x - E.y, E.x + E.y, u), tail);
    float fadeOut = 1.0 - smoothstep(E.z - E.y, E.z + E.y, u);
    float ta = max(u, 0.0) / max(reach, 1.0);
    float env = fadeIn * fadeOut * max(0.0, 1.0 + C.y * valueNoise(vec2(u * 1.05 + 11.0, fi * 6.1), uSeed + 83 + i)) / (1.0 + 0.3 * ta * ta);
    if (env < 1e-4) continue;
    // A streak: a body falling off to black at its edges, and a hot core.
    float body = exp(-1.9 * x * x);
    float cx = (s / max(halfW, 1e-4) - F.z) / A.w;
    float profile = body * (1.0 + C.z * exp(-0.5 * cx * cx));
    // Fine streaks along the motion at three scales, gathered in patches, mostly added light.
    float Fq = Dl.w;
    float patchy = 0.5 + 0.5 * valueNoise(vec2(u * 0.9 + 2.0, s * 3.0 + fi), uSeed + 91 + i);
    float streaks = 0.5 * gradientNoise(vec2(s * Fq, u * Fq / 14.0), uSeed + 101 + i)
                  + 0.32 * gradientNoise(vec2(s * Fq * 2.3, u * Fq * 2.3 / 11.0), uSeed + 103 + i)
                  + 0.18 * gradientNoise(vec2(s * Fq * 5.0, u * Fq * 5.0 / 9.0), uSeed + 107 + i);
    float tex = 0.85 + 1.8 * Dl.z * (0.3 + 0.7 * patchy) * max(streaks + 0.2, 0.0);
    float grad = exp(Dl.x * clamp(x, -1.0, 1.0));
    // The layout's luminance, whatever the colors.
    float luminanceHere = C.x * profile * env * tex * grad;
    // The hue: the streak's color, turning as it dims below its peak; a white streak's colors as fringes.
    float level = clamp(profile / (1.0 + C.z) * sqrt(min(env, 1.0)), 0.0, 1.0);
    vec3 hue = vec3(0.0);
    if (C.w > 0.5) {
      float D = mix(B.z, B.w, smoothstep(0.0, 1.0, t));
      float sigma = 0.6 * halfW;
      for (int k = 0; k < 4; k++) {
        if (k >= uComps) break;
        float o = (s - (uSpectrum[k] - 0.5) * D) / sigma;
        hue += uFringe[k] * compColor(k) * exp(-0.5 * o * o);
      }
    } else {
      int k = int(E.w + 0.5);
      hue = compColor(k) * pow(vec3(max(level, 1e-4)), compDim(k));
    }
    sum += hue / max(luminance(hue), 1e-5) * luminanceHere;
  }
  return uGround + sum * shadow(p);
}
`
