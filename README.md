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

### Truck routing and permanent Salvage

- **The truck goes round things.** It plans a route across the grid around rocks, the stronghold and everything you built (rubble and traps included), then straightens it into long runs and wide corners. Collisions use each thing's real footprint. If you wall it in completely it pushes through as few of your structures as it can, never a rock or the stronghold.
- **Smoother driving:** it pulls away and brakes gradually, slows for corners, lines itself up in its bay while waiting, and rolls the last few metres straight into the bay. Zombies it reaches are shouldered aside rather than driven through.
- **Parking bay:** the two tiles below the door are reserved for the truck and can't be built on.
- **What survives defeat:** 20% of every haul unloaded is banked as permanent **Salvage**, saved in the browser the moment it is unloaded. Run Supplies are still lost on defeat. Before the first wave of a later run, one tap turns stockpiled Salvage into extra starting Supplies (1 for 1, up to 150 per run).
- The balance target band is now waves 10 to 18.

### Salvage runs

- **Send a run** from the base menu between waves (60 Supplies). The truck idles beside the base and drives out when the assault starts.
- **It is a real vehicle:** it steers toward its exit at a limited turn rate, so it curves, slows in tight turns and swerves around zombies in its way. Zombies within reach chase and attack it while it leaves, while it returns and while it unloads.
- **Away for one wave.** What happens off screen is rolled as it leaves the field: a normal haul (60%), a jackpot that doubles the haul and fills the charge meter (10%), nothing found (20%), or the crew never returns (10%).
- **Back during the next assault:** it drives in from an edge, parks by the door and takes 8 seconds to unload. Supplies are paid only when unloading finishes; if the truck is destroyed first, the load is lost. A destroyed or lost truck is replaced after the wave.
- A normal haul is 130 to 190 Supplies plus 8 per wave reached.

### Airstrike, force field, shotgun, flamethrower

- **Four boosts** on the charge meter. Overdrive and Bounty from the start; **Airstrike** at base level 2; **Force field** at base level 3. Locked ones show the level they need.
- **Airstrike:** crosshairs mark a line of up to nine drop zones through the thickest crowd, heading for the next-thickest, then a bomber's shadow crosses and the bombs land in sequence. No bomb is placed on the stronghold, and bombs hurt only zombies. Each bomb does three times a walker's health for the current wave.
- **Force field:** for 6 seconds the stronghold takes no damage and regains 4% of its health per second.
- **Shotgun** (60, base level 2): short range, a fan of six pellets per shot. Two barrels, plus one per Speed level.
- **Flamethrower** (110, base level 3): very short range; burns every zombie in its cone and sets them alight for 2.5 seconds. Speed adds fuel tanks, Damage a wider nozzle and hotter flame.
- The build menu has three pages: Weapons, More weapons (close range), Traps & walls.

### Emergency repairs and upgrade looks

- **Mid-wave spending:** during an assault, tap the stronghold or anything you built to repair it, rebuild rubble or re-arm a spent trap, at 50% more than the between-waves price. Building, upgrading and recycling still wait for the gap between waves.
- **Upgrades you can see:** each Speed level adds a barrel (machine gun) or tube (mortar, rocket launcher; the launcher starts with two) and they fire in turn, each with its own recoil; the Gatling gains barrels and ammo drums. Damage adds red muzzle brakes, bands and wider bores. Range lengthens machine-gun barrels and adds a scope. A gold ring appears on the body per three levels bought.
- **Range rings toggle** under the FPS button; the choice is remembered. A selected weapon still shows its own ring.
- Health pickups are a touch more common (55% of pickups while the stronghold is damaged, was 45%).

### Pickups and boosts update

- **Pickups:** during an assault a green cross or a gold $ appears inside the fence every 10 to 18 seconds. Tap it within 7 seconds: the cross repairs 10% of the stronghold at once, the $ adds 12 to 25 Supplies. Health pickups only appear while the stronghold is damaged.
- **Charge meter:** every kill fills it (90 kills to full). When full, two flashing buttons appear during an assault: **Overdrive** (all weapons fire twice as fast for 8 s) or **Bounty** (kills pay 3× for 12 s). No charge builds while a boost runs.
- **Visuals:** green splatter on kills (dark red for brutes) that leaves a fading stain; the base now has plated roof, lit windows, corner beacons, a radar, a flag with a stripe per level, cracks as it takes damage and smoke when nearly gone.
- Zombie health growth per wave is 0.285 (was 0.27) to offset the new help.

### Base update

- **Base upgrades:** tap the stronghold to upgrade the base (100, 180, 280, 400). Each level raises how many machine guns and mortars you may build (3/1 at the start, up to 12/5) and adds stronghold health. Barricades are never capped; rubble counts until recycled.
- **Range upgrade** for the machine gun (+20% reach per level, 3 levels). Mortars don't take it.
- **Split fire:** each tap during an assault aims one mortar, the closest free one that can reach the spot. Several crosshairs can be up at once; tap one to put that mortar back on automatic.
- **Animations:** coin and "+N" when a kill drops Supplies; machine-gun recoil, muzzle flash and barrel smoke; mortar thump, flash and smoke; shell blasts with a shockwave, debris and smoke.

Not in this milestone: free placement (Zone B), other turrets, barricades, other enemies, the adaptive scheduler, permanent progression, saves, sign-in, the portal, expeditions, monetization and sound.

### Arsenal update

- **Bigger battlefield:** everything is about 20% smaller and the fence is wider: 122 buildable tiles (was 52). Tiles are about 37 px on a phone, so taps just outside a tile still pick it.
- **Gatling gun** (90, base level 3): spins up from 3 to 16 shots a second while it has targets; the barrels visibly spin and glow, then wind down.
- **Rocket launcher** (120, base level 4): homing rockets aimed at the toughest zombie in range, direct hit plus splash; smoke trails and back-blast.
- **Proximity mine** (15, from the start) and **trip wire** (25, base level 2): don't block zombies and are never attacked. A mine blasts everything near it; a trip wire sets off five blasts along the wire. Each goes off once; **re-arm** a spent trap between waves for a fee (60% of what it cost) or recycle it. Trap damage grows with the base level.
- **Limits:** Gatlings and rockets start at 1 each; mines and trip wires share a trap limit (6 at the start). All grow with base upgrades.
- **Unlocks come from base upgrades:** locked items show the base level they need, the base menu says what the next level unlocks, and a banner announces each unlock. The build menu has two pages: Weapons, and Traps & walls.

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
