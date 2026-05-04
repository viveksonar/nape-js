import {
  Body,
  BodyType,
  Vec2,
  Polygon,
  Circle,
  Material,
  InteractionFilter,
  Ray,
  RayResult,
} from "@newkrok/nape-js";

const SIZE = 26;
const SPEED = 60; // patrol speed (px/s)
const LEDGE_LOOKAHEAD = 18; // how far ahead of feet to raycast for ledges
const LEDGE_DROP = 30; // raycast length downward
const WALL_LOOKAHEAD = 20; // raycast length forward to detect walls

/**
 * Patrolling ground enemy. Two variants share the same AI:
 *  - GoombaEnemy   — stompable from above, damages from sides
 *  - SpikyEnemy    — always damages on touch
 *
 * AI: walk at constant speed, flip direction when (a) hitting a wall or
 * (b) about to walk off a ledge. Both checks are cheap raycasts run from
 * the front-bottom of the enemy.
 */
class BaseEnemy {
  /** @param {import("@newkrok/nape-js").Space} space */
  constructor(space, position, cbTypes, kind) {
    this.kind = kind; // "goomba" | "spiky"
    this.dead = false;
    this._dirX = -1; // -1 left, +1 right

    const body = new Body(BodyType.DYNAMIC, position);
    body.shapes.add(new Polygon(Polygon.box(SIZE, SIZE), new Material(0, 0.4, 0.5, 1.2, 0.001)));
    body.allowRotation = false;
    body.cbTypes.add(kind === "goomba" ? cbTypes.ENEMY_STOMPABLE : cbTypes.ENEMY_SPIKY);
    body.userData.enemy = this;
    body.space = space;
    this.body = body;
    this.size = SIZE;

    // A filter that excludes the enemy's own shapes from raycast results
    const ENEMY_GROUP = 1 << 9;
    for (let i = 0; i < body.shapes.length; i++) {
      const f = body.shapes.at(i).filter;
      f.collisionGroup = f.collisionGroup | ENEMY_GROUP;
    }
    this._rayFilter = new InteractionFilter(1, ~ENEMY_GROUP);
  }

  step() {
    if (this.dead) return;
    const space = this.body.space;
    const px = this.body.position.x;
    const py = this.body.position.y;
    const half = SIZE / 2;
    const frontX = px + this._dirX * (half + LEDGE_LOOKAHEAD);

    // Wall check: ray forward at body centre
    const wallRay = new Ray(new Vec2(px + this._dirX * half, py), new Vec2(this._dirX, 0));
    wallRay.maxDistance = WALL_LOOKAHEAD;
    const wallHit = space.rayCast(wallRay, false, this._rayFilter);

    // Ledge check: ray downward from in front of feet
    const ledgeRay = new Ray(new Vec2(frontX, py + half), new Vec2(0, 1));
    ledgeRay.maxDistance = LEDGE_DROP;
    const ledgeHit = space.rayCast(ledgeRay, false, this._rayFilter);

    if (wallHit || !ledgeHit) {
      this._dirX = -this._dirX;
    }

    // Maintain horizontal speed; let gravity handle vertical
    this.body.velocity = new Vec2(this._dirX * SPEED, this.body.velocity.y);
  }

  kill() {
    if (this.dead) return;
    this.dead = true;
    this.body.space = null;
  }

  static get SIZE() {
    return SIZE;
  }
}

export class GoombaEnemy extends BaseEnemy {
  constructor(space, position, cbTypes) {
    super(space, position, cbTypes, "goomba");
  }
}

export class SpikyEnemy extends BaseEnemy {
  constructor(space, position, cbTypes) {
    super(space, position, cbTypes, "spiky");
  }
}
