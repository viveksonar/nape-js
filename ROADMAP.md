# nape-js — Roadmap

## Completed Items

Done: P21-P28, P30-P33, P35, P37-P43, P44, P45-P48, P50-P55, P57, P60, P62, P63, P64, P66-P68, P70.
Cancelled: P34 (tree shaking — architectural limit), P36 (server demos — superseded by P52), P49 (ECS adapter — trivial pattern).

### P44 — PixiJS integration (`@newkrok/nape-pixi` 0.1.0)

Shipped as a sibling workspace package. Published to npm on first master
merge via the independent per-package auto-release pipeline
(`scripts/ci/release.mjs`).

- `BodySpriteBinding` — body → PIXI display sync, body-local offsets, auto-cleanup on space removal, sub-step interpolation via `FixedStepper`.
- `FixedStepper` — fixed-timestep driver, spiral-of-death cap, before/after hooks, `alpha ∈ [0, 1)` for render interpolation.
- `PixiDebugDraw` — on-demand shape + constraint overlay. Per-body Graphics cache with togglable layers. Zero `pixi.js` build coupling (structural `GraphicsLike` / `ContainerLike` with user-injected PIXI factory).
- `WorkerBridge` + transform protocol — off-thread physics helper. `SharedArrayBuffer` when available, `postMessage` fallback otherwise. Doesn't prescribe the worker script — provides the wire format + the main-thread glue.
- 71 tests, ~10 KB minified ESM, 17 KB d.ts, PIXI v8 peer-dep.

### P60 — Tilemap collision helper

Shipped as a new helper in `@newkrok/nape-js` (`packages/nape-js/src/helpers/tilemap.ts`).

- `meshTilemap(grid, options)` — pure geometry: turns a 2D tile grid into the minimal set of axis-aligned rectangles using `merge: "none" | "rows" | "greedy"` (greedy meshing is the default, dramatically cuts shape count for typical level data).
- `buildTilemapBody(grid, options)` — wraps `meshTilemap` and produces a static (or kinematic / dynamic) `Body` with one `Polygon` per merged rect. Supports custom `tileSize` (square or `{w,h}`), `position`, `material`, `filter`, `cbTypes`, custom `solid` predicate, and appending shapes to an existing `body`.
- `tiledLayerToGrid(layer)` / `ldtkLayerToGrid(layer)` — zero-dep parsers for Tiled tile layers and LDtk IntGrid layers (only read the `data` / `intGridCsv` + dimension fields).
- 54 unit tests + an interactive demo (`docs/demos/tilemap.js`) — 36×20 platformer level driven by `CharacterController`, click-to-toggle tiles with live body rebuild, overlay showing the greedy-merged rectangles.

### P70 — RadialGravityField helper

Shipped as a new helper in `@newkrok/nape-js` (`packages/nape-js/src/helpers/RadialGravityField.ts`).

- `RadialGravityField` — point-source gravity field with configurable falloff (`"inverse-square"` default, plus `"inverse"`, `"constant"`, and custom `(d) => number` functions). Anchor can be a fixed `Vec2` or a `Body` (auto-tracking). Supports `maxRadius` cutoff, `minRadius` clamp (singularity protection), `softening` epsilon, `bodyFilter` predicate, and `scaleByMass` toggle for Newtonian vs constant-acceleration use.
- `RadialGravityFieldGroup` — composable container; one `apply(space)` runs all member fields. Forces accumulate additively, preserving any userland `body.force` writes.
- 33 unit tests covering all four falloff laws, edge cases (singularity, zero distance, disabled, filter, static/kinematic), accumulation semantics, and physics integration.
- **Refactored** `gravity.js` and `three-body.js` demos to use the new helper — three-body's pairwise N² loop becomes one `RadialGravityField` per body with self-exclusion `bodyFilter`.
- **New demo** `planet-platformer.js` — Mario-Galaxy-style: walk around ten planetoids (each with its own gravity well) plus a giant **Goliath** in the east, with random debris on every surface. Jump between them, collect coins + a star.
- **Side fix**: `CharacterController` now exposes a runtime-mutable `down: Vec2` direction (default `(0, 1)`) — ground / wall raycasts and slope detection follow it. Makes radial-gravity walking work natively. Default behaviour unchanged.

### P62 — ParticleEmitter helper

Shipped as a new helper in `@newkrok/nape-js` (`packages/nape-js/src/helpers/ParticleEmitter.ts`).

