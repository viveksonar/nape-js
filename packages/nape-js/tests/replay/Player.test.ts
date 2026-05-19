import { describe, it, expect } from "vitest";
import "../../src/core/engine";
import { Space } from "../../src/space/Space";
import { Body } from "../../src/phys/Body";
import { BodyType } from "../../src/phys/BodyType";
import { Vec2 } from "../../src/geom/Vec2";
import { Circle } from "../../src/shape/Circle";
import { Polygon } from "../../src/shape/Polygon";
import { PivotJoint } from "../../src/constraint/PivotJoint";
import { BodyListener } from "../../src/callbacks/BodyListener";
import { CbEvent } from "../../src/callbacks/CbEvent";
import { CbType } from "../../src/callbacks/CbType";
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

  // Edge cases requested by issue #169.
  describe("mid-recording mutation & divergence", () => {
    it("keyframe restore mid-constraint-solve preserves the joint", () => {
      // Two bodies bolted with a PivotJoint — keyframe restore must rebuild
      // the constraint AND the bodies so the post-restore solve is identical
      // to the recording's solve at the same frame.
      const recordSpace = new Space(new Vec2(0, 600));
      recordSpace.deterministic = true;
      const anchor = new Body(BodyType.STATIC, new Vec2(0, 0));
      anchor.space = recordSpace;
      const swing = new Body(BodyType.DYNAMIC, new Vec2(40, 0));
      swing.shapes.add(new Circle(5));
      swing.space = recordSpace;
      const joint = new PivotJoint(anchor, swing, new Vec2(0, 0), new Vec2(0, 0));
      joint.space = recordSpace;

      const r = new Recorder(recordSpace, { keyframeEvery: 5 });
      for (let i = 0; i < 25; i++) {
        r.recordFrame(null);
        recordSpace.step(1 / 60);
      }
      const replay = r.finish();

      // Capture recording's pendulum position at frame 15.
      const recordPosAt15 = (() => {
        const checkSpace = new Space(new Vec2(0, 600));
        checkSpace.deterministic = true;
        const a = new Body(BodyType.STATIC, new Vec2(0, 0));
        a.space = checkSpace;
        const s = new Body(BodyType.DYNAMIC, new Vec2(40, 0));
        s.shapes.add(new Circle(5));
        s.space = checkSpace;
        const j = new PivotJoint(a, s, new Vec2(0, 0), new Vec2(0, 0));
        j.space = checkSpace;
        for (let i = 0; i < 15; i++) checkSpace.step(1 / 60);
        return { x: s.position.x, y: s.position.y };
      })();

      const p = new Player(replay);
      p.restore();
      p.stepTo(20); // step past the target
      p.stepTo(15); // backward jump triggers keyframe restore at frame 15
      // Find the swung body — the only dynamic in the deserialised space.
      let restored: Body | null = null;
      for (let i = 0; i < p.space.bodies.length; i++) {
        const b = p.space.bodies.at(i);
        if (b.isDynamic()) restored = b;
      }
      expect(restored).not.toBeNull();
      expect(restored!.position.x).toBeCloseTo(recordPosAt15.x, 4);
      expect(restored!.position.y).toBeCloseTo(recordPosAt15.y, 4);
      // The deserialised space must still hold one constraint (the pivot).
      expect(p.space.constraints.length).toBe(1);
    });

    it("listeners on the recording space do not fire during playback", () => {
      // A listener attached to the recording space must not leak into the
      // Player's space — snapshots only carry physics state.
      const recordSpace = new Space(new Vec2(0, 600));
      recordSpace.deterministic = true;
      const ball = new Body(BodyType.DYNAMIC, new Vec2(100, 100));
      ball.shapes.add(new Circle(10));
      ball.space = recordSpace;
      // Floor goes in BEFORE the recorder so the initial snapshot captures it.
      const floor = new Body(BodyType.STATIC, new Vec2(100, 400));
      floor.shapes.add(new Polygon(Polygon.box(400, 20)));
      floor.space = recordSpace;

      let recordingFires = 0;
      const listener = new BodyListener(CbEvent.SLEEP, CbType.ANY_BODY, () => {
        recordingFires++;
      });
      listener.space = recordSpace;

      const r = new Recorder(recordSpace, { keyframeEvery: 0 });
      for (let i = 0; i < 240; i++) {
        r.recordFrame(null);
        recordSpace.step(1 / 60);
      }
      const replay = r.finish();
      const baselineFires = recordingFires;
      expect(baselineFires).toBeGreaterThan(0);

      // Now play back — the Player owns a freshly-deserialised space; the
      // original listener is bound to the recording space, not this one.
      let playbackFires = 0;
      const stray = new BodyListener(CbEvent.SLEEP, CbType.ANY_BODY, () => {
        playbackFires++;
      });
      // Intentionally bind to the recording space, not the player's.
      stray.space = recordSpace;

      const p = new Player(replay);
      p.restore();
      while (!p.finished) p.step();

      expect(playbackFires).toBe(0);
      // Sanity — recording listener count is frozen (no extra fires from
      // stepping a different space).
      expect(recordingFires).toBe(baselineFires);
      // And the player's space has zero listeners (snapshot omits them).
      expect(p.space.listeners.length).toBe(0);
    });

    it("listener can be re-attached to the player's space and fires normally", () => {
      // Companion to the suppression test: the user can opt back in by
      // registering a listener on the player's space after restore().
      const recordSpace = new Space(new Vec2(0, 600));
      recordSpace.deterministic = true;
      const ball = new Body(BodyType.DYNAMIC, new Vec2(100, 100));
      ball.shapes.add(new Circle(10));
      ball.space = recordSpace;
      const floor = new Body(BodyType.STATIC, new Vec2(100, 400));
      floor.shapes.add(new Polygon(Polygon.box(400, 20)));
      floor.space = recordSpace;

      const r = new Recorder(recordSpace, { keyframeEvery: 0 });
      for (let i = 0; i < 240; i++) {
        r.recordFrame(null);
        recordSpace.step(1 / 60);
      }
      const replay = r.finish();

      const p = new Player(replay);
      const playSpace = p.restore();
      let fires = 0;
      const listener = new BodyListener(CbEvent.SLEEP, CbType.ANY_BODY, () => {
        fires++;
      });
      listener.space = playSpace;
      while (!p.finished) p.step();
      expect(fires).toBeGreaterThan(0);
    });

    it("restore against diverged state overwrites the player's space", () => {
      // Even if the caller has mutated the player's current space mid-flight
      // (simulating divergence), restore/stepTo from a keyframe must produce
      // a fresh space matching the recording — not patch the diverged one.
      const recordSpace = makeSpace();
      const r = new Recorder(recordSpace, { keyframeEvery: 5 });
      for (let i = 0; i < 25; i++) {
        r.recordFrame(null);
        recordSpace.step(1 / 60);
      }
      const replay = r.finish();

      const p = new Player(replay);
      p.restore();
      p.stepTo(10);

      // Diverge: violently teleport the dynamic body off-screen.
      const ballBefore = findDynamic(p.space);
      ballBefore.position = new Vec2(99999, 99999);
      ballBefore.velocity = new Vec2(0, 0);

      // Backward jump must restore via the frame-5 keyframe, *not* keep the
      // diverged state.
      p.stepTo(5);
      const ballAfter = findDynamic(p.space);
      expect(ballAfter.position.x).toBeLessThan(1000);
      expect(ballAfter.position.y).toBeLessThan(1000);

      // Re-step to 10 — the recording's frame-10 state should be reproduced
      // bit-for-bit (within float tolerance), proving the diverged values
      // were discarded.
      p.stepTo(10);
      // Capture recording's frame-10 state from a fresh re-record.
      const recordedAt10 = (() => {
        const s = makeSpace();
        for (let i = 0; i < 10; i++) s.step(1 / 60);
        return findDynamic(s);
      })();
      const replayedAt10 = findDynamic(p.space);
      expect(replayedAt10.position.x).toBeCloseTo(recordedAt10.position.x, 6);
      expect(replayedAt10.position.y).toBeCloseTo(recordedAt10.position.y, 6);
    });
  });
});
