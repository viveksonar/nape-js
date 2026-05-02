import { describe, it, expect } from "vitest";
import "../../src/core/engine";
import { Space } from "../../src/space/Space";
import { Body } from "../../src/phys/Body";
import { BodyType } from "../../src/phys/BodyType";
import { Vec2 } from "../../src/geom/Vec2";
import { Circle } from "../../src/shape/Circle";
import { Recorder } from "../../src/replay/Recorder";
import { Player } from "../../src/replay/Player";
import type { Replay } from "../../src/replay/types";

function makeSpace(): Space {
  const space = new Space(new Vec2(0, 600));
  space.deterministic = true;
  // single dynamic ball — no floor, just free-fall under gravity. Keeping
  // the scene simple makes determinism failures easy to diagnose, and
  // findDynamic() is unambiguous.
  const ball = new Body(BodyType.DYNAMIC, new Vec2(100, 100));
  ball.shapes.add(new Circle(10));
  ball.space = space;
  return space;
}

function findDynamic(space: Space): Body {
  for (let i = 0; i < space.bodies.length; i++) {
    const b = space.bodies.at(i);
    if (b.isDynamic()) return b;
  }
  throw new Error("no dynamic body in space");
}

function recordSimulation<T>(
  space: Space,
  frames: number,
  applyInput: (input: T, sp: Space, frame: number) => void,
  inputs: Array<T | null>,
  keyframeEvery = 60,
): Replay<T> {
  const r = new Recorder<T>(space, { keyframeEvery });
  for (let f = 0; f < frames; f++) {
    const input = inputs[f] ?? null;
    r.recordFrame(input);
    if (input != null) applyInput(input, space, f);
    space.step(1 / 60);
  }
  return r.finish();
}

