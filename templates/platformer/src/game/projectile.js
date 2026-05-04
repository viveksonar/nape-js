import { Body, BodyType, Vec2, Circle, Material } from "@newkrok/nape-js";

const RADIUS = 5;
const SPEED = 700;
const LIFETIME = 0.8;

/**
 * Bullet projectile. Pool-managed (no per-shot allocation in steady
 * state — important if the player can shoot at 5+ Hz).
 *
 * Each bullet is a circular DYNAMIC body with `isBullet` (CCD on),
 * tagged with PROJECTILE. The Game's central InteractionListener routes
 * hits to enemies / destructibles.
 */
export class ProjectilePool {
  constructor(space, cbTypes) {
    this.space = space;
    this.cbTypes = cbTypes;
    /** @type {Bullet[]} */
    this.active = [];
    /** @type {Bullet[]} */
    this.idle = [];

    // Self-excluding bit so bullets ignore each other but hit everything else
    this._bulletGroup = 1 << 10;
  }

  fire(origin, dirX, dirY) {
    const b = this.idle.pop() ?? this._allocate();
    b.body.position = new Vec2(origin.x, origin.y);
    b.body.velocity = new Vec2(dirX * SPEED, dirY * SPEED);
    b.body.angularVel = 0;
    b.body.space = this.space;
    b.body.userData.bullet = b;
    b._timeLeft = LIFETIME;
    this.active.push(b);
    return b;
  }

  _allocate() {
    const body = new Body(BodyType.DYNAMIC, new Vec2(0, 0));
    const shape = new Circle(RADIUS, new Material(0, 0, 0, 0.05, 0.001));
    shape.filter.collisionGroup = this._bulletGroup;
    shape.filter.collisionMask = ~this._bulletGroup;
    shape.cbTypes.add(this.cbTypes.PROJECTILE);
    body.shapes.add(shape);
    body.allowRotation = false;
    body.isBullet = true;
    body.gravMassScale = 0; // bullets fly in a straight line, ignore gravity
    return { body, _timeLeft: 0 };
  }

  recycle(bullet) {
    const idx = this.active.indexOf(bullet);
    if (idx < 0) return;
    this.active.splice(idx, 1);
    bullet.body.space = null;
    bullet.body.userData.bullet = null;
    this.idle.push(bullet);
  }

  step(dt) {
    // Iterate backward so we can splice safely
    for (let i = this.active.length - 1; i >= 0; i--) {
      const b = this.active[i];
      b._timeLeft -= dt;
      if (b._timeLeft <= 0) this.recycle(b);
    }
  }

  static get RADIUS() {
    return RADIUS;
  }
}
