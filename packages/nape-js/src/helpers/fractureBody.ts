import { Body } from "../phys/Body";
import { BodyType } from "../phys/BodyType";
import { Polygon } from "../shape/Polygon";
import { Vec2 } from "../geom/Vec2";
import { computeVoronoi, generateFractureSites } from "../geom/Voronoi";
import type { VoronoiPoint } from "../geom/Voronoi";
import type { Material } from "../phys/Material";
import type { InteractionFilter } from "../dynamics/InteractionFilter";

/**
 * Options for body fracture.
 */
export interface FractureOptions {
  /** Number of fracture fragments to generate. Default `8`. */
  fragmentCount?: number;
  /**
   * Material to apply to all fragment shapes.
   * If not specified, the first shape's material is copied from the original body.
   */
  material?: Material;
  /** Interaction filter for all fragment shapes. */
  filter?: InteractionFilter;
  /**
   * Explosion impulse magnitude applied radially from the impact point.
   * Default `0` (no explosion impulse — fragments inherit body velocity).
   */
  explosionImpulse?: number;
  /**
   * Custom RNG function for reproducible fracture patterns.
   * Default `Math.random`.
   */
  random?: () => number;
  /**
   * If true, automatically add fragments to the same space as the original body
   * and remove the original body. Default `true`.
   */
  addToSpace?: boolean;
  /**
   * Custom Voronoi site positions (in body-local space).
   * If provided, `fragmentCount` is ignored and these exact sites are used.
   */
  sites?: VoronoiPoint[];
}

/**
 * Result of a fracture operation.
 */
export interface FractureResult {
  /** The generated fragment bodies. */
  fragments: Body[];
  /** The original body that was fractured (removed from space if `addToSpace` is true). */
  originalBody: Body;
}

/**
 * Fracture a body into multiple pieces using Voronoi decomposition.
 *
 * Takes the first polygon shape on the body, generates Voronoi cells within it,
 * clips each cell to the original polygon, and creates a new dynamic body for
 * each fragment. Fragments inherit the original body's linear and angular
 * velocity, plus an optional radial explosion impulse.
 *
 * @param body - The body to fracture. Must have at least one polygon shape.
 * @param impactPoint - World-space point where the fracture originates.
 *   Used as the center bias for site generation and explosion impulse direction.
 * @param options - Fracture configuration.
 * @returns A `FractureResult` with the array of fragment bodies.
 *
 * @throws If the body has no polygon shapes.
 *
 * @example
 * ```ts
 * const result = fractureBody(box, Vec2.get(100, 50), {
 *   fragmentCount: 12,
 *   explosionImpulse: 200,
 * });
 * // result.fragments are already in the space
 * ```
 */
