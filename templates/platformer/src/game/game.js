import {
  Space,
  Vec2,
  InteractionListener,
  InteractionType,
  CbEvent,
  CbType,
} from "@newkrok/nape-js";

import { createCbTypes } from "./callbacks.js";
import { parseLevel, buildLevelBody, TILE_SIZE } from "./level.js";
import { Player } from "./player.js";
import { Coin } from "./coin.js";
import { Hazard } from "./hazard.js";
import { Goal } from "./goal.js";
import { GoombaEnemy, SpikyEnemy } from "./enemy.js";
import { MovingPlatform } from "./platform.js";
import { ProjectilePool } from "./projectile.js";
import { Destructible } from "./destructible.js";
import { Camera } from "./camera.js";

const STEP_DT = 1 / 60;
const GRAVITY = 1400;

export const STATE = {
  PLAYING: "playing",
  DEAD: "dead",
  WON: "won",
};

/**
 * Top-level orchestrator. Owns the Space, all entities, and the central
 * collision-listener wiring. The renderer reads the public arrays:
 * `coins`, `enemies`, `destructibles`, `movingPlatforms`, `projectiles`,
 * plus `player.body` and `goal.body`, and the `levelBody` for the static
 * tilemap.
 */
export class Game {
  constructor({ viewportW, viewportH, hud, input }) {
    this.hud = hud;
    this.input = input;
    this.state = STATE.PLAYING;
    this.elapsedSec = 0;
    this._deferredKills = [];

    this.cbTypes = createCbTypes();

    const space = new Space(new Vec2(0, GRAVITY));
    space.gravity = new Vec2(0, GRAVITY);
    this.space = space;

    const level = parseLevel();
    this.level = level;
    this.levelBody = buildLevelBody(space, level.solidGrid);

    this.player = new Player(space, level.playerSpawn, this.cbTypes);

    this.goal = new Goal(space, level.goalPos, this.cbTypes);

    this.coins = [];
    this.hazards = [];
    this.enemies = [];
    this.destructibles = [];
    this.movingPlatforms = [];
    this.projectiles = new ProjectilePool(space, this.cbTypes);

    for (const e of level.entities) {
      const pos = new Vec2(e.x, e.y);
      switch (e.type) {
        case "coin":
          this.coins.push(new Coin(space, pos, this.cbTypes));
          break;
        case "hazard":
          this.hazards.push(new Hazard(space, pos, this.cbTypes));
          break;
        case "destructible":
          this.destructibles.push(new Destructible(space, pos, this.cbTypes));
          break;
        case "enemy_goomba":
          this.enemies.push(new GoombaEnemy(space, pos, this.cbTypes));
          break;
        case "enemy_spiky":
          this.enemies.push(new SpikyEnemy(space, pos, this.cbTypes));
          break;
        default:
          break;
      }
    }

    for (const p of level.movingPlatforms) {
      this.movingPlatforms.push(new MovingPlatform(space, p.from, p.to, p.length, this.cbTypes));
    }

    this.totalCoins = this.coins.length;

    this.camera = new Camera({
      viewportW,
      viewportH,
      worldW: level.width,
      worldH: level.height,
      smoothing: 0.18,
    });
    this.camera.snapTo(this.player.body.position);

    this._setupListeners();
  }

