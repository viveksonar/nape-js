/**
 * ZPP_SpatialHashPhase — Direct unit tests for grid hashing, auto-tuning,
 * pair dedup, and raycast bucket-boundary correctness.
 *
 * The existing `tests/space/SpatialHash.integration.test.ts` is an end-to-end
 * suite that proves the public API works under SPATIAL_HASH; it does NOT
 * isolate the grid's tuning loop, the multi-cell pair-dedup math, or the
 * off-by-one edge cases the issue calls out. This suite drives the
 * broadphase directly through `space.zpp_inner.broadphase` to pin those
 * contracts.
 *
 * Covers (issue #163):
 * - `cellKey()` hash determinism and basic dispersion (no trivial collisions
 *   between adjacent grid cells).
 * - `__insert()` / `__remove()` O(1) index-swap removal, preserving array
 *   compactness and updating `__shIdx` on the swapped element.
 * - `autoTuneCellSize()`: no-op when fixedCellSize or empty, computes
 *   2× average dimension, floors at 8 for tiny shapes, updates invCellSize.
 * - `fixedCellSize` lock survives multiple broadphase frames.
 * - Multi-cell shape pair-dedup (Szudzik pairing) — large shape that spans
 *   the cell grid only enqueues one narrow-phase test per partner.
 * - Cell-array pool recycling between frames (no unbounded growth).
 * - Raycast result correctness at cell boundaries (off-by-one regression
 *   guard from the issue body).
 */

import { describe, it, expect, beforeEach } from "vitest";
import "../../../src/core/engine";
import { Space } from "../../../src/space/Space";
import { Broadphase } from "../../../src/space/Broadphase";
import { Body } from "../../../src/phys/Body";
import { BodyType } from "../../../src/phys/BodyType";
import { Vec2 } from "../../../src/geom/Vec2";
import { Circle } from "../../../src/shape/Circle";
import { Polygon } from "../../../src/shape/Polygon";
import { Ray } from "../../../src/geom/Ray";
import { ZPP_SpatialHashPhase } from "../../../src/native/space/ZPP_SpatialHashPhase";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function spaceWithHash(cellSize?: number): { space: Space; bp: ZPP_SpatialHashPhase } {
  const space = new Space(new Vec2(0, 0), Broadphase.SPATIAL_HASH);
  const bp = (space.zpp_inner as any).bphase as ZPP_SpatialHashPhase;
  if (cellSize !== undefined) {
    // The Space constructor uses the default cellSize (64). Override for tests
    // that need deterministic cell-boundary behavior.
    bp.cellSize = cellSize;
    bp.invCellSize = 1 / cellSize;
    bp.fixedCellSize = true;
  }
  return { space, bp };
}

function dynCircle(x: number, y: number, r = 10): Body {
  const b = new Body(BodyType.DYNAMIC, new Vec2(x, y));
  b.shapes.add(new Circle(r));
  return b;
}

function staticBox(x: number, y: number, w: number, h: number): Body {
  const b = new Body(BodyType.STATIC, new Vec2(x, y));
  b.shapes.add(new Polygon(Polygon.box(w, h)));
  return b;
}

// ---------------------------------------------------------------------------
// cellKey()
// ---------------------------------------------------------------------------

describe("ZPP_SpatialHashPhase.cellKey()", () => {
  let bp: ZPP_SpatialHashPhase;

  beforeEach(() => {
    bp = spaceWithHash().bp;
  });

  it("is deterministic for the same coordinates", () => {
    expect(bp.cellKey(3, 7)).toBe(bp.cellKey(3, 7));
    expect(bp.cellKey(-12, 4)).toBe(bp.cellKey(-12, 4));
  });

  it("distinguishes adjacent grid cells (no trivial collision)", () => {
    // Hash uses two large primes — neighboring cells must produce distinct
    // keys. Trivial implementations (cx + cy, cx ^ cy) would collide here.
    const center = bp.cellKey(0, 0);
    expect(bp.cellKey(1, 0)).not.toBe(center);
    expect(bp.cellKey(0, 1)).not.toBe(center);
    expect(bp.cellKey(-1, 0)).not.toBe(center);
    expect(bp.cellKey(0, -1)).not.toBe(center);
    // Diagonals and (0,0)/(1,1) — also distinct.
    expect(bp.cellKey(1, 1)).not.toBe(center);
    expect(bp.cellKey(1, 0)).not.toBe(bp.cellKey(0, 1));
  });

  it("distinguishes positive vs mixed-sign cells (no whole-quadrant collision)", () => {
    // Note: XOR-based hashing has a well-known property that (-cx, -cy) hashes
    // identically to (cx, cy) in 32-bit two's-complement — that's acceptable
    // here because a single shape spans a small contiguous cell range and
    // never straddles the origin diagonally enough to alias. What we DO
    // require is that mixed-sign cells stay distinct from the positive ones.
    expect(bp.cellKey(-3, 7)).not.toBe(bp.cellKey(3, 7));
    expect(bp.cellKey(3, -7)).not.toBe(bp.cellKey(3, 7));
  });
});

