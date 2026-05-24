/**
 * ZPP_Space — postStep / mid-step body wake-up from constraint impulses (issue #163).
 *
 * Background: ZPP_Space has no explicit `postStep()` method. Body wake-up
 * from constraint impulses happens through `wake_constraint()` (ZPP_Space.ts
 * ~5678) and the per-joint `wake_connected()` overrides (DistanceJoint,
 * PivotJoint, etc. — each wakes both endpoints). The checkbox tracks the
 * mid-step propagation path: a body wakes during the solver loop because a
 * joint impulse reaches it from a chained partner, not because user code
 * called `body.applyImpulse()` directly.
 *
 * Existing tests cover:
 * - `CallbackSystem.extended.test.ts:208` — WAKE fires after user-applied
 *   impulse (direct, not via constraint propagation).
 * - `EdgeCases.integration.test.ts:530` — SLEEP-then-direct-impulse pattern.
 *
 * Gap pinned by this suite:
 * - WAKE fires via constraint impulse propagation (no direct applyImpulse
 *   on the woken body).
 * - The whole connected island wakes together, not just the kicked endpoint.
 * - Mid-step `applyImpulse()` from a SLEEP callback wakes the body within
 *   the same step boundary.
 * - Two isolated chains: kicking one does NOT wake the other (no cross-
 *   island wake leakage).
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
import { BodyListener } from "../../../src/callbacks/BodyListener";
import { CbEvent } from "../../../src/callbacks/CbEvent";
import { CbType } from "../../../src/callbacks/CbType";

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

/** Step the space until `predicate` returns true or `maxSteps` is reached. */
function stepUntil(space: Space, predicate: () => boolean, maxSteps = 600): number {
  for (let i = 0; i < maxSteps; i++) {
    space.step(1 / 60);
    if (predicate()) return i + 1;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Wake propagation through a DistanceJoint
// ---------------------------------------------------------------------------

describe("ZPP_Space — wake propagation through a DistanceJoint", () => {
  let space: Space;

  beforeEach(() => {
    space = gravitySpace();
    staticFloor(space);
  });

  it("waking one endpoint via applyImpulse also wakes the chained partner", () => {
    const a = dynCircle(0, 200, 10);
    const b = dynCircle(40, 200, 10);
    a.space = space;
    b.space = space;
    const joint = new DistanceJoint(a, b, new Vec2(0, 0), new Vec2(0, 0), 40, 40);
    joint.space = space;

    // Let both settle and sleep.
    const sleepStep = stepUntil(space, () => a.isSleeping && b.isSleeping);
    expect(sleepStep).toBeGreaterThan(0);

    // Kick only `a`.
    a.applyImpulse(Vec2.weak(0, -800));

    // Both endpoints must be woken — wake_connected() runs through the joint.
    expect(a.isSleeping).toBe(false);
    expect(b.isSleeping).toBe(false);
  });

  it("WAKE listener fires for the partner that was NOT directly impulsed", () => {
    const a = dynCircle(0, 200, 10);
    const b = dynCircle(40, 200, 10);
    a.space = space;
    b.space = space;
    new DistanceJoint(a, b, new Vec2(0, 0), new Vec2(0, 0), 40, 40).space = space;

    // Settle and sleep.
    stepUntil(space, () => a.isSleeping && b.isSleeping);

    const wokenBodies = new Set<Body>();
    new BodyListener(CbEvent.WAKE, CbType.ANY_BODY, (cb) => {
      wokenBodies.add(cb.body);
    }).space = space;

    // Kick `a`. The WAKE listener must observe `b` waking too, even though
    // we never touched `b` directly.
    a.applyImpulse(Vec2.weak(0, -800));
    space.step(1 / 60);

    expect(wokenBodies.has(b)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Whole-chain wake
// ---------------------------------------------------------------------------

describe("ZPP_Space — multi-body chain wake propagation", () => {
  it("a 4-body chain wakes end-to-end when one endpoint is kicked", () => {
    const space = gravitySpace();
    staticFloor(space);

    const bodies: Body[] = [];
    for (let i = 0; i < 4; i++) {
      const b = dynCircle(i * 40, 200, 10);
      b.space = space;
      bodies.push(b);
    }
    // Link consecutive pairs.
    for (let i = 0; i < bodies.length - 1; i++) {
      new DistanceJoint(bodies[i], bodies[i + 1], new Vec2(0, 0), new Vec2(0, 0), 40, 40).space =
        space;
    }

    // Settle all four.
    const settled = stepUntil(space, () => bodies.every((b) => b.isSleeping));
    expect(settled).toBeGreaterThan(0);

    // Kick only the leftmost body.
    bodies[0].applyImpulse(Vec2.weak(0, -1500));

    // Every body in the chain must now be awake — the union-find island
    // groups them all, so `wake_connected()` cascades.
    for (const b of bodies) {
      expect(b.isSleeping).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Mid-step wake from a SLEEP-callback impulse (the inverse of the existing
// EdgeCases test: that one verifies physics post-impulse, we verify wake state).
// ---------------------------------------------------------------------------

describe("ZPP_Space — mid-step wake via SLEEP-callback applyImpulse", () => {
  it("applying impulse inside a SLEEP callback wakes the body within the same step", () => {
    const space = gravitySpace();
    staticFloor(space);
    const ball = dynCircle(0, 200, 10);
    ball.space = space;

    let wokeWithinSameStep = false;
    let sleepDetected = false;

    new BodyListener(CbEvent.SLEEP, CbType.ANY_BODY, (cb) => {
      if (cb.body !== ball || sleepDetected) return;
      sleepDetected = true;
      // The callback runs mid-step; applyImpulse must wake the body before
      // the step returns.
      ball.applyImpulse(Vec2.weak(0, -800));
      // Body must already be marked awake — wake_constraint sets the flag
      // synchronously inside applyImpulse.
      wokeWithinSameStep = !ball.isSleeping;
    }).space = space;

    stepUntil(space, () => sleepDetected);
    expect(sleepDetected).toBe(true);
    expect(wokeWithinSameStep).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Sleeping isolated body stays asleep (no spurious wake)
// ---------------------------------------------------------------------------

describe("ZPP_Space — no spurious wake on unconnected bodies", () => {
  it("two independent (unconnected) chains: kicking one does NOT wake the other", () => {
    const space = gravitySpace();
    staticFloor(space);

    // Chain A
    const a1 = dynCircle(-100, 200, 10);
    const a2 = dynCircle(-60, 200, 10);
    a1.space = space;
    a2.space = space;
    new DistanceJoint(a1, a2, new Vec2(0, 0), new Vec2(0, 0), 40, 40).space = space;

    // Chain B — placed far away so AABB queries cannot interact.
    const b1 = dynCircle(200, 200, 10);
    const b2 = dynCircle(240, 200, 10);
    b1.space = space;
    b2.space = space;
    new DistanceJoint(b1, b2, new Vec2(0, 0), new Vec2(0, 0), 40, 40).space = space;

    stepUntil(space, () => [a1, a2, b1, b2].every((b) => b.isSleeping));

    a1.applyImpulse(Vec2.weak(0, -800));

    // Chain A wakes; Chain B must stay asleep.
    expect(a1.isSleeping).toBe(false);
    expect(a2.isSleeping).toBe(false);
    expect(b1.isSleeping).toBe(true);
    expect(b2.isSleeping).toBe(true);
  });
});
