// Coverage push for FluidProperties: focus on the copy() gravity branch
// and validation paths the existing FluidProperties.coverage.test.ts skips.

import { describe, it, expect, beforeAll } from "vitest";
import { FluidProperties } from "../../src/phys/FluidProperties";
import { Vec2 } from "../../src/geom/Vec2";
import { getNape } from "../../src/core/engine";

// The Vec2 dispose paths inside FluidProperties reference
// `napeNs.zpp_nape` which is registered as `nape.__zpp` by the bootstrap;
// alias it explicitly so those defensive code paths are reachable here.
beforeAll(() => {
  const nape = getNape() as any;
  if (nape.__zpp && !nape.zpp_nape) {
    nape.zpp_nape = nape.__zpp;
  }
});

describe("FluidProperties — validation & copy edge cases", () => {
  it("copy() preserves gravity when source has gravity set", () => {
    const fp = new FluidProperties(2.5, 1.5);
    fp.gravity = new Vec2(3, -7);
    const c = fp.copy();
    expect(c.density).toBeCloseTo(2.5);
    expect(c.viscosity).toBeCloseTo(1.5);
    expect(c.gravity).not.toBeNull();
    expect(c.gravity.x).toBeCloseTo(3);
    expect(c.gravity.y).toBeCloseTo(-7);
    // The returned gravity Vec2 must be independent — mutating the source
    // copy must not bleed into the destination.
    fp.gravity = new Vec2(99, 99);
    expect(c.gravity.x).toBeCloseTo(3);
    expect(c.gravity.y).toBeCloseTo(-7);
  });

  it("copy() with weak source gravity disposes the weak Vec2", () => {
    const fp = new FluidProperties();
    const weak = Vec2.weak(11, 22);
    fp.gravity = weak;
    expect(weak.zpp_disp).toBe(true);
    const c = fp.copy();
    expect(c.gravity.x).toBeCloseTo(11);
    expect(c.gravity.y).toBeCloseTo(22);
  });

  it("copy() with no gravity on source returns a copy without gravity", () => {
    const fp = new FluidProperties(0.8, 0.3);
    const c = fp.copy();
    expect(c.gravity).toBeNull();
    expect(c.density).toBeCloseTo(0.8);
    expect(c.viscosity).toBeCloseTo(0.3);
  });

  it("copy() preserves userData as a fresh object (no aliasing)", () => {
    const fp = new FluidProperties();
    fp.userData["tag"] = "lake";
    const c = fp.copy();
    expect(c.userData["tag"]).toBe("lake");
    c.userData["tag"] = "ocean";
    expect(fp.userData["tag"]).toBe("lake");
  });

  it("density setter rejects NaN", () => {
    const fp = new FluidProperties();
    expect(() => {
      fp.density = NaN;
    }).toThrow(/density/i);
  });

  it("density setter accepts and round-trips a finite value", () => {
    const fp = new FluidProperties();
    fp.density = 4.2;
    expect(fp.density).toBeCloseTo(4.2);
  });

  it("viscosity setter rejects NaN", () => {
    const fp = new FluidProperties();
    expect(() => {
      fp.viscosity = NaN;
    }).toThrow(/viscosity/i);
  });

  it("viscosity setter rejects negative", () => {
    const fp = new FluidProperties();
    expect(() => {
      fp.viscosity = -0.5;
    }).toThrow();
  });

  it("gravity setter rejects Vec2 with NaN component", () => {
    const fp = new FluidProperties();
    expect(() => {
      fp.gravity = new Vec2(NaN, 0);
    }).toThrow();
    expect(() => {
      fp.gravity = new Vec2(0, NaN);
    }).toThrow();
  });

  it("toString includes density, viscosity and gravity", () => {
    const fp = new FluidProperties(1.2, 0.8);
    fp.gravity = new Vec2(0, -10);
    const s = fp.toString();
    expect(s).toMatch(/density/i);
    expect(s).toMatch(/viscosity/i);
    expect(s).toMatch(/gravity/i);
  });

  it("update gravity vector in-place after setter (mutating Vec2)", () => {
    const fp = new FluidProperties();
    fp.gravity = new Vec2(1, 2);
    // Live Vec2 — mutation should be visible
    fp.gravity.setxy(5, 6);
    expect(fp.gravity.x).toBeCloseTo(5);
    expect(fp.gravity.y).toBeCloseTo(6);
  });
});
