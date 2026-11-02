import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { ROOT } from './harness.mjs'

/**
 * Reference list from public/references/awe/manifest.json when it exists,
 * else the screenshot fallback in artifacts/brief-screens/ (white rounded
 * corners masked by radius). Width and height always come from the file.
 */
export async function loadReferences(harness) {
  const refs = await harness.ssr('/src/light/references.ts')
  const manifestFile = path.join(ROOT, refs.MANIFEST_PATH)
  const references = []
  let source = 'fallback'
  if (existsSync(manifestFile)) {
    source = 'manifest'
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
    for (const entry of manifest.references ?? []) {
      const file = path.join(ROOT, refs.MANIFEST_DIR, entry.file)
      if (!existsSync(file)) continue
      const meta = await sharp(file).metadata()
      if (entry.width && entry.height && (entry.width !== meta.width || entry.height !== meta.height)) {
        console.warn(`${entry.id}: manifest says ${entry.width}x${entry.height}, file is ${meta.width}x${meta.height}; using the file size`)
      }
      references.push({
        id: entry.id,
        mood: entry.mood,
        recipe: entry.recipe,
        title: entry.title,
        file,
        width: meta.width,
        height: meta.height,
        ignore: entry.ignore ?? [],
        cornerRadius: entry.cornerRadius ?? 0,
      })
    }
  } else {
    for (const entry of refs.FALLBACK_REFERENCES) {
      const file = path.join(ROOT, refs.FALLBACK_DIR, entry.file)
      if (!existsSync(file)) continue
      const meta = await sharp(file).metadata()
      references.push({
        id: entry.id,
        mood: entry.mood,
        recipe: entry.recipe,
        title: entry.title,
        file,
        width: meta.width,
        height: meta.height,
        ignore: entry.ignore,
        cornerRadius: refs.fallbackCornerRadius(meta.width),
      })
    }
  }
  return { source, references, presetDir: path.join(ROOT, refs.PRESET_DIR) }
}

export function presetPathFor(presetDir, id) {
  return path.join(presetDir, `${id}.json`)
}

export async function readPreset(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}
