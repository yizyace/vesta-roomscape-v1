import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  alongWall,
  bounds,
  doorArc,
  featureRect,
  featureSpan,
  findCollisions,
  footprintOutline,
  footprintRects,
  isClosed,
  keepOutZones,
  placementRect,
  pointInPolygon,
  rectInsidePolygon,
  rectsOverlap,
  signedArea,
  snap,
  walkWalls,
} from "../shared/geometry.ts";
import type { Pt, Segment } from "../shared/geometry.ts";
import { RoomsSchema } from "../shared/schema.ts";
import type { Dimensions, Feature, Item, Placement, Room, Wall } from "../shared/schema.ts";

// A snapshot of the 2026-10-22 record, not the live file: the numbers below are pinned to it, and a
// re-measured room must not fail the geometry tests (rooms-vs-csv.test.ts and data.test.ts read the
// live record).
const ROOMS_JSON = new URL("./fixtures/rooms.json", import.meta.url);
const { rooms } = RoomsSchema.parse(JSON.parse(readFileSync(ROOMS_JSON, "utf8")));
const WALLED_ROOM_IDS = rooms.filter((r) => r.walls.length > 0).map((r) => r.id);

function room(id: string): Room {
  const found = rooms.find((r) => r.id === id);
  if (!found) throw new Error(`rooms.json has no room "${id}"`);
  return found;
}

function segment(roomId: string, wallName: string): Segment {
  const found = walkWalls(room(roomId).walls).segments.find((s) => s.name === wallName);
  if (!found) throw new Error(`${roomId} has no wall "${wallName}"`);
  return found;
}

function feature(roomId: string, wallName: string, type: Feature["type"]): Feature {
  const found = room(roomId).features.find((f) => f.wall === wallName && f.type === type);
  if (!found) throw new Error(`${roomId} has no ${type} on "${wallName}"`);
  return found;
}

function points(roomId: string): Pt[] {
  return walkWalls(room(roomId).walls).points;
}

const wall = (name: string, dir: Wall["dir"], length: number): Wall => ({ name, dir, length, kind: "measured" });

