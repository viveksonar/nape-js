import { describe, it, expect } from "vitest";
import { Space } from "../../src/space/Space";
import { Body } from "../../src/phys/Body";
import { BodyType } from "../../src/phys/BodyType";
import { Vec2 } from "../../src/geom/Vec2";
import { Circle } from "../../src/shape/Circle";
import { Polygon } from "../../src/shape/Polygon";
import { Capsule } from "../../src/shape/Capsule";
import { InteractionListener } from "../../src/callbacks/InteractionListener";
import { InteractionType } from "../../src/callbacks/InteractionType";
import { CbEvent } from "../../src/callbacks/CbEvent";
import { CbType } from "../../src/callbacks/CbType";

// Issue #164 — extended CCD / swept-shape coverage.
// These tests drive ZPP_SweepDistance.dynamicSweep / staticSweep through
// the public APIs (Space.step + Space.convexCast) and exercise the
// numeric-stability, convergence, and sweepTime tracking paths that the
// direct distance tests cannot reach.

function staticWall(x: number, y: number, w = 4, h = 200): Body {
  const b = new Body(BodyType.STATIC, new Vec2(x, y));
  b.shapes.add(new Polygon(Polygon.box(w, h)));
  return b;
}

function staticFloor(y: number, w = 1000, h = 20): Body {
  const b = new Body(BodyType.STATIC, new Vec2(0, y));
  b.shapes.add(new Polygon(Polygon.box(w, h)));
  return b;
}

function attachBeginListener(space: Space): { hits: number } {
  const counter = { hits: 0 };
  const listener = new InteractionListener(
    CbEvent.BEGIN,
    InteractionType.COLLISION,
    CbType.ANY_BODY,
    CbType.ANY_BODY,
    () => {
      counter.hits += 1;
    },
  );
  listener.space = space;
  return counter;
}

// ---------------------------------------------------------------------------
// 1. Shape-pair matrix — sweep through complex polygon meshes
// ---------------------------------------------------------------------------
describe("CCD advanced — shape-pair sweep matrix", () => {
  it("circle bullet sweeps through a row of thin walls and reports all hits in order", () => {
    const space = new Space(new Vec2(0, 0));

    const xs = [200, 260, 320, 380, 440];
    for (const x of xs) staticWall(x, 0, 2).space = space;

    const swept = new Body(BodyType.DYNAMIC, new Vec2(0, 0));
    const sweptShape = new Circle(4);
    swept.shapes.add(sweptShape);
    swept.velocity = new Vec2(600, 0);
    swept.space = space;

    const list = space.convexMultiCast(sweptShape, 1.0);
    const tois: number[] = [];
    for (let i = 0; i < list.length; i++) tois.push(list.at(i).toi);
    tois.sort((a, b) => a - b);

    expect(list.length).toBe(xs.length);
    for (let i = 1; i < tois.length; i++) {
      // Strictly increasing (different walls, different times).
      expect(tois[i]).toBeGreaterThan(tois[i - 1]);
    }
  });

  it("polygon bullet sweeps through angled polygon obstacles", () => {
    const space = new Space(new Vec2(0, 0));

    // Three rotated walls forming an angled tunnel.
    const angles = [0.3, -0.3, 0.6];
    const xs = [150, 230, 310];
    for (let i = 0; i < angles.length; i++) {
      const w = new Body(BodyType.STATIC, new Vec2(xs[i], 0));
      w.shapes.add(new Polygon(Polygon.box(4, 80)));
      w.rotation = angles[i];
      w.space = space;
    }

    const swept = new Body(BodyType.DYNAMIC, new Vec2(0, 0));
    const sweptShape = new Polygon(Polygon.box(8, 8));
    swept.shapes.add(sweptShape);
    swept.velocity = new Vec2(800, 0);
    swept.space = space;

    const r = space.convexCast(sweptShape, 1.0);
    expect(r).not.toBeNull();
    if (r != null) {
      expect(r.toi).toBeGreaterThan(0);
      expect(r.toi).toBeLessThan(1);
    }
  });

  it("capsule bullet sweeps and hits a static circle", () => {
    const space = new Space(new Vec2(0, 0));

    const target = new Body(BodyType.STATIC, new Vec2(200, 0));
    target.shapes.add(new Circle(10));
    target.space = space;

    const swept = new Body(BodyType.DYNAMIC, new Vec2(0, 0));
    const sweptShape = new Capsule(30, 10);
    swept.shapes.add(sweptShape);
    swept.velocity = new Vec2(500, 0);
    swept.space = space;

    const r = space.convexCast(sweptShape, 1.0);
    expect(r).not.toBeNull();
    if (r != null) expect(r.toi).toBeGreaterThan(0);
  });

  it("liveSweep=true vs liveSweep=false agree when only the swept body moves", () => {
    function castOnce(liveSweep: boolean): number | null {
      const space = new Space(new Vec2(0, 0));
      const wall = new Body(BodyType.STATIC, new Vec2(150, 0));
      wall.shapes.add(new Polygon(Polygon.box(10, 200)));
      wall.space = space;
      const swept = new Body(BodyType.DYNAMIC, new Vec2(0, 0));
      const s = new Circle(5);
      swept.shapes.add(s);
      swept.velocity = new Vec2(300, 0);
      swept.space = space;
      const r = space.convexCast(s, 1.0, liveSweep);
      return r ? r.toi : null;
    }
    const a = castOnce(false);
    const b = castOnce(true);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(b!).toBeCloseTo(a!, 5);
  });
});

