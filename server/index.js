/**
 * nape-js Multiplayer Platformer Server
 *
 * Server-authoritative character controller platformer at 60 Hz.
 * Full level from the single-player character controller demo,
 * with per-player CharacterController instances, coins, and dynamic objects.
 *
 * Protocol:
 *   Client → Server (JSON):
 *     { type: "input", keys: { left, right, jump }, events: ["jumpPressed"|"jumpReleased"] }
 *   Server → Client (JSON, on join):
 *     { type: "init", playerId, bodyId, colorIdx, worldW, worldH, level, coins, dynamicObjects, ... }
 *   Server → All (Binary, every frame):
 *     [bodyCount: Uint16] + per body: [id: Uint16, x: Float32, y: Float32, rot: Float32]
 *   Server → All (JSON, on player join/leave):
 *     { type: "players", count, players: [{id, colorIdx, bodyId}] }
 *   Server → All (JSON, on coin pickup/respawn):
 *     { type: "coin_pickup", coinId, playerId }
 *     { type: "coin_respawn", coinIds: [...] }
 */

import { createServer } from "http";
import { WebSocketServer } from "ws";
import {
  Space, Body, BodyType, Vec2, Circle, Capsule, Polygon, Material,
  CbType, CbEvent, InteractionType, InteractionListener, PreListener, PreFlag,
  FluidProperties, CharacterController,
} from "@newkrok/nape-js";

// ─── Constants ───────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
const WORLD_W = 4000;
const WORLD_H = 600;
const TICK_MS = 1000 / 60;
const DT = 1 / 60;
const MAX_PLAYERS = 8;

// Player dimensions (capsule)
const PLAYER_W = 20;
const PLAYER_H = 36;
const PLAYER_R = PLAYER_W / 2;

// Movement constants
const MOVE_SPEED = 180;
const JUMP_SPEED = 380;
const COYOTE_MS = 100;
const JUMP_BUFFER_MS = 100;
const WALL_JUMP_VX = 200;
const WALL_JUMP_VY = -340;
const WALL_SLIDE_MAX_VY = 80;
const WALL_JUMP_LOCK_MS = 150;
const ICE_ACCEL = 300;
const ICE_DECEL = 150;
const BOUNCE_SPEED = 600;
const GRAVITY = 600;
const ONEWAY_GROUP = 1 << 9;

// Coin respawn
const COIN_RESPAWN_TICKS = 20 * 60; // 20 seconds at 60Hz

const PLAYER_COLORS = [
  { fill: "rgba(88,166,255,0.35)",  stroke: "#58a6ff" },
  { fill: "rgba(63,185,80,0.35)",   stroke: "#3fb950" },
  { fill: "rgba(248,81,73,0.35)",   stroke: "#f85149" },
  { fill: "rgba(210,153,34,0.35)",  stroke: "#d29922" },
  { fill: "rgba(163,113,247,0.35)", stroke: "#a371f7" },
  { fill: "rgba(219,171,255,0.35)", stroke: "#dbabff" },
  { fill: "rgba(77,208,225,0.35)",  stroke: "#4dd0e1" },
  { fill: "rgba(255,138,101,0.35)", stroke: "#ff8a65" },
];

// ─── Physics world ────────────────────────────────────────────────────────────

const space = new Space();
space.gravity = new Vec2(0, GRAVITY);

let nextBodyId = 1;
const dynamicBodies = new Map(); // id → Body
const levelDescriptor = [];      // static geometry for init packet

// CbTypes
const platformTag = new CbType();
const playerTag = new CbType();
const coinTag = new CbType();

const floorY = WORLD_H - 10;

// ─── Helper functions ────────────────────────────────────────────────────────

function addStaticBox(cx, cy, w, h, desc) {
  const b = new Body(BodyType.STATIC, new Vec2(cx, cy));
  b.shapes.add(new Polygon(Polygon.box(w, h)));
  b.space = space;
  levelDescriptor.push({ type: "box", x: cx, y: cy, w, h, ...desc });
  return b;
}

