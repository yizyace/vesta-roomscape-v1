// The read-only copy's file layout (shared/static.ts), and the client in each mode: src/api.ts built with
// VITE_STATIC=1 reads every GET from those files under the site's base and refuses writes before any
// request; without it, it calls the API at the root as before.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ItemSchema } from "../shared/schema.ts";
import { staticFile, staticUrl } from "../shared/static.ts";
import { DESK_ID, readFixtureItem } from "./helpers.ts";

const BASE = "/vesta-roomscape-v1/";

describe("staticFile", () => {
  it("names the file for each GET the client makes", () => {
    expect(staticFile("/api/rooms")).toBe("static/rooms.json");
    expect(staticFile("/api/catalog")).toBe("static/catalog.json");
    expect(staticFile("/api/layouts/living-room")).toBe("static/layouts/living-room.json");
    expect(staticFile("/api/layouts/living-room/b")).toBe("static/layouts/living-room/b.json");
    expect(staticFile("/api/layouts/maddie-room/reading-nook")).toBe("static/layouts/maddie-room/reading-nook.json");
  });

  it("has no file for any other path, and none for an id that is not a slug", () => {
    const others = [
      "/api/catalog/ikea-60561248",
      "/api/images",
      "/api/layouts",
      "/api/layouts/",
      "/api/layouts/living-room/",
      "/api/layouts/living-room/b/promote",
      "/api/layouts/../rooms",
      "/api/layouts/living-room/..",
      "/api/layouts/Living-Room",
      "/api/layouts/living%20room",
      "/api/rooms/",
      "/api/rooms?fresh=1",
      "/data/images/ikea-60561248-1.jpg",
      "api/rooms",
      "",
    ];
    for (const p of others) expect(staticFile(p), p).toBeNull();
  });
});

describe("staticUrl", () => {
  it("puts the file under the site's base", () => {
    expect(staticUrl("/api/rooms", "/")).toBe("/static/rooms.json");
    expect(staticUrl("/api/layouts/kitchen/a", BASE)).toBe("/vesta-roomscape-v1/static/layouts/kitchen/a.json");
    expect(staticUrl("/api/catalog", "/vesta-roomscape-v1")).toBe("/vesta-roomscape-v1/static/catalog.json");
  });

  it("is null where staticFile is", () => {
    expect(staticUrl("/api/catalog/ikea-60561248", BASE)).toBeNull();
  });
});

describe("src/api.ts", () => {
  let fetches: string[];

  /** src/api.ts as a build with these env values loads it. */
  async function loadApi(env: Record<string, string>): Promise<typeof import("../src/api.ts")> {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    vi.resetModules();
    return import("../src/api.ts");
  }

  beforeEach(() => {
    fetches = [];
    // Every request answers 404, so a test sees only where the client went.
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      fetches.push(`${init?.method ?? "GET"} ${url}`);
      return new Response("<!doctype html><title>404</title>", { status: 404, headers: { "content-type": "text/html" } });
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  describe("in the read-only copy (VITE_STATIC=1)", () => {
    it("is read-only", async () => {
      const api = await loadApi({ VITE_STATIC: "1", BASE_URL: BASE });
      expect(api.READ_ONLY).toBe(true);
    });

    it("sends each GET to its file under the base, never to /api", async () => {
      const api = await loadApi({ VITE_STATIC: "1", BASE_URL: BASE });
      await Promise.allSettled([api.getRooms(), api.getCatalog(), api.getVariants("living-room"), api.getLayout("living-room", "b")]);
      expect(fetches.sort()).toEqual([
        "GET /vesta-roomscape-v1/static/catalog.json",
        "GET /vesta-roomscape-v1/static/layouts/living-room.json",
        "GET /vesta-roomscape-v1/static/layouts/living-room/b.json",
        "GET /vesta-roomscape-v1/static/rooms.json",
      ]);
    });

    it("reads a file the copy does not have as a 404, which marks a variant missing", async () => {
      const api = await loadApi({ VITE_STATIC: "1", BASE_URL: BASE });
      await expect(api.getLayout("living-room", "q")).rejects.toMatchObject({ name: "ApiError", status: 404 });
    });

    it("refuses every write with a read-only error, before any request", async () => {
      const api = await loadApi({ VITE_STATIC: "1", BASE_URL: BASE });
      const item = ItemSchema.parse(await readFixtureItem(DESK_ID));
      const refused = { name: "ApiError", status: 405, error: expect.stringMatching(/read-only copy/) };
      await expect(api.putItem({ ...item, status: "ordered" })).rejects.toMatchObject(refused);
      await expect(api.putLayout("living-room", "b", { name: "", notes: "", placements: [], extras: [] })).rejects.toMatchObject(refused);
      await expect(api.promoteVariant("living-room", "b")).rejects.toMatchObject(refused);
      expect(fetches).toEqual([]);
    });

    it("links photos and sketches under the base", async () => {
      const api = await loadApi({ VITE_STATIC: "1", BASE_URL: BASE });
      expect(api.imageUrl("ikea-60561248-1.jpg")).toBe("/vesta-roomscape-v1/data/images/ikea-60561248-1.jpg");
      expect(api.sketchUrl("sources/2026-10-22 living room.jpg")).toBe("/vesta-roomscape-v1/data/sources/2026-10-22%20living%20room.jpg");
    });
  });

  describe("on the dev server (no VITE_STATIC)", () => {
    it("calls the API and links photos and sketches at the root", async () => {
      const api = await loadApi({ VITE_STATIC: "", BASE_URL: "/" });
      expect(api.READ_ONLY).toBe(false);
      await Promise.allSettled([api.getRooms(), api.getLayout("living-room", "b"), api.promoteVariant("living-room", "b")]);
      expect(fetches.sort()).toEqual(["GET /api/layouts/living-room/b", "GET /api/rooms", "POST /api/layouts/living-room/b/promote"]);
      expect(api.imageUrl("ikea-60561248-1.jpg")).toBe("/data/images/ikea-60561248-1.jpg");
      expect(api.sketchUrl("sources/2026-10-22-living-room-sketch-user.jpg")).toBe("/data/sources/2026-10-22-living-room-sketch-user.jpg");
    });
  });
});
