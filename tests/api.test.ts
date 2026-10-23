import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiMiddleware } from "../server/api.ts";
import type { FetchLike } from "../server/images.ts";
import { ROOM_IDS, toJsonText } from "../shared/schema.ts";
import {
  DESK_ID,
  NO_DIMS_ID,
  listPartFiles,
  mkTempDataDir,
  readFixtureItem,
  startTestServer,
  type TempDataDir,
  type TestServer,
} from "./helpers.ts";

// `any`: each test asserts the shape of the JSON it gets back.
type Reply = { status: number; body: any; headers: Headers };

let data: TempDataDir;
let server: TestServer;
let fetchImpl: FetchLike;

beforeEach(async () => {
  data = await mkTempDataDir();
  fetchImpl = async (url) => {
    throw new Error(`unexpected fetch of ${url}`);
  };
  server = await startTestServer(createApiMiddleware(data.dir, { fetchImpl: (url, init) => fetchImpl(url, init) }));
});

afterEach(async () => {
  await server.close();
  const leftovers = await listPartFiles(data.dir);
  await data.cleanup();
  expect(leftovers).toEqual([]);
});

async function call(method: string, urlPath: string, body?: unknown, contentType = "application/json"): Promise<Reply> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "content-type": contentType };
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  const res = await fetch(server.url + urlPath, init);
  const text = await res.text();
  const json = res.headers.get("content-type")?.startsWith("application/json");
  return { status: res.status, body: json ? JSON.parse(text) : text, headers: res.headers };
}

/** GET with the path sent exactly as written (fetch would resolve the dot segments first). */
function rawGet(rawPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(server.url, { path: rawPath }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end();
  });
}

const readData = (rel: string) => fs.readFile(path.join(data.dir, rel), "utf8");

describe("GET /api/rooms", () => {
  it("returns rooms.json", async () => {
    const r = await call("GET", "/api/rooms");
    expect(r.status).toBe(200);
    expect(r.body.units).toBe("in");
    expect(r.body.rooms.map((room: { id: string }) => room.id).sort()).toEqual([...ROOM_IDS].sort());
  });

  it("answers 500 naming the room when its walls do not close", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const rooms = JSON.parse(await readData("rooms.json"));
    // The top wall carries no features, so the schema still passes and only the walk is open.
    rooms.rooms.find((room: { id: string }) => room.id === "maddie-room").walls[0].length = 120;
    await fs.writeFile(path.join(data.dir, "rooms.json"), JSON.stringify(rooms));
    const r = await call("GET", "/api/rooms");
    quiet.mockRestore();
    expect(r.status).toBe(500);
    expect(r.body.error).toMatch(/maddie-room.*do not close/);
    expect(r.body.issues).toHaveLength(1);
  });
});

