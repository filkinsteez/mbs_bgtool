import sharp from "sharp";

const FONT = "Helvetica, Arial, sans-serif";
const W = 1600;
const H = 1000;
const THUMB_H = 900;
const PANEL_X = 640;
const PANEL_W = 920;
const SIDE_COLORS = ["#ffd166", "#06d6a0", "#ef476f", "#4cc9f0", "#c77dff", "#f8961e", "#90be6d", "#f94144"];

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function text(x, y, s, { size = 14, fill = "#dddddd", anchor = "start", weight = "normal" } = {}) {
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}">${esc(s)}</text>`;
}

export async function renderPlot(targetPath, prof, outPath) {
  const meta = await sharp(targetPath).metadata();
  const scale = Math.min(THUMB_H / meta.height, (PANEL_X - 40) / meta.width);
  const tw = Math.round(meta.width * scale);
  const th = Math.round(meta.height * scale);
  const tx = 20;
  const ty = 60;
  const thumb = await sharp(targetPath).resize(tw, th).png().toBuffer();

  let svg = "";
  svg += text(20, 32, `${prof.id}  (${prof.width}x${prof.height}, node ${prof.figmaNodeId})`, { size: 20, fill: "#ffffff", weight: "bold" });
  svg += text(PANEL_X, 32, `axis ${prof.axis.angleDeg} deg  1D fit R2 ${prof.axis.r2}  lateral std ${prof.lateral.meanStd}`, { size: 15 });

  // Ignore rects.
  for (const ig of prof.ignore) {
    const [x, y, w, h] = ig.rect;
    svg += `<rect x="${tx + x * scale}" y="${ty + y * scale}" width="${w * scale}" height="${h * scale}" fill="none" stroke="#ff3355" stroke-width="2" stroke-dasharray="6 4"/>`;
  }

  // Axis line and stops.
  const t = (prof.axis.angleDeg * Math.PI) / 180;
  const dx = Math.cos(t);
  const dy = Math.sin(t);
  const ends = prof.axisSamples.filter((s) => s.pct === 0 || s.pct === 100);
  if (ends.length === 2) {
    const [a, b] = ends;
    svg += `<line x1="${tx + a.x * scale}" y1="${ty + a.y * scale}" x2="${tx + b.x * scale}" y2="${ty + b.y * scale}" stroke="#ffffff" stroke-width="1.5" stroke-dasharray="5 4"/>`;
    const ax = tx + b.x * scale;
    const ay = ty + b.y * scale;
    svg += `<polygon points="${ax},${ay} ${ax - 12 * dx + 6 * dy},${ay - 12 * dy - 6 * dx} ${ax - 12 * dx - 6 * dy},${ay - 12 * dy + 6 * dx}" fill="#ffffff"/>`;
    for (const s of prof.ramp.stops) {
      const px = tx + (a.x + (b.x - a.x) * s.pos) * scale;
      const py = ty + (a.y + (b.y - a.y) * s.pos) * scale;
      svg += `<circle cx="${px}" cy="${py}" r="6" fill="${s.hex}" stroke="#ffffff" stroke-width="1.5"/>`;
    }
  }

  // Glow ridges.
  (prof.glows ?? []).forEach((g, gi) => {
    const col = SIDE_COLORS[gi % SIDE_COLORS.length];
    for (const [x, y] of g.ridge) svg += `<circle cx="${tx + x * scale}" cy="${ty + y * scale}" r="2.2" fill="${col}"/>`;
    if (g.circle) svg += `<circle cx="${tx + g.circle.cx * scale}" cy="${ty + g.circle.cy * scale}" r="${g.circle.r * scale}" fill="none" stroke="${col}" stroke-width="1" stroke-dasharray="3 5"/>`;
  });

  // Axis profile strip and curves.
  let y0 = 56;
  svg += text(PANEL_X, y0, "profile along the axis (mean of each band across the frame), stops, 10-90% transition spans", { size: 13, fill: "#aaaaaa" });
  y0 += 8;
  const prof1 = prof.ramp.profile;
  const cw = PANEL_W / prof1.length;
  prof1.forEach((p, k) => {
    if (p) svg += `<rect x="${PANEL_X + k * cw}" y="${y0}" width="${cw + 0.6}" height="54" fill="${p.hex}"/>`;
  });
  const chartY = y0 + 64;
  const chartH = 200;
  svg += `<rect x="${PANEL_X}" y="${chartY}" width="${PANEL_W}" height="${chartH}" fill="#111111" stroke="#333333"/>`;
  for (const tr of prof.ramp.transitions) {
    if (tr.p10 === undefined) continue;
    svg += `<rect x="${PANEL_X + tr.p10 * PANEL_W}" y="${chartY}" width="${(tr.p90 - tr.p10) * PANEL_W}" height="${chartH}" fill="#ffffff" fill-opacity="0.07"/>`;
  }
  const line = (vals, color, sc) => {
    const pts = [];
    vals.forEach((p, k) => {
      if (p) pts.push(`${PANEL_X + (k + 0.5) * cw},${chartY + chartH - Math.min(1, sc(p)) * chartH}`);
    });
    return `<polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="2"/>`;
  };
  svg += line(prof1, "#ffffff", (p) => p.L);
  svg += line(prof1, "#ff9f1c", (p) => p.C * 3);
  svg += text(PANEL_X + 6, chartY + 16, "Oklab L (white, 0-1)   chroma x3 (orange)", { size: 12, fill: "#999999" });
  prof.ramp.stops.forEach((s, i) => {
    const x = PANEL_X + s.pos * PANEL_W;
    svg += `<line x1="${x}" y1="${chartY}" x2="${x}" y2="${chartY + chartH}" stroke="#ffffff" stroke-opacity="0.35"/>`;
    const ly = chartY + chartH + 16 + (i % 3) * 15;
    svg += `<rect x="${x - 5}" y="${ly - 10}" width="10" height="10" fill="${s.hex}" stroke="#ffffff" stroke-width="0.5"/>`;
    svg += text(x + 8, ly, `${s.hex} @${Math.round(s.pos * 100)}%`, { size: 11 });
  });

  // Row and column means.
  let ry = chartY + chartH + 66;
  svg += text(PANEL_X, ry, "row means (top to bottom)", { size: 13, fill: "#aaaaaa" });
  ry += 6;
  const rw = PANEL_W / prof.rowMeans.length;
  prof.rowMeans.forEach((c, k) => {
    if (c) svg += `<rect x="${PANEL_X + k * rw}" y="${ry}" width="${rw + 0.6}" height="28" fill="${c.hex}"/>`;
  });
  ry += 46;
  svg += text(PANEL_X, ry, "column means (left to right)", { size: 13, fill: "#aaaaaa" });
  ry += 6;
  prof.colMeans.forEach((c, k) => {
    if (c) svg += `<rect x="${PANEL_X + k * rw}" y="${ry}" width="${rw + 0.6}" height="28" fill="${c.hex}"/>`;
  });

  // Samples every 5% along the axis.
  ry += 50;
  svg += text(PANEL_X, ry, "median color every 5% along the axis", { size: 13, fill: "#aaaaaa" });
  ry += 6;
  const sw = PANEL_W / prof.axisSamples.length;
  prof.axisSamples.forEach((s, k) => {
    if (s.hex) svg += `<rect x="${PANEL_X + k * sw}" y="${ry}" width="${sw - 2}" height="34" fill="${s.hex}"/>`;
    if (k % 2 === 0 && s.hex) svg += text(PANEL_X + k * sw, ry + 48, s.hex.slice(1), { size: 10, fill: "#bbbbbb" });
  });

  // Grain by lightness.
  const gr = prof.grain.alongIso ?? prof.grain.isotropic;
  const gy = ry + 100;
  const gw = 420;
  const gh = 170;
  svg += text(PANEL_X, gy - 22, `grain (${gr.mode}): std L x100 by lightness (bars), chroma (thin)`, { size: 12, fill: "#aaaaaa" });
  svg += text(PANEL_X, gy - 8, `overall L ${gr.stdL100}  luma ${gr.stdLumaPercent}% of 255  mono share ${gr.monoShare}  size ${gr.grainSizePx ?? "-"} px`, { size: 12, fill: "#aaaaaa" });
  svg += `<rect x="${PANEL_X}" y="${gy}" width="${gw}" height="${gh}" fill="#111111" stroke="#333333"/>`;
  const maxStd = Math.max(0.5, ...gr.byLightness.map((b) => b.stdL100 ?? 0)) * 1.15;
  gr.byLightness.forEach((b, k) => {
    const bx = PANEL_X + k * (gw / 10) + 6;
    if (b.stdL100 !== null) {
      const bh = (b.stdL100 / maxStd) * gh;
      svg += `<rect x="${bx}" y="${gy + gh - bh}" width="${gw / 10 - 16}" height="${bh}" fill="#8ecae6"/>`;
      const ch = ((b.stdChroma100 ?? 0) / maxStd) * gh;
      svg += `<rect x="${bx + gw / 10 - 14}" y="${gy + gh - ch}" width="4" height="${ch}" fill="#ffb703"/>`;
      svg += text(bx, gy + gh - bh - 4, b.stdL100.toFixed(2), { size: 10 });
    }
    svg += text(bx, gy + gh + 14, `L${(k / 10).toFixed(1)}`, { size: 10, fill: "#888888" });
  });

  // Right lower panel: glow falloff (Contour) or grain autocorrelation.
  const px = PANEL_X + gw + 40;
  const pw = PANEL_W - gw - 40;
  svg += `<rect x="${px}" y="${gy}" width="${pw}" height="${gh}" fill="#111111" stroke="#333333"/>`;
  const sides = (prof.glows ?? []).flatMap((g, gi) => g.sides.map((s) => ({ ...s, gi })));
  if (sides.length) {
    const xMax = Math.max(...sides.map((s) => s.profileLengthShortSide));
    const yOf = (v) => gy + gh - ((Math.log10(Math.max(1e-3, v)) + 3) / 3) * gh;
    svg += text(px, gy - 8, `glow falloff, log scale 0.001-1, x to ${xMax.toFixed(2)} of short side`, { size: 12, fill: "#aaaaaa" });
    sides.forEach((s, k) => {
      const col = SIDE_COLORS[k % SIDE_COLORS.length];
      const pts = s.normalizedProfile.map(([d, v]) => `${px + (d / xMax) * pw},${yOf(v)}`);
      svg += `<polyline points="${pts.join(" ")}" fill="none" stroke="${col}" stroke-width="1.8"/>`;
      svg += text(px + pw - 6, gy + 14 + k * 13, `${s.name} ${s.group} ${s.side}`, { size: 10, fill: col, anchor: "end" });
    });
  } else {
    const [nameA, nameB] = Object.keys(gr.autocorr);
    svg += text(px, gy - 8, `grain autocorrelation, lag 0-12 px (${nameA} solid, ${nameB} dashed)`, { size: 12, fill: "#aaaaaa" });
    const yOf = (v) => gy + gh - ((v + 0.2) / 1.2) * gh;
    svg += `<line x1="${px}" y1="${yOf(0)}" x2="${px + pw}" y2="${yOf(0)}" stroke="#444444"/>`;
    svg += `<line x1="${px}" y1="${yOf(0.5)}" x2="${px + pw}" y2="${yOf(0.5)}" stroke="#333333" stroke-dasharray="3 3"/>`;
    const pl = (arr, dash) => `<polyline points="${arr.map((v, k) => `${px + (k / 12) * pw},${yOf(v)}`).join(" ")}" fill="none" stroke="#8ecae6" stroke-width="2" ${dash ? 'stroke-dasharray="6 4"' : ""}/>`;
    svg += pl(gr.autocorr[nameA], false) + pl(gr.autocorr[nameB], true);
  }

  // Extremes.
  const ex = prof.extremes;
  const ey = gy + gh + 40;
  svg += `<rect x="${PANEL_X}" y="${ey - 12}" width="14" height="14" fill="${ex.brightest05.hex}" stroke="#fff" stroke-width="0.5"/>`;
  svg += text(PANEL_X + 20, ey, `brightest 0.5% ${ex.brightest05.hex}  at 255: any channel ${(ex.shareAnyChannel255 * 100).toFixed(2)}%, white ${(ex.shareWhite255 * 100).toFixed(2)}%`, { size: 12 });
  svg += `<rect x="${PANEL_X + 470}" y="${ey - 12}" width="14" height="14" fill="${ex.darkest1.hex}" stroke="#fff" stroke-width="0.5"/>`;
  svg += text(PANEL_X + 490, ey, `darkest 1% ${ex.darkest1.hex} (L ${ex.darkest1.L})  black 0: ${(ex.shareBlack0 * 100).toFixed(2)}%`, { size: 12 });

  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${svg}</svg>`);
  await sharp({ create: { width: W, height: H, channels: 3, background: "#1b1b1b" } })
    .composite([
      { input: thumb, left: tx, top: ty },
      { input: overlay, left: 0, top: 0 },
    ])
    .png({ compressionLevel: 9, palette: true, colors: 256, dither: 0.6, effort: 8 })
    .toFile(outPath);
}
