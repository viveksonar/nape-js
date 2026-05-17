import { describe, it, expect } from "vitest";
import "../../../src/core/engine";
import { ZPP_SweepDistance } from "../../../src/native/geom/ZPP_SweepDistance";
import { ZPP_Geom } from "../../../src/native/geom/ZPP_Geom";
import { ZPP_Vec2 } from "../../../src/native/geom/ZPP_Vec2";
import { Space } from "../../../src/space/Space";
import { Body } from "../../../src/phys/Body";
import { BodyType } from "../../../src/phys/BodyType";
import { Vec2 } from "../../../src/geom/Vec2";
import { Circle } from "../../../src/shape/Circle";
import { Polygon } from "../../../src/shape/Polygon";
import { Capsule } from "../../../src/shape/Capsule";
import { Geom } from "../../../src/geom/Geom";

/** Helper to get validated ZPP shapes from bodies after a space step. */
function setupAndValidate(space: Space, bodies: Body[]): any[] {
  space.step(1 / 60);
  return bodies.map((b) => {
    const zpp = (b as any).zpp_inner.shapes.head.elt;
    ZPP_Geom.validateShape(zpp);
    return zpp;
  });
}

describe("ZPP_SweepDistance", () => {
  describe("static methods exist", () => {
    it("should have dynamicSweep method", () => {
      expect(typeof ZPP_SweepDistance.dynamicSweep).toBe("function");
    });

    it("should have staticSweep method", () => {
      expect(typeof ZPP_SweepDistance.staticSweep).toBe("function");
    });

    it("should have distanceBody method", () => {
      expect(typeof ZPP_SweepDistance.distanceBody).toBe("function");
    });

    it("should have distance method", () => {
      expect(typeof ZPP_SweepDistance.distance).toBe("function");
    });
  });

  describe("distance (circle-circle)", () => {
    it("should compute distance between separated circles", () => {
      const space = new Space(new Vec2(0, 0));

      const b1 = new Body(BodyType.STATIC, new Vec2(0, 0));
      b1.shapes.add(new Circle(10));
      b1.space = space;

      const b2 = new Body(BodyType.STATIC, new Vec2(30, 0));
      b2.shapes.add(new Circle(10));
      b2.space = space;

      const [zppS1, zppS2] = setupAndValidate(space, [b1, b2]);

      const w1 = new ZPP_Vec2();
      const w2 = new ZPP_Vec2();
      const axis = new ZPP_Vec2();

      const dist = ZPP_SweepDistance.distance(zppS1, zppS2, w1, w2, axis);

      // Two circles radius 10, centers 30 apart -> distance = 10
      expect(dist).toBeCloseTo(10, 1);
    });

    it("should return negative distance for overlapping circles", () => {
      const space = new Space(new Vec2(0, 0));

      const b1 = new Body(BodyType.STATIC, new Vec2(0, 0));
      b1.shapes.add(new Circle(10));
      b1.space = space;

      const b2 = new Body(BodyType.STATIC, new Vec2(5, 0));
      b2.shapes.add(new Circle(10));
      b2.space = space;

      const [zppS1, zppS2] = setupAndValidate(space, [b1, b2]);

      const w1 = new ZPP_Vec2();
      const w2 = new ZPP_Vec2();
      const axis = new ZPP_Vec2();

      const dist = ZPP_SweepDistance.distance(zppS1, zppS2, w1, w2, axis);

      // Two circles radius 10, centers 5 apart -> overlap = -15
      expect(dist).toBeCloseTo(-15, 1);
    });
  });

  describe("distance (polygon-circle)", () => {
    it("should compute distance between polygon and circle", () => {
      const space = new Space(new Vec2(0, 0));

      const b1 = new Body(BodyType.STATIC, new Vec2(0, 0));
      b1.shapes.add(new Polygon(Polygon.box(20, 20)));
      b1.space = space;

      const b2 = new Body(BodyType.STATIC, new Vec2(25, 0));
      b2.shapes.add(new Circle(5));
      b2.space = space;

      const [zppS1, zppS2] = setupAndValidate(space, [b1, b2]);

      const w1 = new ZPP_Vec2();
      const w2 = new ZPP_Vec2();
      const axis = new ZPP_Vec2();

      const dist = ZPP_SweepDistance.distance(zppS1, zppS2, w1, w2, axis);

      // Box half-width 10 at origin -> edge at x=10
      // Circle radius 5 at x=25 -> edge at x=20
      // Distance = 10
      expect(dist).toBeCloseTo(10, 1);
    });
  });

  describe("distance (polygon-polygon)", () => {
    it("should compute distance between separated polygons", () => {
      const space = new Space(new Vec2(0, 0));

      const b1 = new Body(BodyType.STATIC, new Vec2(0, 0));
      b1.shapes.add(new Polygon(Polygon.box(10, 10)));
      b1.space = space;

      const b2 = new Body(BodyType.STATIC, new Vec2(20, 0));
      b2.shapes.add(new Polygon(Polygon.box(10, 10)));
      b2.space = space;

      const [zppS1, zppS2] = setupAndValidate(space, [b1, b2]);

      const w1 = new ZPP_Vec2();
      const w2 = new ZPP_Vec2();
      const axis = new ZPP_Vec2();

      const dist = ZPP_SweepDistance.distance(zppS1, zppS2, w1, w2, axis);

      // Two boxes half-width 5 at 0 and 20 -> distance = 10
      expect(dist).toBeCloseTo(10, 1);
    });

    it("should return negative distance for overlapping polygons", () => {
      const space = new Space(new Vec2(0, 0));

      const b1 = new Body(BodyType.STATIC, new Vec2(0, 0));
      b1.shapes.add(new Polygon(Polygon.box(20, 20)));
      b1.space = space;

      const b2 = new Body(BodyType.STATIC, new Vec2(5, 0));
      b2.shapes.add(new Polygon(Polygon.box(20, 20)));
      b2.space = space;

      const [zppS1, zppS2] = setupAndValidate(space, [b1, b2]);

      const w1 = new ZPP_Vec2();
      const w2 = new ZPP_Vec2();
      const axis = new ZPP_Vec2();

      const dist = ZPP_SweepDistance.distance(zppS1, zppS2, w1, w2, axis);

      expect(dist).toBeLessThan(0);
    });
  });

  describe("distanceBody", () => {
    it("should compute minimum distance between two bodies", () => {
      const space = new Space(new Vec2(0, 0));

      const b1 = new Body(BodyType.STATIC, new Vec2(0, 0));
      b1.shapes.add(new Circle(10));
      b1.space = space;

      const b2 = new Body(BodyType.STATIC, new Vec2(30, 0));
      b2.shapes.add(new Circle(10));
      b2.space = space;

      space.step(1 / 60);

      const w1 = new ZPP_Vec2();
      const w2 = new ZPP_Vec2();

      const zppB1 = (b1 as any).zpp_inner;
      const zppB2 = (b2 as any).zpp_inner;

      const dist = ZPP_SweepDistance.distanceBody(zppB1, zppB2, w1, w2);

      expect(dist).toBeCloseTo(10, 1);
    });
  });

  describe("Geom.distance integration (verifies ZPP_SweepDistance)", () => {
    it("should match Geom.distance API for circle-circle", () => {
      const space = new Space(new Vec2(0, 0));

      const b1 = new Body(BodyType.STATIC, new Vec2(0, 0));
      b1.shapes.add(new Circle(10));
      b1.space = space;

      const b2 = new Body(BodyType.STATIC, new Vec2(30, 0));
      b2.shapes.add(new Circle(10));
      b2.space = space;

      const out1 = new Vec2(0, 0);
      const out2 = new Vec2(0, 0);

      const dist = Geom.distance(b1.shapes.at(0), b2.shapes.at(0), out1, out2);
      expect(dist).toBeCloseTo(10, 1);
    });

    it("should handle body-level distance", () => {
      const space = new Space(new Vec2(0, 0));

      const b1 = new Body(BodyType.STATIC, new Vec2(0, 0));
      b1.shapes.add(new Circle(5));
      b1.space = space;

      const b2 = new Body(BodyType.STATIC, new Vec2(0, 20));
      b2.shapes.add(new Circle(5));
      b2.space = space;

      const out1 = new Vec2(0, 0);
      const out2 = new Vec2(0, 0);

      const dist = Geom.distanceBody(b1, b2, out1, out2);
      expect(dist).toBeCloseTo(10, 1);
    });
  });

  // -----------------------------------------------------------------
  // Issue #164 — additional ZPP_SweepDistance edge-case coverage
  // -----------------------------------------------------------------

  describe("distance — degenerate input geometry", () => {
    it("returns negative distance when circles are exactly co-located (len == 0 axis fallback)", () => {
      const space = new Space(new Vec2(0, 0));

      const b1 = new Body(BodyType.STATIC, new Vec2(0, 0));
      b1.shapes.add(new Circle(4));
      b1.space = space;

      const b2 = new Body(BodyType.STATIC, new Vec2(0, 0));
      b2.shapes.add(new Circle(4));
      b2.space = space;

      const [zppS1, zppS2] = setupAndValidate(space, [b1, b2]);
      const w1 = new ZPP_Vec2();
      const w2 = new ZPP_Vec2();
      const axis = new ZPP_Vec2();

      const dist = ZPP_SweepDistance.distance(zppS1, zppS2, w1, w2, axis);

      // Centres collapsed: -(r1 + r2) = -8, and the axis fallback
      // sets nx=1, ny=0 (the only deterministic direction in that branch).
      expect(dist).toBeCloseTo(-8, 5);
      expect(axis.x).toBeCloseTo(1, 5);
      expect(axis.y).toBeCloseTo(0, 5);
    });

    it("handles a very small (effectively zero-radius) circle vs a polygon", () => {
      const space = new Space(new Vec2(0, 0));

      const box = new Body(BodyType.STATIC, new Vec2(0, 0));
      box.shapes.add(new Polygon(Polygon.box(20, 20)));
      box.space = space;

      // Engine forbids radius == 0 — use the smallest still-valid Circle.
      const tiny = new Body(BodyType.STATIC, new Vec2(30, 0));
      tiny.shapes.add(new Circle(0.0001));
      tiny.space = space;

      const [zppBox, zppTiny] = setupAndValidate(space, [box, tiny]);
      const w1 = new ZPP_Vec2();
      const w2 = new ZPP_Vec2();
      const axis = new ZPP_Vec2();

      const dist = ZPP_SweepDistance.distance(zppBox, zppTiny, w1, w2, axis);
      // Box edge at x=10, point ~at x=30 ⇒ distance ≈ 20.
      expect(dist).toBeCloseTo(20, 3);
    });

    it("handles parallel-edge polygon-polygon (axis-aligned box-vs-box face-on-face)", () => {
      const space = new Space(new Vec2(0, 0));

      const a = new Body(BodyType.STATIC, new Vec2(0, 0));
      a.shapes.add(new Polygon(Polygon.box(20, 10)));
      a.space = space;

      const b = new Body(BodyType.STATIC, new Vec2(35, 0));
      b.shapes.add(new Polygon(Polygon.box(20, 10)));
      b.space = space;

      const [zppA, zppB] = setupAndValidate(space, [a, b]);
      const w1 = new ZPP_Vec2();
      const w2 = new ZPP_Vec2();
      const axis = new ZPP_Vec2();

      const dist = ZPP_SweepDistance.distance(zppA, zppB, w1, w2, axis);
      // Box A edge at x=10, box B edge at x=25 ⇒ separation 15.
      expect(dist).toBeCloseTo(15, 3);
      // The separating axis must be (close to) the x-axis.
      expect(Math.abs(axis.x)).toBeCloseTo(1, 3);
      expect(Math.abs(axis.y)).toBeLessThan(1e-3);
    });

    it("respects upperBound early-out and leaves witness untouched when exceeded", () => {
      const space = new Space(new Vec2(0, 0));

      const b1 = new Body(BodyType.STATIC, new Vec2(0, 0));
      b1.shapes.add(new Circle(5));
      b1.space = space;

      const b2 = new Body(BodyType.STATIC, new Vec2(100, 0));
      b2.shapes.add(new Circle(5));
      b2.space = space;

      const [zppS1, zppS2] = setupAndValidate(space, [b1, b2]);
      const w1 = new ZPP_Vec2();
      const w2 = new ZPP_Vec2();
      const axis = new ZPP_Vec2();
      // Seed with sentinel values so we can detect "left untouched".
      w1.x = -1234;
      w1.y = -1234;
      w2.x = -1234;
      w2.y = -1234;
      axis.x = -1234;
      axis.y = -1234;

      // upperBound below the real gap (90) → distance is still computed and
      // returned, but witness points are NOT written for circle-circle.
      const dist = ZPP_SweepDistance.distance(zppS1, zppS2, w1, w2, axis, 10);
      expect(dist).toBeCloseTo(90, 3);
      expect(w1.x).toBe(-1234);
      expect(w2.x).toBe(-1234);
      expect(axis.x).toBe(-1234);
    });

    it("distance() with upperBound = null uses the default infinity sentinel", () => {
      const space = new Space(new Vec2(0, 0));

      const b1 = new Body(BodyType.STATIC, new Vec2(0, 0));
      b1.shapes.add(new Circle(3));
      b1.space = space;

      const b2 = new Body(BodyType.STATIC, new Vec2(20, 0));
      b2.shapes.add(new Circle(3));
      b2.space = space;

      const [zppS1, zppS2] = setupAndValidate(space, [b1, b2]);
      const w1 = new ZPP_Vec2();
      const w2 = new ZPP_Vec2();
      const axis = new ZPP_Vec2();

      // null upperBound is a legal value: implementation replaces it with 1e100.
      const dist = ZPP_SweepDistance.distance(
        zppS1,
        zppS2,
        w1,
        w2,
        axis,
        null as unknown as number,
      );
      expect(dist).toBeCloseTo(14, 3);
    });
  });

  describe("distanceBody — additional shape-pair matrix", () => {
    it("computes distance between a capsule and a polygon", () => {
      const space = new Space(new Vec2(0, 0));

      const cap = new Body(BodyType.STATIC, new Vec2(0, 0));
      cap.shapes.add(new Capsule(40, 10));
      cap.space = space;

      const box = new Body(BodyType.STATIC, new Vec2(60, 0));
      box.shapes.add(new Polygon(Polygon.box(20, 10)));
      box.space = space;

      space.step(1 / 60);

      const out1 = new Vec2(0, 0);
      const out2 = new Vec2(0, 0);
      const dist = Geom.distanceBody(cap, box, out1, out2);

      // Capsule extends to x≈20 (half-width 20), box left face at x=50 ⇒ gap ≈ 30.
      expect(dist).toBeGreaterThan(25);
      expect(dist).toBeLessThan(35);
    });

    it("returns the minimum across multiple shapes on the same body", () => {
      const space = new Space(new Vec2(0, 0));

      // Compound body: two circles separated horizontally; the closer one wins.
      const compound = new Body(BodyType.STATIC, new Vec2(0, 0));
      compound.shapes.add(new Circle(5, new Vec2(-50, 0)));
      compound.shapes.add(new Circle(5, new Vec2(50, 0)));
      compound.space = space;

      const probe = new Body(BodyType.STATIC, new Vec2(120, 0));
      probe.shapes.add(new Circle(5));
      probe.space = space;

      space.step(1 / 60);

      const out1 = new Vec2(0, 0);
      const out2 = new Vec2(0, 0);
      const dist = Geom.distanceBody(compound, probe, out1, out2);

      // Closer (right) circle edge x=55, probe edge x=115 ⇒ gap = 60.
      expect(dist).toBeCloseTo(60, 1);
    });
  });
});
