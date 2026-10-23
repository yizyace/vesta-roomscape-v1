// scripts/export-static.ts on a temp copy of the fixtures: the files it writes, that each JSON file is
// exactly what the API answers that GET with, that the read-only client (src/api.ts with VITE_STATIC=1)
// reads them all through its schemas, that the photos and sketches it links to are there, and that
// nothing is written outside the out dir.
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportStatic } from "../scripts/export-static.ts";
import { createApiMiddleware } from "../server/api.ts";
import { ROOM_IDS } from "../shared/schema.ts";
import { staticFile } from "../shared/static.ts";
import { APP_DIR, DESK_ID, NO_DIMS_ID, mkTempDataDir, plantItem, plantLayout, startTestServer, type TempDataDir } from "./helpers.ts";

const BASE = "/vesta-roomscape-v1/";
const PHOTO_ID = "amazon-PHOTO00001";
const PHOTOS = [`${PHOTO_ID}-1.jpg`, `${PHOTO_ID}-2.jpg`];

let data: TempDataDir;
/** A fresh temp dir that holds only the out dir. */
let parent: string;
let out: string;
/** The sketch paths rooms.json names, each once, sorted. */
let sketches: string[];
/** The rooms each sketch is drawn for: "dining-room, kitchen". */
let sketchRooms: Map<string, string>;

/** Every file under `dir`, relative to it, sorted. */
async function filesUnder(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)))
    .sort();
}

/** Every file under `dir` with its bytes, to see that a run left it as it was. */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const files = await filesUnder(dir);
  return Object.fromEntries(await Promise.all(files.map(async (f) => [f, (await fs.readFile(path.join(dir, f))).toString("base64")] as const)));
}

beforeEach(async () => {
  data = await mkTempDataDir();
  // The fixtures have no photos and no sketches: one more item with two photos, a photo no item lists,
  // each sketch rooms.json names, and an alternative for the living room.
  await plantItem(data.dir, PHOTO_ID, {
    name: "Floor lamp with two photos",
    category: "lamp",
    rooms: ["living-room"],
    price: { amount: 49.99, currency: "USD", asOf: "2026-10-23" },
    images: [{ file: PHOTOS[0] }, { file: PHOTOS[1], caption: "from the side" }],
  });
  await fs.mkdir(path.join(data.dir, "images"));
  for (const file of PHOTOS) await fs.writeFile(path.join(data.dir, "images", file), `photo ${file}`);
  await fs.writeFile(path.join(data.dir, "images", "amazon-ORPHAN0001-1.jpg"), "a photo no item lists");
  const rooms = JSON.parse(await fs.readFile(path.join(data.dir, "rooms.json"), "utf8")) as { rooms: { id: string; sketch?: string }[] };
  sketches = [...new Set(rooms.rooms.flatMap((r) => (r.sketch ? [r.sketch] : [])))].sort();
  sketchRooms = new Map(sketches.map((s) => [s, rooms.rooms.filter((r) => r.sketch === s).map((r) => r.id).join(", ")]));
  for (const sketch of sketches) {
    await fs.mkdir(path.dirname(path.join(data.dir, sketch)), { recursive: true });
    await fs.writeFile(path.join(data.dir, sketch), `sketch ${sketch}`);
  }
  await plantLayout(data.dir, "living-room", "b", {
    room: "living-room",
    variant: "b",
    name: "Lamp by the window",
    placements: [{ id: "lamp-1", itemId: PHOTO_ID, x: 30, y: 30, rotation: 0, layer: "floor" }],
    extras: [],
  });
  parent = await fs.mkdtemp(path.join(os.tmpdir(), "furniture-export-"));
  out = path.join(parent, "dist");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
  await data.cleanup();
  await fs.rm(parent, { recursive: true, force: true });
});

/** Every GET the client makes for this data: the rooms, the catalog, and per room its variant list, its "a" and each saved variant. */
const API_GETS = [
  "/api/rooms",
  "/api/catalog",
  ...ROOM_IDS.flatMap((room) => [`/api/layouts/${room}`, `/api/layouts/${room}/a`]),
  "/api/layouts/living-room/b",
];

