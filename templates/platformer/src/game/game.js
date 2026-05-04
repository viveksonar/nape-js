import { Space, Vec2, InteractionListener, InteractionType, CbEvent } from "@newkrok/nape-js";

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
    const otherOf = (cb, ownerCb) => {
      const i1 = cb.int1,
        i2 = cb.int2;
      const b1 = bodyOf(i1),
        b2 = bodyOf(i2);
      const owner = b1?.cbTypes?.has(ownerCb) ? b1 : b2?.cbTypes?.has(ownerCb) ? b2 : null;
      return { owner, other: b1 === owner ? b2 : b1 };
    };

    // Coin pickup
    new InteractionListener(CbEvent.BEGIN, InteractionType.SENSOR, t.PLAYER, t.COIN, (cb) => {
      const { other } = otherOf(cb, t.COIN);
      const coin = other?.userData.coin;
      if (coin?.collect()) {
        this.player.coins += 1;
      }
    }).space = space;

    // Goal
    new InteractionListener(CbEvent.BEGIN, InteractionType.SENSOR, t.PLAYER, t.GOAL, () => {
      if (this.state === STATE.PLAYING) this._onWin();
    }).space = space;

    // Spike hazard
    new InteractionListener(CbEvent.BEGIN, InteractionType.COLLISION, t.PLAYER, t.HAZARD, (cb) => {
      const { other } = otherOf(cb, t.HAZARD);
      if (other) this.player.takeDamage(other.position.x);
    }).space = space;

    // Stompable enemy: check whether player came from above
    new InteractionListener(
      CbEvent.BEGIN,
      InteractionType.COLLISION,
      t.PLAYER,
      t.ENEMY_STOMPABLE,
      (cb) => {
        const { other } = otherOf(cb, t.ENEMY_STOMPABLE);
        const enemy = other?.userData.enemy;
        if (!enemy || enemy.dead) return;
        const playerBottom = this.player.body.position.y + Player.HEIGHT / 2;
        const enemyTop = enemy.body.position.y - enemy.size / 2;
        const fromAbove = playerBottom < enemyTop + 8 && this.player.body.velocity.y > 50;
        if (fromAbove) {
          this._deferredKills.push(() => enemy.kill());
          this.player.bounceStomp();
        } else {
          this.player.takeDamage(enemy.body.position.x);
        }
      },
    ).space = space;

    // Spiky enemy: always damages
    new InteractionListener(
      CbEvent.BEGIN,
      InteractionType.COLLISION,
      t.PLAYER,
      t.ENEMY_SPIKY,
      (cb) => {
        const { other } = otherOf(cb, t.ENEMY_SPIKY);
        if (other) this.player.takeDamage(other.position.x);
      },
    ).space = space;

    // Bullet hits enemy (either kind)
    const onBulletHitEnemy = (cb, enemyTag) => {
      const i1 = cb.int1,
        i2 = cb.int2;
      const b1 = bodyOf(i1),
        b2 = bodyOf(i2);
      const bullet = b1?.userData.bullet ?? b2?.userData.bullet;
      const enemyBody = b1?.cbTypes?.has(enemyTag) ? b1 : b2?.cbTypes?.has(enemyTag) ? b2 : null;
      const enemy = enemyBody?.userData.enemy;
      if (bullet) this._deferredKills.push(() => this.projectiles.recycle(bullet));
      if (enemy && !enemy.dead) {
        this._deferredKills.push(() => enemy.kill());
        this.camera.shake(4, 30);
      }
    };
    new InteractionListener(
      CbEvent.BEGIN,
      InteractionType.COLLISION,
      t.PROJECTILE,
      t.ENEMY_STOMPABLE,
      (cb) => onBulletHitEnemy(cb, t.ENEMY_STOMPABLE),
    ).space = space;
    new InteractionListener(
      CbEvent.BEGIN,
      InteractionType.COLLISION,
      t.PROJECTILE,
      t.ENEMY_SPIKY,
      (cb) => onBulletHitEnemy(cb, t.ENEMY_SPIKY),
    ).space = space;

    // Bullet hits destructible: shatter
    new InteractionListener(
      CbEvent.BEGIN,
      InteractionType.COLLISION,
      t.PROJECTILE,
      t.DESTRUCTIBLE,
      (cb) => {
        const i1 = cb.int1,
          i2 = cb.int2;
        const b1 = bodyOf(i1),
          b2 = bodyOf(i2);
        const bullet = b1?.userData.bullet ?? b2?.userData.bullet;
        const destBody = b1?.userData.destructible ? b1 : b2?.userData.destructible ? b2 : null;
        const dest = destBody?.userData.destructible;
        if (bullet) this._deferredKills.push(() => this.projectiles.recycle(bullet));
        if (dest && !dest.broken) {
          const impact = bullet?.body.position ?? destBody.position;
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
