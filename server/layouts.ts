// A room's layouts, one file per variant: layouts/<room>/<variant>.json. Variant "a" is the staged
// pick and "b", "c", … are the alternatives; a room without a.json reads as an empty "a", any other
// missing variant is a 404. Saving checks the layout against the catalog: every placed item must exist
// and have dimensions (or it cannot be drawn), and every extra must exist (dimensions may be null).
import fs from "node:fs/promises";
import path from "node:path";
import { LayoutSchema, ROOM_IDS, issuesToLines, toJsonText, type Item, type Layout, type RoomId } from "../shared/schema.ts";
import { getItem } from "./catalog.ts";
import { HttpError, errorMessage } from "./errors.ts";
import { layoutFile, roomLayoutsDir, variantProblem } from "./paths.ts";
import { requireRoom } from "./rooms.ts";
import { isNotFound, listJsonFiles, readJson, withLock, writeJsonAtomic, writePartFile } from "./store.ts";

/** The staged pick: the variant the room is shown with, and the one `promoteVariant` swaps into. */
export const STAGED_VARIANT = "a";

export type VariantSummary = { variant: string; name: string; updatedAt?: string; placements: number; extras: number };
export type VariantList = { room: RoomId; variants: VariantSummary[] };

export const isRoomId = (room: string): room is RoomId => (ROOM_IDS as readonly string[]).includes(room);

/** `room` if rooms.json has it and it is one of ROOM_IDS, the only rooms a layout may name; else 404. */
async function layoutRoom(dataDir: string, room: string): Promise<RoomId> {
  await requireRoom(dataDir, room);
  if (!isRoomId(room)) throw new HttpError(404, `"${room}" is not one of the rooms that take a layout (${ROOM_IDS.join(", ")})`);
  return room;
}

const rel = (room: string, variant: string): string => `layouts/${room}/${variant}.json`;
const noVariant = (room: string, variant: string): HttpError =>
  new HttpError(404, `"${room}" has no variant "${variant}" (${rel(room, variant)} does not exist)`);
const emptyLayout = (room: RoomId, variant: string): Layout => LayoutSchema.parse({ room, variant });
const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** One line per saved variant of the room, sorted by variant id; [] when the room has no files. */
export async function listVariants(dataDir: string, roomArg: string): Promise<VariantList> {
  const room = await layoutRoom(dataDir, roomArg);
  // A file whose name is not a variant id cannot be reached by any route; validate reports it.
  const ids = (await listJsonFiles(roomLayoutsDir(dataDir, room)))
    .map((name) => name.slice(0, -".json".length))
    .filter((id) => variantProblem(id) === undefined)
    .sort(byId);
  const layouts = await Promise.all(ids.map((id) => readVariant(dataDir, room, id)));
  const variants = layouts.flatMap((l) =>
    l ? [{ variant: l.variant, name: l.name, updatedAt: l.updatedAt, placements: l.placements.length, extras: l.extras.length }] : [],
  );
  return { room, variants };
}

/** One variant: the saved file, an empty layout for an unsaved "a", or a 404 for any other unsaved one. */
export async function getLayout(dataDir: string, roomArg: string, variant: string): Promise<Layout> {
  const room = await layoutRoom(dataDir, roomArg);
  const layout = await readVariant(dataDir, room, variant);
  if (layout) return layout;
  if (variant === STAGED_VARIANT) return emptyLayout(room, variant);
  throw noVariant(room, variant);
}

/** The saved file, parsed; undefined when there is none. 400 for a bad variant id, 500 for broken data. */
async function readVariant(dataDir: string, room: RoomId, variant: string): Promise<Layout | undefined> {
  const file = layoutFile(dataDir, room, variant);
  let raw: unknown;
  try {
    raw = await readJson(file);
  } catch (e) {
    if (isNotFound(e)) return undefined;
    throw new HttpError(500, `${rel(room, variant)} cannot be read: ${errorMessage(e)}`);
  }
  const parsed = LayoutSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(500, `${rel(room, variant)} is invalid; run validate`, issuesToLines(parsed.error));
  if (parsed.data.room !== room) throw new HttpError(500, `${rel(room, variant)} says it is the layout for "${parsed.data.room}"; run validate`);
  if (parsed.data.variant !== variant) throw new HttpError(500, `${rel(room, variant)} says it is variant "${parsed.data.variant}"; run validate`);
  return parsed.data;
}

type LayoutBody = { room?: unknown; variant?: unknown; name?: unknown; notes?: unknown; placements?: unknown; extras?: unknown };

/**
 * Saves `input` ({name?, notes?, placements, extras?}, or a whole Layout whose updatedAt is ignored)
 * as the room's `variant`. Omitted name, notes and extras keep the saved ones ("", "" and [] for a new
 * variant); send "" or [] to clear them. A room or variant in the body must match the arguments.
 * Returns the layout as written, with updatedAt set to now.
 */