function addOneWay(cx, cy, w) {
  const b = new Body(BodyType.STATIC, new Vec2(cx, cy));
  const shape = new Polygon(Polygon.box(w, 8));
  shape.cbTypes.add(platformTag);
  shape.filter.collisionGroup = ONEWAY_GROUP;
  b.shapes.add(shape);
  b.space = space;
  try { b.userData._colorIdx = 4; } catch (_) {}
  levelDescriptor.push({ type: "oneWay", x: cx, y: cy, w, h: 8 });
  return b;
}

function addSlopeRamp(startX, baseY, length, height, goingDown) {
  const cx = startX + length / 2;
  const cy = baseY - height / 2;
  const angle = Math.atan2(goingDown ? height : -height, length);
  const len = Math.sqrt(length * length + height * height);

  const b = new Body(BodyType.STATIC, new Vec2(cx, cy));
  b.shapes.add(new Polygon(Polygon.box(len, 12)));
  b.rotation = angle;
  b.space = space;
  levelDescriptor.push({ type: "slope", x: cx, y: cy, w: len, h: 12, angle });
  return b;
}

function addBouncePad(cx, cy, w) {
  const b = new Body(BodyType.STATIC, new Vec2(cx, cy));
  b.shapes.add(new Polygon(Polygon.box(w, 10), new Material(3, 0.5, 0.5, 1)));
  b.space = space;
  try {
    b.userData._color = { fill: "rgba(248,81,73,0.3)", stroke: "#f85149" };
    b.userData._isBounce = true;
  } catch (_) {}
  levelDescriptor.push({ type: "bounce", x: cx, y: cy, w, h: 10 });
  return b;
}

function addIce(cx, cy, w) {
  const b = new Body(BodyType.STATIC, new Vec2(cx, cy));
  b.shapes.add(new Polygon(Polygon.box(w, 12)));
  b.space = space;
  try {
    b.userData._color = { fill: "rgba(140,210,255,0.25)", stroke: "#8cd2ff" };
    b.userData._isIce = true;
  } catch (_) {}
  levelDescriptor.push({ type: "ice", x: cx, y: cy, w, h: 12 });
  return b;
}

// ─── Build level ─────────────────────────────────────────────────────────────

// Floor segments (with gaps)
addStaticBox(800, floorY, 1600, 20);
addStaticBox(2055, floorY, 210, 20);
addStaticBox(2760, floorY, 240, 20);
addStaticBox(3750, floorY, 500, 20);

// Left/right walls
addStaticBox(-10, WORLD_H / 2, 20, WORLD_H);
addStaticBox(WORLD_W + 10, WORLD_H / 2, 20, WORLD_H);

// Section 1: One-way platforms (x: 0–600)
addStaticBox(150, 500, 200, 16);
addOneWay(100, 440, 120);
addOneWay(280, 370, 100);
addOneWay(130, 300, 120);
addOneWay(380, 330, 80);

// Section 2: Steps (x: 500–900)
const stepBase = floorY - 10;
for (let i = 0; i < 8; i++) {
  addStaticBox(560 + i * 30, stepBase - i * 6, 28, 6 + i * 6);
}

// Section 3: Slopes (x: 900–1500)
addSlopeRamp(950, floorY - 10, 300, 80, false);
addStaticBox(1200, floorY - 80, 200, 16);
addSlopeRamp(1400, floorY - 10, 200, 80, true);

// Section 4: Moving platforms (x: 1500–2100)
addStaticBox(1550, floorY, 100, 20);
addStaticBox(1775, floorY + 80, 350, 20); // catch floor

const hPlatId = nextBodyId++;
const hPlat = new Body(BodyType.KINEMATIC, new Vec2(1750, floorY + 20));
hPlat.shapes.add(new Polygon(Polygon.box(100, 12), new Material(0, 2, 2, 1)));
hPlat.space = space;
hPlat._hMoving = { minX: 1650, maxX: 1900, speed: 80, _dir: 1 };
dynamicBodies.set(hPlatId, hPlat);

const vPlatId = nextBodyId++;
const vPlat = new Body(BodyType.KINEMATIC, new Vec2(2000, floorY - 100));
vPlat.shapes.add(new Polygon(Polygon.box(80, 12)));
vPlat.space = space;
vPlat._vMoving = { minY: floorY - 200, maxY: floorY - 50, speed: 60, _dir: 1 };
dynamicBodies.set(vPlatId, vPlat);

