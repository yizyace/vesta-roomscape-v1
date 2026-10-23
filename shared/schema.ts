// Shapes of the three data files under data/ (rooms.json, catalog/items/<id>.json,
// layouts/<room>/<variant>.json) plus catalog/taxonomy.json. Pure: no fs, no DOM. Imported by the client, the
// server, the CLI and the tests, so every write goes through these parsers and the on-disk key order
// is the schema's. All lengths are inches.
import { z } from "zod";

const slug = z.string().regex(/^[a-z][a-z0-9-]*$/, "kebab-case slug");
const isoDate = z.iso.date();
const httpUrl = z.url({ protocol: /^https?$/ });

// ---------------------------------------------------------------------------
// rooms.json
// ---------------------------------------------------------------------------

export const DIRECTIONS = ["right", "down", "left", "up"] as const;
export type Direction = (typeof DIRECTIONS)[number];

// Walls are listed clockwise starting with the top wall; the polygon is the walk of the list
// (origin at the room's top-left corner, x to the right, y down).
export const WallSchema = z.object({
  name: slug,
  dir: z.enum(DIRECTIONS),
  length: z.number().positive(),
  kind: z.enum(["measured", "derived", "assumed"]),
  note: z.string().optional(),
});
export type Wall = z.infer<typeof WallSchema>;

// `stairs` is a band `depth` deep along its wall (the living room's staircase); nothing is placed on it.
export const FEATURE_TYPES = ["window", "door", "heater", "closet", "opening", "clear", "stairs"] as const;
export type FeatureType = (typeof FEATURE_TYPES)[number];

// A feature sits on a named wall. `at` is the offset along the wall from its start (its end when
// anchor is "end"). `measured` lists which of at/length/depth came from the tape; the rest is drawn
// dashed as "≈" until Andrew measures it.
export const FeatureSchema = z.object({
  type: z.enum(FEATURE_TYPES),
  wall: slug,
  anchor: z.enum(["start", "end"]).default("start"),
  at: z.number().nonnegative(),
  length: z.number().positive(),
  depth: z.number().positive().optional(),
  doors: z.enum(["single", "double"]).optional(),
  swing: z.enum(["in", "out"]).optional(),
  hinge: z.enum(["start", "end"]).optional(),
  measured: z.array(z.enum(["at", "length", "depth"])).default([]),
  label: z.string().optional(),
  note: z.string().optional(),
});
export type Feature = z.infer<typeof FeatureSchema>;

export const RoomSchema = z
  .object({
    id: slug,
    name: z.string().min(1),
    sketch: z.string().optional(),
    floor: z.enum(["tile", "wood", "unknown"]).default("unknown"),
    walls: z.array(WallSchema),
    features: z.array(FeatureSchema).default([]),
    notes: z.array(z.string()).default([]),
  })
  .superRefine((room, ctx) => {
    const names = new Set<string>();
    for (const w of room.walls) {
      if (names.has(w.name)) {
        ctx.addIssue({ code: "custom", message: `duplicate wall name "${w.name}"`, path: ["walls"] });
      }
      names.add(w.name);
    }
    if (room.walls.length === 0 && room.features.length > 0) {
      ctx.addIssue({ code: "custom", message: "a room without walls (not measured yet) cannot have features", path: ["features"] });
    }
    room.features.forEach((f, i) => {
      const wall = room.walls.find((w) => w.name === f.wall);
      if (!wall) {
        ctx.addIssue({ code: "custom", message: `feature on unknown wall "${f.wall}"`, path: ["features", i, "wall"] });
      } else if (f.at + f.length > wall.length + 1e-9) {
        ctx.addIssue({
          code: "custom",
          message: `feature runs past the end of wall "${f.wall}" (${f.at} + ${f.length} > ${wall.length})`,
          path: ["features", i],
        });
      }
    });
  });
export type Room = z.infer<typeof RoomSchema>;

