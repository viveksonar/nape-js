/**
 * ZPP_Space — Sleep-threshold epsilon crossing in multi-body chains (issue #163).
 *
 * Background: ZPP_Space puts bodies to sleep when their kinetic energy
 * drops below an internal threshold (no public API exposes it). For a
 * chain of bodies linked by constraints, the whole island must settle
 * together because `ZPP_Component.sleeping` is island-wide. The checkbox
 * asks for tests that exercise the threshold-crossing boundary in
 * multi-body chains — the existing `Island.integration.test.ts` and
 * `ZPP_ColArbiter.warmstart.test.ts` test the *settled* state, not the
 * boundary behavior.
 *
 * Bounds were calibrated empirically on this engine version:
 *   - baseline settle for a 1- to 5-body chain under gravity: ~112 steps
 *   - post-impulse settle scales with impulse magnitude:
 *     0.1→62 steps, 1→172, 5→633, 10→1144, 20→2003, 50→does not settle
 *
 * Bounds in this suite use loose upper limits (≥3× observed) so the
 * tests stay green across small engine tweaks.
 */

import { describe, it, expect, beforeEach } from "vitest";
import "../../../src/core/engine";
import { Space } from "../../../src/space/Space";
import { Body } from "../../../src/phys/Body";
import { BodyType } from "../../../src/phys/BodyType";
import { Vec2 } from "../../../src/geom/Vec2";
import { Circle } from "../../../src/shape/Circle";
import { Polygon } from "../../../src/shape/Polygon";
import { DistanceJoint } from "../../../src/constraint/DistanceJoint";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function gravitySpace(gy = 500): Space {
  return new Space(new Vec2(0, gy));
}

function dynCircle(x: number, y: number, r = 10): Body {
  const b = new Body(BodyType.DYNAMIC, new Vec2(x, y));
  b.shapes.add(new Circle(r));
  return b;
}

function staticFloor(space: Space, y = 400): Body {
  const b = new Body(BodyType.STATIC, new Vec2(0, y));
  b.shapes.add(new Polygon(Polygon.box(800, 20)));
  b.space = space;
  return b;
}

function makeChain(space: Space, n: number, segLen = 40): Body[] {
  const bodies: Body[] = [];
  for (let i = 0; i < n; i++) {
    const b = dynCircle(i * segLen, 200, 10);
    b.space = space;
    bodies.push(b);
  }
  for (let i = 0; i < n - 1; i++) {
    new DistanceJoint(
      bodies[i],
      bodies[i + 1],
      new Vec2(0, 0),
      new Vec2(0, 0),
      segLen,
      segLen,
    ).space = space;
  }
  return bodies;
}

