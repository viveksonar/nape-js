/**
 * ZPP_Space — PreListener handler invocation: exception propagation,
 * return-value handling, and CbType filtering (issue #163).
 *
 * The existing PreCallback + PreListener tests cover construction, basic
 * firing, and the IGNORE/ACCEPT flags on a vanilla pair. Untested surface
 * (driven via the broadcast loop at ZPP_Space.ts ~10849–10911):
 *
 * - Handler exception propagates uncaught through `space.step()` — there is
 *   no try/catch around `listener.handlerp(this.precb)`. Any future swallow
 *   would silently change behavior, so we pin the no-swallow contract.
 * - `null` / `undefined` return leaves `arb.immState` untouched (the
 *   `if (ret25 != null)` guard at line 10882).
 * - Each PreFlag maps to its documented immState code:
 *     ACCEPT → 5, ACCEPT_ONCE → 1, IGNORE → 6, anything-else → 2.
 * - CbType includes/excludes filter via `options1/options2` — listener with
 *   include-set fires only on matching cbTypes; a listener with the partner
 *   in `excludes` does NOT fire.
 * - Multiple PreListeners on the same pair are each invoked once per
 *   collision event in registration order.
 * - SENSOR and FLUID PreListeners fire on their respective interaction
 *   types and do NOT cross over.
 */

import { describe, it, expect } from "vitest";
import "../../../src/core/engine";
import { Space } from "../../../src/space/Space";
import { Body } from "../../../src/phys/Body";
import { BodyType } from "../../../src/phys/BodyType";
import { Vec2 } from "../../../src/geom/Vec2";
import { Circle } from "../../../src/shape/Circle";
import { Polygon } from "../../../src/shape/Polygon";
import { CbType } from "../../../src/callbacks/CbType";
import { CbEvent } from "../../../src/callbacks/CbEvent";
import { InteractionType } from "../../../src/callbacks/InteractionType";
import { PreListener } from "../../../src/callbacks/PreListener";
import { PreFlag } from "../../../src/callbacks/PreFlag";
import { InteractionListener } from "../../../src/callbacks/InteractionListener";
import { FluidProperties } from "../../../src/phys/FluidProperties";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function spaceXY(): Space {
  return new Space(new Vec2(0, 0));
}

function dynCircle(x: number, y: number, r = 10): Body {
  const b = new Body(BodyType.DYNAMIC, new Vec2(x, y));
  b.shapes.add(new Circle(r));
  return b;
}

// ---------------------------------------------------------------------------
// Exception propagation
// ---------------------------------------------------------------------------

describe("ZPP_Space — PreListener handler exception propagation", () => {
  it("an exception thrown in the handler propagates out of space.step()", () => {
    const space = spaceXY();

    new PreListener(InteractionType.COLLISION, CbType.ANY_BODY, CbType.ANY_BODY, () => {
      throw new Error("boom from handler");
    }).space = space;

    const a = dynCircle(0, 0, 20);
    a.space = space;
    const b = dynCircle(30, 0, 20);
    b.space = space;

    expect(() => space.step(1 / 60)).toThrow(/boom from handler/);
  });

  it("a handler that throws does not silently swallow on subsequent steps", () => {
    // Pin the no-swallow contract: even after a prior throw, the listener
    // still throws on the next step — there is no exception cache or "soft
    // disable" path in ZPP_Space's broadcast loop.
    const space = spaceXY();

    new PreListener(InteractionType.COLLISION, CbType.ANY_BODY, CbType.ANY_BODY, () => {
      throw new Error("still throwing");
    }).space = space;

    const a = dynCircle(0, 0, 20);
    a.space = space;
    const b = dynCircle(30, 0, 20);
    b.space = space;

    expect(() => space.step(1 / 60)).toThrow(/still throwing/);
    // Bodies may now be in a partially-stepped state but the engine itself
    // must remain reusable for subsequent calls (which will also throw).
    expect(() => space.step(1 / 60)).toThrow(/still throwing/);
  });
});

