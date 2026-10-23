// Pure helpers for editing a layout: placement ids, the layer a new piece goes on, moves kept inside the
// room's box, rotation, room-list (extras) edits, and the words for a piece on a keep-out zone. Inches
// throughout.
import { depthOf, placementRect, snap } from "../shared/geometry.ts";
import type { KeepOut, KeepOutKind, Pt, Rect } from "../shared/geometry.ts";
import type { Dimensions, Extra, Item, Layer, Placement, Rotation } from "../shared/schema.ts";

export type Dims = NonNullable<Dimensions>;

/** The drag-and-drop type a catalog row carries; its data is the item id. */
export const ITEM_DRAG_TYPE = "text/item-id";

/** Categories that go on the room list rather than the plan: they take no floor space. */
export const LIST_CATEGORIES: ReadonlySet<string> = new Set(["bedding", "curtains", "textiles", "bath", "kitchenware"]);

export const isListCategory = (category: string): boolean => LIST_CATEGORIES.has(category);

/** A lamp shorter than this (a table or desk lamp) stands on another piece; a taller one, or one of unknown height, on the floor. */
export const TABLE_LAMP_MAX_H = 40;

/**
 * Where "Add to plan" puts an item: rugs underneath; TVs, decor, mirrors and lamps under 40" tall on
 * top; everything else (a floor lamp, a lamp whose height is not recorded) on the floor.
 */
export function layerFor(item: Pick<Item, "category" | "dimensions">): Layer {
  const { category, dimensions } = item;
  if (category === "rug") return "rug";
  if (dimensions && dimensions.d === undefined) return "top"; // flat: hangs on a wall
  if (category === "tv" || category === "decor" || category === "mirror") return "top";
  if (category === "lamp") return dimensions?.h !== undefined && dimensions.h < TABLE_LAMP_MAX_H ? "top" : "floor";
  return "floor";
}

/** `<category>-<n>` with the smallest n the layout does not use yet. */
export function nextPlacementId(category: string, placements: readonly Placement[]): string {
  const used = new Set(placements.map((p) => p.id));
  let n = 1;
  while (used.has(`${category}-${n}`)) n++;
  return `${category}-${n}`;
}

/** The top-left that keeps a w × h footprint inside the box (pinned to its top-left when larger). */
export function clampInto(x: number, y: number, w: number, h: number, box: Rect): Pt {
  return {
    x: Math.max(box.x, Math.min(x, box.x + box.w - w)),
    y: Math.max(box.y, Math.min(y, box.y + box.h - h)),
  };
}

/** A new, unrotated placement on its category's layer, its top-left near `topLeft`: snapped to 1", kept inside the box. */
export function newPlacement(item: Item, dims: Dims, topLeft: Pt, box: Rect, placements: readonly Placement[]): Placement {
  const at = clampInto(snap(topLeft.x), snap(topLeft.y), dims.w, depthOf(dims), box);
  return { id: nextPlacementId(item.category, placements), itemId: item.id, x: at.x, y: at.y, rotation: 0, layer: layerFor(item) };
}

/** The placement moved to (x, y), kept inside the box; the same object when nothing changes. */
export function moveTo(p: Placement, dims: Dims, x: number, y: number, box: Rect): Placement {
  const r = placementRect(dims, p);
  const at = clampInto(x, y, r.w, r.h, box);
  return at.x === p.x && at.y === p.y ? p : { ...p, x: at.x, y: at.y };
}

/** Client pixels the pointer travels before a press on a piece becomes a drag; less is a click, which only selects. */
export const DRAG_THRESHOLD_PX = 3;

/** Whether the pointer has moved far enough from where it was pressed to start moving the piece. */
export function isDragStart(press: Pt, at: Pt): boolean {
  return Math.hypot(at.x - press.x, at.y - press.y) >= DRAG_THRESHOLD_PX;
}

/** Turns the piece 90° clockwise about its center (snapped, kept inside the box). */
export function rotateClockwise(p: Placement, dims: Dims, box: Rect): Placement {
  const before = placementRect(dims, p);
  const rotation = ((p.rotation + 90) % 360) as Rotation;
  const after = placementRect(dims, { ...p, rotation });
  const cx = before.x + before.w / 2;
  const cy = before.y + before.h / 2;
  const at = clampInto(snap(cx - after.w / 2), snap(cy - after.h / 2), after.w, after.h, box);
  return { ...p, rotation, x: at.x, y: at.y };
}

/** Applies `fn` to one placement; returns the same array when `fn` changes nothing. */
export function updatePlacement(placements: Placement[], id: string, fn: (p: Placement) => Placement): Placement[] {
  const i = placements.findIndex((p) => p.id === id);
  const current = placements[i];
  if (!current) return placements;
  const next = fn(current);
  if (next === current) return placements;
  const copy = placements.slice();
  copy[i] = next;
  return copy;
}

/** One more of the item on the room list: its qty goes up, or it joins the end with qty 1. */
export function addExtra(extras: readonly Extra[], itemId: string): Extra[] {
  const i = extras.findIndex((e) => e.itemId === itemId);
  const current = extras[i];
  if (!current) return [...extras, { itemId, qty: 1 }];
  const copy = extras.slice();
  copy[i] = { ...current, qty: current.qty + 1 };
  return copy;
}

/** Sets a line's qty (a whole number, at least 1); the same array when nothing changes. */
export function setExtraQty(extras: Extra[], itemId: string, qty: number): Extra[] {
  const next = Math.max(1, Math.round(qty));
  const i = extras.findIndex((e) => e.itemId === itemId);
  const current = extras[i];
  if (!current || !Number.isFinite(next) || current.qty === next) return extras;
  const copy = extras.slice();
  copy[i] = { ...current, qty: next };
  return copy;
}

/** The room list without the item; the same array when it is not on it. */
export function removeExtra(extras: Extra[], itemId: string): Extra[] {
  return extras.some((e) => e.itemId === itemId) ? extras.filter((e) => e.itemId !== itemId) : extras;
}

const KEEP_OUT_REASON: Record<KeepOutKind, (label: string) => string> = {
  stairs: () => "On the stairs",
  heater: () => "On the heater",
  swing: (label) => `In the ${label}'s swing`,
  front: (label) => `In front of the ${label}`,
  opening: (label) => `Blocks the ${label}`,
};

/** Why a floor piece is amber, one line per distinct reason: "On the stairs", "In the wardrobe's swing", "Blocks the opening to the kitchen". */
export function keepOutReasons(zones: readonly KeepOut[]): string[] {
  return [...new Set(zones.map((z) => KEEP_OUT_REASON[z.kind](z.label)))];
}

/** How many floor pieces stand on each kind of keep-out zone (a piece on two swings counts once). */
export function blockedCounts(blocked: ReadonlyMap<string, readonly KeepOut[]>): Record<KeepOutKind, number> {
  const counts: Record<KeepOutKind, number> = { stairs: 0, heater: 0, swing: 0, front: 0, opening: 0 };
  for (const zones of blocked.values()) for (const kind of new Set(zones.map((z) => z.kind))) counts[kind]++;
  return counts;
}

/** Which wall the piece's back is against, by rotation (see PlacementSchema). */
export const BACK_TO: Record<Rotation, string> = { 0: "top", 90: "right", 180: "bottom", 270: "left" };

/** `www.ikea.com/us/en/p/...` → `ikea.com`. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
