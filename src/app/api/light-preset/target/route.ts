import { readFile } from 'node:fs/promises'
import type { NextRequest } from 'next/server'
import { findTargetFile, isProduction, notFound, otherMethods, textResponse } from '../store'

/** `?id=<referenceId>`: the target PNG (manifest file, or the fallback screenshot). */
export async function GET(request: NextRequest): Promise<Response> {
  if (isProduction()) return notFound()
  const id = request.nextUrl.searchParams.get('id') ?? ''
  const file = await findTargetFile(id)
  if (!file) return textResponse(404, `No target image for ${id}.`)
  const bytes = await readFile(file)
  return new Response(new Uint8Array(bytes), { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } })
}

export const { POST, PUT, PATCH, DELETE, OPTIONS } = otherMethods('GET, HEAD, OPTIONS')
