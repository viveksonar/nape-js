import { describe, it, expect } from "vitest";
import "../../src/core/engine";
import { Space } from "../../src/space/Space";
import { Body } from "../../src/phys/Body";
import { BodyType } from "../../src/phys/BodyType";
import { Vec2 } from "../../src/geom/Vec2";
import { Circle } from "../../src/shape/Circle";
import { Recorder } from "../../src/replay/Recorder";
import { encodeReplay, decodeReplay } from "../../src/replay/encode";
import type { Replay } from "../../src/replay/types";

function makeReplay<T>(
  frames: number,
  inputAt: (frame: number) => T | null = () => null,
  keyframeEvery = 0,
): Replay<T> {
  const space = new Space(new Vec2(0, 600));
  space.deterministic = true;
  const ball = new Body(BodyType.DYNAMIC, new Vec2(100, 100));
  ball.shapes.add(new Circle(10));
  ball.space = space;

  const r = new Recorder<T>(space, { keyframeEvery });
  for (let f = 0; f < frames; f++) {
    r.recordFrame(inputAt(f));
    space.step(1 / 60);
  }
  return r.finish();
}

describe("encodeReplay / decodeReplay", () => {
  describe("round-trip", () => {
    it("preserves frameCount", () => {
      const replay = makeReplay(42);
      const bytes = encodeReplay(replay);
      const decoded = decodeReplay(bytes);
      expect(decoded.frameCount).toBe(42);
    });

    it("preserves version", () => {
      const replay = makeReplay(5);
      const decoded = decodeReplay(encodeReplay(replay));
      expect(decoded.version).toBe(replay.version);
    });

    it("preserves initial snapshot byte-for-byte", () => {
      const replay = makeReplay(1);
      const decoded = decodeReplay(encodeReplay(replay));
      expect(decoded.initialSnapshot).toEqual(replay.initialSnapshot);
    });

    it("preserves input log frames and payloads", () => {
      const replay = makeReplay<{ tag: string }>(10, (f) =>
        f === 3 || f === 7 ? { tag: `f${f}` } : null,
      );
      const decoded = decodeReplay<{ tag: string }>(encodeReplay(replay));
      expect(decoded.inputs).toHaveLength(2);
      expect(decoded.inputs[0]).toEqual({ frame: 3, payload: { tag: "f3" } });
      expect(decoded.inputs[1]).toEqual({ frame: 7, payload: { tag: "f7" } });
    });

    it("preserves keyframes", () => {
      const replay = makeReplay(20, () => null, 5);
      const decoded = decodeReplay(encodeReplay(replay));
      expect(decoded.keyframes.map((k) => k.frame)).toEqual(replay.keyframes.map((k) => k.frame));
      for (let i = 0; i < replay.keyframes.length; i++) {
        expect(decoded.keyframes[i].snapshot).toEqual(replay.keyframes[i].snapshot);
      }
    });

    it("handles empty input log", () => {
      const replay = makeReplay(5);
      expect(replay.inputs).toEqual([]);
      const decoded = decodeReplay(encodeReplay(replay));
      expect(decoded.inputs).toEqual([]);
    });

    it("handles zero-frame replay", () => {
      const space = new Space();
      const r = new Recorder(space, { keyframeEvery: 0 });
      const replay = r.finish();
      const decoded = decodeReplay(encodeReplay(replay));
      expect(decoded.frameCount).toBe(0);
      expect(decoded.inputs).toEqual([]);
      expect(decoded.keyframes).toEqual([]);
    });

    it("encodes primitive payloads", () => {
      const replay = makeReplay<number | string | boolean>(5, (f) => {
        if (f === 0) return 42;
        if (f === 1) return "hi";
        if (f === 2) return true;
        return null;
      });
      const decoded = decodeReplay<number | string | boolean>(encodeReplay(replay));
      expect(decoded.inputs[0].payload).toBe(42);
      expect(decoded.inputs[1].payload).toBe("hi");
      expect(decoded.inputs[2].payload).toBe(true);
    });

    it("encodes nested object payloads", () => {
      const replay = makeReplay<{ keys: string[]; pos: { x: number } }>(2, (f) =>
        f === 0 ? { keys: ["a", "b"], pos: { x: 5 } } : null,
      );
      const decoded = decodeReplay<{ keys: string[]; pos: { x: number } }>(encodeReplay(replay));
      expect(decoded.inputs[0].payload).toEqual({ keys: ["a", "b"], pos: { x: 5 } });
    });
  });

  describe("error handling", () => {
    it("throws on invalid magic", () => {
      const bytes = new Uint8Array(20);
      // Magic is the first 4 bytes — leaving them as zeros guarantees it
      // doesn't match RPLY (0x52504C59).
      expect(() => decodeReplay(bytes)).toThrow(/invalid magic/);
    });

    it("throws on unsupported version", () => {
      const replay = makeReplay(0);
      const bytes = encodeReplay(replay);
      // Version is at offset 4 (u16 little-endian)
      bytes[4] = 99;
      bytes[5] = 0;
      expect(() => decodeReplay(bytes)).toThrow(/unsupported version/);
    });

    it("throws when buffer is truncated mid-payload", () => {
      const replay = makeReplay<{ tag: string }>(5, (f) => (f === 2 ? { tag: "payload" } : null));
      const full = encodeReplay(replay);
      // Strip the last ~10 bytes — falls inside either the trailing keyframe
      // count or the inputs section, depending on layout. Either way the
      // DataView reads past the end and DataView throws RangeError, or the
      // subarray decoding produces garbage — both are acceptable failures.
      const truncated = full.slice(0, full.byteLength - 10);
      expect(() => decodeReplay(truncated)).toThrow();
    });

    it("rejects future-version replays", () => {
      // The current implementation accepts ONLY the exact REPLAY_VERSION —
      // verify forward-incompatible files fail loudly rather than silently.
      const replay = makeReplay(0);
      const bytes = encodeReplay(replay);
      // Bump version u16 at offset 4 → REPLAY_VERSION + 1
      const futureVersion = bytes[4] + 1;
      bytes[4] = futureVersion;
      bytes[5] = 0;
      expect(() => decodeReplay(bytes)).toThrow(/unsupported version/);
    });

    it("rejects a buffer that's too short to even hold the header", () => {
      // Header alone is 4 (magic) + 2 (version) + 4 (frameCount) + 4
      // (initLen) = 14 bytes. Anything less must fail at the first read.
      const tiny = new Uint8Array(4); // just enough for the magic check
      expect(() => decodeReplay(tiny)).toThrow();
    });
  });

  describe("large frame jumps", () => {
    it("encodes sparse input at very high frame index", () => {
      // Inputs hold absolute frame indices (no delta encoding). A single
      // input at frame 1,000,000 must round-trip without precision loss
      // even though the encoder writes u32 frame indices directly.
      const space = new Space(new Vec2(0, 600));
      space.deterministic = true;
      const ball = new Body(BodyType.DYNAMIC, new Vec2(0, 0));
      ball.shapes.add(new Circle(10));
      ball.space = space;
      const r = new Recorder<{ marker: number }>(space, { keyframeEvery: 0 });
      // Advance the recorder to a high frame index without stepping the
      // space N million times — recordFrame() only increments a counter.
      for (let i = 0; i < 999_999; i++) r.recordFrame(null);
      r.recordFrame({ marker: 42 });
      const replay = r.finish();
      const decoded = decodeReplay<{ marker: number }>(encodeReplay(replay));
      expect(decoded.frameCount).toBe(1_000_000);
      expect(decoded.inputs).toHaveLength(1);
      expect(decoded.inputs[0].frame).toBe(999_999);
      expect(decoded.inputs[0].payload).toEqual({ marker: 42 });
    });

    it("encodes inputs with multi-frame gaps", () => {
      // Inputs at frames 0, 5000, 10000 — the encoder writes absolute frame
      // indices, so large gaps shouldn't affect anything beyond size.
      const space = new Space(new Vec2(0, 600));
      space.deterministic = true;
      const r = new Recorder<{ n: number }>(space, { keyframeEvery: 0 });
      r.recordFrame({ n: 0 });
      for (let i = 1; i < 5000; i++) r.recordFrame(null);
      r.recordFrame({ n: 1 });
      for (let i = 5001; i < 10000; i++) r.recordFrame(null);
      r.recordFrame({ n: 2 });
      const replay = r.finish();
      const decoded = decodeReplay<{ n: number }>(encodeReplay(replay));
      expect(decoded.inputs.map((i) => i.frame)).toEqual([0, 5000, 10000]);
      expect(decoded.inputs.map((i) => (i.payload as { n: number }).n)).toEqual([0, 1, 2]);
    });
  });

  describe("output shape", () => {
    it("returns Uint8Array", () => {
      const replay = makeReplay(1);
      expect(encodeReplay(replay)).toBeInstanceOf(Uint8Array);
    });

    it("encoded size grows with frame count", () => {
      const small = encodeReplay(makeReplay(0));
      const big = encodeReplay(makeReplay(0, () => ({ a: 1, b: 2, c: 3 })));
      // big had no recorded inputs (frames=0) — same size as small.
      expect(big.byteLength).toBe(small.byteLength);

      const withInputs = encodeReplay(makeReplay<{ a: number }>(10, (f) => ({ a: f })));
      expect(withInputs.byteLength).toBeGreaterThan(small.byteLength);
    });
  });
});
