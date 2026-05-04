# nape-js — Roadmap

## Completed Items

Done: P21-P28, P30-P33, P35, P37-P43, P44, P45-P48, P50-P55, P57, P60, P62, P63, P64, P66-P68, P69, P70, P71.
Cancelled: P34 (tree shaking — architectural limit), P36 (server demos — superseded by P52), P49 (ECS adapter — trivial pattern).

Reference docs for shipped features (don't duplicate here):

| Feature                       | Where it's documented                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `@newkrok/nape-pixi` (P44)    | [`packages/nape-pixi/README.md`](packages/nape-pixi/README.md)                                                                              |
| Tilemap helper (P60)          | [README](README.md) · [`llms.txt`](packages/nape-js/llms.txt) · [Cookbook](docs/guides/cookbook.md)                                         |
| `RadialGravityField` (P70)    | [README](README.md) · [`llms.txt`](packages/nape-js/llms.txt)                                                                               |
| `ParticleEmitter` (P62)       | [README](README.md) · [`llms.txt`](packages/nape-js/llms.txt) · [Cookbook](docs/guides/cookbook.md#particle-emitter-bullets-sparks-debris)  |
| Replay system (P69)           | [`docs/guides/replay-guide.md`](docs/guides/replay-guide.md) · [Cookbook](docs/guides/cookbook.md#replay--recording-deterministic-playback) |
| Save/Load + Rewind demo (P71) | [Cookbook](docs/guides/cookbook.md#serialization-save--load) · `docs/demos/save-load-rewind.js`                                             |

---

## Strategy

The engine is feature-rich (~50 demos, fluid sim, replay, character controller,
helpers — beyond what the leading JS competitors ship). External adoption
signal is still weak: 0 issues / PRs from non-maintainers, ~3 trivial public
references via GitHub code search. The npm download counter is dominated by
CI / mirrors / scanners, not real users.

→ The next investments are weighted toward **discoverability and onboarding
friction**, not feature depth. Demo-front growth is paused — the demo grid is
already saturated.

---

## Active Priorities

| #   | Priority                     | Effort | Impact          | Notes                                                                                                                                                              |
| --- | ---------------------------- | ------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P56 | **Interactive playground**   | S-M    | :fire: adoption | StackBlitz/CodeSandbox template + editable examples. Smallest effort, biggest friction cut — current CodePen flow is read-mostly. Should land before P58/P65       |
| P65 | **One-click game templates** | M      | :fire: adoption | `npm create nape-game@latest`: platformer (CharacterController + tilemap + camera), top-down car, ragdoll fighter, pinball. "Running first game in 5 min"          |
| P72 | **`convexCast` demo**        | S      | docs            | `Space.convexCast` / `convexMultiCast` is public API but invisible in the demo grid. A swept-shape hit-prediction demo (e.g. swung sword) makes it discoverable    |
| P61 | **Bundle size reduction**    | S-M    | competitiveness | 123 KB vs Phaser Box2D 65 KB, gap is widening (+~36 KB from recent helpers). Real adoption blocker. Dead-code audit, hot-path review, helper opt-in re-export plan |
| P58 | **Phaser plugin/adapter**    | M      | :fire: adoption | #1 JS game framework. Worth doing only after P56 + P65 — adapters need a working playground story to demo against                                                  |
| P59 | **React/R3F integration**    | M      | adoption        | `@react-three/rapier`-style package for the React gamedev community. After P58                                                                                     |
| P29 | Test coverage → 80%          | L      | safety          | :diamonds: ~72% statements (5684 tests). Background work, not blocking anything                                                                                    |

---

## Long-Tail / Speculative

Not blocking anything; revisit only when a concrete user request justifies the cost.

| #   | Priority                          | Effort | Why deferred                                                                                                                                                            |
| --- | --------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P73 | Replay delta encoding             | M      | Snapshot keyframes are ~150–300 B/body. No one has reported the size as a pain point. Worth ~5–10× shrink, but the demand is hypothetical                               |
| P74 | Cross-platform deterministic math | L      | Same-platform determinism already works. Fixed-point hot path (Q32.32) is only needed for true P2P rollback netcode — no concrete user case yet, large engine-wide cost |

---

## Recommended Execution Order

1. **P56** — Interactive playground (unblocks P65 and the adapter onboarding stories)
2. **P65** — One-click game templates
3. **P72** — `convexCast` demo (small, ships the visibility win quickly)
4. **P61** — Bundle size reduction
5. **P58** — Phaser plugin/adapter
6. **P59** — React/R3F integration
7. **P29** — Continue test coverage push toward 80% (background)
8. (Defer **P73** and **P74** until a concrete user request appears)
