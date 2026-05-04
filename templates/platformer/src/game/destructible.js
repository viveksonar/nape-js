import { Body, BodyType, Vec2, Polygon, Material, fractureBody } from "@newkrok/nape-js";

const SIZE = 32;

/**
 * Destructible block. Behaves as a static wall until a projectile hits it,
 * then `fractureBody` (P67) splits it into fragments that fall away under
 * gravity. Fragments live for `fragmentLifetime` seconds before being
 * removed (otherwise enough hits would tank perf).
 */
export class Destructible {
  constructor(space, position, cbTypes) {
    this.space = space;
    this.cbTypes = cbTypes;
    this.broken = false;
    this._fragments = []; // { body, ttl }

    const body = new Body(BodyType.STATIC, position);
    body.shapes.add(new Polygon(Polygon.box(SIZE, SIZE), new Material(0.1, 0.7, 0.7, 1.5, 0.001)));
    body.cbTypes.add(cbTypes.DESTRUCTIBLE);
    body.userData.destructible = this;
    body.space = space;
    this.body = body;
  }

  /**
   * Fracture into pieces, kicked outward from the impact point.
   * @param {Vec2} impactPoint  world-space impact location
   */
  shatter(impactPoint) {
    if (this.broken) return [];
    this.broken = true;
    const result = fractureBody(this.body, impactPoint, {
      fragmentCount: 6,
      explosionImpulse: 90,
      addToSpace: true,
    });
    // The original body is now removed by fractureBody when addToSpace=true.
    // Track fragments so we can clean them up after a short lifetime.
    for (const frag of result.fragments) {
      frag.userData.fragmentTtl = 1.6;
      this._fragments.push(frag);
    }
    return result.fragments;
  }

  step(dt) {
    if (!this.broken) return;
    for (let i = this._fragments.length - 1; i >= 0; i--) {
      const f = this._fragments[i];
      f.userData.fragmentTtl -= dt;
      if (f.userData.fragmentTtl <= 0) {
        f.space = null;
        this._fragments.splice(i, 1);
      }
    }
  }

  static get SIZE() {
    return SIZE;
  }
}
