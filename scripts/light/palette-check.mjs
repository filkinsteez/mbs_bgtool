// Palette check: does every frame read as its pack? For one look (or all seven) it renders or reads the three packs
// at seeds 1-40 in both formats (41-80 with --holdout), at the default light and at four test drags, measures how
// much of each frame every pack color covers and which colors outside the pack show up, and writes sheets per look
// with a share bar under each tile and the failing frames marked. Two packs at one seed are meant to share their
// design (owner, 2026-11-09), so packs aren't compared here; same-design.mjs checks that they do. See
// scripts/light/README.md, "Palette check", for usage and the rules behind the thresholds. With --refs it
// reads the reference library's Sunset and Contour images instead and judges each by its own look's rules in every
// pack, as if it were one of our frames (the references are measured only; nothing renders from them).
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'
import sharp from 'sharp'
import { list, parseArgs } from './lib/args.mjs'
import { BLEND, BLUE_LIGHT, blendSharesOf, blueLight, blueVerdict, mixByName, rulesFor, sharesOf } from './lib/color-read.mjs'
import { ROOT, startHarness } from './lib/harness.mjs'
import { raw } from './lib/images.mjs'
import { loadReferences } from './lib/references.mjs'

const LOOKS = ['sunset.ramp', 'sunset.bands', 'sunset.blooms', 'contour.rim', 'contour.halo', 'contour.beam', 'contour.streaks']
// The looks behind a switch in the tool (sunrise=merged, contour=merged, rush=split) are checked when named; `all` is
// the seven. Rush is light on a dark base, so its frames are read and judged as Contour's are.
const MERGED = ['sunset.merged', 'contour.merged', 'rush.split']
const PACK_ORDER = ['bold', 'elemental', 'atmospheric']

// Thresholds, set by eye on the coordinator's shots (artifacts/coordinator/bands-bug, palette-now, palette-now-contour).
const T = {
  dark: 0.1, // Oklab L below this is the dark base: no color is judged there
  white: 0.97, // L at or above this is white, the pale end of every light
  hueTolerance: 20, // degrees of Oklab hue a pixel may differ from a pack color's light path and still be that color
  greyer: 0.65, // below nominal a pixel may lose this much of the path's chroma (blur, a little mixing) and stay the color
  // A pack color that isn't warm or near-grey (Meta Blue, Cyan, Plum), dimmed along its own falloff (SHARED.md,
  // decided 2026-11-04 1:40 PM), keeps its hue while its lightness and chroma fall together, down to the dark base,
  // and stays that color: Meta Blue may sink to a deep navy. Deeper down it may grey further: the share of the
  // path's chroma it must keep falls from `greyer` at
  // nominal to `dim.greyer` at L `dim.floorL` and below. A hue that moves away stays off-pack: Meta Blue's falloff
  // may turn at most `dim.hue` degrees (- toward cyan, + toward violet). Set by eye in round 11 of the compare agent
  // (artifacts/compare/rounds/11/rule/swatches/): navy reads as navy down to 0.4 of the path's chroma at L 0.2 and
  // until +12 degrees; from +15 it reads indigo (the violet-wave reference's #181751 is +18). Warm colors keep their
  // tail rules below.
  dim: { greyer: 0.4, floorL: 0.2, hue: { 'Meta Blue': [-20, 12] } },
  // A cool light's haze (Meta Blue, Cyan; SHARED.md, decided 2026-11-04 4:15 PM) may desaturate toward neutral at the
  // light's own hue down to the moodboard's haze chroma (beam pool: median 0.045, 10% under 0.030), and below
  // nominal it still counts as the light while its hue stays in the window above. Set by eye in round 12 of the
  // compare agent (artifacts/compare/rounds/12/haze/): at 0.035 a blue haze still reads blue-grey, at 0.03 grey.
  // Warm lights keep their tail rule: their greyed haze reads olive or brown.
  haze: 0.035,
  // That haze's hue window (degrees from the color's own hue, - toward cyan), wider toward cyan than the dim window
  // above, in packs without Cyan: the beam-pool example's haze sits 15 to 28 degrees from Meta Blue toward cyan
  // (median 22, halfway to Cyan). Set by eye (artifacts/compare/refcheck/hue-swatches/): at 30 a haze still reads
  // blue-grey next to the beam pool, at 35 teal. Toward violet the indigo limit stays.
  hazeHue: { 'Meta Blue': [-30, 12] },
  // Sunset skies (SHARED.md, decided 2026-11-04 4:15 PM): full-strength Meta Blue, Oklab chroma `sky.C` or more in
  // Meta Blue's hue window, covers at most about `sky.share` of a Sunset frame. Frames over it are listed, not failed.
  // With the color stage on (--mix) it is off: the Meta Blue light rule under `mix` tests the owner's complaint of
  // 2026-11-09 10:05 PM (a flat blue field) directly (coordinator, 12:44 AM on 2026-11-10).
  sky: { C: 0.15, share: 0.25 },
  pale: { L: 0.78, C: 0.05 }, // a pixel this light and this grey is a pale bridge, never mud
  warmDimStops: { yellowish: 1, red: 1.5 }, // how far under nominal a warm color still reads as itself, not olive or brown
  darkOverStops: 1, // how far over nominal a dark pack color (L under 0.5) still reads as itself
  present: 0.05, // a pack color is present, as an area of light, when it covers at least this share of the frame
  wideRadius: 0.03, // outside areas thinner than twice this share of the short side are bridges or tails, not areas
  largestPatch: 0.08, // fail: one wide outside area covers this share of the frame
  wideShare: 0.15, // fail: wide outside areas together cover this share of the frame
  darkLine: 0.015, // note: thin dark outside lines (a seam) cover this share of the frame
  baseOutside: 0.3, // Contour: fail when this share of the dark base (L 0.1 to 0.35) is outside the pack
  litOutside: 0.2, // Contour: fail when this share of the lit area (L 0.35 and up) is outside the pack
  drift: 0.25, // Contour, own renders: fail when this share of the lit area is a pack color the scene does not light with
  lightL: 0.5, // Contour: pack colors at least this light (Oklab L) are the light colors a pack offers
  lensEdge: 0.165, // new rule: a lens-blurred edge between two pack colors may be this share of the short side wide
  // (the full blur of the disc lens, 2 x R with R = 0.0825 at Softness 0.5; R runs 0.045 to 0.12 with Softness)
  mixTolerance: 0.03, // new rule: Oklab distance from the linear-light mix of two pack colors that still counts as it
  // Warm tails (SHARED.md, decided 2026-11-03 9:40 AM): below nominal, a warm light that drifts toward deep red or
  // amber (Lime: toward Forest's deep green) as it dims, and stays at least this pure (chroma / lightness), is still
  // that light. Olive, brown and grey tails are not. `--tails strict` turns this off. Yellow drifts like fire
  // (10:40 AM): through amber to Orange-red's hue (37) at half its peak and deep red (29) below a quarter.
  tails: {
    'Orange-red': { hue: [15, 45], ratio: 0.3 },
    Yellow: { hue: [15, 80], ratio: 0.18 },
    Tan: { hue: [40, 65], ratio: 0.12 },
    Lime: { hue: [135, 180], ratio: 0.15 },
  },
  // The pack color a light's tail reaches as it dims (10:40 AM): in a frame lit by the key, light of this color is
  // the key's tail, not a second light. A frame whose main light reads as the partner is the key's when the key covers
  // at least `tailOwner` of the lit area (an Orange-red light shows no Yellow at all).
  tailPartners: { Yellow: ['Orange-red'], Lime: ['Forest'] },
  tailOwner: 0.25,
  // Seed variety (SHARED.md, decided 2026-11-03 10:15 AM, and under any line, 11:31 AM on 2026-11-05): two of seeds
  // 1-8 (16:9) look like the same frame when the light sits in the same places (layout) and they show about the same
  // colors in the same amounts (colors). Both come from Oklab at 40x23, blurred by 1 px. Layout: the summed difference
  // in L over the summed L of both, each with its darkest level taken off up to `variety.baseL`, so shared black does
  // not count. Colors: half the summed difference of the colored light in each hue family, as a share of each
  // frame's lit pixels (L `variety.litL` and up); see colorFamilies. Set by eye in compare round 14
  // (artifacts/compare/rounds/14/check/SEEDS.md): under the owner's line, Bands Bold seeds 1, 5, 7 and 8 (layout up
  // to 0.16, colors up to 0.08), Ramp Atmospheric seeds 1-6 at controls 0.37 (0.09, 0.12) and 12 of 15 pairs of Ramp
  // Bold seeds 1-6 look alike; Bands Bold's orange and yellow seeds 2 and 4 against the rest (colors 0.26 and up)
  // don't; at the default light Contour seeds stay apart as before. Since compare round 16
  // (artifacts/compare/rounds/16/seeds/SEEDS.md) Cyan and Meta Blue are two families: a blue's mass moves from cyan to
  // blue across `variety.cyanToBlue` (Oklab hue), so a deep Meta Blue sky no longer matches a Cyan one.
  variety: { layout: 0.2, colors: 0.15, baseL: 0.35, litL: 0.1, chroma: [0.035, 0.07], cyanToBlue: [215, 255] },
  // No drag leaves a frame nearly black (SHARED.md, decided 2026-11-05 11:22 AM). A frame is nearly black when it is
  // black (mean L under `black.meanL`) with its brightest 0.1% under L `black.peakL`, or, in Contour, dark (mean L
  // under `black.darkMeanL`) with nothing reaching L `black.darkPeakL`: the light has left and only the base shows.
  // Set by eye in compare round 14 (artifacts/compare/rounds/14/check/): Rim's thin rims and dim blue logo lines
  // (brightest at L 0.44 and up over a mean L of 0.09 or more; the rim-edge and light-line examples at L 0.86) pass,
  // and so do Sunset's deep all-ground fields (mean L 0.24 to 0.32); a black frame with one faint line (Rim seed 2
  // high above: L 0.40 over a mean of 0.02) and Beam's empty slate, navy and Forest fields (brightest under L 0.3)
  // fail.
  black: { peakL: 0.5, meanL: 0.06, darkPeakL: 0.35, darkMeanL: 0.25 },
  // Bright light goes smoothly to white, so a flat white area is clipping (SHARED.md, decided 2026-11-07 1:55 AM): a
  // frame fails when this share of it is at 253 or more in every channel. Set by eye in compare round 18
  // (artifacts/compare/rounds/18/clip/): under 2.5% the white reads as a light's bright core (a sun on the horizon, a
  // bloom's center, a thin white rim), from 3.5% as a flat blown-out area in every look (Streaks' cream floors, Blooms'
  // and Ramp's white fields, Halo's white tubes), and 3% splits the turn. How thick the clipped area is tells a round
  // core from a line, not a core from a flat area, and its largest piece is nearly all of it. No moodboard reference
  // has a clipped pixel.
  flatWhite: 0.03,
  // A Contour frame shows no pack color when its pack colors, at any lightness (Atmospheric's white is Ice), cover
  // under `noPack` of it.
  noPack: 0.01,
  // Under a drag, a Sunset frame needs at least two pack colors, each over `drag.visible` of the frame, one of them a
  // color only its pack has; it needs no warm color and no Meta Blue (SHARED.md, decided 2026-11-05 12:45 and
  // 12:50 PM). Two of Atmospheric's greys are two colors when their L spreads `drag.greySpan` or more (10th to 90th
  // percentile; Near-black to Slate is 0.11). Set by eye in compare round 14 (artifacts/compare/rounds/14/check/
  // visible-share.jpg): a second color over 1.3 to 2.6% of the frame (a Yellow corner, an Ice band, a gold bloom)
  // shows at thumbnail size; Atmospheric's flat Slate fields under the line high above (a lighter top read as 4 to
  // 5% Steel) are one color.
  drag: { visible: 0.02, greySpan: 0.1 },
  // Sunset at the default light, the 1:10 PM rules (SHARED.md, 2026-11-06), set by eye on
  // artifacts/compare/rounds/16/rule/swatches/ and pale-bold-fine.jpg. A sky's pale side reads as Cyan up to this
  // Oklab hue (light blue past it, Meta Blue's pale side), among the blue hues: 232 at L 0.8 down to 227 from L 0.9,
  // as a paler blue shows less of its hue. In Atmospheric it reads as a grey up to this chroma (light blue past it).
  paleSide: { cyanHue: { at: [0.8, 0.9], hue: [232, 227] }, blueHues: [175, 275], greyC: 0.045 },
  // A light pack color under the present share counts as a thin line when the part of it at its own brightness or
  // paler (at most ownL darker than its hex) is one connected piece spanning this share of the frame, this thick
  // (share of the short side), `elongation` times longer than thick (a bloom's ring or a blob is no line), and this
  // far from what lies 3 to 6 px beside it (mean Oklab distance). One line per
  // frame counts, so a frame still needs two areas (pink-riso: two wide areas and one line). Through the lens a
  // line's core peaks 0.06 to 0.08 under its hex when it reads as its color (Yellow, Lime at a 12 px core of 180,
  // Cyan at 8 px); thinner it reads lavender, and an Orange-red or Tan line on Meta Blue reads pink or mauve.
  line: { ownL: 0.09, length: 0.3, thickness: 0.015, elongation: 8, contrast: 0.06 },
  // Sunset at the default light, the 11:45 PM rule (SHARED.md, 2026-11-06): a dark pack color under the present share
  // counts as a shape (a bank, hill or ground) when its largest piece at its own lightness (within `ownL` of its hex)
  // covers `share` of the frame, is `thickness` thick (share of the short side) and `contrast` from what lies 3 to 6 px
  // beside it, and is no corner: a piece within `edge` (of the short side) of two adjacent edges and spanning under
  // `cornerSpan` of both is a corner. Set by eye on artifacts/compare/rounds/16/dark/: a hill 40% wide and 10% tall or
  // a far bank counts (contrast 0.33 to 0.35, Ramp's Elemental banks 0.11 to 0.16); a soft corner shadow (0.04 to
  // 0.08), a thin dark line along the bottom edge (1 to 2% thick), a 15% corner wedge and a Plum dot of 0.5% don't.
  darkShape: { ownL: 0.08, share: 0.01, thickness: 0.03, contrast: 0.1, cornerSpan: 0.3, edge: 0.03 },
  // --main bright (the 11:30 AM rule of 2026-11-05, withdrawn at 12:50 PM): the main light is the color of the frame's
  // brightest `bright.share`, short of the near-white core (L `bright.whiteL` and up at chroma under `bright.whiteC`),
  // where a pixel is a colored light's when it keeps `bright.onPath` of that color's path chroma. An Ice light whose
  // core a blue haze tints (Beam and Streaks Atmospheric seeds 2, 4 and 8 at 569d806, chroma 0.03 to 0.05 there) is
  // as blue as the moodboard's own Meta Blue lights (rim-edge 0.06, radial streaks 0.03, beam pool 0.04), so a share
  // that calls those Ice calls the rim-edge and radial-streaks examples Ice in Atmospheric too, and the check would
  // fail the references it was built from (artifacts/compare/rounds/14/check/MAIN-LIGHT.md).
  bright: { share: 0.005, onPath: 0.7, whiteL: 0.9, whiteC: 0.03 },
  // With the color stage on (--mix), the owner's rule of 2026-11-09 10:01 PM (every picture shows all of its pack's
  // colors) as the coordinator set it at 11:24 PM: every color the mix asks at `mix.asked` or more reads at
  // `mix.reads` or more of the frame's visibly lit pixels, by color-shares' reading (lib/color-read.mjs). It replaces
  // the rules on which pack colors show, and Contour's main light per seed is not checked (Meta Blue leads). Also the
  // owner's rule of 10:05 PM: where Meta Blue reads on BLUE_LIGHT.applies or more of the lit pixels it must carry
  // light (blueLight and blueVerdict in lib/color-read.mjs, as color-shares.mjs reports it). And the owner's rule of
  // 10:03 PM (by default Meta Blue is at least half of the picture): where the mix asks Meta Blue at 50% or more, it
  // reads at `mix.blue` or more, the limit color-shares.mjs flags. The shares are the blend-aware reading
  // (blendSharesOf: a pixel in a soft blend between two pack colors counts toward both, when each also reads as
  // itself on an area of its own; compare rounds 28 and 29), or with `--reading first` each pixel's one label, as
  // before.
  mix: { asked: 0.1, reads: 0.05, blue: 0.45 },
  // Each pack color's own dim path inside its pack (coordinator, 2026-11-10 1:28 AM), as the engine's fire drift and
  // Rush's dim-path look draw them: Orange-red into deep red and maroon, Yellow into Orange-red, Lime into Forest, Cyan
  // into Meta Blue and navy, Ice through Steel and Slate to Near-black, Forest and Plum toward black. A path runs from
  // anchor to anchor in Oklab lightness, chroma and hue, then to black; anchors are pack colors or [L, C, h], which
  // count as the pack color before them. Below the first anchor's lightness, a pixel no other rule takes counts as the
  // path's nearer named color when it lies within `dimPathWidth` of the path at its lightness (in a and b: 0.01 plus
  // 0.15 times the path's chroma there). Off every path, and still outside: olive (Lime dimmed on its own), teal (Cyan
  // dimmed on its own), brown (Tan dimmed), mauve, pink and magenta where Meta Blue and Orange-red meet, and grey mud.
  // Lime's path turns green by L 0.6 (hue 150), so Lime dimmed on its own (olive, hue about 120) stays off it; set by
  // eye on Rush's dim-path close-ups (artifacts/rush/dim-0121), where the wider first try passed Elemental s8's olive
  // band. `--dim strict` turns it off, as it turns off the navy rule.
  dimPaths: {
    bold: [['Yellow', 'Orange-red', [0.45, 0.17, 29], [0.28, 0.09, 18]], ['Cyan', 'Meta Blue']],
    elemental: [['Lime', [0.6, 0.11, 150], 'Forest'], ['Plum']],
    atmospheric: [['Ice', 'Steel', 'Slate', 'Near-black']],
  },
  dimPathWidth: [0.01, 0.15],
  // Where two dim paths fade into each other in the dark: below `below` (the dark base's range), a pixel on the line
  // between the two paths at its lightness (within dimPathWidth) counts as the nearer color. Orange-red's maroon tail
  // over Meta Blue's navy (Rush Bold s4's arc); the lighter mauve, pink and magenta where they meet stay outside.
  dimMeets: { bold: [{ colors: ['Orange-red', 'Meta Blue'], below: 0.35 }] },
}
// Why Meta Blue carries no light, for each of blueVerdict's reasons.
const BLUE_TEXT = {
  flat: (b) => `flat: its lightness spreads ${b.spread.toFixed(2)}, under ${BLUE_LIGHT.spread}`,
  dim: (b) => `dim: its brightest tenth is ${(-b.peak).toFixed(2)} darker than its hex`,
  borrowed: (b) => `borrowed: ${Math.round(100 * b.borrowed)}% of its brightest tenth sits beside another color's lighter light`,
}
// Hues that are neither neighbour, so a lens edge never excuses them (SHARED.md palette rules).
const THIRD_HUES = new Set(['pink', 'salmon', 'mauve', 'lavender', 'purple', 'magenta', 'mauve-grey', 'indigo'])

