// The planner's HTTP API as a Connect-style middleware: Vite's dev and preview servers mount it (see
// vite.config.ts) and the tests mount it on node:http. Paths under /api/ and /data/ are answered
// here; every other path goes to next(). Writes go through the same modules as the CLI.
//
//   GET  /api/rooms              rooms.json
//   GET  /api/catalog            {items, taxonomy, errors}
//   GET  /api/catalog/:id        one item
//   PUT  /api/catalog/:id        save an item (upsert); the body's id must match the URL
//   GET  /api/layouts/:room                   {room, variants}: each saved variant's id, name, updatedAt and counts
//   GET  /api/layouts/:room/:variant          one variant (an unsaved "a" is an empty layout, any other unsaved one a 404)
//   PUT  /api/layouts/:room/:variant          save {name?, notes?, placements, extras?}; omitted name, notes, extras are kept
//   POST /api/layouts/:room/:variant/promote  swap the variant with "a" (send Content-Type: application/json); {room, variants}
//   POST /api/images             {itemId, url, caption?}: download, resize, attach
//   GET  /data/images/<file>     a catalog image
//   GET  /data/sources/<file>    a source sketch or photo
//
// Errors are {"error": string, "issues"?: string[]} with the status. Every write must be sent as
// application/json (the promote POST too, with an empty body or {}), which a cross-site form or a
// text/plain fetch cannot do without a CORS preflight.
import fs from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { z } from "zod";
import { issuesToLines } from "../shared/schema.ts";
import { getItem, listItems, loadTaxonomy, saveItem } from "./catalog.ts";
import { HttpError, errorMessage } from "./errors.ts";
import { addImageToItem, type FetchLike } from "./images.ts";
import { getLayout, listVariants, promoteVariant, saveLayout } from "./layouts.ts";
import { DATA_DIR, imagesDir, sourcesDir } from "./paths.ts";
import { loadRooms } from "./rooms.ts";
import { isNotFound } from "./store.ts";

export type Middleware = (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void;
/** fetchImpl replaces the global fetch for POST /api/images (the tests pass a fake). */
export type ApiOptions = { fetchImpl?: FetchLike };

const MAX_BODY_BYTES = 1_000_000;
const DATA_FILE_RE = /^[A-Za-z0-9._-]+$/;
const DATA_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};
const ImageRequestSchema = z.object({ itemId: z.string(), url: z.string(), caption: z.string().optional() });

type Handlers = { GET?: () => Promise<void>; PUT?: () => Promise<void>; POST?: () => Promise<void> };

export function createApiMiddleware(dataDir: string = DATA_DIR, options: ApiOptions = {}): Middleware {
  return (req, res, next) => {
    // The raw path, not URL-normalised, so "/data/images/../x" reaches the checks as sent.
    const pathname = (req.url ?? "/").split("?")[0] ?? "/";
    if (!pathname.startsWith("/api/") && !pathname.startsWith("/data/")) {
      next();
      return;
    }
    route(dataDir, options, req, res, pathname).catch((e: unknown) => {
      try {
        sendError(res, e);
      } catch (err) {
        // Never let a failed reply become an unhandled rejection: it would stop the dev server.
        console.error("[furniture-api] could not send the error", err);
        res.destroy();
      }
    });
  };
}

