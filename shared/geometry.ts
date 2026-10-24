// Room geometry in inches. Pure: no DOM, no fs. The room polygon is the walk of its wall list
// (clockwise from the top-left corner, x right, y down); features and placements are resolved
// against that walk.
import type { Dimensions, Feature, Item, Layer, Placement, Wall } from "./schema.ts";

export type Pt = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

export type Segment = {
  name: string;
  start: Pt;
  end: Pt;
  dir: Wall["dir"];
  length: number;
  kind: Wall["kind"];
  /** Unit normal pointing into the room (the interior is on the right of a clockwise walk). */
  inward: Pt;
  /** Unit vector along the wall in its direction of travel. */
  along: Pt;
};

export type Walk = {
  /** Polygon vertices, one per wall start; empty for an unmeasured room. */
  points: Pt[];
  segments: Segment[];
  /** Where the walk ends relative to the origin; (0, 0) when the loop closes. */
  closure: Pt;
  /** Signed shoelace area; positive for a clockwise walk in screen coordinates. */
  area: number;
};

const ALONG: Record<Wall["dir"], Pt> = {
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  up: { x: 0, y: -1 },
};
// Interior is on the right-hand side of travel.
const INWARD: Record<Wall["dir"], Pt> = {
  right: { x: 0, y: 1 },
  down: { x: -1, y: 0 },
  left: { x: 0, y: -1 },
  up: { x: 1, y: 0 },
};

export function walkWalls(walls: Wall[]): Walk {
  const points: Pt[] = [];
  const segments: Segment[] = [];
  let cur: Pt = { x: 0, y: 0 };
  for (const w of walls) {
    const along = ALONG[w.dir];
    const end = { x: cur.x + along.x * w.length, y: cur.y + along.y * w.length };
    points.push(cur);
    segments.push({ name: w.name, start: cur, end, dir: w.dir, length: w.length, kind: w.kind, inward: INWARD[w.dir], along });
    cur = end;
  }
  return { points, segments, closure: cur, area: signedArea(points) };
}

