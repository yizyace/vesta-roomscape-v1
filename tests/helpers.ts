// Shared by the server tests: a throwaway data directory and the API on a real loopback port.
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import type { Middleware } from "../server/api.ts";
import { toJsonText } from "../shared/schema.ts";

export const APP_DIR = path.resolve(import.meta.dirname, "..");
export const REAL_DATA_DIR = path.resolve(APP_DIR, "data");
/** Laid out like the data dir: catalog/items/*.json and layouts/<room>/<variant>.json (plus the geometry snapshot rooms.json). */
export const FIXTURES_DIR = path.join(import.meta.dirname, "fixtures");

export const DESK_ID = "amazon-B0FBGR4MM4";
export const NO_DIMS_ID = "amazon-NODIMS0001";

export type TempDataDir = { dir: string; cleanup: () => Promise<void> };

/** The geometry tests' snapshot of rooms.json; the server tests use the live record instead. */
const ROOMS_SNAPSHOT = path.join(FIXTURES_DIR, "rooms.json");

/**
 * A temp copy of the real rooms.json and catalog/taxonomy.json plus the fixture items and layouts
 * (catalog/items/*.json, layouts/<room>/<variant>.json).
 */
export async function mkTempDataDir(): Promise<TempDataDir> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "furniture-planner-"));
  await fs.mkdir(path.join(dir, "catalog"), { recursive: true });
  await fs.copyFile(path.join(REAL_DATA_DIR, "rooms.json"), path.join(dir, "rooms.json"));
  await fs.copyFile(path.join(REAL_DATA_DIR, "catalog", "taxonomy.json"), path.join(dir, "catalog", "taxonomy.json"));
  await fs.cp(FIXTURES_DIR, dir, { recursive: true, filter: (src) => src !== ROOMS_SNAPSHOT });
  return { dir, cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}

/** A fixture item's JSON as stored, for building request bodies. */
export async function readFixtureItem(id: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(path.join(FIXTURES_DIR, "catalog", "items", `${id}.json`), "utf8"));
}

/**
 * Writes catalog/items/<id>.json under `dataDir`: the desk fixture with another id (an "amazon-" one)
 * and the given fields, e.g. a sofa or a rug for a layout test. Returns the id.
 */
export async function plantItem(dataDir: string, id: string, fields: Record<string, unknown>): Promise<string> {
  const item = { ...(await readFixtureItem(DESK_ID)), id, url: `https://www.amazon.com/dp/${id.slice("amazon-".length)}`, ...fields };
  await fs.writeFile(path.join(dataDir, "catalog", "items", `${id}.json`), toJsonText(item));
  return id;
}

/** Writes layouts/<room>/<variant>.json under `dataDir` as given, without the checks a save makes. */
export async function plantLayout(dataDir: string, room: string, variant: string, layout: Record<string, unknown>): Promise<void> {
  const file = path.join(dataDir, "layouts", room, `${variant}.json`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, toJsonText(layout));
}

/** Every leftover `*.part` (a half-finished atomic write) under `dir`, relative to it. */
export async function listPartFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { recursive: true });
  return entries.filter((name) => name.endsWith(".part")).sort();
}

export type TestServer = { url: string; close: () => Promise<void> };

/** The middleware on node:http at 127.0.0.1 and a free port; a request it passes on gets 418 "next". */
export async function startTestServer(middleware: Middleware): Promise<TestServer> {
  const server = http.createServer((req, res) => {
    middleware(req, res, (err) => {
      res.statusCode = err ? 500 : 418;
      res.end(err ? String(err) : "next");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
