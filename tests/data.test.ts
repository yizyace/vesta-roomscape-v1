// The data files under data/, read straight from disk. The catalog and layout
// directories may not exist yet; their checks are skipped until they do.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { ItemSchema, LayoutSchema, ROOM_IDS, RoomsSchema, TaxonomySchema, issuesToLines } from "../shared/schema.ts";

const DATA = new URL("../data/", import.meta.url);
const ITEMS_DIR = new URL("catalog/items/", DATA);
const IMAGES_DIR = new URL("images/", DATA);
const LAYOUTS_DIR = new URL("layouts/", DATA);
const ROOM_ID_SET = new Set<string>(ROOM_IDS);

type JsonFile = { file: string; data: unknown; error?: string };

/** Every .json file in a directory, parsed as JSON; [] when the directory doesn't exist. */
function jsonFiles(dir: URL): JsonFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => {
      try {
        return { file, data: JSON.parse(readFileSync(new URL(file, dir), "utf8")) };
      } catch (err) {
        return { file, data: undefined, error: String(err) };
      }
    });
}

/** Parses each file with the schema; the values that parse, and one line per JSON or schema problem. */
function parseAll<T>(files: JsonFile[], schema: z.ZodType<T>): { parsed: { file: string; value: T }[]; problems: string[] } {
  const parsed: { file: string; value: T }[] = [];
  const problems: string[] = [];
  for (const { file, data, error } of files) {
    if (error) {
      problems.push(`${file}: ${error}`);
      continue;
    }
    const result = schema.safeParse(data);
    if (result.success) parsed.push({ file, value: result.data });
    else problems.push(...issuesToLines(result.error).map((line) => `${file}: ${line}`));
  }
  return { parsed, problems };
}

