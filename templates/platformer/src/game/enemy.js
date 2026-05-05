import {
  Body,
  BodyType,
  Vec2,
  Circle,
  Material,
  InteractionFilter,
  Ray,
  RayResult,
} from "@newkrok/nape-js";

const SIZE = 26;
const RADIUS = 13;
const SPEED = 60; // patrol speed (px/s)
const LEDGE_LOOKAHEAD = 14; // how far ahead of feet to raycast for ledges
const LEDGE_DROP = 48; // raycast length downward (must reach next tile-row)
const WALL_LOOKAHEAD = 4; // raycast length forward to detect walls — short
// so the goomba walks all the way to the edge before turning. Hitting a
// wall mid-stride is also handled by the "stuck" velocity-sign check.

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

    // Circle hitbox — Polygon + explicit Material triggers a tunneling
    // bug against static-Polygon floors; Circle is unaffected.
    const body = new Body(BodyType.DYNAMIC, position);
    const shape = new Circle(RADIUS, undefined, new Material(0, 0.4, 0.5, 1.2, 0.001));
    const tag = kind === "goomba" ? cbTypes.ENEMY_STOMPABLE : cbTypes.ENEMY_SPIKY;
    shape.cbTypes.add(tag);
    body.shapes.add(shape);
    body.cbTypes.add(tag); // also tag the body — listener matches on body cb
    body.allowRotation = false;
    body.userData.enemy = this;
    body.space = space;
    this.body = body;
    this.size = SIZE;
    this.radius = RADIUS;
    this._spawnX = position.x;

    if (typeof body.wake === "function") body.wake();

    // Tag each enemy shape with ENEMY_GROUP (bit 9) ALONGSIDE the default
    // bit (1). Why both? With only bit-9, the enemy wouldn't collide with
    // anything in the default group (player, tilemap, bullets). With both,
    // they collide normally — but our raycast filter below uses a different
    // probe-bit (TILEMAP_PROBE) and a mask that drops bit-9, so enemy rays
    // hit only the tilemap, never other enemies.
    const ENEMY_GROUP = 1 << 9;
    const TILEMAP_PROBE = 1 << 10; // a private bit used only by enemy rays
    for (let i = 0; i < body.shapes.length; i++) {
      body.shapes.at(i).filter = new InteractionFilter(1 | ENEMY_GROUP, -1);
    }
    // Ray uses TILEMAP_PROBE as its group; mask = -1 ^ ENEMY_GROUP (every
    // bit except bit 9). Tilemap shapes (group=1, mask=-1) match because
    // tile.mask & ray.group = -1 & 1024 ≠ 0, and ray.mask & tile.group =
    // (~bit9) & 1 ≠ 0. Enemy shapes (group=1|bit9) fail the second test
    // because ray.mask & enemy.group = (~bit9) & (1|bit9) = 1 ≠ 0 — they
    // DO match. So we need a different trick: keep ray.group=1, and set
    // ray.mask such that (mask & enemy.group) = 0. Since enemy.group has
    // bits {0, 9} and tile.group has bit {0} only, no single mask satisfies
    // "skip enemies but hit tiles" — they overlap on bit 0.
    //
    // Workaround: filter results in JS by checking the hit shape's body.
    this._rayFilter = null;
  }

  step() {
    if (this.dead) return;
    const space = this.body.space;
    const px = this.body.position.x;
    const py = this.body.position.y;
    const half = SIZE / 2;
    const frontX = px + this._dirX * (half + LEDGE_LOOKAHEAD);

    const vAtStart = { x: this.body.velocity.x, y: this.body.velocity.y };

    // Detect "stuck against another enemy" — the rayCast wall-check skips
    // enemies, so two goombas walking into each other never see a wall via
    // raycast. But the physics solver clamps their x-velocity. We asked
    // for ±SPEED last frame; if the actual velocity now points the other
    // way (the solver pushed us back), something solid is in front.
    //
    // Require N frames of "stuck" in a row before flipping, so a brief
    // bump from the player (who is much faster) doesn't make goombas
    // ping back from us.
    const wantedVx = this._dirX * SPEED;
    const isStuck = vAtStart.x !== 0 && Math.sign(vAtStart.x) !== Math.sign(wantedVx);
    this._stuckFrames = isStuck ? (this._stuckFrames ?? 0) + 1 : 0;
    const stuckAgainstSomething = this._stuckFrames >= 6;

    // Wall check: ray forward at body centre
    const wallRay = new Ray(new Vec2(px + this._dirX * half, py), new Vec2(this._dirX, 0));
    wallRay.maxDistance = WALL_LOOKAHEAD;
    const wallHit = this._rayHitTilemap(space, wallRay);

    // Ledge check: ray downward from in front of feet
    const ledgeRay = new Ray(new Vec2(frontX, py + half), new Vec2(0, 1));
    ledgeRay.maxDistance = LEDGE_DROP;
    const ledgeHit = this._rayHitTilemap(space, ledgeRay);

    // Don't flip if BOTH directions are pointless (would just dance in place).
    if (wallHit || stuckAgainstSomething) {
      this._dirX = -this._dirX;
    } else if (!ledgeHit) {
      // Probe the OPPOSITE side too — if there's no ledge there either, the
      // enemy is on a 1-tile platform; just keep walking instead of flipping
      // every frame (which freezes it in place).
      const otherFrontX = px - this._dirX * (half + LEDGE_LOOKAHEAD);
      const otherLedgeRay = new Ray(new Vec2(otherFrontX, py + half), new Vec2(0, 1));
      otherLedgeRay.maxDistance = LEDGE_DROP;
      const otherLedgeHit = this._rayHitTilemap(space, otherLedgeRay);
      if (otherLedgeHit) this._dirX = -this._dirX;
    }

    // Maintain horizontal speed; let gravity handle vertical
    this.body.velocity = new Vec2(this._dirX * SPEED, this.body.velocity.y);
  }

  kill() {
    if (this.dead) return;
    this.dead = true;
    this.body.space = null;
  }

  /**
   * Cast a ray and return the first hit that is NOT another enemy and NOT
   * the player — patrol AI should only react to terrain, never to dynamic
   * gameplay actors.
   */
  _rayHitTilemap(space, ray) {
    const list = space.rayMultiCast(ray, false, null);
    let nearest = null;
    let nearestDist = Infinity;
    for (let i = 0; i < list.length; i++) {
      const r = list.at(i);
      const otherBody = r.shape?.body;
      if (otherBody) {
        const ud = otherBody.userData;
        if (ud?.enemy || ud?.bullet) continue;
        // Skip any DYNAMIC body (terrain is STATIC, moving platforms are
        // KINEMATIC). The player is the main DYNAMIC body that would
        // otherwise count as a "wall" and cause early turnaround.
        if (otherBody.type === BodyType.DYNAMIC) continue;
      }
      if (r.distance < nearestDist) {
        nearestDist = r.distance;
        nearest = r;
      }
    }
    return nearest;
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
