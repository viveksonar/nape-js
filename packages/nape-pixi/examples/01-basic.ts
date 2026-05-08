/**
 * 01 — basic sync
 *
 * The simplest possible wiring. No interpolation, one sprite per body,
 * sync runs after every `space.step()`. Good enough when render rate
 * equals physics rate (typical desktop 60 Hz).
 */

import { Application, Container, Graphics } from "pixi.js";
import { Space, Body, BodyType, Circle, Polygon, Material, Vec2 } from "@newkrok/nape-js";
import { BodySpriteBinding } from "@newkrok/nape-pixi";

async function main() {
  // --- Pixi --------------------------------------------------------------
  const app = new Application();
  await app.init({ width: 800, height: 600, backgroundColor: 0x0d1117 });
  document.body.appendChild(app.canvas);

  // --- Physics -----------------------------------------------------------
  const space = new Space(new Vec2(0, 400));

  // Low-friction, slightly bouncy material for dynamic bodies so the
  // stacks slump and slide instead of welding together.
  const bouncy = new Material(0.4, 0.2, 0.3, 1);

  // Static floor + walls (all rectangles).
  const walls: Array<{ body: Body; w: number; h: number }> = [];
  const addWall = (x: number, y: number, w: number, h: number, rot = 0) => {
    const b = new Body(BodyType.STATIC, new Vec2(x, y));
    b.shapes.add(new Polygon(Polygon.box(w, h)));
    b.rotation = rot;
    b.space = space;
    walls.push({ body: b, w, h });
  };
  addWall(400, 590, 800, 20); // floor
  addWall(10, 300, 20, 600); // left
  addWall(790, 300, 20, 600); // right
  addWall(300, 360, 320, 16, -0.35); // ramp
  addWall(600, 220, 180, 14, 0.4); // upper ramp

  const peg = new Body(BodyType.STATIC, new Vec2(560, 460));
  peg.shapes.add(new Circle(22));
  peg.space = space;

  // Dynamic bodies: mix of circles, boxes, and capsules so collisions
  // don't look uniform. Sprites created alongside so we can bind them in
  // insertion order.
  type Sprite = Graphics;
  const binding = new BodySpriteBinding();
  const root = new Container();
  app.stage.addChild(root);

  for (const { body, w, h } of walls) {
    const gfx = new Graphics().rect(-w / 2, -h / 2, w, h).fill(0x30363d);
    gfx.x = body.position.x;
    gfx.y = body.position.y;
    gfx.rotation = body.rotation;
    root.addChild(gfx);
  }
  const pegGfx = new Graphics().circle(0, 0, 22).fill(0x30363d);
  pegGfx.x = peg.position.x;
  pegGfx.y = peg.position.y;
  root.addChild(pegGfx);

  const makeBody = (x: number, y: number, kind: "circle" | "box" | "capsule"): [Body, Sprite] => {
    const body = new Body(BodyType.DYNAMIC, new Vec2(x, y));
    let gfx: Sprite;
    if (kind === "circle") {
      body.shapes.add(new Circle(14, undefined, bouncy));
      gfx = new Graphics().circle(0, 0, 14).fill(0x58a6ff);
    } else if (kind === "box") {
      body.shapes.add(new Polygon(Polygon.box(24, 24)));
      gfx = new Graphics().rect(-12, -12, 24, 24).fill(0xf0883e);
    } else {
      // Capsule approximated as a circle pair + box of matching size so the
      // sprite looks right. Physics side uses two circles at either end of
      // a thin box (stable, avoids the Polygon+Material bug).
      const half = 16;
      const r = 9;
      body.shapes.add(new Circle(r, new Vec2(-half, 0), bouncy));
      body.shapes.add(new Circle(r, new Vec2(half, 0), bouncy));
      body.shapes.add(new Polygon(Polygon.box(half * 2, r * 2)));
      gfx = new Graphics()
        .roundRect(-half - r, -r, (half + r) * 2, r * 2, r)
        .fill(0xbc8cff);
    }
    body.space = space;
    return [body, gfx];
  };

  const kinds = ["circle", "box", "capsule"] as const;
  for (let i = 0; i < 14; i++) {
    const x = 120 + i * 40 + ((i * 13) % 30);
    const y = 60 + (i % 4) * 30;
    const [body, gfx] = makeBody(x, y, kinds[i % kinds.length]);
    root.addChild(gfx);
    binding.bind(body, gfx);
  }

  // --- Loop --------------------------------------------------------------
  app.ticker.add(() => {
    space.step(1 / 60);
    binding.update();
  });
}

main();
