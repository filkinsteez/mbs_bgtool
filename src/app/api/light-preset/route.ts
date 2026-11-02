import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { NextRequest } from 'next/server'
import { PRESET_DIR } from '@/light/references'
import { isProduction, knownReferenceIds, listReferences, notFound, otherMethods, presetFile, textResponse } from './store'
import { validatePreset } from './validate'

const NO_STORE = { 'cache-control': 'no-store' }

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** No query: the reference list. `?id=<referenceId>`: that reference's preset file. */
export async function GET(request: NextRequest): Promise<Response> {
  if (isProduction()) return notFound()
  const id = request.nextUrl.searchParams.get('id')
  if (id === null) return Response.json({ references: await listReferences() }, { headers: NO_STORE })

  const file = presetFile(id)
  if (!file) return textResponse(400, `Not a valid reference id: ${id}`)
  let content: string
  try {
    content = await readFile(file, 'utf8')
  } catch (error) {
    if (isMissingFile(error)) return textResponse(404, `No preset for ${id}.`)
    throw error
  }
  try {
    JSON.parse(content)
  } catch {
    return textResponse(500, `${PRESET_DIR}/${id}.json is not valid JSON.`)
  }
  return new Response(content, { headers: { 'content-type': 'application/json; charset=utf-8', ...NO_STORE } })
}

/** Writes a reference preset to src/light/presets/references/<referenceId>.json. */
export async function POST(request: NextRequest): Promise<Response> {
  if (isProduction()) return notFound()
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return textResponse(400, 'The request body is not valid JSON.')
  }
  const check = validatePreset(body, await knownReferenceIds())
  if (!check.ok) return textResponse(400, check.message)

  const { preset } = check
  const file = presetFile(preset.referenceId)
  if (!file) return textResponse(400, `Refusing to write outside ${PRESET_DIR}.`)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(preset, null, 2)}\n`)
  return Response.json({ saved: `${PRESET_DIR}/${preset.referenceId}.json` }, { headers: NO_STORE })
}

export const { PUT, PATCH, DELETE, OPTIONS } = otherMethods('GET, HEAD, POST, OPTIONS')
