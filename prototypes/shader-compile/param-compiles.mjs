// Counts shader links per look after its default scene has rendered once, over control, point, pack, seed, size and
// grain changes. Any link after the first render means that change compiles a shader.
import { startHarness } from '../../scripts/light/lib/harness.mjs'

const harness = await startHarness()
try {
  const { buildScene } = await harness.ssr('/src/tool/controls.ts')
  const { getPack, PACK_IDS } = await harness.ssr('/src/light/color/packs.ts')
  const { RECIPE_IDS } = await harness.ssr('/src/light/scene.ts')
  await harness.page.evaluate(() => {
    const proto = WebGL2RenderingContext.prototype
    const link = proto.linkProgram
    window.links = 0
    proto.linkProgram = function (program) {
      window.links++
      return link.call(this, program)
    }
  })
  const links = () => harness.page.evaluate(() => window.links)
  const sizes = [
    [960, 540, 1],
    [960, 540, 2],
    [540, 960, 2],
    [1920, 1080, 1],
    [1080, 1920, 1],
  ]
  for (const look of RECIPE_IDS) {
    const render = (scene, [width, height, supersample]) =>
      harness.call('render', { scene: { ...scene, recipe: look }, width, height, supersample })
    try {
      buildScene(look, getPack('bold'), 1, { intensity: 0.5, softness: 0.5, mood: 0.5 })
    } catch (error) {
      console.log(`${look.padEnd(16)} skipped: its scene does not build (${error.message})`)
      continue
    }
    await render(buildScene(look, getPack('bold'), 1, { intensity: 0.5, softness: 0.5, mood: 0.5 }), sizes[0])
    const start = await links()
    const changes = []
    let count = 0
    for (const pack of PACK_IDS) {
      for (const seed of [1, 7, 4242]) {
        for (const v of [0, 0.5, 1]) {
          for (const [key, extra] of [
            ['intensity', { intensity: v }],
            ['softness', { softness: v }],
            ['mood', { mood: v }],
            ['point', { point: [v * 1.5 - 0.25, 1 - v] }],
            ['drag', { drag: { from: [v * 1.5 - 0.25, 0.8], to: [1 - v, 0.1 + 0.3 * v] } }],
          ]) {
            const scene = buildScene(look, getPack(pack), seed, { intensity: 0.5, softness: 0.5, mood: 0.5, ...extra }, 16 / 9)
            const before = await links()
            await render(scene, sizes[count++ % sizes.length])
            const added = (await links()) - before
            if (added) changes.push(`${pack} seed ${seed} ${key}=${v}: +${added}`)
          }
        }
      }
    }
    for (const grain of [0, 0.5, 1]) {
      const scene = buildScene(look, getPack('bold'), 1, { intensity: 0.5, softness: 0.5, mood: 0.5 }, 16 / 9)
      const before = await links()
      for (const size of sizes) await render({ ...scene, output: { ...scene.output, grain } }, size)
      const added = (await links()) - before
      if (added) changes.push(`grain=${grain}: +${added}`)
    }
    console.log(`${look.padEnd(16)} ${count + 15} renders, new links ${(await links()) - start}${changes.length ? `: ${changes.join('; ')}` : ''}`)
  }
} finally {
  await harness.close()
}