describe("catalog", () => {
  it("lists the items with the taxonomy", async () => {
    const r = await call("GET", "/api/catalog");
    expect(r.status).toBe(200);
    expect(r.body.items.map((i: { id: string }) => i.id)).toEqual([DESK_ID, NO_DIMS_ID]);
    expect(r.body.taxonomy.categories).toContain("desk");
    expect(r.body.errors).toEqual([]);
  });

  it("reports a bad item file in errors instead of failing", async () => {
    await fs.writeFile(path.join(data.dir, "catalog/items/amazon-BROKEN.json"), "{ not json");
    await fs.writeFile(path.join(data.dir, "catalog/items/amazon-RENAMED.json"), JSON.stringify(await readFixtureItem(DESK_ID)));
    const r = await call("GET", "/api/catalog");
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(2);
    expect(r.body.errors.map((e: { file: string }) => e.file)).toEqual(["catalog/items/amazon-BROKEN.json", "catalog/items/amazon-RENAMED.json"]);
    expect(r.body.errors[1].message).toMatch(/does not match the file name/);
  });

  it("gets one item, or 404", async () => {
    const r = await call("GET", `/api/catalog/${DESK_ID}`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual(await readFixtureItem(DESK_ID));
    const missing = await call("GET", "/api/catalog/amazon-NOPE");
    expect(missing.status).toBe(404);
    expect(missing.body.error).toMatch(/amazon-NOPE/);
    expect((await call("GET", "/api/catalog/..%2F..%2Frooms")).status).toBe(404);
  });

  it("saves an edited item with PUT, on disk in canonical form", async () => {
    const item = { ...(await readFixtureItem(DESK_ID)), status: "shortlisted", notes: "Fits the alcove." };
    const r = await call("PUT", `/api/catalog/${DESK_ID}`, item);
    expect(r.status).toBe(200);
    expect(r.body).toEqual(item);
    expect((await call("GET", `/api/catalog/${DESK_ID}`)).body).toEqual(item);
    expect(await readData(`catalog/items/${DESK_ID}.json`)).toBe(toJsonText(item));
  });

  it("creates an item with PUT, filling in the schema's defaults in the schema's key order", async () => {
    const id = "ikea-30454262";
    const body = {
      captured: { date: "2026-10-22", by: "claude", method: "manual" },
      id,
      vendor: "ikea",
      url: "https://www.ikea.com/us/en/p/bookcase-30454262/",
      name: "Bookcase",
      category: "bookcase",
      price: null,
      dimensions: { w: 31.5, d: 11, h: 79.5 },
      ignored: "unknown keys are dropped",
    };
    const r = await call("PUT", `/api/catalog/${id}`, body);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ tags: [], rooms: [], status: "candidate", images: [], notes: "" });
    const onDisk = await readData(`catalog/items/${id}.json`);
    expect(onDisk).toBe(toJsonText(r.body));
    expect(Object.keys(JSON.parse(onDisk))).toEqual([
      "id", "vendor", "url", "name", "category", "tags", "rooms", "status", "price", "dimensions", "images", "notes", "captured",
    ]);
  });

  it("refuses an id that differs from an existing one only in case (one file on macOS)", async () => {
    const before = await readData(`catalog/items/${DESK_ID}.json`);
    const lower = DESK_ID.toLowerCase();
    const r = await call("PUT", `/api/catalog/${lower}`, { ...(await readFixtureItem(DESK_ID)), id: lower });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/differ only in case/);
    expect(await readData(`catalog/items/${DESK_ID}.json`)).toBe(before);
    expect((await call("GET", `/api/catalog/${lower}`)).status).toBe(404);
  });

  it("refuses a body whose id does not match the URL", async () => {
    const r = await call("PUT", `/api/catalog/${DESK_ID}`, await readFixtureItem(NO_DIMS_ID));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/does not match/);
    expect(r.body.issues).toEqual([expect.stringMatching(/^id: /)]);
  });

  it("refuses an invalid item with one issue per problem and leaves the file alone", async () => {
    const before = await readData(`catalog/items/${DESK_ID}.json`);
    const desk = await readFixtureItem(DESK_ID);
    const bad = await call("PUT", `/api/catalog/${DESK_ID}`, { ...desk, dimensions: { w: -1, d: 18.9 }, status: "maybe" });
    expect(bad.status).toBe(400);
    expect(bad.body.issues).toEqual([expect.stringMatching(/^status: /), expect.stringMatching(/^dimensions\.w: /)]);
    const unknown = await call("PUT", `/api/catalog/${DESK_ID}`, { ...desk, category: "spaceship", tags: ["kids", "zzz"] });
    expect(unknown.status).toBe(400);
    expect(unknown.body.issues).toEqual([
      'category: "spaceship" is not a category in catalog/taxonomy.json',
      'tags.1: "zzz" is not a tag in catalog/taxonomy.json',
    ]);
    const garage = await call("PUT", `/api/catalog/${DESK_ID}`, { ...desk, rooms: ["maddie-room", "garage"] });
    expect(garage.status).toBe(400);
    expect(garage.body.issues).toEqual([expect.stringMatching(/^rooms\.1: /)]);
    expect(await readData(`catalog/items/${DESK_ID}.json`)).toBe(before);
  });

  it("takes only JSON bodies up to 1 MB", async () => {
    const desk = await readFixtureItem(DESK_ID);
    expect((await call("PUT", `/api/catalog/${DESK_ID}`, JSON.stringify(desk), "text/plain")).status).toBe(415);
    expect((await call("PUT", `/api/catalog/${DESK_ID}`, "{ nope")).status).toBe(400);
    expect((await call("PUT", `/api/catalog/${DESK_ID}`, "")).status).toBe(400);
    const huge = await call("PUT", `/api/catalog/${DESK_ID}`, { ...desk, notes: "x".repeat(1_100_000) });
    expect(huge.status).toBe(413);
    expect(huge.body.error).toMatch(/1 MB/);
  });
});

