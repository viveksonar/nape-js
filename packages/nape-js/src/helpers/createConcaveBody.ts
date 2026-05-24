import { Body } from "../phys/Body";
import { BodyType } from "../phys/BodyType";
import { Polygon } from "../shape/Polygon";
import { GeomPoly } from "../geom/GeomPoly";
import { Vec2 } from "../geom/Vec2";
import type { Material } from "../phys/Material";
import type { InteractionFilter } from "../dynamics/InteractionFilter";

/**
 * Options for creating a body from concave polygon vertices.
 */
export interface ConcaveBodyOptions {
  /** Body type — defaults to `BodyType.DYNAMIC`. */
  type?: BodyType;
  /** Body position in world space — defaults to origin. */
  position?: Vec2;
  /** Material applied to all decomposed shapes. */
  material?: Material;
  /** Interaction filter applied to all decomposed shapes. */
  filter?: InteractionFilter;
  /** Use Delaunay refinement for higher-quality triangulation. Default `false`. */
  delaunay?: boolean;
  /**
   * Simplification tolerance (Ramer–Douglas–Peucker epsilon).
   * When > 0, vertices are simplified before decomposition.
   * Default `0` (no simplification).
   */
  simplify?: number;
}

/**
 * Create a `Body` from concave (non-convex) polygon vertices.
 *
 * Accepts arbitrary simple polygon vertices (concave or convex), performs
 * validation, optional simplification, and convex decomposition via
 * `GeomPoly.convexDecomposition()`. Each convex partition becomes a
 * `Polygon` shape on the returned body.
 *
 * If the input is already convex, a single `Polygon` shape is created
 * (no decomposition overhead).
 *
 * @param vertices - Polygon vertices as `Vec2[]` or `GeomPoly`. Must form a
 *   simple (non-self-intersecting) polygon with at least 3 vertices.
 * @param options  - Optional configuration (body type, material, filter, etc.)
 * @returns A `Body` containing one or more convex `Polygon` shapes.
 *
 * @throws If vertices are null/undefined, fewer than 3, degenerate (zero area),
 *   or self-intersecting.
 *
 * @example
 * ```ts
 * // L-shaped concave polygon
 * const body = createConcaveBody([
 *   Vec2.get(0, 0), Vec2.get(100, 0), Vec2.get(100, 50),
 *   Vec2.get(50, 50), Vec2.get(50, 100), Vec2.get(0, 100),
 * ]);
 * body.space = space;
 * ```
 */
export function createConcaveBody(vertices: Vec2[] | GeomPoly, options?: ConcaveBodyOptions): Body {
  // --- Validate input ---
  if (vertices == null) {
    throw new Error("vertices cannot be null");
  }

  // Build a GeomPoly (copy to avoid mutating user input)
  let geom: GeomPoly;
  if (vertices instanceof GeomPoly) {
    if (vertices.zpp_disp) {
      throw new Error("GeomPoly has been disposed and cannot be used!");
    }
    geom = vertices.copy();
  } else {
    if (!Array.isArray(vertices)) {
      throw new Error("vertices must be an Array<Vec2> or GeomPoly");
    }
    if (vertices.length < 3) {
      throw new Error("At least 3 vertices are required, got " + vertices.length);
    }
    for (let i = 0; i < vertices.length; i++) {
      if (vertices[i] == null) {
        throw new Error("vertices[" + i + "] is null");
      }
    }
    geom = new GeomPoly(vertices);
  }

  // Validate geometry
  if (geom.size() < 3) {
    geom.dispose();
    throw new Error("At least 3 vertices are required, got " + geom.size());
  }
  if (geom.isDegenerate()) {
    geom.dispose();
    throw new Error("Polygon is degenerate (zero area)");
  }
  if (!geom.isSimple()) {
    geom.dispose();
    throw new Error("Polygon is self-intersecting");
  }

  // --- Optional simplification ---
  const simplifyEpsilon = options?.simplify ?? 0;
  if (simplifyEpsilon > 0) {
    const simplified = geom.simplify(simplifyEpsilon);
    geom.dispose();
    geom = simplified;

    if (geom.size() < 3 || geom.isDegenerate()) {
      geom.dispose();
      throw new Error("Polygon became degenerate after simplification (epsilon too large)");
    }
  }

  // --- Normalize winding order ---
  // convexDecomposition() requires clockwise winding
  if (!geom.isClockwise()) {
    // Reverse vertex order by extracting and rebuilding
    const verts: Vec2[] = [];
    const iter = geom.forwardIterator();
    while (iter.hasNext()) {
      const v = iter.next();
      verts.push(Vec2.get(v.x, v.y));
    }
    geom.dispose();
    verts.reverse();
    geom = new GeomPoly(verts);
  }

  // --- Decompose ---
  const material = options?.material;
  const filter = options?.filter;
  const delaunay = options?.delaunay ?? false;

  const body = new Body(options?.type ?? BodyType.DYNAMIC, options?.position);

  if (geom.isConvex()) {
    // Already convex — single shape, no decomposition needed
    body.shapes.add(new Polygon(geom, material, filter));
    geom.dispose();
    return body;
  }

  // Convex decomposition
  const parts = geom.convexDecomposition(delaunay);

  for (const part of parts) {
    body.shapes.add(new Polygon(part, material, filter));
  }

  // Cleanup
  geom.dispose();

  return body;
}
