import { Body, BodyType, Vec2, Polygon, Material, CharacterController } from "@newkrok/nape-js";

const WIDTH = 22;
const HEIGHT = 36;

// Tunables — every magic number lives here so you can feel out the controls
// without scrolling. Defaults are tuned for a snappy, Meatboy-ish feel.
const RUN_SPEED = 240; // px/s horizontal max speed
const RUN_ACCEL = 1800; // px/s² ground acceleration
const AIR_ACCEL = 1100; // px/s² horizontal acceleration in air (less than ground)
const JUMP_VELOCITY = 460; // initial upward velocity (px/s)
const DOUBLE_JUMP_VELOCITY = 380;
const COYOTE_TIME = 0.1; // grace period after walking off a ledge (s)
const JUMP_BUFFER = 0.1; // grace period for early jump press before landing (s)
const JUMP_CUT_FACTOR = 0.45; // velocity multiplier when releasing jump early (var-height)
const MAX_AIR_JUMPS = 1; // 1 = double jump. 0 = no double jump. 2 = triple, etc.
const SHOOT_COOLDOWN = 0.22; // seconds between bullets
const DAMAGE_IFRAMES = 1.0; // post-damage invulnerability (s)
const KNOCKBACK_VELOCITY = 280;

export class Player {
  /**
   * @param {import("@newkrok/nape-js").Space} space
   * @param {Vec2} spawnPos
   * @param {{ PLAYER: import("@newkrok/nape-js").CbType, ONE_WAY: import("@newkrok/nape-js").CbType }} cbTypes
   */
  constructor(space, spawnPos, cbTypes) {
    this.space = space;
    this.spawnPos = spawnPos.copy();
    this.cbTypes = cbTypes;
    this.maxHealth = 3;
    this.health = this.maxHealth;
    this.facing = 1; // +1 right, -1 left — for shoot direction
    this.coins = 0;

    // State
    this._jumpBuffer = 0;
    this._airJumpsRemaining = MAX_AIR_JUMPS;
    this._canCutJump = false;
    this._shootCooldown = 0;
    this._iFrames = 0;
    this._dead = false;

    // Body
    const body = new Body(BodyType.DYNAMIC, spawnPos);
    body.shapes.add(
      new Polygon(
        Polygon.box(WIDTH, HEIGHT),
        new Material(0, 0.4, 0.4, 1, 0.001), // 0 elasticity = no bouncy player
      ),
    );
    body.allowRotation = false;
    body.isBullet = true; // CCD prevents tunneling at high jump speeds
    body.cbTypes.add(cbTypes.PLAYER);
    body.space = space;
    this.body = body;

    this.cc = new CharacterController(space, body, {
      maxSlopeAngle: Math.PI / 3,
      oneWayPlatformTag: cbTypes.ONE_WAY,
      characterTag: cbTypes.PLAYER,
    });
    this.moveResult = null;
  }

  /** Call before space.step(). */
  preStep(dt, input) {
    if (this._dead) {
      this.cc.setVelocity(0, this.body.velocity.y);
      return;
    }

    // ── Horizontal input ──────────────────────────────────────────────
    let inputX = 0;
    if (input.isHeld("left")) inputX -= 1;
    if (input.isHeld("right")) inputX += 1;
    if (inputX !== 0) this.facing = inputX;

    const accel = this.cc.grounded ? RUN_ACCEL : AIR_ACCEL;
    const targetVx = inputX * RUN_SPEED;
    let vx = this.body.velocity.x;
    if (inputX !== 0) {
      const delta = targetVx - vx;
      vx += Math.sign(delta) * Math.min(accel * dt, Math.abs(delta));
    } else if (this.cc.grounded) {
      vx -= Math.sign(vx) * Math.min(accel * dt, Math.abs(vx));
    }
    // air drag intentionally omitted — preserves momentum, more responsive feel

    let vy = this.body.velocity.y;

    // ── Jump buffer (early-press grace) ──────────────────────────────
    if (input.wasPressed("jump")) this._jumpBuffer = JUMP_BUFFER;
    this._jumpBuffer = Math.max(0, this._jumpBuffer - dt);

    // ── Variable-height jump cut ─────────────────────────────────────
    // Releasing jump while still rising kills part of the upward velocity.
    // Tap = small hop, hold = full jump.
    if (input.wasReleased("jump") && vy < 0 && this._canCutJump) {
      vy *= JUMP_CUT_FACTOR;
      this._canCutJump = false;
    }

    // ── Reset air jumps on touchdown ─────────────────────────────────
    if (this.cc.grounded) this._airJumpsRemaining = MAX_AIR_JUMPS;

    // ── Consume buffered jump press ──────────────────────────────────
    if (this._jumpBuffer > 0) {
      const canGroundJump = this.cc.grounded || this.cc.timeSinceGrounded < COYOTE_TIME;
      if (canGroundJump) {
        vy = -JUMP_VELOCITY;
        this._jumpBuffer = 0;
        this._canCutJump = true;
      } else if (this._airJumpsRemaining > 0) {
        vy = -DOUBLE_JUMP_VELOCITY;
        this._airJumpsRemaining -= 1;
        this._jumpBuffer = 0;
        this._canCutJump = true;
      }
    }

    this.cc.setVelocity(vx, vy);
  }

  /** Call after space.step(). */
  postStep(dt) {
    this.moveResult = this.cc.update();
    this._shootCooldown = Math.max(0, this._shootCooldown - dt);
    this._iFrames = Math.max(0, this._iFrames - dt);

    // Death from falling out of the world
    if (this.body.position.y > 5000) this._dead = true;
  }

  canShoot() {
    return !this._dead && this._shootCooldown <= 0;
  }
  noteShotFired() {
    this._shootCooldown = SHOOT_COOLDOWN;
  }

  takeDamage(fromX) {
    if (this._dead || this._iFrames > 0) return false;
    this.health -= 1;
    this._iFrames = DAMAGE_IFRAMES;
    const dir = fromX < this.body.position.x ? 1 : -1;
    this.body.velocity = new Vec2(dir * KNOCKBACK_VELOCITY, -260);
    if (this.health <= 0) this._dead = true;
    return true;
  }

  /** Bouncy stomp on enemy heads (small Mario-style hop). */
  bounceStomp() {
    this.body.velocity = new Vec2(this.body.velocity.x, -JUMP_VELOCITY * 0.7);
    this._canCutJump = true;
  }

  isInvulnerable() {
    return this._iFrames > 0;
  }
  isDead() {
    return this._dead;
  }

  respawn() {
    this.body.position = this.spawnPos.copy();
    this.body.velocity = new Vec2(0, 0);
    this.health = this.maxHealth;
    this._dead = false;
    this._iFrames = 0;
    this._jumpBuffer = 0;
    this._airJumpsRemaining = MAX_AIR_JUMPS;
    this._canCutJump = false;
  }

  static get WIDTH() {
    return WIDTH;
  }
  static get HEIGHT() {
    return HEIGHT;
  }
}