export const RoomsSchema = z
  .object({
    units: z.literal("in"),
    source: z.string(),
    rooms: z.array(RoomSchema),
  })
  .superRefine((file, ctx) => {
    const ids = new Set<string>();
    file.rooms.forEach((r, i) => {
      if (ids.has(r.id)) ctx.addIssue({ code: "custom", message: `duplicate room id "${r.id}"`, path: ["rooms", i, "id"] });
      ids.add(r.id);
    });
  });
export type RoomsFile = z.infer<typeof RoomsSchema>;

// The six rooms of L01. Fixed: the UI never adds one, and a layout for any other id is refused.
export const ROOM_IDS = ["living-room", "dining-room", "kitchen", "master-bedroom", "back-bedroom", "maddie-room"] as const;
export type RoomId = (typeof ROOM_IDS)[number];
const roomId = z.enum(ROOM_IDS);

// ---------------------------------------------------------------------------
// catalog/taxonomy.json
// ---------------------------------------------------------------------------

export const TaxonomySchema = z.object({
  categories: z.array(slug).min(1),
  tags: z.array(slug),
});
export type Taxonomy = z.infer<typeof TaxonomySchema>;

// ---------------------------------------------------------------------------
// catalog/items/<id>.json
// ---------------------------------------------------------------------------

export const VENDORS = ["ikea", "amazon", "costco", "other", "owned"] as const;
export type Vendor = (typeof VENDORS)[number];