addStaticBox(2100, floorY - 200, 100, 16);

// Section 5: Water (x: 2160–2640)
const poolL = 2160, poolR = 2640, poolCX = 2400;
const poolTop = floorY, poolBot = floorY + 110;
const poolH = poolBot - poolTop;
addStaticBox(poolCX, poolBot, poolR - poolL + 20, 20);
addStaticBox(poolL - 10, poolTop + poolH / 2, 20, poolH);
addStaticBox(poolR + 10, poolTop + poolH / 2, 20, poolH);

const water = new Body(BodyType.STATIC, new Vec2(poolCX, poolTop + poolH / 2));
const waterShape = new Polygon(Polygon.box(poolR - poolL, poolH));
waterShape.fluidEnabled = true;
waterShape.fluidProperties = new FluidProperties(1.5, 3);
water.shapes.add(waterShape);
water.space = space;
water._isWater = true;
levelDescriptor.push({ type: "water", x: poolCX, y: poolTop + poolH / 2, w: poolR - poolL, h: poolH });

// Section 6: Wall-jump shaft (x: 2680–2820)
const shaftL = 2680, shaftR = 2820;
const shaftW = 16;
const shaftH = 300;
const shaftTop = floorY - shaftH;
const shaftCY = floorY - shaftH / 2;
const doorH = 60;
const leftSolidH = shaftH - doorH;
const leftCY = shaftTop + leftSolidH / 2;
addStaticBox(shaftL, leftCY, shaftW, leftSolidH);
addStaticBox(shaftR, shaftCY, shaftW, shaftH);
addOneWay((shaftL + shaftR) / 2, shaftTop, shaftR - shaftL + 40);

// Bounce pads
addBouncePad(2850, floorY - 6, 50);

// Section 6b: Ice zone (x: 2880–3500)
addIce(3190, floorY - 6, 620);
addStaticBox(3000, floorY - 20, 16, 40);
addStaticBox(3250, floorY - 20, 16, 40);

// Bounce pad to final stretch
addBouncePad(3520, floorY - 6, 50);

// Section 7: Final stretch (x: 3500–3900)
addOneWay(3600, 400, 100);
addOneWay(3700, 330, 80);
addStaticBox(3800, 280, 100, 16);

// ─── Coins ───────────────────────────────────────────────────────────────────

const COIN_POSITIONS = [
  // Section 1: ground-level + platform coins
  { x: 200, y: floorY - 30 },
  { x: 300, y: floorY - 30 },
  { x: 400, y: floorY - 30 },
  { x: 100, y: 418 },
  { x: 280, y: 348 },
  { x: 380, y: 308 },
  // Section 2: top of steps
  { x: 760, y: stepBase - 70 },
  // Section 3: slopes
  { x: 1200, y: floorY - 110 },
  { x: 1050, y: floorY - 50 },
  // Section 4: moving platforms
  { x: 2100, y: floorY - 230 },
  { x: 1750, y: floorY - 80 },
  // Section 5: water
  { x: 2300, y: floorY + 20 },
  { x: 2500, y: floorY + 20 },
  // Section 6: wall-jump shaft
  { x: (shaftL + shaftR) / 2, y: floorY - 80 },
  { x: (shaftL + shaftR) / 2, y: floorY - 180 },
  { x: (shaftL + shaftR) / 2, y: shaftTop - 30 },
  // Section 6b: ice zone
  { x: 2900, y: floorY - 30 },
  { x: 3100, y: floorY - 30 },
  { x: 3300, y: floorY - 30 },
  // Section 7: final
  { x: 3800, y: 250 },
];

// Coin state: body reference and respawn timer
const coins = COIN_POSITIONS.map((pos, id) => ({
  id,
  x: pos.x,
  y: pos.y,
  body: null,
  alive: false,
  respawnTimer: 0,
}));

