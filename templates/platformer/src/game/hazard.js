import { Body, BodyType, Vec2, Polygon } from "@newkrok/nape-js";

/**
 * Spike hazard. Static body, shaped like an upward-pointing wedge.
 * Tagged with HAZARD; player contact triggers `Player.takeDamage` via
 * the central InteractionListener.
 */
export class Hazard {
  constructor(space, position, cbTypes, size = 32) {
    const half = size / 2;
    // Triangle pointing up, base sitting on the tile floor
    const verts = [new Vec2(-half, half), new Vec2(half, half), new Vec2(0, -half + 4)];
    const body = new Body(BodyType.STATIC, position);
    const shape = new Polygon(verts);
    shape.cbTypes.add(cbTypes.HAZARD);
    body.shapes.add(shape);
    body.userData.hazard = this;
    body.space = space;
    this.body = body;
    this.size = size;
  }
}
