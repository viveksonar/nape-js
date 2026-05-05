import { Body, BodyType, Circle } from "@newkrok/nape-js";

const RADIUS = 8;

/**
 * Coin pickup. Static body with a sensor shape (no physical collision)
 * tagged with the COIN cbType. The Game's InteractionListener removes
 * the body and bumps the player score on contact.
 *
 * The body is kept in `coin._spinPhase` for renderer animation only —
 * physics never reads it.
 */
export class Coin {
  constructor(space, position, cbTypes) {
    this.collected = false;
    const body = new Body(BodyType.STATIC, position);
    const shape = new Circle(RADIUS);
    shape.sensorEnabled = true;
    shape.cbTypes.add(cbTypes.COIN);
    body.shapes.add(shape);
    body.cbTypes.add(cbTypes.COIN);
    body.userData.coin = this;
    body.space = space;
    this.body = body;
    this._spinPhase = Math.random() * Math.PI * 2;
  }

  collect() {
    if (this.collected) return false;
    this.collected = true;
    this.body.space = null;
    return true;
  }

  static get RADIUS() {
    return RADIUS;
  }
}
