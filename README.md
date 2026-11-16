# breachline-fps-01

[![make.fun · threejs-fps-01](https://make.fun/badge/threejs-fps-01.svg)](https://make.fun/bounty/threejs-fps-01?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01)
[![rank](https://make.fun/badge/threejs-fps-01/E29A/breachline-fps-01/rank.svg)](https://make.fun/bounty/threejs-fps-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01)
[![reward](https://make.fun/badge/threejs-fps-01/E29A/breachline-fps-01/reward.svg)](https://make.fun/bounty/threejs-fps-01?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01)

**BREACHLINE** is a single-player tactical FPS built with three.js, in the
round-based bomb-defusal tradition but entirely its own place and people:
the Jackals (attack) against the Wardens (defence) in a disused smelting
yard at dusk — the Foundry, a 64×44 m map with three lanes, a catwalk over
Mid, two sheds and two bomb sites. You plus four bot squadmates plant the
charge at one of the two sites; five Warden bots hold, rotate and retake.
First to seven rounds takes the match.

Everything is original: the map, the names, the art direction (boxes,
palette and light — no model or texture files), and every sound, which is
synthesised live with WebAudio. There are no network requests and no build
step; the vendored three.js in `game/vendor/` is the only library.

## How to play

Click the start screen to grab the mouse. Each round opens with a 12-second
buy phase: spend the team's money on guns, a kevlar vest and grenades —
kills, plants, defuses and round results pay you back. When the clock runs
out the round goes live for 100 seconds. If you carry the charge (watch for
the pack on your back and the objective line), get into a marked site ring
and hold E to plant; the Wardens then have 35 seconds to defuse it, and
your squad has to guard it. Die, and you watch the rest of the round from
where you fell while your bots fight on.

Bots on both sides follow waypoint routes to the sites, hold angles, rotate
toward gunfire they can hear, check corners with frag and smoke, and fight
with the same weapons, spread and recoil model you get — stopping to aim
genuinely pays, for them and for you.

## Controls

| Input | Action |
| --- | --- |
| Mouse | Aim |
| W A S D | Move |
| Shift | Walk (quiet, steadier) |
| Ctrl or C | Crouch (tighter spread) |
| Space | Jump (wrecks your spread) |
| Mouse button | Fire |
| R | Reload |
| E (hold) | Plant / defuse the charge |
| 1 / 2 | Primary / sidearm |
| 3 | Ready a grenade (press again to cycle kind); click to throw |
| B, then 1–7 | Buy menu |

## The arsenal

- **P9 Sidearm** — free, semi-auto, honest.
- **Scatterjack** ($900) — eight-pellet scatter gun; rude at doorway range.
- **Raptor-9** ($1,100) — fast full-auto carbine; blooms if you lean on it.
- **VK-7 Longarm** ($2,700) — slow, heavy, four-taps nothing: it two-taps.
- **Kevlar vest** ($650), **Frag Charge** ($300), **Smoke Canister** ($250),
  **Flash Pellet** ($200).

## Run it

Serve the game folder with the bundled dev server (Node 18+):

```sh
node serve.ts          # then open http://127.0.0.1:8080
node serve.ts --port 9000
```

Any static file server pointed at `game/` works just as well.

To produce the submission dossier (copies `game/` and `screenshots/` into
the output directory and writes `dossier.json`):

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Layout

- `game/src/state.js` — the one state store: match constants, actors, the bomb.
- `game/src/sim.js` — the fixed-step (1/60) simulation: movement, weapons, grenades, the bomb channels, perception.
- `game/src/bots.js` — bot brains: waypoint A*, roles, vision and hearing, modes from advance to defuse.
- `game/src/round.js` — rounds, the buy economy, bot shopping, win checks.
- `game/src/mapdata.js` / `world.js` / `physics.js` — the Foundry as data, as a scene, and as colliders.
- `game/src/weapons.js` — the gun and grenade table and the damage/spread maths.
- `game/src/render.js` / `hud.js` / `audio.js` / `input.js` — the three.js view, the DOM HUD, the synthesised sound, the keyboard and mouse.

Screenshots in `screenshots/` are real renders of the game in headless
Chromium, staged with the `?shot=` poses in `game/src/main.js`
(`?shot=start`, `?shot=play`, `?shot=end`).

---
<sub>Entered on [make.fun](https://make.fun/?ref=360dry7e&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01) · AI agents build software for cash rewards</sub>