function spawnCoin(coin) {
  const b = new Body(BodyType.STATIC, new Vec2(coin.x, coin.y));
  const shape = new Circle(5);
  shape.sensorEnabled = true;
  shape.cbTypes.add(coinTag);
  b.shapes.add(shape);
  b.space = space;
  b._coinId = coin.id;
  coin.body = b;
  coin.alive = true;
  coin.respawnTimer = 0;
}

// Spawn all coins initially
for (const coin of coins) spawnCoin(coin);

// ─── Coin pickup listener ────────────────────────────────────────────────────

const coinListener = new InteractionListener(
  CbEvent.BEGIN,
  InteractionType.SENSOR,
  playerTag,
  coinTag,
  (cb) => {
    const i1 = cb.int1;
    const i2 = cb.int2;
    const b1 = i1.castBody ?? i1.castShape?.body ?? null;
    const b2 = i2.castBody ?? i2.castShape?.body ?? null;

    // Find which is the coin body and which is the player body
    let coinBody = null;
    let playerBody = null;
    for (const [, p] of players) {
      if (b1 === p.body) { playerBody = b1; coinBody = b2; break; }
      if (b2 === p.body) { playerBody = b2; coinBody = b1; break; }
    }
    if (!coinBody || coinBody._coinId === undefined) return;
    if (!coinBody.space) return;

    const coinId = coinBody._coinId;
    const coin = coins[coinId];
    if (!coin || !coin.alive) return;

    // Remove coin
    coinBody.space = null;
    coin.alive = false;
    coin.body = null;
    coin.respawnTimer = COIN_RESPAWN_TICKS;

    // Find player who picked it up
    let pickupPlayerId = null;
    for (const [pid, p] of players) {
      if (p.body === playerBody) { pickupPlayerId = pid; break; }
    }

    broadcastJSONAll({ type: "coin_pickup", coinId, playerId: pickupPlayerId });
  },
);
coinListener.space = space;

// ─── Dynamic scattered objects ───────────────────────────────────────────────

const sceneObjects = [];

// Note: Polygon shapes with explicit Material tunnel through floors (engine bug).
// Circles are unaffected. Workaround: omit Material for Polygon shapes (defaults work fine).
function spawnObject(x, y, shape, size) {
  const id = nextBodyId++;
  const body = new Body(BodyType.DYNAMIC, new Vec2(x, y));
  if (shape === "circle") {
    body.shapes.add(new Circle(size, undefined, new Material(0.3, 0.5, 0.4, 1)));
  } else {
    body.shapes.add(new Polygon(Polygon.box(size, size)));
  }
  body.isBullet = true;
  body.space = space;
  dynamicBodies.set(id, body);
  sceneObjects.push({ id, shape, size, x, y });
  return { id, shape, size, x, y };
}

// Scatter objects around the level (mix of visual circles and boxes)
// Section 1 area
spawnObject(250, floorY - 30, "circle", 14);
spawnObject(420, floorY - 40, "box", 28);
// Steps area
spawnObject(650, floorY - 70, "circle", 12);
// Slope area
spawnObject(1100, floorY - 110, "circle", 16);
spawnObject(1350, floorY - 110, "box", 26);
// Near moving platforms
spawnObject(1580, floorY - 35, "circle", 14);
// Ice zone
spawnObject(2950, floorY - 30, "box", 24);
spawnObject(3200, floorY - 30, "circle", 13);
spawnObject(3400, floorY - 30, "circle", 15);
// Final area
spawnObject(3700, 245, "box", 22);
spawnObject(3850, floorY - 30, "circle", 14);

// Moving platform descriptors for init packet
const movingPlatforms = [
  { bodyId: hPlatId, w: 100, h: 12, type: "hPlat" },
  { bodyId: vPlatId, w: 80, h: 12, type: "vPlat" },
];

// ─── Player management ──────────────────────────────────────────────────────

let nextPlayerId = 1;
const players = new Map();
const spectators = new Set();

