import {
  Body, BodyType, Vec2, Circle, Capsule, Polygon, Material,
  DistanceJoint, LineJoint, SpringJoint, PivotJoint, AngleJoint,
  InteractionFilter,
} from "../nape-js.esm.js";

import { drawBody, drawGrid } from "../renderer.js";

// ── Constants ──────────────────────────────────────────────────────────────
const WORLD_W = 5600;
const WORLD_H = 1400;
const CAR_COUNT = 6;
const CAR_W = 60;
const CAR_H = 30;
const CAR_WALL = 4;
const CAR_GAP = 12;
const PASSENGERS_PER_CAR = 3;
const PASSENGER_R = 5.5;      // capsule radius (half-width)
const PASSENGER_LEN = 18;     // capsule total length (head-to-toe)
const WHEEL_R = 10;
const WHEEL_DX = CAR_W * 0.32;

// Collision filter bits
const F_TRACK = 1;
const F_WHEEL = 2;
const F_CHASSIS = 4;
const F_PASSENGER = 8;

// Suspension geometry
const SUSP_REST = 6;

// ── Module state ──────────────────────────────────────────────────────────
let _cars = [];
let _trackPoints = []; // [{ x, y, tan, side, s }]
let _space = null;

// ── Centerline construction ──────────────────────────────────────────────
// Hermite key points with smoothstep interpolation. Tangent is
// horizontal (h'(0) = h'(1) = 0) at every key point — so adjacent
// segments join smoothly without tangent jumps.

function buildCenterline() {
  const pts = [];
  const STEP = 8;

  const stageStartX = -CAR_COUNT * (CAR_W + CAR_GAP) - 80;
  const startY = 350;

  // Big lift-hill drop, then a series of progressively-smaller humps,
  // each tall enough to be visible but shallow enough that residual
  // kinetic energy from the previous drop carries the train over.
  const sections = [
    { x: stageStartX, y: startY - 30 },
    { x: 80,          y: startY },           // top of lift hill
    { x: 700,         y: startY + 420 },     // big drop
    { x: 1100,        y: startY + 240 },     // hump 1
    { x: 1500,        y: startY + 500 },     // valley
    { x: 1900,        y: startY + 340 },     // hump 2
    { x: 2300,        y: startY + 560 },     // valley
    { x: 2700,        y: startY + 440 },     // hump 3
    { x: 3100,        y: startY + 640 },     // valley
    { x: 3500,        y: startY + 540 },     // hump 4
    { x: 3900,        y: startY + 720 },     // valley
    { x: 4500,        y: startY + 820 },     // long descent
    { x: 5100,        y: startY + 760 },     // run-out hump
    { x: WORLD_W - 80, y: startY + 600 },    // finish
  ];

  let lastPt = null;
  for (const seg of sections) {
    if (lastPt) {
      const nSteps = Math.max(2, Math.round(Math.abs(seg.x - lastPt.x) / STEP));
      for (let j = 1; j <= nSteps; j++) {
        const t = j / nSteps;
        const h = t * t * (3 - 2 * t); // smoothstep
        const x = lastPt.x + (seg.x - lastPt.x) * t;
        const y = lastPt.y + (seg.y - lastPt.y) * h;
        pts.push({ x, y });
      }
    } else {
      pts.push({ x: seg.x, y: seg.y });
    }
    lastPt = { x: seg.x, y: seg.y };
  }

  // Tangent + side (channel-cap normal) + arclength
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const tx = dx / len, ty = dy / len;
    pts[i].tan = { x: tx, y: ty };
    // `side` = right-hand normal (ty, -tx). For flat ground this is
    // (0, -1) — i.e. up — pointing toward the channel-cap (upper rail).
    pts[i].side = { x: ty, y: -tx };
    if (i > 0) {
      s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    pts[i].s = s;
  }
  return pts;
}

function groundY(x) {
  if (!_trackPoints.length) return 700;
  let best = _trackPoints[0];
  let bestDx = Math.abs(best.x - x);
  for (const p of _trackPoints) {
    const d = Math.abs(p.x - x);
    if (d < bestDx) { best = p; bestDx = d; }
  }
  return best.y;
}

// ── Track body construction ───────────────────────────────────────────────
// Each segment between two centerline points becomes a thick "ground"
// polygon (centerline down to world floor). Gravity is the only force
// holding the wheels on the rail, which is plenty for a non-looping
// coaster track.

