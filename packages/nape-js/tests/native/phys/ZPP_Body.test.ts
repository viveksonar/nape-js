import { describe, it, expect, beforeEach, vi } from "vitest";
import { ZPP_Body } from "../../../src/native/phys/ZPP_Body";
import { ZPP_Interactor } from "../../../src/native/phys/ZPP_Interactor";
import { createMockNape, createMockZpp, MockZNPList } from "../_mocks";

function makeShape(area: number, inertia: number, density: number) {
  return {
    area,
    inertia,
    material: { density },
    refmaterial: { density: 0 },
    validate_area_inertia: vi.fn(),
  };
}

describe("ZPP_Body", () => {
  beforeEach(() => {
    const zpp = createMockZpp();
    zpp.util.ZNPList_ZPP_Arbiter = MockZNPList;
    zpp.util.ZNPList_ZPP_CallbackSet = MockZNPList;
    zpp.util.ZPP_ShapeList = {
      get: (list: any) => ({ zpp_inner: { inner: list } }),
    };
    ZPP_Body._zpp = zpp;
    ZPP_Body._nape = createMockNape();
    ZPP_Interactor._zpp = zpp;
    ZPP_Interactor._nape = createMockNape();
  });

  it("recalculates mass and gravity mass from shape densities", () => {
    const body = new ZPP_Body();
    body.type = 2;
    body.zip_mass = true;
    body.zip_gravMass = true;
    body.shapes.add(makeShape(3, 10, 2));
    body.shapes.add(makeShape(4, 20, 0.5));

    body.validate_mass();
    body.validate_gravMass();

    expect(body.cmass).toBe(8);
    expect(body.mass).toBe(8);
    expect(body.imass).toBe(1 / 8);
    expect(body.smass).toBe(1 / 8);
    expect(body.gravMass).toBe(8);
    expect(body.zip_mass).toBe(false);
    expect(body.zip_gravMass).toBe(false);
  });

  it("uses configured gravity mass scaling while preserving computed mass", () => {
    const body = new ZPP_Body();
    body.type = 2;
    body.zip_mass = true;
    body.gravMassMode = 2;
    body.zip_gravMass = true;
    body.gravMassScale = 1.5;
    body.shapes.add(makeShape(2, 5, 4));

    body.validate_gravMass();

    expect(body.mass).toBe(8);
    expect(body.gravMass).toBe(12);
  });

  it("sets infinite mass and inertia for non-dynamic bodies", () => {
    const body = new ZPP_Body();
    body.type = 1;
    body.zip_mass = true;
    body.zip_inertia = true;
    body.shapes.add(makeShape(3, 4, 2));

    body.validate_mass();
    body.validate_inertia();

    expect(body.cmass).toBe(6);
    expect(body.mass).toBe(Infinity);
    expect(body.imass).toBe(0);
    expect(body.cinertia).toBe(24);
    expect(body.inertia).toBe(Infinity);
    expect(body.iinertia).toBe(0);
  });

  it("tracks sweep time and integrates position and rotation", () => {
    const body = new ZPP_Body();
    body.posx = 1;
    body.posy = -2;
    body.rot = 0;
    body.axisx = 0;
    body.axisy = 1;
    body.velx = 4;
    body.vely = 3;
    body.angvel = 1;
    body.sweep_angvel = 0.5;

    body.sweepIntegrate(2);

    expect(body.sweepTime).toBe(2);
    expect(body.posx).toBe(9);
    expect(body.posy).toBe(4);
    expect(body.rot).toBe(1);
    expect(body.axisx).toBeCloseTo(Math.sin(1));
    expect(body.axisy).toBeCloseTo(Math.cos(1));
  });
});