describe("layouts", () => {
  const FIXTURE = "layouts/maddie-room/a.json";
  const fixtureSummary = { variant: "a", name: "Desk on the top wall", updatedAt: "2026-10-22T12:00:00.000Z", placements: 1, extras: 1 };
  const desk = (id: string, x: number, y: number) => ({ id, itemId: DESK_ID, x, y, rotation: 0, layer: "floor" });

  it("lists a room's saved variants, [] for a room without files, 404 for an unknown room", async () => {
    const list = await call("GET", "/api/layouts/maddie-room");
    expect(list.status).toBe(200);
    expect(list.body).toEqual({ room: "maddie-room", variants: [fixtureSummary] });
    expect((await call("GET", "/api/layouts/kitchen")).body).toEqual({ room: "kitchen", variants: [] });
    const missing = await call("GET", "/api/layouts/garage");
    expect(missing.status).toBe(404);
    expect(missing.body.error).toMatch(/garage/);
  });

  it("answers 405 for a PUT on the room path: a layout is saved per variant", async () => {
    const before = await readData(FIXTURE);
    const r = await call("PUT", "/api/layouts/maddie-room", { placements: [] });
    expect(r.status).toBe(405);
    expect(r.headers.get("allow")).toBe("GET, HEAD");
    expect(r.body.error).toMatch(/PUT \/api\/layouts\/maddie-room\/<variant>/);
    expect(await readData(FIXTURE)).toBe(before);
  });

  it("gets a variant: the saved file, an empty a for a room without one, 404 for any other missing variant", async () => {
    const saved = await call("GET", "/api/layouts/maddie-room/a");
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual(JSON.parse(await readData(FIXTURE)));
    const empty = await call("GET", "/api/layouts/kitchen/a");
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ room: "kitchen", variant: "a", name: "", notes: "", placements: [], extras: [] });
    const noB = await call("GET", "/api/layouts/maddie-room/b");
    expect(noB.status).toBe(404);
    expect(noB.body.error).toMatch(/no variant "b"/);
    expect((await call("GET", "/api/layouts/kitchen/b")).status).toBe(404);
    expect((await call("GET", "/api/layouts/garage/a")).status).toBe(404);
  });

  it("saves variants with PUT, stamps updatedAt and lists them sorted by id (a round trip)", async () => {
    const before = Date.now();
    const c = { name: "Desk by the door", notes: "Third option.", placements: [desk("desk", 0, 60)], extras: [{ itemId: DESK_ID, qty: 2, note: "spares" }] };
    const b = { name: "Two desks", notes: "", placements: [desk("desk", 40, 0), { ...desk("desk-2", 0, 60), rotation: 90, note: "by the door" }], extras: [] };
    const putC = await call("PUT", "/api/layouts/maddie-room/c", c);
    expect(putC.status).toBe(200);
    expect(putC.body).toEqual({ room: "maddie-room", variant: "c", updatedAt: expect.any(String), ...c });
    expect(Date.parse(putC.body.updatedAt)).toBeGreaterThanOrEqual(before);
    const putB = await call("PUT", "/api/layouts/maddie-room/b", b);
    expect(putB.status).toBe(200);
    for (const [variant, reply] of [["b", putB], ["c", putC]] as const) {
      expect(await readData(`layouts/maddie-room/${variant}.json`)).toBe(toJsonText(reply.body));
      expect((await call("GET", `/api/layouts/maddie-room/${variant}`)).body).toEqual(reply.body);
    }
    expect(Object.keys(JSON.parse(await readData("layouts/maddie-room/c.json")))).toEqual([
      "room", "variant", "name", "updatedAt", "notes", "placements", "extras",
    ]);
    expect((await call("GET", "/api/layouts/maddie-room")).body).toEqual({
      room: "maddie-room",
      variants: [
        fixtureSummary,
        { variant: "b", name: "Two desks", updatedAt: putB.body.updatedAt, placements: 2, extras: 0 },
        { variant: "c", name: "Desk by the door", updatedAt: putC.body.updatedAt, placements: 1, extras: 1 },
      ],
    });
  });

  it("creates the layouts directories for a room that had none, filling in the defaults", async () => {
    await fs.rm(path.join(data.dir, "layouts"), { recursive: true });
    const r = await call("PUT", "/api/layouts/back-bedroom/a", { placements: [{ id: "desk", itemId: DESK_ID, x: 10, y: 10 }] });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      room: "back-bedroom", variant: "a", name: "", updatedAt: expect.any(String), notes: "", placements: [desk("desk", 10, 10)], extras: [],
    });
    expect(JSON.parse(await readData("layouts/back-bedroom/a.json"))).toEqual(r.body);
  });

  it("keeps the saved name, notes and extras when the body omits them, and ignores updatedAt", async () => {
    const saved = JSON.parse(await readData(FIXTURE));
    const r = await call("PUT", "/api/layouts/maddie-room/a", { updatedAt: "2020-01-01T00:00:00.000Z", placements: [] });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ...saved, updatedAt: expect.any(String), placements: [] });
    expect(r.body.updatedAt).not.toBe("2020-01-01T00:00:00.000Z");
    expect(r.body.updatedAt).not.toBe(saved.updatedAt);

    const cleared = await call("PUT", "/api/layouts/maddie-room/a", { name: "", notes: "", placements: [], extras: [] });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ name: "", notes: "", extras: [] });
    const fresh = await call("PUT", "/api/layouts/maddie-room/b", { placements: [] });
    expect(fresh.body).toMatchObject({ variant: "b", name: "", notes: "", extras: [] });
  });

  it("refuses a body whose room or variant differs from the path, and takes one that matches", async () => {
    const before = await readData(FIXTURE);
    const r = await call("PUT", "/api/layouts/maddie-room/a", { room: "kitchen", variant: "b", placements: [] });
    expect(r.status).toBe(400);
    expect(r.body.issues).toEqual(['room: expected "maddie-room" (from the path), got "kitchen"', 'variant: expected "a" (from the path), got "b"']);
    expect(await readData(FIXTURE)).toBe(before);
    expect((await call("PUT", "/api/layouts/maddie-room/a", JSON.parse(before))).status).toBe(200);
  });

  it("refuses an item without dimensions, unknown items, duplicate ids, a bad qty and a missing placements list", async () => {
    const before = await readData(FIXTURE);
    const put = (body: unknown) => call("PUT", "/api/layouts/maddie-room/a", body);

    const noDims = await put({ placements: [{ id: "shelf", itemId: NO_DIMS_ID, x: 0, y: 0 }] });
    expect(noDims.status).toBe(400);
    expect(noDims.body.issues).toEqual([`placements.0.itemId: "${NO_DIMS_ID}" has no dimensions, so it cannot be placed`]);

    const unknown = await put({ placements: [{ id: "bed", itemId: "ikea-00000000", x: 0, y: 0 }], extras: [{ itemId: DESK_ID }, { itemId: "ikea-11111111", qty: 2 }] });
    expect(unknown.status).toBe(400);
    expect(unknown.body.issues).toEqual(['placements.0.itemId: no catalog item "ikea-00000000"', 'extras.1.itemId: no catalog item "ikea-11111111"']);

    const dupes = await put({ placements: [desk("desk", 0, 0), desk("desk", 50, 50)], extras: [{ itemId: NO_DIMS_ID }, { itemId: NO_DIMS_ID }] });
    expect(dupes.status).toBe(400);
    expect(dupes.body.issues).toEqual(['placements.1.id: duplicate placement id "desk"', `extras.1.itemId: "${NO_DIMS_ID}" is listed twice in extras; use qty`]);

    const badQty = await put({ placements: [], extras: [{ itemId: NO_DIMS_ID, qty: 0 }] });
    expect(badQty.status).toBe(400);
    expect(badQty.body.issues).toEqual([expect.stringMatching(/^extras\.0\.qty: /)]);

    const bare = await put({ notes: "only notes" });
    expect(bare.status).toBe(400);
    expect(bare.body.issues).toEqual([expect.stringMatching(/^placements: /)]);

    expect(await readData(FIXTURE)).toBe(before);
  });

  it("takes an extra whose item has no dimensions (an extra is never placed); qty defaults to 1", async () => {
    const r = await call("PUT", "/api/layouts/maddie-room/b", { placements: [], extras: [{ itemId: NO_DIMS_ID, qty: 2, note: "one per shelf" }, { itemId: DESK_ID }] });
    expect(r.status).toBe(200);
    expect(r.body.extras).toEqual([{ itemId: NO_DIMS_ID, qty: 2, note: "one per shelf" }, { itemId: DESK_ID, qty: 1 }]);
  });

  it("refuses a reserved or malformed variant id on every route, before touching any file", async () => {
    for (const [method, urlPath] of [
      ["GET", "/api/layouts/maddie-room/view"],
      ["PUT", "/api/layouts/maddie-room/view"],
      ["POST", "/api/layouts/maddie-room/view/promote"],
      ["PUT", "/api/layouts/maddie-room/B"],
      ["PUT", "/api/layouts/maddie-room/b%20c"],
      ["GET", "/api/layouts/maddie-room/..%2Fmaddie-room"],
    ] as const) {
      const r = await call(method, urlPath, method === "GET" ? undefined : { placements: [] });
      expect(r.status, `${method} ${urlPath}`).toBe(400);
      expect(r.body.error).toMatch(/is reserved|is not a variant id/);
    }
    expect(await fs.readdir(path.join(data.dir, "layouts/maddie-room"))).toEqual(["a.json"]);
  });

  it("promotes a variant by swapping it with a: each file's variant rewritten, everything else kept", async () => {
    const oldA = await readData(FIXTURE);
    const putB = await call("PUT", "/api/layouts/maddie-room/b", { name: "Desk lower down", placements: [desk("desk", 6, 40)] });
    const r = await call("POST", "/api/layouts/maddie-room/b/promote", {});
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      room: "maddie-room",
      variants: [{ variant: "a", name: "Desk lower down", updatedAt: putB.body.updatedAt, placements: 1, extras: 0 }, { ...fixtureSummary, variant: "b" }],
    });
    expect(await readData("layouts/maddie-room/a.json")).toBe(toJsonText({ ...putB.body, variant: "a" }));
    expect(await readData("layouts/maddie-room/b.json")).toBe(toJsonText({ ...JSON.parse(oldA), variant: "b" }));
    expect((await call("GET", "/api/layouts/maddie-room/a")).body.name).toBe("Desk lower down");

    expect((await call("POST", "/api/layouts/maddie-room/b/promote", {})).status).toBe(200);
    expect(await readData(FIXTURE)).toBe(oldA);
  });

  it("promoting a changes nothing, a missing variant is a 404, and with no a saved the variant moves to a", async () => {
    const before = await readData(FIXTURE);
    const noop = await call("POST", "/api/layouts/maddie-room/a/promote", {});
    expect(noop.status).toBe(200);
    expect(noop.body).toEqual({ room: "maddie-room", variants: [fixtureSummary] });
    expect(await readData(FIXTURE)).toBe(before);

    const missing = await call("POST", "/api/layouts/maddie-room/zz/promote", {});
    expect(missing.status).toBe(404);
    expect(missing.body.error).toMatch(/no variant "zz"/);
    expect((await call("POST", "/api/layouts/garage/b/promote", {})).status).toBe(404);

    const putB = await call("PUT", "/api/layouts/back-bedroom/b", { name: "Only option", placements: [] });
    const moved = await call("POST", "/api/layouts/back-bedroom/b/promote", {});
    expect(moved.status).toBe(200);
    expect(moved.body.variants).toEqual([{ variant: "a", name: "Only option", updatedAt: putB.body.updatedAt, placements: 0, extras: 0 }]);
    expect(await fs.readdir(path.join(data.dir, "layouts/back-bedroom"))).toEqual(["a.json"]);
  });

  it("promotes only a request sent as application/json (the body may be empty); GET there is a 405", async () => {
    await call("PUT", "/api/layouts/maddie-room/b", { placements: [] });
    const promote = `${server.url}/api/layouts/maddie-room/b/promote`;
    expect((await call("POST", "/api/layouts/maddie-room/b/promote", "variant=b", "application/x-www-form-urlencoded")).status).toBe(415);
    const bare = await fetch(promote, { method: "POST" });
    expect(bare.status).toBe(415);
    expect((await bare.json()).error).toMatch(/Content-Type: application\/json/);
    const get = await call("GET", "/api/layouts/maddie-room/b/promote");
    expect([get.status, get.headers.get("allow")]).toEqual([405, "POST"]);
    expect(JSON.parse(await readData("layouts/maddie-room/b.json")).name).toBe("");
    const empty = await fetch(promote, { method: "POST", headers: { "content-type": "application/json" } });
    expect(empty.status).toBe(200);
    expect(JSON.parse(await readData("layouts/maddie-room/b.json")).name).toBe("Desk on the top wall");
  });

  it("never loses an arrangement when the swap fails half-way", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const realRename = fs.rename;
    const failRename = (n: number) => {
      let calls = 0;
      return vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
        if (++calls === n) throw new Error("disk unplugged");
        return realRename(from, to);
      });
    };
    const oldA = await readData(FIXTURE);
    await call("PUT", "/api/layouts/maddie-room/b", { name: "Desk lower down", placements: [desk("desk", 6, 40)] });
    const oldB = await readData("layouts/maddie-room/b.json");

    // The first rename fails: nothing has moved and the temporary files are gone.
    let spy = failRename(1);
    const first = await call("POST", "/api/layouts/maddie-room/b/promote", {});
    spy.mockRestore();
    expect(first.status).toBe(500);
    expect([await readData(FIXTURE), await readData("layouts/maddie-room/b.json")]).toEqual([oldA, oldB]);
    expect(await listPartFiles(data.dir)).toEqual([]);

    // The second fails: a.json is the promoted layout and the old "a" waits, complete, in its .part file.
    spy = failRename(2);
    const second = await call("POST", "/api/layouts/maddie-room/b/promote", {});
    spy.mockRestore();
    quiet.mockRestore();
    expect(second.status).toBe(500);
    expect(second.body.error).toMatch(/the old "a" is in layouts\/maddie-room\/b\.json\.[0-9a-f]{8}\.part: disk unplugged$/);
    expect(JSON.parse(await readData(FIXTURE))).toEqual({ ...JSON.parse(oldB), variant: "a" });
    const parts = await listPartFiles(data.dir);
    expect(parts).toHaveLength(1);
    expect(JSON.parse(await readData(parts[0]!))).toEqual({ ...JSON.parse(oldA), variant: "b" });
    await fs.rm(path.join(data.dir, parts[0]!));
  });

  it("answers 404 for a room that is not in rooms.json", async () => {
    const r = await call("PUT", "/api/layouts/garage/a", { placements: [] });
    expect(r.status).toBe(404);
    await expect(fs.stat(path.join(data.dir, "layouts/garage"))).rejects.toThrow();
  });
});

