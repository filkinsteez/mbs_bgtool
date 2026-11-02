// Estimates where streaks converge: the structure tensor gives each patch's
// streak direction (perpendicular to the dominant gradient); a least-squares
// fit finds the point closest to all streak lines, weighted by coherence.
//
//   node prototypes/contour-beams/convergence.mjs <png> <x0,y0,x1,y1> [step]
import sharp from 'sharp';

const [file, box, stepS = '12'] = process.argv.slice(2);
const [bx0, by0, bx1, by1] = box.split(',').map(Number);
const step = Number(stepS);
// High-pass: subtract a wide blur so the slow falloff along the streaks
// does not dominate the gradient.
const grey = await sharp(file).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
const wide = await sharp(file).removeAlpha().greyscale().blur(24).raw().toBuffer();
const W = grey.info.width;
const H = grey.info.height;
const data = new Float32Array(W * H);
for (let i = 0; i < W * H; i++) data[i] = grey.data[i] - wide[i];
const L = (x, y) => data[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];

let a11 = 0;
let a12 = 0;
let a22 = 0;
let b1 = 0;
let b2 = 0;
const lines = [];
for (let y = by0; y < by1; y += step) {
  for (let x = bx0; x < bx1; x += step) {
    let jxx = 0;
    let jxy = 0;
    let jyy = 0;
    for (let j = -8; j <= 8; j++) {
      for (let i = -8; i <= 8; i++) {
        const gx = (L(x + i + 1, y + j) - L(x + i - 1, y + j)) / 2;
        const gy = (L(x + i, y + j + 1) - L(x + i, y + j - 1)) / 2;
        jxx += gx * gx;
        jxy += gx * gy;
        jyy += gy * gy;
      }
    }
    const tr = jxx + jyy;
    if (tr < 1) continue;
    const det = jxx * jyy - jxy * jxy;
    const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
    const l1 = tr / 2 + disc;
    const l2 = tr / 2 - disc;
    const coh = (l1 - l2) / (l1 + l2 + 1e-9);
    // Dominant gradient direction; the streak runs perpendicular to it.
    const ang = 0.5 * Math.atan2(2 * jxy, jxx - jyy);
    const nx = Math.cos(ang);
    const ny = Math.sin(ang);
    const w = coh * coh * Math.sqrt(tr);
    // The streak line through (x, y) has normal (nx, ny): n . p = n . (x, y).
    const c = nx * x + ny * y;
    a11 += w * nx * nx;
    a12 += w * nx * ny;
    a22 += w * ny * ny;
    b1 += w * nx * c;
    b2 += w * ny * c;
    lines.push({ x, y, nx, ny, w });
  }
}
const det = a11 * a22 - a12 * a12;
const cx = (a22 * b1 - a12 * b2) / det;
const cy = (a11 * b2 - a12 * b1) / det;
console.log(`convergence point ~ (${cx.toFixed(1)}, ${cy.toFixed(1)}) = (${(cx / W).toFixed(3)} W, ${(cy / H).toFixed(3)} H) from ${lines.length} patches`);