export async function saveLayout(dataDir: string, roomArg: string, variant: string, input: unknown): Promise<Layout> {
  const room = await layoutRoom(dataDir, roomArg);
  const file = layoutFile(dataDir, room, variant);
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new HttpError(400, "a layout is an object: {name?, notes?, placements, extras?}", ["(root): expected an object"]);
  }
  const body = input as LayoutBody;
  const mismatches: string[] = [];
  if (body.room !== undefined && body.room !== room) mismatches.push(`room: expected "${room}" (from the path), got ${JSON.stringify(body.room)}`);
  if (body.variant !== undefined && body.variant !== variant) {
    mismatches.push(`variant: expected "${variant}" (from the path), got ${JSON.stringify(body.variant)}`);
  }
  if (mismatches.length > 0) throw new HttpError(400, "the body names another room or variant than the path", mismatches);
  if (body.placements === undefined) {
    throw new HttpError(400, "the layout has no placements", ["placements: required (send [] to empty the room)"]);
  }
  return withLock(roomLayoutsDir(dataDir, room), async () => {
    const saved = await savedOrEmpty(dataDir, room, variant);
    const parsed = LayoutSchema.safeParse({
      room,
      variant,
      name: body.name === undefined ? saved.name : body.name,
      notes: body.notes === undefined ? saved.notes : body.notes,
      placements: body.placements,
      extras: body.extras === undefined ? saved.extras : body.extras,
    });
    if (!parsed.success) throw new HttpError(400, `the layout for "${room}" is invalid`, issuesToLines(parsed.error));
    const issues = await itemIssues(dataDir, parsed.data);
    if (issues.length > 0) throw new HttpError(400, `the layout for "${room}" names items it cannot use`, issues);
    const layout = LayoutSchema.parse({ ...parsed.data, updatedAt: new Date().toISOString() });
    await writeJsonAtomic(file, layout);
    return layout;
  });
}

/** The saved variant, for the fields a save keeps; empty when there is none or it is unreadable (it is about to be replaced). */
async function savedOrEmpty(dataDir: string, room: RoomId, variant: string): Promise<Layout> {
  try {
    return (await readVariant(dataDir, room, variant)) ?? emptyLayout(room, variant);
  } catch {
    return emptyLayout(room, variant);
  }
}

async function itemIssues(dataDir: string, layout: Layout): Promise<string[]> {
  const ids = [...new Set([...layout.placements.map((p) => p.itemId), ...layout.extras.map((e) => e.itemId)])];
  const found = new Map(await Promise.all(ids.map(async (id) => [id, await lookUp(dataDir, id)] as const)));
  const issues: string[] = [];
  layout.placements.forEach((p, i) => {
    const item = found.get(p.itemId);
    if (typeof item === "string") issues.push(`placements.${i}.itemId: ${item}`);
    else if (item && item.dimensions === null) issues.push(`placements.${i}.itemId: "${p.itemId}" has no dimensions, so it cannot be placed`);
    else if (item && item.dimensions && item.dimensions.d === undefined && p.layer !== "top") {
      issues.push(`placements.${i}.layer: "${p.itemId}" is flat (no depth on its page), so it can only hang on a wall: layer "top"`);
    }
  });
  layout.extras.forEach((e, i) => {
    const item = found.get(e.itemId);
    if (typeof item === "string") issues.push(`extras.${i}.itemId: ${item}`);
  });
  return issues;
}

/** The item, or why a layout cannot use it. */
async function lookUp(dataDir: string, id: string): Promise<Item | string> {
  try {
    return await getItem(dataDir, id);
  } catch (e) {
    if (e instanceof HttpError) return e.status === 404 ? `no catalog item "${id}"` : e.message;
    throw e;
  }
}

/**
 * Makes `variant` the staged pick: its layout becomes "a" and the old "a", if one is saved, takes the
 * variant's id (each file's `variant` rewritten, everything else kept). Promoting "a" changes nothing;
 * a variant that is not saved is a 404. Answers the room's variants afterwards.
 */
export async function promoteVariant(dataDir: string, roomArg: string, variant: string): Promise<VariantList> {
  const room = await layoutRoom(dataDir, roomArg);
  layoutFile(dataDir, room, variant); // a bad or reserved id is a 400 before anything is read
  if (variant !== STAGED_VARIANT) await withLock(roomLayoutsDir(dataDir, room), () => swapWithStaged(dataDir, room, variant));
  return listVariants(dataDir, room);
}

/**
 * Both new files are written in full under temporary `.part` names before either is renamed into
 * place, so a crash at any point leaves every arrangement on disk: at worst the old "a" survives only
 * in its `.part` file, which the error names.
 */
async function swapWithStaged(dataDir: string, room: RoomId, variant: string): Promise<void> {
  const [staged, other] = await Promise.all([readVariant(dataDir, room, STAGED_VARIANT), readVariant(dataDir, room, variant)]);
  if (!other) throw noVariant(room, variant);
  const stagedFile = layoutFile(dataDir, room, STAGED_VARIANT);
  const otherFile = layoutFile(dataDir, room, variant);
  const parts: string[] = [];
  const dropParts = () => Promise.all(parts.map((p) => fs.rm(p, { force: true })));
  try {
    parts.push(await writePartFile(stagedFile, toJsonText(LayoutSchema.parse({ ...other, variant: STAGED_VARIANT }))));
    if (staged) parts.push(await writePartFile(otherFile, toJsonText(LayoutSchema.parse({ ...staged, variant }))));
    await fs.rename(parts[0]!, stagedFile);
  } catch (e) {
    await dropParts();
    throw e;
  }
  // a.json now holds the promoted layout; the old "a" is in parts[1] (if there was one) until it is renamed.
  const kept = parts[1];
  try {
    if (kept) await fs.rename(kept, otherFile);
    else await fs.rm(otherFile); // no "a" was saved, so nothing takes the variant's place
  } catch (e) {
    const where = kept ? `the old "a" is in ${path.relative(dataDir, kept)}` : `${rel(room, variant)} is left as a copy of it`;
    throw new HttpError(500, `${rel(room, STAGED_VARIANT)} is now the promoted "${variant}", but ${where}: ${errorMessage(e)}`);
  }
}
