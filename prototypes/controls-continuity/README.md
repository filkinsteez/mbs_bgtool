# Controls continuity

Notes of the controls agent. The rule (artifacts/agent-context/SHARED.md, "Sliders move the image smoothly"): every 0.01 step of Intensity, Softness, Horizon or Light changes the picture by about as much as the steps next to it, everywhere from 0 to 1. The seed picks the kind of scene; no slider switches a structure, ground type, color or layout at a threshold.

- `scripts/light/control-sweep.mjs` sweeps the sliders and flags jumps; usage in `scripts/light/README.md`. Before committing a change to a look's controls or compose: `node scripts/light/control-sweep.mjs --quick --look <look>` (about a minute per look, exits 1 on a jump).
- `summarize.mjs <run dir> ...` lists the jumps per look and control from the runs' `steps.json`, with the params and uniforms that jump with them.
- Runs and sheets go to `out/` (not committed). `results/` keeps a few before/after sheets.

How a round runs:

1. `node scripts/light/control-sweep.mjs --rev HEAD --out prototypes/controls-continuity/out/<name>`: 7 looks x 3 controls x 3 packs x seeds 1-12 and 5081 x 16:9 and 9:16, about 170,000 frames, 13 minutes for the Sunset looks and 16 for Contour on one job each. `--tree` for the looks under active work.
2. `node prototypes/controls-continuity/summarize.mjs <run dirs>`, then look at the strips in `jumps/` (each names what jumps with it) and the curves in `curves/`.
3. Contact sheets for the critic: `--seeds 1,2,3 --from 0 --to 0.02 --no-strips --frames 0:1:0.1`.
4. A fix in another agent's file: copy the file from HEAD into `out/fix/`, edit it there, make a patch with `a/` and `b/` paths, and check it with `--rev HEAD --patch <file>`. Report the patch; the coordinator routes it.

## Round 1 (2026-11-03, 08:10 to 09:30)

Swept HEAD 680bd1c, all 7 looks (1,638 sweeps), HEAD 582259c for the Sunset looks (702 sweeps: Ramp fb90d96, Bands 5b1e281, Blooms 23616ef), and the working tree at 08:43, uncommitted, for Ramp, Bands and Blooms (stopped at 570 of 702 sweeps when the disk filled). The harness frame matches the tool's canvas within mean ΔE 0.0015 when both run the same code (`--tool-check`).

### Fixed

| Jump | Change | Commit | After |
| --- | --- | --- | --- |
| Ramp, Horizon: land turned into a shore when the line passed height 0.42 and the ridge appeared at 0.8. Owner's case seed 5081, 0.78 to 0.79: ΔE 0.143, 28x the steps around it. Every land seed and pack, at Horizon 0.77-0.85 and 0.28-0.38. | `ramp-compose.ts`: the ridge grows while the line rises from height 1.02 to 0.8, flattens from 0.6 to 0.52, then water comes up from the bottom edge until the land is a far bank at 0.27. Before water shows, the bank reaches past the bottom edge and draws the same pixels as land. | fb90d96 (inside the Ramp agent's commit; the commit message does not mention it) | Owner's case: largest step 0.0113 Bold, 0.0098 Elemental, 0.0041 Atmospheric. Land seeds 3, 4, 9, 10, 5081, all packs, 0 to 1, both formats: largest step 0.010-0.042, no jumps. `results/ramp-horizon-*.jpg` |

### Open