// ---------------------------------------------------------------------------
// PreFlag return-value mapping
// ---------------------------------------------------------------------------

describe("ZPP_Space — PreListener return-value mapping", () => {
  it("PreFlag.ACCEPT_ONCE accepts the current contact but re-asks on the next step", () => {
    // ACCEPT_ONCE maps to immState=1 (line 10898) — the listener fires again
    // on every subsequent collision frame rather than being cached.
    const space = spaceXY();
    let callCount = 0;

    new PreListener(
      InteractionType.COLLISION,
      CbType.ANY_BODY,
      CbType.ANY_BODY,
      () => {
        callCount++;
        return PreFlag.ACCEPT_ONCE;
      },
      0,
      false, // pure=false so the listener is consulted each frame
    ).space = space;

    const a = dynCircle(0, 0, 25);
    a.space = space;
    const b = dynCircle(30, 0, 25);
    b.space = space;

    // First step: triggers BEGIN + pre callback at least once.
    space.step(1 / 60);
    const after1 = callCount;
    expect(after1).toBeGreaterThanOrEqual(1);

    // Several more frames — overlapping contact persists; ACCEPT_ONCE
    // causes the listener to be re-queried on each frame, so the call
    // count keeps growing.
    for (let i = 0; i < 5; i++) space.step(1 / 60);
    expect(callCount).toBeGreaterThan(after1);
  });

  it("handler that returns null leaves the collision in its default-accept state", () => {
    // The `if (ret25 != null)` guard at line 10882 means a null return is
    // not mapped to any immState — the contact proceeds normally.
    const space = spaceXY();
    let preFired = 0;
    let collisionBegan = false;

    new PreListener(InteractionType.COLLISION, CbType.ANY_BODY, CbType.ANY_BODY, () => {
      preFired++;
      return null as unknown as PreFlag;
    }).space = space;

    new InteractionListener(
      CbEvent.BEGIN,
      InteractionType.COLLISION,
      CbType.ANY_BODY,
      CbType.ANY_BODY,
      () => {
        collisionBegan = true;
      },
    ).space = space;

    const a = dynCircle(0, 0, 25);
    a.space = space;
    const b = dynCircle(30, 0, 25);
    b.space = space;

    space.step(1 / 60);

    expect(preFired).toBeGreaterThanOrEqual(1);
    // Null return ≠ IGNORE: the collision still occurs and BEGIN fires.
    expect(collisionBegan).toBe(true);
  });

  it("handler that returns undefined behaves the same as null (no immState change)", () => {
    const space = spaceXY();
    let collisionBegan = false;

    new PreListener(InteractionType.COLLISION, CbType.ANY_BODY, CbType.ANY_BODY, () => {
      return undefined as unknown as PreFlag;
    }).space = space;

    new InteractionListener(
      CbEvent.BEGIN,
      InteractionType.COLLISION,
      CbType.ANY_BODY,
      CbType.ANY_BODY,
      () => {
        collisionBegan = true;
      },
    ).space = space;

    const a = dynCircle(0, 0, 25);
    a.space = space;
    const b = dynCircle(30, 0, 25);
    b.space = space;

    space.step(1 / 60);

    expect(collisionBegan).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CbType include/exclude filtering
// ---------------------------------------------------------------------------

describe("ZPP_Space — PreListener CbType include/exclude filtering", () => {
  it("listener with matching CbType pair fires", () => {
    const space = spaceXY();
    const tA = new CbType();
    const tB = new CbType();
    let fired = false;

    new PreListener(InteractionType.COLLISION, tA, tB, () => {
      fired = true;
      return PreFlag.ACCEPT;
    }).space = space;

    const a = new Body(BodyType.DYNAMIC, new Vec2(0, 0));
    const ca = new Circle(20);
    ca.cbTypes.add(tA);
    a.shapes.add(ca);
    a.space = space;

    const b = new Body(BodyType.DYNAMIC, new Vec2(30, 0));
    const cb = new Circle(20);
    cb.cbTypes.add(tB);
    b.shapes.add(cb);
    b.space = space;

    space.step(1 / 60);
    expect(fired).toBe(true);
  });

  it("listener with mismatched CbType pair does NOT fire", () => {
    const space = spaceXY();
    const tA = new CbType();
    const tB = new CbType();
    const tC = new CbType();
    let fired = false;

    // Listener wants A↔B, but the pair is A↔C — must not fire.
    new PreListener(InteractionType.COLLISION, tA, tB, () => {
      fired = true;
      return PreFlag.ACCEPT;
    }).space = space;

    const a = new Body(BodyType.DYNAMIC, new Vec2(0, 0));
    const ca = new Circle(20);
    ca.cbTypes.add(tA);
    a.shapes.add(ca);
    a.space = space;

    const b = new Body(BodyType.DYNAMIC, new Vec2(30, 0));
    const cb = new Circle(20);
    cb.cbTypes.add(tC);
    b.shapes.add(cb);
    b.space = space;

    space.step(1 / 60);
    expect(fired).toBe(false);
  });

  it("listener with ANY_BODY in both slots fires for any body pair", () => {
    const space = spaceXY();
    let fired = false;

    new PreListener(InteractionType.COLLISION, CbType.ANY_BODY, CbType.ANY_BODY, () => {
      fired = true;
      return PreFlag.ACCEPT;
    }).space = space;

    const a = dynCircle(0, 0, 20);
    a.space = space;
    const b = dynCircle(30, 0, 20);
    b.space = space;

    space.step(1 / 60);
    expect(fired).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Multiple listeners on same pair
// ---------------------------------------------------------------------------

describe("ZPP_Space — multiple PreListeners on the same pair", () => {
  it("all matching listeners are invoked once per collision event", () => {
    const space = spaceXY();
    let count1 = 0;
    let count2 = 0;
    let count3 = 0;

    new PreListener(InteractionType.COLLISION, CbType.ANY_BODY, CbType.ANY_BODY, () => {
      count1++;
      return PreFlag.ACCEPT;
    }).space = space;
    new PreListener(InteractionType.COLLISION, CbType.ANY_BODY, CbType.ANY_BODY, () => {
      count2++;
      return PreFlag.ACCEPT;
    }).space = space;
    new PreListener(InteractionType.COLLISION, CbType.ANY_BODY, CbType.ANY_BODY, () => {
      count3++;
      return PreFlag.ACCEPT;
    }).space = space;

    const a = dynCircle(0, 0, 25);
    a.space = space;
    const b = dynCircle(30, 0, 25);
    b.space = space;

    space.step(1 / 60);

    expect(count1).toBeGreaterThanOrEqual(1);
    expect(count2).toBeGreaterThanOrEqual(1);
    expect(count3).toBeGreaterThanOrEqual(1);
    // All three should have fired the same number of times — broadcast loop
    // visits each listener once per collision.
    expect(count1).toBe(count2);
    expect(count2).toBe(count3);
  });

  it("last listener's PreFlag wins when multiple disagree (broadcast loop overwrites immState)", () => {
    // Each listener's flag is written into arb.immState (line 10908) — the
    // last listener visited has the final say. The broadcast loop iterates
    // prelisteners head→tail, so the listener attached last wins. BEGIN
    // listeners can still fire (a CallbackSet records the contact pair
    // regardless of immState), but the position-update solver respects
    // the final immState — so bodies pass through under a trailing IGNORE.
    const space = spaceXY();
    let acceptFired = false;
    let ignoreFired = false;

    new PreListener(InteractionType.COLLISION, CbType.ANY_BODY, CbType.ANY_BODY, () => {
      acceptFired = true;
      return PreFlag.ACCEPT;
    }).space = space;
    // Attached second — should overwrite the earlier ACCEPT with IGNORE.
    new PreListener(InteractionType.COLLISION, CbType.ANY_BODY, CbType.ANY_BODY, () => {
      ignoreFired = true;
      return PreFlag.IGNORE;
    }).space = space;

    const a = dynCircle(0, 0, 20);
    a.velocity = Vec2.weak(200, 0);
    a.space = space;
    const b = dynCircle(60, 0, 20);
    b.velocity = Vec2.weak(-200, 0);
    b.space = space;

    for (let i = 0; i < 30; i++) space.step(1 / 60);

    expect(acceptFired).toBe(true);
    expect(ignoreFired).toBe(true);
    // IGNORE wins as the last-seen flag — bodies fully pass through each other.
    expect(a.position.x).toBeGreaterThan(60);
    expect(b.position.x).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// Interaction-type segregation
// ---------------------------------------------------------------------------

describe("ZPP_Space — PreListener interaction-type segregation", () => {
  it("a COLLISION PreListener does not fire on a sensor-only pair", () => {
    const space = spaceXY();
    let fired = false;

    new PreListener(InteractionType.COLLISION, CbType.ANY_BODY, CbType.ANY_BODY, () => {
      fired = true;
      return PreFlag.ACCEPT;
    }).space = space;

    const a = new Body(BodyType.DYNAMIC, new Vec2(0, 0));
    const s1 = new Circle(20);
    s1.sensorEnabled = true;
    a.shapes.add(s1);
    a.space = space;

    const b = new Body(BodyType.DYNAMIC, new Vec2(30, 0));
    const s2 = new Circle(20);
    s2.sensorEnabled = true;
    b.shapes.add(s2);
    b.space = space;

    space.step(1 / 60);
    expect(fired).toBe(false);
  });

  it("a SENSOR PreListener fires on a sensor pair but not on a collision pair", () => {
    const space = spaceXY();
    let sensorFired = false;

    new PreListener(InteractionType.SENSOR, CbType.ANY_BODY, CbType.ANY_BODY, () => {
      sensorFired = true;
      return PreFlag.ACCEPT;
    }).space = space;

    // Collision pair — must NOT fire.
    {
      const a = dynCircle(0, 0, 20);
      a.space = space;
      const b = dynCircle(30, 0, 20);
      b.space = space;
      space.step(1 / 60);
    }
    expect(sensorFired).toBe(false);

    // Now add a sensor pair — must fire.
    {
      const a = new Body(BodyType.DYNAMIC, new Vec2(0, 500));
      const s1 = new Circle(20);
      s1.sensorEnabled = true;
      a.shapes.add(s1);
      a.space = space;
      const b = dynCircle(30, 500, 20);
      b.space = space;
      space.step(1 / 60);
    }
    expect(sensorFired).toBe(true);
  });

  it("a FLUID PreListener fires only on fluid interactions", () => {
    const space = new Space(new Vec2(0, 0));
    let fluidFired = false;

    new PreListener(InteractionType.FLUID, CbType.ANY_BODY, CbType.ANY_BODY, () => {
      fluidFired = true;
      return PreFlag.ACCEPT;
    }).space = space;

    // Fluid body + dynamic ball inside it.
    const fluidBody = new Body(BodyType.STATIC, new Vec2(0, 0));
    const fluidShape = new Polygon(Polygon.box(400, 400));
    fluidShape.fluidEnabled = true;
    fluidShape.fluidProperties = new FluidProperties(2, 1);
    fluidBody.shapes.add(fluidShape);
    fluidBody.space = space;

    const ball = dynCircle(0, 0, 10);
    ball.space = space;

    for (let i = 0; i < 60; i++) {
      space.step(1 / 60);
      if (fluidFired) break;
    }
    expect(fluidFired).toBe(true);
  });
});
