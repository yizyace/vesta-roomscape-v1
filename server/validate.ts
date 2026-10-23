// One pass over every data file, for `npm run validate`: the rules the API enforces on save, applied
// to what is on disk, plus layout warnings that never block a save (floor pieces overlapping, any
// piece outside the room, floor pieces on the stairs, a heater, in a door's swing, in front of a
// closet or in the walkway along an opening). Errors make `ok` false; warnings do not.
import path from "node:path";
import type { z } from "zod";
import { findCollisions, isClosed, keepOutZones, placementRect, rectsOverlap, walkWalls, type KeepOut } from "../shared/geometry.ts";
import { LayoutSchema, RoomsSchema, TaxonomySchema, issuesToLines, type Item, type Placement, type Room } from "../shared/schema.ts";
import { itemReferenceIssues, parseItemFile } from "./catalog.ts";
import { errorMessage } from "./errors.ts";
import { imagesDir, itemsDir, layoutsDir, variantProblem } from "./paths.ts";
import { roomGeometryProblems, roomIds } from "./rooms.ts";
import { exists, isNotFound, listDirNames, listJsonFiles, readJson } from "./store.ts";

export type Problem = { file: string; level: "error" | "warning"; message: string };
export type ValidationReport = { ok: boolean; problems: Problem[]; checked: string[] };

/** File names in problems and `checked` are relative to the data dir: `catalog/items/<id>.json`. */
export async function validateAll(dataDir: string): Promise<ValidationReport> {
  const problems: Problem[] = [];
  const checked: string[] = [];
  const error = (file: string, message: string) => void problems.push({ file, level: "error", message });
  const warn = (file: string, message: string) => void problems.push({ file, level: "warning", message });

  /** Reads `file` and checks it against `schema`; undefined, with the reasons reported, when it fails. */
  async function load<S extends z.ZodType>(file: string, schema: S): Promise<z.output<S> | undefined> {
    checked.push(file);
    let raw: unknown;
    try {
      raw = await readJson(path.join(dataDir, file));
    } catch (e) {
      error(file, isNotFound(e) ? "the file is missing" : errorMessage(e));
      return undefined;
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      for (const line of issuesToLines(parsed.error)) error(file, line);
      return undefined;
    }
    return parsed.data;
  }

  const rooms = await load("rooms.json", RoomsSchema);
  if (rooms) for (const p of roomGeometryProblems(rooms)) error("rooms.json", p);
  const taxonomy = await load("catalog/taxonomy.json", TaxonomySchema);

  const items = new Map<string, Item>();
  const invalidItems = new Set<string>();
  for (const name of await listJsonFiles(itemsDir(dataDir))) {
    const file = `catalog/items/${name}`;
    checked.push(file);
    let raw: unknown;
    try {
      raw = await readJson(path.join(itemsDir(dataDir), name));
    } catch (e) {
      error(file, errorMessage(e));
      invalidItems.add(name.slice(0, -".json".length));
      continue;
    }
    const result = parseItemFile(raw, name);
    if ("issues" in result) {
      for (const line of result.issues) error(file, line);
      invalidItems.add(name.slice(0, -".json".length));
      continue;
    }
    const { item } = result;
    for (const line of itemReferenceIssues(item, taxonomy, rooms && roomIds(rooms))) error(file, line);
    for (const [i, img] of item.images.entries()) {
      if (!(await exists(path.join(imagesDir(dataDir), img.file)))) error(file, `images.${i}.file: images/${img.file} does not exist`);
    }
    items.set(item.id, item);
  }

  const unknownItem = (id: string): string => (invalidItems.has(id) ? `catalog/items/${id}.json is invalid` : `no catalog item "${id}"`);
  // layouts/<room>/<variant>.json; a flat layouts/<room>.json is the 0.1 shape.
  for (const name of await listJsonFiles(layoutsDir(dataDir))) {
    const file = `layouts/${name}`;
    checked.push(file);
    error(file, `layouts are stored one file per variant now; move it to layouts/${name.slice(0, -".json".length)}/a.json`);
  }
  for (const dir of await listDirNames(layoutsDir(dataDir))) {
    for (const name of await listJsonFiles(path.join(layoutsDir(dataDir), dir))) {
      const file = `layouts/${dir}/${name}`;
      const variant = name.slice(0, -".json".length);
      const badName = variantProblem(variant);
      if (badName) error(file, `file name: ${badName}`);
      const layout = await load(file, LayoutSchema);
      if (!layout) continue;
      if (layout.room !== dir) {
        error(file, `room: "${layout.room}" does not match the directory (expected layouts/${layout.room}/${variant}.json)`);
      }
      if (layout.variant !== variant) {
        error(file, `variant: "${layout.variant}" does not match the file name (expected layouts/${dir}/${layout.variant}.json)`);
      }
      const room = rooms?.rooms.find((r) => r.id === layout.room);
      if (rooms && !room) error(file, `room: "${layout.room}" is not a room in rooms.json`);
      layout.placements.forEach((p, i) => {
        const item = items.get(p.itemId);
        if (!item) error(file, `placements.${i}.itemId: ${unknownItem(p.itemId)}`);
        else if (!item.dimensions) error(file, `placements.${i}.itemId: "${p.itemId}" has no dimensions, so it cannot be placed`);
        else if (item.dimensions.d === undefined && p.layer !== "top") {
          error(file, `placements.${i}.layer: "${p.itemId}" is flat (no depth on its page), so it can only hang on a wall: layer "top"`);
        }
      });
      layout.extras.forEach((e, i) => {
        if (!items.has(e.itemId)) error(file, `extras.${i}.itemId: ${unknownItem(e.itemId)}`);
      });
      if (room) for (const message of layoutWarnings(room, layout.placements, items)) warn(file, message);
    }
  }

  return { ok: !problems.some((p) => p.level === "error"), problems, checked };
}