| Look, control | Size | Where | Cause | Fix |
| --- | --- | --- | --- | --- |
| Streaks, Light | ΔE 0.11-0.21, 17-55x | every seed, pack and format, Light 0.41-0.57 | `streaks.ts` 288: `litLeft = random() < 0.25 ? along >= 0.5 : along < 0.5`; `along` follows Light (284), so the lit side flips when the meeting point crosses the middle | Patch `out/fix/streaks-side.patch`: the seed picks the side; Light moves the point from the lit side's edge to the middle (1 seed in 4: from the middle toward the far edge), so more Light always lights more sky. Checked: 78 sweeps, 0 jumps, largest step 0.0084. `results/streaks-light-before-after.jpg` |
| Bands, Softness | up to 0.196, 307x | 32 of 78 sweeps, Softness 0.0-0.98 | `bands-compose.ts` (5b1e281) 257-266: `while (!fits())` removes the land, then whole bands, when they do not fit; `fits()` depends on the lens radius and the line height. 301-319: the land and open branches draw different random numbers, so every band's shape changes | Decide the land and the bands from the seed at the default controls; Softness and Horizon only resize them (the existing `squeeze`); draw the same random numbers in both branches. Not checked yet: the Bands agent has uncommitted edits in the file |
| Bands, Horizon | up to 0.333, 170x | 41 of 78 sweeps, Horizon 0.16-0.92 | same file: 242 `below = place.y < 1 && ...` turns the land on when the line enters the frame, the loop above, and 278 `tip` switches with `below` | as above |
| Blooms, Horizon | up to 0.126, 136x | 54 of 78 sweeps, Horizon 0.22-0.83 | `blooms-compose.ts` (23616ef) 237: `kind = insideSeed(seed) && height <= bottomRoom ? 'inside' : ...` moves the main light from inside the frame to off-frame; the branches draw different random numbers, so the far light and the sky change too. 362-374: `farCorner = farHeight < 0.42` | Patch `out/fix/blooms-switches.patch`: the seed alone picks the kind; an inside light moves on below the frame and widens into a light from below as the height drops past the bottom room (over 0.24 of height); the far light blends from the side to the corner between heights 0.48 and 0.36 with fixed draws; the bridge aim eases from Intensity 0.5 to 0.65. Checked: 156 sweeps of Horizon and Intensity, 0 jumps. `results/blooms-horizon-before-after.jpg` |
| Ramp, Horizon | up to 0.072, 13x | Bold seeds 2, 3, 4, 5081, Horizon 0.17-0.41 | `ramp-compose.ts` (fb90d96) 451: `midSky = hasMidSky(seed) && skyHeight >= 0.9`; the sky drops from 3 stops to 2 and its second color from Meta Blue to Cyan | Patch `out/fix/ramp-midsky.patch`: mid-sky seeds keep 3 stops; the middle step takes the zenith's light and its lower edge the single edge's place as the sky height drops from 1.05 to 0.75. Checked on 1048d7f: on those four seeds the largest step goes from 0.054-0.072 to 0.016-0.040 (the 0.04 is the land-to-water stretch of land seeds, not a jump); Ramp Horizon's largest remaining jump is 0.011, a boundary-model flick |
| Ramp, all three controls | ΔE 0.002-0.013, worst 10x10 block up to 0.09 | 31-57 of 78 sweeps per control | the boundary model's transition list changes: `ramp-boundary.ts` 214-225 adds or drops marks (the glow's lower side entering the frame, marks outside the frame, glow marks near a stop edge) and 237-244 switches a mark's contrast at 0.3. Each transition's noise row is its place in the list (`boundary.ts`, ramp mode counts the transitions passed), so every edge below it changes shape | Keep a fixed list of marks (no frame or distance filter) and fade a mark's contrast instead of switching it, or give each transition a fixed noise row in `boundary.ts` |
| Halo, Softness | ΔE up to 0.006, worst block up to 0.05 | 8 of 78 sweeps | no scene or uniform change: speckle noise in the dark area changes its pattern | low priority |

Gone without a fix from me: Blooms Intensity at 0.50 (680bd1c: ΔE 0.006-0.011, from `bridgeLight` aiming at L 0.9 up to 0.5 and lower above it) has no jumps at 23616ef.

Seen in the working tree at 08:23: Ramp Elemental seed 3, 9:16, the water under the far bank turned from tan to blue within two steps (Horizon 0.93-0.95, ΔE 0.078) while every scene param moved smoothly: with `mirrorReach` all deep water mirrors one sky row. Check at fb90d96 next round.

### Critic, round 1 (fb90d96, contact sheets at 0.1 steps; full text in `out/critic-round1.md`)

1. Bands Softness rearranges the bands at one value between 0.40 and 0.70 (the bottom band goes, Plum disappears from Elemental seed 1). The jump above.
2. Bands Horizon does nothing on seed 1, and on seeds 2-3 moves the bands, then snaps back to the 0.00 picture at 0.60-0.90 and stays there. The jump above.
3. Bands Intensity leaves the top of the frame unchanged, makes the Lime band a flat full-width cream-white band at 0.80-1.00 (Elemental) and the Yellow band flat pale lemon (Bold), and at 0.00-0.20 those bands read olive and mustard.
4. Ramp Horizon still changes seed 3 from land to water over 0.80-1.00 (0.80 to 0.90 about 2x its neighbours), ending mostly blue with a thin glow; Elemental water is violet. Continuous now, but the scene changes kind within one seed. The other way is to let the seed pick land or a far bank over water, so Horizon never changes the ground.
5. Ramp Horizon barely acts on open-sky seeds (seed 1): nothing at 0.00-0.10 and 0.80-1.00, a slight rise of the glow between.
6. Blooms Softness shows no visible difference from 0.00 to 1.00 (median step 0.0005, 44 % of steps near zero).
7. Ramp Intensity makes the lower third a flat full-width cream band, near white at 1.00, on Bold and Elemental seed 1, in both formats.
8. Halo Light seed 3, every pack: one fast step at 0.80 to 0.90 (3-4x its neighbours) where the light spreads down the left edge.

Per look: Rim Softness does little at 0.00-0.40 and a lot at 0.70-1.00; Halo Light is three times faster at 0.70-1.00 than at 0.00-0.30; Beam Light stops at the right edge for 0.90-1.00 on seed 1; Light reads as brightness to a non-designer in every Contour look, which Intensity already does; Streaks looks almost the same in Bold and Elemental; Rim seed 1 is a small sliver in a corner, so all its controls change only that corner.

### Next round

- Check the Bands patch in a frozen copy once the Bands agent commits.
- Re-sweep the routed patches when they land; re-check Ramp's Elemental water at the far bank.
- 9:16 contact sheets for the critic (the round 1 run failed on a sheet-size bug, fixed).
