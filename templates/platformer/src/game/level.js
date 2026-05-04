import { Vec2, Material } from "@newkrok/nape-js";
import { buildTilemapBody } from "@newkrok/nape-js";

export const TILE_SIZE = 32;

/**
 * ASCII level format. One char per tile. Edit freely — `parseLevel` reads
 * this back into the (solid grid + entity list + moving-platform list)
 * triple that `Game` consumes.
 *
 *   .  empty
 *   =  solid tile (forms the static collision body via greedy meshing)
 *   s  spike hazard (instant damage on contact from any side)
 *   D  destructible block (one projectile hit and it shatters)
 *   $  coin pickup
 *   G  Goomba enemy spawn — patrols, stompable from above
 *   S  Spiky enemy spawn — patrols, damages the player from any side
 *   M  Moving-platform anchor — the platform travels rightward to the
 *      next M on the same row, then ping-pongs back. Use ONE pair per
 *      platform; the cells between are filled with the platform body.
 *   E  Vertical elevator (treats the column above the E as the travel
 *      range and ping-pongs vertically)
 *   P  Player spawn (exactly one)
 *   F  Goal flag (level end)
 */
const LEVEL_ROWS = [
  "................................................................",
  "................................................................",
  "................................................................",
  "..............................$$$..............................",
  ".............................=====.............................",
  "...................G..............................$$$..........",
  "..........$$$.....======.........................=====..D.D.D..",
  "..........===.................................G............===.",
  "..............M----M.................==============............",
  "...G.................................................G......F.",
  "==========.....s.s....======...DDDDDDD......s.s.s......========",
  "===========================================.===================",
  "================================================================",
  "================================================================",
];

/**
 * Parse the ASCII rows into a (solid grid + entity list).
 * Returns:
 *   - `solidGrid`: 2D boolean array (`true` = solid wall/floor) for the static body
 *   - `entities`: `{ type, x, y }[]` (world-space center of each tile cell)
 *   - `movingPlatforms`: `{ type: "linear", from, to, length }[]`
 *   - `playerSpawn`, `goalPos`: `Vec2`
 *   - `width`, `height`: world dimensions in pixels
 */
export function parseLevel() {
  const rows = LEVEL_ROWS;
  const h = rows.length;
  const w = rows[0].length;
  const solid = Array.from({ length: h }, () => Array(w).fill(false));
  const entities = [];
  const movingPlatforms = [];
  let playerSpawn = null;
  let goalPos = null;

  // First pass: solid + simple entities
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      const cx = (x + 0.5) * TILE_SIZE;
      const cy = (y + 0.5) * TILE_SIZE;
      switch (ch) {
        case "=":
          solid[y][x] = true;
          break;
        case "s":
          entities.push({ type: "hazard", x: cx, y: cy });
          break;
        case "D":
          entities.push({ type: "destructible", x: cx, y: cy });
          break;
        case "$":
          entities.push({ type: "coin", x: cx, y: cy });
          break;
        case "G":
          entities.push({ type: "enemy_goomba", x: cx, y: cy });
          break;
        case "S":
          entities.push({ type: "enemy_spiky", x: cx, y: cy });
          break;
        case "P":
          playerSpawn = new Vec2(cx, cy);
          break;
        case "F":
          goalPos = new Vec2(cx, cy);
          break;
        default:
          break;
      }
    }
  }

  // Second pass: moving platforms (M...M pairs on the same row)
  for (let y = 0; y < h; y++) {
    let startX = -1;
    for (let x = 0; x < w; x++) {
      if (rows[y][x] === "M") {
        if (startX < 0) {
          startX = x;
        } else {
          const length = (x - startX + 1) * TILE_SIZE;
          const from = new Vec2((startX + 0.5) * TILE_SIZE, (y + 0.5) * TILE_SIZE);
          const to = new Vec2((x + 0.5) * TILE_SIZE, (y + 0.5) * TILE_SIZE);
          movingPlatforms.push({ type: "linear", from, to, length });
          startX = -1;
        }
      }
    }
  }

  if (!playerSpawn) {
    // Fallback: bottom-left, two tiles up from floor
    playerSpawn = new Vec2(2 * TILE_SIZE, (h - 3) * TILE_SIZE);
  }
  if (!goalPos) {
    goalPos = new Vec2((w - 2) * TILE_SIZE, (h - 3) * TILE_SIZE);
  }

  return {
    solidGrid: solid,
    entities,
    movingPlatforms,
    playerSpawn,
    goalPos,
    width: w * TILE_SIZE,
    height: h * TILE_SIZE,
  };
}

/**
 * Build the static collision body from the solid grid using `buildTilemapBody`
 * (greedy meshing — typical levels collapse to ~10× fewer rectangles than
 * one-polygon-per-cell).
 */
export function buildLevelBody(space, solidGrid) {
  const body = buildTilemapBody(solidGrid, {
    tileSize: TILE_SIZE,
    position: new Vec2(0, 0),
    material: new Material(0.45, 0.55, 0.55, 1, 0.001),
  });
  body.space = space;
  return body;
}