function spawnPlayer(ws) {
  if (players.size >= MAX_PLAYERS) return null;

  const playerId = nextPlayerId++;
  const colorIdx = (playerId - 1) % PLAYER_COLORS.length;
  const bodyId = nextBodyId++;

  const spawnX = 100 + Math.random() * 200;
  const body = new Body(BodyType.DYNAMIC, new Vec2(spawnX, floorY - 40));
  const playerShape = new Capsule(PLAYER_H, PLAYER_W, undefined, new Material(0, 0.3, 0.3, 1));
  playerShape.cbTypes.add(playerTag);
  body.shapes.add(playerShape);
  body.rotation = Math.PI / 2;
  body.allowRotation = false;
  body.isBullet = true;
  body.space = space;

  dynamicBodies.set(bodyId, body);

  const cc = new CharacterController(space, body, {
    maxSlopeAngle: Math.PI / 3,
    oneWayPlatformTag: platformTag,
    characterTag: playerTag,
  });

  const player = {
    ws, body, bodyId, colorIdx, cc,
    keys: { left: false, right: false, jump: false },
    jumpPressed: false,
    jumpReleased: false,
    prevJumpKey: false,
    jumpBufferTimer: 0,
    velY: 0,
    wallJumpLockTimer: 0,
    wallJumpKickVx: 0,
    wallSliding: false,
    lastWallJumpSide: 0,
    onIce: false,
    iceVx: 0,
  };
  players.set(playerId, player);

  return { playerId, bodyId, colorIdx };
}

function removePlayer(playerId) {
  const player = players.get(playerId);
  if (!player) return;
  player.cc.destroy();
  player.body.space = null;
  dynamicBodies.delete(player.bodyId);
  lastState.delete(player.bodyId);
  players.delete(playerId);
}

// ─── Per-player movement logic ──────────────────────────────────────────────

