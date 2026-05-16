import { Body } from "../phys/Body";
import { BodyType } from "../phys/BodyType";
import { Polygon } from "../shape/Polygon";
import { Vec2 } from "../geom/Vec2";
import type { Material } from "../phys/Material";
import type { InteractionFilter } from "../dynamics/InteractionFilter";
import type { CbType } from "../callbacks/CbType";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A 2D row-major grid of tile values. `grid[y][x]` is the cell at row `y`, column `x`. */
export type TilemapGrid = ArrayLike<ArrayLike<number>>;

/** Predicate deciding whether a tile value at `(x, y)` represents a solid (collidable) cell. */
export type TilemapSolidPredicate = (value: number, x: number, y: number) => boolean;

/**
 * Strategy for combining adjacent solid tiles into fewer rectangles.
 *
 * - `"none"`   — every solid tile becomes its own 1x1 rectangle
 * - `"rows"`   — horizontally-adjacent solid tiles within a row are merged
 * - `"greedy"` — runs are extended both horizontally and vertically using a
 *   greedy meshing pass (default — produces the fewest rectangles)
 */
export type TilemapMergeMode = "none" | "rows" | "greedy";

/** Tile width and height in pixels. */
export interface TilemapTileSize {
  /** Tile width in pixels. */
  w: number;
  /** Tile height in pixels. */
  h: number;
}

/** Configuration options for {@link buildTilemapBody} / {@link meshTilemap}. */
export interface TilemapOptions {
  /** Tile size in pixels — either a square size or `{ w, h }` for non-square tiles. */
  tileSize: number | TilemapTileSize;

  /** Body position (top-left corner of the map in world space). Default `(0, 0)`. */
  position?: Vec2;

  /**
   * Predicate deciding which cells are solid. Default treats any non-zero
   * value as solid.
   */
  solid?: TilemapSolidPredicate;

  /** Merge strategy — defaults to `"greedy"`. */
  merge?: TilemapMergeMode;

  /** Material applied to every generated shape. */
  material?: Material;

  /** InteractionFilter applied to every generated shape. */
  filter?: InteractionFilter;

  /** CbTypes added to every generated shape. */
  cbTypes?: CbType[];

  /** Body type — defaults to `BodyType.STATIC`. Ignored when `body` is provided. */
  bodyType?: BodyType;

  /**
   * Append shapes to this existing body instead of creating a new one. Useful
   * for chunked maps where many tilemap layers share one body, or when adding
   * a collision mesh to a body that already exists.
   */
  body?: Body;
}

/** A rectangle in tile coordinates produced by {@link meshTilemap}. */
export interface TilemapRect {
  /** Tile column of the rectangle's left edge. */
  x: number;
  /** Tile row of the rectangle's top edge. */
  y: number;
  /** Width in tiles (>= 1). */
  w: number;
  /** Height in tiles (>= 1). */
  h: number;
}

/** Subset of a Tiled JSON tile layer needed for grid extraction. */
export interface TiledTileLayer {
  /** Flat row-major array of tile GIDs. */
  data: ArrayLike<number>;
  /** Width of the layer in tiles. */
  width: number;
  /** Height of the layer in tiles. */
  height: number;
}

