import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { ItemSchema, LayoutSchema, RoomSchema, RoomsSchema, issuesToLines, toJsonText } from "../shared/schema.ts";
import type { ItemInput } from "../shared/schema.ts";

// The worked catalog example: a real Amazon listing captured in Chrome on 2026-10-22.
const WORKED = {
  id: "amazon-B0FBGR4MM4",
  vendor: "amazon",
  url: "https://www.amazon.com/dp/B0FBGR4MM4",
  name: "BOLUO kids desk",
  category: "desk",
  tags: ["kids", "bedroom"],
  rooms: ["maddie-room"],
  price: { amount: 85.99, currency: "USD", asOf: "2026-10-22" },
  dimensions: {
    w: 24.8,
    d: 18.9,
    h: 29.6,
    raw: 'Size Over dimension : 18.9"D x 24.8"W x 29.6"H',
    source: "#productOverview_feature_div row 'Size', read in Chrome 2026-10-22",
  },
  images: [{ file: "amazon-B0FBGR4MM4-1.jpg", sourceUrl: "https://m.media-amazon.com/images/I/61MykxgREUL._AC_SL1500_.jpg" }],
  captured: { date: "2026-10-22", by: "claude", method: "chrome" },
} satisfies ItemInput;

// Only the required fields, so every default shows.
const OWNED = {
  id: "owned-dresser",
  vendor: "owned",
  url: null,
  name: "Dresser",
  category: "dresser",
  price: null,
  dimensions: null,
  captured: { date: "2026-10-22", by: "andrew", method: "tape" },
} satisfies ItemInput;

const SQUARE_WALLS = [
  { name: "top", dir: "right", length: 100, kind: "measured" },
  { name: "right", dir: "down", length: 50, kind: "derived" },
  { name: "bottom", dir: "left", length: 100, kind: "derived" },
  { name: "left", dir: "up", length: 50, kind: "measured" },
] satisfies z.input<typeof RoomSchema>["walls"];

function room(extra: Partial<z.input<typeof RoomSchema>>): z.input<typeof RoomSchema> {
  return { id: "test-room", name: "Test room", walls: SQUARE_WALLS, ...extra };
}

/** A Maddie's-room layout input; each placement gets an id, the worked item and (0, 0) unless overridden. */
function layout(...placements: Record<string, unknown>[]): unknown {
  return {
    room: "maddie-room",
    placements: placements.map((p, i) => ({ id: `p${i}`, itemId: "amazon-B0FBGR4MM4", x: 0, y: 0, ...p })),
  };
}

/** The issue lines of a parse that must fail. */
function linesOf(schema: z.ZodType, input: unknown): string[] {
  const result = schema.safeParse(input);
  if (result.success) throw new Error(`expected the parse to fail: ${JSON.stringify(input)}`);
  return issuesToLines(result.error);
}

