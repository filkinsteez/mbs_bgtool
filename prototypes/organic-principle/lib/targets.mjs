// The moodboard targets (measured only; nothing here feeds a renderer) and the
// analysis size: every image is resized so its short side is ANALYSIS_SHORT pixels.
import path from 'node:path'

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..')
export const HERE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
export const ANALYSIS_SHORT = 720

const frames = (f) => path.join(ROOT, 'artifacts/moodboard-frames', f)

export const TARGETS = {
  // Etsy copy: the right 100 px are shaded by the mockup's frame; the title starts at y 1790.
  'poster-etsy': { file: frames('poster-etsy-crop.png'), crop: { left: 20, top: 0, width: 1330, height: 1760 }, label: 'poster (Etsy copy)' },
  // Moodboard copy: halftone scan; the left 2 px are dark; the title starts at y 1127.
  'poster-board': { file: frames('poster-bands-33-113.png'), crop: { left: 4, top: 0, width: 952, height: 1100 }, label: 'poster (moodboard copy)' },
  ridge: { file: frames('ridge-glow-33-112.png'), label: 'ridge frame 33:112' },
}

/** Resize target so the short side is ANALYSIS_SHORT. */
export function analysisSize(w, h, short = ANALYSIS_SHORT) {
  const s = short / Math.min(w, h)
  return { width: Math.round(w * s), height: Math.round(h * s) }
}
