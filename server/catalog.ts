// The furniture catalog: catalog/taxonomy.json plus one catalog/items/<id>.json per item. Saving
// checks an item against the schema, the taxonomy and rooms.json before anything is written.
import path from "node:path";
import { ITEM_ID_RE, ItemSchema, TaxonomySchema, issuesToLines, type Item, type Taxonomy } from "../shared/schema.ts";
import { HttpError, errorMessage } from "./errors.ts";
import { itemFile, itemsDir, taxonomyFile } from "./paths.ts";
import { loadRooms, roomIds } from "./rooms.ts";
import { exists, isNotFound, listJsonFiles, readJson, readRequiredJson, writeJsonAtomic } from "./store.ts";

export type FileError = { file: string; message: string };
/** The answer to GET /api/catalog (and the read-only copy's static/catalog.json). */
export type CatalogAnswer = { items: Item[]; taxonomy: Taxonomy; errors: FileError[] };

export async function loadTaxonomy(dataDir: string): Promise<Taxonomy> {
  const parsed = TaxonomySchema.safeParse(await readRequiredJson(taxonomyFile(dataDir), "catalog/taxonomy.json"));
  if (!parsed.success) throw new HttpError(500, "catalog/taxonomy.json does not match the schema", issuesToLines(parsed.error));
  return parsed.data;
}

/** Schema-checks one item file's contents; the id must also match the file name. */
export function parseItemFile(raw: unknown, fileName: string): { item: Item } | { issues: string[] } {
  const parsed = ItemSchema.safeParse(raw);
  if (!parsed.success) return { issues: issuesToLines(parsed.error) };
  const expected = `${parsed.data.id}.json`;
  if (fileName !== expected) return { issues: [`id: "${parsed.data.id}" does not match the file name ${fileName} (expected ${expected})`] };
  return { item: parsed.data };
}

/** Category and tags must be in the taxonomy, rooms in rooms.json. A source that is undefined is not checked. */
export function itemReferenceIssues(item: Item, taxonomy: Taxonomy | undefined, rooms: readonly string[] | undefined): string[] {
  const issues: string[] = [];
  if (taxonomy) {
    if (!taxonomy.categories.includes(item.category)) {
      issues.push(`category: "${item.category}" is not a category in catalog/taxonomy.json`);
    }
    item.tags.forEach((tag, i) => {
      if (!taxonomy.tags.includes(tag)) issues.push(`tags.${i}: "${tag}" is not a tag in catalog/taxonomy.json`);
    });
  }
  if (rooms) {
    item.rooms.forEach((room, i) => {
      if (!rooms.includes(room)) issues.push(`rooms.${i}: "${room}" is not a room in rooms.json`);
    });
  }
  return issues;
}

/** Every item file that parses; a file that does not is reported in `errors`, never thrown. */
export async function listItems(dataDir: string): Promise<{ items: Item[]; errors: FileError[] }> {
  const dir = itemsDir(dataDir);
  const results = await Promise.all(
    (await listJsonFiles(dir)).map(async (name): Promise<{ item: Item } | FileError> => {
      const file = `catalog/items/${name}`;
      try {
        const result = parseItemFile(await readJson(path.join(dir, name)), name);
        return "item" in result ? result : { file, message: result.issues.join("; ") };
      } catch (e) {
        return { file, message: errorMessage(e) };
      }
    }),
  );
  const items: Item[] = [];
  const errors: FileError[] = [];
  for (const r of results) {
    if ("item" in r) items.push(r.item);
    else errors.push(r);
  }
  return { items, errors };
}

/** Every item that parses, the taxonomy, and each item file that does not parse. */
export async function loadCatalog(dataDir: string): Promise<CatalogAnswer> {
  const [{ items, errors }, taxonomy] = await Promise.all([listItems(dataDir), loadTaxonomy(dataDir)]);
  return { items, taxonomy, errors };
}

export async function getItem(dataDir: string, id: string): Promise<Item> {
  if (!ITEM_ID_RE.test(id)) throw new HttpError(404, `no catalog item "${id}"`);
  let raw: unknown;
  try {
    raw = await readJson(itemFile(dataDir, id));
  } catch (e) {
    if (isNotFound(e)) throw new HttpError(404, `no catalog item "${id}"`);
    throw new HttpError(500, `catalog/items/${id}.json cannot be read: ${errorMessage(e)}`);
  }
  const result = parseItemFile(raw, `${id}.json`);
  if ("issues" in result) {
    // macOS opens <ID>.json for <id>.json: that is a different id, not a broken file.
    const stored = (raw as { id?: unknown } | null)?.id;
    if (typeof stored === "string" && stored !== id && stored.toLowerCase() === id.toLowerCase()) {
      throw new HttpError(404, `no catalog item "${id}" (there is "${stored}")`);
    }
    throw new HttpError(500, `catalog/items/${id}.json is invalid; run validate`, result.issues);
  }
  return result.item;
}

/**
 * Validates `input` and writes catalog/items/<id>.json. An existing file is a 409 unless `update`
 * (the CLI's --update; the API's PUT always upserts). Returns the item as written.
 */
export async function saveItem(dataDir: string, input: unknown, opts: { update?: boolean } = {}): Promise<Item> {
  const parsed = ItemSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, "the item does not match the schema", issuesToLines(parsed.error));
  const item = parsed.data;
  const [taxonomy, rooms] = await Promise.all([loadTaxonomy(dataDir), loadRooms(dataDir)]);
  const issues = itemReferenceIssues(item, taxonomy, roomIds(rooms));
  if (issues.length > 0) throw new HttpError(400, `item "${item.id}" uses a category, tag or room the data does not define`, issues);
  const file = itemFile(dataDir, item.id);
  const name = `${item.id}.json`;
  // On a case-insensitive disk (macOS) this write would replace the other item's file.
  const clash = (await listJsonFiles(itemsDir(dataDir))).find((n) => n !== name && n.toLowerCase() === name.toLowerCase());
  if (clash) throw new HttpError(409, `catalog/items/${clash} already exists; ids that differ only in case would share one file`);
  if (!opts.update && (await exists(file))) {
    throw new HttpError(409, `catalog/items/${name} already exists (use --update to overwrite it)`);
  }
  await writeJsonAtomic(file, item);
  return item;
}
