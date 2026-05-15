import { describe, it, expect, beforeEach, vi } from "vitest";
import { ZPP_Compound } from "../../../src/native/phys/ZPP_Compound";
import { ZPP_Interactor } from "../../../src/native/phys/ZPP_Interactor";
import { createMockNape, createMockZpp, MockZNPList } from "../_mocks";

function listWrapper(list: any) {
  return {
    zpp_inner: { inner: list, reverse_flag: false },
    remove: (x: any) => list.remove(x),
  };
}

function setupCompoundStatics() {
  const zpp = createMockZpp();
  zpp.util.ZNPList_ZPP_Body = MockZNPList;
  zpp.util.ZNPList_ZPP_Compound = MockZNPList;
  zpp.util.ZNPList_ZPP_CallbackSet = MockZNPList;
  zpp.util.ZPP_BodyList = { get: listWrapper };
  zpp.util.ZPP_ConstraintList = { get: listWrapper };
  zpp.util.ZPP_CompoundList = { get: listWrapper };
  ZPP_Compound._zpp = zpp;
  ZPP_Compound._nape = createMockNape();
  ZPP_Interactor._zpp = zpp;
  ZPP_Interactor._nape = createMockNape();
}

describe("ZPP_Compound", () => {
  beforeEach(() => {
    setupCompoundStatics();
  });

  it("initializes empty child lists and list callbacks", () => {
    const compound = new ZPP_Compound();

    expect(compound.depth).toBe(1);
    expect(compound.bodies.length).toBe(0);
    expect(compound.constraints.length).toBe(0);
    expect(compound.compounds.length).toBe(0);
    expect(compound.wrap_bodies.zpp_inner.adder).toBeTypeOf("function");
    expect(compound.wrap_constraints.zpp_inner.subber).toBeTypeOf("function");
    expect(compound.wrap_compounds.zpp_inner._modifiable).toBeTypeOf("function");
  });

  it("parents and de-parents bodies while forwarding space membership", () => {
    const compound = new ZPP_Compound();
    const addBody = vi.fn();
    const remBody = vi.fn();
    compound.space = { addBody, remBody };
    const body = { compound: null, space: null };
    const wrapper = { zpp_inner: body };

    expect(compound.bodies_adder(wrapper)).toBe(true);
    expect(body.compound).toBe(compound);
    expect(addBody).toHaveBeenCalledWith(body);

    compound.bodies_subber(wrapper);

    expect(body.compound).toBeNull();
    expect(remBody).toHaveBeenCalledWith(body);
  });

  it("updates nested compound depth and rejects cycles", () => {
    const parent = new ZPP_Compound();
    const child = new ZPP_Compound();
    child.outer = { toString: () => "child" };
    parent.depth = 3;

    expect(parent.compounds_adder({ zpp_inner: child, toString: () => "child" })).toBe(true);
    expect(child.compound).toBe(parent);
    expect(child.depth).toBe(4);

    expect(() => child.compounds_adder({ zpp_inner: parent, toString: () => "parent" })).toThrow(
      /cycle/,
    );

    parent.compounds_subber({ zpp_inner: child });
    expect(child.compound).toBeNull();
    expect(child.depth).toBe(1);
  });

  it("breaks apart an empty compound without requiring children", () => {
    const compound = new ZPP_Compound();
    compound.__iremovedFromSpace = vi.fn();
    const remove = vi.fn();
    compound.space = {
      nullInteractorType: vi.fn(),
      compounds: { remove },
    };

    compound.breakApart();

    expect(compound.__iremovedFromSpace).toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith(compound);
    expect(compound.space).toBeNull();
    expect(compound.compound).toBeNull();
  });
});
