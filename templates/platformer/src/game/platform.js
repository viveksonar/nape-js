import { Body, BodyType, Vec2, Polygon, Material } from "@newkrok/nape-js";

const HEIGHT = 16;
const SPEED = 80; // px/s

/**
 * Linear ping-pong moving platform.
 *
 * KINEMATIC body — `body.velocity` drives motion; the engine integrates
 * position automatically. A passenger is carried by friction (high
 * Material friction values), matching the canonical pattern in the
 * `character-controller` and `conveyor-belts` demos.
 *
 * @param {import("@newkrok/nape-js").Space} space
 * @param {Vec2} from   start point (centre)
 * @param {Vec2} to     end point (centre)
 * @param {number} length     platform length in pixels
 * @param {{MOVING_PLATFORM: import("@newkrok/nape-js").CbType}} cbTypes
 */
export class MovingPlatform {
  constructor(space, from, to, length, cbTypes) {
    this.from = from.copy();
    this.to = to.copy();
    this.t = 0; // 0 .. 1 along the segment
    this.dir = 1; // +1 toward "to", -1 toward "from"

    const dx = this.to.x - this.from.x;
    const dy = this.to.y - this.from.y;
    const segLen = Math.sqrt(dx * dx + dy * dy) || 1;
    this._dirX = dx / segLen;
    this._dirY = dy / segLen;
    this._speed = SPEED;
    this._segLen = segLen;

    const body = new Body(BodyType.KINEMATIC, this.from.copy());
    const shape = new Polygon(
      Polygon.box(length, HEIGHT),
      new Material(0, 2, 2, 1, 0.001), // high friction = player rides instead of sliding off
    );
    shape.cbTypes.add(cbTypes.MOVING_PLATFORM);
    body.shapes.add(shape);
    body.cbTypes.add(cbTypes.MOVING_PLATFORM);
    body.userData.movingPlatform = this;
    body.space = space;
    this.body = body;
    this.length = length;
  }

  step(dt) {
    const advance = (this._speed * dt) / this._segLen;
    this.t += advance * this.dir;
    if (this.t >= 1) {
      this.t = 1;
      this.dir = -1;
    }
    if (this.t <= 0) {
      this.t = 0;
      this.dir = 1;
    }

    const vx = this._dirX * this._speed * this.dir;
    const vy = this._dirY * this._speed * this.dir;
    this.body.velocity = new Vec2(vx, vy);
  }

  static get HEIGHT() {
    return HEIGHT;
  }
}