export function fractureBody(
  body: Body,
  impactPoint: Vec2,
  options?: FractureOptions,
): FractureResult {
  const fragmentCount = options?.fragmentCount ?? 8;
  const explosionImpulse = options?.explosionImpulse ?? 0;
  const random = options?.random ?? Math.random;
  const addToSpace = options?.addToSpace ?? true;

  // Find the first polygon shape on the body
  const shape = findPolygonShape(body);
  if (!shape) {
    throw new Error("fractureBody requires a body with at least one Polygon shape");
  }

  // Extract world-space polygon vertices
  const worldVerts = getWorldVertices(shape);
  if (worldVerts.length < 3) {
    throw new Error("Polygon shape has fewer than 3 world vertices");
  }

  // Compute AABB of the polygon
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const v of worldVerts) {
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
  }

  // Generate or use provided fracture sites
  let sites: VoronoiPoint[];
  if (options?.sites) {
    // Convert from body-local to world-space
    const cos = Math.cos(body.rotation);
    const sin = Math.sin(body.rotation);
    const px = body.position.x;
    const py = body.position.y;
    sites = options.sites.map((s) => ({
      x: px + s.x * cos - s.y * sin,
      y: py + s.x * sin + s.y * cos,
    }));
  } else {
    sites = generateFractureSites(worldVerts, fragmentCount, random);
  }

  if (sites.length < 2) {
    // Not enough sites for meaningful fracture — return original body unchanged
    return { fragments: [body], originalBody: body };
  }

  // Compute Voronoi diagram
  const padding = 1;
  const voronoi = computeVoronoi(sites, {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding,
  });

  // Get original body properties
  const origVelX = body.velocity.x;
  const origVelY = body.velocity.y;
  const origAngVel = body.angularVel;
  const origMaterial = options?.material ?? getFirstMaterial(body);
  const origFilter = options?.filter;
  const space = body.space;
  const impactX = impactPoint.x;
  const impactY = impactPoint.y;

  // Create fragment bodies
  const fragments: Body[] = [];

  for (const cell of voronoi.cells) {
    // Clip Voronoi cell to the original polygon
    const clipped = clipConvexToConvex(cell.vertices, worldVerts);
    if (clipped.length < 3) continue;

    // Compute centroid of clipped polygon
    let cx = 0,
      cy = 0;
    for (const v of clipped) {
      cx += v.x;
      cy += v.y;
    }
    cx /= clipped.length;
    cy /= clipped.length;

    // Create local-space vertices (relative to centroid)
    const localVerts: Vec2[] = [];
    for (const v of clipped) {
      localVerts.push(Vec2.get(v.x - cx, v.y - cy));
    }

    // Ensure polygon is valid (minimum area)
    const area = polygonArea(localVerts);
    if (Math.abs(area) < 1) {
      for (const v of localVerts) v.dispose();
      continue;
    }

    // Create fragment body
    const fragment = new Body(BodyType.DYNAMIC, Vec2.get(cx, cy));
    const poly = new Polygon(localVerts, origMaterial, origFilter);
    fragment.shapes.add(poly);

    // Inherit velocity (with angular contribution at fragment position)
    const dx = cx - body.position.x;
    const dy = cy - body.position.y;
    const inheritVelX = origVelX - origAngVel * dy;
    const inheritVelY = origVelY + origAngVel * dx;
    fragment.velocity = Vec2.get(inheritVelX, inheritVelY);
    fragment.angularVel = origAngVel * 0.5;

    // Apply explosion impulse
    if (explosionImpulse > 0) {
      const ix = cx - impactX;
      const iy = cy - impactY;
      const dist = Math.sqrt(ix * ix + iy * iy) || 1;
      const impulse = Vec2.get((ix / dist) * explosionImpulse, (iy / dist) * explosionImpulse);
      fragment.applyImpulse(impulse);
    }

    // Copy userData if the original body had any
    if (body.userData != null) {
      const srcData = body.userData;
      const destData = fragment.userData;
      for (const key of Object.keys(srcData)) {
        destData[key] = srcData[key];
      }
      destData._fractureFragment = true;
    }

    fragments.push(fragment);
  }

  // Add to space and remove original
  if (addToSpace && space != null) {
    body.space = null;
    for (const f of fragments) {
      f.space = space;
    }
  }

  return { fragments, originalBody: body };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function findPolygonShape(body: Body): Polygon | null {
  for (const shape of body.shapes) {
    if (shape.isPolygon()) {
      return shape.castPolygon as unknown as Polygon;
    }
  }
  return null;
}

function getWorldVertices(polygon: Polygon): VoronoiPoint[] {
  const verts: VoronoiPoint[] = [];
  const wv = polygon.worldVerts;
  const len = wv.length;
  for (let i = 0; i < len; i++) {
    const v = wv.at(i);
    verts.push({ x: v.x, y: v.y });
  }
  return verts;
}

function getFirstMaterial(body: Body): Material | undefined {
  for (const shape of body.shapes) {
    return shape.material as Material;
  }
  return undefined;
}

/**
 * Compute signed area of a polygon (positive = CCW).
 */
function polygonArea(verts: Vec2[]): number {
  let area = 0;
  const n = verts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += verts[i].x * verts[j].y;
    area -= verts[j].x * verts[i].y;
  }
  return area / 2;
}

/**
 * Sutherland–Hodgman: clip subject polygon against a convex clip polygon.
 */
function clipConvexToConvex(subject: VoronoiPoint[], clip: VoronoiPoint[]): VoronoiPoint[] {
  let output = subject.slice();
  const n = clip.length;

  for (let i = 0; i < n; i++) {
    if (output.length === 0) return [];
    const input = output;
    output = [];

    const a = clip[i];
    const b = clip[(i + 1) % n];

    // Edge normal (pointing inward for CCW polygon)
    const edgeX = b.x - a.x;
    const edgeY = b.y - a.y;

    for (let j = 0; j < input.length; j++) {
      const curr = input[j];
      const prev = input[(j + input.length - 1) % input.length];

      const currSide = edgeX * (curr.y - a.y) - edgeY * (curr.x - a.x);
      const prevSide = edgeX * (prev.y - a.y) - edgeY * (prev.x - a.x);

      if (currSide >= 0) {
        if (prevSide < 0) {
          output.push(intersectEdge(prev, curr, a, b));
        }
        output.push(curr);
      } else if (prevSide >= 0) {
        output.push(intersectEdge(prev, curr, a, b));
      }
    }
  }

  return output;
}

function intersectEdge(
  p1: VoronoiPoint,
  p2: VoronoiPoint,
  p3: VoronoiPoint,
  p4: VoronoiPoint,
): VoronoiPoint {
  const x1 = p1.x,
    y1 = p1.y;
  const x2 = p2.x,
    y2 = p2.y;
  const x3 = p3.x,
    y3 = p3.y;
  const x4 = p4.x,
    y4 = p4.y;

  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-12) {
    return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
  }

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  return {
    x: x1 + t * (x2 - x1),
    y: y1 + t * (y2 - y1),
  };
}