describe("walkWalls on the fixture rooms.json (the 2026-10-22 record)", () => {
  it.each(WALLED_ROOM_IDS)("%s closes and runs clockwise (positive area)", (id) => {
    const walk = walkWalls(room(id).walls);
    expect(isClosed(walk)).toBe(true);
    expect(signedArea(walk.points)).toBeGreaterThan(0);
    expect(walk.area).toBe(signedArea(walk.points));
  });

  it.each(WALLED_ROOM_IDS)("%s: every wall's inward normal points into the room", (id) => {
    const pts = points(id);
    for (const s of walkWalls(room(id).walls).segments) {
      const mid = { x: (s.start.x + s.end.x) / 2, y: (s.start.y + s.end.y) / 2 };
      expect(pointInPolygon({ x: mid.x + s.inward.x / 2, y: mid.y + s.inward.y / 2 }, pts), `${s.name} inward`).toBe(true);
      expect(pointInPolygon({ x: mid.x - s.inward.x / 2, y: mid.y - s.inward.y / 2 }, pts), `${s.name} outward`).toBe(false);
    }
  });

  it("walks Maddie's room through the notch: 118 × 122", () => {
    const walk = walkWalls(room("maddie-room").walls);
    expect(walk.points).toEqual([
      { x: 0, y: 0 },
      { x: 118, y: 0 },
      { x: 118, y: 87 },
      { x: 103, y: 87 },
      { x: 103, y: 122 },
      { x: 0, y: 122 },
    ]);
    expect(bounds(walk.points)).toEqual({ x: 0, y: 0, w: 118, h: 122 });
    expect(walk.area).toBe(118 * 122 - 15 * 35);
  });

  it("makes the living room 275.5 × 173, wider below the step", () => {
    const walk = walkWalls(room("living-room").walls);
    expect(bounds(walk.points)).toEqual({ x: 0, y: 0, w: 275.5, h: 173 });
    expect(walk.area).toBe(275.5 * 173 - 14.5 * 93);
  });

  it("gives an unmeasured room (the kitchen) no polygon", () => {
    const walk = walkWalls(room("kitchen").walls);
    expect(walk).toEqual({ points: [], segments: [], closure: { x: 0, y: 0 }, area: 0 });
    expect(bounds(walk.points)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(pointInPolygon({ x: 0, y: 0 }, walk.points)).toBe(false);
    expect(rectInsidePolygon({ x: 0, y: 0, w: 1, h: 1 }, walk.points)).toBe(false);
  });

  it("reports an open walk, within the tolerance, and a negative area counterclockwise", () => {
    const maddieWalls = room("maddie-room").walls;
    expect(isClosed(walkWalls(maddieWalls.slice(0, -1)))).toBe(false);
    const almost = walkWalls([wall("top", "right", 100), wall("right", "down", 50), wall("bottom", "left", 100.005), wall("left", "up", 50)]);
    expect(isClosed(almost)).toBe(true);
    expect(isClosed(almost, 0.001)).toBe(false);
    expect(signedArea([...points("maddie-room")].reverse())).toBe(-(118 * 122 - 15 * 35));
  });
});

describe("positions along walls", () => {
  it("alongWall measures from the start, or back from the end with anchor end", () => {
    const top = segment("maddie-room", "top");
    expect(alongWall(top, 10)).toEqual({ x: 10, y: 0 });
    expect(alongWall(top, 10, "end")).toEqual({ x: 108, y: 0 });
    // The bottom wall runs right to left, so its end is the bottom-left corner.
    const bottom = segment("maddie-room", "bottom");
    expect(alongWall(bottom, 0, "end")).toEqual({ x: 0, y: 122 });
    expect(alongWall(bottom, 30, "end")).toEqual({ x: 30, y: 122 });
  });

  it("featureSpan puts Maddie's 108-inch clear wall from the top corner (0,0) to (0,108)", () => {
    // The left wall runs up, so a → b goes from (0,108) to the corner.
    expect(featureSpan(segment("maddie-room", "left"), feature("maddie-room", "left", "clear"))).toEqual({
      a: { x: 0, y: 108 },
      b: { x: 0, y: 0 },
    });
  });

  it("featureSpan runs a start-anchored feature along the wall's direction", () => {
    expect(featureSpan(segment("maddie-room", "right-upper"), feature("maddie-room", "right-upper", "window"))).toEqual({
      a: { x: 118, y: 2 },
      b: { x: 118, y: 57 },
    });
  });

  it("featureRect extends a feature inward (heater) or outward (closet box)", () => {
    const heater = feature("maddie-room", "right-upper", "heater");
    expect(featureRect(segment("maddie-room", "right-upper"), heater, 6, "in")).toEqual({ x: 112, y: 0, w: 6, h: 87 });
    const closet = feature("maddie-room", "bottom", "closet");
    expect(featureRect(segment("maddie-room", "bottom"), closet, 24, "out")).toEqual({ x: 40, y: 122, w: 55, h: 24 });
    expect(featureRect(segment("maddie-room", "bottom"), closet, 24, "in")).toEqual({ x: 40, y: 98, w: 55, h: 24 });
  });
});

describe("doorArc", () => {
  it("draws no arc for a door that swings out, or a feature without a swing", () => {
    const bathroom = feature("master-bedroom", "bottom", "door");
    expect(bathroom.swing).toBe("out");
    expect(doorArc(segment("master-bedroom", "bottom"), bathroom)).toEqual([]);
    expect(doorArc(segment("maddie-room", "right-upper"), feature("maddie-room", "right-upper", "window"))).toEqual([]);
  });

  it("hinges a single door at the span's end (hinge end) or its start (hinge start, the default)", () => {
    const bottom = segment("maddie-room", "bottom");
    const door = feature("maddie-room", "bottom", "door");
    expect(door).toMatchObject({ hinge: "end", swing: "in", length: 30 });
    // Hinge end: the bottom-left corner, sweeping from along the wall to up the left wall.
    expect(doorArc(bottom, door)).toEqual([{ center: { x: 0, y: 122 }, radius: 30, from: { x: 30, y: 122 }, to: { x: 0, y: 92 } }]);
    const atStart = [{ center: { x: 30, y: 122 }, radius: 30, from: { x: 0, y: 122 }, to: { x: 30, y: 92 } }];
    expect(doorArc(bottom, { ...door, hinge: "start" })).toEqual(atStart);
    const { hinge: _, ...noHinge } = door;
    expect(doorArc(bottom, noHinge)).toEqual(atStart);
  });

  it("gives double doors two half-width arcs meeting in the middle", () => {
    // The back bedroom's 68-inch wardrobe: two 34-inch leaves (measurements.md).
    const wardrobe = feature("back-bedroom", "bottom", "closet");
    expect(wardrobe).toMatchObject({ doors: "double", swing: "in", length: 68 });
    expect(doorArc(segment("back-bedroom", "bottom"), wardrobe)).toEqual([
      { center: { x: 78, y: 152 }, radius: 34, from: { x: 44, y: 152 }, to: { x: 78, y: 118 } },
      { center: { x: 10, y: 152 }, radius: 34, from: { x: 44, y: 152 }, to: { x: 10, y: 118 } },
    ]);
  });
});

describe("placements and collisions", () => {
  const desk = { w: 24.8, d: 18.9, h: 29.6 };

  it("placementRect swaps w and d at 90 and 270", () => {
    const at = (rotation: Placement["rotation"]) => placementRect(desk, { x: 10, y: 20, rotation });
    expect(at(0)).toEqual({ x: 10, y: 20, w: 24.8, h: 18.9 });
    expect(at(90)).toEqual({ x: 10, y: 20, w: 18.9, h: 24.8 });
    expect(at(180)).toEqual({ x: 10, y: 20, w: 24.8, h: 18.9 });
    expect(at(270)).toEqual({ x: 10, y: 20, w: 18.9, h: 24.8 });
  });

  it("rectsOverlap needs shared interior; a shared edge or corner is not an overlap", () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    expect(rectsOverlap(a, { x: 10, y: 0, w: 10, h: 10 })).toBe(false);
    expect(rectsOverlap(a, { x: 0, y: 10, w: 10, h: 10 })).toBe(false);
    expect(rectsOverlap(a, { x: 10, y: 10, w: 5, h: 5 })).toBe(false);
    expect(rectsOverlap(a, { x: 9.5, y: 0, w: 10, h: 10 })).toBe(true);
    expect(rectsOverlap({ x: 9.5, y: 0, w: 10, h: 10 }, a)).toBe(true);
    expect(rectsOverlap(a, { x: 2, y: 2, w: 3, h: 3 })).toBe(true);
  });

  it("pointInPolygon counts edges and corners as inside", () => {
    const maddie = points("maddie-room");
    expect(pointInPolygon({ x: 0, y: 50 }, maddie)).toBe(true);
    expect(pointInPolygon({ x: 118, y: 0 }, maddie)).toBe(true);
    expect(pointInPolygon({ x: 110, y: 87 }, maddie)).toBe(true);
    expect(pointInPolygon({ x: 103, y: 100 }, maddie)).toBe(true);
    expect(pointInPolygon({ x: 50, y: 50 }, maddie)).toBe(true);
    expect(pointInPolygon({ x: 110, y: 100 }, maddie)).toBe(false); // the notch
    expect(pointInPolygon({ x: -1, y: 50 }, maddie)).toBe(false);
    expect(pointInPolygon({ x: 50, y: 50 }, [{ x: 0, y: 0 }, { x: 100, y: 100 }])).toBe(false);
  });

  it("rectInsidePolygon: Maddie's notch", () => {
    const maddie = points("maddie-room");
    expect(rectInsidePolygon({ x: 100, y: 90, w: 10, h: 10 }, maddie)).toBe(false);
    expect(rectInsidePolygon({ x: 90, y: 90, w: 10, h: 10 }, maddie)).toBe(true);
    expect(rectInsidePolygon({ x: 0, y: 0, w: 118, h: 87 }, maddie)).toBe(true); // flush with three walls
    expect(rectInsidePolygon({ x: 0, y: 0, w: 118, h: 122 }, maddie)).toBe(false);
  });

  it("rectInsidePolygon: the living room's step", () => {
    const living = points("living-room");
    expect(rectInsidePolygon({ x: 255, y: 80, w: 15, h: 20 }, living)).toBe(false);
    expect(rectInsidePolygon({ x: 262, y: 100, w: 10, h: 20 }, living)).toBe(true);
  });

  it("rectInsidePolygon catches a rect whose corners are all inside but which spans a notch", () => {
    // A 20 × 20 notch cut down into the middle of the top wall; the rect's corners miss it.
    const notched = walkWalls([
      wall("top-left", "right", 40),
      wall("notch-left", "down", 20),
      wall("notch-bottom", "right", 20),
      wall("notch-right", "up", 20),
      wall("top-right", "right", 40),
      wall("right", "down", 100),
      wall("bottom", "left", 100),
      wall("left", "up", 100),
    ]);
    expect(isClosed(notched)).toBe(true);
    expect(rectInsidePolygon({ x: 30, y: 10, w: 40, h: 20 }, notched.points)).toBe(false);
  });

  // A 100 × 100 room with a 10-inch slot (a thin wall jutting in) from the right wall to x = 20.
  const slotted = walkWalls([
    wall("top", "right", 100),
    wall("right-upper", "down", 40),
    wall("slot-top", "left", 80),
    wall("slot-tip", "down", 10),
    wall("slot-bottom", "right", 80),
    wall("right-lower", "down", 50),
    wall("bottom", "left", 100),
    wall("left", "up", 100),
  ]);

  it("the slotted test room closes and leaves the slot outside", () => {
    expect(isClosed(slotted)).toBe(true);
    expect(pointInPolygon({ x: 50, y: 45 }, slotted.points)).toBe(false);
  });

  // KNOWN DEFECT (geometry.ts): rectInsidePolygon claims to be complete for rectilinear rooms, but a
  // slot that crosses the whole rect has no corner of the rect in it and no vertex inside the rect,
  // so the rect passes. Drop `.fails` once it checks the polygon's edges against the rect.
  it("rectInsidePolygon catches a slot that crosses the whole rect", () => {
    expect(rectInsidePolygon({ x: 30, y: 30, w: 40, h: 30 }, slotted.points)).toBe(false);
  });

  it("findCollisions flags overlapping and out-of-room placements, and skips items without dimensions", () => {
    const items = new Map<string, Pick<Item, "dimensions">>([
      ["ikea-bed", { dimensions: { w: 41, d: 79 } }],
      ["ikea-nightstand", { dimensions: { w: 16, d: 16 } }],
      ["amazon-B0FBGR4MM4", { dimensions: desk }],
      ["ikea-dresser", { dimensions: { w: 30, d: 20 } }],
      ["owned-lamp", { dimensions: null }],
    ]);
    const placements: Omit<Placement, "layer">[] = [
      { id: "bed", itemId: "ikea-bed", x: 0, y: 0, rotation: 0 }, // flush in the top-left corner
      { id: "nightstand", itemId: "ikea-nightstand", x: 41, y: 0, rotation: 0 }, // touches the bed's side
      { id: "desk", itemId: "amazon-B0FBGR4MM4", x: 30, y: 60, rotation: 0 }, // runs into the bed
      { id: "dresser", itemId: "ikea-dresser", x: 90, y: 95, rotation: 0 }, // runs into the notch
      { id: "lamp", itemId: "owned-lamp", x: 30, y: 60, rotation: 0 }, // on the desk, but has no footprint
    ];
    expect(findCollisions(placements, items, points("maddie-room"))).toEqual({
      overlapping: new Set(["bed", "desk"]),
      outside: new Set(["dresser"]),
      blocked: new Map(),
    });
  });

  // An 80" × 60" L-desk: the main top 80 × 30 along its back and the return 27.5" wide down its left
  // side, so the free notch where the chair goes is 52.5 × 30 at the front-right corner.
  const lDesk = { w: 80, d: 60, notch: { w: 52.5, d: 30, side: "right" as const } };

  it("footprintRects splits an L-shaped piece into its back and its arm at every rotation", () => {
    const at = (rotation: Placement["rotation"], dims: Dimensions = lDesk) => footprintRects(dims!, { x: 10, y: 20, rotation });
    expect(at(0)).toEqual([{ x: 10, y: 20, w: 80, h: 30 }, { x: 10, y: 50, w: 27.5, h: 30 }]);
    expect(at(90)).toEqual([{ x: 40, y: 20, w: 30, h: 80 }, { x: 10, y: 20, w: 30, h: 27.5 }]); // the return toward the top
    expect(at(180)).toEqual([{ x: 10, y: 50, w: 80, h: 30 }, { x: 62.5, y: 20, w: 27.5, h: 30 }]);
    expect(at(270)).toEqual([{ x: 10, y: 20, w: 30, h: 80 }, { x: 40, y: 72.5, w: 30, h: 27.5 }]);
    expect(at(0, { ...lDesk, notch: { ...lDesk.notch, side: "left" } })).toEqual([{ x: 10, y: 20, w: 80, h: 30 }, { x: 62.5, y: 50, w: 27.5, h: 30 }]);
    expect(at(90, desk)).toEqual([placementRect(desk, { x: 10, y: 20, rotation: 90 })]);
  });

  it("footprintOutline draws an L-shaped piece's six corners, turned with it", () => {
    expect(footprintOutline(lDesk, { x: 0, y: 0, rotation: 0 })).toEqual([
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 30 },
      { x: 27.5, y: 30 },
      { x: 27.5, y: 60 },
      { x: 0, y: 60 },
    ]);
    for (const rotation of [0, 90, 180, 270] as const) {
      expect(Math.abs(signedArea(footprintOutline(lDesk, { x: 5, y: 7, rotation })))).toBe(80 * 60 - 52.5 * 30);
    }
    expect(footprintOutline(desk, { x: 0, y: 0, rotation: 0 })).toHaveLength(4);
  });

  it("findCollisions lets a chair stand in an L-desk's notch but not on its return", () => {
    const items = new Map<string, Pick<Item, "dimensions">>([
      ["other-l-desk", { dimensions: lDesk }],
      ["ikea-chair", { dimensions: { w: 24, d: 24 } }],
    ]);
    const withChair = (x: number, y: number): Omit<Placement, "layer">[] => [
      { id: "desk", itemId: "other-l-desk", x: 0, y: 0, rotation: 0 },
      { id: "chair", itemId: "ikea-chair", x, y, rotation: 180 },
    ];
    expect(findCollisions(withChair(40, 32), items, points("master-bedroom")).overlapping).toEqual(new Set()); // in the notch
    expect(findCollisions(withChair(15, 40), items, points("master-bedroom")).overlapping).toEqual(new Set(["desk", "chair"])); // on the return
  });

  it("findCollisions keeps an L-shaped piece inside the room by its two rects, not its whole footprint", () => {
    // Its notch is exactly the corner Maddie's room is missing (x 103-118, y 87-122).
    const items = new Map([["other-hug", { dimensions: { w: 40, d: 40, notch: { w: 15, d: 35, side: "right" as const } } }]]);
    const at = (y: number): Omit<Placement, "layer">[] => [{ id: "l", itemId: "other-hug", x: 78, y, rotation: 0 }];
    expect(findCollisions(at(82), items, points("maddie-room")).outside).toEqual(new Set());
    expect(findCollisions(at(83), items, points("maddie-room")).outside).toEqual(new Set(["l"])); // an inch lower it runs into the missing corner and through the bottom wall
  });

  it("findCollisions uses the rotated footprint", () => {
    const items = new Map([["ikea-bookcase", { dimensions: { w: 30, d: 12 } }]]);
    const at = (rotation: Placement["rotation"]): Omit<Placement, "layer">[] => [{ id: "bookcase", itemId: "ikea-bookcase", x: 100, y: 20, rotation }];
    expect(findCollisions(at(0), items, points("maddie-room")).outside).toEqual(new Set(["bookcase"]));
    expect(findCollisions(at(90), items, points("maddie-room")).outside).toEqual(new Set());
  });

  it("snap rounds to the nearest grid step", () => {
    expect(snap(13.4)).toBe(13);
    expect(snap(13.5)).toBe(14);
    expect(snap(13, 6)).toBe(12);
    expect(snap(16, 6)).toBe(18);
    expect(snap(14.7, 0.5)).toBe(14.5);
    expect(snap(14.9, 0.5)).toBe(15);
  });
});