  _setupListeners() {
    const { space } = this;
    const t = this.cbTypes;
    const bodyOf = (interactor) => interactor.castBody ?? interactor.castShape?.body ?? null;
    // Tags live on the SHAPE in nape 3.35.0, not on the Body — so check the
    // shape's cbTypes (falling back to the body's for legacy compatibility).
    const hasCb = (interactor, tag) => {
      const s = interactor.castShape ?? null;
      if (s?.cbTypes?.has(tag)) return true;
      const b = bodyOf(interactor);
      return !!b?.cbTypes?.has?.(tag);
    };
    const otherOf = (cb, ownerCb) => {
      const i1 = cb.int1,
        i2 = cb.int2;
      const b1 = bodyOf(i1),
        b2 = bodyOf(i2);
      const owner = hasCb(i1, ownerCb) ? b1 : hasCb(i2, ownerCb) ? b2 : null;
      return { owner, other: b1 === owner ? b2 : b1 };
    };

    // Player ↔ anything: dispatch by what the other body is. Tag-paired
    // listeners (PLAYER × COIN, PLAYER × HAZARD, ...) don't reliably fire in
    // nape-js 3.35.0; ANY_BODY-paired listeners do.
    new InteractionListener(
      CbEvent.BEGIN,
      InteractionType.SENSOR,
      t.PLAYER,
      CbType.ANY_BODY,
      (cb) => {
        const i1 = cb.int1,
          i2 = cb.int2;
        const b1 = bodyOf(i1),
          b2 = bodyOf(i2);
        const otherBody = b1?.userData.coin || b1?.userData.goal ? b1 : b2;
        if (!otherBody) return;
        const coin = otherBody.userData.coin;
        if (coin?.collect()) {
          this.player.coins += 1;
          return;
        }
        if (otherBody.userData.goal && this.state === STATE.PLAYING) {
          this._onWin();
        }
      },
    ).space = space;
    new InteractionListener(
      CbEvent.BEGIN,
      InteractionType.COLLISION,
      t.PLAYER,
      CbType.ANY_BODY,
      (cb) => {
        const i1 = cb.int1,
          i2 = cb.int2;
        const b1 = bodyOf(i1),
          b2 = bodyOf(i2);
        const otherBody = b1?.userData.hazard ? b1 : b2?.userData.hazard ? b2 : null;
        if (otherBody) {
          this.player.takeDamage(otherBody.position.x);
        }
      },
    ).space = space;

    // Stompable enemy: route every player↔enemy collision through one
    // listener and dispatch by enemy `kind` from userData. This avoids
    // depending on per-tag (PLAYER × ENEMY_STOMPABLE / ENEMY_SPIKY) listener
    // resolution, which doesn't reliably fire in nape-js 3.35.0 — the
    // ANY_BODY-paired listener (probe) does fire reliably though.
    const handlePlayerEnemy = (cb) => {
      const i1 = cb.int1,
        i2 = cb.int2;
      const b1 = bodyOf(i1),
        b2 = bodyOf(i2);
      const enemyBody = b1?.userData.enemy ? b1 : b2?.userData.enemy ? b2 : null;
      const enemy = enemyBody?.userData.enemy;
      if (!enemy || enemy.dead) return;
      if (enemy.kind === "spiky") {
        this.player.takeDamage(enemy.body.position.x);
        return;
      }
      // goomba: stomp if the player is clearly *above* the enemy and moving
      // downward. We require playerBottom (y + RADIUS) to be above the enemy's
      // mid-line — that way a side hit (where the player's bottom is roughly
      // at the enemy's mid-line) damages, while a top hit stomps.
      const PLAYER_R = 18;
      const playerBottom = this.player.body.position.y + PLAYER_R;
      const enemyMid = enemy.body.position.y;
      const stomp = playerBottom < enemyMid && this.player.body.velocity.y > 80;
      if (stomp) {
        this._deferredKills.push(() => enemy.kill());
        this.player.bounceStomp();
        this.player._iFrames = Math.max(this.player._iFrames, 0.2);
      } else {
        this.player.takeDamage(enemy.body.position.x);
      }
    };
    new InteractionListener(
      CbEvent.BEGIN,
      InteractionType.COLLISION,
      t.PLAYER,
      CbType.ANY_BODY,
      handlePlayerEnemy,
    ).space = space;

    // (Spiky enemy damage is handled inside handlePlayerEnemy above.)

    // Bullet hits anything: dispatch by what the other body actually is.
    new InteractionListener(
      CbEvent.BEGIN,
      InteractionType.COLLISION,
      t.PROJECTILE,
      CbType.ANY_BODY,
      (cb) => {
        const i1 = cb.int1,
          i2 = cb.int2;
        const b1 = bodyOf(i1),
          b2 = bodyOf(i2);
        const bullet = b1?.userData.bullet ?? b2?.userData.bullet ?? null;
        const otherBody = b1?.userData.bullet ? b2 : b1;
        // Always recycle the bullet on any impact — projectiles never bounce.
        if (bullet) this._deferredKills.push(() => this.projectiles.recycle(bullet));
        if (!otherBody) return;
        const enemy = otherBody.userData.enemy;
        if (enemy && !enemy.dead) {
          this._deferredKills.push(() => enemy.kill());
          this.camera.shake(4, 30);
          return;
        }
        const dest = otherBody.userData.destructible;
        if (dest && !dest.broken) {
          const impact = bullet?.body.position ?? otherBody.position;
          this._deferredKills.push(() => dest.shatter(impact));
          this.camera.shake(6, 40);
        }
      },
    ).space = space;
  }

  /** Fixed-rate update. */
  fixedUpdate(input) {
    if (input.wasPressed("restart")) {
      this.restart();
      return;
    }
    if (this.state !== STATE.PLAYING) return;

    this.elapsedSec += STEP_DT;

    for (const p of this.movingPlatforms) p.step(STEP_DT);
    for (const e of this.enemies) e.step();
    this.projectiles.step(STEP_DT);
    for (const d of this.destructibles) d.step(STEP_DT);

    // Shoot
    if (input.wasPressed("shoot") && this.player.canShoot()) {
      this.player.noteShotFired();
      const origin = this.player.body.position;
      const ox = origin.x + this.player.facing * (Player.WIDTH / 2 + 6);
      const oy = origin.y - 4;
      this.projectiles.fire(new Vec2(ox, oy), this.player.facing, 0);
    }

    this.player.preStep(STEP_DT, input);
    this.space.step(STEP_DT);
    this.player.postStep(STEP_DT);

    // Apply deferred mutations (queued from inside cb listeners)
    for (const fn of this._deferredKills) {
      try {
        fn();
      } catch (_) {
        /* swallow — listener may have already run */
      }
    }
    this._deferredKills.length = 0;

    // Camera follow + spin coins
    this.camera.follow(this.player.body.position, STEP_DT);
    for (const c of this.coins) {
      if (!c.collected) c._spinPhase += STEP_DT * 4;
    }

    // Death check
    if (this.player.isDead()) this._onDeath();
  }

  _onDeath() {
    this.state = STATE.DEAD;
    this.camera.shake(10, 30);
    this.hud.showOverlay(
      "You died",
      `Coins: ${this.player.coins}/${this.totalCoins} · Press R or click to restart`,
      () => this.restart(),
    );
  }

  _onWin() {
    this.state = STATE.WON;
    this.hud.showOverlay(
      "Level cleared!",
      `Coins: ${this.player.coins}/${this.totalCoins} · Time: ${this.elapsedSec.toFixed(1)}s`,
      () => this.restart(),
    );
  }

  restart() {
    // Wholesale reset is the simplest correct path: everything is fresh.
    // If you need fast restart, swap in a `spaceFromBinary` snapshot
    // (see the save-load-rewind demo on napejs.org).
    location.reload();
  }
}

export { STEP_DT };