function buildTrackBodies(space) {
  const pts = _trackPoints;
  const trackFilter = new InteractionFilter(F_TRACK, F_WHEEL);
  // Low rail friction so the train keeps its kinetic energy through
  // a long sequence of humps. Just enough to grip on the staging
  // tilt so the cars start rolling under gravity.
  const railMat = new Material(0.02, 0.08, 0.15, 1);

  const bottomY = WORLD_H + 100;

  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];

    const groundVerts = [
      new Vec2(p0.x, p0.y),
      new Vec2(p1.x, p1.y),
      new Vec2(p1.x, bottomY),
      new Vec2(p0.x, bottomY),
    ];
    const ground = new Body(BodyType.STATIC);
    ground.shapes.add(new Polygon(groundVerts, undefined, railMat, trackFilter));
    ground.userData._isTrack = true;
    ground.userData._hidden = true;
    ground.space = space;
  }
}

// ── Train construction ───────────────────────────────────────────────────

function buildTrain(space) {
  const passengerMat = new Material(0.05, 0.4, 0.5, 0.5);
  const chassisMat = new Material(0.1, 0.4, 0.5, 1);
  // Low wheel friction matches the rail — minimises rolling
  // resistance so kinetic energy carries the train across humps.
  const wheelMat = new Material(0.05, 0.1, 0.2, 2);
  // Heavy floor ballast: keeps the chassis's centre of mass low and
  // gives the train enough inertia to coast over the smaller humps
  // without stalling.
  const ballastMat = new Material(0.1, 0.4, 0.5, 16);
  const fWheel = new InteractionFilter(F_WHEEL, F_TRACK);
  const fChassis = new InteractionFilter(F_CHASSIS, F_PASSENGER);
  const fPassenger = new InteractionFilter(
    F_PASSENGER,
    F_CHASSIS | F_PASSENGER,
  );

  const carColors = [0, 1, 2, 3, 4, 5];
  const carSpacing = CAR_W + CAR_GAP;
  const startX = 40;

  let prevChassis = null;
  for (let c = 0; c < CAR_COUNT; c++) {
    const cx = startX - c * carSpacing;
    const groundAtCx = groundY(cx);
    const cy = groundAtCx - WHEEL_R - SUSP_REST - CAR_H * 0.5;

    const halfW = CAR_W * 0.5;
    const halfH = CAR_H * 0.5;
    const wallT = CAR_WALL;

    // ─ Chassis ─
    const chassis = new Body(BodyType.DYNAMIC, new Vec2(cx, cy));
    chassis.shapes.add(new Polygon([
      new Vec2(-halfW,  halfH - wallT),
      new Vec2( halfW,  halfH - wallT),
      new Vec2( halfW,  halfH),
      new Vec2(-halfW,  halfH),
    ], undefined, ballastMat, fChassis));
    chassis.shapes.add(new Polygon([
      new Vec2(-halfW, -halfH),
      new Vec2(-halfW + wallT, -halfH),
      new Vec2(-halfW + wallT,  halfH - wallT),
      new Vec2(-halfW,  halfH - wallT),
    ], undefined, chassisMat, fChassis));
    chassis.shapes.add(new Polygon([
      new Vec2( halfW - wallT, -halfH),
      new Vec2( halfW, -halfH),
      new Vec2( halfW,  halfH - wallT),
      new Vec2( halfW - wallT,  halfH - wallT),
    ], undefined, chassisMat, fChassis));
    chassis.userData._colorIdx = carColors[c % carColors.length];
    chassis.userData._isCar = true;
    chassis.space = space;

    // ─ Wheels ─
    const fwx = cx + WHEEL_DX;
    const fwy = cy + halfH + SUSP_REST;
    const rwx = cx - WHEEL_DX;
    const rwy = cy + halfH + SUSP_REST;

    const frontWheel = new Body(BodyType.DYNAMIC, new Vec2(fwx, fwy));
    frontWheel.shapes.add(new Circle(WHEEL_R, undefined, wheelMat, fWheel));
    frontWheel.userData._isWheel = true;
    frontWheel.userData._colorIdx = 1;
    frontWheel.space = space;

    const rearWheel = new Body(BodyType.DYNAMIC, new Vec2(rwx, rwy));
    rearWheel.shapes.add(new Circle(WHEEL_R, undefined, wheelMat, fWheel));
    rearWheel.userData._isWheel = true;
    rearWheel.userData._colorIdx = 1;
    rearWheel.space = space;

    // ─ Suspension: SpringJoint + LineJoint pattern
    const fSusp = new SpringJoint(
      chassis, frontWheel,
      new Vec2(+WHEEL_DX, halfH - 1), new Vec2(0, 0),
      SUSP_REST,
    );
    fSusp.frequency = 6;
    fSusp.damping = 1.0;
    fSusp.space = space;
    const rSusp = new SpringJoint(
      chassis, rearWheel,
      new Vec2(-WHEEL_DX, halfH - 1), new Vec2(0, 0),
      SUSP_REST,
    );
    rSusp.frequency = 6;
    rSusp.damping = 1.0;
    rSusp.space = space;
    new LineJoint(
      chassis, frontWheel,
      new Vec2(+WHEEL_DX, halfH - 1), new Vec2(0, 0),
      new Vec2(0, 1), SUSP_REST - 3, SUSP_REST + 3,
    ).space = space;
    new LineJoint(
      chassis, rearWheel,
      new Vec2(-WHEEL_DX, halfH - 1), new Vec2(0, 0),
      new Vec2(0, 1), SUSP_REST - 3, SUSP_REST + 3,
    ).space = space;

    // ─ Passengers ─ upright capsules pinned by the feet to the floor.
    //
    // Capsule geometry: local long axis along x, +halfLen is the right
    // tip, -halfLen is the left tip. body.rotation = +PI/2 rotates the
    // capsule so the +halfLen tip ends up directly below the body's
    // centre — that's the "feet". A PivotJoint anchors those feet to
    // a seat point on the chassis floor.
    //
    // An AngleJoint provides a wide-range, very soft spring around the
    // upright orientation (chassis.rotation + PI/2) — passengers tilt
    // forward on drops, back on climbs, and oscillate freely with the
    // car's motion before settling back upright.
    const passengers = [];
    const halfLen = (PASSENGER_LEN - PASSENGER_R * 2) * 0.5;
    const seatPitch = PASSENGER_R * 2 + 4;
    const seatYOnFloor = halfH - 1; // top surface of chassis floor (local y)
    for (let p = 0; p < PASSENGERS_PER_CAR; p++) {
      const seatLx = (p - (PASSENGERS_PER_CAR - 1) / 2) * seatPitch;
      const seatLocal = new Vec2(seatLx, seatYOnFloor);

      // Spawn the passenger upright at the seat: feet on the floor,
      // body centre `halfLen` above the floor.
      const px = cx + seatLx;
      const py = cy + seatYOnFloor - halfLen;
      const pas = new Body(BodyType.DYNAMIC, new Vec2(px, py));
      pas.shapes.add(
        new Capsule(PASSENGER_LEN, PASSENGER_R * 2, undefined, passengerMat, fPassenger),
      );
      pas.rotation = Math.PI / 2; // upright (feet at +halfLen → below)
      pas.userData._colorIdx = (c * 2 + p + 2) % 6;
      pas.userData._isPassenger = true;
      pas.space = space;

      // Pin the feet (+halfLen along the capsule's long axis) to the
      // seat on the chassis floor. After body.rotation = +PI/2 this
      // point is in world coordinates directly below body.position,
      // i.e. at the seat.
      const pin = new PivotJoint(
        chassis, pas,
        seatLocal, new Vec2(halfLen, 0),
      );
      pin.space = space;

      // Soft spring around WORLD-vertical (not chassis-relative).
      // This is the key to visible swaying: if the spring were
      // chassis-relative, the passenger would tilt with the chassis
      // and look glued to it. With a world-vertical reference, the
      // passenger lags behind the chassis's rotation, getting flung
      // forward on drops and backward on climbs by pure inertia.
      // Range ±100°, very low frequency so the swing oscillates
      // visibly before settling.
      const lean = new AngleJoint(
        space.world, pas,
        Math.PI / 2 - 1.75,
        Math.PI / 2 + 1.75,
        1,
      );
      lean.stiff = false;
      lean.frequency = 0.8;
      lean.damping = 0.05;
      lean.space = space;

      passengers.push(pas);
    }

    // ─ Coupler ─ stiff DistanceJoint anchored at chassis floor.
    if (prevChassis) {
      const anchorReach = CAR_W * 0.5 + CAR_GAP * 0.5;
      const coupler = new DistanceJoint(
        prevChassis, chassis,
        new Vec2(-anchorReach, halfH - 2),
        new Vec2(+anchorReach, halfH - 2),
        0, 0,
      );
      coupler.stiff = true;
      coupler.space = space;
    }

    _cars.push({ chassis, frontWheel, rearWheel, passengers });
    prevChassis = chassis;
  }
}

