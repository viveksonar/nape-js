import { Body, BodyType, Polygon } from "@newkrok/nape-js";

const WIDTH = 24;
const HEIGHT = 48;

/**
 * Goal flag. Sensor body — touching it ends the level (handled in Game's
 * InteractionListener).
 */
export class Goal {
  constructor(space, position, cbTypes) {
    const body = new Body(BodyType.STATIC, position);
    const shape = new Polygon(Polygon.box(WIDTH, HEIGHT));
    shape.sensorEnabled = true;
    shape.cbTypes.add(cbTypes.GOAL);
    body.shapes.add(shape);
    body.userData.goal = this;
    body.space = space;
    this.body = body;
  }

  static get WIDTH() {
    return WIDTH;
  }
  static get HEIGHT() {
    return HEIGHT;
  }
}
