import { describe, it, expect } from "vitest";
import { Space } from "../../src/space/Space";
import { Body } from "../../src/phys/Body";
import { BodyType } from "../../src/phys/BodyType";
import { Vec2 } from "../../src/geom/Vec2";
import { Circle } from "../../src/shape/Circle";
import { Polygon } from "../../src/shape/Polygon";
import { Compound } from "../../src/phys/Compound";
import { Material } from "../../src/phys/Material";
import { DistanceJoint } from "../../src/constraint/DistanceJoint";
import { InteractionListener } from "../../src/callbacks/InteractionListener";
import { BodyListener } from "../../src/callbacks/BodyListener";
import { CbEvent } from "../../src/callbacks/CbEvent";
import { CbType } from "../../src/callbacks/CbType";
import { InteractionType } from "../../src/callbacks/InteractionType";
import { InteractionFilter } from "../../src/dynamics/InteractionFilter";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function dynamicCircle(x: number, y: number, radius = 10): Body {
  const b = new Body(BodyType.DYNAMIC, new Vec2(x, y));
  b.shapes.add(new Circle(radius));
  return b;
}

function staticBox(x: number, y: number, w = 500, h = 10): Body {
  const b = new Body(BodyType.STATIC, new Vec2(x, y));
  b.shapes.add(new Polygon(Polygon.box(w, h)));
  return b;
}

function step(space: Space, n = 60): void {
  for (let i = 0; i < n; i++) space.step(1 / 60);
}

