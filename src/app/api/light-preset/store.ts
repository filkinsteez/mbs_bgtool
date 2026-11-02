import { access, open, readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  FALLBACK_DIR,
  FALLBACK_REFERENCES,
  MANIFEST_DIR,
  MANIFEST_PATH,
  PRESET_DIR,
  REFERENCE_IDS,
  fallbackCornerRadius,
  isSafeReferenceId,
  type IgnoreKind,
  type IgnoreRect,
} from '@/light/references'
import { isRecipeId, type RecipeId } from '@/light/scene'

/** One entry of GET /api/light-preset. */
export interface LabReference {
  id: string
  mood: string
  title: string
  recipe: RecipeId | null
  width: number
  height: number
  ignore: IgnoreRect[]
  cornerRadius: number
  hasPreset: boolean
}

interface ReferenceEntry {
  reference: LabReference
  /** Absolute path of the target PNG. */
  file: string
}

const IGNORE_KINDS: readonly IgnoreKind[] = ['fold', 'text', 'corners', 'other']
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}

export function textResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })
}

export function notFound(): Response {
  return textResponse(404, 'Not found.')
}

/** Handlers for the methods a route does not use: 404 in production, like every other method. */
export function otherMethods(allow: string) {
  const notAllowed = () => (isProduction() ? notFound() : new Response(null, { status: 405, headers: { Allow: allow } }))
  const options = () => (isProduction() ? notFound() : new Response(null, { status: 204, headers: { Allow: allow } }))
  return { POST: notAllowed, PUT: notAllowed, PATCH: notAllowed, DELETE: notAllowed, OPTIONS: options }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Resolves `relative` under the repo directory `dir`; null when the result would leave it. */
function resolveInside(dir: string, relative: string): string | null {
  const base = path.resolve(process.cwd(), dir)
  const file = path.resolve(base, relative)
  const rel = path.relative(base, file)
  if (rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null
  return file
}

export function presetFile(referenceId: string): string | null {
  if (!isSafeReferenceId(referenceId)) return null
  const file = resolveInside(PRESET_DIR, `${referenceId}.json`)
  return file && path.dirname(file) === path.resolve(process.cwd(), PRESET_DIR) ? file : null
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

async function presetExists(id: string): Promise<boolean> {
  const file = presetFile(id)
  return file !== null && (await exists(file))
}

/** Width and height from the PNG's IHDR chunk; null when the file is missing or not a PNG. */
async function readPngSize(file: string): Promise<{ width: number; height: number } | null> {
  const handle = await open(file, 'r').catch(() => null)
  if (!handle) return null
  try {
    const header = Buffer.alloc(24)
    const { bytesRead } = await handle.read(header, 0, 24, 0)
    if (bytesRead < 24) return null
    if (!PNG_SIGNATURE.every((byte, i) => header[i] === byte)) return null
    if (header.toString('latin1', 12, 16) !== 'IHDR') return null
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) }
  } finally {
    await handle.close()
  }
}

async function readManifestEntries(): Promise<unknown[] | null> {
  try {
    const data: unknown = JSON.parse(await readFile(path.join(process.cwd(), MANIFEST_PATH), 'utf8'))
    return isRecord(data) && Array.isArray(data.references) ? data.references : null
  } catch {
    return null
  }
}

function readIgnore(value: unknown): IgnoreRect[] {
  if (!Array.isArray(value)) return []
  const rects: IgnoreRect[] = []
  for (const item of value) {
    if (!isRecord(item) || !Array.isArray(item.rect) || item.rect.length !== 4) continue
    const [x, y, w, h] = item.rect
    if (![x, y, w, h].every((n) => typeof n === 'number' && Number.isFinite(n))) continue
    const kind = IGNORE_KINDS.find((k) => k === item.kind) ?? 'other'
    rects.push({ kind, rect: [x, y, w, h] })
  }
  return rects
}

async function manifestReferences(entries: unknown[]): Promise<ReferenceEntry[]> {
  const seen = new Set<string>()
  const found: ReferenceEntry[] = []
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.file !== 'string') continue
    const id = entry.id
    if (!isSafeReferenceId(id) || seen.has(id)) continue
    const file = resolveInside(MANIFEST_DIR, entry.file)
    const size = file ? await readPngSize(file) : null
    if (!file || !size) continue
    seen.add(id)
    const fallback = FALLBACK_REFERENCES.find((ref) => ref.id === id)
    const recipe = typeof entry.recipe === 'string' && isRecipeId(entry.recipe) ? entry.recipe : (fallback?.recipe ?? null)
    const reference: LabReference = {
      id,
      mood: typeof entry.mood === 'string' ? entry.mood : '',
      title: typeof entry.title === 'string' ? entry.title : '',
      recipe,
      ...size,
      ignore: readIgnore(entry.ignore),
      cornerRadius: typeof entry.cornerRadius === 'number' && Number.isFinite(entry.cornerRadius) ? entry.cornerRadius : 0,
      hasPreset: await presetExists(id),
    }
    found.push({ reference, file })
  }
  return found
}

async function fallbackReferences(): Promise<ReferenceEntry[]> {
  const found: ReferenceEntry[] = []
  for (const ref of FALLBACK_REFERENCES) {
    const file = resolveInside(FALLBACK_DIR, ref.file)
    const size = file ? await readPngSize(file) : null
    if (!file || !size) continue
    const reference: LabReference = {
      id: ref.id,
      mood: ref.mood,
      title: ref.title,
      recipe: ref.recipe,
      ...size,
      ignore: ref.ignore,
      cornerRadius: fallbackCornerRadius(size.width),
      hasPreset: await presetExists(ref.id),
    }
    found.push({ reference, file })
  }
  return found
}

/** Manifest entries whose file exists; the fallback screenshots when there are none. */
async function referenceEntries(): Promise<ReferenceEntry[]> {
  const entries = await readManifestEntries()
  const fromManifest = entries ? await manifestReferences(entries) : []
  return fromManifest.length > 0 ? fromManifest : fallbackReferences()
}

export async function listReferences(): Promise<LabReference[]> {
  return (await referenceEntries()).map((entry) => entry.reference)
}

export async function findTargetFile(id: string): Promise<string | null> {
  if (!isSafeReferenceId(id)) return null
  return (await referenceEntries()).find((entry) => entry.reference.id === id)?.file ?? null
}

/** Ids a preset may be saved for: every manifest id plus the fixed Sunset and Contour ids. */
export async function knownReferenceIds(): Promise<Set<string>> {
  const ids = new Set(REFERENCE_IDS)
  for (const entry of (await readManifestEntries()) ?? []) {
    if (isRecord(entry) && typeof entry.id === 'string') ids.add(entry.id)
  }
  return ids
}