describe("keep-out zones and layers", () => {
  const living = room("living-room");
  const stairsRoom = {
    walls: living.walls,
    features: [...living.features, { type: "stairs" as const, wall: "left", anchor: "start" as const, at: 0, length: 173, depth: 36, measured: ["length" as const] }],
  };

  it("draws the stair band along the left wall, the heater strip, and a square per inward door leaf", () => {
    const zones = keepOutZones(stairsRoom.walls, stairsRoom.features);
    expect(zones.find((z) => z.kind === "stairs")?.rect).toEqual({ x: 0, y: 0, w: 36, h: 173 });
    expect(zones.find((z) => z.kind === "heater")?.rect).toEqual({ x: 0, y: 0, w: 261, h: 6 });
    const maddie = room("maddie-room");
    const swings = keepOutZones(maddie.walls, maddie.features).filter((z) => z.kind === "swing").map((z) => z.rect);
    expect(swings).toContainEqual({ x: 0, y: 92, w: 30, h: 30 }); // the door at the bottom-left
    expect(swings).toContainEqual({ x: 40, y: 94.5, w: 27.5, h: 27.5 }); // the closet's left leaf
    expect(swings).toContainEqual({ x: 67.5, y: 94.5, w: 27.5, h: 27.5 }); // and its right leaf
  });

  it("leaves the floor whole when the stairs run outside the wall, keeping a 36\" landing clear at each end", () => {
    const outside = { ...stairsRoom.features.at(-1)!, side: "out" as const };
    const zones = keepOutZones(living.walls, [...living.features, outside]);
    expect(zones.some((z) => z.kind === "stairs")).toBe(false);
    expect(zones.filter((z) => z.label === "stairs").map((z) => [z.kind, z.rect])).toEqual([
      ["front", { x: 0, y: 137, w: 36, h: 36 }], // the bottom end of the left wall, where its walk starts
      ["front", { x: 0, y: 0, w: 36, h: 36 }], // the window end
    ]);
    const items = new Map<string, Pick<Item, "dimensions">>([["ikea-sofa", { dimensions: { w: 90, d: 36 } }]]);
    const placed = [
      { id: "sofa-on-the-left-wall", itemId: "ikea-sofa", x: 0, y: 40, rotation: 270 as const }, // x 0-36, y 40-130: the old band
      { id: "sofa-on-a-landing", itemId: "ikea-sofa", x: 0, y: 131, rotation: 0 as const }, // y 131-167
    ];
    const c = findCollisions(placed, items, walkWalls(living.walls).points, zones);
    expect([...c.blocked.keys()]).toEqual(["sofa-on-a-landing"]);
    expect(c.blocked.get("sofa-on-a-landing")?.map((z) => z.kind)).toEqual(["front"]);
    expect(c.outside).toEqual(new Set());
  });

  it("keeps the floor along a railing clear the stairs' whole length, 36\" deep, when they run beyond the wall", () => {
    const railing = { ...stairsRoom.features.at(-1)!, side: "out" as const, railing: true };
    const zones = keepOutZones(living.walls, [...living.features, railing]);
    expect(zones.filter((z) => z.label === "stairs").map((z) => [z.kind, z.rect])).toEqual([["front", { x: 0, y: 0, w: 36, h: 173 }]]);
  });

  it("flags only floor pieces on a keep-out zone, and never lets a rug or an on-top piece collide", () => {
    const zones = keepOutZones(stairsRoom.walls, stairsRoom.features);
    const items = new Map<string, Pick<Item, "dimensions">>([
      ["ikea-sofa", { dimensions: { w: 90, d: 36 } }],
      ["ikea-rug", { dimensions: { w: 118, d: 79 } }],
      ["amazon-tv", { dimensions: { w: 57, d: 10 } }],
      ["ikea-console", { dimensions: { w: 70, d: 16 } }],
    ]);
    const outline = walkWalls(living.walls).points;
    const placed = [
      { id: "sofa-on-stairs", itemId: "ikea-sofa", x: 20, y: 60, rotation: 0 as const },
      { id: "rug", itemId: "ikea-rug", x: 10, y: 50, rotation: 0 as const, layer: "rug" as const },
      { id: "console", itemId: "ikea-console", x: 100, y: 157, rotation: 180 as const },
      { id: "tv", itemId: "amazon-tv", x: 106, y: 160, rotation: 180 as const, layer: "top" as const },
    ];
    const c = findCollisions(placed, items, outline, zones);
    expect([...c.blocked.keys()]).toEqual(["sofa-on-stairs"]);
    expect(c.blocked.get("sofa-on-stairs")?.map((z) => z.kind)).toEqual(["stairs"]);
    expect(c.overlapping).toEqual(new Set()); // the rug under the sofa and the TV on the console don't collide
    expect(c.outside).toEqual(new Set());
  });
});

