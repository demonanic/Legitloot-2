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

### New zombies

- **Armored** (from wave 5): slow and tough. Bullets do only half damage; shells, fire, arcs, beams and blasts hit in full.
- **Spitter** (from wave 4): stops about two tiles from your nearest weapon or wall and lobs acid at it every couple of seconds. Kill it from range or it slowly wears your front line down.
- **Boomer** (from wave 6): explodes on reaching anything you built, a survivor or the open truck, hitting everything nearby for 70. Shot dead first, it still bursts, but the burst only hurts other zombies (and sets off other boomers).
- **Screamer** (from wave 7): rare. Zombies within its ring move 40% faster. Kill it first.
- Each type has its own look; boosted zombies show speed streaks, and acid globs fly in green.
- To make room for them, zombie health grows a little more slowly per wave (22% instead of 24%). A scripted player still falls around wave 20 (range 15–23 over 24 seeds), the same as before.

### Railgun

- **Railgun** (220, base level 6; one allowed), on the "More weapons" page (now titled "Build a special weapon").
- Charges for about 3 seconds, then fires a straight beam out to 470 that passes through every zombie on the line, each taking 120 damage. It aims along whichever line through a zombie in range hits the most zombies.
- Speed and Damage upgrades apply (1.6× price). The barrel's charge glow fills between shots, with a hard recoil and a white-blue beam; Speed adds capacitor bands, Damage a hotter glow and a thicker beam.
- Fully upgraded against wave-18 walkers it kills about 50% more than a mortar in a dense stream and about as many as a Tesla coil in a thin one.

### Tutorial

- **Guided start** for a first-time player (stored in the browser as `zid.tutorial`): welcome, Supplies, build your first turret (waits until you do), upgrade/repair/recycle, and starting the wave. The game is paused while each card is up. "Skip tutorial" ends it and stops automatic tips.
- **One-time tips** the first time each thing happens: the first wave, pickups, a full charge meter, mortars, survivors, the base menu after wave 1, the truck returning, having Salvage, and defeat.
- **"?" button** (under Rings) opens a "How to play" reference that pages through every tip, any time.
- The HUD now reads "Salvage N (kept)".

### Tesla coil

- **Tesla coil** (150, base level 5; one at level 5, two at level 6), on the close-range build page.
- It zaps the nearest zombie within 170, then the bolt jumps to the closest zombie within 90 of the last one struck, up to five jumps. If nothing is in reach ahead, it forks from an earlier-struck zombie, so a tight clump is all hit. Each jump does 80% of the one before; no zombie is struck twice by one zap.
- Hits instantly and never misses. Speed and Damage upgrades apply (1.5× price); Speed adds coil rings, Damage a bigger, whiter ball.

### Survivor levels and zombie attraction

- **Levels (1 to 5), earned each run** from a survivor's own kills (20, 60, 130, 240). Each level adds 15% health and 12% damage. The mechanic also earns progress by repairing. Levels reset every run; unlocks stay.
- **Better weapons at levels 3 and 5:**
  - Ray: Pistol, SMG, Assault rifle.
  - Dutch: Rifle, Auto rifle, RPG (homing rockets with splash).
  - Patch: Shotgun, Auto shotgun, Drum shotgun (and double repair speed).
- The name tag shows the level, with a gold line for progress to the next; the weapon drawn changes with each tier.
- **Attraction:** walkers and runners now turn on a survivor from about two tiles away (130, was 55). Brutes ignore survivors and keep going for the stronghold. Survivors have 50% more health to cope.

### Past the wave-11 wall

Real runs kept ending on wave 11: zombie health compounded faster than a full, maxed defence could answer.

- **Gentler curve:** zombie health grows 24% a wave (was 28.5%). Wave 11 is now about as tough as wave 9 used to be.
- **More to buy late:** Speed and Damage upgrades go to five levels (30, 50, 80, 120, 170); barricades reinforce four times; a sixth base level (550) raises every limit and the stronghold's health to 820. Range stays at three levels.
- Barrel and tube counts stop growing at four (five for rockets and shotguns) so weapons still fit their tiles.
- The scripted careful player now falls around wave 20 (was 16). Target band: waves 14 to 24.
- The defeat screen now says "Salvage earned this run +N · you now hold M".

### Survivors

- **Unlocked for good with Salvage**, from the base menu's Survivors page, between waves. Unlocks are saved in the browser and every later run starts with them.
  - **Ray, Scout (60):** fast, light automatic. Runs to pickups and grabs them.
  - **Dutch, Marksman (120):** long-range rifle. Picks the toughest target; +50% damage to brutes.
  - **Patch, Mechanic (180):** shotgun. Repairs the stronghold by 1.2 health a second during an assault.
- **Fully automatic:** each holds a post by the stronghold, shoots what comes into range, backs away from anything too close, stays on a leash, walks round the stronghold, rocks and structures, and falls back to the door to recover below 35% health.
- **Zombies attack them** when close. A survivor who runs out of health is down for the rest of the wave and returns, healed, for the next.
- **Damage grows with the base:** +35% per base level.
- **Last stand:** once per run, if the stronghold would fall while a survivor is on their feet, it instead gets 25% of its health back and a 5-second force field.

### Truck routing and permanent Salvage

- **The truck goes round things.** It plans a route across the grid around rocks, the stronghold and everything you built (rubble and traps included), then straightens it into long runs and wide corners. Collisions use each thing's real footprint. If you wall it in completely it pushes through as few of your structures as it can, never a rock or the stronghold.
- **Smoother driving:** it pulls away and brakes gradually, slows for corners, lines itself up in its bay while waiting, and rolls the last few metres straight into the bay. Zombies it reaches are shouldered aside rather than driven through.
- **Parking bay:** the two tiles below the door are reserved for the truck and can't be built on.
- **What survives defeat:** 20% of every haul unloaded is banked as permanent **Salvage**, saved in the browser the moment it is unloaded. Run Supplies are still lost on defeat. Salvage converts into Supplies 1 for 1, up to 150 per run, at any point in a run: between waves (a "Convert Salvage" button above Start, or the base menu) and mid-assault (tap the base). You choose 25, 50, 100 or everything allowed.
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
