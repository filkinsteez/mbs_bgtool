// Prints the scatter plan runScatter makes for a look at a few Softness values: working sides and the lower side's
// share, then per blur its radius, width in source pixels, halving level and edge levels on each side.
// Usage: node scatter-plan.mjs --look contour.halo --pack bold --seed 4 --softness 0.01,0.02,0.03 [--size 320x180] [--ss 2]
import { createServer } from 'vite'
import path from 'node:path'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []),
)
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const server = await createServer({ root, configFile: false, logLevel: 'error', resolve: { alias: { '@': path.join(root, 'src') } }, server: { middlewareMode: true, hmr: false } })
try {
  const { buildScene } = await server.ssrLoadModule('/src/tool/controls.ts')
  const { getPack } = await server.ssrLoadModule('/src/light/color/packs.ts')
  const { getRecipe } = await server.ssrLoadModule('/src/light/recipes/index.ts')
  const { recipeContext, resolveScene } = await server.ssrLoadModule('/src/light/engine/resolve.ts')
  const { samplingLevels: samplingLevel, edgeLevels } = await server.ssrLoadModule('/src/light/engine/passes.ts')
  const { workingSides } = await server.ssrLoadModule('/src/light/engine/scatter.ts')
  const look = args.look ?? 'contour.halo'
  const [width, height] = (args.size ?? '320x180').split('x').map(Number)
  const ss = Number(args.ss ?? 2)
  const [rw, rh] = [width * ss, height * ss]
  const recipe = getRecipe(look)
  for (const softness of (args.softness ?? '0.01,0.02,0.03').split(',').map(Number)) {
    const scene = { ...buildScene(look, getPack(args.pack ?? 'bold'), Number(args.seed ?? 4), { intensity: 0.5, softness, mood: 0.5 }, width / height), recipe: look }
    const ctx = recipeContext(resolveScene(recipe, scene), width / height)
    const radii = (recipe.scatter ?? []).map((blur) => blur.radius(ctx))
    const short = Math.min(rw, rh)
    const w = workingSides(4 / Math.min(...radii.filter((r) => r > 0)), short)
    const sides = w.lower === null ? [w.side] : [w.side, w.lower]
    const parts = sides.map((side) => {
      const sw = Math.round((rw * side) / short)
      const sh = Math.round((rh * side) / short)
      return `side ${side}: ` + radii.map((r) => {
        const s = r * side
        const at = samplingLevel(s, sw, sh)
        const e = edgeLevels(s, sw, sh)
        return `σ ${s.toFixed(2)} L${at.level}${at.previous ? `(L${at.previous.level} ${at.previous.share.toFixed(3)})` : ''} e${e.previous}->${e.level} t ${e.t.toFixed(3)}`
      }).join(' | ')
    })
    console.log(`Softness ${softness}: lower share ${w.lowerShare.toFixed(3)}; radii ${radii.map((r) => r.toFixed(5)).join(' ')}\n  ${parts.join('\n  ')}`)
  }
} finally {
  await server.close()
}
