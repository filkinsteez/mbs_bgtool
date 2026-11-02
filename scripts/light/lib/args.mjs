/** Parses `--flag value`, `--flag=value` and bare `--flag` (true). Repeated flags collect into arrays. */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`)
    let key = arg.slice(2)
    let value = true
    const eq = key.indexOf('=')
    if (eq >= 0) {
      value = key.slice(eq + 1)
      key = key.slice(0, eq)
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      value = argv[++i]
    }
    if (key in out) out[key] = [].concat(out[key], value)
    else out[key] = value
  }
  return out
}

export function list(value) {
  if (value === undefined || value === true) return []
  return []
    .concat(value)
    .flatMap((v) => String(v).split(','))
    .map((v) => v.trim())
    .filter(Boolean)
}

export function parseSize(value) {
  const match = /^(\d+)x(\d+)$/.exec(String(value))
  if (!match) throw new Error(`Size must look like 1920x1080, got ${value}`)
  return { width: Number(match[1]), height: Number(match[2]) }
}