- `ParticleEmitter` — pooled, lifecycle-managed swarm of dynamic bodies. Each particle is a real `Body` with a `Circle` or `Polygon` shape, so it collides with the world, reacts to forces / gravity / fluids, and triggers callbacks like any other body. Supports continuous (`rate`), periodic (`burstCount` + `burstInterval`), and manual (`emit(n)`) spawning. Configurable spawn pattern (`point` / `rect` / `circle` / `arc` / custom), velocity pattern (`fixed` / `cone` / `radial` / custom), lifetime range, deterministic RNG, world-space `bounds`, `overflowPolicy: "drop-oldest" | "drop-new"`, `selfCollision` toggle (auto-generates a self-excluding `InteractionFilter`), and lifecycle hooks (`onSpawn` / `onUpdate` / `onDeath` / `onCollide`). Internal body pool is reused across spawns — zero allocation in the steady state.
- `ParticleEmitterGroup` — composable container, one `update(dt)` runs every member emitter. Mirrors `RadialGravityFieldGroup`.
- 53 unit tests covering construction validation, burst / continuous / periodic spawning, all spawn + velocity patterns, lifetime range, pool reuse, bounds kill, all four lifecycle hooks (incl. `requestKill` deferred death), self-excluding filter generation, polygon shape, `allowRotation`, `Group` semantics, `destroy()` lifecycle, and end-to-end determinism with seeded RNG.
- **New demo** `volcano.js` — combines P70 + P62: a planet with a `RadialGravityField`, a continuous lava-cone emitter on top, and a click-to-burst secondary emitter. Drops collide with the surface debris and pile up.
- **New demo** `destructible-arena.js` — combines P60 + `CharacterController` + `fractureBody` + two `ParticleEmitter`s: bullet projectiles (cb-typed, on-hit damage + deferred kill via `requestKill`) and explosion debris (radial burst per kill). Side-view shooter on a greedy-meshed tilemap.

---

## Active Priorities

| #   | Priority                         | Effort | Impact   | Status                                                         |
| --- | -------------------------------- | ------ | -------- | -------------------------------------------------------------- |
| P29 | Test coverage >= 80%             | L      | safety   | :diamonds: ~72% statements (5632 tests)                        |
| P56 | Interactive playground           | S-M    | adoption | :white_square_button: Not started                              |

---

## New Priorities

### Ecosystem & Integrations

| #   | Priority                     | Effort | Impact          | Why                                                                                                                                                   |
| --- | ---------------------------- | ------ | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| P58 | **Phaser plugin/adapter**    | M      | :fire: adoption | Phaser is the #1 JS game framework — direct integration = massive reach. Phaser Box2D exists but lacks fluid sim, character controller, serialization |
| P59 | **React/R3F integration**    | M      | :fire: adoption | `@react-three/rapier`-style package for the React gamedev community. Growing market segment                                                           |

### Developer Experience & Onboarding

| #   | Priority                            | Effort | Impact          | Why                                                                                                                                                                                                                                                  |
| --- | ----------------------------------- | ------ | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P65 | **One-click game templates**        | M      | :fire: adoption | `npm create nape-game@latest` or StackBlitz templates: platformer starter (CharacterController + tilemap + camera), top-down car, ragdoll fighter, pinball. A running first game in 5 minutes = the most important onboarding element                 |
| P71 | **Save/Load + Replay demo**         | S      | docs            | Serialization (`spaceToJSON` / `spaceToBinary`) is a flagship feature with no demo in the grid. A snapshot-stack rewind demo (record N frames, scrub backwards, branch) showcases the API and doubles as the seed implementation for P69              |
| P72 | **`convexCast` demo**               | S      | docs            | `Space.convexCast` / `convexMultiCast` is a public API but invisible in the demo grid. A swept-shape hit-prediction demo (e.g. swung sword finding the first impact along its arc) makes the feature discoverable                                     |

### Tooling & Infrastructure

| #   | Priority                                 | Effort | Impact          | Why                                                                                                                                                                                                                              |
| --- | ---------------------------------------- | ------ | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P61 | **Bundle size reduction**                | S-M    | competitiveness | Close the 123 KB vs Phaser Box2D 65 KB gap (growing — bundle has gained ~36 KB across recent helper additions). Dead code audit, hot path optimization                                                                          |
| P69 | **Deterministic replay system**          | M      | features        | Input recording + playback on top of existing serialization + deterministic mode. Debug bug reproduction, multiplayer rollback foundation, shareable replays, deterministic regression tests — one feature that connects many others |

---

## Recommended Execution Order

### Phase 1 — Finish what's started + onboarding (next)

1. ~~**P44 Phase 2** — Ship `@newkrok/nape-pixi` npm package~~ ✅ done (0.1.0)
2. **P56** — Interactive playground (StackBlitz/CodeSandbox template, editable examples)

### Phase 2 — Wow-factor + ecosystem

3. **P58** — Phaser plugin/adapter (biggest community reach opportunity)
4. **P65** — One-click game templates (first game in 5 minutes)

### Phase 3 — Ecosystem expand

5. **P59** — React/R3F integration (growing market)

### Phase 4 — Polish & tooling

6. ~~**P62** — Particle system~~ ✅ done (`ParticleEmitter` helper)
7. **P71** — Save/Load + Replay demo (seeds P69)
8. **P72** — `convexCast` demo
9. **P69** — Deterministic replay system
10. **P61** — Bundle size reduction
11. **P29** — Continue test coverage push toward 80%