describe("landings", () => {
  it("keeps 36 inches clear in front of every door and closet, whichever way it opens", () => {
    const master = room("master-bedroom");
    const fronts = keepOutZones(master.walls, master.features).filter((z) => z.kind === "front");
    expect(fronts.map((z) => z.rect)).toEqual([
      { x: 139, y: 97, w: 30, h: 36 }, // the bathroom door, swinging out
      { x: 25, y: 97, w: 42, h: 36 }, // the walk-in closet, door swinging out
      { x: 0, y: 103, w: 36, h: 30 }, // the room's door on the left wall, swinging in
    ]);
    const items = new Map<string, Pick<Item, "dimensions">>([["ikea-dresser", { dimensions: { w: 30, d: 18 } }]]);
    const c = findCollisions([{ id: "dresser", itemId: "ikea-dresser", x: 40, y: 115, rotation: 180 }], items, walkWalls(master.walls).points, keepOutZones(master.walls, master.features));
    expect(c.blocked.get("dresser")?.map((z) => z.label)).toEqual(["walk-in closet"]);
  });

  it("keeps a door's landing as deep as its own `landing`, so the master's king can end where the 30 inches start", () => {
    // Andrew, 2026-10-25: "ok", to a 30" landing at the bathroom door for the king.
    const master = room("master-bedroom");
    const zones = (landing?: number) =>
      keepOutZones(
        master.walls,
        master.features.map((f) => (f.label === "bathroom" && landing !== undefined ? { ...f, landing } : f)),
      );
    const bathroomFront = (landing?: number) => zones(landing).find((z) => z.kind === "front" && z.label === "bathroom")?.rect;
    expect(bathroomFront()).toEqual({ x: 139, y: 97, w: 30, h: 36 });
    expect(bathroomFront(30)).toEqual({ x: 139, y: 103, w: 30, h: 30 });
    const items = new Map<string, Pick<Item, "dimensions">>([["amazon-king", { dimensions: { w: 75.5, d: 79.5 } }]]);
    const king = (y: number, landing?: number) =>
      findCollisions([{ id: "bed", itemId: "amazon-king", x: 97.5, y, rotation: 90 }], items, points("master-bedroom"), zones(landing)).blocked;
    expect(king(27.5, 30).size).toBe(0); // y 27.5-103, up to the landing
    expect(king(28.5, 30).get("bed")?.map((z) => [z.kind, z.label])).toEqual([["front", "bathroom"]]); // 1" into it
    expect(king(27.5).get("bed")?.map((z) => [z.kind, z.label])).toEqual([["front", "bathroom"]]); // 6" into a 36" one
  });

  it("flags a piece backed against a door's or a closet's swing, where there is no room to stand", () => {
    // Andrew, 2026-10-23, of the TROFAST standing on the closet doors' arc in Maddie's room: "why would a
    // storage be put right in front of the door like this?"
    const maddie = room("maddie-room");
    const items = new Map<string, Pick<Item, "dimensions">>([
      ["ikea-trofast", { dimensions: { w: 36.625, d: 17.375 } }],
      ["ikea-book-display", { dimensions: { w: 19.25, d: 11 } }],
    ]);
    const placed = [
      { id: "toys", itemId: "ikea-trofast", x: 66.375, y: 77.125, rotation: 180 as const }, // its back on the closet doors' arc
      { id: "books", itemId: "ikea-book-display", x: 2, y: 78.5, rotation: 0 as const }, // 2.5" past the door's arc
      { id: "clear", itemId: "ikea-trofast", x: 40.5, y: 40.875, rotation: 270 as const }, // along the bed, 44.5" from the closet
    ];
    const c = findCollisions(placed, items, walkWalls(maddie.walls).points, keepOutZones(maddie.walls, maddie.features));
    expect(c.blocked.get("toys")?.map((z) => z.kind)).toEqual(["front"]);
    expect(c.blocked.get("books")?.map((z) => z.kind)).toEqual(["front"]);
    expect(c.blocked.has("clear")).toBe(false);
  });
});