describe("exportStatic", () => {
  it("writes the answer to every GET, each photo a catalog item lists and each sketch, and nothing else anywhere", async () => {
    const before = await snapshot(data.dir);
    const result = await exportStatic(data.dir, out);
    const json = API_GETS.map((p) => staticFile(p)).sort();
    expect(json).not.toContain(null);
    expect(await filesUnder(out)).toEqual([...PHOTOS.map((f) => `data/images/${f}`), ...sketches.map((s) => `data/${s}`), ...(json as string[])].sort());
    expect(result).toEqual({ json, images: PHOTOS.map((f) => `data/images/${f}`), sketches: sketches.map((s) => `data/${s}`) });
    expect(await fs.readdir(parent)).toEqual(["dist"]);
    expect(await snapshot(data.dir)).toEqual(before);
  });

  it("writes exactly what the API answers each GET with", async () => {
    await exportStatic(data.dir, out);
    const server = await startTestServer(createApiMiddleware(data.dir));
    try {
      for (const apiPath of API_GETS) {
        const res = await fetch(server.url + apiPath);
        expect(res.status, apiPath).toBe(200);
        expect(await fs.readFile(path.join(out, staticFile(apiPath)!), "utf8"), apiPath).toBe(await res.text());
      }
    } finally {
      await server.close();
    }
  });

  it("is read in full by the read-only client, through its schemas", async () => {
    await exportStatic(data.dir, out);
    vi.stubEnv("VITE_STATIC", "1");
    vi.stubEnv("BASE_URL", BASE);
    vi.resetModules();
    const api = await import("../src/api.ts");
    const requested: string[] = [];
    // A static host serving the out dir under the base: a file, or a 404 page.
    vi.stubGlobal("fetch", async (url: string) => {
      requested.push(url);
      const file = url.startsWith(BASE) ? path.join(out, decodeURIComponent(url.slice(BASE.length))) : "";
      try {
        return new Response(await fs.readFile(file), { status: 200, headers: { "content-type": "application/json" } });
      } catch {
        return new Response("<!doctype html><title>Not found</title>", { status: 404, headers: { "content-type": "text/html" } });
      }
    });

    const rooms = await api.getRooms();
    expect(rooms.rooms.map((r) => r.id)).toEqual([...ROOM_IDS]);
    const catalog = await api.getCatalog();
    expect(catalog.errors).toEqual([]);
    expect(catalog.items.map((i) => i.id).sort()).toEqual([DESK_ID, NO_DIMS_ID, PHOTO_ID].sort());
    for (const room of ROOM_IDS) {
      const { variants } = await api.getVariants(room);
      for (const variant of new Set(["a", ...variants.map((v) => v.variant)])) {
        expect(await api.getLayout(room, variant)).toMatchObject({ room, variant });
      }
    }
    expect((await api.getVariants("living-room")).variants.map((v) => v.variant)).toEqual(["b"]);
    expect((await api.getLayout("living-room", "b")).placements.map((p) => p.itemId)).toEqual([PHOTO_ID]);
    expect((await api.getLayout("kitchen", "a")).placements).toEqual([]);
    await expect(api.getLayout("living-room", "c")).rejects.toMatchObject({ status: 404 });
    expect(requested.every((url) => url.startsWith(`${BASE}static/`))).toBe(true);

    // What the client links to is there, byte for byte.
    const linked = async (url: string) => fs.readFile(path.join(out, decodeURIComponent(url.slice(BASE.length))), "utf8");
    for (const img of catalog.items.flatMap((i) => i.images)) expect(await linked(api.imageUrl(img.file))).toBe(`photo ${img.file}`);
    for (const room of rooms.rooms) if (room.sketch) expect(await linked(api.sketchUrl(room.sketch))).toBe(`sketch ${room.sketch}`);
  });

  it("refuses an out dir that holds an export already, or that overlaps the data dir", async () => {
    await exportStatic(data.dir, out);
    await expect(exportStatic(data.dir, out)).rejects.toThrow(/static.* exists already/);
    const before = await snapshot(data.dir);
    for (const bad of [data.dir, path.join(data.dir, "dist"), path.dirname(data.dir)]) {
      await expect(exportStatic(data.dir, bad), bad).rejects.toThrow(/overlaps the data dir/);
    }
    expect(await snapshot(data.dir)).toEqual(before);
  });

  it("fails before writing anything, naming the file, when a listed photo or a sketch is missing", async () => {
    await fs.rm(path.join(data.dir, "images", PHOTOS[1]!));
    await expect(exportStatic(data.dir, out)).rejects.toThrow(`the photo images/${PHOTOS[1]} of ${PHOTO_ID} is missing`);
    expect(await fs.readdir(parent)).toEqual([]);
    await fs.writeFile(path.join(data.dir, "images", PHOTOS[1]!), "back");
    const sketch = sketches[0]!;
    await fs.rm(path.join(data.dir, sketch));
    await expect(exportStatic(data.dir, out)).rejects.toThrow(`the sketch ${sketch} of ${sketchRooms.get(sketch)} is missing`);
    expect(await fs.readdir(parent)).toEqual([]);
  });

  it("refuses a sketch path that leaves the data dir, even to a file that exists", async () => {
    const outside = path.join(parent, "outside.jpg");
    await fs.writeFile(outside, "not the planner's");
    const file = path.join(data.dir, "rooms.json");
    const rooms = JSON.parse(await fs.readFile(file, "utf8"));
    const sketch = path.relative(data.dir, outside); // ../furniture-export-…/outside.jpg
    rooms.rooms[0].sketch = sketch;
    await fs.writeFile(file, JSON.stringify(rooms));
    await expect(exportStatic(data.dir, out)).rejects.toThrow(`the sketch ${sketch} of ${rooms.rooms[0].id} is not under the data dir`);
    expect(await fs.readdir(parent)).toEqual(["outside.jpg"]);
  });
});

describe("node scripts/export-static.ts", () => {
  it("runs under the pinned Node (type stripping) and says what it wrote", () => {
    const run = spawnSync(process.execPath, ["scripts/export-static.ts", out], {
      cwd: APP_DIR,
      env: { ...process.env, FURNITURE_DATA_DIR: data.dir },
      encoding: "utf8",
    });
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.stdout).toBe(`export-static: ${API_GETS.length} answers, ${PHOTOS.length} photos and ${sketches.length} sketches from ${data.dir} into ${out}\n`);
  });

  it("exits 1 with the reason on stderr", () => {
    const run = spawnSync(process.execPath, ["scripts/export-static.ts", data.dir], {
      cwd: APP_DIR,
      env: { ...process.env, FURNITURE_DATA_DIR: data.dir },
      encoding: "utf8",
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/^export-static: .*overlaps the data dir/);
  });
});
