import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-static'

const MODEL_PATH = join(
  process.cwd(),
  'Assets',
  '2209_3D Symbol_physical',
  'Meta Symbol - Physical Spline surface.obj',
)

export async function GET() {
  const model = await readFile(MODEL_PATH)

  return new Response(new Uint8Array(model), {
    headers: {
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Length': String(model.byteLength),
      'Content-Type': 'model/obj',
    },
  })
}
