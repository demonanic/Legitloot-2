# legitloot-2

LegitLoot's game framework and Reference Game 01, **Zombie Invasion Defense** (working title).

This repo is separate from the live `legitloot.site` code on purpose: nothing here touches the existing site, its Supabase projects, or player data.

## Milestone 1: "One wave"

The smallest playable proof, fully offline:

- One arena, one stronghold, two fixed turret mounts (Zone A).
- One turret type (machine gun) and one enemy type (Walker) arriving from all four edges.
- Preparation countdown → warning → one wave → "Wave cleared" or "Overrun" → play again.
- One run currency (label "Supplies" is a placeholder name). Invalid builds never deduct it.
- Fixed 30 Hz simulation, rendering up to 60 FPS, pauses when the tab is hidden.
- On-screen diagnostics (tap **FPS**).
- Placeholder art only. All balance numbers are provisional and live in `games/zid/config.ts`.

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
```

## Preview deployment

Every push to `main` runs the tests and, if they pass, publishes `site/` to GitHub Pages: https://demonanic.github.io/Legitloot-2/

One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

Cloudflare Pages also works: connect the repo, build command `npm install && npm run build`, output directory `site`.