export const ITEM_STATUSES = ["candidate", "shortlisted", "ordered", "owned", "rejected"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const ITEM_ID_RE = /^(ikea|amazon|costco|other|owned)-[A-Za-z0-9][A-Za-z0-9-]*$/;

// w is the side that goes along a wall, d the projection into the room, h the height.
// `null` means the product page shows no dimensions: recorded, said aloud, never placed.
export const DimensionsSchema = z
  .object({
    w: z.number().positive(),
    // Omitted for a flat thing whose page gives only width and height (a curtain, a blind, a poster, a
    // pegboard): it can hang on a wall (the "top" layer), drawn FLAT_DEPTH deep, never stand on the floor.
    d: z.number().positive().optional(),
    h: z.number().positive().optional(),
    raw: z.string().optional(),
    source: z.string().optional(),
  })
  .nullable();
export type Dimensions = z.infer<typeof DimensionsSchema>;

export const PriceSchema = z
  .object({
    amount: z.number().nonnegative(),
    currency: z.literal("USD"),
    asOf: isoDate,
  })
  .nullable();

export const ItemImageSchema = z.object({
  file: z.string().regex(/^[A-Za-z0-9-]+-\d+\.jpg$/, "<itemId>-<n>.jpg"),
  sourceUrl: httpUrl.optional(),
  caption: z.string().optional(),
});
export type ItemImage = z.infer<typeof ItemImageSchema>;

export const ItemSchema = z
  .object({
    id: z.string().regex(ITEM_ID_RE, "<vendor>-<sku>"),
    vendor: z.enum(VENDORS),
    url: httpUrl.nullable(),
    name: z.string().min(1),
    brand: z.string().optional(),
    category: slug,
    tags: z.array(slug).default([]),
    rooms: z.array(roomId).default([]),
    status: z.enum(ITEM_STATUSES).default("candidate"),
    price: PriceSchema,
    dimensions: DimensionsSchema,
    images: z.array(ItemImageSchema).default([]),
    notes: z.string().default(""),
    captured: z.object({
      date: isoDate,
      by: z.string().min(1),
      method: z.enum(["chrome", "tape", "manual"]),
    }),
  })
  .superRefine((item, ctx) => {
    if (!item.id.startsWith(item.vendor + "-")) {
      ctx.addIssue({ code: "custom", message: `id "${item.id}" must start with vendor "${item.vendor}-"`, path: ["id"] });
    }
    if (item.url === null && item.vendor !== "owned") {
      ctx.addIssue({ code: "custom", message: "url is required unless vendor is \"owned\"", path: ["url"] });
    }
    item.images.forEach((img, i) => {
      // String operations, not a RegExp built from the id: this also runs when the id itself failed.
      const rest = img.file.startsWith(item.id + "-") ? img.file.slice(item.id.length + 1) : "";
      if (!/^\d+\.jpg$/.test(rest)) {
        ctx.addIssue({ code: "custom", message: `image file "${img.file}" must be "${item.id}-<n>.jpg"`, path: ["images", i, "file"] });
      }
    });
  });
export type Item = z.infer<typeof ItemSchema>;
export type ItemInput = z.input<typeof ItemSchema>;

// ---------------------------------------------------------------------------
// layouts/<room>/<variant>.json
// ---------------------------------------------------------------------------

export const ROTATIONS = [0, 90, 180, 270] as const;
export type Rotation = (typeof ROTATIONS)[number];

// How a placement stacks. "floor" pieces stand on the floor: they must not overlap each other, the
// stairs, a heater strip or a door's swing. "rug" lies underneath and may run under furniture. "top"
// sits on another piece or hangs on a wall (a TV on its console, a table lamp, wall art) and is drawn
// above. Every layer must stay inside the room.
export const LAYERS = ["floor", "rug", "top"] as const;
export type Layer = (typeof LAYERS)[number];

// x, y is the top-left corner of the axis-aligned footprint. rotation is clockwise: 0 = the front
// faces +y (the piece is backed against the top wall), 90 against the right wall, 180 the bottom,
// 270 the left. At 90/270 the footprint is d × w.
export const PlacementSchema = z.object({
  id: slug,
  itemId: z.string().regex(ITEM_ID_RE),
  x: z.number(),
  y: z.number(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
  layer: z.enum(LAYERS).default("floor"),
  note: z.string().optional(),
});
export type Placement = z.infer<typeof PlacementSchema>;

// An item that belongs to the room but takes no floor space: bedding, curtains, cushions, towels.
export const ExtraSchema = z.object({
  itemId: z.string().regex(ITEM_ID_RE),
  qty: z.number().int().positive().default(1),
  note: z.string().optional(),
});
export type Extra = z.infer<typeof ExtraSchema>;

// One arrangement of a room. A room has one file per variant, layouts/<room>/<variant>.json:
// "a" is the staged pick and "b", "c", … are the alternatives.
export const LayoutSchema = z
  .object({
    room: roomId,
    variant: slug.default("a"),
    name: z.string().default(""),
    updatedAt: z.iso.datetime().optional(),
    notes: z.string().default(""),
    placements: z.array(PlacementSchema).default([]),
    extras: z.array(ExtraSchema).default([]),
  })
  .superRefine((layout, ctx) => {
    const ids = new Set<string>();
    layout.placements.forEach((p, i) => {
      if (ids.has(p.id)) ctx.addIssue({ code: "custom", message: `duplicate placement id "${p.id}"`, path: ["placements", i, "id"] });
      ids.add(p.id);
    });
    const extraIds = new Set<string>();
    layout.extras.forEach((e, i) => {
      if (extraIds.has(e.itemId)) ctx.addIssue({ code: "custom", message: `"${e.itemId}" is listed twice in extras; use qty`, path: ["extras", i, "itemId"] });
      extraIds.add(e.itemId);
    });
  });
export type Layout = z.infer<typeof LayoutSchema>;
export type LayoutInput = z.input<typeof LayoutSchema>;

// ---------------------------------------------------------------------------
// Helpers shared by the server and the CLI
// ---------------------------------------------------------------------------

/** Turns a zod error into one line per issue, e.g. `dimensions.w: Number must be greater than 0`. */
export function issuesToLines(err: z.ZodError): string[] {
  return err.issues.map((i) => `${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`);
}

/** Canonical JSON text for the data files: the schema's key order, 2-space indent, trailing newline. */
export function toJsonText(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}