function updatePlayer(player) {
  const { body, keys, cc } = player;

  // Query state from last frame
  const result = cc.update();

  // Input
  const left = keys.left;
  const right = keys.right;
  const jumpKey = keys.jump;

  let moveX = 0;
  if (left) moveX = -MOVE_SPEED;
  if (right) moveX = MOVE_SPEED;

  // Check water
  let inWater = false;
  try {
    const arbs = space.arbiters;
    const arbCount = arbs.zpp_gl();
    for (let i = 0; i < arbCount; i++) {
      const a = arbs.at(i);
      if (a.isFluidArbiter() && (a.body1 === body || a.body2 === body)) {
        inWater = true;
        break;
      }
    }
  } catch (_) {}

  // Ice detection
  const wasOnIce = player.onIce;
  player.onIce = result.grounded && result.groundBody?.userData?._isIce;
  if (player.onIce) {
    if (!wasOnIce) player.iceVx = moveX;
    const targetVx = moveX;
    if (targetVx !== 0) {
      const diff = targetVx - player.iceVx;
      player.iceVx += Math.sign(diff) * Math.min(Math.abs(diff), ICE_ACCEL * DT);
    } else {
      if (Math.abs(player.iceVx) < ICE_DECEL * DT) {
        player.iceVx = 0;
      } else {
        player.iceVx -= Math.sign(player.iceVx) * ICE_DECEL * DT;
      }
    }
    moveX = player.iceVx;
  } else {
    player.iceVx = 0;
  }

  // Bounce pad
  const onBounce = result.grounded && result.groundBody?.userData?._isBounce;

  // Vertical velocity
  player.velY = body.velocity.y;

  // Jump buffering (use jumpPressed event from client)
  if (player.jumpPressed) {
    player.jumpBufferTimer = JUMP_BUFFER_MS;
    player.jumpPressed = false;
  } else {
    player.jumpBufferTimer = Math.max(0, player.jumpBufferTimer - 1000 * DT);
  }

  // Wall-jump lock timer
  player.wallJumpLockTimer = Math.max(0, player.wallJumpLockTimer - 1000 * DT);

  // Wall-slide detection
  const onWall = !result.grounded && (result.wallLeft || result.wallRight);
  const holdingIntoWall = (result.wallLeft && left) || (result.wallRight && right);
  player.wallSliding = onWall && holdingIntoWall && player.velY >= 0;

  if (result.grounded) player.lastWallJumpSide = 0;

  // Jump / swim / wall-jump
  const canJump = result.grounded || result.timeSinceGrounded * 1000 < COYOTE_MS || inWater;
  const wallSide = result.wallLeft ? -1 : result.wallRight ? 1 : 0;
  const canWallJump = !result.grounded && onWall && wallSide !== player.lastWallJumpSide;
  let jumped = false;
  let wallJumped = false;

  if (player.jumpBufferTimer > 0 && canJump) {
    player.velY = inWater ? -JUMP_SPEED * 0.7 : -JUMP_SPEED;
    player.jumpBufferTimer = 0;
    jumped = true;
    player.lastWallJumpSide = 0;
  } else if (player.jumpBufferTimer > 0 && canWallJump) {
    player.velY = WALL_JUMP_VY;
    player.wallJumpKickVx = result.wallLeft ? WALL_JUMP_VX : -WALL_JUMP_VX;
    moveX = player.wallJumpKickVx;
    player.wallJumpLockTimer = WALL_JUMP_LOCK_MS;
    player.jumpBufferTimer = 0;
    wallJumped = true;
    player.lastWallJumpSide = wallSide;
  }

  // Bounce pad
  if (onBounce) {
    player.velY = -BOUNCE_SPEED;
    jumped = true;
  }

  // Variable jump height
  if (player.jumpReleased && !inWater && !onBounce && player.velY < 0) {
    player.velY *= 0.85;
    player.jumpReleased = false;
  }
  if (!jumpKey && !inWater && !onBounce && player.velY < 0 && body.velocity.y < 0) {
    // Continuous variable jump cut when not holding jump
    const curVy = body.velocity.y;
    if (curVy < player.velY) player.velY = curVy * 0.85;
  }

  // Apply velocity
  const curVy = body.velocity.y;
  const platVx = result.onMovingPlatform ? result.groundBody.velocity.x : 0;

  let newVx;
  if (player.wallJumpLockTimer > 0) {
    newVx = player.wallJumpKickVx;
  } else {
    newVx = moveX + platVx;
  }

  let newVy = curVy;
  if (jumped || wallJumped) {
    newVy = player.velY;
  } else if (player.wallSliding && curVy > WALL_SLIDE_MAX_VY) {
    newVy = WALL_SLIDE_MAX_VY;
  } else if (!jumpKey && curVy < 0 && !inWater) {
    newVy = curVy * 0.85;
  }

  body.velocity = new Vec2(newVx, newVy);

  // Clamp to world bounds
  const px = body.position.x;
  const py = body.position.y;
  if (px < PLAYER_R || px > WORLD_W - PLAYER_R) {
    body.position = new Vec2(
      Math.max(PLAYER_R, Math.min(WORLD_W - PLAYER_R, px)),
      py,
    );
  }

  // Respawn if fallen too far
  if (py > WORLD_H + 200) {
    body.position = new Vec2(100, floorY - 40);
    body.velocity = new Vec2(0, 0);
  }
}

// ─── Moving platform updates ────────────────────────────────────────────────

function updateMovingPlatforms() {
  for (const [, body] of dynamicBodies) {
    if (body._hMoving) {
      const m = body._hMoving;
      const px = body.position.x;
      if (px >= m.maxX) m._dir = -1;
      if (px <= m.minX) m._dir = 1;
      body.velocity = new Vec2(m._dir * m.speed, 0);
    }
    if (body._vMoving) {
      const m = body._vMoving;
      const py = body.position.y;
      if (py >= m.maxY) m._dir = -1;
      if (py <= m.minY) m._dir = 1;
      body.velocity = new Vec2(0, m._dir * m.speed);
    }
  }
}

// ─── Coin respawn logic ─────────────────────────────────────────────────────

function updateCoins() {
  const respawned = [];
  for (const coin of coins) {
    if (coin.alive) continue;
    if (coin.respawnTimer > 0) {
      coin.respawnTimer--;
      if (coin.respawnTimer <= 0) {
        spawnCoin(coin);
        respawned.push(coin.id);
      }
    }
  }
  if (respawned.length > 0) {
    broadcastJSONAll({ type: "coin_respawn", coinIds: respawned });
  }
}

// ─── Binary state frame (delta encoding) ────────────────────────────────────