/** Subset of an LDtk IntGrid layer instance needed for grid extraction. */
export interface LDtkIntGridLayer {
  /** Row-major flat array of int values (0 = empty). */
  intGridCsv: ArrayLike<number>;
  /** Cell-grid width (LDtk's `__cWid`, falls back to `cWid`). */
  __cWid?: number;
  /** Cell-grid height (LDtk's `__cHei`, falls back to `cHei`). */
  __cHei?: number;
  /** Alternate width key. */
  cWid?: number;
  /** Alternate height key. */
  cHei?: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const DEFAULT_SOLID: TilemapSolidPredicate = (v) => v !== 0;

function normalizeTileSize(tileSize: number | TilemapTileSize): TilemapTileSize {
  if (typeof tileSize === "number") {
    if (!isFinite(tileSize) || tileSize <= 0) {
      throw new Error("tileSize must be a positive finite number");
    }
    return { w: tileSize, h: tileSize };
  }
  if (
    tileSize == null ||
    !isFinite(tileSize.w) ||
    !isFinite(tileSize.h) ||
    tileSize.w <= 0 ||
    tileSize.h <= 0
  ) {
    throw new Error("tileSize.w and tileSize.h must be positive finite numbers");
  }
  return { w: tileSize.w, h: tileSize.h };
}

function gridDimensions(grid: TilemapGrid): { rows: number; cols: number } {
  if (grid == null) {
    throw new Error("grid cannot be null");
  }
  const rows = grid.length;
  if (rows === 0) return { rows: 0, cols: 0 };
  let cols = 0;
  for (let y = 0; y < rows; y++) {
    const row = grid[y];
    if (row == null) {
      throw new Error("grid row " + y + " is null");
    }
    if (row.length > cols) cols = row.length;
  }
  return { rows, cols };
}

// ---------------------------------------------------------------------------
// meshTilemap
// ---------------------------------------------------------------------------

/**
 * Convert a 2D grid of tile values into the minimal set of axis-aligned
 * rectangles that cover the solid cells, using the requested merge strategy.
 *
 * The result is geometry-only — no `Body` or `Shape` is created — which makes
 * this function reusable for debug overlays, rendering, or custom body
 * construction. {@link buildTilemapBody} is a thin wrapper that converts the
 * rectangles to `Polygon` shapes.
 *
 * Greedy meshing reduces shape count dramatically for typical platformer
 * maps. A 50-tile floor strip becomes one rectangle; a solid 10x10 block
 * becomes one rectangle instead of 100. Fewer shapes = smaller broadphase
 * footprint, faster narrowphase, less debug-draw work.
 *
 * @param grid - 2D row-major tile grid (`grid[y][x]`).
 * @param options - Optional `solid` predicate and `merge` strategy.
 * @returns The list of merged rectangles in tile coordinates.
 *
 * @example
 * ```ts
 * const rects = meshTilemap([
 *   [1, 1, 1, 0, 1],
 *   [1, 1, 1, 0, 1],
 *   [0, 0, 0, 0, 1],
 * ]);
 * // -> [{x:0,y:0,w:3,h:2}, {x:4,y:0,w:1,h:3}]
 * ```
 */
export function meshTilemap(
  grid: TilemapGrid,
  options: { solid?: TilemapSolidPredicate; merge?: TilemapMergeMode } = {},
): TilemapRect[] {
  const { rows, cols } = gridDimensions(grid);
  if (rows === 0 || cols === 0) return [];

  const solid = options.solid ?? DEFAULT_SOLID;
  const merge: TilemapMergeMode = options.merge ?? "greedy";

  const isSolidAt = (x: number, y: number): boolean => {
    const row = grid[y];
    if (row == null || x >= row.length) return false;
    const v = row[x];
    if (v == null) return false;
    return solid(v, x, y);
  };

  const rects: TilemapRect[] = [];

  if (merge === "none") {
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (isSolidAt(x, y)) rects.push({ x, y, w: 1, h: 1 });
      }
    }
    return rects;
  }

  const visited: boolean[][] = [];
  for (let y = 0; y < rows; y++) {
    visited.push(new Array(cols).fill(false));
  }

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (visited[y][x] || !isSolidAt(x, y)) continue;

      let w = 1;
      while (x + w < cols && isSolidAt(x + w, y) && !visited[y][x + w]) {
        w++;
      }

      let h = 1;
      if (merge === "greedy") {
        outer: while (y + h < rows) {
          for (let dx = 0; dx < w; dx++) {
            if (!isSolidAt(x + dx, y + h) || visited[y + h][x + dx]) {
              break outer;
            }
          }
          h++;
        }
      }

      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          visited[y + dy][x + dx] = true;
        }
      }

      rects.push({ x, y, w, h });
    }
  }

  return rects;
}

// ---------------------------------------------------------------------------
// buildTilemapBody
// ---------------------------------------------------------------------------

/**
 * Build a single physics `Body` from a 2D tile grid.
 *
 * Each merged rectangle becomes a `Polygon` shape on the body. Tiles are laid
 * out with `(0, 0)` at the top-left of tile `(0, 0)`, so the body's
 * `position` (defaults to origin) is the world-space location of that
 * top-left corner.
 *
 * Defaults to `BodyType.STATIC` and `merge: "greedy"`, matching the most
 * common gamedev use case (level collision geometry from a Tiled / LDtk map).
 *
 * @param grid - 2D row-major tile grid.
 * @param options - Tile size + body / shape options.
 * @returns A `Body` containing one `Polygon` shape per merged rectangle.
 *   The returned body is not yet attached to a `Space` — set `body.space`
 *   to insert it.
 *
 * @example
 * ```ts
 * const grid = [
 *   [1, 1, 1, 0, 1, 1, 1],
 *   [0, 0, 0, 0, 0, 0, 0],
 *   [1, 1, 1, 1, 1, 1, 1],
 * ];
 * const body = buildTilemapBody(grid, { tileSize: 32, position: Vec2.get(0, 100) });
 * body.space = space;
 * ```
 */
