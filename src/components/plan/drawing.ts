// Plan-drawing geometry on top of shared/geometry.ts: wall bands, strips along a wall, label rows and
// the extent of everything drawn around a room. Inches throughout; pure.
import { DEFAULT_HEATER_DEPTH, DEFAULT_STAIRS_DEPTH, bounds, featureSpan, rectsOverlap } from "../../../shared/geometry.ts";
import type { Arc, Pt, Rect, Segment, Walk } from "../../../shared/geometry.ts";
import { inchesText, lengthLabel } from "../../../shared/format.ts";
import type { Feature, Room } from "../../../shared/schema.ts";

/** Walls are drawn this thick, outside the room line, so the interior keeps its measured size. */
export const WALL_T = 3;
/** Margin around the drawing (walls, closet boxes, dimension rows). */
export const PAD = 12;
/** A "clear" dimension line runs this far outside its wall, beyond the wall's own label. */
export const CLEAR_OFFSET = 12;
/** Label sizes, in inches so they scale with the plan. */
export const WALL_FONT = 4.5;
export const FEATURE_FONT = 3.5;
/** Drawn when rooms.json records no depth (the heater and stairs defaults are the keep-out zones' own). */
export const DEFAULT_CLOSET_DEPTH = 24;
/** Tread lines across a stair band, this far apart along its wall. */
export const TREAD = 10;

export const add = (p: Pt, v: Pt, k = 1): Pt => ({ x: p.x + v.x * k, y: p.y + v.y * k });
export const midpoint = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const outward = (seg: Segment): Pt => ({ x: -seg.inward.x, y: -seg.inward.y });
export const isVertical = (seg: Segment): boolean => seg.dir === "up" || seg.dir === "down";
export const pointsAttr = (pts: Pt[]): string => pts.map((p) => `${p.x},${p.y}`).join(" ");
export const rectAttrs = (r: Rect) => ({ x: r.x, y: r.y, width: r.w, height: r.h });

/** Distance of a point from the wall's start, measured along the wall. */
export const alongOf = (seg: Segment, p: Pt): number => (p.x - seg.start.x) * seg.along.x + (p.y - seg.start.y) * seg.along.y;

export function segmentOf(walk: Walk, f: Feature): Segment | undefined {
  return walk.segments.find((s) => s.name === f.wall);
}

export const closetDepth = (f: Feature): number => f.depth ?? DEFAULT_CLOSET_DEPTH;
export const heaterDepth = (f: Feature): number => f.depth ?? DEFAULT_HEATER_DEPTH;
export const stairsDepth = (f: Feature): number => f.depth ?? DEFAULT_STAIRS_DEPTH;

/** The strip from `from` to `to` inches outside the wall line (negative: into the room) over a..b. */
export function strip(seg: Segment, a: Pt, b: Pt, from: number, to: number): Rect {
  const n = outward(seg);
  return bounds([add(a, n, from), add(b, n, from), add(a, n, to), add(b, n, to)]);
}

/** A wall's band, run WALL_T past both ends so neighbouring bands close every outside corner. */
export function wallBand(seg: Segment): Rect {
  return strip(seg, add(seg.start, seg.along, -WALL_T), add(seg.end, seg.along, WALL_T), 0, WALL_T);
}

/** `93" · 7'9"`; under a foot just `3"` (lengthLabel would repeat it as `3" · 3"`). */
export function wallLengthText(inches: number): string {
  return inches >= 12 ? lengthLabel(inches) : inchesText(inches);
}

/**
 * Label sizes (and the rows and margin that hold them) grow with the room, from 1 up to 1.6 for the
 * living room, so a big room drawn in the same pane reads as easily as a small one.
 */
export function labelScale(walk: Walk): number {
  const b = bounds(walk.points);
  return Math.min(1.6, Math.max(1, Math.max(b.w, b.h) / 180));
}

/** Everything drawn around the room line: wall bands, closet boxes and clear-dimension rows (k: labelScale). */
export function drawingExtent(room: Room, walk: Walk, k = 1): Rect {
  const pts: Pt[] = [...walk.points];
  const include = (r: Rect) => pts.push({ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y + r.h });
  walk.segments.forEach((seg) => include(wallBand(seg)));
  for (const f of room.features) {
    const seg = segmentOf(walk, f);
    if (!seg) continue;
    const { a, b } = featureSpan(seg, f);
    if (f.type === "closet") include(strip(seg, a, b, 0, closetDepth(f)));
    if (f.type === "clear") include(strip(seg, a, b, 0, CLEAR_OFFSET * k));
  }
  return bounds(pts);
}

export const padRect = (r: Rect, pad: number): Rect => ({ x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad });

/** SVG path of a quarter-circle swing, from the closed edge to the open leaf. */
export function arcPath(arc: Arc): string {
  const v1 = { x: arc.from.x - arc.center.x, y: arc.from.y - arc.center.y };
  const v2 = { x: arc.to.x - arc.center.x, y: arc.to.y - arc.center.y };
  const sweep = v1.x * v2.y - v1.y * v2.x > 0 ? 1 : 0; // clockwise on a y-down screen
  return `M ${arc.from.x} ${arc.from.y} A ${arc.radius} ${arc.radius} 0 0 ${sweep} ${arc.to.x} ${arc.to.y}`;
}

/** The overlap of two rects, or null when their interiors do not meet. */
export function intersectRect(a: Rect, b: Rect): Rect | null {
  if (!rectsOverlap(a, b)) return null;
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return { x, y, w: Math.min(a.x + a.w, b.x + b.w) - x, h: Math.min(a.y + a.h, b.y + b.h) - y };
}

/** The widest stretch of a horizontal strip that none of `covers` overlaps, or null when they cover it all. */
export function freeRun(strip: Rect, covers: readonly Rect[]): { x: number; w: number } | null {
  const blocks = covers
    .filter((c) => rectsOverlap(c, strip))
    .map((c) => [Math.max(c.x, strip.x), Math.min(c.x + c.w, strip.x + strip.w)] as const)
    .sort((a, b) => a[0] - b[0]);
  let best: { x: number; w: number } | null = null;
  let cursor = strip.x;
  const consider = (to: number) => {
    if (to - cursor > (best?.w ?? 0) + 1e-9) best = { x: cursor, w: to - cursor };
  };
  for (const [lo, hi] of blocks) {
    consider(lo);
    cursor = Math.max(cursor, hi);
  }
  consider(strip.x + strip.w);
  return best;
}

/**
 * Where a rug's one-line label goes: a strip `h` tall inside its bottom edge, or its top edge when more
 * of that one shows, in the widest stretch the floor pieces standing on the rug leave uncovered.
 */
export function rugLabelSpot(rug: Rect, floor: readonly Rect[], h: number): { x: number; y: number; w: number } | null {
  let best: { x: number; y: number; w: number } | null = null;
  for (const y of [rug.y + rug.h - h, rug.y]) {
    const run = freeRun({ x: rug.x, y, w: rug.w, h }, floor);
    if (run && run.w > (best?.w ?? 0) + 1e-9) best = { x: run.x, y, w: run.w };
  }
  return best;
}