describe("Player", () => {
  describe("construction", () => {
    it("throws on null replay", () => {
      expect(() => new Player(null as unknown as Replay)).toThrow(/replay is required/);
    });

    it("frameCount comes from the replay", () => {
      const r = new Recorder(makeSpace(), { keyframeEvery: 0 });
      for (let i = 0; i < 5; i++) r.recordFrame(null);
      const replay = r.finish();
      const p = new Player(replay);
      expect(p.frameCount).toBe(5);
    });
  });

  describe("restore", () => {
    it("returns a Space instance", () => {
      const r = new Recorder(makeSpace(), { keyframeEvery: 0 });
      const p = new Player(r.finish());
      const sp = p.restore();
      expect(sp).toBeInstanceOf(Space);
    });

    it("frame is 0 after restore", () => {
      const r = new Recorder(makeSpace(), { keyframeEvery: 0 });
      const p = new Player(r.finish());
      p.restore();
      expect(p.frame).toBe(0);
    });

    it("restoring twice rewinds to frame 0", () => {
      const r = new Recorder(makeSpace(), { keyframeEvery: 0 });
      r.recordFrame(null);
      r.recordFrame(null);
      const p = new Player(r.finish());
      p.restore();
      p.step();
      p.step();
      expect(p.frame).toBe(2);
      p.restore();
      expect(p.frame).toBe(0);
    });

    it("space getter throws before restore", () => {
      const r = new Recorder(makeSpace(), { keyframeEvery: 0 });
      const p = new Player(r.finish());
      expect(() => p.space).toThrow(/call restore/);
    });
  });

  describe("step", () => {
    it("advances frame counter", () => {
      const r = new Recorder(makeSpace(), { keyframeEvery: 0 });
      for (let i = 0; i < 3; i++) r.recordFrame(null);
      const p = new Player(r.finish());
      p.restore();
      p.step();
      expect(p.frame).toBe(1);
      p.step();
      expect(p.frame).toBe(2);
    });

    it("throws past end", () => {
      const r = new Recorder(makeSpace(), { keyframeEvery: 0 });
      r.recordFrame(null);
      const p = new Player(r.finish());
      p.restore();
      p.step();
      expect(() => p.step()).toThrow(/already at end/);
    });

    it("throws if restore not called", () => {
      const r = new Recorder(makeSpace(), { keyframeEvery: 0 });
      r.recordFrame(null);
      const p = new Player(r.finish());
      expect(() => p.step()).toThrow(/call restore/);
    });

    it("invokes applyInput at recorded frames only", () => {
      const space = makeSpace();
      const r = new Recorder<{ tag: string }>(space, { keyframeEvery: 0 });
      r.recordFrame(null);
      r.recordFrame({ tag: "a" });
      r.recordFrame(null);
      r.recordFrame({ tag: "b" });
      const replay = r.finish();
      const calls: Array<{ frame: number; payload: { tag: string } }> = [];
      const p = new Player(replay, (input, _sp, frame) => calls.push({ frame, payload: input }));
      p.restore();
      while (!p.finished) p.step();
      expect(calls).toEqual([
        { frame: 1, payload: { tag: "a" } },
        { frame: 3, payload: { tag: "b" } },
      ]);
    });
  });

  describe("stepTo", () => {
    it("forward jump steps through inputs", () => {
      const r = new Recorder(makeSpace(), { keyframeEvery: 0 });
      for (let i = 0; i < 10; i++) r.recordFrame(null);
      const p = new Player(r.finish());
      p.restore();
      p.stepTo(5);
      expect(p.frame).toBe(5);
    });

    it("backward jump uses keyframes", () => {
      const space = makeSpace();
      const r = new Recorder(space, { keyframeEvery: 5 });
      // 21 iterations → recordFrame fires at start of iter K=5,10,15,20.
      for (let i = 0; i < 21; i++) {
        r.recordFrame(null);
        space.step(1 / 60);
      }
      const replay = r.finish();
      expect(replay.keyframes.map((k) => k.frame)).toEqual([5, 10, 15, 20]);

      const p = new Player(replay);
      p.restore();
      p.stepTo(15);
      expect(p.frame).toBe(15);
      p.stepTo(7);
      expect(p.frame).toBe(7);
    });

    it("backward jump without keyframes restores from frame 0", () => {
      const space = makeSpace();
      const r = new Recorder(space, { keyframeEvery: 0 });
      for (let i = 0; i < 10; i++) {
        r.recordFrame(null);
        space.step(1 / 60);
      }
      const p = new Player(r.finish());
      p.restore();
      p.stepTo(8);
      p.stepTo(3);
      expect(p.frame).toBe(3);
    });

    it("throws on out-of-range target", () => {
      const r = new Recorder(makeSpace(), { keyframeEvery: 0 });
      r.recordFrame(null);
      const p = new Player(r.finish());
      p.restore();
      expect(() => p.stepTo(-1)).toThrow(/out of range/);
      expect(() => p.stepTo(100)).toThrow(/out of range/);
    });

    it("stepTo(0) leaves space at initial state", () => {
      const r = new Recorder(makeSpace(), { keyframeEvery: 0 });
      r.recordFrame(null);
      r.recordFrame(null);
      const p = new Player(r.finish());
      p.restore();
      p.step();
      p.stepTo(0);
      expect(p.frame).toBe(0);
    });
  });

  describe("deterministic round-trip", () => {
    it("playback reproduces final body position", () => {
      // Record: drop a ball, let it fall, apply impulse at frame 30.
      const recordSpace = makeSpace();

      const inputs: Array<{ kick: boolean } | null> = [];
      for (let f = 0; f < 60; f++) {
        inputs.push(f === 30 ? { kick: true } : null);
      }

      const replay = recordSimulation<{ kick: boolean }>(
        recordSpace,
        60,
        (input, sp) => {
          if (input.kick) {
            findDynamic(sp).applyImpulse(new Vec2(50, -200));
          }
        },
        inputs,
        0,
      );

      const recordedBall = findDynamic(recordSpace);
      const finalRecordedX = recordedBall.position.x;
      const finalRecordedY = recordedBall.position.y;

      // Replay
      const p = new Player(replay, (input, sp) => {
        if (input.kick) {
          findDynamic(sp).applyImpulse(new Vec2(50, -200));
        }
      });
      const playSpace = p.restore();
      while (!p.finished) p.step();
      const replayedBall = findDynamic(playSpace);

      expect(replayedBall.position.x).toBeCloseTo(finalRecordedX, 6);
      expect(replayedBall.position.y).toBeCloseTo(finalRecordedY, 6);
    });

    it("scrubbing forward and backward converges to same state", () => {
      const recordSpace = makeSpace();
      const replay = recordSimulation<null>(
        recordSpace,
        30,
        () => {},
        new Array(30).fill(null),
        10,
      );

      const p1 = new Player(replay);
      p1.restore();
      p1.stepTo(20);
      const ball1 = findDynamic(p1.space);
      const x1 = ball1.position.x;
      const y1 = ball1.position.y;

      const p2 = new Player(replay);
      p2.restore();
      p2.stepTo(28);
      p2.stepTo(20); // backward jump via keyframe at 20
      const ball2 = findDynamic(p2.space);

      expect(ball2.position.x).toBeCloseTo(x1, 6);
      expect(ball2.position.y).toBeCloseTo(y1, 6);
    });
  });

  describe("applyInput setter", () => {
    it("can swap callback mid-playback", () => {
      const r = new Recorder<{ v: number }>(makeSpace(), { keyframeEvery: 0 });
      r.recordFrame({ v: 1 });
      r.recordFrame({ v: 2 });
      const replay = r.finish();

      const callsA: number[] = [];
      const callsB: number[] = [];
      const p = new Player(replay, (input) => callsA.push(input.v));
      p.restore();
      p.step();
      p.applyInput = (input) => callsB.push(input.v);
      p.step();
      expect(callsA).toEqual([1]);
      expect(callsB).toEqual([2]);
    });

    it("null applyInput is allowed (no-input replays)", () => {
      const r = new Recorder(makeSpace(), { keyframeEvery: 0 });
      r.recordFrame(null);
      r.recordFrame(null);
      const p = new Player(r.finish(), null);
      p.restore();
      p.step();
      p.step();
      expect(p.finished).toBe(true);
    });
  });
});
