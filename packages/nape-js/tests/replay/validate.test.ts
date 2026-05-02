import { describe, it, expect } from "vitest";
import "../../src/core/engine";
import { Space } from "../../src/space/Space";
import { Vec2 } from "../../src/geom/Vec2";
import { validateDeterministicConfig } from "../../src/replay/validate";

describe("validateDeterministicConfig", () => {
  it("returns ok for a deterministic space", () => {
    const space = new Space(new Vec2(0, 600));
    space.deterministic = true;
    const result = validateDeterministicConfig(space);
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("warns when deterministic flag is false", () => {
    const space = new Space();
    expect(space.deterministic).toBe(false);
    const result = validateDeterministicConfig(space);
    expect(result.ok).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/deterministic/);
  });

  it("returns not ok for null space", () => {
    const result = validateDeterministicConfig(null as unknown as Space);
    expect(result.ok).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