/** Shoelace area; positive when the vertices run clockwise on a y-down screen. */
export function signedArea(points: Pt[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export function isClosed(walk: Walk, tolerance = 0.01): boolean {
  return Math.abs(walk.closure.x) <= tolerance && Math.abs(walk.closure.y) <= tolerance;
}

export function bounds(points: Pt[]): Rect {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** The point `at` inches from the wall's start (or from its end when anchor is "end"). */
export function alongWall(seg: Segment, at: number, anchor: "start" | "end" = "start"): Pt {
  const t = anchor === "start" ? at : seg.length - at;
  return { x: seg.start.x + seg.along.x * t, y: seg.start.y + seg.along.y * t };
}

/** Both ends of a feature on the wall line, in the wall's direction of travel. */
export function featureSpan(seg: Segment, f: Feature): { a: Pt; b: Pt } {
  if (f.anchor === "end") {
    return { a: alongWall(seg, f.at + f.length, "end"), b: alongWall(seg, f.at, "end") };
  }
  return { a: alongWall(seg, f.at, "start"), b: alongWall(seg, f.at + f.length, "start") };
}

/** The feature's footprint: `depth` inward from the wall (a heater, a closet's doors) or outward (a closet's box). */
export function featureRect(seg: Segment, f: Feature, depth: number, side: "in" | "out"): Rect {
  const { a, b } = featureSpan(seg, f);
  const n = side === "in" ? seg.inward : { x: -seg.inward.x, y: -seg.inward.y };
  const corners = [a, b, { x: a.x + n.x * depth, y: a.y + n.y * depth }, { x: b.x + n.x * depth, y: b.y + n.y * depth }];
  return bounds(corners);
}

export type Arc = { center: Pt; radius: number; from: Pt; to: Pt };

/**
 * Quarter-circle swing arcs for a door or closet that opens into the room: one arc of radius
 * `length` hinged at `hinge` (default start), or two half-width arcs for double doors.
 */
export function doorArc(seg: Segment, f: Feature): Arc[] {
  if (f.swing !== "in") return [];
  const { a, b } = featureSpan(seg, f);
  const n = seg.inward;
  const arc = (center: Pt, radius: number, towards: Pt): Arc => ({
    center,
    radius,
    from: towards,
    to: { x: center.x + n.x * radius, y: center.y + n.y * radius },
  });
  if (f.doors === "double") {
    const r = f.length / 2;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return [arc(a, r, mid), arc(b, r, mid)];
  }
  return f.hinge === "end" ? [arc(b, f.length, a)] : [arc(a, f.length, b)];
}

/** How deep a flat item (one recorded without `d`: a curtain, a poster) is drawn against its wall. */
export const FLAT_DEPTH = 1;

/** The item's depth for drawing: its `d`, or FLAT_DEPTH for a flat item. */
export function depthOf(dims: NonNullable<Dimensions>): number {
  return dims.d ?? FLAT_DEPTH;
}

/** The footprint an item occupies at a placement; w and d swap at 90° and 270°. */
export function placementRect(dims: NonNullable<Dimensions>, p: Pick<Placement, "x" | "y" | "rotation">): Rect {
  const turned = p.rotation === 90 || p.rotation === 270;
  const d = depthOf(dims);
  return { x: p.x, y: p.y, w: turned ? d : dims.w, h: turned ? dims.w : d };
}

/**
 * A point (u across the item from its left, v from its back) in the item's own frame at rotation 0,
 * turned clockwise with the item and offset to its placement.
 */
function turnPoint(dims: NonNullable<Dimensions>, p: Pick<Placement, "x" | "y" | "rotation">, u: number, v: number): Pt {
  const d = depthOf(dims);
  switch (p.rotation) {
    case 0:
      return { x: p.x + u, y: p.y + v };
    case 90:
      return { x: p.x + d - v, y: p.y + u };
    case 180:
      return { x: p.x + dims.w - u, y: p.y + d - v };
    case 270:
      return { x: p.x + v, y: p.y + dims.w - u };
  }
}

/**
 * The floor an item covers at a placement, as rectangles: its footprint, or for an L-shaped piece
 * (`dims.notch`) two, the full-width back and the arm beside the notch. The first is the one to draw
 * the photo, label and front tick in.
 */
export function footprintRects(dims: NonNullable<Dimensions>, p: Pick<Placement, "x" | "y" | "rotation">): Rect[] {
  const n = dims.notch;
  if (!n || dims.d === undefined) return [placementRect(dims, p)];
  const back = { u: 0, v: 0, w: dims.w, h: dims.d - n.d };
  const arm = { u: n.side === "right" ? 0 : n.w, v: dims.d - n.d, w: dims.w - n.w, h: n.d };
  return [back, arm].map((r) => bounds([turnPoint(dims, p, r.u, r.v), turnPoint(dims, p, r.u + r.w, r.v + r.h)]));
}

/** The outline to draw: the footprint's four corners, or an L-shaped piece's six, clockwise from its back-left. */
export function footprintOutline(dims: NonNullable<Dimensions>, p: Pick<Placement, "x" | "y" | "rotation">): Pt[] {
  const w = dims.w;
  const d = depthOf(dims);
  const n = dims.notch;
  const local: [number, number][] = !n
    ? [[0, 0], [w, 0], [w, d], [0, d]]
    : n.side === "right"
      ? [[0, 0], [w, 0], [w, d - n.d], [w - n.w, d - n.d], [w - n.w, d], [0, d]]
      : [[0, 0], [w, 0], [w, d], [n.w, d], [n.w, d - n.d], [0, d - n.d]];
  return local.map(([u, v]) => turnPoint(dims, p, u, v));
}

/** True when some rect of one list overlaps some rect of the other. */
export function footprintsOverlap(a: readonly Rect[], b: readonly Rect[]): boolean {
  return a.some((ra) => b.some((rb) => rectsOverlap(ra, rb)));
}

/** True when the interiors overlap; rects that only share an edge do not. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Ray casting; points on an edge count as inside. */
export function pointInPolygon(pt: Pt, points: Pt[]): boolean {
  if (points.length < 3) return false;
  if (pointOnBoundary(pt, points)) return true;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!;
    const b = points[j]!;
    const crosses = a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointOnBoundary(pt: Pt, points: Pt[], eps = 1e-9): boolean {
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const cross = (b.x - a.x) * (pt.y - a.y) - (b.y - a.y) * (pt.x - a.x);
    if (Math.abs(cross) > eps) continue;
    if (pt.x < Math.min(a.x, b.x) - eps || pt.x > Math.max(a.x, b.x) + eps) continue;
    if (pt.y < Math.min(a.y, b.y) - eps || pt.y > Math.max(a.y, b.y) + eps) continue;
    return true;
  }
  return false;
}

/**
 * True when the rect lies entirely inside the polygon: all four corners inside and no polygon edge
 * passing through the rect's interior. Complete for rectilinear rooms (it catches a rect straddling
 * a step, and a thin wall jutting across a piece).
 */
export function rectInsidePolygon(r: Rect, points: Pt[]): boolean {
  if (points.length < 3) return false;
  const corners = [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
  if (!corners.every((c) => pointInPolygon(c, points))) return false;
  const eps = 1e-9;
  return !points.some((a, i) => {
    const b = points[(i + 1) % points.length]!;
    return (
      Math.min(a.x, b.x) < r.x + r.w - eps &&
      Math.max(a.x, b.x) > r.x + eps &&
      Math.min(a.y, b.y) < r.y + r.h - eps &&
      Math.max(a.y, b.y) > r.y + eps
    );
  });
}

export type KeepOutKind = "stairs" | "heater" | "swing" | "front" | "opening";
/** Floor that a floor-layer piece must not stand on. */
export type KeepOut = { kind: KeepOutKind; label: string; rect: Rect };

/** Default depths for features drawn without one: the stair band and the heater strip. */
export const DEFAULT_STAIRS_DEPTH = 36;
export const DEFAULT_HEATER_DEPTH = 6;
/**
 * The landing kept clear in front of every door and closet, whichever way it opens (rules.md F-31): room to
 * step through a door and turn, or to stand at a closet with its doors open and reach in. It holds every
 * leaf up to 36" wide, so a piece can no longer stand on a swing's edge with no room in front.
 */
export const FRONT_CLEARANCE = 36;
/** The walkway kept clear along a side with no wall, so the open space stays open (rules.md F-42, F-30). */
export const OPENING_CLEARANCE = 30;

/**
 * The room's keep-out zones: each stair band, each heater strip, the square swept by every door or
 * closet door that swings into the room (one square per leaf), a 36" landing in front of every door and
 * closet, and a 30" walkway along every opening.
 */
export function keepOutZones(walls: Wall[], features: Feature[]): KeepOut[] {
  const segments = new Map(walkWalls(walls).segments.map((s) => [s.name, s]));
  const zones: KeepOut[] = [];
  for (const f of features) {
    const seg = segments.get(f.wall);
    if (!seg) continue;
    const label = f.label ?? f.type;
    if (f.type === "stairs") {
      zones.push({ kind: "stairs", label, rect: featureRect(seg, f, f.depth ?? DEFAULT_STAIRS_DEPTH, "in") });
    } else if (f.type === "heater") {
      zones.push({ kind: "heater", label, rect: featureRect(seg, f, f.depth ?? DEFAULT_HEATER_DEPTH, "in") });
    } else if (f.type === "door" || f.type === "closet") {
      for (const arc of doorArc(seg, f)) {
        const far = { x: arc.from.x + arc.to.x - arc.center.x, y: arc.from.y + arc.to.y - arc.center.y };
        zones.push({ kind: "swing", label, rect: bounds([arc.center, arc.from, arc.to, far]) });
      }
      zones.push({ kind: "front", label, rect: featureRect(seg, f, FRONT_CLEARANCE, "in") });
    } else if (f.type === "opening") {
      zones.push({ kind: "opening", label, rect: featureRect(seg, f, OPENING_CLEARANCE, "in") });
    }
  }
  return zones;
}

export type Collisions = {
  /** Floor pieces that overlap another floor piece. */
  overlapping: Set<string>;
  /** Pieces of any layer whose footprint leaves the room. */
  outside: Set<string>;
  /** Floor pieces standing on a keep-out zone, with the zones they touch. */
  blocked: Map<string, KeepOut[]>;
};

type Placed = Pick<Placement, "id" | "itemId" | "x" | "y" | "rotation"> & { layer?: Layer };

/**
 * Checks a layout. Only floor pieces collide with each other and with keep-out zones; rugs and
 * on-top pieces only have to stay inside the room. Items without dimensions are skipped. An L-shaped
 * piece covers its two rectangles, so whatever stands in its notch (the chair at an L-desk) is clear.
 */
export function findCollisions(
  placements: Placed[],
  itemsById: ReadonlyMap<string, Pick<Item, "dimensions">>,
  points: Pt[],
  keepOut: KeepOut[] = [],
): Collisions {
  const pieces: { id: string; rects: Rect[]; floor: boolean }[] = [];
  for (const p of placements) {
    const dims = itemsById.get(p.itemId)?.dimensions;
    if (!dims) continue;
    pieces.push({ id: p.id, rects: footprintRects(dims, p), floor: (p.layer ?? "floor") === "floor" });
  }
  const overlapping = new Set<string>();
  const outside = new Set<string>();
  const blocked = new Map<string, KeepOut[]>();
  for (let i = 0; i < pieces.length; i++) {
    const a = pieces[i]!;
    if (!a.rects.every((r) => rectInsidePolygon(r, points))) outside.add(a.id);
    if (!a.floor) continue;
    const hits = keepOut.filter((z) => footprintsOverlap(a.rects, [z.rect]));
    if (hits.length > 0) blocked.set(a.id, hits);
    for (let j = i + 1; j < pieces.length; j++) {
      const b = pieces[j]!;
      if (b.floor && footprintsOverlap(a.rects, b.rects)) {
        overlapping.add(a.id);
        overlapping.add(b.id);
      }
    }
  }
  return { overlapping, outside, blocked };
}

export function snap(v: number, grid = 1): number {
  return Number((Math.round(v / grid) * grid).toFixed(6));
}
