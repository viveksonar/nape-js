/**
 * ZPP_Space — Solver precision under high iteration counts (issue #163).
 *
 * Covers the `step(dt, velocityIterations, positionIterations)` accumulation
 * path with iteration counts well above the default (10/10). The existing
 * test suite never drives `step()` with non-default iteration counts beyond
 * argument validation, so the runtime precision behavior of the inner
 * `iterateVel` (ZPP_Space.ts ~9347–9419) and `iteratePos` (~9615–10100)
 * loops is untested.
 *
 * Contract pinned:
 * - High iteration counts must not corrupt body state (NaN / infinity).
 * - The solver must converge: increasing positionIterations strictly
 *   reduces penetration (or keeps it at the asymptote).
 * - Idle bodies stay idle: 100+ iterations on a calm scene must not
 *   inject spurious velocity (no per-iteration accumulation bug).
 * - Backward compatibility: doubling iterations from default does not
 *   meaningfully change rest position of a single ball on a floor.
 */

import { describe, it, expect } from "vitest";
import "../../../src/core/engine";
import { Space } from "../../../src/space/Space";
import { Body } from "../../../src/phys/Body";
import { BodyType } from "../../../src/phys/BodyType";
import { Vec2 } from "../../../src/geom/Vec2";
import { Circle } from "../../../src/shape/Circle";
import { Polygon } from "../../../src/shape/Polygon";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function gravitySpace(gy = 500): Space {
  return new Space(new Vec2(0, gy));
}

function staticFloor(space: Space, y = 300): Body {
  const b = new Body(BodyType.STATIC, new Vec2(0, y));
  b.shapes.add(new Polygon(Polygon.box(800, 20)));
  b.space = space;
  return b;
}

function dynBall(space: Space, x: number, y: number, r = 10): Body {
  const b = new Body(BodyType.DYNAMIC, new Vec2(x, y));
  b.shapes.add(new Circle(r));
  b.space = space;
  return b;
}

function maxPenetration(stack: Body[]): number {
  // Adjacent stacked balls: penetration is `2r - dy`. We measure the largest
  // penetration across consecutive pairs as a proxy for solver residual.
  let worst = 0;
  for (let i = 1; i < stack.length; i++) {
    const dy = stack[i].position.y - stack[i - 1].position.y;
    const r1 = (stack[i - 1].shapes.at(0) as Circle).radius;
    const r2 = (stack[i].shapes.at(0) as Circle).radius;
    const gap = Math.abs(dy) - (r1 + r2);
    if (gap < worst) worst = gap; // negative gap = penetration depth
  }
  return -worst; // positive number = penetration depth
}

// ---------------------------------------------------------------------------
// Iteration argument forwarding (defensive baseline)
// ---------------------------------------------------------------------------

