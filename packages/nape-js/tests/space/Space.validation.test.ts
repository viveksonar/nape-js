// Coverage push for Space: validation paths, visit* null guards, and
// interactionType branches the existing Space.coverage.test.ts skips.

import { describe, it, expect } from "vitest";
import { Space } from "../../src/space/Space";
import { Body } from "../../src/phys/Body";
import { BodyType } from "../../src/phys/BodyType";
import { Vec2 } from "../../src/geom/Vec2";
import { Circle } from "../../src/shape/Circle";
import { Polygon } from "../../src/shape/Polygon";

describe("Space — validation & null-guard paths", () => {
  describe("gravity setter", () => {
    it("rejects null", () => {
      const space = new Space(new Vec2(0, 0));
      expect(() => {
        space.gravity = null as unknown as Vec2;
      }).toThrow(/null/i);
    });

    it("disposes a weak Vec2 once assigned", () => {
      const space = new Space(new Vec2(0, 0));
      const g = Vec2.weak(0, 100);
      space.gravity = g;
      expect(g.zpp_disp).toBe(true);
      expect(space.gravity.y).toBeCloseTo(100);
    });
  });

  describe("subSteps setter", () => {
    it("rejects NaN", () => {
      const space = new Space(new Vec2(0, 0));
      expect(() => {
        space.subSteps = NaN;
      }).toThrow(/NaN/);
    });

    it("rejects values < 1", () => {
      const space = new Space(new Vec2(0, 0));
      expect(() => {
        space.subSteps = 0;
      }).toThrow(/at least 1/);
      expect(() => {
        space.subSteps = -3;
      }).toThrow();
    });

    it("floors fractional values", () => {
      const space = new Space(new Vec2(0, 0));
      space.subSteps = 3.9;
      expect(space.subSteps).toBe(3);
    });
  });

  describe("worldLinearDrag setter", () => {
    it("rejects NaN", () => {
      const space = new Space(new Vec2(0, 0));
      expect(() => {
        space.worldLinearDrag = NaN;
      }).toThrow(/NaN/);
    });

    it("accepts and round-trips a finite value", () => {
      const space = new Space(new Vec2(0, 0));
      space.worldLinearDrag = 0.7;
      expect(space.worldLinearDrag).toBeCloseTo(0.7);
    });
  });

  describe("worldAngularDrag setter", () => {
    it("rejects NaN", () => {
      const space = new Space(new Vec2(0, 0));
      expect(() => {
        space.worldAngularDrag = NaN;
      }).toThrow(/NaN/);
    });

    it("accepts and round-trips a finite value", () => {
      const space = new Space(new Vec2(0, 0));
      space.worldAngularDrag = 0.3;
      expect(space.worldAngularDrag).toBeCloseTo(0.3);
    });
  });

  describe("visitBodies", () => {
    it("rejects a null lambda", () => {
      const space = new Space(new Vec2(0, 0));
      expect(() => {
        space.visitBodies(null as unknown as (b: Body) => void);
      }).toThrow(/lambda/i);
    });

    it("calls the lambda for every body added to the space", () => {
      const space = new Space(new Vec2(0, 0));
      for (let i = 0; i < 5; i++) {
        const b = new Body(BodyType.DYNAMIC, new Vec2(i * 10, 0));
        b.shapes.add(new Circle(2));
        b.space = space;
      }
      let count = 0;
      space.visitBodies(() => {
        count++;
      });
      expect(count).toBe(5);
    });
  });

  describe("visitConstraints", () => {
    it("rejects a null lambda", () => {
      const space = new Space(new Vec2(0, 0));
      expect(() => {
        space.visitConstraints(null as unknown as (c: never) => void);
      }).toThrow(/lambda/i);
    });
  });

  describe("visitCompounds", () => {
    it("rejects a null lambda", () => {
      const space = new Space(new Vec2(0, 0));
      expect(() => {
        space.visitCompounds(null as unknown as (c: never) => void);
      }).toThrow(/lambda/i);
    });
  });

  describe("interactionType", () => {
    it("returns null for two static bodies' shapes (no possible interaction)", () => {
      const space = new Space(new Vec2(0, 0));
      const a = new Body(BodyType.STATIC, new Vec2(0, 0));
      const sa = new Polygon(Polygon.box(10, 10));
      a.shapes.add(sa);
      a.space = space;
      const b = new Body(BodyType.STATIC, new Vec2(20, 0));
      const sb = new Polygon(Polygon.box(10, 10));
      b.shapes.add(sb);
      b.space = space;
      expect(space.interactionType(sa, sb)).toBeNull();
    });

    it("returns null for two shapes belonging to the same body", () => {
      const space = new Space(new Vec2(0, 0));
      const b = new Body(BodyType.DYNAMIC, new Vec2(0, 0));
      const s1 = new Circle(5);
      const s2 = new Circle(5, new Vec2(20, 0));
      b.shapes.add(s1);
      b.shapes.add(s2);
      b.space = space;
      expect(space.interactionType(s1, s2)).toBeNull();
    });

    it("throws for shapes not part of a body", () => {
      const space = new Space(new Vec2(0, 0));
      const orphanA = new Circle(5);
      const orphanB = new Circle(5);
      expect(() => {
        space.interactionType(orphanA, orphanB);
      }).toThrow(/Body/);
    });
  });

  describe("step validation", () => {
    it("rejects NaN deltaTime", () => {
      const space = new Space(new Vec2(0, 0));
      expect(() => {
        space.step(NaN);
      }).toThrow(/NaN/);
    });

    it("rejects non-positive deltaTime", () => {
      const space = new Space(new Vec2(0, 0));
      expect(() => {
        space.step(0);
      }).toThrow();
      expect(() => {
        space.step(-1);
      }).toThrow();
    });

    it("rejects velocityIterations < 1", () => {
      const space = new Space(new Vec2(0, 0));
      expect(() => {
        space.step(1 / 60, 0, 10);
      }).toThrow(/velocity iteration/i);
    });

    it("rejects positionIterations < 1", () => {
      const space = new Space(new Vec2(0, 0));
      expect(() => {
        space.step(1 / 60, 10, 0);
      }).toThrow(/position iteration/i);
    });
  });

  describe("broadphase getter", () => {
    it("returns a Broadphase enum value matching the configured phase", () => {
      const space = new Space(new Vec2(0, 0));
      const bp = space.broadphase;
      expect(bp).not.toBeNull();
      // Re-reading should return a stable cached singleton
      expect(space.broadphase).toBe(bp);
    });
  });
});
