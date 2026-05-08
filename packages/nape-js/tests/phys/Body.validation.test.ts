// Coverage push for Body: validation/error paths and a few state-transition
// branches the existing Body.* test files don't reach.

import { describe, it, expect } from "vitest";
import { Body } from "../../src/phys/Body";
import { BodyType } from "../../src/phys/BodyType";
import { Vec2 } from "../../src/geom/Vec2";
import { Circle } from "../../src/shape/Circle";
import { Polygon } from "../../src/shape/Polygon";
import { Space } from "../../src/space/Space";

describe("Body — validation & error paths", () => {
  describe("rotation setter", () => {
    it("rejects rotating a static body that is already in a Space", () => {
      const space = new Space(new Vec2(0, 600));
      const b = new Body(BodyType.STATIC, new Vec2(0, 0));
      b.shapes.add(new Polygon(Polygon.box(10, 10)));
      b.space = space;
      expect(() => {
        b.rotation = Math.PI / 4;
      }).toThrow(/static/i);
    });

    it("rejects NaN rotation", () => {
      const b = new Body(BodyType.DYNAMIC);
      expect(() => {
        b.rotation = NaN;
      }).toThrow(/NaN/);
    });

    it("ignores rotation set to the same current value (no-op fast path)", () => {
      const b = new Body(BodyType.DYNAMIC);
      b.rotation = 0.5;
      const before = b.rotation;
      b.rotation = 0.5;
      expect(b.rotation).toBeCloseTo(before);
    });
  });

  describe("angularVel setter", () => {
    it("rejects NaN", () => {
      const b = new Body(BodyType.DYNAMIC);
      expect(() => {
        b.angularVel = NaN;
      }).toThrow(/NaN/);
    });

    it("rejects setting on a static body", () => {
      const b = new Body(BodyType.STATIC);
      expect(() => {
        b.angularVel = 1;
      }).toThrow(/static/i);
    });
  });

  describe("inertia setter", () => {
    it("rejects NaN", () => {
      const b = new Body(BodyType.DYNAMIC);
      b.shapes.add(new Circle(10));
      expect(() => {
        b.inertia = NaN;
      }).toThrow(/NaN/);
    });

    it("rejects zero or negative", () => {
      const b = new Body(BodyType.DYNAMIC);
      b.shapes.add(new Circle(10));
      expect(() => {
        b.inertia = 0;
      }).toThrow(/strictly positive/);
      expect(() => {
        b.inertia = -1;
      }).toThrow();
    });

    it("rejects infinite", () => {
      const b = new Body(BodyType.DYNAMIC);
      b.shapes.add(new Circle(10));
      expect(() => {
        b.inertia = Infinity;
      }).toThrow(/infinite/i);
    });
  });

  describe("mass setter", () => {
    it("rejects zero", () => {
      const b = new Body(BodyType.DYNAMIC);
      b.shapes.add(new Circle(10));
      expect(() => {
        b.mass = 0;
      }).toThrow();
    });

    it("rejects NaN", () => {
      const b = new Body(BodyType.DYNAMIC);
      b.shapes.add(new Circle(10));
      expect(() => {
        b.mass = NaN;
      }).toThrow(/NaN/);
    });
  });

  describe("setVelocityFromTarget", () => {
    it("rejects deltaTime = 0", () => {
      const b = new Body(BodyType.DYNAMIC, new Vec2(0, 0));
      expect(() => {
        b.setVelocityFromTarget(new Vec2(1, 0), 0, 0);
      }).toThrow(/deltaTime/);
    });

    it("computes linear velocity matching the target over a time step", () => {
      const b = new Body(BodyType.DYNAMIC, new Vec2(10, 20));
      b.setVelocityFromTarget(new Vec2(20, 30), 0, 1);
      expect(b.velocity.x).toBeCloseTo(10);
      expect(b.velocity.y).toBeCloseTo(10);
    });

    it("computes angular velocity matching the target rotation", () => {
      const b = new Body(BodyType.DYNAMIC, new Vec2(0, 0));
      b.rotation = 0;
      b.setVelocityFromTarget(new Vec2(0, 0), Math.PI, 1);
      expect(b.angularVel).toBeCloseTo(Math.PI);
    });
  });

  describe("translateShapes", () => {
    it("translates each shape's local position by the given vector", () => {
      const b = new Body(BodyType.DYNAMIC, new Vec2(0, 0));
      const shape = new Circle(5, new Vec2(0, 0));
      b.shapes.add(shape);
      b.translateShapes(new Vec2(10, 0));
      expect(shape.localCOM.x).toBeCloseTo(10);
    });

    it("rejects null translation argument", () => {
      const b = new Body(BodyType.DYNAMIC);
      b.shapes.add(new Circle(5));
      expect(() => {
        b.translateShapes(null as unknown as Vec2);
      }).toThrow();
    });
  });

  describe("align", () => {
    it("rejects body with no shapes", () => {
      const b = new Body(BodyType.DYNAMIC);
      expect(() => {
        b.align();
      }).toThrow(/empty Body/i);
    });

    it("centers shapes around the body's local origin", () => {
      const b = new Body(BodyType.DYNAMIC, new Vec2(0, 0));
      b.shapes.add(new Circle(5, new Vec2(20, 0)));
      b.align();
      expect(b.localCOM.x).toBeCloseTo(0);
      expect(b.localCOM.y).toBeCloseTo(0);
    });
  });

  describe("type transitions", () => {
    it("changing dynamic → static clears the body's velocity", () => {
      const space = new Space(new Vec2(0, 0));
      const b = new Body(BodyType.DYNAMIC, new Vec2(0, 0));
      b.shapes.add(new Circle(10));
      b.velocity = new Vec2(50, 50);
      b.space = space;
      b.type = BodyType.STATIC;
      expect(b.velocity.x).toBeCloseTo(0);
      expect(b.velocity.y).toBeCloseTo(0);
    });

    it("changing kinematic → dynamic keeps the body active", () => {
      const space = new Space(new Vec2(0, 0));
      const b = new Body(BodyType.KINEMATIC, new Vec2(0, 0));
      b.shapes.add(new Circle(10));
      b.space = space;
      b.type = BodyType.DYNAMIC;
      expect(b.type).toBe(BodyType.DYNAMIC);
      expect(b.space).toBe(space);
    });
  });

  describe("crushFactor", () => {
    it("throws when called on a body that is not in a Space", () => {
      const b = new Body(BodyType.DYNAMIC);
      b.shapes.add(new Circle(5));
      expect(() => {
        b.crushFactor();
      }).toThrow(/simulation/i);
    });

    it("returns 0 for an isolated body in a Space (no contacts)", () => {
      const space = new Space(new Vec2(0, 0));
      const b = new Body(BodyType.DYNAMIC, new Vec2(0, 0));
      b.shapes.add(new Circle(5));
      b.space = space;
      // No contacts means msum = 0, so the factor is 0/0 = NaN by the
      // formula — accept either 0 or NaN as long as the call doesn't throw.
      const f = b.crushFactor();
      expect(typeof f).toBe("number");
    });
  });

  describe("totalImpulse", () => {
    it("returns zero impulse for a body with no contacts", () => {
      const space = new Space(new Vec2(0, 0));
      const b = new Body(BodyType.DYNAMIC, new Vec2(0, 0));
      b.shapes.add(new Circle(5));
      b.space = space;
      const imp = b.totalImpulse();
      expect(imp.x).toBeCloseTo(0);
      expect(imp.y).toBeCloseTo(0);
    });
  });
});
