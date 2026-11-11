# legitloot-2

LegitLoot's game framework and Reference Game 01, **Zombie Invasion Defense** (working title).

This repo is separate from the live `legitloot.site` code on purpose: nothing here touches the existing site, its Supabase projects, or player data.

## Milestone 1: "One wave"

The smallest playable proof, fully offline:

- One arena and one stronghold inside an irregular property fence. Turrets go on any buildable tile inside the fence (80-unit tiles, about 46 px on a phone). Tap a tile to select it, then press Build; occupied tiles, rocks, the stronghold and anything outside the fence are refused by the simulation, never charged.
- One turret type (machine gun) and one enemy type (Walker) arriving from all four edges.
- Preparation countdown → warning → assault, repeating wave after wave until the stronghold falls ("Overrun" → play again). "Start wave now" skips the rest of preparation and starts the assault immediately. Turrets can only be built outside assaults. Every wave is currently the same size; wave scaling is an open decision.
- One run currency (label "Supplies" is a placeholder name). Invalid builds never deduct it.
- Fixed 30 Hz simulation, rendering up to 60 FPS, pauses when the tab is hidden.
- On-screen diagnostics (tap **FPS**).
- Placeholder art only. All balance numbers are provisional and live in `games/zid/config.ts`.

### Challenge update

- **Enemies:** Walkers, Runners (fast, fragile, from wave 2) and Brutes (slow, tough, heavy stronghold damage, from wave 4).
- **Waves get harder every time:** more enemies, compounding enemy health, a shifting mix, and from wave 3 most of a wave can come from one side.
- **Random Supplies drops** per kill, weighted by enemy type and reproducible from the seed.
- **Turret menu** (tap a turret between waves): Speed and Damage upgrades, three levels each. A turret can take both. **Recycle** removes the turret with no refund and needs a second tap.
- **Balance:** `node scripts/balance.mjs [seeds]` plays scripted runs and prints survival and per-wave numbers. Current provisional target: a sensible player usually falls between waves 10 and 15.

### Defences update

- **Barricades** (20) on any buildable tile; **reinforce** twice for more health.
- **Everything you build has health.** Zombies take any open route to the stronghold; if you wall it in completely they break through the weakest blocker. Turrets block too.
- **Destroyed structures become rubble**: they keep the tile and stop working. **Rebuild** (60% of what you spent, upgrades kept) or **Recycle** (+25%). Recycling an intact structure returns 50%.
- **Repairs** between waves for structures and the stronghold, partial if supplies run short.

### Mortar update

- **Mortar** (80): long range (440), but can't hit anything closer than 130. Shells take about a second to land and hit every zombie in the blast. Same Speed and Damage upgrades as the turret, at 1.5× the price; health, rubble, rebuild and recycle work the same way.
- **Aiming:** on its own the mortar shells the thickest crowd it can reach. During an assault, tap the map to drop its shells there; tap the marker again to return to automatic. Mortars that can't reach the spot keep picking their own targets. The aim resets each wave.
- **Earlier danger:** zombies move 30% faster, the machine gun's range is 200 (was 300), and from wave 2 part of each wave arrives in tight packs. A careful scripted player now takes hits from wave 1 and still falls around waves 11–15.

### Base update

- **Base upgrades:** tap the stronghold to upgrade the base (100, 180, 280, 400). Each level raises how many machine guns and mortars you may build (3/1 at the start, up to 12/5) and adds stronghold health. Barricades are never capped; rubble counts until recycled.
- **Range upgrade** for the machine gun (+20% reach per level, 3 levels). Mortars don't take it.
- **Split fire:** each tap during an assault aims one mortar, the closest free one that can reach the spot. Several crosshairs can be up at once; tap one to put that mortar back on automatic.
- **Animations:** coin and "+N" when a kill drops Supplies; machine-gun recoil, muzzle flash and barrel smoke; mortar thump, flash and smoke; shell blasts with a shockwave, debris and smoke.

Not in this milestone: free placement (Zone B), other turrets, barricades, other enemies, the adaptive scheduler, permanent progression, saves, sign-in, the portal, expeditions, monetization and sound.

### URL options

| URL | What it does |
| --- | --- |
| `/` | Normal game, random spawn layout |
| `?seed=123` | Fixed spawn layout |
| `?stress` | Performance test: 50 walkers and 100+ projectiles on screen |
| `?diag` | Open diagnostics on load |

## Layout

```
engine/loop     fixed-step loop, lifecycle, visibility pause
engine/render   Canvas 2D, letterboxing, screen→world coordinates
engine/input    taps, UI-before-world routing
games/zid       config (all numbers), pure simulation, drawing, entry point
tests           unit tests (node:test)
public          index.html
scripts         site assembly, engine isolation check, local server
```

Rule: engine code never imports from `games/` and never mentions game concepts. `npm run check` enforces it.

## Commands

```
npm install
npm run check   # type-check + engine isolation
npm test        # unit tests
npm run build   # assembles site/
npm run serve   # serves site/ at http://localhost:8080
node scripts/balance.mjs 24   # balance report (after build or test)
```

## Preview deployment

Every push to `main` runs the tests and, if they pass, publishes `site/` to GitHub Pages: https://demonanic.github.io/Legitloot-2/

One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

Cloudflare Pages also works: connect the repo, build command `npm install && npm run build`, output directory `site`.
