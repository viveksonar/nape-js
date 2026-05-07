import { CbType } from "@newkrok/nape-js";

/**
 * Centralized CbType registry. Every gameplay body that needs to be
 * detected via collisions/sensors gets one of these tags. Keeping them
 * in a single object lets `InteractionListener` / `PreListener` setup
 * stay readable and prevents stringly-typed mistakes.
 */
export function createCbTypes() {
  return {
    PLAYER: new CbType(),
    PROJECTILE: new CbType(),
    COIN: new CbType(),
    HAZARD: new CbType(),
    GOAL: new CbType(),
    ENEMY_STOMPABLE: new CbType(),
    ENEMY_SPIKY: new CbType(),
    DESTRUCTIBLE: new CbType(),
    MOVING_PLATFORM: new CbType(),
    ONE_WAY: new CbType(),
  };
}