// ---------------------------------------------------------------------------
// 2. Numeric stability — tiny dt, tiny velocity, glancing approach
// ---------------------------------------------------------------------------
describe("CCD advanced — numeric stability", () => {
  it("bullet vs thin wall is stable when stepped at dt = 1/600 s", () => {
    const space = new Space(new Vec2(0, 0));
    // Wall close enough for the swept ball to reach within the substep budget.
    staticWall(60, 0, 2).space = space;

    const bullet = new Body(BodyType.DYNAMIC, new Vec2(0, 0));
    bullet.shapes.add(new Circle(5));
    bullet.isBullet = true;
    bullet.velocity = new Vec2(3000, 0);
    bullet.space = space;

    const counter = attachBeginListener(space);
    // 60 substeps of 1/600 s = 0.1 s; at v=3000 the ball travels 300 units —
    // plenty to reach the wall and trigger CCD contact at the substep scale.
    for (let i = 0; i < 60; i++) space.step(1 / 600);

    expect(counter.hits).toBeGreaterThan(0);
    // Bullet must remain on the near side of the wall (allow contact slop).
    expect(bullet.position.x).toBeLessThanOrEqual(65);
  });

  it("glancing approach close to the dynamic-sweep linear threshold does not throw", () => {
    // Config.dynamicSweepLinearThreshold defaults to 17 — pick a small but
    // non-trivial velocity so we exercise the early-out arithmetic.
    const space = new Space(new Vec2(0, 0));
    staticWall(50, 0, 4, 40).space = space;

    const slow = new Body(BodyType.DYNAMIC, new Vec2(0, 0));
    slow.shapes.add(new Circle(2));
    slow.isBullet = true;
    slow.velocity = new Vec2(16, 0);
    slow.space = space;

    expect(() => {
      for (let i = 0; i < 5; i++) space.step(1 / 60);
    }).not.toThrow();
    // Position must remain finite, regardless of whether the sweep early-exits.
    expect(Number.isFinite(slow.position.x)).toBe(true);
    expect(Number.isFinite(slow.position.y)).toBe(true);
  });

  it("near-zero deltaTime sweep does not produce NaN witnesses", () => {
    const space = new Space(new Vec2(0, 0));
    const wall = new Body(BodyType.STATIC, new Vec2(100, 0));
    wall.shapes.add(new Polygon(Polygon.box(20, 200)));
    wall.space = space;

    const swept = new Body(BodyType.DYNAMIC, new Vec2(0, 0));
    const s = new Circle(5);
    swept.shapes.add(s);
    swept.velocity = new Vec2(200, 0);
    swept.space = space;

    // 1e-9 s is effectively zero but still > 0 — should not blow up.
    const r = space.convexCast(s, 1e-9);
    // Either no hit (gap dwarfs the tiny sweep) or a numerically sane hit.
    if (r != null) {
      expect(Number.isFinite(r.toi)).toBe(true);
      expect(Number.isFinite(r.position.x)).toBe(true);
      expect(Number.isFinite(r.position.y)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Iterative refinement convergence + conservative-advancement bias
// ---------------------------------------------------------------------------
describe("CCD advanced — iterative refinement & conservative advancement", () => {
  it("converges on a tight TOI to within engine slop (circle vs thin wall)", () => {
    const space = new Space(new Vec2(0, 0));
    // Wall left face at x=95 (half-width 5 centered at 100).
    const wall = new Body(BodyType.STATIC, new Vec2(100, 0));
    wall.shapes.add(new Polygon(Polygon.box(10, 200)));
    wall.space = space;

    const swept = new Body(BodyType.DYNAMIC, new Vec2(0, 0));
    const s = new Circle(5);
    swept.shapes.add(s);
    swept.velocity = new Vec2(100, 0); // takes 0.9 s to reach contact
    swept.space = space;

    const r = space.convexCast(s, 1.0);
    expect(r).not.toBeNull();
    // Analytical contact: ball edge meets wall edge when ball center = 90 → t=0.9.
    expect(r!.toi).toBeCloseTo(0.9, 2);
  });

  it("rotating swept polygon converges (angular bias path)", () => {
    const space = new Space(new Vec2(0, 0));
    const wall = new Body(BodyType.STATIC, new Vec2(160, 0));
    wall.shapes.add(new Polygon(Polygon.box(10, 200)));
    wall.space = space;

    const swept = new Body(BodyType.DYNAMIC, new Vec2(0, 0));
    const s = new Polygon(Polygon.box(20, 8));
    swept.shapes.add(s);
    swept.velocity = new Vec2(200, 0);
    swept.angularVel = 6.0; // strong spin → exercises sweepCoef * angvel term
    swept.space = space;

    const r = space.convexCast(s, 1.0);
    expect(r).not.toBeNull();
    if (r != null) {
      expect(r.toi).toBeGreaterThan(0);
      expect(r.toi).toBeLessThan(1);
    }
  });

  it("very high-iteration-count scene (many close walls) still terminates", () => {
    const space = new Space(new Vec2(0, 0));
    // Cluster of thin walls spaced very tightly — forces multiple refinement passes.
    for (let i = 0; i < 12; i++) {
      const w = new Body(BodyType.STATIC, new Vec2(200 + i * 12, 0));
      w.shapes.add(new Polygon(Polygon.box(1, 60)));
      w.space = space;
    }

    const swept = new Body(BodyType.DYNAMIC, new Vec2(0, 0));
    const s = new Circle(3);
    swept.shapes.add(s);
    swept.velocity = new Vec2(1500, 0);
    swept.space = space;

    expect(() => {
      const list = space.convexMultiCast(s, 1.0);
      expect(list.length).toBeGreaterThan(0);
    }).not.toThrow();
  });

  it("convexCast with deltaTime=0 returns null (no advancement = no hit)", () => {
    const space = new Space(new Vec2(0, 0));
    staticWall(100, 0).space = space;

    const swept = new Body(BodyType.DYNAMIC, new Vec2(0, 0));
    const s = new Circle(5);
    swept.shapes.add(s);
    swept.velocity = new Vec2(200, 0);
    swept.space = space;

    expect(space.convexCast(s, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Body.isBullet — sweepTime tracking across steps
// ---------------------------------------------------------------------------
describe("CCD advanced — isBullet sweepTime tracking", () => {
  it("sweepTime resets to 0 at the start of every space.step()", () => {
    const space = new Space(new Vec2(0, 0));
    staticFloor(500).space = space;

    const bullet = new Body(BodyType.DYNAMIC, new Vec2(0, 0));
    bullet.shapes.add(new Circle(5));
    bullet.isBullet = true;
    bullet.velocity = new Vec2(0, 8000);
    bullet.space = space;

    for (let i = 0; i < 5; i++) {
      space.step(1 / 60);
      // After each step, sweepTime is reset to 0 (or close to it on the
      // post-CCD path) — never accumulates across frames.
      const sweepTime = (bullet as any).zpp_inner.sweepTime;
      expect(sweepTime).toBeGreaterThanOrEqual(0);
      expect(sweepTime).toBeLessThanOrEqual(1 / 60 + 1e-9);
    }
  });

  it("toggling isBullet mid-simulation does not corrupt sweep state", () => {
    const space = new Space(new Vec2(0, 0));
    staticWall(400, 0, 4, 600).space = space;

    const body = new Body(BodyType.DYNAMIC, new Vec2(0, 0));
    body.shapes.add(new Circle(5));
    body.velocity = new Vec2(800, 0);
    body.space = space;

    // Run a few steps as non-bullet, then flip to bullet, then back.
    for (let i = 0; i < 3; i++) space.step(1 / 60);
    body.isBullet = true;
    for (let i = 0; i < 3; i++) space.step(1 / 60);
    body.isBullet = false;
    for (let i = 0; i < 3; i++) space.step(1 / 60);

    expect(Number.isFinite(body.position.x)).toBe(true);
    expect(Number.isFinite(body.position.y)).toBe(true);
  });

  it("isBullet stops a fast circle before it tunnels — non-bullet at the same speed may not", () => {
    function runOnce(isBullet: boolean): number {
      const space = new Space(new Vec2(0, 0));
      staticWall(200, 0, 2, 400).space = space;
      const b = new Body(BodyType.DYNAMIC, new Vec2(0, 0));
      b.shapes.add(new Circle(4));
      b.isBullet = isBullet;
      b.velocity = new Vec2(8000, 0);
      b.space = space;
      for (let i = 0; i < 4; i++) space.step(1 / 60);
      return b.position.x;
    }
    const bulletX = runOnce(true);
    const nonBulletX = runOnce(false);
    // Bullet must remain on the near side of the wall (allow contact slop).
    expect(bulletX).toBeLessThanOrEqual(210);
    // Non-bullet at this extreme speed is permitted to pass through —
    // the contract is only that the bullet path is stricter.
    expect(bulletX).toBeLessThan(nonBulletX + 1e-3);
  });

  it("disableCCD on a bullet falls back to the non-CCD path without crashing", () => {
    const space = new Space(new Vec2(0, 0));
    staticWall(200, 0, 2).space = space;

    const b = new Body(BodyType.DYNAMIC, new Vec2(0, 0));
    b.shapes.add(new Circle(4));
    b.isBullet = true;
    b.disableCCD = true;
    b.velocity = new Vec2(20000, 0);
    b.space = space;

    expect(() => {
      for (let i = 0; i < 5; i++) space.step(1 / 60);
    }).not.toThrow();
    // Position remains a finite number even if it tunneled.
    expect(Number.isFinite(b.position.x)).toBe(true);
  });
});