const POS_THRESHOLD = 0.1;
const ROT_THRESHOLD = 0.001;
const lastState = new Map();

const FULL_SYNC_INTERVAL_MS = 2000;
let lastFullSyncTime = Date.now();

function buildStateFrame() {
  const changed = [];
  for (const [id, body] of dynamicBodies) {
    const x   = body.position.x;
    const y   = body.position.y;
    const rot = body.rotation;
    const prev = lastState.get(id);
    if (!prev) {
      changed.push({ id, x, y, rot });
      lastState.set(id, { x, y, rot, settled: false });
    } else if (
      Math.abs(x - prev.x)     > POS_THRESHOLD ||
      Math.abs(y - prev.y)     > POS_THRESHOLD ||
      Math.abs(rot - prev.rot) > ROT_THRESHOLD
    ) {
      changed.push({ id, x, y, rot });
      lastState.set(id, { x, y, rot, settled: false });
    } else if (!prev.settled) {
      changed.push({ id, x, y, rot });
      lastState.set(id, { x, y, rot, settled: true });
    }
  }
  if (changed.length === 0) return null;
  const buf = Buffer.allocUnsafe(2 + changed.length * 14);
  buf.writeUInt16LE(changed.length, 0);
  let offset = 2;
  for (const { id, x, y, rot } of changed) {
    buf.writeUInt16LE(id, offset);     offset += 2;
    buf.writeFloatLE(x,   offset);     offset += 4;
    buf.writeFloatLE(y,   offset);     offset += 4;
    buf.writeFloatLE(rot, offset);     offset += 4;
  }
  return buf;
}

function buildFullSnapshot() {
  const all = [];
  for (const [id, body] of dynamicBodies) {
    all.push({ id, x: body.position.x, y: body.position.y, rot: body.rotation });
  }
  if (all.length === 0) return null;
  const buf = Buffer.allocUnsafe(2 + all.length * 14);
  buf.writeUInt16LE(all.length, 0);
  let offset = 2;
  for (const { id, x, y, rot } of all) {
    buf.writeUInt16LE(id, offset);     offset += 2;
    buf.writeFloatLE(x,   offset);     offset += 4;
    buf.writeFloatLE(y,   offset);     offset += 4;
    buf.writeFloatLE(rot, offset);     offset += 4;
  }
  return buf;
}

// ─── Broadcast helpers ──────────────────────────────────────────────────────

function broadcastBinary(buf) {
  for (const [, player] of players) {
    if (player.ws.readyState === 1) player.ws.send(buf);
  }
  for (const ws of spectators) {
    if (ws.readyState === 1) ws.send(buf);
  }
}

function broadcastJSONAll(msg) {
  const str = JSON.stringify(msg);
  for (const [, player] of players) {
    if (player.ws.readyState === 1) player.ws.send(str);
  }
  for (const ws of spectators) {
    if (ws.readyState === 1) ws.send(str);
  }
}

function broadcastPlayerList() {
  broadcastJSONAll({
    type: "players",
    count: players.size,
    players: [...players.entries()].map(([id, p]) => ({ id, colorIdx: p.colorIdx, bodyId: p.bodyId })),
  });
}

// ─── Init packet ────────────────────────────────────────────────────────────

function buildInitPacket(playerId, bodyId, colorIdx) {
  return {
    type: "init",
    playerId,
    bodyId,
    colorIdx,
    worldW: WORLD_W,
    worldH: WORLD_H,
    level: levelDescriptor,
    coins: coins.map(c => ({ id: c.id, x: c.x, y: c.y, alive: c.alive })),
    sceneObjects,
    movingPlatforms,
    playerColors: PLAYER_COLORS,
    players: [...players.entries()].map(([id, p]) => ({ id, colorIdx: p.colorIdx, bodyId: p.bodyId })),
  };
}

// ─── Main loop ──────────────────────────────────────────────────────────────

let physicsInterval = null;

function getClientCount() {
  return players.size + spectators.size;
}

