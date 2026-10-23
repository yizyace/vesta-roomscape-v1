// The data of the read-only copy, which `npm run build:pages` runs after `vite build`. For every GET the
// client makes, it writes the API's answer: made by the same server function as server/api.ts and written
// as the same JSON text (JSON.stringify), at the file shared/static.ts names. Then it copies every photo a
// catalog item lists and each room's sketch to where the client links them (data/images/<file> and
// data/<sketch>). Everything is read and checked before the first write; it writes only new files, and
// only under the out dir, which must not overlap the data dir or hold an export already (`vite build`
// empties dist/ first).
//
//   node scripts/export-static.ts [<outDir>]   the out dir defaults to dist/; FURNITURE_DATA_DIR picks the data
import fs from "node:fs/promises";
import path from "node:path";
import { loadCatalog } from "../server/catalog.ts";
import { HttpError, errorMessage } from "../server/errors.ts";
import { STAGED_VARIANT, getLayout, listVariants } from "../server/layouts.ts";
import { DATA_DIR, imagesDir } from "../server/paths.ts";
import { loadRooms } from "../server/rooms.ts";
import { exists, isNotFound } from "../server/store.ts";
import { staticFile } from "../shared/static.ts";

/** What an export wrote, each path relative to the out dir, sorted. */
export type Exported = { json: string[]; images: string[]; sketches: string[] };

type Copy = { kind: "image" | "sketch"; from: string; what: string };

/** `child` is `parent` or inside it. */
function within(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).isFile();
  } catch (e) {
    if (isNotFound(e)) return false;
    throw e;
  }
}

/** Writes the read-only copy's data for `dataDir` into `outDir` (see the top of this file). */
export async function exportStatic(dataDir: string, outDir: string): Promise<Exported> {
  const data = path.resolve(dataDir);
  const out = path.resolve(outDir);
  if (within(out, data) || within(data, out)) throw new Error(`the out dir ${out} overlaps the data dir ${data}`);
  for (const name of ["static", "data"]) {
    const dir = path.join(out, name);
    if (await exists(dir)) throw new Error(`${dir} exists already; export into a fresh build (npm run build:pages empties dist/ first)`);
  }
  /** A path under the out dir; anything else is a bug, never a write. */
  const target = (rel: string): string => {
    const file = path.resolve(out, rel);
    if (file === out || !within(file, out)) throw new Error(`${rel} is not a path under the out dir`);
    return file;
  };

  // Every answer, as the API gives it now.
  const rooms = await loadRooms(data);
  const catalog = await loadCatalog(data);
  const answers = new Map<string, unknown>([
    ["/api/rooms", rooms],
    ["/api/catalog", catalog],
  ]);
  for (const { id } of rooms.rooms) {
    const list = await listVariants(data, id);
    answers.set(`/api/layouts/${id}`, list);
    // "a" answers before its first save too (an empty layout): the kitchen's tab reads it.
    for (const variant of new Set([STAGED_VARIANT, ...list.variants.map((v) => v.variant)])) {
      answers.set(`/api/layouts/${id}/${variant}`, await getLayout(data, id, variant));
    }
  }
  const json = [...answers].map(([apiPath, body]) => {
    const rel = staticFile(apiPath);
    if (rel === null) throw new Error(`shared/static.ts names no file for GET ${apiPath}`);
    return { rel, text: JSON.stringify(body) };
  });

  // The photos and the sketches, by where they go, each once; every one must be on disk.
  const copies = new Map<string, Copy>();
  for (const item of catalog.items) {
    for (const { file } of item.images) {
      copies.set(`data/images/${file}`, { kind: "image", from: path.join(imagesDir(data), file), what: `the photo images/${file} of ${item.id}` });
    }
  }
  const sketchRooms = new Map<string, string[]>();
  for (const room of rooms.rooms) if (room.sketch !== undefined) sketchRooms.set(room.sketch, [...(sketchRooms.get(room.sketch) ?? []), room.id]);
  for (const [sketch, ids] of sketchRooms) {
    const what = `the sketch ${sketch} of ${ids.join(", ")}`;
    const from = path.resolve(data, sketch);
    if (from === data || !within(from, data)) throw new Error(`${what} is not under the data dir`);
    copies.set(`data/${path.relative(data, from).split(path.sep).join("/")}`, { kind: "sketch", from, what });
  }
  for (const { from, what } of copies.values()) if (!(await isFile(from))) throw new Error(`${what} is missing`);

  for (const { rel, text } of json) {
    const file = target(rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text, { flag: "wx" });
  }
  for (const [rel, { from }] of copies) {
    const file = target(rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.copyFile(from, file, fs.constants.COPYFILE_EXCL);
  }
  const copied = (kind: Copy["kind"]) => [...copies].flatMap(([rel, c]) => (c.kind === kind ? [rel] : [])).sort();
  return { json: json.map((j) => j.rel).sort(), images: copied("image"), sketches: copied("sketch") };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args[0]?.startsWith("-")) {
    console.error("usage: node scripts/export-static.ts [<outDir>]   (default dist/; FURNITURE_DATA_DIR picks the data)");
    process.exit(2);
  }
  const out = path.resolve(args[0] ?? path.join(import.meta.dirname, "..", "dist"));
  try {
    const done = await exportStatic(DATA_DIR, out);
    console.log(`export-static: ${done.json.length} answers, ${done.images.length} photos and ${done.sketches.length} sketches from ${DATA_DIR} into ${out}`);
  } catch (e) {
    console.error(`export-static: ${errorMessage(e)}`);
    if (e instanceof HttpError) for (const issue of e.issues ?? []) console.error(`  ${issue}`);
    process.exitCode = 1;
  }
}
