import { describe, it, expect } from "vitest";
import "../../src/core/engine";
import { Space } from "../../src/space/Space";
import { Body } from "../../src/phys/Body";
import { BodyType } from "../../src/phys/BodyType";
import { Vec2 } from "../../src/geom/Vec2";
import { Circle } from "../../src/shape/Circle";
import { PivotJoint } from "../../src/constraint/PivotJoint";
import { Player } from "../../src/replay/Player";
import { Recorder, REPLAY_VERSION } from "../../src/replay/Recorder";

function makeSpace(): Space {
  const space = new Space(new Vec2(0, 600));
  space.deterministic = true;
  const body = new Body(BodyType.DYNAMIC, new Vec2(100, 100));
  body.shapes.add(new Circle(10));
  body.space = space;
  return space;
}

describe("Recorder", () => {
  describe("construction", () => {
    it("captures initial snapshot from space", () => {
      const space = makeSpace();
      const r = new Recorder(space);
      expect(r.frame).toBe(0);
      expect(r.finished).toBe(false);
    });

    it("throws on null space", () => {
      expect(() => new Recorder(null as unknown as Space)).toThrow(/space is required/);
    });

    it("throws on negative keyframeEvery", () => {
      const space = makeSpace();
      expect(() => new Recorder(space, { keyframeEvery: -1 })).toThrow(
        /keyframeEvery must be a non-negative integer/,
      );
    });

    it("throws on non-integer keyframeEvery", () => {
      const space = makeSpace();
      expect(() => new Recorder(space, { keyframeEvery: 1.5 })).toThrow(
        /keyframeEvery must be a non-negative integer/,
      );
    });

    it("accepts keyframeEvery: 0 (disables keyframes)", () => {
      const space = makeSpace();
      expect(() => new Recorder(space, { keyframeEvery: 0 })).not.toThrow();
    });
  });

  describe("recordFrame", () => {
    it("advances frame on each call", () => {
      const space = makeSpace();
      const r = new Recorder(space, { keyframeEvery: 0 });
      r.recordFrame(null);
      expect(r.frame).toBe(1);
      r.recordFrame(null);
      expect(r.frame).toBe(2);
    });

    it("stores non-null payloads in input log", () => {
      const space = makeSpace();
      const r = new Recorder<{ jump: boolean }>(space, { keyframeEvery: 0 });
      r.recordFrame({ jump: true });
      r.recordFrame(null);
      r.recordFrame({ jump: false });
      const replay = r.finish();
      expect(replay.inputs).toHaveLength(2);
      expect(replay.inputs[0]).toEqual({ frame: 0, payload: { jump: true } });
      expect(replay.inputs[1]).toEqual({ frame: 2, payload: { jump: false } });
    });

    it("deep-clones object payloads", () => {
      const space = makeSpace();
      const r = new Recorder<{ keys: string[] }>(space, { keyframeEvery: 0 });
      const payload = { keys: ["a"] };
      r.recordFrame(payload);
      payload.keys.push("b"); // should not affect stored copy
      const replay = r.finish();
      expect(replay.inputs[0].payload).toEqual({ keys: ["a"] });
    });

    it("captures keyframe at every Nth frame", () => {
      const space = makeSpace();
      const r = new Recorder(space, { keyframeEvery: 5 });
      for (let i = 0; i < 12; i++) r.recordFrame(null);
      const replay = r.finish();
      // Keyframes at frames 5 and 10 (frame 0 is initialSnapshot)
      expect(replay.keyframes.map((k) => k.frame)).toEqual([5, 10]);
    });

    it("captures no keyframes with keyframeEvery: 0", () => {
      const space = makeSpace();
      const r = new Recorder(space, { keyframeEvery: 0 });
      for (let i = 0; i < 100; i++) r.recordFrame(null);
      const replay = r.finish();
      expect(replay.keyframes).toEqual([]);
    });

    it("throws when called after finish()", () => {
      const space = makeSpace();
      const r = new Recorder(space, { keyframeEvery: 0 });
      r.finish();
      expect(() => r.recordFrame(null)).toThrow(/cannot record after finish/);
    });
  });

  describe("finish", () => {
    it("returns Replay with current version", () => {
      const space = makeSpace();
      const r = new Recorder(space, { keyframeEvery: 0 });
      const replay = r.finish();
      expect(replay.version).toBe(REPLAY_VERSION);
    });

    it("frameCount matches recorded frames", () => {
      const space = makeSpace();
      const r = new Recorder(space, { keyframeEvery: 0 });
      for (let i = 0; i < 7; i++) r.recordFrame(null);
      const replay = r.finish();
      expect(replay.frameCount).toBe(7);
    });

    it("returns initialSnapshot as Uint8Array", () => {
      const space = makeSpace();
      const r = new Recorder(space, { keyframeEvery: 0 });
      const replay = r.finish();
      expect(replay.initialSnapshot).toBeInstanceOf(Uint8Array);
      expect(replay.initialSnapshot.byteLength).toBeGreaterThan(0);
    });

    it("flips finished flag", () => {
      const space = makeSpace();
      const r = new Recorder(space, { keyframeEvery: 0 });
      expect(r.finished).toBe(false);
      r.finish();
      expect(r.finished).toBe(true);
    });
  });

  describe("payload encoding", () => {
    it("preserves primitive payloads (number, string, boolean, null)", () => {
      const space = makeSpace();
      const r = new Recorder<number | string | boolean>(space, { keyframeEvery: 0 });
      r.recordFrame(42);
      r.recordFrame("hello");
      r.recordFrame(true);
      const replay = r.finish();
      expect(replay.inputs[0].payload).toBe(42);
      expect(replay.inputs[1].payload).toBe("hello");
      expect(replay.inputs[2].payload).toBe(true);
    });

    it("preserves nested object payloads", () => {
      const space = makeSpace();
      const r = new Recorder(space, { keyframeEvery: 0 });
      r.recordFrame({ pos: { x: 1, y: 2 }, keys: ["a", "b"] });
      const replay = r.finish();
      expect(replay.inputs[0].payload).toEqual({
        pos: { x: 1, y: 2 },
        keys: ["a", "b"],
      });
    });
  });

  // Edge cases requested by issue #169.
  describe("mutation during recording", () => {
    it("keyframe captures a body added mid-recording", () => {
      // Snapshot is taken at construction-time, but later keyframes sample
      // the live space — a body added on frame 7 must show up in the
      // frame-10 keyframe (and therefore in the deserialised playback space).
      const space = makeSpace();
      const r = new Recorder(space, { keyframeEvery: 5 });
      for (let i = 0; i < 15; i++) {
        if (i === 7) {
          const newBody = new Body(BodyType.DYNAMIC, new Vec2(200, 100));
          newBody.shapes.add(new Circle(8));
          newBody.space = space;
        }
        r.recordFrame(null);
        space.step(1 / 60);
      }
      const replay = r.finish();
      const p = new Player(replay);
      p.restore();
      // Initial snapshot has 1 body.
      expect(p.space.bodies.length).toBe(1);

      // Backward jump from a later frame restores the keyframe at 10 — the
      // most direct way to assert *the keyframe itself* (not forward-stepped
      // state) contains the body added at frame 7.
      p.stepTo(12);
      p.stepTo(10);
      expect(p.space.bodies.length).toBe(2);
    });

    it("keyframe omits a body removed mid-recording", () => {
      const space = makeSpace();
      const transient = new Body(BodyType.DYNAMIC, new Vec2(200, 100));
      transient.shapes.add(new Circle(8));
      transient.space = space;

      const r = new Recorder(space, { keyframeEvery: 5 });
      for (let i = 0; i < 15; i++) {
        if (i === 6) transient.space = null;
        r.recordFrame(null);
        space.step(1 / 60);
      }
      const replay = r.finish();
      const p = new Player(replay);
      p.restore();
      expect(p.space.bodies.length).toBe(2); // initial snapshot has both

      p.stepTo(12);
      p.stepTo(10); // backward → keyframe-10 restore
      expect(p.space.bodies.length).toBe(1);
    });

    it("keyframe omits a constraint removed mid-recording", () => {
      const space = new Space(new Vec2(0, 600));
      space.deterministic = true;
      const anchor = new Body(BodyType.STATIC, new Vec2(0, 0));
      anchor.space = space;
      const swing = new Body(BodyType.DYNAMIC, new Vec2(40, 0));
      swing.shapes.add(new Circle(5));
      swing.space = space;
      const joint = new PivotJoint(anchor, swing, new Vec2(0, 0), new Vec2(0, 0));
      joint.space = space;

      const r = new Recorder(space, { keyframeEvery: 5 });
      for (let i = 0; i < 15; i++) {
        if (i === 4) joint.space = null;
        r.recordFrame(null);
        space.step(1 / 60);
      }
      const replay = r.finish();
      const p = new Player(replay);
      p.restore();
      expect(p.space.constraints.length).toBe(1); // initial snapshot

      p.stepTo(12);
      p.stepTo(10); // backward → keyframe-10 has joint removed
      expect(p.space.constraints.length).toBe(0);
    });

    it("recording survives space.deterministic toggle mid-stream", () => {
      // Bumping the flag mid-recording is a misuse pattern — the Recorder
      // doesn't enforce immutability, so we just want to confirm it doesn't
      // throw and the captured frame count is right. Replay correctness is
      // out of scope (user violated the determinism contract).
      const space = makeSpace();
      const r = new Recorder(space, { keyframeEvery: 5 });
      for (let i = 0; i < 12; i++) {
        if (i === 6) space.deterministic = false;
        r.recordFrame(null);
        space.step(1 / 60);
      }
      const replay = r.finish();
      expect(replay.frameCount).toBe(12);
      // The initial snapshot was captured while deterministic=true, so
      // restoring the player rehydrates a deterministic space regardless of
      // the recording space's later toggle.
      const p = new Player(replay);
      p.restore();
      expect(p.space.deterministic).toBe(true);
    });
  });
});
