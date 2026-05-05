import * as PIXI from "pixi.js";

/**
 * PixiJS v8 renderer.
 *
 * Uses plain `PIXI.Graphics` per entity type — once you add real art
 * assets, swap each Graphics for a `PIXI.Sprite` (and consider migrating
 * to `BodySpriteBinding` from `@newkrok/nape-pixi` for built-in sub-step
 * interpolation).
 *
 * `mount()` is async — Pixi v8 requires `await app.init()` before use.
 *
 * To swap to this renderer, change main.js to `await renderer.mount(...)`
 * and add `pixi.js` to your package.json deps.
 */

const COLORS = {
  bg: 0x0a0e14,
  tile: 0x3a4252,
  tileEdge: 0x566275,
  player: 0x58a6ff,
  playerInvuln: 0x9cd1ff,
  coin: 0xf4c14b,
  hazard: 0xe34c5b,
  goalPole: 0xa371f7,
  goalFlag: 0xf0ce47,
  goomba: 0xad4e2a,
  spiky: 0x7b3ab8,
  destructible: 0x8c5e3c,
  destructibleEdge: 0x5b3920,
  fragment: 0xa07350,
  movingPlatform: 0x46a86b,
  bullet: 0xfff8c0,
  bulletGlow: 0xffeba0,
};

export class PixiRenderer {
  constructor() {
    this.W = 960;
    this.H = 540;
    this.app = null;
    this.world = null; // PIXI.Container holding all world-space content
    this._tileLayer = null;
    this._gfx = new Map(); // Body → PIXI.Graphics
  }

  async mount(parent) {
    const app = new PIXI.Application();
    await app.init({
      width: this.W,
      height: this.H,
      backgroundColor: COLORS.bg,
      antialias: true,
    });
    parent.appendChild(app.canvas);

    const world = new PIXI.Container();
    app.stage.addChild(world);

    this.app = app;
    this.world = world;
  }

  get viewportW() {
    return this.W;
  }
  get viewportH() {
    return this.H;
  }

  render(game) {
    if (!this.world) return;

    this.world.x = -game.camera.renderX();
    this.world.y = -game.camera.renderY();

    this._ensureTiles(game);
    this._syncBody(game.player.body, "player", game.player);
    this._syncBody(game.goal.body, "goal");
    for (const c of game.coins) this._syncBody(c.body, "coin", c);
    for (const h of game.hazards) this._syncBody(h.body, "hazard");
    for (const e of game.enemies) this._syncBody(e.body, "enemy", e);
    for (const p of game.movingPlatforms) this._syncBody(p.body, "movingPlatform", p);
    for (const d of game.destructibles) {
      if (!d.broken) this._syncBody(d.body, "destructible");
      for (const frag of d._fragments) this._syncBody(frag, "fragment");
    }
    for (const b of game.projectiles.active) this._syncBody(b.body, "bullet");

    // Hide visuals for bodies that left the space
    for (const [body, gfx] of this._gfx) {
      if (!body.space) gfx.visible = false;
    }
  }

  _ensureTiles(game) {
    if (this._tileLayer) return;
    const layer = new PIXI.Graphics();
    const body = game.levelBody;
    for (let i = 0; i < body.shapes.length; i++) {
      const verts = body.shapes.at(i).castPolygon?.worldVerts;
      if (!verts) continue;
      layer.poly(this._vertsToArray(verts));
      layer.fill(COLORS.tile);
      layer.stroke({ color: COLORS.tileEdge, width: 2 });
    }
    this.world.addChild(layer);
    this._tileLayer = layer;
  }

  _vertsToArray(verts) {
    const arr = [];
    for (let i = 0; i < verts.length; i++) {
      const v = verts.at(i);
      arr.push(v.x, v.y);
    }
    return arr;
  }

  _syncBody(body, kind, owner) {
    let gfx = this._gfx.get(body);
    if (!gfx) {
      gfx = this._createGfx(body, kind, owner);
      if (!gfx) return null;
      this._gfx.set(body, gfx);
      this.world.addChild(gfx);
    }
    gfx.visible = body.space != null && !owner?.collected && !owner?.dead;
    gfx.x = body.position.x;
    gfx.y = body.position.y;
    gfx.rotation = body.rotation;

    if (kind === "player" && owner) {
      const blink = owner.isInvulnerable() && Math.floor(performance.now() / 80) % 2 === 0;
      gfx.tint = blink ? COLORS.playerInvuln : 0xffffff;
      gfx.visible = !owner.isDead();
    }
    return gfx;
  }

  _createGfx(body, kind, owner) {
    const g = new PIXI.Graphics();
    switch (kind) {
      case "player": {
        // Visual capsule (22 wide × 36 tall) anchored so its bottom edge
        // aligns with the bottom of the 18-radius physics circle.
        g.roundRect(-11, -18, 22, 36, 11).fill(COLORS.player);
        // direction marker (eye) — we redraw on facing change in renderEye()
        g.rect(3, -4, 3, 4).fill(0x0a0e14);
        break;
      }
      case "goal": {
        g.rect(-2, -24, 4, 48).fill(COLORS.goalPole);
        g.poly([2, -22, 24, -16, 2, -10]).fill(COLORS.goalFlag);
        break;
      }
      case "coin": {
        g.circle(0, 0, 8).fill(COLORS.coin);
        g.circle(-2, -2, 2).fill(0xfff3c4);
        break;
      }
      case "hazard": {
        g.poly([-16, 16, 16, 16, 0, -12]).fill(COLORS.hazard);
        break;
      }
      case "enemy": {
        const r = owner?.radius ?? 13;
        if (owner?.kind === "goomba") {
          g.circle(0, 0, r).fill(COLORS.goomba);
          g.rect(-6, -5, 4, 5).fill(0xffffff);
          g.rect(2, -5, 4, 5).fill(0xffffff);
          g.rect(-5, -3, 2, 3).fill(0x000000);
          g.rect(3, -3, 2, 3).fill(0x000000);
        } else {
          g.circle(0, 0, r).fill(COLORS.spiky);
          for (let i = -2; i <= 2; i++) {
            const sx = i * 5;
            g.poly([sx - 2, -r + 1, sx + 2, -r + 1, sx, -r - 5]).fill(0x1d0a2c);
          }
          g.circle(0, 2, 4).fill(0xffffff);
          g.circle(1, 2, 2).fill(0x000000);
        }
        break;
      }
      case "movingPlatform": {
        const len = owner?.length ?? 64;
        g.rect(-len / 2, -8, len, 16).fill(COLORS.movingPlatform);
        g.rect(-len / 2, -8, len, 16).stroke({ color: 0x246b3f, width: 2 });
        break;
      }
      case "destructible": {
        g.rect(-16, -16, 32, 32).fill(COLORS.destructible);
        g.rect(-16, -16, 32, 32).stroke({ color: COLORS.destructibleEdge, width: 2 });
        break;
      }
      case "fragment": {
        const verts = body.shapes.at(0)?.castPolygon?.localVerts;
        if (verts) g.poly(this._vertsToArray(verts)).fill(COLORS.fragment);
        else g.rect(-6, -6, 12, 12).fill(COLORS.fragment);
        break;
      }
      case "bullet": {
        g.circle(0, 0, 9).fill({ color: COLORS.bulletGlow, alpha: 0.45 });
        g.circle(0, 0, 4).fill(COLORS.bullet);
        break;
      }
      default:
        return null;
    }
    return g;
  }
}