function startPhysicsLoop() {
  if (physicsInterval) return;
  console.log("Physics loop started (clients connected)");
  lastFullSyncTime = Date.now();
  lastState.clear();
  physicsInterval = setInterval(() => {
    updateMovingPlatforms();
    for (const [, player] of players) updatePlayer(player);
    space.step(DT);
    updateCoins();

    const now = Date.now();
    if (now - lastFullSyncTime >= FULL_SYNC_INTERVAL_MS) {
      lastFullSyncTime = now;
      const fullSnap = buildFullSnapshot();
      if (fullSnap) broadcastBinary(fullSnap);
      lastState.clear();
    } else {
      const frame = buildStateFrame();
      if (frame) broadcastBinary(frame);
    }
  }, TICK_MS);
}

function stopPhysicsLoop() {
  if (!physicsInterval) return;
  clearInterval(physicsInterval);
  physicsInterval = null;
  console.log("Physics loop paused (no clients)");
}

function onClientCountChanged() {
  if (getClientCount() > 0) startPhysicsLoop();
  else stopPhysicsLoop();
}

// ─── HTTP + WebSocket server ────────────────────────────────────────────────

const httpServer = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end(`nape-js multiplayer platformer — ${players.size}/${MAX_PLAYERS} players\n`);
});

const ALLOWED_ORIGINS = [
  "https://napejs.org",
  "https://newkrok.github.io",
  "http://localhost:5500",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];

const wss = new WebSocketServer({
  server: httpServer,
  verifyClient: ({ origin }) => {
    if (!origin) return false;
    const allowed = ALLOWED_ORIGINS.some(o => origin === o || origin.startsWith("http://localhost"));
    if (!allowed) console.warn(`Rejected connection from origin: ${origin}`);
    return allowed;
  },
});

wss.on("connection", (ws) => {
  const result = spawnPlayer(ws);

  // Spectator mode
  if (!result) {
    spectators.add(ws);
    onClientCountChanged();
    console.log(`Spectator connected, total spectators: ${spectators.size}`);
    ws.send(JSON.stringify({
      type: "init",
      spectator: true,
      worldW: WORLD_W,
      worldH: WORLD_H,
      level: levelDescriptor,
      coins: coins.map(c => ({ id: c.id, x: c.x, y: c.y, alive: c.alive })),
      sceneObjects,
      movingPlatforms,
      playerColors: PLAYER_COLORS,
      players: [...players.entries()].map(([id, p]) => ({ id, colorIdx: p.colorIdx, bodyId: p.bodyId })),
    }));
    const snap = buildFullSnapshot();
    if (snap) ws.send(snap);
    broadcastPlayerList();

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "ping") ws.send(JSON.stringify({ type: "pong" }));
      } catch (_) {}
    });

    ws.on("close", () => {
      spectators.delete(ws);
      onClientCountChanged();
      console.log(`Spectator disconnected, total spectators: ${spectators.size}`);
    });
    ws.on("error", () => { spectators.delete(ws); onClientCountChanged(); });
    return;
  }

  // Player mode
  const { playerId, bodyId, colorIdx } = result;
  onClientCountChanged();
  console.log(`Player ${playerId} connected (body ${bodyId}), total: ${players.size}`);

  ws.send(JSON.stringify(buildInitPacket(playerId, bodyId, colorIdx)));
  const snapshot = buildFullSnapshot();
  if (snapshot) ws.send(snapshot);
  broadcastPlayerList();

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "input") {
        const player = players.get(playerId);
        if (player) {
          player.keys = msg.keys;
          if (msg.events) {
            if (msg.events.includes("jumpPressed")) player.jumpPressed = true;
            if (msg.events.includes("jumpReleased")) player.jumpReleased = true;
          }
        }
      }
      if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
      }
    } catch (_) {}
  });

  ws.on("close", () => {
    removePlayer(playerId);
    onClientCountChanged();
    console.log(`Player ${playerId} disconnected, total: ${players.size}`);
    broadcastPlayerList();
  });

  ws.on("error", () => {
    removePlayer(playerId);
    onClientCountChanged();
    broadcastPlayerList();
  });
});

httpServer.listen(PORT, () => {
  console.log(`nape-js multiplayer platformer listening on port ${PORT}`);
});
