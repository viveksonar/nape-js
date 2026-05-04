# my-platformer

A 2D platformer starter built on [@newkrok/nape-js](https://napejs.org).

```bash
npm install
npm run dev
```

Open [localhost:5173](http://localhost:5173). Build for production with
`npm run build`; preview the build with `npm run preview`.

## Controls

| Action          | Keys                                        |
| --------------- | ------------------------------------------- |
| Move            | `←` `→` or `A` `D`                          |
| Jump (variable) | `Space` — tap = small hop, hold = full jump |
| Double jump     | `Space` again in mid-air                    |
| Shoot           | `X` or `J`                                  |
| Restart         | `R`                                         |

## What's wired up

The template ships a complete playable mini-level so you can see every
mechanic in action and rip out the bits you don't need.

| Feature                   | File                       | nape-js concept it teaches                           |
| ------------------------- | -------------------------- | ---------------------------------------------------- |
| Run + variable jump       | `src/game/player.js`       | Dynamic body + `CharacterController`                 |
| Double jump               | `src/game/player.js`       | Air-jump counter, ground-touch reset                 |
| Coyote time + jump buffer | `src/game/player.js`       | Frame timers separating input from physics           |
| Tilemap collision         | `src/game/level.js`        | `buildTilemapBody` (greedy meshing, P60)             |
| Coin pickup               | `src/game/coin.js`         | `Sensor` shapes + `InteractionListener`              |
| Spike hazard              | `src/game/hazard.js`       | `CbType` + collision listener                        |
| Goal flag                 | `src/game/goal.js`         | Sensor body + win-state callback                     |
| Stompable enemy           | `src/game/enemy.js`        | Patrol AI with raycasts, normal-direction stomp test |
| Spiky enemy               | `src/game/enemy.js`        | Same patrol, always-damages variant                  |
| Moving platforms          | `src/game/platform.js`     | `KINEMATIC` body + high-friction Material            |
| Projectiles               | `src/game/projectile.js`   | Pooled bodies, `gravMassScale = 0`, CCD              |
| Destructible blocks       | `src/game/destructible.js` | `fractureBody` (P67) + fragment cleanup              |
| Smooth-follow camera      | `src/game/camera.js`       | Frame-rate-independent lerp + bounds clamp + shake   |

A central `InteractionListener` registry (in `src/game/game.js`) routes
every collision event in one place — extend it when you add a new
interaction.

## Project layout

```
src/
  main.js            ← entry point + fixed-timestep game loop
  game/
    game.js          ← Top-level orchestrator + InteractionListeners
    callbacks.js     ← Centralized CbType registry
    player.js, enemy.js, projectile.js, destructible.js, platform.js,
    coin.js, hazard.js, goal.js, level.js, camera.js, hud.js, input.js
  render/
    canvas2d.js      ← active renderer (or threejs.js / pixi.js — see below)
public/              ← static assets (placeholder)
index.html           ← page shell + HUD DOM elements
vite.config.js
package.json
```

## Edit the level

The level is an ASCII grid in `src/game/level.js`. One char per tile:

```
.  empty           =  solid wall/floor
$  coin            s  spike hazard
D  destructible    G  Goomba (stompable)
S  spiky enemy     P  player spawn
F  goal flag       M  moving-platform anchor (pair on same row)
```

Edit the `LEVEL_ROWS` array — the parser handles the rest. Tile size is
`32px` (change `TILE_SIZE` if you want bigger sprites).

## Switch renderer

The template ships with a Canvas2D renderer wired up by default. To use
Three.js or PixiJS instead, edit `src/main.js`:

```js
// Canvas2D (default)
import { Canvas2DRenderer as Renderer } from "./render/canvas2d.js";

// or Three.js — also: npm install three
import { ThreeJsRenderer as Renderer } from "./render/threejs.js";

// or PixiJS — also: npm install pixi.js
import { PixiRenderer as Renderer } from "./render/pixi.js";
```

If you scaffolded with `npm create nape-game@latest -- --renderer=threejs`
(or `=pixi`), the right renderer is already wired and the unused renderer
files were stripped.

## Tuning

Every gameplay magic number is at the top of its module — `RUN_SPEED`,
`JUMP_VELOCITY`, `MAX_AIR_JUMPS` (set to `0` to remove double jump, `2`
for triple), `SHOOT_COOLDOWN`, etc. Start there.

## Deploy

A GitHub Actions workflow is included at `.github/workflows/deploy.yml`
that builds with Vite and publishes `dist/` to GitHub Pages on every
push to `main`. Enable Pages → "GitHub Actions" in your repo settings
and the next push goes live.

## Going further

- [Cookbook](https://github.com/NewKrok/nape-js/blob/master/docs/guides/cookbook.md) — recipes for fluid water, ragdolls, ropes, soft bodies, replays, and more
- [Replay system](https://github.com/NewKrok/nape-js/blob/master/docs/guides/replay-guide.md) — record + scrub deterministic replays
- [Multiplayer guide](https://github.com/NewKrok/nape-js/blob/master/docs/guides/multiplayer-guide.md) — server-authoritative architecture with rollback
- [API reference](https://napejs.org/api/)

## License

MIT