/**
 * One line per finding of findCollisions on the room's wall walk and keep-out zones (each placement on
 * its own layer): a pair of floor pieces that overlap, a piece outside the outline, a floor piece on
 * the stairs, a heater, in a door's swing, in front of a closet or in an opening's walkway. A double
 * door's two leaves share a label: one line.
 */
function layoutWarnings(room: Room, placements: Placement[], items: ReadonlyMap<string, Item>): string[] {
  if (placements.length === 0) return [];
  if (room.walls.length === 0) {
    return [`room "${room.id}" has no measured walls yet, so its ${placements.length} placement(s) cannot be checked against an outline`];
  }
  const walk = walkWalls(room.walls);
  if (!isClosed(walk)) return []; // rooms.json already reports the open outline
  const { overlapping, outside, blocked } = findCollisions(placements, items, walk.points, keepOutZones(room.walls, room.features));
  const rect = (p: Placement) => placementRect(items.get(p.itemId)!.dimensions!, p); // every overlapping piece has dimensions
  const warnings = new Set<string>();
  placements.forEach((p, i) => {
    if (outside.has(p.id)) warnings.add(`${p.id} is outside the room`);
    for (const zone of blocked.get(p.id) ?? []) warnings.add(`${p.id} ${keepOutText(zone)}`);
    if (!overlapping.has(p.id)) return;
    // Only floor pieces are in `overlapping`, so any two of them whose footprints overlap are a finding.
    for (const q of placements.slice(i + 1)) {
      if (overlapping.has(q.id) && rectsOverlap(rect(p), rect(q))) warnings.add(`${p.id} overlaps ${q.id}`);
    }
  });
  return [...warnings];
}

function keepOutText(zone: KeepOut): string {
  if (zone.kind === "stairs") return "is on the stairs";
  if (zone.kind === "heater") return "is on the heater";
  if (zone.kind === "front") return `is in front of the ${zone.label}`;
  if (zone.kind === "opening") return `blocks the ${zone.label}`;
  return `is in the ${zone.label}'s swing`;
}
