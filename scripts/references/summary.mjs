// Prints the main numbers from every profile in docs/references/awe/profiles/
// as plain text, for comparing references side by side.
//
//   node scripts/references/summary.mjs

import fs from "node:fs/promises";
import { NOTES_DIR } from "./references.mjs";

const DIR = `${NOTES_DIR}/profiles`;
const pct = (v) => (v === null || v === undefined ? "-" : `${(v * 100).toFixed(1)}%`);

async function main() {
  const files = (await fs.readdir(DIR)).filter((f) => f.endsWith(".json")).sort();
  for (const f of files) {
    const p = JSON.parse(await fs.readFile(`${DIR}/${f}`, "utf8"));
    const g = p.grain.alongIso ?? p.grain.isotropic;
    const iso = p.grain.isotropic;
    console.log(`\n## ${p.id}  ${p.width}x${p.height}  axis ${p.axis.angleDeg} deg  R2 ${p.axis.r2}  lateral std ${p.lateral.meanStd}`);
    console.log(`stops: ${p.ramp.stops.map((s) => `${s.hex}@${Math.round(s.pos * 100)} (L${s.L.toFixed(2)} C${s.C.toFixed(3)})`).join("  ")}`);
    for (const t of p.ramp.transitions) {
      const a = p.ramp.stops[t.from].hex;
      const b = p.ramp.stops[t.to].hex;
      const sh = t.shape ?? {};
      const flags = [
        t.midLighterThanBoth ? "MID LIGHTER" : "",
        t.midDarkerThanBoth ? "MID DARKER" : "",
        t.maxLInside?.aboveBothEnds ? `max L inside ${t.maxLInside.hex}` : "",
        t.peakChroma?.aboveBothEnds ? `chroma peak inside ${t.peakChroma.hex}` : "",
      ].filter(Boolean);
      console.log(
        `  ${a} -> ${b}  mid ${pct(t.mid)}  10-90 ${pct(t.width1090FrameH)} of H (strips ${pct(sh.widthStripsFrameH?.min)}..${pct(sh.widthStripsFrameH?.max)})  dE ${t.deltaE}  C/lin ${t.midChromaVsLinearMix}  C/srgb ${t.midChromaVsSrgbMix}  dL vs lin ${t.midLVsLinearMix}  bow ${sh.bowFrameH}  tilt ${sh.tiltFrameH}  wave ${sh.wavinessRmsFrameH}  departure ${t.maxDeparture?.deltaE} ${t.maxDeparture?.hex}  ${flags.join(", ")}`,
      );
    }
    if (p.ramp.bridges.length) console.log(`bridges: ${p.ramp.bridges.map((b) => `${b.hex}@${Math.round(b.pos * 100)} L${b.L} vs ${b.neighborsL.join("/")}`).join("  ")}`);
    const e = p.extremes;
    console.log(`brightest 0.5% ${e.brightest05.hex} L${e.brightest05.L}  any255 ${pct(e.shareAnyChannel255)} white ${pct(e.shareWhite255)}  darkest 1% ${e.darkest1.hex} L${e.darkest1.L}  black0 ${pct(e.shareBlack0)}  median L ${e.medianL}`);
    console.log(`grain ${g.mode}: L ${g.stdL100}  luma ${g.stdLumaPercent}%  chroma ${g.stdChroma100}  mono ${g.monoShare}  half-lag ${JSON.stringify(g.halfCorrelationLagPx)}  | isotropic L ${iso.stdL100} luma ${iso.stdLumaPercent}% half-lag ${JSON.stringify(iso.halfCorrelationLagPx)}  by L: ${g.byLightness.map((b) => (b.stdL100 === null ? "-" : b.stdL100)).join(" ")}`);
    for (const gl of p.glows ?? []) {
      for (const s of gl.sides) {
        const comps = s.gauss3?.components.map((c) => `${c.sigmaShortSide}(${Math.round(c.weight * 100)}%)`).join(" + ");
        console.log(`  glow ${gl.name} ${s.group} ${s.side}: d50 ${s.d50ShortSide} d10 ${s.d10ShortSide} d01 ${s.d01ShortSide} of short side | 3 gaussians ${comps} rms ${s.gauss3?.relRms} | power d0 ${s.powerLaw.d0ShortSide} n ${s.powerLaw.exponent} | ${s.colors.map((c) => c.hex).join(" > ")}`);
      }
    }
  }
}

await main();