export default {
  id: "rollercoaster",
  label: "Rollercoaster",
  featured: true,
  tags: ["SpringJoint", "LineJoint", "PivotJoint", "AngleJoint", "DistanceJoint", "Capsule", "Camera"],
  desc:
    "A 6-car train with sprung suspension rolls along a long hilly " +
    "track. Each car carries upright capsule passengers pinned by the " +
    "feet — they sway forward and back through every drop and crest. " +
    "Pure gravity, no motors.",
  walls: false,
  canvas2dOnly: true,
  camera: null,

  setup(space, W, H) {
    _space = space;
    space.gravity = new Vec2(0, 900);
    _cars = [];
    _trackPoints = buildCenterline();
    buildTrackBodies(space);

    const floor = new Body(BodyType.STATIC, new Vec2(WORLD_W * 0.5, WORLD_H + 300));
    floor.shapes.add(new Polygon(Polygon.box(WORLD_W * 2, 80)));
    floor.userData._hidden = true;
    floor.space = space;

    buildTrain(space);

    const head = _cars[0].chassis;
    const stageStartX = -CAR_COUNT * (CAR_W + CAR_GAP) - 80;
    this.camera = {
      follow: head,
      offsetX: 100,
      offsetY: -40,
      bounds: { minX: stageStartX, minY: 0, maxX: WORLD_W, maxY: WORLD_H },
      lerp: 0.06,
    };
  },

  step(space, W, H) {
    if (!_cars.length) return;
    for (const car of _cars) {
      car.chassis.force = new Vec2(0, 0);
    }
    // Passengers are pinned to the chassis by PivotJoint — they can't
    // escape, so the previous "respawn out-of-bounds passengers" loop
    // is no longer needed.
  },

  render(ctx, space, W, H, debugDraw, camX, camY) {
    ctx.save();
    ctx.translate(-camX, -camY);

    drawGrid(ctx, W, H, camX, camY);

    // Continuous ground silhouette
    ctx.fillStyle = "#0e1622";
    const pts = _trackPoints;
    if (pts.length) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      const lastP = pts[pts.length - 1];
      ctx.lineTo(lastP.x, WORLD_H + 100);
      ctx.lineTo(pts[0].x, WORLD_H + 100);
      ctx.closePath();
      ctx.fill();
    }

    // Rail surface highlight (single line on top of the ground)
    ctx.strokeStyle = "#3a4a5e";
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (pts.length) {
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();

    // Sleepers
    ctx.strokeStyle = "#4a5a6e";
    ctx.lineWidth = 1;
    for (let i = 0; i < pts.length; i += 3) {
      const p = pts[i];
      if (!p.side) continue;
      const n = p.side;
      ctx.beginPath();
      ctx.moveTo(p.x - n.x * 1, p.y - n.y * 1);
      ctx.lineTo(p.x + n.x * 8, p.y + n.y * 8);
      ctx.stroke();
    }

    // Bodies
    for (const body of space.bodies) {
      if (body.userData?._hidden) continue;
      drawBody(ctx, body, debugDraw);
    }

    // Coupler lines
    ctx.strokeStyle = "#d29922cc";
    ctx.lineWidth = 2;
    for (let i = 0; i < _cars.length - 1; i++) {
      const a = _cars[i].chassis.position;
      const b = _cars[i + 1].chassis.position;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    ctx.restore();

    // HUD
    ctx.save();
    ctx.fillStyle = "rgba(20,28,40,0.7)";
    ctx.fillRect(12, 12, 200, 60);
    ctx.fillStyle = "#cdd9e5";
    ctx.font = "12px monospace";
    if (_cars.length) {
      const head = _cars[0].chassis;
      const v = head.velocity;
      const speed = Math.hypot(v.x, v.y);
      ctx.fillText("Cars: " + CAR_COUNT, 22, 32);
      ctx.fillText("Speed: " + speed.toFixed(0) + " px/s", 22, 50);
      ctx.fillText("X: " + head.position.x.toFixed(0), 22, 68);
    }
    ctx.restore();
  },
};