export function buildTilemapBody(grid: TilemapGrid, options: TilemapOptions): Body {
  if (options == null) {
    throw new Error("options is required");
  }
  const tileSize = normalizeTileSize(options.tileSize);
  const rects = meshTilemap(grid, { solid: options.solid, merge: options.merge });

  const body = options.body ?? new Body(options.bodyType ?? BodyType.STATIC, options.position);

  const material = options.material;
  const filter = options.filter;
  const cbTypes = options.cbTypes;

  for (const r of rects) {
    const px = r.x * tileSize.w;
    const py = r.y * tileSize.h;
    const pw = r.w * tileSize.w;
    const ph = r.h * tileSize.h;
    const verts = Polygon.rect(px, py, pw, ph);
    const shape = new Polygon(verts, material as Material, filter as InteractionFilter);
    if (cbTypes) {
      for (const t of cbTypes) shape.cbTypes.add(t);
    }
    body.shapes.add(shape);
  }

  return body;
}

// ---------------------------------------------------------------------------
// Tiled / LDtk parsers
// ---------------------------------------------------------------------------

/**
 * Convert a Tiled JSON tile layer into a 2D row-major grid suitable for
 * {@link meshTilemap} / {@link buildTilemapBody}.
 *
 * Only the `data`, `width`, and `height` fields of the layer are read — the
 * helper has no runtime dependency on a Tiled SDK and accepts any object with
 * that shape.
 *
 * @param layer - A Tiled tile layer (e.g. `map.layers[i]` from a Tiled JSON export).
 * @returns A 2D number array, with `0` representing empty tiles.
 */
export function tiledLayerToGrid(layer: TiledTileLayer): number[][] {
  if (layer == null) {
    throw new Error("layer cannot be null");
  }
  const data = layer.data;
  if (data == null || typeof data.length !== "number") {
    throw new Error("layer.data must be array-like");
  }
  const w = layer.width | 0;
  const h = layer.height | 0;
  if (w <= 0 || h <= 0) {
    throw new Error("layer.width / layer.height must be positive integers");
  }
  if (data.length < w * h) {
    throw new Error("layer.data length is less than width * height");
  }
  const grid: number[][] = [];
  for (let y = 0; y < h; y++) {
    const row: number[] = new Array(w);
    for (let x = 0; x < w; x++) {
      row[x] = data[y * w + x] ?? 0;
    }
    grid.push(row);
  }
  return grid;
}

/**
 * Convert an LDtk IntGrid layer instance into a 2D row-major grid.
 *
 * Reads `intGridCsv` plus the cell-dimension fields (`__cWid` / `__cHei`,
 * with `cWid` / `cHei` accepted as fallbacks). LDtk uses `0` for empty
 * IntGrid cells, which the default `solid` predicate already treats as
 * non-solid.
 *
 * @param layer - An LDtk IntGrid layer instance.
 * @returns A 2D number array, with `0` representing empty cells.
 */
export function ldtkLayerToGrid(layer: LDtkIntGridLayer): number[][] {
  if (layer == null) {
    throw new Error("layer cannot be null");
  }
  const data = layer.intGridCsv;
  if (data == null || typeof data.length !== "number") {
    throw new Error("layer.intGridCsv must be array-like");
  }
  const w = (layer.__cWid ?? layer.cWid ?? 0) | 0;
  const h = (layer.__cHei ?? layer.cHei ?? 0) | 0;
  if (w <= 0 || h <= 0) {
    throw new Error("layer.__cWid / __cHei (or cWid / cHei) must be positive integers");
  }
  if (data.length < w * h) {
    throw new Error("layer.intGridCsv length is less than __cWid * __cHei");
  }
  const grid: number[][] = [];
  for (let y = 0; y < h; y++) {
    const row: number[] = new Array(w);
    for (let x = 0; x < w; x++) {
      row[x] = data[y * w + x] ?? 0;
    }
    grid.push(row);
  }
  return grid;
}