async function route(dataDir: string, options: ApiOptions, req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  const send = (value: unknown) => sendJson(res, 200, value);
  let m: RegExpExecArray | null;

  if (pathname === "/api/rooms") {
    return dispatch(req, res, { GET: async () => send(await loadRooms(dataDir)) });
  }
  if (pathname === "/api/catalog") {
    return dispatch(req, res, {
      GET: async () => {
        const [{ items, errors }, taxonomy] = await Promise.all([listItems(dataDir), loadTaxonomy(dataDir)]);
        send({ items, taxonomy, errors });
      },
    });
  }
  if ((m = /^\/api\/catalog\/([^/]+)$/.exec(pathname))) {
    const id = decode(m[1]);
    return dispatch(req, res, {
      GET: async () => send(await getItem(dataDir, id)),
      PUT: async () => {
        const body = await readJsonBody(req);
        if (typeof body !== "object" || body === null || Array.isArray(body)) {
          throw new HttpError(400, "send the item as a JSON object", ["(root): expected an object"]);
        }
        const bodyId = (body as { id?: unknown }).id;
        if (bodyId !== id) {
          throw new HttpError(400, "the body's id does not match the URL", [`id: expected "${id}" (from the URL), got ${JSON.stringify(bodyId) ?? "nothing"}`]);
        }
        send(await saveItem(dataDir, body, { update: true }));
      },
    });
  }
  if ((m = /^\/api\/layouts\/([^/]+)$/.exec(pathname))) {
    const room = decode(m[1]);
    const hint = `a layout is saved per variant: PUT /api/layouts/${m[1]}/<variant>`;
    return dispatch(req, res, { GET: async () => send(await listVariants(dataDir, room)) }, hint);
  }
  if ((m = /^\/api\/layouts\/([^/]+)\/([^/]+)$/.exec(pathname))) {
    const [room, variant] = [decode(m[1]), decode(m[2])];
    return dispatch(req, res, {
      GET: async () => send(await getLayout(dataDir, room, variant)),
      PUT: async () => send(await saveLayout(dataDir, room, variant, await readJsonBody(req))),
    });
  }
  if ((m = /^\/api\/layouts\/([^/]+)\/([^/]+)\/promote$/.exec(pathname))) {
    const [room, variant] = [decode(m[1]), decode(m[2])];
    return dispatch(req, res, {
      POST: async () => {
        await readJsonBody(req, { optional: true }); // nothing to read; the JSON type keeps it same-origin
        send(await promoteVariant(dataDir, room, variant));
      },
    });
  }
  if (pathname === "/api/images") {
    return dispatch(req, res, {
      POST: async () => {
        const parsed = ImageRequestSchema.safeParse(await readJsonBody(req));
        if (!parsed.success) throw new HttpError(400, "send {itemId, url, caption?}", issuesToLines(parsed.error));
        const { itemId, url, caption } = parsed.data;
        send(await addImageToItem(dataDir, itemId, url, { fetchImpl: options.fetchImpl, caption }));
      },
    });
  }
  if ((m = /^\/data\/(images|sources)\/([^/]*)$/.exec(pathname))) {
    const dir = m[1] === "images" ? imagesDir(dataDir) : sourcesDir(dataDir);
    const name = decode(m[2]);
    return dispatch(req, res, { GET: () => sendDataFile(res, dir, name) });
  }
  throw new HttpError(404, `no route ${req.method} ${pathname}`);
}

/** Runs the handler for the request's method (HEAD runs GET; Node drops the body), else 405 (with `hint`, if given). */
async function dispatch(req: IncomingMessage, res: ServerResponse, handlers: Handlers, hint?: string): Promise<void> {
  const method = req.method === "HEAD" ? "GET" : req.method;
  const handler = method === "GET" || method === "PUT" || method === "POST" ? handlers[method] : undefined;
  if (!handler) {
    const allowed = Object.keys(handlers);
    res.setHeader("Allow", [...allowed, ...(handlers.GET ? ["HEAD"] : [])].join(", "));
    throw new HttpError(405, `${req.method} is not supported here; use ${allowed.join(" or ")}${hint ? ` (${hint})` : ""}`);
  }
  await handler();
}

/** A path segment, percent-decoded; "" (which matches no id or file name) when it is malformed. */
function decode(segment: string | undefined): string {
  try {
    return decodeURIComponent(segment ?? "");
  } catch {
    return "";
  }
}

/** The parsed JSON body; 415 unless it is sent as application/json. `optional`: an empty body is undefined. */
async function readJsonBody(req: IncomingMessage, { optional = false } = {}): Promise<unknown> {
  const type = (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (type !== "application/json") {
    req.resume();
    const what = optional
      ? "send the request with Content-Type: application/json (the body may be empty or {})"
      : "send the body as JSON with Content-Type: application/json";
    throw new HttpError(415, `${what} (got ${type ? `"${type}"` : "none"})`);
  }
  const text = (await readBody(req)).toString("utf8");
  if (text.trim() === "") {
    if (optional) return undefined;
    throw new HttpError(400, "the body is empty; send JSON");
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new HttpError(400, `the body is not valid JSON: ${errorMessage(e)}`);
  }
}

/** The whole body; past MAX_BODY_BYTES it keeps draining (so the 413 can be answered) but keeps nothing. */
function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    req.on("end", () => {
      if (size > MAX_BODY_BYTES) reject(new HttpError(413, "the body is larger than 1 MB"));
      else resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
    req.on("close", () => {
      if (!req.complete) reject(new HttpError(400, "the request was aborted before its body arrived"));
    });
  });
}

async function sendDataFile(res: ServerResponse, dir: string, name: string): Promise<void> {
  const type = DATA_TYPES[path.extname(name).toLowerCase()];
  if (!DATA_FILE_RE.test(name) || name.includes("..") || !type) throw new HttpError(404, "not found");
  let body: Buffer;
  try {
    body = await fs.readFile(path.join(dir, name));
  } catch (e) {
    if (isNotFound(e) || (e as NodeJS.ErrnoException).code === "EISDIR") throw new HttpError(404, "not found");
    throw e;
  }
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": body.length,
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendError(res: ServerResponse, e: unknown): void {
  const status = e instanceof HttpError ? e.status : 500;
  if (status === 500) console.error("[furniture-api]", e); // broken data or a bug; a 502 is the vendor's problem
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const issues = e instanceof HttpError ? e.issues : undefined;
  sendJson(res, status, issues?.length ? { error: errorMessage(e), issues } : { error: errorMessage(e) });
}