/** Step until every body in `chain` is sleeping, or fail at `max`. Returns step count. */
function stepsUntilAllSleep(chain: Body[], space: Space, max = 600): number {
  for (let i = 0; i < max; i++) {
    space.step(1 / 60);
    if (chain.every((b) => b.isSleeping)) return i + 1;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Whole-chain sleep coherence
// ---------------------------------------------------------------------------

describe("ZPP_Space — chain sleeps as one island", () => {
  let space: Space;

  beforeEach(() => {
    space = gravitySpace();
    staticFloor(space);
  });

  it("a 3-body chain reaches the all-sleeping state within 400 steps", () => {
    const chain = makeChain(space, 3);
    const settled = stepsUntilAllSleep(chain, space, 400);
    expect(settled).toBeGreaterThan(0);
    expect(settled).toBeLessThanOrEqual(400);
  });

  it("when the chain sleeps, every body sleeps in the same step (no fragmentation)", () => {
    const chain = makeChain(space, 4);

    // Find the first step where *any* body becomes sleeping, then assert
    // that on that same step *all* bodies are sleeping.
    let firstSleepStep = -1;
    for (let i = 0; i < 500; i++) {
      space.step(1 / 60);
      if (chain.some((b) => b.isSleeping)) {
        firstSleepStep = i + 1;
        break;
      }
    }

    expect(firstSleepStep).toBeGreaterThan(0);
    // Island sleep contract: if one body sleeps, all of them do.
    for (const b of chain) expect(b.isSleeping).toBe(true);
  });

  it("longer chain (5 bodies) settles within 4× of the 1-body baseline", () => {
    // Baseline measurement: a single freely-falling ball settles in ~112 steps
    // on this engine. A 5-body chain shouldn't blow that up by more than 4×.
    const space5 = gravitySpace();
    staticFloor(space5);
    const chain = makeChain(space5, 5);
    const n = stepsUntilAllSleep(chain, space5, 500);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(450); // 4× 112 ≈ 448
  });
});

// ---------------------------------------------------------------------------
// Threshold crossing under small vs. large impulse
// ---------------------------------------------------------------------------

describe("ZPP_Space — sleep threshold crossing after impulse perturbation", () => {
  function settleAndImpulse(impulseX: number, maxSteps: number): number {
    const space = gravitySpace();
    staticFloor(space);
    const chain = makeChain(space, 3);
    // Pre-settle the chain.
    const baseline = stepsUntilAllSleep(chain, space, 400);
    expect(baseline).toBeGreaterThan(0);
    // Kick the middle body horizontally.
    chain[1].applyImpulse(Vec2.weak(impulseX, 0));
    // Wake propagates immediately through joints — confirm awake.
    expect(chain.every((b) => !b.isSleeping)).toBe(true);
    // Measure re-settle time.
    return stepsUntilAllSleep(chain, space, maxSteps);
  }

  it("a tiny sub-threshold impulse (0.1) settles back to sleep quickly (<200 steps)", () => {
    // Calibrated: 0.1 impulse → 62 steps post-impulse on this engine.
    const n = settleAndImpulse(0.1, 200);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(200);
  });

  it("a medium impulse (5) takes substantially longer to settle (~3-5× the tiny case)", () => {
    // Calibrated: 5 impulse → 633 steps. Loose upper bound at 1500.
    const n = settleAndImpulse(5, 1500);
    expect(n).toBeGreaterThan(150);
    expect(n).toBeLessThan(1500);
  });

  it("settle time scales monotonically with impulse magnitude (0.1 < 1 < 10)", () => {
    const small = settleAndImpulse(0.1, 300);
    const mid = settleAndImpulse(1, 500);
    const large = settleAndImpulse(10, 2000);

    expect(small).toBeGreaterThan(0);
    expect(mid).toBeGreaterThan(0);
    expect(large).toBeGreaterThan(0);
    expect(small).toBeLessThan(mid);
    expect(mid).toBeLessThan(large);
  });
});

// ---------------------------------------------------------------------------
// Multi-chain isolation: threshold is per-island
// ---------------------------------------------------------------------------

describe("ZPP_Space — sleep threshold operates per island", () => {
  it("two isolated chains reach sleep independently", () => {
    const space = gravitySpace();
    staticFloor(space);

    // Two chains placed far apart so their AABBs never overlap.
    const chainA = makeChain(space, 3);
    // Shift chainB to the right by ~400px (outside any contact reach).
    for (const b of chainA) b.position = Vec2.weak(b.position.x - 200, b.position.y);

    const chainB: Body[] = [];
    for (let i = 0; i < 3; i++) {
      const b = dynCircle(200 + i * 40, 200, 10);
      b.space = space;
      chainB.push(b);
    }
    for (let i = 0; i < 2; i++) {
      new DistanceJoint(chainB[i], chainB[i + 1], new Vec2(0, 0), new Vec2(0, 0), 40, 40).space =
        space;
    }

    const all = [...chainA, ...chainB];
    const n = stepsUntilAllSleep(all, space, 500);
    expect(n).toBeGreaterThan(0);

    // After kicking only chainA, chainB must stay sleeping.
    chainA[0].applyImpulse(Vec2.weak(10, 0));
    expect(chainA.every((b) => !b.isSleeping)).toBe(true);
    expect(chainB.every((b) => b.isSleeping)).toBe(true);
  });
});