// ---------------------------------------------------------------------------
// 1. Body removes itself in its own collision callback
// ---------------------------------------------------------------------------
describe("Edge case — body removes itself in its own collision callback", () => {
  it("should not crash when body removes itself inside BEGIN callback", () => {
    const space = new Space(new Vec2(0, 500));
    const floor = staticBox(0, 100);
    floor.space = space;
    const ball = dynamicCircle(0, 50, 10);
    ball.space = space;

    const listener = new InteractionListener(
      CbEvent.BEGIN,
      InteractionType.COLLISION,
      CbType.ANY_BODY,
      CbType.ANY_BODY,
      () => {
        ball.space = null;
      },
    );
    listener.space = space;

    expect(() => step(space, 60)).not.toThrow();
    expect(space.bodies.length).toBe(1); // only floor remains
  });

  it("engine should continue stepping cleanly after self-removal", () => {
    const space = new Space(new Vec2(0, 500));
    const floor = staticBox(0, 100);
    floor.space = space;
    const ball = dynamicCircle(0, 50, 10);
    ball.space = space;

    let removedOnStep = -1;
    let currentStep = 0;

    const listener = new InteractionListener(
      CbEvent.BEGIN,
      InteractionType.COLLISION,
      CbType.ANY_BODY,
      CbType.ANY_BODY,
      () => {
        if (ball.space != null) {
          ball.space = null;
          removedOnStep = currentStep;
        }
      },
    );
    listener.space = space;

    // Step manually so we can track when removal happened
    for (let i = 0; i < 120; i++) {
      currentStep = i;
      space.step(1 / 60);
    }

    // Removal must have happened
    expect(removedOnStep).toBeGreaterThan(-1);
    // Engine must still have one body (the floor) after removal
    expect(space.bodies.length).toBe(1);
    // Engine must keep running cleanly after the removal step
    expect(() => step(space, 30)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 2. Constraint removed during an interaction callback
// ---------------------------------------------------------------------------
describe("Edge case — constraint removed during callback", () => {
  it("should not crash when joint is removed inside a BEGIN callback", () => {
    const space = new Space(new Vec2(0, 500));
    const floor = staticBox(0, 100);
    floor.space = space;

    const b1 = dynamicCircle(-10, 50, 10);
    const b2 = dynamicCircle(10, 50, 10);
    b1.space = space;
    b2.space = space;

    const joint = new DistanceJoint(b1, b2, new Vec2(0, 0), new Vec2(0, 0), 15, 25);
    joint.space = space;

    const listener = new InteractionListener(
      CbEvent.BEGIN,
      InteractionType.COLLISION,
      CbType.ANY_BODY,
      CbType.ANY_BODY,
      () => {
        if (joint.space != null) joint.space = null;
      },
    );
    listener.space = space;

    expect(() => step(space, 60)).not.toThrow();
    expect(joint.space).toBeNull();
  });

  it("engine should continue simulating bodies after their joint is removed", () => {
    // No floor — bodies fall freely so position always changes, making
    // simulation progress unambiguous.
    const space = new Space(new Vec2(0, 500));

    const b1 = dynamicCircle(-10, 0, 10);
    b1.space = space;
    const b2 = dynamicCircle(10, 0, 10);
    b2.space = space;

    const joint = new DistanceJoint(b1, b2, new Vec2(0, 0), new Vec2(0, 0), 15, 25);
    joint.space = space;

    // Remove joint immediately (mirrors callback-removal timing)
    joint.space = null;

    const y1Start = b1.position.y;
    const y2Start = b2.position.y;
    step(space, 60);

    // Both bodies must fall independently under gravity after joint removal
    expect(b1.position.y).toBeGreaterThan(y1Start);
    expect(b2.position.y).toBeGreaterThan(y2Start);
    expect(joint.space).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Shape sensor flag toggled during active collision
// ---------------------------------------------------------------------------
describe("Edge case — sensor flag toggled during active collision", () => {
  it("should not crash when sensorEnabled is toggled between steps", () => {
    const space = new Space(new Vec2(0, 500));
    const floor = staticBox(0, 200);
    floor.space = space;
    const ball = dynamicCircle(0, 50, 10);
    ball.space = space;

    // Let ball land so there is an active collision arbiter
    step(space, 40);

    // Toggle sensor outside of a step — must not throw
    expect(() => {
      ball.shapes.at(0).sensorEnabled = true;
    }).not.toThrow();

    expect(() => step(space, 10)).not.toThrow();

    expect(() => {
      ball.shapes.at(0).sensorEnabled = false;
    }).not.toThrow();

    expect(() => step(space, 10)).not.toThrow();
  });

  it("ball should fall through floor after becoming a sensor", () => {
    const space = new Space(new Vec2(0, 500));
    // Floor at y=150; ball radius=10, so contact surface is at y≈140
    const floor = staticBox(0, 150);
    floor.space = space;
    const ball = dynamicCircle(0, 50, 10);
    ball.space = space;

    // Let it land and come to rest on the floor
    step(space, 60);
    const restY = ball.position.y;
    // Ball with radius 10 rests with centre ~10px above floor surface (y=150)
    expect(restY).toBeLessThanOrEqual(145);

    // Make it a sensor — physical response is now disabled
    ball.shapes.at(0).sensorEnabled = true;
    step(space, 60);

    // Ball should have fallen through the floor
    expect(ball.position.y).toBeGreaterThan(150);
  });
});

// ---------------------------------------------------------------------------
// 4. Material / friction change during sustained contact
// ---------------------------------------------------------------------------
describe("Edge case — material change during sustained contact", () => {
  it("should not crash when material is swapped mid-contact", () => {
    const space = new Space(new Vec2(0, 500));
    const floor = staticBox(0, 150);
    floor.space = space;
    const ball = dynamicCircle(0, 50, 10);
    ball.space = space;

    // Let it settle into contact
    step(space, 60);

    // Swap material mid-contact — must not throw
    expect(() => {
      ball.shapes.at(0).material = new Material(0.5, 0.3, 0.1, 2, 0);
    }).not.toThrow();

    expect(() => step(space, 30)).not.toThrow();
  });

  it("friction change during contact should affect sliding behaviour", () => {
    // Use a helper that builds an identical isolated space for each friction
    // value so both measurements use the same baseline and step window.
    function measureSlide(friction: number): number {
      const space = new Space(new Vec2(100, 500)); // sideways gravity induces slide
      const floor = staticBox(0, 150, 800, 10);
      floor.space = space;
      const ball = dynamicCircle(0, 100, 10);
      ball.space = space;

      // Settle onto floor first so contact exists before friction is applied
      step(space, 30);
      const xStart = ball.position.x;

      // Apply the target friction and measure slide over identical step window
      ball.shapes.at(0).material = new Material(0, friction, 0, 1, 0);
      step(space, 30);

      return ball.position.x - xStart;
    }

    const slideHighFriction = measureSlide(5.0);
    const slideLowFriction = measureSlide(0.0);

    // Low-friction body slides farther than high-friction body over same steps
    expect(slideLowFriction).toBeGreaterThan(slideHighFriction);
  });
});

// ---------------------------------------------------------------------------
// 5. Listener throws — engine propagates the error (does not swallow)
// ---------------------------------------------------------------------------
describe("Edge case — throwing listener propagates error from step()", () => {
  it("should propagate the error thrown inside a listener out of step()", () => {
    const space = new Space(new Vec2(0, 500));
    const floor = staticBox(0, 100);
    floor.space = space;
    const ball = dynamicCircle(0, 50, 10);
    ball.space = space;

    const bad = new InteractionListener(
      CbEvent.BEGIN,
      InteractionType.COLLISION,
      CbType.ANY_BODY,
      CbType.ANY_BODY,
      () => {
        throw new Error("intentional error in listener");
      },
    );
    bad.space = space;

    // Engine re-throws listener errors — step() does not silently swallow them
    expect(() => step(space, 60)).toThrow("intentional error in listener");
  });

  it("engine should be usable again after catching a listener error", () => {
    const space = new Space(new Vec2(0, 500));
    const floor = staticBox(0, 100);
    floor.space = space;
    const ball = dynamicCircle(0, 50, 10);
    ball.space = space;

    let fired = false;
    const bad = new InteractionListener(
      CbEvent.BEGIN,
      InteractionType.COLLISION,
      CbType.ANY_BODY,
      CbType.ANY_BODY,
      () => {
        if (!fired) {
          fired = true;
          throw new Error("intentional error");
        }
      },
    );
    bad.space = space;

    try {
      step(space, 60);
    } catch (_) {
      // expected — engine re-throws
    }

    // Remove the bad listener and confirm engine still steps cleanly
    bad.space = null;
    expect(() => step(space, 10)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 6. Very small / very large unit scales
// ---------------------------------------------------------------------------
describe("Edge case — non-1.0 unit scales", () => {
  it("should simulate correctly at very small geometry scale (sub-millimeter shapes)", () => {
    // Gravity and shapes are both in sub-millimeter range
    const space = new Space(new Vec2(0, 0.001));
    const floor = staticBox(0, 0.1, 5, 0.01);
    floor.space = space;
    const ball = dynamicCircle(0, 0.05, 0.01);
    ball.space = space;

    expect(() => step(space, 60)).not.toThrow();
    expect(isFinite(ball.position.y)).toBe(true);
    expect(isNaN(ball.position.y)).toBe(false);
  });

  it("should simulate correctly at very large scale (10000 units)", () => {
    const space = new Space(new Vec2(0, 50000));
    const floor = staticBox(0, 10000, 500000, 1000);
    floor.space = space;
    const ball = dynamicCircle(0, 5000, 1000);
    ball.space = space;

    expect(() => step(space, 60)).not.toThrow();
    expect(isFinite(ball.position.y)).toBe(true);
    expect(isNaN(ball.position.y)).toBe(false);
  });

  it("should produce finite positions at micro gravity scale after many steps", () => {
    const space = new Space(new Vec2(0, 0.001));
    const b = dynamicCircle(0, 0, 0.01);
    b.space = space;

    step(space, 300);

    expect(isFinite(b.position.x)).toBe(true);
    expect(isFinite(b.position.y)).toBe(true);
    expect(isNaN(b.position.x)).toBe(false);
    expect(isNaN(b.position.y)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. Empty compound (zero shapes) added to space
// ---------------------------------------------------------------------------
describe("Edge case — empty compound added to space", () => {
  it("should not crash when an empty compound is added to space", () => {
    const space = new Space(new Vec2(0, 500));
    const compound = new Compound();
    expect(() => {
      compound.space = space;
    }).not.toThrow();
  });

  it("should not crash when stepping with an empty compound in space", () => {
    const space = new Space(new Vec2(0, 500));
    const compound = new Compound();
    compound.space = space;

    expect(() => step(space, 60)).not.toThrow();
  });

  it("should allow adding a body to the compound after it is in space", () => {
    const space = new Space(new Vec2(0, 500));
    const compound = new Compound();
    compound.space = space;

    const b = dynamicCircle(0, 0, 10);
    expect(() => {
      b.compound = compound;
    }).not.toThrow();

    expect(() => step(space, 30)).not.toThrow();
    expect(b.position.y).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 8. Broadphase query — InteractionFilter always-true vs always-false
// ---------------------------------------------------------------------------
describe("Edge case — InteractionFilter always-true vs always-false", () => {
  it("bodiesInBody with default (pass-all) filter should return overlapping bodies", () => {
    const space = new Space(new Vec2(0, 0));
    const center = new Body(BodyType.STATIC, new Vec2(0, 0));
    center.shapes.add(new Circle(50));
    center.space = space;

    const inside = dynamicCircle(10, 10, 5);
    inside.space = space;

    step(space, 1);

    // Default InteractionFilter() — all groups/masks are 0xffffffff (pass everything)
    const filter = new InteractionFilter();
    const result = space.bodiesInBody(center, filter);
    expect(result.length).toBeGreaterThan(0);
  });

  it("bodiesInBody with mutually exclusive group/mask filter should return nothing", () => {
    const space = new Space(new Vec2(0, 0));
    const center = new Body(BodyType.STATIC, new Vec2(0, 0));
    center.shapes.add(new Circle(50));
    center.space = space;

    const inside = dynamicCircle(10, 10, 5);
    inside.space = space;

    step(space, 1);

    // InteractionFilter(group, mask, sensorGroup, sensorMask)
    // group=1, mask=0 means: "I belong to group 1, I interact with group 0"
    // No shape belongs to group 0 so the filter matches nothing.
    const filter = new InteractionFilter(1, 0, 0, 0);
    const result = space.bodiesInBody(center, filter);
    expect(result.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 9. Compound de-parented mid-step (between steps)
// ---------------------------------------------------------------------------
describe("Edge case — compound de-parented between steps", () => {
  it("should not crash when body is removed from compound between steps", () => {
    const space = new Space(new Vec2(0, 500));
    const compound = new Compound();
    const b1 = dynamicCircle(-10, 0, 10);
    const b2 = dynamicCircle(10, 0, 10);
    b1.compound = compound;
    b2.compound = compound;
    compound.space = space;

    step(space, 10);

    // De-parent b1 between steps — must not throw
    expect(() => {
      b1.compound = null;
    }).not.toThrow();

    expect(() => step(space, 30)).not.toThrow();
  });

  it("de-parented body should still simulate independently after leaving compound", () => {
    const space = new Space(new Vec2(0, 500));
    const compound = new Compound();
    const b1 = dynamicCircle(0, 0, 10);
    b1.compound = compound;
    compound.space = space;

    step(space, 10);
    const yBeforeDepart = b1.position.y;

    b1.compound = null;
    b1.space = space; // re-add as standalone body

    step(space, 30);

    // Should continue falling under gravity
    expect(b1.position.y).toBeGreaterThan(yBeforeDepart);
  });

  it("remaining compound bodies should keep simulating after one is de-parented", () => {
    const space = new Space(new Vec2(0, 500));
    const compound = new Compound();
    const b1 = dynamicCircle(-20, 0, 10);
    const b2 = dynamicCircle(20, 0, 10);
    b1.compound = compound;
    b2.compound = compound;
    compound.space = space;

    step(space, 10);
    b1.compound = null;

    const y2Before = b2.position.y;
    step(space, 30);

    expect(b2.position.y).toBeGreaterThan(y2Before);
    expect(compound.bodies.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 10. Body wake-up via applied impulse during sleep callback
// ---------------------------------------------------------------------------
describe("Edge case — body wake-up via impulse during sleep callback", () => {
  it("should not crash when applyImpulse is called inside SLEEP callback", () => {
    const space = new Space(new Vec2(0, 500));
    const floor = staticBox(0, 100);
    floor.space = space;
    const ball = dynamicCircle(0, 50, 10);
    ball.space = space;

    const listener = new BodyListener(CbEvent.SLEEP, CbType.ANY_BODY, () => {
      if (ball.space != null) {
        ball.applyImpulse(new Vec2(0, -200));
      }
    });
    listener.space = space;

    expect(() => step(space, 300)).not.toThrow();
  });

  it("body should move upward immediately after impulse applied in SLEEP callback", () => {
    const space = new Space(new Vec2(0, 500));
    const floor = staticBox(0, 100);
    floor.space = space;
    const ball = dynamicCircle(0, 50, 10);
    ball.space = space;

    let impulseApplied = false;
    const listener = new BodyListener(CbEvent.SLEEP, CbType.ANY_BODY, () => {
      if (ball.space != null && !impulseApplied) {
        ball.applyImpulse(new Vec2(0, -500));
        impulseApplied = true;
      }
    });
    listener.space = space;

    // Step until sleep fires (up to 400 steps, robust against sleep-threshold tuning)
    for (let i = 0; i < 400 && !impulseApplied; i++) space.step(1 / 60);
    expect(impulseApplied).toBe(true);

    // Capture position right after impulse — ball is mid-step, just received upward kick
    const yJustAfterImpulse = ball.position.y;

    // After a few frames the upward impulse (−500) must overcome gravity (+500)
    // and move the ball above its pre-impulse position
    step(space, 5);
    expect(ball.position.y).toBeLessThan(yJustAfterImpulse);
  });
});
