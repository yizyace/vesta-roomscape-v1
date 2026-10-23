import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findCollisions, keepOutZones, walkWalls } from "../shared/geometry.ts";
import { FeatureSchema, RoomsSchema } from "../shared/schema.ts";
import type { Extra, Item } from "../shared/schema.ts";
import { addExtra, blockedCounts, isDragStart, isListCategory, keepOutReasons, layerFor, newPlacement, removeExtra, setExtraQty } from "../src/edit.ts";

const rooms = RoomsSchema.parse(JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures", "rooms.json"), "utf8"))).rooms;
const room = (id: string) => {
  const r = rooms.find((x) => x.id === id);
  if (!r) throw new Error(`no ${id} in the fixture rooms.json`);
  return r;
};

function item(id: string, category: string, w = 40, d = 20): Item {
  return {
    id,
    vendor: "ikea",
    url: "https://www.ikea.com/us/en/p/x",
    name: id,
    category,
    tags: [],
    rooms: [],
    status: "candidate",
    price: null,
    dimensions: { w, d },
    images: [],
    notes: "",
    captured: { date: "2026-10-22", by: "agent", method: "chrome" },
  };
}

describe("layers and the room list", () => {
  it("puts rugs underneath, TVs, decor and mirrors on top, and everything else on the floor", () => {
    const of = (category: string) => layerFor({ category, dimensions: { w: 20, d: 20, h: 30 } });
    expect(of("rug")).toBe("rug");
    expect(["tv", "decor", "mirror"].map(of)).toEqual(["top", "top", "top"]);
    expect(["sofa", "bed", "plant", "tv-stand", "other"].map(of)).toEqual(["floor", "floor", "floor", "floor", "floor"]);
  });

  it("puts a lamp under 40 inches tall on top (a table or desk lamp) and a taller one, or one without a height, on the floor", () => {
    const lamp = (h?: number) => layerFor({ category: "lamp", dimensions: { w: 7, d: 7, ...(h === undefined ? {} : { h }) } });
    expect(lamp(15.75)).toBe("top"); // STORSEGEL table lamp
    expect(lamp(39.9)).toBe("top");
    expect(lamp(40)).toBe("floor");
    expect(lamp(59)).toBe("floor"); // LAUTERS floor lamp
    expect(lamp()).toBe("floor");
    expect(layerFor({ category: "lamp", dimensions: null })).toBe("floor");
  });

  it("sends bedding, curtains, textiles, bath and kitchenware to the room list", () => {
    expect(["bedding", "curtains", "textiles", "bath", "kitchenware"].every(isListCategory)).toBe(true);
    expect(["rug", "decor", "sofa", "laundry"].some(isListCategory)).toBe(false);
  });

  it("gives a new placement its category's layer", () => {
    const box = { x: 0, y: 0, w: 200, h: 200 };
    const rug = item("ikea-rug", "rug", 79, 79);
    expect(newPlacement(rug, { w: 79, d: 79 }, { x: 10, y: 10 }, box, [])).toEqual({ id: "rug-1", itemId: "ikea-rug", x: 10, y: 10, rotation: 0, layer: "rug" });
    expect(newPlacement(item("ikea-tv", "tv"), { w: 48, d: 3 }, { x: 0, y: 0 }, box, []).layer).toBe("top");
    expect(newPlacement(item("ikea-sofa", "sofa"), { w: 80, d: 35 }, { x: 0, y: 0 }, box, []).layer).toBe("floor");
    const tableLamp = { ...item("ikea-lamp", "lamp", 7, 7), dimensions: { w: 7, d: 7, h: 15.75 } };
    expect(newPlacement(tableLamp, { w: 7, d: 7 }, { x: 0, y: 0 }, box, []).layer).toBe("top");
  });
});

describe("room-list edits", () => {
  const list: Extra[] = [
    { itemId: "ikea-curtain", qty: 2 },
    { itemId: "ikea-cushion", qty: 1, note: "on the sofa" },
  ];

  it("addExtra appends a new item with qty 1, or adds one to the item's line", () => {
    expect(addExtra(list, "ikea-throw")).toEqual([...list, { itemId: "ikea-throw", qty: 1 }]);
    expect(addExtra(list, "ikea-cushion")).toEqual([list[0], { itemId: "ikea-cushion", qty: 2, note: "on the sofa" }]);
    expect(list[1]?.qty).toBe(1); // not mutated
  });

  it("setExtraQty keeps qty a whole number of at least 1, and returns the same array when nothing changes", () => {
    expect(setExtraQty(list, "ikea-curtain", 4)).toEqual([{ itemId: "ikea-curtain", qty: 4 }, list[1]]);
    expect(setExtraQty(list, "ikea-curtain", 0)[0]?.qty).toBe(1);
    expect(setExtraQty(list, "ikea-curtain", 2.6)[0]?.qty).toBe(3);
    expect(setExtraQty(list, "ikea-curtain", 2)).toBe(list);
    expect(setExtraQty(list, "ikea-curtain", Number.NaN)).toBe(list);
    expect(setExtraQty(list, "ikea-none", 3)).toBe(list);
  });

  it("removeExtra drops the line, and returns the same array when the item is not listed", () => {
    expect(removeExtra(list, "ikea-curtain")).toEqual([list[1]]);
    expect(removeExtra(list, "ikea-none")).toBe(list);
  });
});

describe("keep-out reasons", () => {
  it("names the stairs and the heater in the living room", () => {
    // The fixture predates the stairs; this is the feature rooms.json has had since 2026-10-22.
    const living = room("living-room");
    const stairs = FeatureSchema.parse({ type: "stairs", wall: "left", at: 0, length: 173, depth: 36, measured: ["length"], label: "stairs" });
    const zones = keepOutZones(living.walls, [...living.features, stairs]);
    const items = new Map([["ikea-chair", item("ikea-chair", "chair", 30, 30)]]);
    const placements = [
      { id: "on-stairs", itemId: "ikea-chair", x: 10, y: 80, rotation: 0 as const, layer: "floor" as const },
      { id: "on-heater", itemId: "ikea-chair", x: 120, y: 2, rotation: 0 as const, layer: "floor" as const },
      { id: "in-the-corner", itemId: "ikea-chair", x: 20, y: 0, rotation: 0 as const, layer: "floor" as const },
      { id: "clear", itemId: "ikea-chair", x: 120, y: 80, rotation: 0 as const, layer: "floor" as const },
      { id: "rug-on-stairs", itemId: "ikea-chair", x: 10, y: 120, rotation: 0 as const, layer: "rug" as const },
    ];
    const { blocked } = findCollisions(placements, items, walkWalls(living.walls).points, zones);
    expect(keepOutReasons(blocked.get("on-stairs") ?? [])).toEqual(["On the stairs"]);
    expect(keepOutReasons(blocked.get("on-heater") ?? [])).toEqual(["On the heater"]);
    expect(keepOutReasons(blocked.get("in-the-corner") ?? [])).toEqual(["On the heater", "On the stairs"]);
    expect(blocked.has("clear")).toBe(false);
    expect(blocked.has("rug-on-stairs")).toBe(false);
    expect(blockedCounts(blocked)).toEqual({ stairs: 2, heater: 2, swing: 0, front: 0, opening: 0 });
  });

  it("names a swing by the feature's label, once for both leaves of a double door", () => {
    const back = room("back-bedroom");
    const swings = keepOutZones(back.walls, back.features).filter((z) => z.kind === "swing");
    expect(keepOutReasons(swings)).toEqual(["In the wardrobe's swing", "In the door's swing"]);
    expect(blockedCounts(new Map([["desk-1", swings]]))).toEqual({ stairs: 0, heater: 0, swing: 1, front: 0, opening: 0 });
  });

  it("names a closet's front, which is kept clear whichever way the closet door opens", () => {
    const master = room("master-bedroom");
    const fronts = keepOutZones(master.walls, master.features).filter((z) => z.kind === "front");
    expect(keepOutReasons(fronts)).toEqual(["In front of the walk-in closet"]);
    expect(blockedCounts(new Map([["dresser-1", fronts]]))).toEqual({ stairs: 0, heater: 0, swing: 0, front: 1, opening: 0 });
  });

  it("names the walkway along an opening, a side of the room with no wall", () => {
    const dining = room("dining-room");
    const openings = keepOutZones(dining.walls, dining.features).filter((z) => z.kind === "opening");
    expect(keepOutReasons(openings)).toEqual(["Blocks the opening"]);
    expect(blockedCounts(new Map([["sideboard-1", openings]]))).toEqual({ stairs: 0, heater: 0, swing: 0, front: 0, opening: 1 });
  });
});

describe("drag threshold", () => {
  it("treats a press that moves under 3 pixels as a click, so clicking a piece never nudges it onto the grid", () => {
    expect(isDragStart({ x: 100, y: 100 }, { x: 100, y: 100 })).toBe(false);
    expect(isDragStart({ x: 100, y: 100 }, { x: 102, y: 102 })).toBe(false); // 2.8 px
    expect(isDragStart({ x: 100, y: 100 }, { x: 103, y: 100 })).toBe(true);
  });
});