describe("POST /api/images", () => {
  it("downloads, attaches and then serves the image", async () => {
    const png = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#3366cc" } }).png().toBuffer();
    fetchImpl = async () => new Response(new Uint8Array(png), { headers: { "content-type": "image/png" } });
    const url = "https://m.media-amazon.com/images/I/desk.jpg";
    const r = await call("POST", "/api/images", { itemId: DESK_ID, url, caption: "front" });
    expect(r.status).toBe(200);
    expect(r.body.created).toBe(true);
    expect(r.body.image).toEqual({ file: `${DESK_ID}-1.jpg`, sourceUrl: url, caption: "front" });
    expect(r.body.item.images).toEqual([r.body.image]);
    expect((await call("GET", `/api/catalog/${DESK_ID}`)).body.images).toEqual([r.body.image]);

    const img = await fetch(`${server.url}/data/images/${DESK_ID}-1.jpg`);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/jpeg");
    expect(img.headers.get("cache-control")).toBe("no-cache");
    const meta = await sharp(Buffer.from(await img.arrayBuffer())).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 800, 400]);

    const again = await call("POST", "/api/images", { itemId: DESK_ID, url });
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(false);
  });

  it("answers 403 for a host off the list, 404 for an unknown item, 415 for a non-image, 502 when the fetch fails", async () => {
    fetchImpl = async () => new Response("<html></html>", { headers: { "content-type": "text/html" } });
    const offList = await call("POST", "/api/images", { itemId: DESK_ID, url: "https://ikea.com.evil.com/x.jpg" });
    expect(offList.status).toBe(403);
    expect((await call("POST", "/api/images", { itemId: "amazon-NOPE", url: "https://www.ikea.com/x.jpg" })).status).toBe(404);
    expect((await call("POST", "/api/images", { itemId: DESK_ID, url: "https://www.ikea.com/x.jpg" })).status).toBe(415);

    fetchImpl = async () => {
      throw new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND www.ikea.com") });
    };
    const failed = await call("POST", "/api/images", { itemId: DESK_ID, url: "https://www.ikea.com/x.jpg" });
    expect(failed.status).toBe(502);
    expect(failed.body.error).toMatch(/ENOTFOUND/);

    const noUrl = await call("POST", "/api/images", { itemId: DESK_ID });
    expect(noUrl.status).toBe(400);
    expect(noUrl.body.issues).toEqual([expect.stringMatching(/^url: /)]);

    expect((await call("GET", `/api/catalog/${DESK_ID}`)).body.images).toEqual([]);
    await expect(fs.readdir(path.join(data.dir, "images"))).rejects.toThrow();
  });
});