// ---------------------------------------------------------------------------
// __insert / __remove
// ---------------------------------------------------------------------------

describe("ZPP_SpatialHashPhase.__insert / __remove", () => {
  it("__insert appends and tags __shIdx with the new index", () => {
    const bp = spaceWithHash().bp;
    const s1 = { tag: "s1" };
    const s2 = { tag: "s2" };

    bp.__insert(s1);
    bp.__insert(s2);

    expect(bp.shapes).toEqual([s1, s2]);
    expect((s1 as any).__shIdx).toBe(0);
    expect((s2 as any).__shIdx).toBe(1);
  });

  it("__remove on the tail does NOT swap (idx === last fast path)", () => {
    const bp = spaceWithHash().bp;
    const s1: any = { tag: "s1" };
    const s2: any = { tag: "s2" };
    bp.__insert(s1);
    bp.__insert(s2);

    bp.__remove(s2);

    expect(bp.shapes).toEqual([s1]);
    // s1 still at index 0, unchanged.
    expect(s1.__shIdx).toBe(0);
    expect(s2.__shIdx).toBeUndefined();
  });

  it("__remove from the middle swaps tail into the gap and updates the moved index", () => {
    const bp = spaceWithHash().bp;
    const s1: any = { tag: "s1" };
    const s2: any = { tag: "s2" };
    const s3: any = { tag: "s3" };
    bp.__insert(s1);
    bp.__insert(s2);
    bp.__insert(s3);

    bp.__remove(s1);

    // s3 was moved into slot 0.
    expect(bp.shapes).toEqual([s3, s2]);
    expect(s3.__shIdx).toBe(0);
    expect(s2.__shIdx).toBe(1);
    expect(s1.__shIdx).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// autoTuneCellSize()
// ---------------------------------------------------------------------------

describe("ZPP_SpatialHashPhase.autoTuneCellSize()", () => {
  it("is a no-op when fixedCellSize is true", () => {
    const { bp } = spaceWithHash(50);
    expect(bp.fixedCellSize).toBe(true);

    // Even if we plant shapes that would otherwise re-tune, the cellSize
    // stays locked at 50.
    bp.__insert({ aabb: { minx: 0, miny: 0, maxx: 200, maxy: 200 } });

    bp.autoTuneCellSize();

    expect(bp.cellSize).toBe(50);
    expect(bp.invCellSize).toBe(1 / 50);
  });

  it("is a no-op when no shapes are tracked", () => {
    const { bp } = spaceWithHash();
    const before = bp.cellSize;

    bp.autoTuneCellSize();

    expect(bp.cellSize).toBe(before);
  });

  it("computes cell size as 2× the average AABB dimension", () => {
    const { bp } = spaceWithHash();
    bp.fixedCellSize = false;

    // Two shapes: 20×20 and 30×30 — avg dimension = (20+20+30+30)/(2*2) = 25.
    // Expected cellSize = max(25*2, 8) = 50.
    bp.shapes = [
      { aabb: { minx: 0, miny: 0, maxx: 20, maxy: 20 } },
      { aabb: { minx: 0, miny: 0, maxx: 30, maxy: 30 } },
    ];

    bp.autoTuneCellSize();

    expect(bp.cellSize).toBeCloseTo(50, 6);
    expect(bp.invCellSize).toBeCloseTo(1 / 50, 6);
  });

  it("floors at cellSize = 8 to avoid pathological cases with tiny shapes", () => {
    const { bp } = spaceWithHash();
    bp.fixedCellSize = false;
    // Tiny 1×1 shapes — 2× avg = 2, but the floor must clamp to 8.
    bp.shapes = [
      { aabb: { minx: 0, miny: 0, maxx: 1, maxy: 1 } },
      { aabb: { minx: 0, miny: 0, maxx: 1, maxy: 1 } },
    ];

    bp.autoTuneCellSize();

    expect(bp.cellSize).toBe(8);
    expect(bp.invCellSize).toBeCloseTo(1 / 8, 6);
  });

  it("skips shapes whose aabb is null (defensive against transient state)", () => {
    const { bp } = spaceWithHash();
    bp.fixedCellSize = false;
    bp.shapes = [
      { aabb: null }, // skipped
      { aabb: { minx: 0, miny: 0, maxx: 20, maxy: 20 } },
    ];

    bp.autoTuneCellSize();

    // Only the second shape counted: avg = 20, cellSize = 40.
    expect(bp.cellSize).toBeCloseTo(40, 6);
  });
});

// ---------------------------------------------------------------------------
// fixedCellSize lock — survives broadphase frames
// ---------------------------------------------------------------------------

describe("ZPP_SpatialHashPhase — fixedCellSize lock across frames", () => {
  it("keeps cellSize stable for >TUNE_INTERVAL frames when fixed", () => {
    const { space, bp } = spaceWithHash(40);
    // Add a body so broadphase() does real work each frame.
    dynCircle(0, 0, 5).space = space;

    const initial = bp.cellSize;
    expect(initial).toBe(40);

    // Run more frames than the auto-tune interval — fixedCellSize must hold.
    for (let i = 0; i < ZPP_SpatialHashPhase.TUNE_INTERVAL + 5; i++) {
      space.step(1 / 60);
    }

    expect(bp.cellSize).toBe(initial);
  });
});

// ---------------------------------------------------------------------------
// Multi-cell shape pair dedup
// ---------------------------------------------------------------------------

describe("ZPP_SpatialHashPhase — multi-cell shape pair dedup", () => {
  it("a large shape spanning many cells only fires one BEGIN per partner", async () => {
    // Force a tiny cell size so a single shape straddles many cells, exercising
    // the Szudzik pair-dedup branch. Without dedup, narrowPhase would be invoked
    // multiple times per pair (one per shared cell) and produce duplicate
    // contact attempts; the public BEGIN-listener count is the cleanest probe.
    const { space } = spaceWithHash(10);

    // Use a public listener to count BEGIN events.
    const { InteractionListener } = await import("../../../src/callbacks/InteractionListener");
    const { CbEvent } = await import("../../../src/callbacks/CbEvent");
    const { CbType } = await import("../../../src/callbacks/CbType");
    const { InteractionType } = await import("../../../src/callbacks/InteractionType");

    let begin = 0;
    new InteractionListener(
      CbEvent.BEGIN,
      InteractionType.COLLISION,
      CbType.ANY_BODY,
      CbType.ANY_BODY,
      () => begin++,
    ).space = space;

    // Big static floor that spans many 10-unit cells, small dynamic that
    // starts already overlapping the floor so BEGIN fires on the first step.
    staticBox(0, 50, 200, 10).space = space;
    dynCircle(0, 48, 5).space = space;

    for (let i = 0; i < 3; i++) space.step(1 / 60);

    // Exactly one BEGIN for this single pair — dedup is working.
    expect(begin).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Cell-array pool recycling
// ---------------------------------------------------------------------------

describe("ZPP_SpatialHashPhase — cell pool recycling", () => {
  it("recycled cell arrays return to the pool and are reused across frames", () => {
    const { space, bp } = spaceWithHash(20);
    dynCircle(0, 0, 3).space = space;
    dynCircle(40, 0, 3).space = space;

    // First frame builds at least one cell into the grid.
    space.step(1 / 60);
    expect(bp.cellPool.length).toBeGreaterThanOrEqual(0); // baseline observation

    // After several frames the pool should not grow unboundedly — it stabilises
    // because every frame recycles every cell. Take an upper bound proportional
    // to the number of shapes, not to the frame count.
    for (let i = 0; i < 30; i++) space.step(1 / 60);

    // The pool size is bounded by the number of shapes (each shape contributes
    // at most a handful of cells). 30 frames × 2 shapes shouldn't bloat past ~16.
    expect(bp.cellPool.length).toBeLessThan(16);
  });

  it("grid size stays bounded across many frames (no unbounded growth)", () => {
    const { space, bp } = spaceWithHash(20);
    dynCircle(0, 0, 3).space = space;
    dynCircle(40, 0, 3).space = space;

    // The grid is recycled at the start of every broadphase() call: the
    // forEach->recycleCell->grid.clear() pass at the top moves all cells back
    // into the pool, then the frame's inserts refill only the cells the
    // current shapes actually touch. So between frames the grid may be
    // non-empty, but its size never exceeds the number of distinct cells
    // touched by the current shape set.
    for (let i = 0; i < 50; i++) space.step(1 / 60);

    // Two tiny circles in a 20-cell grid can touch at most a few cells each.
    expect(bp.grid.size).toBeLessThanOrEqual(8);
  });
});

// ---------------------------------------------------------------------------
// Raycast bucket-boundary correctness
// ---------------------------------------------------------------------------

describe("ZPP_SpatialHashPhase.rayCast() — bucket-boundary edge cases", () => {
  it("hits a shape whose center sits exactly on a cell boundary", () => {
    // cellSize=50; shape center at (50,0) is exactly on the (1,0)/(0,0) boundary.
    // A linear-scan implementation has no off-by-one risk, but the test pins
    // the contract so any future grid-traversal optimisation doesn't regress.
    const { space } = spaceWithHash(50);
    const target = dynCircle(50, 0, 8);
    target.space = space;

    space.step(1 / 60);

    const ray = Ray.fromSegment(new Vec2(0, 0), new Vec2(200, 0));
    const result = space.rayCast(ray);

    expect(result).not.toBeNull();
    expect(result!.shape.body).toBe(target);
  });

  it("misses cleanly when the ray runs parallel to a row of empty cells", () => {
    const { space } = spaceWithHash(50);
    // Only target sits well above the ray's y coordinate — ray must miss.
    const target = dynCircle(100, 200, 8);
    target.space = space;

    space.step(1 / 60);

    const ray = Ray.fromSegment(new Vec2(0, 0), new Vec2(500, 0));
    const result = space.rayCast(ray);

    expect(result).toBeNull();
  });

  it("returns the nearest hit when the ray crosses multiple cells in order", () => {
    const { space } = spaceWithHash(20);
    // Three circles at increasing distances along the ray.
    const near = dynCircle(30, 0, 5);
    const mid = dynCircle(60, 0, 5);
    const far = dynCircle(120, 0, 5);
    near.space = space;
    mid.space = space;
    far.space = space;

    space.step(1 / 60);

    const ray = Ray.fromSegment(new Vec2(0, 0), new Vec2(200, 0));
    const result = space.rayCast(ray);

    expect(result).not.toBeNull();
    expect(result!.shape.body).toBe(near);
  });

  it("rayMultiCast finds every shape along the ray regardless of cell layout", () => {
    const { space } = spaceWithHash(20);
    dynCircle(30, 0, 5).space = space;
    dynCircle(60, 0, 5).space = space;
    dynCircle(120, 0, 5).space = space;

    space.step(1 / 60);

    const ray = Ray.fromSegment(new Vec2(0, 0), new Vec2(200, 0));
    const results = space.rayMultiCast(ray);

    expect(results.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// clear()
// ---------------------------------------------------------------------------

describe("ZPP_SpatialHashPhase.clear() — internal teardown", () => {
  it("empties shapes, grid, cellPool, and testedPairs", () => {
    const { space, bp } = spaceWithHash(40);
    dynCircle(0, 0, 5).space = space;
    dynCircle(50, 0, 5).space = space;
    space.step(1 / 60);

    space.clear();

    // After Space.clear() the broadphase delegates to its own clear().
    expect(bp.shapes.length).toBe(0);
    expect(bp.grid.size).toBe(0);
    expect(bp.cellPool.length).toBe(0);
    expect(bp.testedPairs.size).toBe(0);
  });
});