// Linear-light mixes that stay clean, measured in docs/light/research/perception-additive-light.md section 5.
// Every other pair goes grey, invents a hue (magenta, mint) or turns olive, khaki or brown, so its mix counts as
// outside the pack unless it is thin.
const CLEAN_MIXES = {
  bold: [['Meta Blue', 'Cyan'], ['Yellow', 'Orange-red']],
  elemental: [['Meta Blue', 'Forest'], ['Meta Blue', 'Plum']],
  atmospheric: 'all',
}
const WARM = { bold: ['Yellow', 'Orange-red'], elemental: ['Lime', 'Tan'], atmospheric: [] }
// The dark pack colors that can count as a shape (T.darkShape): Elemental's Forest and Plum banks and grounds, and
// Atmospheric's Slate. Near-black is left out: a near-black corner is a shadow.
const DARK_SHAPES = { bold: [], elemental: ['Forest', 'Plum'], atmospheric: ['Slate'] }
const NEUTRALS = { atmospheric: ['Ice', 'Steel', 'Slate', 'Near-black'] }

// The light each Contour reference shows (SHARED.md, "Reference images"), for its main-light check: any of these
// that the pack offers. The beam pool's teal sits halfway between Meta Blue and Cyan (22 degrees from each), so in
// Bold either is its light. The iridescent rings have three lights of no pack, so they have none.
const REF_LIGHT = {
  'contour-rim-edge': ['Meta Blue'],
  'contour-yellow-halo': ['Yellow'],
  'contour-radial-streaks': ['Meta Blue'],
  'contour-beam-pool': ['Meta Blue', 'Cyan'],
  'contour-light-line': ['Yellow'],
}
// What a reference does that our frames don't copy, listed with its results and never a fail. The floor horizons:
// SHARED.md, decided 2026-11-05 11:30 AM (our floors stay smooth; the step check, artifacts/compare/steps.mjs,
// measures these steps on the references and marks them the same way).
const REF_KNOWN = {
  'contour-beam-pool': 'a crisp floor horizon, 0.22 Oklab L brighter below, mostly within 4 px; our floors stay smooth',
  'contour-radial-streaks': 'a crisp floor horizon, 0.28 Oklab L brighter below; our floors stay smooth',
}

// The test drags (SHARED.md, "Every crop shows its pack", owner 2026-11-05 10:48 AM), in frame units as in the URL:
// the owner's line (the light just past the bottom-right corner, the top of the sky past the top-left, so a Sunset
// frame is all sky), its mirror, a line high above the image pointing up (all ground) and a sideways line (the light
// at the right edge, the sky to its left).
const DRAGS = {
  owner: { from: [1.011, 1.224], to: [-0.078, -0.067], name: "the owner's line" },
  mirror: { from: [-0.011, 1.224], to: [1.078, -0.067], name: 'its mirror' },
  above: { from: [0.5, -0.3], to: [0.5, -0.5], name: 'high above, pointing up' },
  side: { from: [0.9, 0.5], to: [0.1, 0.5], name: 'sideways' },
}
const dragText = (d) => `${DRAGS[d].name}, from=${DRAGS[d].from.join(',')}&to=${DRAGS[d].to.join(',')}`
// The hue families the seed check compares (Oklab hue, each up to its degree): red to orange, yellow and tan, green,
// blue (Cyan to Meta Blue, shared out between cyan and blue by T.variety.cyanToBlue) and purple.
const HUE_FAMILIES = [
  [55, 'red'],
  [105, 'yellow'],
  [190, 'green'],
  [290, 'blue'],
  [345, 'purple'],
  [360, 'red'],
]

const args = parseArgs()
const lookArg = list(args.look)
// --refs <id,...|sunset|contour|all>: reference IDs from public/references/awe/manifest.json, or a whole mood.
const refArg = list(args.refs)
// --chroma 0.8,0.6: also judge each frame or reference with its Oklab chroma scaled by these factors (a, b times the
// factor), to find how grey its light may get before a rule reads it as another color.
const chromaFactors = [1, ...list(args.chroma).map(Number).filter((f) => f !== 1)]
if (!lookArg.length && !refArg.length) {
  console.error('Give --look <sunset.bands|bands|...|all> and optionally --dev or --from <dir>, or --refs <id,...|all>; see scripts/light/README.md')
  process.exit(1)
}
const looks = lookArg.includes('all') ? LOOKS : lookArg.map((l) => (l.includes('.') ? l : LOOKS.find((id) => id.endsWith(`.${l}`)) ?? l))
for (const look of looks) if (!LOOKS.includes(look) && !MERGED.includes(look)) throw new Error(`Unknown look ${look}`)
// Seeds 1-40 in both formats by default, as agents check before each commit (SHARED.md, 11:40 PM 2026-11-06);
// --holdout checks seeds 41-80, which nobody tunes against. --seeds and --portrait set how many.
const firstSeed = args.holdout ? 41 : 1
const seeds = Number(args.seeds ?? 40)
const portraitSeeds = Number(args.portrait ?? 40)
const seedRange = (count) => Array.from({ length: count }, (_, i) => firstSeed + i)
const lastSeed = (count) => firstSeed + count - 1
// The sheets show the first 8 seeds at 16:9 and the first 4 at 9:16, then every failing frame. Seeds alike are
// counted among the first `--alike-seeds` (8) at 16:9, as the looks' budgets are.
const SHOWN = { '16x9': Math.min(8, seeds), '9x16': Math.min(4, portraitSeeds) }
const shownOnSheet = (f) => f.seed < firstSeed + SHOWN[f.format]
const alikeSeeds = Math.min(seeds, Number(args['alike-seeds'] ?? 8))
const fromDir = typeof args.from === 'string' ? path.resolve(args.from) : null
const dev = Boolean(args.dev)
const devUrl = typeof args.url === 'string' ? args.url : 'http://localhost:3000'
const maps = Boolean(args.maps)
// old: every off-pack area thicker than a thin bridge counts; new (default, 2026-11-03): lens edges between two pack
// colors count as edges up to the lens's own width.
const rule = args.rule === 'old' ? 'old' : 'new'
const tailRule = args.tails === 'strict' ? 'strict' : 'drift'
// --dim strict: dim colors keep the nominal limits (`greyer`, 20 degrees of hue) all the way down, as before 1:40 PM.
const dimRule = args.dim !== 'strict'
// --haze strict: a cool light's haze must keep the dim rule's share of the path's chroma, as before 4:15 PM.
// --haze narrow: the haze keeps the dim rule's hue window, as before 2026-11-05.
const hazeRule = args.haze === 'strict' ? 'strict' : args.haze === 'narrow' ? 'narrow' : 'wide'
// The main light is the pack color with the most lit area, Atmospheric's greys weighed against all of the colored
// light's (bc1cdc9). --main bright: the color of the frame's brightest part (the 11:30 AM rule of 2026-11-05,
// withdrawn because it fails the moodboard examples; T.bright). --main own: the greys against the colored light's part
// at or below its own nominal brightness only, as before 2026-11-05.
const mainRule = args.main === 'own' ? 'own' : args.main === 'bright' ? 'bright' : 'all'
// --drags owner,mirror,above,side|all|none: the test drags every frame is also judged at (default all).
const dragArg = list(args.drags)
const drags = !dragArg.length || dragArg.includes('all') ? Object.keys(DRAGS) : dragArg.includes('none') ? [] : dragArg
for (const d of drags) if (!(d in DRAGS)) throw new Error(`Unknown drag ${d}: give ${Object.keys(DRAGS).join(', ')}, all or none`)
// renders/ keeps the default light's frames the sheets show; --drag-renders keeps those of the drags too, and
// --all-renders every frame.
const dragRenders = Boolean(args['drag-renders'])
const allRenders = Boolean(args['all-renders'])
// Control values for the render (--at intensity=1,softness=0,horizon=0.3; horizon or light is the mood control).
const controls = { intensity: 0.5, softness: 0.5, mood: 0.5 }
for (const pair of list(args.at)) {
  const [key, value] = pair.split('=')
  const name = key === 'horizon' || key === 'light' ? 'mood' : key
  if (!(name in controls) || Number.isNaN(Number(value))) throw new Error(`--at takes intensity, softness and horizon or light: ${pair}`)
  controls[name] = Number(value)
}
if (dev && list(args.at).length) throw new Error('--at does not apply with --dev: the tool page sends its own fixed intensity, softness and mood control')
if (dev && looks.some((look) => MERGED.includes(look))) throw new Error('--dev does not reach the looks behind a switch: render them with the harness (no --dev)')
// --mix <default|blue-off|Cyan:0.6>: the shared color stage on at that mix, as the tool draws with colormix=1 (each
// design drawn in the stage's design pack and given the frame's pack colors), judged with the mix rule (T.mix).
const mixName = typeof args.mix === 'string' ? args.mix : null
// --reading first: the mix rule's shares give each pixel its one label, as before compare round 28.
const reading = args.reading === 'first' ? 'first' : 'blend'
// The lens's radius follows Softness: R = 0.045 to 0.12 of the short side; a lens edge may be 2R wide.
T.lensEdge = 2 * (0.045 + 0.075 * controls.softness)
if (typeof args['lens-edge'] === 'string') T.lensEdge = Number(args['lens-edge'])
const startedAt = new Date()
const hhmm = startedAt.toTimeString().slice(0, 5)
const sourceLabel =
  typeof args.label === 'string' ? args.label : !lookArg.length ? 'reference library' : fromDir ? `files in ${path.relative(process.cwd(), fromDir)}` : dev ? `dev server ${devUrl} at ${hhmm}, uncommitted working tree` : `harness render of ${ROOT}`
const outDir = path.resolve(typeof args.out === 'string' ? args.out : path.join(ROOT, 'artifacts', 'palette-check', sourceLabel.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)))