describe("data files", () => {
  it("serves sources and images with their content type", async () => {
    const img = sharp({ create: { width: 4, height: 4, channels: 3, background: "#000000" } });
    const files: [string, string, Buffer][] = [
      ["sources/sketch.png", "image/png", await img.clone().png().toBuffer()],
      ["sources/photo.webp", "image/webp", await img.clone().webp().toBuffer()],
      ["images/photo.jpeg", "image/jpeg", await img.clone().jpeg().toBuffer()],
    ];
    for (const [rel, type, bytes] of files) {
      await fs.mkdir(path.dirname(path.join(data.dir, rel)), { recursive: true });
      await fs.writeFile(path.join(data.dir, rel), bytes);
      const res = await fetch(`${server.url}/data/${rel}`);
      expect(res.status, rel).toBe(200);
      expect(res.headers.get("content-type")).toBe(type);
      expect(res.headers.get("cache-control")).toBe("no-cache");
      expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
    }
  });

  it("answers 404 for traversal, odd names, other file types and missing files", async () => {
    await fs.writeFile(path.join(data.dir, "secret.jpg"), "a file the traversal would reach");
    await fs.mkdir(path.join(data.dir, "sources"), { recursive: true });
    await fs.writeFile(path.join(data.dir, "sources/README.md"), "# notes");
    for (const p of [
      "/data/images/../x",
      "/data/images/../secret.jpg",
      "/data/sources/..%2Fsecret.jpg",
      "/data/sources/%2e%2e",
      "/data/images/a%20b.jpg",
      "/data/sources/README.md",
      "/data/images/missing.jpg",
      "/data/secret.jpg",
    ]) {
      expect(await rawGet(p), p).toBe(404);
    }
  });
});

describe("routing", () => {
  it("passes paths outside /api/ and /data/ to next()", async () => {
    expect((await call("GET", "/")).status).toBe(418);
    expect((await call("GET", "/src/main.tsx")).status).toBe(418);
  });

  it("answers 404 for an unknown API path and 405 for a method a route does not take", async () => {
    const unknown = await call("GET", "/api/nope");
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toMatch(/no route/);
    const wrong = await call("DELETE", `/api/catalog/${DESK_ID}`);
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get("allow")).toBe("GET, PUT, HEAD");
    expect((await call("POST", "/api/rooms", {})).status).toBe(405);
  });
});
