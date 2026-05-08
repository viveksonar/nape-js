// Coverage push for ContactList: error paths and operations on the mutable
// internal list constructed via getNape().dynamics.ContactList.

import { describe, it, expect } from "vitest";
import { getNape } from "../../src/core/engine";

function emptyList(): any {
  const nape = getNape();
  return new nape.dynamics.ContactList();
}

describe("ContactList — validation & error paths", () => {
  it("fromArray rejects null", () => {
    const Ctor = (getNape() as any).dynamics.ContactList;
    expect(() => Ctor.fromArray(null)).toThrow(/null Array/);
  });

  it("fromArray with an empty array yields an empty list", () => {
    const Ctor = (getNape() as any).dynamics.ContactList;
    const list = Ctor.fromArray([]);
    expect(list.length).toBe(0);
  });

  it("at(index) on empty list throws Index out of bounds", () => {
    const list = emptyList();
    expect(() => list.at(0)).toThrow(/out of bounds/i);
  });

  it("at(index) with negative index throws Index out of bounds", () => {
    const list = emptyList();
    expect(() => list.at(-1)).toThrow(/out of bounds/i);
  });

  it("pop on empty list throws Cannot remove from empty list", () => {
    const list = emptyList();
    expect(() => list.pop()).toThrow(/empty list/i);
  });

  it("shift on empty list throws Cannot remove from empty list", () => {
    const list = emptyList();
    expect(() => list.shift()).toThrow(/empty list/i);
  });

  it("foreach with null lambda throws", () => {
    const list = emptyList();
    expect(() => list.foreach(null)).toThrow();
  });

  it("foreach over empty list does nothing and returns the list", () => {
    const list = emptyList();
    let calls = 0;
    const ret = list.foreach(() => {
      calls++;
    });
    expect(calls).toBe(0);
    expect(ret).toBe(list);
  });

  it("filter with null lambda throws", () => {
    const list = emptyList();
    expect(() => list.filter(null)).toThrow();
  });

  it("filter over empty list returns the list unchanged", () => {
    const list = emptyList();
    const ret = list.filter(() => true);
    expect(ret).toBe(list);
    expect(list.length).toBe(0);
  });

  it("merge with null throws", () => {
    const list = emptyList();
    expect(() => list.merge(null)).toThrow(/null/i);
  });

  it("merge with another empty list keeps length 0", () => {
    const a = emptyList();
    const b = emptyList();
    a.merge(b);
    expect(a.length).toBe(0);
  });

  it("copy with deep=false on an empty list returns a new empty list", () => {
    const list = emptyList();
    const c = list.copy(false);
    expect(c).not.toBe(list);
    expect(c.length).toBe(0);
  });

  it("clear on empty list keeps length 0", () => {
    const list = emptyList();
    list.clear();
    expect(list.length).toBe(0);
  });

  it("has on empty list returns false for any element", () => {
    const list = emptyList();
    expect(list.has({} as any)).toBe(false);
  });
});