const harness = await startHarness()
let browser = null
try {
  const { toneCurve } = await harness.ssr('/src/light/engine/output.ts')
  const { linearToOklab, oklabToLinear } = await harness.ssr('/src/light/color/oklab.ts')
  const { hexToLinear, linearToSrgb, srgbToLinear } = await harness.ssr('/src/light/color/srgb.ts')
  const { getPack } = await harness.ssr('/src/light/color/packs.ts')
  const rendering = !fromDir && !dev
  const { buildScene, clampDrag, controlsForDrag } = rendering || dev ? await harness.ssr('/src/tool/controls.ts') : {}
  const { EXPORT_SIZES } = rendering ? await harness.ssr('/src/light/engine/frame.ts') : {}

  const SRGB_TO_LINEAR = Float64Array.from({ length: 256 }, (_, v) => srgbToLinear(v / 255))
  const lch = ([L, a, b]) => [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360]

  // --- per-pack classifier ---
  // Each pack color's light path, read at a given Oklab lightness: below nominal the color under less light (the
  // tone curve is the identity there, so hue and chroma/lightness stay), above nominal the tone curve's way to white.
  const LSTEPS = 1000
  const hueDiff = (x, y) => Math.abs((((x - y) % 360) + 540) % 360 - 180)
  function lightPath(lin, minStops, maxStops) {
    const lab0 = linearToOklab(lin)
    const [L0, C0, h0] = lch(lab0)
    const Lmin = L0 * Math.cbrt(2 ** -minStops)
    const C = new Float32Array(LSTEPS + 1).fill(NaN)
    const h = new Float32Array(LSTEPS + 1).fill(NaN)
    // Up to and including the hex's own step: the path above it starts at the next step, so a hex whose lightness
    // rounds up would leave its own step empty and its exact color would read as outside the pack.
    const own = Math.round(L0 * LSTEPS)
    for (let i = 0; i <= LSTEPS; i++) {
      const L = i / LSTEPS
      if (L >= Lmin && i <= own) {
        C[i] = (C0 * L) / L0
        h[i] = h0
      }
    }
    let last = Math.round(L0 * LSTEPS)
    for (let e = 0; e <= maxStops; e += 0.01) {
      const [L, Cp, hp] = lch(linearToOklab(toneCurve(lin.map((v) => v * 2 ** e))))
      const i = Math.round(L * LSTEPS)
      for (let j = last + 1; j <= i && j <= LSTEPS; j++) {
        C[j] = Cp
        h[j] = hp
      }
      last = Math.max(last, i)
    }
    return { L0, C0, h0, Lmin, C, h }
  }
  const warmStops = (lab) => (lch(lab)[2] < 60 ? T.warmDimStops.red : T.warmDimStops.yellowish)
  // How far a pixel at (L, C, h) is from a color's path at the same lightness, or Infinity when it is outside.
  // The hue must match (20 degrees, 35 for near-grey paths); the pixel may be deeper than the path, and greyer by
  // at most 35% below nominal (a blurred or slightly mixed color); above nominal any paler tint counts (cream,
  // pale blue: the color mixed with white light).
  function pathScore(path, L, C, h, overCost = 0.5) {
    const i = Math.round(L * LSTEPS)
    const Cf = path.C[i]
    if (Number.isNaN(Cf)) return Infinity
    const hf = path.h[i]
    const pale = L > path.L0
    // A color at or below its own nominal brightness is a better reading than another color's overexposed version,
    // except in a light's brightest part (overCost 0), which is mostly overexposed.
    const paleCost = pale ? overCost : 0
    if (path.C0 < 0.06) {
      // Near-grey pack colors (Atmospheric's Ice, Steel, Slate, Near-black) only count when the pixel is grey too;
      // near white, a cool tint (the light of a pale sky on it) still counts.
      const tint = L >= T.pale.L ? 0.03 : 0
      if (C > 1.2 * Cf + 0.015 + tint) return Infinity
      if (C >= 0.02 && hueDiff(h, hf) > 25 + (tint ? 15 : 0)) return Infinity
      return paleCost + C / 0.05
    }
    if (C < 0.025) return Cf < 0.06 ? paleCost + C / 0.025 : Infinity
    const dh = hueDiff(h, hf)
    if (C > 1.6 * Cf + 0.03) return Infinity
    const turn = ((((h - hf) % 360) + 540) % 360) - 180
    const greyer = path.dim ? T.dim.greyer + (T.greyer - T.dim.greyer) * Math.min(1, Math.max(0, (L - T.dim.floorL) / (path.L0 - T.dim.floorL))) : T.greyer
    // A cool light's haze, greyer than the dim limit below nominal or paler above it, may turn further toward cyan.
    const haze = path.dim?.haze && C >= T.haze && (pale || C < greyer * Cf)
    const [from, to] = haze ? [path.dim.hazeHue[0], pale ? T.hueTolerance : path.dim.hazeHue[1]] : path.dim && !pale ? path.dim.hue : [-T.hueTolerance, T.hueTolerance]
    if (turn < from || turn > to) return Infinity
    if (pale) return C > Cf + 0.03 ? Infinity : paleCost + dh / T.hueTolerance
    if (haze) return 1 + dh / T.hueTolerance
    // Below nominal: a pale tint (light and greyer, like cream for Yellow) still counts; a dim one may only be a
    // little greyer than the path.
    if (C < greyer * Cf) return L >= T.pale.L ? 0.3 + dh / T.hueTolerance : Infinity
    return dh / T.hueTolerance + Math.abs(C - Cf) / Math.max(Cf, 0.03)
  }
  const toAb = (C, h) => [C * Math.cos((h * Math.PI) / 180), C * Math.sin((h * Math.PI) / 180)]
  // A clean mix of two colors at this lightness: near the straight chroma-plane line between the two paths.
  function bridgeScore(pi, pj, L, C, h) {
    const i = Math.round(L * LSTEPS)
    if (Number.isNaN(pi.C[i]) || Number.isNaN(pj.C[i])) return Infinity
    const [ax, ay] = toAb(pi.C[i], pi.h[i])
    const [bx, by] = toAb(pj.C[i], pj.h[i])
    const [px, py] = toAb(C, h)
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
    const qx = ax + t * dx
    const qy = ay + t * dy
    const d = Math.hypot(px - qx, py - qy)
    const allowed = 0.02 + 0.2 * Math.hypot(qx, qy)
    return d <= allowed ? d / allowed : Infinity
  }

  function classifier(packId) {
    const pack = getPack(packId)
    const colors = pack.colors.map((c) => ({ name: c.name, hex: c.hex, lin: hexToLinear(c.hex) }))
    for (const c of colors) {
      c.lab = linearToOklab(c.lin)
      c.warm = WARM[packId].includes(c.name)
      // Dark pack colors stop reading as themselves soon above nominal (Forest turns aquamarine, Plum hot pink,
      // Steel pale sky blue: perception-additive-light.md 3), so their path ends 1 stop up; light colors go to white.
      c.path = lightPath(c.lin, c.warm ? warmStops(c.lab) : 12, c.lab[0] < 0.5 ? T.darkOverStops : 8)
      if (!c.warm && c.path.C0 >= 0.06 && dimRule) {
        const hue = T.dim.hue[c.name] ?? [-T.hueTolerance, T.hueTolerance]
        // In Bold the hues between Meta Blue and Cyan are their clean mix, so there the haze keeps the dim window.
        const wide = hazeRule === 'wide' && !colors.some((x) => x.name === 'Cyan')
        c.path.dim = { hue, hazeHue: wide ? (T.hazeHue[c.name] ?? hue) : hue, narrow: c.name in T.dim.hue, haze: hazeRule !== 'strict' && c.lab[0] >= T.lightL }
      }
    }
    const pairs = []
    const clean = CLEAN_MIXES[packId]
    for (let i = 0; i < colors.length; i++) {
      for (let j = i + 1; j < colors.length; j++) {
        const ok = clean === 'all' || clean.some(([x, y]) => (x === colors[i].name && y === colors[j].name) || (y === colors[i].name && x === colors[j].name))
        if (ok) pairs.push([i, j])
      }
    }
    const neutrals = (NEUTRALS[packId] ?? []).map((name) => colors.findIndex((c) => c.name === name))
    // The dim paths as points (L, C, h and the pack color a stretch counts as), each ending in black.
    const dimPaths = (T.dimPaths[packId] ?? []).map((chain) => {
      const points = []
      for (const anchor of chain) {
        if (Array.isArray(anchor)) points.push({ L: anchor[0], C: anchor[1], h: anchor[2], owner: points.at(-1).owner })
        else {
          const owner = colors.findIndex((c) => c.name === anchor)
          const [L, C, h] = lch(colors[owner].lab)
          points.push({ L, C, h, owner })
        }
      }
      points.push({ L: 0, C: 0, h: points.at(-1).h, owner: points.at(-1).owner })
      return points
    })
    return { packId, pack, colors, pairs, neutrals, dimPaths }
  }
  // Where a pack color's dim path (T.dimPaths) is at lightness L: its chroma-plane point and the color it counts as,
  // or null when no path of that color reaches L.
  function dimPathAt(k, name, L) {
    const want = k.colors.findIndex((c) => c.name === name)
    for (const points of k.dimPaths) {
      for (let s = 0; s + 1 < points.length; s++) {
        const a = points[s]
        const b = points[s + 1]
        if (L > a.L || L < b.L || a.L <= b.L || (a.owner !== want && b.owner !== want)) continue
        const t = (a.L - L) / (a.L - b.L)
        return toAb(a.C + t * (b.C - a.C), a.h + t * (((((b.h - a.h) % 360) + 540) % 360) - 180))
      }
    }
    return null
  }
  // The pack color whose dim path (T.dimPaths) passes within T.dimPathWidth of (L, C, h), or where two paths meet in
  // the dark (T.dimMeets), or -1.
  function onDimPath(k, L, C, h) {
    const [px, py] = toAb(C, h)
    const width = (q) => T.dimPathWidth[0] + T.dimPathWidth[1] * q
    let fam = -1
    let best = Infinity
    for (const points of k.dimPaths) {
      for (let s = 0; s + 1 < points.length; s++) {
        const a = points[s]
        const b = points[s + 1]
        if (L > a.L || L < b.L || a.L <= b.L) continue
        const t = (a.L - L) / (a.L - b.L)
        const Cp = a.C + t * (b.C - a.C)
        const hp = a.h + t * (((((b.h - a.h) % 360) + 540) % 360) - 180)
        const [qx, qy] = toAb(Cp, hp)
        const score = Math.hypot(px - qx, py - qy) / width(Cp)
        if (score <= 1 && score < best) {
          best = score
          fam = t < 0.5 ? a.owner : b.owner
        }
      }
    }
    if (fam >= 0) return fam
    for (const meet of T.dimMeets[k.packId] ?? []) {
      if (L >= meet.below) continue
      const ends = meet.colors.map((name) => dimPathAt(k, name, L))
      if (ends.some((e) => !e)) continue
      const [[ax, ay], [bx, by]] = ends
      const dx = bx - ax
      const dy = by - ay
      const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / Math.max(dx * dx + dy * dy, 1e-12)))
      const qx = ax + t * dx
      const qy = ay + t * dy
      if (Math.hypot(px - qx, py - qy) <= width(Math.hypot(qx, qy))) return k.colors.findIndex((c) => c.name === meet.colors[t < 0.5 ? 0 : 1])
    }
    return -1
  }
  const classifiers = Object.fromEntries(PACK_ORDER.map((id) => [id, classifier(id)]))
  // The light colors a pack offers: its colors at least `T.lightL` light. Atmospheric's light is Ice; its other greys
  // are shades of it, and a grey light is a dimmer Ice light.
  const offeredLights = (k) => k.colors.filter((c, i) => c.lab[0] >= T.lightL && (!k.neutrals.includes(i) || i === k.neutrals[0])).map((c) => c.name)
  const asLight = (k, name) => (k.neutrals.some((i) => k.colors[i].name === name) ? k.colors[k.neutrals[0]].name : name)
  // A dim color whose hue has turned past its own window, away from the other color (Meta Blue toward violet, next
  // to Cyan or a grey), is not a mix of the two either.
  function movedAway(c, other, L, h) {
    if (!c.path.dim?.narrow || L > c.path.L0) return false
    const turn = ((((h - c.path.h0) % 360) + 540) % 360) - 180
    const side = ((((lch(other.lab)[2] - c.path.h0) % 360) + 540) % 360) - 180
    return (turn > c.path.dim.hue[1] && side < turn) || (turn < c.path.dim.hue[0] && side > turn)
  }
  function classify(k, L, C, h) {
    let fam = -1
    let best = Infinity
    k.colors.forEach((c, i) => {
      const s = pathScore(c.path, L, C, h)
      if (s < best) {
        best = s
        fam = i
      }
    })
    if (fam >= 0) return { fam, bridge: -1 }
    if (tailRule === 'drift') {
      // When two warm tails both reach this hue (Yellow's and Orange-red's deep red), it is the nearer color's.
      let tailOf = -1
      let gap = Infinity
      for (let i = 0; i < k.colors.length; i++) {
        const c = k.colors[i]
        const tail = c.warm && T.tails[c.name]
        if (!tail || L >= c.path.L0 || C / Math.max(L, 1e-6) < tail.ratio || h < tail.hue[0] || h > tail.hue[1]) continue
        const d = Math.abs(((h - lch(c.lab)[2] + 540) % 360) - 180)
        if (d < gap) {
          gap = d
          tailOf = i
        }
      }
      if (tailOf >= 0) return { fam: tailOf, bridge: -1 }
    }
    let bridge = -1
    best = Infinity
    k.pairs.forEach(([i, j], n) => {
      if (movedAway(k.colors[i], k.colors[j], L, h) || movedAway(k.colors[j], k.colors[i], L, h)) return
      const s = bridgeScore(k.colors[i].path, k.colors[j].path, L, C, h)
      if (s < best) {
        best = s
        bridge = n
      }
    })
    if (bridge < 0 && dimRule) {
      const own = onDimPath(k, L, C, h)
      if (own >= 0) return { fam: own, bridge: -1 }
    }
    return { fam: -1, bridge }
  }

  // Plain names for colors outside the pack, from Oklab lightness, chroma and hue.
  function outsideName(L, C, h) {
    if (C < 0.03) return h > 20 && h < 110 && C >= 0.015 ? 'grey-brown' : C >= 0.012 && (h >= 290 || h < 20) ? 'mauve-grey' : 'grey'
    if (h < 20 || h >= 345) return L >= 0.7 ? 'pink' : L < 0.45 ? 'maroon' : 'red'
    if (h < 50) return L >= 0.7 ? 'salmon' : L < 0.55 ? (C < 0.08 ? 'grey-brown' : 'brick') : 'orange'
    if (h < 75) return L >= 0.78 ? 'peach' : L < 0.6 ? (C < 0.06 ? 'grey-brown' : 'brown') : 'ochre'
    if (h < 100) return L >= 0.82 ? 'cream' : L < 0.7 ? (C < 0.05 ? 'grey-brown' : 'olive') : 'khaki'
    if (h < 135) return L >= 0.85 ? 'pale lime' : L < 0.75 ? 'olive' : 'yellow-green'
    if (h < 190) return L >= 0.8 ? 'mint' : 'green'
    if (h < 235) return L >= 0.8 ? 'pale cyan' : 'teal'
    if (h >= 270 && h < 290 && L < 0.6) return 'indigo'
    if (h < 275) return L >= 0.8 ? 'pale blue' : 'blue'
    if (h < 315) return L >= 0.68 ? 'lavender' : C >= 0.1 ? 'purple' : 'mauve'
    return L >= 0.72 ? 'pink' : C >= 0.12 ? 'magenta' : 'mauve'
  }

  // --- measuring one frame ---
  const BUCKET_DARK = -2
  const BUCKET_WHITE = -3
  const BUCKET_OUT = -4
  const BUCKET_PALE = -5
  const BUCKET_EDGE = -6 // new rule: on the linear-light mix of two pack colors in the frame (a lens edge)
  const BUCKET_SKIP = -7 // a reference's masked part
  // Is this linear color a mix of pack colors i and j, a * ci + b * cj with a, b >= 0, through the tone curve?
  function onMix(k, pairs, lin, lab) {
    for (const [i, j] of pairs) {
      const ci = k.colors[i].lin
      const cj = k.colors[j].lin
      const ii = ci[0] * ci[0] + ci[1] * ci[1] + ci[2] * ci[2]
      const jj = cj[0] * cj[0] + cj[1] * cj[1] + cj[2] * cj[2]
      const ij = ci[0] * cj[0] + ci[1] * cj[1] + ci[2] * cj[2]
      const pi = lin[0] * ci[0] + lin[1] * ci[1] + lin[2] * ci[2]
      const pj = lin[0] * cj[0] + lin[1] * cj[1] + lin[2] * cj[2]
      const det = ii * jj - ij * ij
      if (det <= 1e-12) continue
      let a = (pi * jj - pj * ij) / det
      let b = (pj * ii - pi * ij) / det
      if (a < 0) [a, b] = [0, Math.max(0, pj / jj)]
      if (b < 0) [a, b] = [Math.max(0, pi / ii), 0]
      if (a <= 0 || b <= 0) continue
      const mix = linearToOklab(toneCurve([a * ci[0] + b * cj[0], a * ci[1] + b * cj[1], a * ci[2] + b * cj[2]]))
      if (Math.hypot(mix[0] - lab[0], mix[1] - lab[1], mix[2] - lab[2]) <= T.mixTolerance) return true
    }
    return false
  }
  // Pixels that survive an opening with a disc of radius r: the parts of the area thicker than 2r.
  function opening(isIn, W, H, r) {
    const n = W * H
    const offsets = []
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) offsets.push([dx, dy])
    const eroded = new Uint8Array(n)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let all = isIn(y * W + x)
        for (let o = 0; all && o < offsets.length; o++) {
          const xx = x + offsets[o][0]
          const yy = y + offsets[o][1]
          if (xx >= 0 && xx < W && yy >= 0 && yy < H && !isIn(yy * W + xx)) all = false
        }
        eroded[y * W + x] = all ? 1 : 0
      }
    }
    const opened = new Uint8Array(n)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!eroded[y * W + x]) continue
        for (const [dx, dy] of offsets) {
          const xx = x + dx
          const yy = y + dy
          if (xx >= 0 && xx < W && yy >= 0 && yy < H && isIn(yy * W + xx)) opened[yy * W + xx] = 1
        }
      }
    }
    return opened
  }
  // A reference's `ignore` rects (poster text, paper folds) are no part of the frame. `chroma` scales every pixel's
  // Oklab a and b before it is judged.
  async function analyse(file, packId, sceneHexes, mapFile, contour, { ignore = [], chroma = 1 } = {}) {
    const k = classifiers[packId]
    const { data, info } = await sharp(file).resize(320, 320, { fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const W = info.width
    const H = info.height
    const n = W * H
    const skip = new Uint8Array(n)
    if (ignore.length) {
      const meta = await sharp(file).metadata()
      for (const { rect } of ignore) {
        const [x0, y0] = [Math.floor((rect[0] * W) / meta.width), Math.floor((rect[1] * H) / meta.height)]
        const [x1, y1] = [Math.min(W, Math.ceil(((rect[0] + rect[2]) * W) / meta.width)), Math.min(H, Math.ceil(((rect[1] + rect[3]) * H) / meta.height))]
        for (let y = y0; y < y1; y++) skip.fill(1, y * W + x0, y * W + x1)
      }
    }
    if (chroma !== 1) {
      for (let p = 0; p < n; p++) {
        const lab = linearToOklab([SRGB_TO_LINEAR[data[3 * p]], SRGB_TO_LINEAR[data[3 * p + 1]], SRGB_TO_LINEAR[data[3 * p + 2]]])
        const lin = oklabToLinear([lab[0], lab[1] * chroma, lab[2] * chroma])
        for (let c = 0; c < 3; c++) data[3 * p + c] = Math.round(255 * linearToSrgb(Math.min(1, Math.max(0, lin[c]))))
      }
    }
    const counted = n - skip.reduce((s, v) => s + v, 0)
    const bucket = new Int16Array(n)
    const names = new Array(n).fill(null)
    const Ls = new Float32Array(n)
    const shares = new Float64Array(k.colors.length)
    const own = new Float64Array(k.colors.length) // at or below the color's own nominal brightness, not overexposed
    const sat = new Float64Array(k.colors.length) // saturated (Oklab chroma 0.12 or more)
    const near = new Float64Array(k.colors.length) // at 60% of the color's nominal lightness or more: an area of that color, not a dim base
    // Bold's Yellow lighter than halfway between Orange-red's and Yellow's hexes (L 0.78): its deep amber tail below
    // that looks like Orange-red.
    const yellow = packId === 'bold' ? k.colors.findIndex((c) => c.name === 'Yellow') : -1
    const clearYellowL = yellow >= 0 ? (k.colors[yellow].path.L0 + k.colors.find((c) => c.name === 'Orange-red').path.L0) / 2 : Infinity
    let clearYellow = 0
    const bridges = new Float64Array(k.pairs.length)
    const outside = {}
    let dark = 0
    let white = 0
    let pale = 0
    let skyFull = 0
    const metaBlue = k.colors.find((c) => c.name === 'Meta Blue').path
    const skyHue = metaBlue.dim?.hue ?? [-T.hueTolerance, T.hueTolerance]
    const labs = new Float32Array(n * 3)
    for (let p = 0; p < n; p++) {
      if (skip[p]) {
        bucket[p] = BUCKET_SKIP
        continue
      }
      const lab = linearToOklab([SRGB_TO_LINEAR[data[3 * p]], SRGB_TO_LINEAR[data[3 * p + 1]], SRGB_TO_LINEAR[data[3 * p + 2]]])
      labs.set(lab, 3 * p)
      const [L, C, h] = lch(lab)
      Ls[p] = L
      if (C >= T.sky.C) {
        const turn = ((((h - metaBlue.h0) % 360) + 540) % 360) - 180
        if (turn >= skyHue[0] && turn <= skyHue[1]) skyFull++
      }
      if (L < T.dark) {
        bucket[p] = BUCKET_DARK
        dark++
        continue
      }
      if (L >= T.white && C < 0.04) {
        if (k.neutrals.length) {
          bucket[p] = k.neutrals[0]
          shares[k.neutrals[0]]++
        } else {
          bucket[p] = BUCKET_WHITE
          white++
        }
        continue
      }
      let { fam, bridge } = classify(k, L, C, h)
      // Atmospheric's neutrals share one hue, so a neutral, or a mix of two neutrals, is named by its lightness.
      if (k.neutrals.length && (k.neutrals.includes(fam) || (bridge >= 0 && k.pairs[bridge].every((i) => k.neutrals.includes(i))))) {
        fam = k.neutrals.reduce((best, i) => (Math.abs(k.colors[i].lab[0] - L) < Math.abs(k.colors[best].lab[0] - L) ? i : best), k.neutrals[0])
        bridge = -1
      }
      if (fam >= 0) {
        bucket[p] = fam
        shares[fam]++
        if (L <= k.colors[fam].path.L0) own[fam]++
        if (C >= 0.12) sat[fam]++
        if (L >= 0.6 * k.colors[fam].path.L0) near[fam]++
        if (fam === yellow && L >= clearYellowL) clearYellow++
      } else if (bridge >= 0) {
        bucket[p] = 100 + bridge
        bridges[bridge]++
      } else if (L >= T.pale.L && C <= T.pale.C) {
        bucket[p] = BUCKET_PALE
        pale++
      } else {
        bucket[p] = BUCKET_OUT
        const name = outsideName(L, C, h)
        names[p] = name
        outside[name] = (outside[name] ?? 0) + 1
      }
    }
    // New rule: an off-pack pixel on the linear-light mix of two pack colors in the frame is a lens edge, unless its
    // hue is a third hue (pink, mauve, lavender and the like), which is neither neighbour. Both colors must show as
    // areas near their own brightness: a warm light's tail over a dim base is not an edge between two colors (C-025).
    let edge = 0
    if (rule === 'new') {
      // In Contour the dark base is not a lit area: a light's falloff over it is its tail, judged by C-025.
      const baseCount = new Float64Array(k.colors.length)
      for (let p = 0; p < n; p++) if (bucket[p] >= 0 && bucket[p] < 100 && Ls[p] < 0.35) baseCount[bucket[p]]++
      const base = contour ? baseCount.indexOf(Math.max(...baseCount)) : -1
      const inFrame = k.colors.map((c, i) => i).filter((i) => near[i] >= 0.01 * counted && i !== base)
      const pairs = []
      for (let a = 0; a < inFrame.length; a++) for (let b = a + 1; b < inFrame.length; b++) pairs.push([inFrame[a], inFrame[b]])
      for (let p = 0; p < n; p++) {
        if (bucket[p] !== BUCKET_OUT || THIRD_HUES.has(names[p])) continue
        const lin = [SRGB_TO_LINEAR[data[3 * p]], SRGB_TO_LINEAR[data[3 * p + 1]], SRGB_TO_LINEAR[data[3 * p + 2]]]
        if (onMix(k, pairs, lin, labs.subarray(3 * p, 3 * p + 3))) {
          bucket[p] = BUCKET_EDGE
          edge++
          outside[names[p]]--
        }
      }
      for (const name of Object.keys(outside)) if (outside[name] <= 0) delete outside[name]
    }
    // Wide outside areas: what survives an opening with a disc of radius wideRadius x short side; a lens edge only
    // counts where it is wider than the lens's own width.
    const r = Math.max(2, Math.round(T.wideRadius * Math.min(W, H)))
    const isOut = (p) => bucket[p] === BUCKET_OUT
    const wide = opening(isOut, W, H, r)
    if (rule === 'new') {
      // A mix area wider than the lens's own width is an off-pack area again, for every check below.
      const wideEdge = opening((p) => bucket[p] === BUCKET_EDGE, W, H, Math.max(2, Math.round((T.lensEdge / 2) * Math.min(W, H))))
      for (let p = 0; p < n; p++) {
        if (!wideEdge[p]) continue
        wide[p] = 1
        bucket[p] = BUCKET_OUT
        edge--
        outside[names[p]] = (outside[names[p]] ?? 0) + 1
      }
    }
    let wideCount = 0
    const wideNames = {}
    for (let p = 0; p < n; p++) {
      if (!wide[p]) continue
      wideCount++
      wideNames[names[p]] = (wideNames[names[p]] ?? 0) + 1
    }
    let largest = 0
    const seen = new Uint8Array(n)
    const queue = new Int32Array(n)
    for (let p = 0; p < n; p++) {
      if (!wide[p] || seen[p]) continue
      let head = 0
      let tail = 0
      queue[tail++] = p
      seen[p] = 1
      while (head < tail) {
        const q = queue[head++]
        const x = q % W
        const y = (q - x) / W
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx
            const yy = y + dy
            if (xx < 0 || xx >= W || yy < 0 || yy >= H) continue
            const s = yy * W + xx
            if (wide[s] && !seen[s]) {
              seen[s] = 1
              queue[tail++] = s
            }
          }
        }
      }
      largest = Math.max(largest, tail)
    }
    // The 1:10 PM rules (SHARED.md, 2026-11-06), used for Sunset frames at the default light only.
    // (b) A sky's pale side counts as the tint it reads as at thumbnail size. Bold: a light blue lighter than Cyan's
    // hex is Cyan up to Oklab hue 227 and Meta Blue's pale side past it. Atmospheric: a blue-grey lighter than Steel's
    // hex with chroma 0.045 or less is a grey (Steel or Ice by lightness), not Meta Blue. Elemental's cream and pale
    // lime already count as Tan and Lime.
    const tinted = Int16Array.from(bucket)
    const tintCounts = Float64Array.from(shares)
    const lines = {}
    const darkShapes = {}
    if (!contour) {
      const at = (name) => k.colors.findIndex((c) => c.name === name)
      const meta = at('Meta Blue')
      const cyan = at('Cyan')
      const steel = at('Steel')
      const blueMixes = new Set(k.pairs.flatMap(([i, j], b) => ((i === meta || j === meta) && (i === cyan || j === cyan || k.neutrals.includes(i === meta ? j : i)) ? [100 + b] : [])))
      for (let p = 0; p < n; p++) {
        const b = bucket[p]
        if (b !== meta && (cyan < 0 || b !== cyan) && !blueMixes.has(b) && b !== BUCKET_PALE) continue
        const L = Ls[p]
        const C = Math.hypot(labs[3 * p + 1], labs[3 * p + 2])
        const h = ((Math.atan2(labs[3 * p + 2], labs[3 * p + 1]) * 180) / Math.PI + 360) % 360
        let to = b
        if (cyan >= 0) {
          const { at: [l0, l1], hue: [h0, h1] } = T.paleSide.cyanHue
          const edge = h0 + (h1 - h0) * Math.min(1, Math.max(0, (L - l0) / (l1 - l0)))
          if (L >= k.colors[cyan].path.L0 && C >= 0.025 && h >= T.paleSide.blueHues[0] && h <= T.paleSide.blueHues[1]) to = h <= edge ? cyan : meta
        } else if (steel >= 0) {
          const cool = C <= 0.02 || hueDiff(h, k.colors[steel].path.h0) <= 40
          if (L >= k.colors[steel].path.L0 && C <= T.paleSide.greyC && cool) to = k.neutrals.reduce((best, i) => (Math.abs(k.colors[i].lab[0] - L) < Math.abs(k.colors[best].lab[0] - L) ? i : best), k.neutrals[0])
        }
        if (to === b) continue
        if (b >= 0 && b < 100) tintCounts[b]--
        tintCounts[to]++
        tinted[p] = to
      }
      // (a) A thin bright line: a light pack color under the present share counts when the part of it at its own
      // brightness or paler (at most T.line.ownL darker than its hex) is one long connected piece, thick enough and
      // different enough from what lies beside it to show at thumbnail size.
      const dilate = (mask, r) => {
        const rows = new Uint8Array(n)
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          if (!mask[y * W + x]) continue
          for (let xx = Math.max(0, x - r); xx <= Math.min(W - 1, x + r); xx++) rows[y * W + xx] = 1
        }
        const both = new Uint8Array(n)
        for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
          if (!rows[y * W + x]) continue
          for (let yy = Math.max(0, y - r); yy <= Math.min(H - 1, y + r); yy++) both[yy * W + x] = 1
        }
        return both
      }
      // The largest connected piece (8 neighbours) of the pixels `own` accepts.
      const largestPiece = (own) => {
        const seen = new Uint8Array(n)
        let piece = []
        for (let p = 0; p < n; p++) {
          if (seen[p] || !own(p)) continue
          const list = [p]
          seen[p] = 1
          for (let head = 0; head < list.length; head++) {
            const q = list[head]
            const x = q % W
            const y = (q - x) / W
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx
              const yy = y + dy
              if (xx < 0 || xx >= W || yy < 0 || yy >= H) continue
              const s = yy * W + xx
              if (!seen[s] && own(s)) {
                seen[s] = 1
                list.push(s)
              }
            }
          }
          if (list.length > piece.length) piece = list
        }
        return piece
      }
      // A piece's extent, its brightest L, and how far it is from what lies 3 to 6 px beside it (of 320), past the
      // lens's soft shoulder (mean Oklab distance from the piece's mean color).
      const pieceStats = (piece) => {
        let [x0, x1, y0, y1] = [W, -1, H, -1]
        const inPiece = new Uint8Array(n)
        const mean = [0, 0, 0]
        for (const p of piece) {
          const x = p % W
          const y = (p - x) / W
          x0 = Math.min(x0, x)
          x1 = Math.max(x1, x)
          y0 = Math.min(y0, y)
          y1 = Math.max(y1, y)
          inPiece[p] = 1
          for (let j = 0; j < 3; j++) mean[j] += labs[3 * p + j] / piece.length
        }
        const near = dilate(inPiece, 2)
        const far = dilate(inPiece, 6)
        let ring = 0
        let diff = 0
        for (let p = 0; p < n; p++) {
          if (!far[p] || near[p] || bucket[p] === BUCKET_SKIP) continue
          ring++
          diff += Math.hypot(labs[3 * p] - mean[0], labs[3 * p + 1] - mean[1], labs[3 * p + 2] - mean[2])
        }
        return { x0, x1, y0, y1, contrast: ring ? diff / ring : 0, peakL: piece.reduce((top, p) => Math.max(top, Ls[p]), 0) }
      }
      for (const [i, c] of k.colors.entries()) {
        if (c.lab[0] < T.lightL || tintCounts[i] >= T.present * counted) continue
        // Bold's Orange-red paler than its hex is peach or cream, which Yellow's deep tones reach too: its line must be
        // at its own brightness.
        const warmOverlap = packId === 'bold' && c.name === 'Orange-red'
        const piece = largestPiece((p) => tinted[p] === i && Ls[p] >= c.path.L0 - T.line.ownL && (!warmOverlap || Ls[p] <= c.path.L0))
        if (!piece.length) continue
        const s = pieceStats(piece)
        const across = s.x1 - s.x0 >= s.y1 - s.y0
        const span = across ? s.x1 - s.x0 + 1 : s.y1 - s.y0 + 1
        lines[c.name] = { share: piece.length / counted, length: span / (across ? W : H), thickness: piece.length / span / Math.min(W, H), elongation: (span * span) / piece.length, contrast: s.contrast, peakL: s.peakL }
      }
      // (c) A dark pack color's shape (DARK_SHAPES), its largest piece at its own lightness.
      for (const name of DARK_SHAPES[packId]) {
        const i = k.colors.findIndex((c) => c.name === name)
        if (tintCounts[i] >= T.present * counted) continue
        const L0 = k.colors[i].path.L0
        const piece = largestPiece((p) => tinted[p] === i && Math.abs(Ls[p] - L0) <= T.darkShape.ownL)
        if (!piece.length) continue
        const s = pieceStats(piece)
        const [w, h] = [(s.x1 - s.x0 + 1) / W, (s.y1 - s.y0 + 1) / H]
        // The lens lightens a shape's outermost pixels, so a piece counts as touching an edge from a few pixels in.
        const e = Math.round(T.darkShape.edge * Math.min(W, H))
        const side = (s.x0 <= e || s.x1 >= W - 1 - e) && (s.y0 <= e || s.y1 >= H - 1 - e)
        darkShapes[name] = {
          share: piece.length / counted,
          width: +w.toFixed(3),
          height: +h.toFixed(3),
          thickness: piece.length / Math.max(s.x1 - s.x0 + 1, s.y1 - s.y0 + 1) / Math.min(W, H),
          corner: side && w < T.darkShape.cornerSpan && h < T.darkShape.cornerSpan,
          contrast: s.contrast,
        }
      }
    }
    if (mapFile) {
      // What each pixel counted as: its pack color, grey for a clean mix, white, black for the dark base,
      // red for a wide outside area and orange for a thin one; a reference's masked parts are purple. Sunset maps
      // show the default light's reading, the sky's pale side named as it reads.
      const px = Buffer.alloc(n * 3)
      const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
      const colorRgb = k.colors.map((c) => hexRgb(c.hex))
      for (let p = 0; p < n; p++) {
        const b = tinted[p]
        const rgb = b >= 100 ? [128, 128, 128] : b >= 0 ? colorRgb[b] : b === BUCKET_WHITE ? [255, 255, 255] : b === BUCKET_PALE ? [210, 210, 210] : b === BUCKET_DARK ? [0, 0, 0] : b === BUCKET_SKIP ? [110, 40, 140] : wide[p] ? [255, 0, 0] : b === BUCKET_EDGE ? [60, 120, 120] : [255, 150, 0]
        px.set(rgb, 3 * p)
      }
      await sharp(px, { raw: { width: W, height: H, channels: 3 } }).png().toFile(mapFile)
    }
    // Clipped white: the share of the frame at 253 or more in every channel.
    let clipped = 0
    for (let p = 0; p < n; p++) if (!skip[p] && data[3 * p] >= 253 && data[3 * p + 1] >= 253 && data[3 * p + 2] >= 253) clipped++
    let darkLine = 0
    const darkLineNames = {}
    for (let p = 0; p < n; p++) {
      if (isOut(p) && !wide[p] && Ls[p] < 0.45) {
        darkLine++
        darkLineNames[names[p]] = (darkLineNames[names[p]] ?? 0) + 1
      }
    }
    // Contour: the dark base and the lit area.
    // The frame's light color: the pack color covering the most lit area at or below its own nominal brightness.
    // An overexposed core is left out (Meta Blue's turns cyan-white). Atmospheric's greys are one hue, so a grey
    // light is named by the lightest grey it reaches on at least 1% of the frame (an Ice light's falloff passes
    // through Steel's and Slate's lightness). The greys count at every lightness, white core included (white is
    // Ice there), so they win only over more than all of the colored light's lit area, its pale part too.
    const litOwn = new Float64Array(k.colors.length)
    const litAll = new Float64Array(k.colors.length)
    let neutralLit = 0
    const neutralTop = new Float64Array(k.colors.length)
    for (let p = 0; p < n; p++) {
      const b = bucket[p]
      if (b < 0 || b >= 100 || Ls[p] < 0.35) continue
      if (k.neutrals.includes(b)) {
        neutralLit++
        neutralTop[b]++
        continue
      }
      litAll[b]++
      if (Ls[p] <= k.colors[b].path.L0) litOwn[b]++
    }
    let source = null
    litOwn.forEach((v, i) => {
      if (v > 0 && (source === null || v > litOwn[source])) source = i
    })
    // A light that is paler than its nominal everywhere (an overexposed crest) is still that light.
    if (source === null) {
      litAll.forEach((v, i) => {
        if (v > 0 && (source === null || v > litAll[source])) source = i
      })
    }
    const colored = source === null ? 0 : mainRule === 'own' ? litOwn[source] : litAll[source]
    const greyLight = () => k.neutrals.find((i) => neutralTop[i] >= 0.01 * counted) ?? k.neutrals.find((i) => neutralTop[i] > 0)
    if (k.neutrals.length && neutralLit > colored) source = greyLight() ?? source
    // The main light (2026-11-05 11:30 AM) is the color of the frame's brightest part, its haze counted toward it: the
    // brightest `T.bright.share` of the frame. A pixel there is a colored light's when it lies on that color's own
    // light path, keeping at least `T.bright.onPath` of the path's chroma at its lightness: the light itself, nominal
    // or overexposed, not the light mixed with white or grey (an Ice light's core tinted by a blue haze). The rest is
    // white or grey light, which is Atmospheric's Ice (named as above); Bold and Elemental offer no white light, so
    // there it doesn't vote. A frame with no votes keeps the lit-area reading.
    const brightVotes = new Float64Array(k.colors.length)
    let brightN = 0
    let brightL = null
    if (mainRule === 'bright') {
      const lit = []
      for (let p = 0; p < n; p++) {
        if (skip[p] || Ls[p] < 0.35) continue
        if (Ls[p] >= T.white || (Ls[p] >= T.bright.whiteL && Math.hypot(labs[3 * p + 1], labs[3 * p + 2]) < T.bright.whiteC)) continue
        lit.push(p)
      }
      lit.sort((x, y) => Ls[y] - Ls[x])
      const part = lit.slice(0, Math.round(T.bright.share * counted))
      const colored = k.colors.map((c, i) => i).filter((i) => !k.neutrals.includes(i))
      for (const p of part) {
        const [L, C, h] = lch(labs.subarray(3 * p, 3 * p + 3))
        const i = Math.round(L * LSTEPS)
        let fam = -1
        let best = Infinity
        for (const c of colored) {
          const { C: pc, h: ph } = k.colors[c].path
          if (Number.isNaN(pc[i]) || C < T.bright.onPath * pc[i] || C > 1.6 * pc[i] + 0.03) continue
          const dh = hueDiff(h, ph[i])
          const s = dh / T.hueTolerance + Math.abs(C - pc[i]) / Math.max(pc[i], 0.03)
          if (dh <= T.hueTolerance && s < best) {
            best = s
            fam = c
          }
        }
        if (fam < 0 && k.neutrals.length) fam = k.neutrals[0]
        if (fam < 0) continue
        brightVotes[fam]++
        brightN++
      }
      if (part.length) brightL = [Ls[part[part.length - 1]], Ls[part[0]]]
      const winner = brightVotes.indexOf(Math.max(...brightVotes))
      if (brightN) source = k.neutrals.includes(winner) ? (greyLight() ?? winner) : winner
    }
    // How light the frame gets: the Oklab L its brightest 1% and 0.1% (a thin line's worth) reach.
    const Lsorted = Float32Array.from(Ls.filter((v, p) => !skip[p])).sort()
    const p99L = Lsorted.length ? Lsorted[Math.floor(0.99 * (Lsorted.length - 1))] : 0
    const peakL = Lsorted.length ? Lsorted[Math.floor(0.999 * (Lsorted.length - 1))] : 0
    // Atmospheric's greys are told apart by lightness only: how far their L spreads (10th to 90th percentile).
    const greyLs = Float32Array.from(Ls.filter((v, p) => k.neutrals.includes(bucket[p]))).sort()
    const greySpan = greyLs.length ? greyLs[Math.floor(0.9 * (greyLs.length - 1))] - greyLs[Math.floor(0.1 * (greyLs.length - 1))] : 0
    let base = 0
    let baseOut = 0
    let lit = 0
    let litOut = 0
    const litByColor = new Float64Array(k.colors.length)
    // A drift into another color needs color: a near-grey (chroma under 0.05) belongs to no color family.
    const litChromatic = new Float64Array(k.colors.length)
    const baseNames = {}
    const litNames = {}
    // The light's own chroma, for --refs: its lit area short of the white core (L 0.35 to 0.85).
    const litChromas = []
    for (let p = 0; p < n; p++) {
      const L = Ls[p]
      if (bucket[p] === BUCKET_DARK || bucket[p] === BUCKET_SKIP) continue
      if (L < 0.35) {
        base++
        if (isOut(p)) {
          baseOut++
          baseNames[names[p]] = (baseNames[names[p]] ?? 0) + 1
        }
      } else {
        lit++
        if (L <= 0.85) litChromas.push(Math.hypot(labs[3 * p + 1], labs[3 * p + 2]))
        if (isOut(p)) {
          litOut++
          litNames[names[p]] = (litNames[names[p]] ?? 0) + 1
        } else if (bucket[p] >= 0 && bucket[p] < 100) {
          litByColor[bucket[p]]++
          if (Math.hypot(labs[3 * p + 1], labs[3 * p + 2]) >= 0.05) litChromatic[bucket[p]]++
        }
      }
    }
    const frac = (v) => v / counted
    const top = (obj, total = counted) =>
      Object.entries(obj)
        .sort((x, y) => y[1] - x[1])
        .map(([name, v]) => ({ name, share: v / total }))
    const result = {
      size: [W, H],
      shares: Object.fromEntries(k.colors.map((c, i) => [c.name, frac(shares[i])])),
      own: Object.fromEntries(k.colors.map((c, i) => [c.name, frac(own[i])])),
      near: Object.fromEntries(k.colors.map((c, i) => [c.name, frac(near[i])])),
      clearYellow: frac(clearYellow),
      tintShares: Object.fromEntries(k.colors.map((c, i) => [c.name, frac(tintCounts[i])])),
      lines,
      darkShapes,
      // The share of the frame that is a pack color at any lightness (Atmospheric's white is Ice).
      shown: frac(shares.reduce((s, v) => s + v, 0)),
      meanL: frac(Ls.reduce((s, v) => s + v, 0)),
      p99L,
      peakL,
      greySpan,
      bright: brightN ? { n: brightN, L: brightL, votes: Object.fromEntries(k.colors.map((c, i) => [c.name, brightVotes[i] / brightN]).filter(([, v]) => v > 0)) } : null,
      bridges: Object.fromEntries(k.pairs.map(([i, j], b) => [`${k.colors[i].name} + ${k.colors[j].name}`, frac(bridges[b])])),
      dark: frac(dark),
      skyFull: frac(skyFull),
      white: frac(white),
      pale: frac(pale),
      edge: frac(edge),
      saturated: Object.fromEntries(k.colors.map((c, i) => [c.name, frac(sat[i])])),
      outside: top(outside),
      outsideShare: frac(Object.values(outside).reduce((s, v) => s + v, 0)),
      wideShare: frac(wideCount),
      wideNames: top(wideNames),
      largestPatch: frac(largest),
      darkLine: frac(darkLine),
      darkLineNames: top(darkLineNames),
      clipped: frac(clipped),
      base: { share: frac(base), outside: base ? baseOut / base : 0, names: top(baseNames, Math.max(1, base)) },
      lit: {
        share: frac(lit),
        outside: lit ? litOut / lit : 0,
        names: top(litNames, Math.max(1, lit)),
        byColor: Object.fromEntries(k.colors.map((c, i) => [c.name, lit ? litByColor[i] / lit : 0])),
        chromatic: Object.fromEntries(k.colors.map((c, i) => [c.name, lit ? litChromatic[i] / lit : 0])),
        chroma: litChromas.length ? litChromas.sort((x, y) => x - y)[Math.floor(litChromas.length / 2)] : null,
      },
      source: source === null ? null : k.colors[source].name,
      sceneColors: sceneHexes ? [...new Set(sceneHexes.map((h) => h.toUpperCase()))].filter((h) => h !== '#000000').map((h) => k.colors.find((c) => c.hex.toUpperCase() === h)?.name ?? h) : null,
    }
    return result
  }

  // --- the rules ---
  const pct = (v) => `${Math.round(v * 100)}%`
  const mainLabel =
    mainRule === 'bright'
      ? "main light: the color of the frame's brightest part (--main bright)"
      : `main light: the most lit area, Atmospheric's grey light against ${mainRule === 'own' ? "the colored light's own-brightness part (--main own)" : "the colored light's whole lit area"}`
  const hazeLabel = `haze: ${!dimRule || hazeRule === 'strict' ? 'strict' : `down to chroma ${T.haze} (4:15 PM), ${hazeRule === 'wide' ? `Meta Blue's up to ${-T.hazeHue['Meta Blue'][0]} degrees toward cyan in Elemental and Atmospheric` : 'in the dim hue window (--haze narrow)'}`}`
  // The colors only one pack has (every pack shares Meta Blue).
  const OWN_COLORS = Object.fromEntries(PACK_ORDER.map((id) => [id, classifiers[id].colors.map((c) => c.name).filter((name) => PACK_ORDER.every((other) => other === id || !classifiers[other].colors.some((c) => c.name === name)))]))
  // A frame's fails, each with a short reason (`reasons`, same order) for counting. `drag` is the test drag it is at.
  function judge(look, packId, m, { drag = null, mix = null } = {}) {
    const k = classifiers[packId]
    const sunset = look.startsWith('sunset.')
    const fails = []
    const reasons = []
    const fail = (reason, text) => {
      reasons.push(reason)
      fails.push(text)
    }
    const notes = []
    if (sunset && m.dark >= 0.99) return { fails: ['blank frame (no light)'], reasons: ['blank'], notes }
    const empty = !sunset && m.peakL < T.black.darkPeakL && m.meanL < T.black.darkMeanL
    m.nearlyBlack = (m.peakL < T.black.peakL && m.meanL < T.black.meanL) || empty
    if (m.nearlyBlack) fail('nearly black', `nearly black (brightest at L ${m.peakL.toFixed(2)}, mean L ${m.meanL.toFixed(2)})`)
    if (m.clipped >= T.flatWhite) fail('flat white', `flat white ${(100 * m.clipped).toFixed(1)}% (253 or more in every channel)`)
    if (!sunset && m.shown < T.noPack) fail('no pack color', 'no pack color')
    // Bold's two warm colors count as one warm light: Yellow's deeper tones and Orange-red's overexposed ones
    // overlap (orange, peach, cream), so a frame shows two warm colors only when both appear at their own
    // brightness or dimmer.
    const share = sunset && drag ? T.drag.visible : T.present
    // At the default light a Sunset sky's pale side counts as the tint it reads as, and a thin bright line as its
    // color (the 1:10 PM rules).
    const tintRules = sunset && !drag && Boolean(m.tintShares)
    const shares = tintRules ? m.tintShares : m.shares
    const warmGroup = packId === 'bold' ? WARM.bold : []
    const present = []
    for (const c of k.colors) {
      if (warmGroup.includes(c.name)) continue
      if (shares[c.name] >= share) present.push(c.name)
    }
    if (warmGroup.length && warmGroup.reduce((s, name) => s + shares[name], 0) >= share) {
      // Under a drag a flat orange field with an amber glow is one color: Yellow counts only where it is clearly
      // lighter than Orange-red.
      if (drag && m.clearYellow >= share && m.own['Orange-red'] >= share) present.push(...warmGroup)
      else {
        const named = warmGroup.reduce((a, b) => (m.own[b] > m.own[a] ? b : a))
        const brightest = warmGroup.reduce((a, b) => (m.saturated[b] > m.saturated[a] ? b : a))
        present.push(m.own[named] >= 0.01 ? named : m.saturated[brightest] >= 0.02 ? `${brightest} (overexposed)` : 'pale warm light')
      }
    }
    if (tintRules) {
      const counted = Object.entries(m.lines ?? {})
        .filter(([name, l]) => !present.some((x) => x.replace(' (overexposed)', '') === name) && l.length >= T.line.length && l.thickness >= T.line.thickness && l.elongation >= T.line.elongation && l.contrast >= T.line.contrast)
        .sort((a, b) => b[1].contrast - a[1].contrast)
      if (counted.length) present.push(`${counted[0][0]} (line)`)
      // A dark pack color's shape (a bank, hill or ground), not a corner shadow (the 11:45 PM rule).
      for (const [name, d] of Object.entries(m.darkShapes ?? {})) {
        if (present.includes(name)) continue
        if (d.share >= T.darkShape.share && d.thickness >= T.darkShape.thickness && d.contrast >= T.darkShape.contrast && !d.corner) present.push(`${name} (shape)`)
      }
    }
    m.present = present
    if (m.largestPatch >= T.largestPatch || m.wideShare >= T.wideShare) {
      const named = m.wideNames.slice(0, 2).map((x) => x.name).join(' and ')
      fail('wide outside area', `wide ${named} ${pct(m.wideShare)} (largest ${pct(m.largestPatch)})`)
    }
    if (m.darkLine >= T.darkLine) notes.push(`thin dark ${m.darkLineNames[0]?.name ?? ''} line ${pct(m.darkLine)}`)
    if (mix) {
      for (const [name, asked] of Object.entries(mix.asked)) {
        if (asked >= T.mix.asked && (mix.shares[name] ?? 0) < T.mix.reads) fail('asked color under 5%', `${name} reads ${pct(mix.shares[name] ?? 0)} (asked ${pct(asked)})`)
      }
      const blueAsked = mix.asked['Meta Blue'] ?? 0
      if (blueAsked >= 0.5 && (mix.shares['Meta Blue'] ?? 0) < T.mix.blue) fail('Meta Blue under 45%', `Meta Blue reads ${pct(mix.shares['Meta Blue'] ?? 0)} (asked ${pct(blueAsked)})`)
      const blue = blueVerdict(mix.blue)
      if (blue.reasons.length) fail('Meta Blue carries no light', `Meta Blue on ${pct(mix.blue.share)} carries no light (${blue.reasons.map((r) => BLUE_TEXT[r](mix.blue)).join('; ')})`)
    } else if (sunset && drag) {
      // Under a drag (12:45 PM): two pack colors over a visible share, one of them its pack's own (Bold's warm light
      // is, overexposed or pale too). Two of Atmospheric's greys count as two colors only when they are two tones: a
      // flat grey field with a faint gradient is one.
      const greys = present.filter((name) => k.neutrals.some((i) => k.colors[i].name === name))
      if (greys.length > 1 && m.greySpan < T.drag.greySpan) {
        const kept = greys.reduce((a, b) => (m.shares[b] > m.shares[a] ? b : a))
        present.splice(0, present.length, ...present.filter((name) => name === kept || !greys.includes(name)))
      }
      const ownColor = present.some((name) => name === 'pale warm light' || OWN_COLORS[packId].includes(name.replace(' (overexposed)', '')))
      if (present.length < 2) fail('one pack color', `${present.length} pack color${present.length === 1 ? '' : 's'} over ${pct(share)} (${present.join(', ') || 'none'})`)
      else if (!ownColor) fail('no color of its own', `no color only ${k.pack.name} has (${present.join(', ')})`)
    } else if (sunset) {
      if (m.shares['Meta Blue'] < T.present) fail('no Meta Blue', 'no Meta Blue sky')
      if (present.length < 3) {
        const [mix, mixShare] = Object.entries(m.bridges).sort((x, y) => y[1] - x[1])[0] ?? []
        const haze = mixShare >= 0.2 ? `, ${pct(mixShare)} is a ${mix} mix` : ''
        fail('under three pack colors', `${present.length} pack color${present.length === 1 ? '' : 's'} (${present.join(', ') || 'none'}${haze})`)
      }
      const warm = present.filter((name) => WARM[packId].includes(name.replace(' (line)', '')) || name === 'pale warm light' || name.endsWith('(overexposed)'))
      if (WARM[packId].length && warm.length === 0) fail('no warm color', 'no warm color')
      if (packId === 'bold' && WARM.bold.every((name) => m.own[name] >= T.present)) fail('two warm colors', 'two warm colors (Yellow and Orange-red)')
      if (packId === 'elemental' && warm.length > 1) notes.push('Lime and Tan together (open question 7)')
    }
    if (!sunset) {
      if (m.base.share >= 0.05 && m.base.outside >= T.baseOutside) fail('base outside the pack', `base is ${m.base.names[0]?.name} (${pct(m.base.outside)} of the base)`)
      if (m.lit.share >= 0.01 && m.lit.outside >= T.litOutside) fail('light outside the pack', `light goes ${m.lit.names[0]?.name} (${pct(m.lit.outside)} of the lit area)`)
      m.mainLight = m.source
      const owner = Object.keys(T.tailPartners).find((key) => T.tailPartners[key].includes(m.source) && (m.lit.byColor[key] ?? 0) >= T.tailOwner)
      if (tailRule === 'drift' && owner) m.mainLight = owner
      if (m.sceneColors) {
        // Atmospheric's greys are one hue named by lightness, so a grey light's falloff is never a drift.
        const neutralNames = k.neutrals.map((i) => k.colors[i].name)
        const partners = tailRule === 'drift' ? m.sceneColors.flatMap((name) => T.tailPartners[name] ?? []) : []
        const lightsWith = new Set([...(m.sceneColors.some((name) => neutralNames.includes(name)) ? [...m.sceneColors, ...neutralNames] : m.sceneColors), ...partners])
        const drifted = Object.entries(m.lit.chromatic).filter(([name]) => !lightsWith.has(name))
        const drift = drifted.reduce((s, [, v]) => s + v, 0)
        if (drift >= T.drift) {
          const into = drifted.sort((x, y) => y[1] - x[1])[0][0]
          fail('light drifts', `${m.sceneColors.join(' and ')} light drifts into ${into} (${pct(drift)} of the lit area)`)
        }
      }
    }
    return { fails, reasons, notes }
  }

  // --- the reference library: each image judged by its look's rules in every pack, as if it were one of our frames ---
  async function checkReferences() {
    const { references } = await loadReferences(harness)
    const unknown = refArg.filter((id) => id !== 'all' && !references.some((r) => r.id === id || r.mood === id))
    if (unknown.length) throw new Error(`Unknown reference or mood: ${unknown.join(', ')}`)
    const picked = references.filter((r) => LOOKS.includes(r.recipe) && (refArg.includes('all') || refArg.includes(r.id) || refArg.includes(r.mood)))
    await fs.mkdir(path.join(outDir, 'maps'), { recursive: true })
    const results = []
    for (const ref of picked) {
      const contour = ref.recipe.startsWith('contour.')
      const light = REF_LIGHT[ref.id]?.join(' or ') ?? null
      const runs = []
      for (const chroma of chromaFactors) {
        for (const pack of PACK_ORDER) {
          const k = classifiers[pack]
          const map = path.join(outDir, 'maps', `${ref.id}-${pack}${chroma === 1 ? '' : `-c${chroma}`}.png`)
          const m = await analyse(ref.file, pack, null, map, contour, { ignore: ref.ignore, chroma })
          const { fails, notes } = judge(ref.recipe, pack, m)
          const main = m.mainLight ? asLight(k, m.mainLight) : null
          // A look whose frames all read like this image would never be lit with its light across seeds 1-8.
          const own = offeredLights(k).filter((name) => REF_LIGHT[ref.id]?.includes(name))
          if (contour && own.length && !own.includes(main)) fails.push(`main light ${main ?? 'none'}, not ${own.join(' or ')}: never ${own.join(' or ')}`)
          runs.push({ pack, chroma, map, fails, notes, main, m })
        }
      }
      // The nearest pack leaves the least of the image outside the pack; packs within 1% of it tie.
      const plain = runs.filter((r) => r.chroma === 1)
      const least = Math.min(...plain.map((r) => r.m.outsideShare))
      const nearest = plain.filter((r) => r.m.outsideShare <= least + 0.01).map((r) => r.pack)
      results.push({ ref, light, nearest, runs })
    }
    const lines = [
      '# Palette check: reference library',
      '',
      `Started ${startedAt.toISOString()}. Each reference is judged by its look's rules in every pack, as if it were one of our frames; masked parts (poster text, paper folds) are left out. A Contour reference must also show its own light (\`REF_LIGHT\`) as the main light. Lit chroma: the median Oklab chroma of the lit area short of the white core (L 0.35 to 0.85).${chromaFactors.length > 1 ? ` Chroma factors: ${chromaFactors.join(', ')} (Oklab a and b scaled before judging).` : ''} Dim colors: ${dimRule ? 'navy rule (1:40 PM)' : 'strict'}; ${hazeLabel}; ${mainLabel}.`,
      '',
    ]
    for (const { ref, light, nearest, runs } of results) {
      const contour = ref.recipe.startsWith('contour.')
      lines.push(`## ${ref.id} (${ref.recipe}${light ? `, light ${light}` : ''}; nearest pack ${nearest.join(', ')})`, '')
      if (REF_KNOWN[ref.id]) lines.push(`Known difference, not a fail: ${REF_KNOWN[ref.id]}.`, '')
      lines.push('| Pack | Chroma | Lit chroma | Full Meta Blue | Verdict | Main light | Pack colors | Outside |', '| --- | --- | --- | --- | --- | --- | --- | --- |')
      for (const r of runs) {
        const colors = Object.entries(r.m.shares).filter(([, v]) => v >= 0.01).sort((x, y) => y[1] - x[1]).map(([name, v]) => `${name} ${pct(v)}`).join(', ')
        const outside = r.m.outside.filter((x) => x.share >= 0.005).slice(0, 3).map((x) => `${x.name} ${pct(x.share)}`).join(', ')
        const verdict = r.fails.length ? `FAIL: ${r.fails.join('; ')}` : r.notes.length ? `ok (${r.notes.join('; ')})` : 'ok'
        lines.push(`| ${r.pack}${nearest.includes(r.pack) ? ' (nearest)' : ''} | ${r.chroma} | ${r.m.lit.chroma?.toFixed(3) ?? '-'} | ${pct(r.m.skyFull)} | ${verdict} | ${contour ? (r.main ?? '-') : '-'} | ${colors || '-'} | ${outside ? `${outside}; wide ${pct(r.m.wideShare)}` : '-'} |`)
      }
      lines.push('')
    }
    await fs.writeFile(path.join(outDir, 'refs.md'), `${lines.join('\n')}\n`)
    const json = results.map(({ ref, runs, ...rest }) => ({ id: ref.id, recipe: ref.recipe, ...rest, runs: runs.map((r) => ({ ...r, map: path.relative(process.cwd(), r.map) })) }))
    await fs.writeFile(path.join(outDir, 'refs.json'), JSON.stringify({ source: 'reference library', startedAt: startedAt.toISOString(), thresholds: T, references: json }, null, 1))
    await drawRefSheet(results)
    console.log(`references: ${path.relative(process.cwd(), path.join(outDir, 'refs.md'))}`)
  }

  // Rows: references. Columns: the image, then what each pixel counted as in each pack (and at each chroma factor,
  // in the nearest pack), with the verdict under each.
  async function drawRefSheet(results) {
    const TW = 180
    const TH = 150
    const GAP = 8
    const CAP = 30
    const ROWH = 18 + TH + 4 + CAP + 8
    const cols = 1 + PACK_ORDER.length + chromaFactors.length - 1
    const width = 12 + cols * (TW + GAP)
    const height = 48 + results.length * ROWH
    const legend = [
      'Palette check on the reference library: the image, then what each pixel counted as. Pack colors in their hex, grey a clean mix,',
      'teal grey a lens edge, light grey a pale bridge, white, black the dark base, red a wide outside area, orange a thin one, purple masked.',
    ]
    const comp = [{ input: textSvg(legend, width, 34, 11, '#ddd'), left: 12, top: 8 }]
    for (const [row, { ref, light, nearest, runs }] of results.entries()) {
      const top = 48 + row * ROWH
      const contour = ref.recipe.startsWith('contour.')
      const cells = [{ file: ref.file, title: `${ref.id}${light ? ` (${light})` : ''}`, lines: [ref.recipe] }]
      for (const r of runs) {
        if (r.chroma !== 1 && r.pack !== nearest[0]) continue
        const title = `${r.pack}${r.chroma === 1 ? '' : `, chroma x${r.chroma}`}${nearest.includes(r.pack) ? ' (nearest)' : ''}`
        const reading = contour ? `main ${r.main ?? '-'}, lit chroma ${r.m.lit.chroma?.toFixed(3) ?? '-'}` : `full Meta Blue ${pct(r.m.skyFull)}, outside ${pct(r.m.outsideShare)}`
        cells.push({ file: r.map, title, lines: [reading, r.fails[0] ?? 'ok'], failed: r.fails.length > 0 })
      }
      for (const [c, cell] of cells.entries()) {
        const left = 12 + c * (TW + GAP)
        comp.push({ input: textSvg([{ text: cell.title.slice(0, 34), color: '#fff' }], TW, 16, 11), left, top })
        if (cell.failed) comp.push({ input: { create: { width: TW + 6, height: TH + 6, channels: 3, background: '#ff2020' } }, left: left - 3, top: top + 15 })
        comp.push({ input: await sharp(cell.file).resize(TW, TH, { fit: 'contain', background: '#161616' }).toBuffer(), left, top: top + 18 })
        comp.push({ input: textSvg(cell.lines.map((t, i) => ({ text: t.slice(0, 42), color: cell.failed && i > 0 ? '#ff7070' : '#bbb' })), TW, CAP, 10), left, top: top + 18 + TH + 4 })
      }
    }
    await sharp({ create: { width, height, channels: 3, background: '#161616' } }).composite(comp).png().toFile(path.join(outDir, 'refs.png'))
  }

  // --- getting the frames ---
  // Every frame at the default light, then at each test drag (its id ends in the drag's name).
  const frameList = (look) => {
    const short = MERGED.includes(look) ? look.replace('.', '-') : look.split('.')[1]
    const frames = []
    for (const drag of [null, ...drags]) {
      const end = drag ? `-${drag}` : ''
      for (const pack of PACK_ORDER) {
        for (const s of seedRange(seeds)) frames.push({ id: `${short}-${pack}-s${s}-16x9${end}`, pack, seed: s, format: '16x9', drag })
        for (const s of seedRange(portraitSeeds)) frames.push({ id: `${short}-${pack}-s${s}-9x16${end}`, pack, seed: s, format: '9x16', drag })
      }
    }
    return frames
  }
  const RENDER = { '16x9': { width: 640, height: 360 }, '9x16': { width: 360, height: 640 } }
  // --mix: the stage (src/light/color/stage.ts) and the mix of each pack, with what it asks of each color.
  const stage = mixName && rendering ? await harness.ssr('/src/light/color/stage.ts').catch(() => null) : null
  if (mixName && rendering && !stage?.withColorMix) throw new Error('--mix: this checkout has no color stage yet (src/light/color/stage.ts with withColorMix and COLOR_DESIGN_PACK)')
  const mixes = mixName ? await harness.ssr('/src/light/color/mix.ts') : null
  const mixOf = (packId) => (mixName ? mixByName(mixes, getPack(packId), mixName) : null)
  const readRules = Object.fromEntries(PACK_ORDER.map((id) => [id, rulesFor(getPack(id))]))
  // The tool's controls for a frame: at a test drag, the line and the mood control set from its start, as the tool
  // has them right after that drag (with the stage on, from the design pack the tool draws in).
  const controlsOf = (look, f) => {
    if (!f.drag) return controls
    const { width, height } = RENDER[f.format]
    return controlsForDrag(look, getPack(stage ? stage.COLOR_DESIGN_PACK : f.pack), f.seed, controls, width / height, clampDrag(DRAGS[f.drag]))
  }

  let page = null
  async function devShot(look, f) {
    if (!browser) {
      browser = await chromium.launch({ channel: 'chrome' })
      page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage()
    }
    const [mood, short] = look.split('.')
    const c = controlsOf(look, f)
    const line = f.drag ? `&from=${c.drag.from.join(',')}&to=${c.drag.to.join(',')}` : ''
    const mixParam = mixName ? mixes.formatMix(getPack(f.pack), mixOf(f.pack)) : null
    const stageQuery = mixName ? `&colormix=1${mixParam ? `&mix=${mixParam}` : ''}` : ''
    await page.goto(`${devUrl}/?mood=${mood}&look=${short}&pack=${f.pack}&seed=${f.seed}&format=${f.format}${line}${stageQuery}`, { waitUntil: 'load', timeout: 90000 })
    // The drag hint ("Drag to reposition the gradient") sits over the middle of the image until the first drag in a
    // browser, so every fresh page would show it.
    await page.addStyleTag({ content: '.tool-hint{display:none!important}' })
    const settled = () => page.waitForSelector('canvas[data-settled="true"]', { timeout: 20000 }).then(() => true, () => false)
    if (await settled()) {
      await page.waitForTimeout(1200)
      await settled()
    } else await page.waitForTimeout(5000)
    const canvas = page.locator('canvas').first()
    const shot = await page.screenshot({ clip: await canvas.boundingBox() })
    // A blank canvas means the page was mid-update; try once more.
    const stats = await sharp(shot).stats()
    if (Math.max(...stats.channels.slice(0, 3).map((ch) => ch.max - ch.min)) < 4 && !f.retried) {
      f.retried = true
      await page.waitForTimeout(8000)
      return devShot(look, f)
    }
    return shot
  }

  if (refArg.length) await checkReferences()
  if (looks.length) await fs.mkdir(path.join(outDir, 'renders'), { recursive: true })
  if (maps) await fs.mkdir(path.join(outDir, 'maps'), { recursive: true })
  const report = { source: sourceLabel, startedAt: startedAt.toISOString(), thresholds: T, drags: Object.fromEntries(drags.map((d) => [d, DRAGS[d]])), looks: {} }
  const summary = [`# Palette check: ${sourceLabel}`, '', `Started ${startedAt.toISOString()}. Controls: intensity ${controls.intensity}, softness ${controls.softness}, mood ${controls.mood}. Rule: ${rule}${rule === 'new' ? `, lens edges up to ${+T.lensEdge.toFixed(3)} of the short side` : ''}; warm tails: ${tailRule}; dim colors: ${dimRule ? 'navy rule (1:40 PM)' : 'strict'}; ${hazeLabel}; ${mainLabel}.${chromaFactors.length > 1 ? ` Also judged with chroma scaled by ${chromaFactors.slice(1).join(', ')}.` : ''} Test drags: ${drags.length ? drags.map(dragText).join('; ') : 'none'}.${mixName ? ` Color stage on at the mix \`${mixName}\`: every color the mix asks at ${pct(T.mix.asked)} or more must read at ${pct(T.mix.reads)} or more of the visibly lit pixels and Meta Blue, where the mix asks it at 50% or more, at ${pct(T.mix.blue)} or more (${reading === 'blend' ? `the blend-aware reading: a pixel in a soft blend between two pack colors counts toward both, when each also reads as itself on one area of ${+(BLEND.own * 100).toFixed(1)}% or more of the lit pixels` : 'each pixel read as one label'}), and where Meta Blue reads on ${pct(BLUE_LIGHT.applies)} or more of them it must carry light (its lightness spreads ${BLUE_LIGHT.spread} or more, its brightest tenth reaches its hex, and under ${pct(BLUE_LIGHT.borrowed)} of that tenth sits beside another color's lighter light); the rules on which pack colors show, Contour's main light per seed and the full-strength Meta Blue share are off.` : ''} Thresholds in \`palette-check.mjs\` (T).`, '']
  for (const look of looks) {
    const started = Date.now()
    const frames = frameList(look)
    for (const f of frames) {
      f.file = fromDir ? path.join(fromDir, `${f.id}.png`) : null
      // A mix naming a color the pack doesn't have leaves that pack's frames out.
      if (mixName && !mixOf(f.pack)) {
        f.missing = true
        continue
      }
      if (fromDir) {
        if (!existsSync(f.file)) f.missing = true
        f.src = f.file
        continue
      }
      if (dev) f.src = await devShot(look, f)
      else {
        const exportSize = EXPORT_SIZES[f.format.replace('x', ':')]
        const built = buildScene(look, getPack(stage ? stage.COLOR_DESIGN_PACK : f.pack), f.seed, controlsOf(look, f), exportSize.width / exportSize.height)
        const scene = stage ? stage.withColorMix(built, getPack(f.pack), mixOf(f.pack)) : built
        // With the stage on the scene's slot colors are the design pack's, not the colors shown, so the drift rule
        // (which reads them) is left out.
        f.sceneHexes = stage ? null : scene.colors
        f.src = await raw(await harness.render({ scene, ...RENDER[f.format], supersample: 2 })).png().toBuffer()
      }
    }
    for (const f of frames) {
      if (f.missing) continue
      f.m = await analyse(f.src, f.pack, f.sceneHexes ?? null, maps ? path.join(outDir, 'maps', `${f.id}.png`) : null, !look.startsWith('sunset.'))
      if (mixName) {
        const { data, info } = await sharp(f.src).removeAlpha().resize(320, 320, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true })
        const pack = getPack(f.pack)
        const read = sharesOf(readRules[f.pack], data, info.width * info.height, true)
        const blend = reading === 'blend' ? blendSharesOf(readRules[f.pack], data, info.width, info.height, read.labels) : null
        const blue = blueLight(readRules[f.pack], data, info.width, info.height, read.labels)
        const rounded = (values) => Object.fromEntries(Object.entries(values).map(([k, v]) => [k, +v.toFixed(4)]))
        const asked = Object.fromEntries(pack.colors.map((c, i) => [c.name, +mixOf(f.pack).shares[i].toFixed(4)]))
        f.mix = { asked, shares: rounded((blend ?? read).shares), ...(blend ? { first: rounded(read.shares), own: rounded(blend.own) } : {}), blue: blue && rounded(blue) }
      }
      Object.assign(f, judge(look, f.pack, f.m, { drag: f.drag, mix: f.mix ?? null }))
    }
    // Renders of the frames the sheets show (the first seeds and every failing frame), or of every frame.
    for (const f of frames) {
      if (fromDir || f.missing) continue
      const keep = allRenders || ((!f.drag || dragRenders) && (shownOnSheet(f) || f.fails.length > 0))
      if (!keep) continue
      f.file = path.join(outDir, 'renders', `${f.id}.png`)
      await fs.writeFile(f.file, f.src)
    }
    const contour = look.startsWith('contour.')
    // Per light (the default, then each test drag): the frames, and per pack the alike seeds (and at the default light
    // the main lights).
    const groups = []
    for (const drag of [null, ...drags]) {
      const at = frames.filter((f) => f.drag === drag && f.m)
      const rows = {}
      for (const pack of PACK_ORDER) {
        const packFrames = at.filter((f) => f.pack === pack)
        const pairs = await seedPairs(packFrames.filter((f) => f.format === '16x9' && f.seed < firstSeed + alikeSeeds))
        rows[pack] = { ...(drag ? {} : mainLights(classifiers[pack], packFrames, contour)), alike: pairs.filter((p) => p.alike), pairs }
      }
      groups.push({ drag, title: drag ? dragText(drag) : null, frames: frames.filter((f) => f.drag === drag), rows })
    }
    await drawSheet(look, groups.slice(0, 1), path.join(outDir, `${look}.png`))
    if (drags.length) await drawSheet(look, groups.slice(1), path.join(outDir, `${look}.drags.jpg`))
    const seconds = Math.round((Date.now() - started) / 1000)
    const rows = groups[0].rows
    report.looks[look] = {
      seconds,
      frames: frames.map(({ file, src, sceneHexes, thumb, ...f }) => ({ ...f, file: file ? path.relative(process.cwd(), file) : null })),
      rows,
      reasons: reasonCounts(groups[0].frames),
      drags: Object.fromEntries(groups.slice(1).map((g) => [g.drag, { rows: g.rows, reasons: reasonCounts(g.frames) }])),
    }
    const failingAll = frames.filter((f) => f.fails?.length)
    summary.push(`## ${look}`, '', `${frames.length} frames: seeds ${firstSeed}-${lastSeed(seeds)} at 16:9 and ${firstSeed}-${lastSeed(portraitSeeds)} at 9:16, at the default light${drags.length ? ` and ${drags.length} test drags` : ''}, in ${seconds} s.`, '')
    // Failing frames first, at every light, grouped by their first reason.
    summary.push(`Failing frames: ${failingAll.length} of ${frames.filter((f) => !f.missing).length}.`)
    const byReason = {}
    for (const f of failingAll) (byReason[f.reasons[0]] ??= []).push(f)
    for (const [reason, list] of Object.entries(byReason).sort((x, y) => y[1].length - x[1].length)) {
      summary.push(`- ${reason} (${list.length}):`)
      for (const f of list) summary.push(`  - ${f.id}: ${f.fails.join('; ')}${f.notes.length ? ` (also ${f.notes.join('; ')})` : ''}`)
    }
    summary.push('', 'At the default light:', '')
    for (const pack of PACK_ORDER) {
      const packFrames = groups[0].frames.filter((f) => f.pack === pack)
      const failing = packFrames.filter((f) => f.fails?.length)
      const row = rows[pack]
      const sky = look.startsWith('sunset.') && !mixName ? ` ${skyLine(packFrames.filter((f) => f.m))}` : ''
      summary.push(`- ${pack}: ${failing.length} of ${packFrames.filter((f) => !f.missing).length} frames fail.${contour ? ` ${mainLightLine(row)}` : ''} ${varietyLine(row.alike)}${sky}`)
    }
    summary.push(`- Frames failing, by reason: ${reasonLine(groups[0].frames)}.`, '')
    for (const g of groups.slice(1)) {
      const counts = PACK_ORDER.map((pack) => {
        const packFrames = g.frames.filter((f) => f.pack === pack && !f.missing)
        return `${pack} ${packFrames.filter((f) => f.fails?.length).length} of ${packFrames.length}`
      })
      const seedsAlike = PACK_ORDER.map((pack) => `${pack} ${g.rows[pack].alike.map((p) => `s${p.seeds.join('/s')}`).join(', ') || 'none'}`)
      summary.push(`- Drag ${g.title}: frames failing ${counts.join(', ')}; by reason: ${reasonLine(g.frames)}. Seeds that look alike (seeds ${firstSeed}-${lastSeed(alikeSeeds)}): ${seedsAlike.join('; ')}.`)
    }
    if (drags.length) summary.push('')
    // The same frames judged again with their Oklab chroma scaled (--chroma), to find how grey a look's light may go.
    for (const chroma of chromaFactors.slice(1)) {
      summary.push(`### ${look} at chroma x${chroma}`, '')
      for (const pack of PACK_ORDER) {
        const scaled = []
        for (const f of frames.filter((x) => x.pack === pack && x.m && !x.drag)) {
          const m = await analyse(f.src, f.pack, f.sceneHexes ?? null, null, contour, { chroma })
          scaled.push({ ...f, m, ...judge(look, f.pack, m, { mix: f.mix ?? null }) })
        }
        const failing = scaled.filter((f) => f.fails.length)
        const litChroma = scaled.map((f) => f.m.lit.chroma).filter((c) => c !== null).sort((x, y) => x - y)
        const median = litChroma.length ? ` Median lit chroma ${litChroma[Math.floor(litChroma.length / 2)].toFixed(3)}.` : ''
        summary.push(`- ${pack}: ${failing.length} of ${scaled.length} frames fail.${contour ? ` ${mainLightLine(mainLights(classifiers[pack], scaled, contour))}` : ''}${median}`)
        for (const f of failing) summary.push(`  - ${f.id}: ${f.fails.join('; ')}`)
      }
      summary.push('')
    }
    console.log(`${look}: ${path.relative(process.cwd(), path.join(outDir, `${look}.png`))}${drags.length ? ` and ${look}.drags.jpg` : ''} (${seconds} s)`)
  }
  if (looks.length) {
    await fs.writeFile(path.join(outDir, 'palette.json'), JSON.stringify(report, null, 1))
    await fs.writeFile(path.join(outDir, 'summary.md'), `${summary.join('\n')}\n`)
    console.log(`summary: ${path.relative(process.cwd(), path.join(outDir, 'summary.md'))}`)
  }

  // --- seed variety: which seeds of a pack look like the same frame at thumbnail size ---
  // A frame's thumbnail: Oklab at 40x23, blurred by 1 px; its L is the layout.
  async function thumbOf(f) {
    if (f.thumb) return f.thumb
    const oklab = (data, i) => linearToOklab([0, 1, 2].map((c) => SRGB_TO_LINEAR[data[3 * i + c]]))
    const { data } = await sharp(f.src).removeAlpha().resize(40, 23, { fit: 'fill' }).blur(1).raw().toBuffer({ resolveWithObject: true })
    const lab40 = Array.from({ length: 40 * 23 }, (_, i) => oklab(data, i))
    f.thumb = { layout: lab40.map((x) => x[0]), lab40 }
    return f.thumb
  }
  // Layout: where the light sits, from each frame's L with its darkest level taken off, but never more than
  // `variety.baseL`: a Contour base drops out, and a sky keeps its own small contrast. Stretching each frame's L to
  // 0-1, as before, blew an even sky's faint gradient up into a full-range layout, so two skies that look the same
  // read as different.
  function layoutDistance(a, b) {
    const la = Math.min(Math.min(...a), T.variety.baseL)
    const lb = Math.min(Math.min(...b), T.variety.baseL)
    let num = 0
    let den = 0
    for (let p = 0; p < a.length; p++) {
      num += Math.abs(a[p] - la - (b[p] - lb))
      den += a[p] - la + (b[p] - lb)
    }
    return den ? num / den : 0
  }
  // Colors: how much colored light a frame has in each hue family (HUE_FAMILIES), wherever it sits. A pixel counts
  // from Oklab chroma `variety.chroma[0]` and fully from `variety.chroma[1]`, so pale greys count for little. A blue
  // counts toward cyan and blue in proportion across `variety.cyanToBlue`, so two blues near the middle stay alike.
  function colorFamilies(lab) {
    const mass = { red: 0, yellow: 0, green: 0, cyan: 0, blue: 0, purple: 0 }
    const [lo, hi] = T.variety.chroma
    const [c0, c1] = T.variety.cyanToBlue
    let lit = 0
    for (const [L, a, b] of lab) {
      if (L < T.variety.litL) continue
      lit++
      const h = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
      const weight = Math.min(1, Math.max(0, (Math.hypot(a, b) - lo) / (hi - lo)))
      const family = HUE_FAMILIES.find(([end]) => h < end)[1]
      if (family === 'blue') {
        const toBlue = Math.min(1, Math.max(0, (h - c0) / (c1 - c0)))
        mass.cyan += weight * (1 - toBlue)
        mass.blue += weight * toBlue
      } else mass[family] += weight
    }
    return Object.fromEntries(Object.entries(mass).map(([name, v]) => [name, lit ? v / lit : 0]))
  }
  // Every pair of the seeds given, with its layout and colors; `alike` marks the ones that fail.
  async function seedPairs(list) {
    const items = []
    for (const f of [...list].sort((a, b) => a.seed - b.seed)) {
      const thumb = await thumbOf(f)
      items.push({ seed: f.seed, layout: thumb.layout, colors: colorFamilies(thumb.lab40) })
    }
    const pairs = []
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const [a, b] = [items[i], items[j]]
        const layout = layoutDistance(a.layout, b.layout)
        const colors = Object.keys(a.colors).reduce((s, k) => s + Math.abs(a.colors[k] - b.colors[k]), 0) / 2
        pairs.push({ seeds: [a.seed, b.seed], layout: +layout.toFixed(3), colors: +colors.toFixed(3), alike: layout <= T.variety.layout && colors <= T.variety.colors })
      }
    }
    return pairs
  }
  // How many frames fail for each reason (a frame with two reasons counts under both).
  function reasonCounts(list) {
    const counts = {}
    for (const f of list) for (const reason of new Set(f.reasons ?? [])) counts[reason] = (counts[reason] ?? 0) + 1
    return counts
  }
  function reasonLine(list) {
    const counts = Object.entries(reasonCounts(list)).sort((x, y) => y[1] - x[1])
    return counts.length ? counts.map(([reason, n]) => `${reason} ${n}`).join(', ') : 'none'
  }
  // Contour: across the run's seeds at 16:9, does every light color the pack offers light at least one frame?
  function mainLights(k, packFrames, contour) {
    const offered = offeredLights(k)
    const mains = packFrames.filter((f) => f.format === '16x9').map((f) => f.m.mainLight && asLight(k, f.m.mainLight)).filter(Boolean)
    const counts = Object.fromEntries(offered.map((name) => [name, mains.filter((x) => x === name).length]))
    return { offered, counts, missing: contour && !mixName ? offered.filter((name) => !counts[name]) : [] }
  }
  function mainLightLine(row) {
    return `Main light across seeds ${firstSeed}-${lastSeed(seeds)}: ${Object.entries(row.counts).map(([nm, c]) => `${nm} ${c}`).join(', ')}${row.missing.length ? `; never ${row.missing.join(', ')}: FAIL` : mixName ? ' (not checked with the color stage on)' : ''}.`
  }
  function skyLine(packFrames) {
    const over = packFrames.filter((f) => f.m.skyFull > T.sky.share)
    if (!over.length) return `Full-strength Meta Blue under ${pct(T.sky.share)} in every frame.`
    const listed = over.slice(0, 12).map((f) => `s${f.seed}${f.format === '9x16' ? ' 9:16' : ''} ${pct(f.m.skyFull)}`)
    return `Full-strength Meta Blue over ${pct(T.sky.share)} of the frame in ${over.length}: ${listed.join(', ')}${over.length > 12 ? ' and more' : ''}.`
  }
  function varietyLine(alike) {
    if (!alike.length) return `No two of seeds ${firstSeed}-${lastSeed(alikeSeeds)} look alike.`
    return `Seeds that look alike (layout, colors): ${alike.map((p) => `s${p.seeds[0]}/s${p.seeds[1]} (${p.layout}, ${p.colors})`).join(', ')}: FAIL.`
  }

  function textSvg(lines, w, h, size = 11, color = '#ddd') {
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${lines.map((l, i) => `<text x="1" y="${(i + 1) * (size + 3)}" font-family="Helvetica" font-size="${size}" fill="${l.color ?? color}">${esc(l.text ?? l)}</text>`).join('')}</svg>`)
  }

  // --- the sheets: packs as rows, seeds as columns, a share bar and the verdict under each tile; at the default light
  // (PNG) and at the test drags, one group of rows per drag (JPEG) ---
  async function drawSheet(look, groups, file) {
    const TW = 200
    const TH = 113
    const PW = 64
    const GAP = 8
    const LEFT = 96
    const BAR = 10
    const TEXT = 30
    const LINE = 18
    const contour = look.startsWith('contour.')
    // Under each row: its alike seeds, and at the default light its main lights (Contour).
    const rowHeight = (g) => 18 + TH + 4 + BAR + TEXT + 4 + (contour && !g.drag ? 2 : 1) * LINE
    const groupHeight = (g) => (g.title ? 24 : 0) + PACK_ORDER.length * rowHeight(g) + 14
    // Each row shows the first seeds, then the pack's failing frames from the other seeds (at most MAX_EXTRA; the
    // rest are listed in summary.md).
    const MAX_EXTRA = 16
    const failingOthers = (g, pack) => g.frames.filter((f) => f.pack === pack && !shownOnSheet(f) && f.fails?.length)
    const tileWidth = (f) => (f.format === '9x16' ? PW : TW)
    const shownWidth = SHOWN['16x9'] * (TW + GAP) + SHOWN['9x16'] * (PW + GAP)
    const extraWidth = Math.max(0, ...groups.flatMap((g) => PACK_ORDER.map((pack) => failingOthers(g, pack).slice(0, MAX_EXTRA).reduce((s, f) => s + tileWidth(f) + GAP, 0) + 130)))
    const width = LEFT + shownWidth + extraWidth + 40
    const height = 70 + groups.reduce((s, g) => s + groupHeight(g), 0) + 10
    const dragged = Boolean(groups[0].drag)
    const mixFails = `, a color the mix asks at ${pct(T.mix.asked)}+ reading under ${pct(T.mix.reads)}, Meta Blue on ${pct(BLUE_LIGHT.applies)}+ of the lit pixels that carries no light`
    const lookFails = look.startsWith('sunset.')
      ? mixName ? mixFails : dragged ? `, under 2 pack colors over ${pct(T.drag.visible)}, no color only the pack has` : ', under 3 pack colors, no Meta Blue, no warm color, two warm colors (Bold)'
      : `, no pack color, base or light outside the pack${mixName ? mixFails : dragged ? '' : ', a pack light color never used across seeds'}`
    const comp = [
      { input: textSvg([{ text: `${look}: palette check${dragged ? ' at the test drags' : ''}`, color: '#fff' }], width, 22, 16), left: 12, top: 8 },
      { input: textSvg([sourceLabel, `Rule: ${rule}${rule === 'new' ? ` (lens edges up to ${+T.lensEdge.toFixed(3)} of the short side)` : ''}. Bar: each pack color's share in its hex, then clean mixes (grey), lens edges (teal grey), pale bridges (light grey), white, the dark base (black), and outside colors (red). A red frame fails. Fail: a wide outside area ${pct(T.largestPatch)}+ (or ${pct(T.wideShare)}+ in all), nearly black, flat white ${pct(T.flatWhite)}+${lookFails}.`], width, 34, 11, '#aaa'), left: 12, top: 30 },
    ]
    let top = 70
    for (const g of groups) {
      if (g.title) {
        comp.push({ input: textSvg([{ text: `Drag: ${g.title}`, color: '#fff' }], width - 12, 20, 13), left: 12, top: top + 2 })
        top += 24
      }
      for (const pack of PACK_ORDER) {
        const k = classifiers[pack]
        comp.push({ input: textSvg([{ text: k.pack.name, color: '#fff' }], LEFT - 8, 20, 13), left: 12, top: top + 18 + Math.round(TH / 2) - 10 })
        const others = failingOthers(g, pack)
        let otherLeft = LEFT + shownWidth + 24
        if (others.length > MAX_EXTRA) comp.push({ input: textSvg([`${others.length - MAX_EXTRA} more failing in summary.md`], 200, 16), left: LEFT + shownWidth + 24 + others.slice(0, MAX_EXTRA).reduce((s, f) => s + tileWidth(f) + GAP, 0), top: top + 18 })
        for (const f of [...g.frames.filter((x) => x.pack === pack && shownOnSheet(x)), ...others.slice(0, MAX_EXTRA)]) {
          const portrait = f.format === '9x16'
          const w = portrait ? PW : TW
          let left = otherLeft
          if (shownOnSheet(f)) left = LEFT + (portrait ? SHOWN['16x9'] * (TW + GAP) + (f.seed - firstSeed) * (PW + GAP) : (f.seed - firstSeed) * (TW + GAP))
          else otherLeft += w + GAP
          const skyShown = f.m && look.startsWith('sunset.') && !mixName
          const skyOver = skyShown ? f.m.skyFull > T.sky.share : false
          const skyText = skyShown ? `${portrait ? ' ' : '   full Meta Blue '}${pct(f.m.skyFull)}` : ''
          comp.push({ input: textSvg([{ text: `s${f.seed}${portrait ? ' 9:16' : ''}${skyText}`, color: skyOver ? '#e0a040' : '#bbb' }], w, 16, 11), left, top })
          if (f.missing || !f.m) {
            comp.push({ input: textSvg(['missing'], w, 16), left, top: top + 18 })
            continue
          }
          const failed = f.fails.length > 0
          if (failed) comp.push({ input: { create: { width: w + 6, height: TH + 6, channels: 3, background: '#ff2020' } }, left: left - 3, top: top + 15 })
          comp.push({ input: await sharp(f.src).resize(w, TH, { fit: 'fill' }).toBuffer(), left, top: top + 18 })
          comp.push({ input: await bar(f.m, k, w, BAR), left, top: top + 18 + TH + 4 })
          const verdict = failed ? f.fails : f.notes.length ? f.notes : ['ok']
          const lines = portrait ? [failed ? 'FAIL' : f.notes.length ? 'note' : 'ok'] : verdict.slice(0, 2).map((v) => v.slice(0, 40))
          comp.push({ input: textSvg(lines.map((t) => ({ text: t, color: failed ? '#ff7070' : f.notes.length ? '#e0c060' : '#8c8' })), w, TEXT, 10), left, top: top + 18 + TH + 4 + BAR + 2 })
        }
        let below = top + 18 + TH + 4 + BAR + TEXT + 4
        const row = g.rows[pack]
        if (row) {
          if (contour && row.counts) {
            const counts = `Main light per seed (16:9): ${Object.entries(row.counts).map(([nm, c]) => `${nm} ${c}`).join(', ')}${row.missing.length ? `. Never lit with ${row.missing.join(', ')}: FAIL` : mixName ? '. Not checked with the color stage on.' : '. Every light color used.'}`
            comp.push({ input: textSvg([{ text: counts, color: row.missing.length ? '#ff7070' : '#8c8' }], width - LEFT, LINE, 11), left: LEFT, top: below })
            below += LINE
          }
          const variety = varietyLine(row.alike)
          comp.push({ input: textSvg([{ text: variety.length > 230 ? `${variety.slice(0, 227)}...` : variety, color: row.alike.length ? '#ff7070' : '#8c8' }], width - LEFT, LINE, 11), left: LEFT, top: below })
        }
        top += rowHeight(g)
      }
      top += 14
    }
    const sheet = sharp({ create: { width, height, channels: 3, background: '#161616' } }).composite(comp)
    await (file.endsWith('.jpg') ? sheet.jpeg({ quality: 85 }) : sheet.png()).toFile(file)
  }

  async function bar(m, k, w, h) {
    const segs = []
    for (const c of k.colors) segs.push([m.shares[c.name], c.hex])
    segs.push([Object.values(m.bridges).reduce((s, v) => s + v, 0), '#808080'])
    segs.push([m.edge ?? 0, '#3c7878'])
    segs.push([m.pale, '#d2d2d2'])
    segs.push([m.white, '#ffffff'])
    segs.push([m.dark, '#000000'])
    segs.push([m.outsideShare, '#ff2020'])
    const px = Buffer.alloc(w * h * 3, 40)
    let x0 = 0
    for (const [share, hex] of segs) {
      const x1 = Math.min(w, x0 + Math.round(share * w))
      const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
      for (let y = 0; y < h; y++) for (let x = x0; x < x1; x++) px.set(rgb, 3 * (y * w + x))
      x0 = x1
    }
    return sharp(px, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer()
  }
} finally {
  if (browser) await browser.close()
  await harness.close()
}