/** Every layouts/<room>/<variant>.json, named "<room>/<variant>.json"; flat files keep their bare name. */
function layoutFiles(): JsonFile[] {
  if (!existsSync(LAYOUTS_DIR)) return [];
  const flat = jsonFiles(LAYOUTS_DIR);
  const nested = readdirSync(LAYOUTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((dir) => jsonFiles(new URL(`${dir.name}/`, LAYOUTS_DIR)).map((f) => ({ ...f, file: `${dir.name}/${f.file}` })));
  return [...flat, ...nested];
}

const rooms = RoomsSchema.safeParse(JSON.parse(readFileSync(new URL("rooms.json", DATA), "utf8")));
const taxonomy = TaxonomySchema.safeParse(JSON.parse(readFileSync(new URL("catalog/taxonomy.json", DATA), "utf8")));
const items = parseAll(jsonFiles(ITEMS_DIR), ItemSchema);
const layouts = parseAll(layoutFiles(), LayoutSchema);

const duplicates = (values: string[]): string[] => values.filter((v, i) => values.indexOf(v) !== i);

describe("rooms.json", () => {
  it("parses with RoomsSchema and lists exactly the six ROOM_IDS, in order", () => {
    expect(rooms.success ? [] : issuesToLines(rooms.error)).toEqual([]);
    expect(rooms.data?.rooms.map((r) => r.id)).toEqual([...ROOM_IDS]);
  });

  it("points each room at a sketch that exists", () => {
    const missing = (rooms.data?.rooms ?? []).filter((r) => r.sketch !== undefined && !existsSync(new URL(r.sketch, DATA)));
    expect(missing.map((r) => `${r.id}: ${r.sketch}`)).toEqual([]);
  });
});

describe("catalog/taxonomy.json", () => {
  it("parses with TaxonomySchema and repeats no category or tag", () => {
    expect(taxonomy.success ? [] : issuesToLines(taxonomy.error)).toEqual([]);
    expect(duplicates(taxonomy.data?.categories ?? [])).toEqual([]);
    expect(duplicates(taxonomy.data?.tags ?? [])).toEqual([]);
  });
});

describe.skipIf(!existsSync(ITEMS_DIR))("catalog/items/", () => {
  it("every item parses with ItemSchema and is stored as <id>.json", () => {
    const misnamed = items.parsed.filter(({ file, value }) => file !== `${value.id}.json`);
    expect([...items.problems, ...misnamed.map(({ file, value }) => `${file}: holds "${value.id}"`)]).toEqual([]);
  });

  it("every category and tag is in the taxonomy, and every room is a ROOM_ID", () => {
    const categories = new Set(taxonomy.data?.categories);
    const tags = new Set(taxonomy.data?.tags);
    const problems = items.parsed.flatMap(({ file, value }) => [
      ...(categories.has(value.category) ? [] : [`${file}: category "${value.category}"`]),
      ...value.tags.filter((t) => !tags.has(t)).map((t) => `${file}: tag "${t}"`),
      ...value.rooms.filter((r) => !ROOM_ID_SET.has(r)).map((r) => `${file}: room "${r}"`),
    ]);
    expect(problems).toEqual([]);
  });

  it("every image file exists in data/images/", () => {
    const missing = items.parsed.flatMap(({ file, value }) =>
      value.images.filter((img) => !existsSync(new URL(img.file, IMAGES_DIR))).map((img) => `${file}: images/${img.file}`),
    );
    expect(missing).toEqual([]);
  });
});

describe.skipIf(!existsSync(LAYOUTS_DIR))("layouts/", () => {
  it("every layout parses with LayoutSchema and is stored as <room>/<variant>.json for a ROOM_ID", () => {
    const misplaced = layouts.parsed
      .filter(({ file, value }) => !ROOM_ID_SET.has(value.room) || file !== `${value.room}/${value.variant}.json`)
      .map(({ file, value }) => `${file}: holds ${value.room}/${value.variant}`);
    expect([...layouts.problems, ...misplaced]).toEqual([]);
  });

  it("every extras item is in the catalog", () => {
    const catalog = new Set(items.parsed.map(({ value }) => value.id));
    const problems = layouts.parsed.flatMap(({ file, value }) =>
      value.extras.filter((e) => !catalog.has(e.itemId)).map((e) => `${file}: extras item "${e.itemId}" is not in catalog/items/`),
    );
    expect(problems).toEqual([]);
  });

  it("every placement uses a catalog item that has dimensions", () => {
    const catalog = new Map(items.parsed.map(({ value }) => [value.id, value]));
    const problems = layouts.parsed.flatMap(({ file, value }) =>
      value.placements.flatMap((p) => {
        const item = catalog.get(p.itemId);
        if (!item) return [`${file}: placement "${p.id}" uses "${p.itemId}", which is not in catalog/items/`];
        return item.dimensions ? [] : [`${file}: placement "${p.id}" uses "${p.itemId}", which has no dimensions`];
      }),
    );
    expect(problems).toEqual([]);
  });

  // The household has no TV (Andrew, 2026-10-24; vesta rules.md F-65): no layout stages one, or a
  // unit made for one. If that changes, F-65 changes first and this test with it.
  it("no layout places a TV or a TV unit", () => {
    const catalog = new Map(items.parsed.map(({ value }) => [value.id, value]));
    const problems = layouts.parsed.flatMap(({ file, value }) =>
      value.placements
        .filter((p) => ["tv", "tv-stand"].includes(catalog.get(p.itemId)?.category ?? ""))
        .map((p) => `${file}: placement "${p.id}" is ${catalog.get(p.itemId)?.category} "${p.itemId}"`),
    );
    expect(problems).toEqual([]);
  });

  // Rugs in the staged rooms are the two-piece washable sets Andrew picked (2026-10-26, night: "Pick correct
  // color and size and add it to the app"; vesta rules.md F-66 and F-69): a `rug` item in `a` is tagged `washable`
  // (a thin cover that lifts off its pad and fits a household washer), or it is a wipeable, plastic-free mat (cork,
  // natural rubber; never "literally plastic"). The rug-free room, staged from the evening of 2026-10-26 for Eutine's
  // allergy concern ("wife wins") until that night, is kept as the variant named "Rugless: …", and the room with its
  // old jute and wool rugs as "With rugs: …".
  it("every room but the kitchen stages an a whose rugs are washable two-piece sets or wipeable, plastic-free mats", () => {
    const catalog = new Map(items.parsed.map(({ value }) => [value.id, value]));
    const rugFree = layouts.parsed.filter(({ value }) => value.variant === "a");
    const missing = ROOM_IDS.filter((r) => r !== "kitchen" && !rugFree.some(({ value }) => value.room === r)).map(
      (r) => `${r}: no staged a`,
    );
    const rugs = rugFree.flatMap(({ file, value }) =>
      value.placements
        .filter((p) => {
          const item = catalog.get(p.itemId);
          return item?.category === "rug" && !(item.tags.includes("washable") || (item.tags.includes("wipeable") && item.tags.includes("plastic-free")));
        })
        .map((p) => `${file}: placement "${p.id}" is the rug "${p.itemId}"`),
    );
    expect([...missing, ...rugs]).toEqual([]);
  });

  // The living room's sofa has a chaise, at least 3 seats, on open legs (Andrew, 2026-10-25; vesta
  // rules.md F-67): every variant places a chaise, either a sofa with a built-in chaise (60" wide or
  // more, like IKEA's "Sofa, with chaise", Andrew's cart of 2026-10-26) or a chaise add-on with a sofa
  // piece it joins, and every sofa piece there stands on an open base.
  it("every living-room variant has a chaise sofa on an open base", () => {
    const catalog = new Map(items.parsed.map(({ value }) => [value.id, value]));
    const living = layouts.parsed.filter(({ value }) => value.room === "living-room");
    expect(living.length).toBeGreaterThan(0);
    const problems = living.flatMap(({ file, value }) => {
      const sofas = value.placements.filter((p) => catalog.get(p.itemId)?.category === "sofa");
      const chaises = sofas.filter((p) => catalog.get(p.itemId)?.tags.includes("chaise"));
      return [
        ...(chaises.length === 0 ? [`${file}: no chaise`] : []),
        ...(sofas.length - chaises.length === 0 &&
        !chaises.some((p) => (catalog.get(p.itemId)?.dimensions?.w ?? 0) >= 60)
          ? [`${file}: no sofa piece for the chaise to join (a chaise add-on alone, under 60" wide)`]
          : []),
        ...sofas
          .filter((p) => !catalog.get(p.itemId)?.tags.includes("open-base"))
          .map((p) => `${file}: placement "${p.id}" ("${p.itemId}") has no open base`),
      ];
    });
    expect(problems).toEqual([]);
  });
});