describe("openings", () => {
  it("keeps a 30-inch walkway clear along a side with no wall, for floor pieces only", () => {
    const dining = room("dining-room"); // the snapshot draws its opening on the right side, x 128
    const zones = keepOutZones(dining.walls, dining.features).filter((z) => z.kind === "opening");
    expect(zones.map((z) => z.rect)).toEqual([{ x: 98, y: 0, w: 30, h: 119 }]);
    const items = new Map<string, Pick<Item, "dimensions">>([
      ["ikea-sideboard", { dimensions: { w: 47, d: 16 } }],
      ["ikea-table", { dimensions: { w: 47, d: 31 } }],
      ["ikea-rug", { dimensions: { w: 118, d: 79 } }],
    ]);
    const placed = [
      { id: "sideboard", itemId: "ikea-sideboard", x: 112, y: 36, rotation: 90 as const },
      { id: "table", itemId: "ikea-table", x: 40, y: 44, rotation: 0 as const },
      { id: "rug", itemId: "ikea-rug", x: 5, y: 20, rotation: 0 as const, layer: "rug" as const },
    ];
    const c = findCollisions(placed, items, walkWalls(dining.walls).points, zones);
    expect([...c.blocked.keys()]).toEqual(["sideboard"]);
    expect(c.blocked.get("sideboard")?.map((z) => z.kind)).toEqual(["opening"]);
  });
});


describe("flat items", () => {
  it("draws an item without a depth FLAT_DEPTH deep against its wall, turned with the piece", () => {
    const poster = { w: 22, h: 22 };
    expect(placementRect(poster, { x: 10, y: 0, rotation: 0 })).toEqual({ x: 10, y: 0, w: 22, h: 1 });
    expect(placementRect(poster, { x: 117, y: 30, rotation: 90 })).toEqual({ x: 117, y: 30, w: 1, h: 22 });
  });
});
