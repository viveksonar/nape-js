/**
 * Canvas2D renderer.
 *
 * Reads game state (no writes) and paints a frame. The renderer is
 * intentionally dependency-free — swap to Three.js / PixiJS by replacing
 * this file. Only the public methods (`mount`, `render`) are required.
 */

const COLORS = {
  bg: "#0a0e14",
  grid: "rgba(255,255,255,0.04)",
  tile: "#3a4252",
  tileEdge: "#566275",
  player: "#58a6ff",
  playerInvuln: "#9cd1ff",
  coin: "#f4c14b",
  coinShine: "#fff3c4",
  hazard: "#e34c5b",
  goalPole: "#a371f7",
  goalFlag: "#f0ce47",
  goomba: "#ad4e2a",
  goombaShoes: "#3a1f0e",
  spiky: "#7b3ab8",
  spikyEye: "#fff",
  spikySpike: "#1d0a2c",
  destructible: "#8c5e3c",
  destructibleEdge: "#5b3920",
  fragment: "#a07350",
  movingPlatform: "#46a86b",
  movingPlatformEdge: "#246b3f",
  bullet: "#fff8c0",
  bulletGlow: "rgba(255,235,160,0.45)",
};

export class Canvas2DRenderer {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.W = 960;
    this.H = 540;
  }

  mount(parent) {
    const canvas = document.createElement("canvas");
    canvas.width = this.W;
    canvas.height = this.H;
    parent.appendChild(canvas);
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
  }

  get viewportW() {
    return this.W;
  }
  get viewportH() {
    return this.H;
  }

  render(game) {
    const ctx = this.ctx;
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, this.W, this.H);

    ctx.save();
    ctx.translate(-game.camera.renderX(), -game.camera.renderY());

    this._drawGrid(ctx, game);
    this._drawTiles(ctx, game);
    this._drawMovingPlatforms(ctx, game);
    this._drawHazards(ctx, game);
    this._drawDestructibles(ctx, game);
    this._drawCoins(ctx, game);
    this._drawGoal(ctx, game);
    this._drawEnemies(ctx, game);
    this._drawProjectiles(ctx, game);
    this._drawPlayer(ctx, game);

    ctx.restore();
  }

  _drawGrid(ctx, game) {
    const cell = 64;
    const x0 = Math.floor(game.camera.x / cell) * cell;
    const y0 = Math.floor(game.camera.y / cell) * cell;
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = x0; x < game.camera.x + this.W + cell; x += cell) {
      ctx.moveTo(x, game.camera.y);
      ctx.lineTo(x, game.camera.y + this.H);
    }
    for (let y = y0; y < game.camera.y + this.H + cell; y += cell) {
      ctx.moveTo(game.camera.x, y);
      ctx.lineTo(game.camera.x + this.W, y);
    }
    ctx.stroke();
  }

  _drawTiles(ctx, game) {
    // Render the static body's polygons directly — fast, and matches the
    // greedy-meshed rectangles 1:1.
    ctx.fillStyle = COLORS.tile;
    ctx.strokeStyle = COLORS.tileEdge;
    ctx.lineWidth = 2;
    const body = game.levelBody;
    for (let i = 0; i < body.shapes.length; i++) {
      const shape = body.shapes.at(i);
      const verts = shape.castPolygon?.worldVerts;
      if (!verts) continue;
      ctx.beginPath();
      for (let j = 0; j < verts.length; j++) {
        const v = verts.at(j);
        if (j === 0) ctx.moveTo(v.x, v.y);
        else ctx.lineTo(v.x, v.y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  _drawMovingPlatforms(ctx, game) {
    ctx.fillStyle = COLORS.movingPlatform;
    ctx.strokeStyle = COLORS.movingPlatformEdge;
    ctx.lineWidth = 2;
    for (const p of game.movingPlatforms) {
      const x = p.body.position.x - p.length / 2;
      const y = p.body.position.y - 8;
      ctx.fillRect(x, y, p.length, 16);
      ctx.strokeRect(x, y, p.length, 16);
    }
  }

  _drawHazards(ctx, game) {
    ctx.fillStyle = COLORS.hazard;
    for (const h of game.hazards) {
      const cx = h.body.position.x;
      const cy = h.body.position.y;
      const half = h.size / 2;
      ctx.beginPath();
      ctx.moveTo(cx - half, cy + half);
      ctx.lineTo(cx + half, cy + half);
      ctx.lineTo(cx, cy - half + 4);
      ctx.closePath();
      ctx.fill();
    }
  }

  _drawDestructibles(ctx, game) {
    for (const d of game.destructibles) {
      if (!d.broken) {
        const x = d.body.position.x - 16;
        const y = d.body.position.y - 16;
        ctx.fillStyle = COLORS.destructible;
        ctx.fillRect(x, y, 32, 32);
        ctx.strokeStyle = COLORS.destructibleEdge;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 0.5, y + 0.5, 31, 31);
        // crack motif
        ctx.beginPath();
        ctx.moveTo(x + 8, y + 4);
        ctx.lineTo(x + 14, y + 14);
        ctx.lineTo(x + 6, y + 22);
        ctx.lineTo(x + 18, y + 28);
        ctx.stroke();
      } else {
        ctx.fillStyle = COLORS.fragment;
        for (const frag of d._fragments) {
          ctx.save();
          ctx.translate(frag.position.x, frag.position.y);
          ctx.rotate(frag.rotation);
          // approx: draw the first polygon shape's local verts
          const shape = frag.shapes.at(0);
          const verts = shape?.castPolygon?.localVerts;
          if (verts) {
            ctx.beginPath();
            for (let j = 0; j < verts.length; j++) {
              const v = verts.at(j);
              if (j === 0) ctx.moveTo(v.x, v.y);
              else ctx.lineTo(v.x, v.y);
            }
            ctx.closePath();
            ctx.fill();
          }
          ctx.restore();
        }
      }
    }
  }

  _drawCoins(ctx, game) {
    for (const c of game.coins) {
      if (c.collected) continue;
      const cx = c.body.position.x;
      const cy = c.body.position.y;
      const wobble = Math.sin(c._spinPhase) * 4;
      const r = 8;
      ctx.fillStyle = COLORS.coin;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.abs(Math.cos(c._spinPhase)) * r + 2, r, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.coinShine;
      ctx.beginPath();
      ctx.ellipse(cx, cy + wobble * 0.2, 1.5, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawGoal(ctx, game) {
    const cx = game.goal.body.position.x;
    const cy = game.goal.body.position.y;
    const flagY = cy - 22;
    ctx.fillStyle = COLORS.goalPole;
    ctx.fillRect(cx - 2, cy - 24, 4, 48);
    ctx.fillStyle = COLORS.goalFlag;
    ctx.beginPath();
    ctx.moveTo(cx + 2, flagY);
    ctx.lineTo(cx + 24, flagY + 6);
    ctx.lineTo(cx + 2, flagY + 12);
    ctx.closePath();
    ctx.fill();
  }

  _drawEnemies(ctx, game) {
    for (const e of game.enemies) {
      if (e.dead) continue;
      const cx = e.body.position.x;
      const cy = e.body.position.y;
      const r = e.radius;
      if (e.kind === "goomba") {
        ctx.fillStyle = COLORS.goomba;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        // shoe band — clip to the circle so the strip hugs the bottom
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = COLORS.goombaShoes;
        ctx.fillRect(cx - r, cy + r - 5, r * 2, 5);
        ctx.restore();
        // eyes
        ctx.fillStyle = "#fff";
        ctx.fillRect(cx - 6, cy - 5, 4, 5);
        ctx.fillRect(cx + 2, cy - 5, 4, 5);
        ctx.fillStyle = "#000";
        ctx.fillRect(cx - 5, cy - 3, 2, 3);
        ctx.fillRect(cx + 3, cy - 3, 2, 3);
      } else {
        // spiky
        ctx.fillStyle = COLORS.spiky;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        // top spikes
        ctx.fillStyle = COLORS.spikySpike;
        for (let i = -2; i <= 2; i++) {
          const sx = cx + i * 5;
          ctx.beginPath();
          ctx.moveTo(sx - 2, cy - r + 1);
          ctx.lineTo(sx + 2, cy - r + 1);
          ctx.lineTo(sx, cy - r - 5);
          ctx.closePath();
          ctx.fill();
        }
        // eye
        ctx.fillStyle = COLORS.spikyEye;
        ctx.beginPath();
        ctx.arc(cx, cy + 2, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#000";
        ctx.beginPath();
        ctx.arc(cx + 1, cy + 2, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  _drawProjectiles(ctx, game) {
    for (const b of game.projectiles.active) {
      const x = b.body.position.x;
      const y = b.body.position.y;
      ctx.fillStyle = COLORS.bulletGlow;
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.bullet;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawPlayer(ctx, game) {
    const p = game.player;
    if (p.isDead()) return;
    const x = p.body.position.x;
    const yPhys = p.body.position.y;
    // Visual capsule — 22 wide × 36 tall. Anchor the visual so its bottom
    // edge aligns with the bottom of the physics circle (radius 18), then
    // draw the capsule extending upward from that line.
    const PHYS_R = 18;
    const w = 22;
    const h = 36;
    const r = w / 2;
    const bottomY = yPhys + PHYS_R;
    const topY = bottomY - h;
    const cy = (topY + bottomY) / 2;
    const halfSpine = h / 2 - r;
    const blink = p.isInvulnerable() && Math.floor(performance.now() / 80) % 2 === 0;
    ctx.fillStyle = blink ? COLORS.playerInvuln : COLORS.player;
    ctx.beginPath();
    ctx.moveTo(x - r, cy - halfSpine);
    ctx.arc(x, cy - halfSpine, r, Math.PI, 0);
    ctx.lineTo(x + r, cy + halfSpine);
    ctx.arc(x, cy + halfSpine, r, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
    // direction marker (eye)
    ctx.fillStyle = "#0a0e14";
    const eyeX = x + p.facing * 4;
    ctx.fillRect(eyeX - 1, cy - 6, 3, 4);
  }
}
