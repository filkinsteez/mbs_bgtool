// High-pass of Oklab L (blurred by 2 px minus blurred by 30 px), x20, to show
// creases where a light field changes slope abruptly.
// node tools/crease.mjs <frame.png> <out.png>
import { loadCanvas, saveCanvas, makeCanvas, row } from '../lib/image.mjs'
import { canvasToLinear } from '../lib/output.mjs'
import { blurPlane } from '../lib/blur.mjs'
import { linearToOklab } from '../lib/color.mjs'
const c = await loadCanvas(process.argv[2])
const lin = canvasToLinear(c)
const L = new Float32Array(c.w * c.h)
for (let i = 0; i < c.w * c.h; i++) L[i] = linearToOklab(lin.ch[0][i], lin.ch[1][i], lin.ch[2][i])[0]
const a = blurPlane(L, c.w, c.h, 2)
const b = blurPlane(L, c.w, c.h, 30)
const out = makeCanvas(c.w, c.h)
for (let i = 0; i < c.w * c.h; i++) {
  const v = Math.max(0, Math.min(255, 128 + (a[i] - b[i]) * 20 * 255))
  out.data[i * 3] = out.data[i * 3 + 1] = out.data[i * 3 + 2] = v
}
await saveCanvas(await row([c, out], { gap: 6 }), process.argv[3])
