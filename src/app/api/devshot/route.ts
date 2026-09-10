import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

// Dev-only: accepts a canvas dataURL and writes it to .devshots/ so the
// render can be inspected outside the browser (the preview pane throttles
// hidden tabs, which blocks normal screenshots mid-iteration).
export async function POST(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === 'production') {
    return new Response('not available', { status: 404 })
  }
  const body = (await request.json()) as { dataUrl?: string; name?: string; recipe?: unknown }
  const dataUrl = body.dataUrl ?? ''
  const match = /^data:image\/(png|jpeg);base64,(.+)$/.exec(dataUrl)
  if (!match) return new Response('bad dataUrl', { status: 400 })
  const ext = match[1] === 'png' ? 'png' : 'jpg'
  const name = (body.name ?? 'shot').replace(/[^a-z0-9-]/gi, '')
  const dir = path.join(process.cwd(), '.devshots')
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, `${name}.${ext}`)
  await writeFile(file, Buffer.from(match[2], 'base64'))
  if (body.recipe && typeof body.recipe === 'object') {
    const recipeJson = JSON.stringify(body.recipe, null, 2)
    if (recipeJson.length < 1_000_000) await writeFile(path.join(dir, `${name}.json`), recipeJson)
  }
  return Response.json({ saved: file })
}