describe("ItemSchema", () => {
  it("parses the worked catalog item and fills status and notes", () => {
    expect(ItemSchema.parse(WORKED)).toEqual({ ...WORKED, status: "candidate", notes: "" });
  });

  it("fills the defaults: status candidate, tags/rooms/images [], notes empty", () => {
    const item = ItemSchema.parse(OWNED);
    expect(item).toMatchObject({ status: "candidate", tags: [], rooms: [], images: [], notes: "" });
    // Each parse gets its own default arrays, so editing one item can't leak into another.
    item.tags.push("kids");
    expect(ItemSchema.parse(OWNED).tags).toEqual([]);
  });

  it("returns keys in the schema's order (the on-disk order) and drops unknown keys", () => {
    const shuffled = Object.fromEntries(Object.entries({ ...WORKED, brand: "BOLUO", extra: "dropped" }).reverse());
    expect(Object.keys(ItemSchema.parse(shuffled))).toEqual(Object.keys(ItemSchema.shape));
  });

  it("rejects an id without a known vendor prefix", () => {
    expect(linesOf(ItemSchema, { ...WORKED, id: "wayfair-B0FBGR4MM4", images: [] })).toContain("id: <vendor>-<sku>");
  });

  it("rejects an id whose prefix is another vendor's", () => {
    expect(linesOf(ItemSchema, { ...WORKED, id: "ikea-B0FBGR4MM4", images: [] })).toEqual([
      'id: id "ikea-B0FBGR4MM4" must start with vendor "amazon-"',
    ]);
  });

  it("requires a url unless the vendor is owned", () => {
    expect(linesOf(ItemSchema, { ...WORKED, url: null })).toEqual(['url: url is required unless vendor is "owned"']);
    expect(ItemSchema.parse(OWNED).url).toBeNull();
  });

  it("rejects negative or zero dimensions", () => {
    expect(linesOf(ItemSchema, { ...WORKED, dimensions: { w: -24.8, d: 18.9 } })).toEqual([expect.stringMatching(/^dimensions\.w: /)]);
    expect(linesOf(ItemSchema, { ...WORKED, dimensions: { w: 24.8, d: 0, h: -1 } })).toEqual([
      expect.stringMatching(/^dimensions\.d: /),
      expect.stringMatching(/^dimensions\.h: /),
    ]);
  });

  it("accepts dimensions: null (the product page shows none)", () => {
    expect(ItemSchema.parse({ ...WORKED, dimensions: null }).dimensions).toBeNull();
  });

  it("rejects an image file that does not start with the item id", () => {
    // The name fits "<itemId>-<n>.jpg", so the one issue is the refine's check against this item's id.
    expect(linesOf(ItemSchema, { ...WORKED, images: [{ file: "amazon-B0OTHER000-1.jpg" }] })).toEqual([
      expect.stringMatching(/^images\.0\.file: image file "amazon-B0OTHER000-1\.jpg" must .*"amazon-B0FBGR4MM4-/),
    ]);
  });

  // KNOWN DEFECT (schema.ts): the refine only checks the "<id>-" prefix, so an image named for a
  // longer id passes, though "owned-dresser-2-1.jpg" is not "<itemId>-<n>.jpg" for "owned-dresser".
  // Drop `.fails` once the refine checks the whole name.
  it("rejects an image named for a longer item id (owned-dresser-2-1.jpg on owned-dresser)", () => {
    expect(ItemSchema.safeParse({ ...OWNED, images: [{ file: "owned-dresser-2-1.jpg" }] }).success).toBe(false);
  });
});

describe("LayoutSchema", () => {
  it("defaults the variant to a, placements and extras to [], notes and name to empty, rotation to 0 and layer to floor", () => {
    expect(LayoutSchema.parse({ room: "maddie-room" })).toEqual({ room: "maddie-room", variant: "a", name: "", notes: "", placements: [], extras: [] });
    expect(LayoutSchema.parse(layout({})).placements[0]?.rotation).toBe(0);
    expect(LayoutSchema.parse(layout({})).placements[0]?.layer).toBe("floor");
  });

  it("accepts the rug and top layers and rejects others", () => {
    expect(LayoutSchema.safeParse(layout({ layer: "rug" })).success).toBe(true);
    expect(LayoutSchema.safeParse(layout({ layer: "top" })).success).toBe(true);
    expect(linesOf(LayoutSchema, layout({ layer: "wall" }))).toEqual([expect.stringMatching(/^placements\.0\.layer: /)]);
  });

  it("takes extras with a positive whole quantity, once per item", () => {
    const base = { room: "maddie-room", placements: [] };
    expect(LayoutSchema.parse({ ...base, extras: [{ itemId: "ikea-10548216" }] }).extras).toEqual([{ itemId: "ikea-10548216", qty: 1 }]);
    expect(LayoutSchema.safeParse({ ...base, extras: [{ itemId: "ikea-10548216", qty: 0 }] }).success).toBe(false);
    expect(LayoutSchema.safeParse({ ...base, extras: [{ itemId: "ikea-10548216", qty: 1.5 }] }).success).toBe(false);
    expect(linesOf(LayoutSchema, { ...base, extras: [{ itemId: "ikea-10548216" }, { itemId: "ikea-10548216", qty: 2 }] })).toEqual([
      expect.stringMatching(/^extras\.1\.itemId: .*listed twice/),
    ]);
  });

  it("accepts the four right-angle rotations and rejects 45", () => {
    for (const rotation of [0, 90, 180, 270]) {
      expect(LayoutSchema.safeParse(layout({ rotation })).success).toBe(true);
    }
    expect(linesOf(LayoutSchema, layout({ rotation: 45 }))).toEqual([expect.stringMatching(/^placements\.0\.rotation: /)]);
  });

  it("rejects duplicate placement ids", () => {
    expect(linesOf(LayoutSchema, layout({ id: "desk" }, { id: "desk", x: 30 }))).toEqual([
      'placements.1.id: duplicate placement id "desk"',
    ]);
  });
});

describe("RoomSchema", () => {
  it("fills the room and feature defaults", () => {
    const parsed = RoomSchema.parse(room({ features: [{ type: "window", wall: "top", at: 10, length: 30 }] }));
    expect(parsed).toMatchObject({ floor: "unknown", notes: [], features: [{ anchor: "start", measured: [] }] });
    expect(RoomSchema.parse(room({})).features).toEqual([]);
  });

  it("rejects duplicate wall names", () => {
    const walls = [...SQUARE_WALLS, { name: "top", dir: "right", length: 1, kind: "measured" } as const];
    expect(linesOf(RoomSchema, room({ walls }))).toEqual(['walls: duplicate wall name "top"']);
  });

  it("rejects a feature on an unknown wall", () => {
    expect(linesOf(RoomSchema, room({ features: [{ type: "window", wall: "north", at: 0, length: 10 }] }))).toEqual([
      'features.0.wall: feature on unknown wall "north"',
    ]);
  });

  it("rejects a feature running past the end of its wall, and accepts one ending on it", () => {
    expect(linesOf(RoomSchema, room({ features: [{ type: "window", wall: "top", at: 80, length: 30 }] }))).toEqual([
      'features.0: feature runs past the end of wall "top" (80 + 30 > 100)',
    ]);
    expect(RoomSchema.safeParse(room({ features: [{ type: "window", wall: "top", anchor: "end", at: 70, length: 30 }] })).success).toBe(true);
  });

  it("rejects features in a room with walls: [] (not measured yet), but accepts the empty room", () => {
    expect(linesOf(RoomSchema, room({ walls: [], features: [{ type: "door", wall: "top", at: 0, length: 30 }] }))).toContain(
      "features: a room without walls (not measured yet) cannot have features",
    );
    expect(RoomSchema.safeParse(room({ walls: [] })).success).toBe(true);
  });

  it("RoomsSchema rejects duplicate room ids", () => {
    const kitchen = { id: "kitchen", name: "Kitchen", walls: [] };
    expect(linesOf(RoomsSchema, { units: "in", source: "test", rooms: [kitchen, kitchen] })).toEqual([
      'rooms.1.id: duplicate room id "kitchen"',
    ]);
  });
});

describe("issuesToLines", () => {
  it("writes one line per issue with a dotted path", () => {
    expect(linesOf(ItemSchema, { ...WORKED, dimensions: { w: 0, d: 18.9 }, images: [{ file: "desk.png" }] })).toEqual([
      expect.stringMatching(/^dimensions\.w: /),
      "images.0.file: <itemId>-<n>.jpg",
      expect.stringMatching(/^images\.0\.file: image file "desk\.png" must /),
    ]);
  });

  it("labels an issue on the value itself (root)", () => {
    expect(linesOf(LayoutSchema, "not a layout")).toEqual([expect.stringMatching(/^\(root\): /)]);
  });
});

describe("toJsonText", () => {
  it("indents with 2 spaces and ends with one newline", () => {
    const value = { room: "maddie-room", placements: [{ id: "desk", x: 1.5 }] };
    const text = toJsonText(value);
    expect(text).toBe('{\n  "room": "maddie-room",\n  "placements": [\n    {\n      "id": "desk",\n      "x": 1.5\n    }\n  ]\n}\n');
    expect(text.endsWith("}\n")).toBe(true);
    expect(JSON.parse(text)).toEqual(value);
  });
});
