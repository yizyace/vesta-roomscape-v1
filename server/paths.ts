// Where the planner's files live. DATA_DIR is data/ in this repo unless
// FURNITURE_DATA_DIR points elsewhere (the tests use a temp copy). File paths are built only from ids
// that passed their regex, so no request can name a file outside the data directory.
import path from "node:path";
import { ITEM_ID_RE } from "../shared/schema.ts";
import { HttpError } from "./errors.ts";

export const DATA_DIR = process.env.FURNITURE_DATA_DIR
  ? path.resolve(process.env.FURNITURE_DATA_DIR)
  : path.resolve(import.meta.dirname, "../data");

const SLUG_RE = /^[a-z][a-z0-9-]*$/;

export const roomsFile = (dataDir: string): string => path.join(dataDir, "rooms.json");
export const taxonomyFile = (dataDir: string): string => path.join(dataDir, "catalog", "taxonomy.json");
export const itemsDir = (dataDir: string): string => path.join(dataDir, "catalog", "items");
export const layoutsDir = (dataDir: string): string => path.join(dataDir, "layouts");
export const imagesDir = (dataDir: string): string => path.join(dataDir, "images");
export const sourcesDir = (dataDir: string): string => path.join(dataDir, "sources");

export function itemFile(dataDir: string, id: string): string {
  if (!ITEM_ID_RE.test(id)) throw new HttpError(400, `"${id}" is not an item id (<vendor>-<sku>)`);
  return path.join(itemsDir(dataDir), `${id}.json`);
}

/** Variant ids that the client's hash routes use for something else: `#/<room>/view` is the print view. */
export const RESERVED_VARIANTS: readonly string[] = ["view"];

/** Why `variant` cannot name a layout file, or undefined when it can. */
export function variantProblem(variant: string): string | undefined {
  if (!SLUG_RE.test(variant)) return `"${variant}" is not a variant id (a kebab-case slug such as "a" or "b")`;
  if (RESERVED_VARIANTS.includes(variant)) return `"${variant}" is reserved (#/<room>/view is the print view); use another variant id`;
  return undefined;
}

/** layouts/<room>/: one file per variant of the room's layout. */
export function roomLayoutsDir(dataDir: string, room: string): string {
  if (!SLUG_RE.test(room)) throw new HttpError(400, `"${room}" is not a room id`);
  return path.join(layoutsDir(dataDir), room);
}

/** layouts/<room>/<variant>.json; a 400 for a malformed room or variant id, or a reserved one. */
export function layoutFile(dataDir: string, room: string, variant: string): string {
  const dir = roomLayoutsDir(dataDir, room);
  const problem = variantProblem(variant);
  if (problem) throw new HttpError(400, problem);
  return path.join(dir, `${variant}.json`);
}
