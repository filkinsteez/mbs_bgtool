// Module hooks so Node can import the app's .ts sources with type stripping: extensionless relative
// imports and the '@/' alias resolve to .ts files. Read-only use of src/; nothing here edits it.
//   import './lib/ts-register.mjs' before importing anything from src/.
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve as resolvePath } from 'node:path'

const root = resolvePath(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

export async function resolve(specifier, context, next) {
  let spec = specifier
  if (spec.startsWith('@/')) spec = pathToFileURL(join(root, 'src', spec.slice(2))).href
  const relative = spec.startsWith('./') || spec.startsWith('../')
  const isFile = spec.startsWith('file:')
  if ((relative || isFile) && context.parentURL && !/\.[cm]?[jt]s$|\.json$/.test(spec)) {
    const base = isFile ? fileURLToPath(spec) : fileURLToPath(new URL(spec, context.parentURL))
    for (const ext of ['.ts', '.tsx', '/index.ts']) {
      if (existsSync(base + ext)) return next(pathToFileURL(base + ext).href, context)
    }
  }
  return next(spec, context)
}