describe("Space.step — iteration argument forwarding", () => {
  it("accepts and runs 100/100 iterations without throwing", () => {
    const space = gravitySpace();
    staticFloor(space);
    dynBall(space, 0, 100, 10);

    expect(() => space.step(1 / 60, 100, 100)).not.toThrow();
  });

  it("accepts asymmetric iteration counts (high vel / low pos and vice versa)", () => {
    const space = gravitySpace();
    staticFloor(space);
    dynBall(space, 0, 100, 10);

    expect(() => space.step(1 / 60, 100, 1)).not.toThrow();
    expect(() => space.step(1 / 60, 1, 100)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// No NaN/infinity injection
// ---------------------------------------------------------------------------

describe("Space.step — solver state stays finite at high iteration counts", () => {
  it("position and velocity remain finite for a single ball at rest after 100/100", () => {
    const space = gravitySpace();
    staticFloor(space);
    const ball = dynBall(space, 0, 100, 10);

    // Run a long simulation with 100/100 iterations.
    for (let i = 0; i < 60; i++) space.step(1 / 60, 100, 100);

    expect(Number.isFinite(ball.position.x)).toBe(true);
    expect(Number.isFinite(ball.position.y)).toBe(true);
    expect(Number.isFinite(ball.velocity.x)).toBe(true);
    expect(Number.isFinite(ball.velocity.y)).toBe(true);
    expect(Number.isFinite(ball.rotation)).toBe(true);
    expect(Number.isFinite(ball.angularVel)).toBe(true);
  });

  it("stack of 6 balls under gravity stays finite after 200/200 iterations × 120 steps", () => {
    const space = gravitySpace();
    staticFloor(space);
    const balls: Body[] = [];
    for (let i = 0; i < 6; i++) balls.push(dynBall(space, 0, 100 - i * 22, 10));

    for (let i = 0; i < 120; i++) space.step(1 / 60, 200, 200);

    for (const b of balls) {
      expect(Number.isFinite(b.position.x)).toBe(true);
      expect(Number.isFinite(b.position.y)).toBe(true);
      expect(Number.isFinite(b.velocity.x)).toBe(true);
      expect(Number.isFinite(b.velocity.y)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Convergence: higher positionIterations reduce penetration
// ---------------------------------------------------------------------------

describe("Space.step — positionIterations convergence", () => {
  it("higher positionIterations strictly reduce (or match) stack penetration", () => {
    // Build the same heavy stack twice — once with default iterations, once
    // with many — and compare the residual penetration after settling.
    function settle(positionIters: number): number {
      const space = gravitySpace();
      staticFloor(space);
      const stack: Body[] = [];
      for (let i = 0; i < 5; i++) stack.push(dynBall(space, 0, 280 - i * 22, 10));
      // 60 frames is enough to converge with 10 iters and is a strict upper
      // bound for the high-iteration run.
      for (let i = 0; i < 60; i++) space.step(1 / 60, 10, positionIters);
      return maxPenetration([staticFloor, ...stack].slice(1) as Body[]); // exclude the floor accessor
    }

    const pen10 = settle(10);
    const pen100 = settle(100);

    // The solver may already be at its asymptotic minimum with 10 iters; the
    // contract is that more iterations never make penetration worse.
    expect(pen100).toBeLessThanOrEqual(pen10 + 1e-6);
  });
});

// ---------------------------------------------------------------------------
// Calm scene: high iterations don't inject energy
// ---------------------------------------------------------------------------

describe("Space.step — idle bodies stay idle at high iteration counts", () => {
  it("a single floating body in zero gravity gains no speed across 100 iterations × 60 steps", () => {
    const space = new Space(new Vec2(0, 0));
    const ball = dynBall(space, 0, 0, 10);
    ball.velocity = Vec2.weak(0, 0);

    for (let i = 0; i < 60; i++) space.step(1 / 60, 100, 100);

    // No collisions, no forces — the solver must not inject any velocity.
    expect(Math.abs(ball.velocity.x)).toBeLessThan(1e-9);
    expect(Math.abs(ball.velocity.y)).toBeLessThan(1e-9);
    expect(Math.abs(ball.position.x)).toBeLessThan(1e-9);
    expect(Math.abs(ball.position.y)).toBeLessThan(1e-9);
  });

  it("static body remains exactly at its initial position regardless of iteration count", () => {
    const space = gravitySpace();
    const floor = staticFloor(space, 300);
    const startX = floor.position.x;
    const startY = floor.position.y;

    for (let i = 0; i < 30; i++) space.step(1 / 60, 100, 100);

    expect(floor.position.x).toBe(startX);
    expect(floor.position.y).toBe(startY);
  });
});

// ---------------------------------------------------------------------------
// Backward compatibility: doubling iterations doesn't shift rest position
// ---------------------------------------------------------------------------

describe("Space.step — rest position stability across iteration counts", () => {
  it("a single ball at rest on a floor settles to within 1px of the same y at 10/10 vs 100/100", () => {
    function restY(velIter: number, posIter: number): number {
      const space = gravitySpace();
      staticFloor(space, 300);
      const ball = dynBall(space, 0, 100, 10);
      for (let i = 0; i < 120; i++) space.step(1 / 60, velIter, posIter);
      return ball.position.y;
    }

    const yLow = restY(10, 10);
    const yHigh = restY(100, 100);

    // Both should settle to roughly the same y (floor top ~290 - radius 10 = ~280).
    expect(Math.abs(yHigh - yLow)).toBeLessThan(1);
  });
});
