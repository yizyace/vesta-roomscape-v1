// Typed wrappers around the planner's HTTP API (the vite middleware in server/). Every answer is
// checked against the shared schemas, so a client/server contract drift reads as an error message
// instead of a broken render, and the schema defaults fill any field the server left out.
import { z } from "zod";
import { ItemSchema, LayoutSchema, RoomsSchema, TaxonomySchema, issuesToLines } from "../shared/schema.ts";
import type { Extra, Item, Layout, Placement, RoomsFile, Taxonomy } from "../shared/schema.ts";

/** A failed request. `status` is the HTTP status, or 0 when the server could not be reached. */
export class ApiError extends Error {
  readonly status: number;
  readonly error: string;
  readonly issues: string[];

  constructor(status: number, error: string, issues: string[] = []) {
    super(error);
    this.name = "ApiError";
    this.status = status;
    this.error = error;
    this.issues = issues;
  }
}

/** One line for a status bar or a banner: the message and its issues. */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.issues.length > 0 ? `${e.error} (${e.issues.join("; ")})` : e.error;
  return e instanceof Error ? e.message : String(e);
}

const ErrorBodySchema = z.object({ error: z.string(), issues: z.array(z.string()).optional() });

async function request(method: "GET" | "PUT" | "POST", path: string, body?: unknown): Promise<unknown> {
  const init: RequestInit = { method, cache: "no-store", headers: { Accept: "application/json" } };
  if (body !== undefined) {
    init.headers = { Accept: "application/json", "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch (e) {
    throw new ApiError(0, `Cannot reach the planner server (${e instanceof Error ? e.message : String(e)})`);
  }
  const text = await res.text();
  let data: unknown;
  try {
    data = text === "" ? undefined : JSON.parse(text);
  } catch {
    data = undefined;
  }
  if (!res.ok) {
    const err = ErrorBodySchema.safeParse(data);
    if (err.success) throw new ApiError(res.status, err.data.error, err.data.issues ?? []);
    throw new ApiError(res.status, `${method} ${path} failed with HTTP ${res.status}`);
  }
  if (data === undefined) {
    // Vite answers unknown paths with index.html, so a missing API shows up as HTML here.
    const type = res.headers.get("content-type") ?? "no content type";
    throw new ApiError(res.status, `${method} ${path} did not answer with JSON (${type}); is the planner API running?`);
  }
  return data;
}

function check<S extends z.ZodType>(schema: S, data: unknown, what: string): z.output<S> {
  const parsed = schema.safeParse(data);
  // The request itself succeeded (2xx); only the shape is wrong.
  if (!parsed.success) throw new ApiError(200, `${what}: the answer does not match the schema`, issuesToLines(parsed.error));
  return parsed.data;
}

export function getRooms(): Promise<RoomsFile> {
  return request("GET", "/api/rooms").then((data) => check(RoomsSchema, data, "GET /api/rooms"));
}

export type CatalogFileError = { file: string; message: string };
export type Catalog = { items: Item[]; taxonomy: Taxonomy; errors: CatalogFileError[] };

const CatalogBodySchema = z.object({
  items: z.array(z.unknown()),
  taxonomy: TaxonomySchema,
  errors: z.array(z.object({ file: z.string(), message: z.string() })).default([]),
});

/** The catalog; an item that fails the schema joins `errors` instead of failing the whole list. */
export async function getCatalog(): Promise<Catalog> {
  const body = check(CatalogBodySchema, await request("GET", "/api/catalog"), "GET /api/catalog");
  const items: Item[] = [];
  const errors = [...body.errors];
  body.items.forEach((raw, i) => {
    const parsed = ItemSchema.safeParse(raw);
    if (parsed.success) items.push(parsed.data);
    else errors.push({ file: describeItem(raw, i), message: issuesToLines(parsed.error).join("; ") });
  });
  return { items, taxonomy: body.taxonomy, errors };
}

function describeItem(raw: unknown, index: number): string {
  if (typeof raw === "object" && raw !== null && "id" in raw && typeof raw.id === "string") return `items/${raw.id}.json`;
  return `catalog item #${index + 1}`;
}

export async function putItem(item: Item): Promise<Item> {
  const path = `/api/catalog/${encodeURIComponent(item.id)}`;
  return check(ItemSchema, await request("PUT", path, item), `PUT ${path}`);
}

// One file per variant: layouts/<room>/<variant>.json. Variant a is the staged pick; b, c, … the alternatives.

const VariantSummarySchema = z.object({
  variant: z.string(),
  name: z.string().default(""),
  updatedAt: z.string().optional(),
  placements: z.number().int().nonnegative(),
  extras: z.number().int().nonnegative(),
});
export type VariantSummary = z.infer<typeof VariantSummarySchema>;

const VariantListSchema = z.object({ room: z.string(), variants: z.array(VariantSummarySchema) });
export type VariantList = z.infer<typeof VariantListSchema>;

const layoutsPath = (room: string, variant?: string): string =>
  `/api/layouts/${encodeURIComponent(room)}${variant === undefined ? "" : `/${encodeURIComponent(variant)}`}`;

/** The room's variants, sorted by id; empty before the room's first save. */
export async function getVariants(room: string): Promise<VariantList> {
  const path = layoutsPath(room);
  return check(VariantListSchema, await request("GET", path), `GET ${path}`);
}

/** One variant. Variant a always answers (empty before its first save); another variant that has no file is a 404. */
export async function getLayout(room: string, variant: string): Promise<Layout> {
  const path = layoutsPath(room, variant);
  return sameVariant(check(LayoutSchema, await request("GET", path), `GET ${path}`), room, variant, `GET ${path}`);
}

export type LayoutBody = { name: string; notes: string; placements: Placement[]; extras: Extra[] };

/** Writes the variant (creating it when new); answers it as saved, `updatedAt` stamped. */
export async function putLayout(room: string, variant: string, body: LayoutBody): Promise<Layout> {
  const path = layoutsPath(room, variant);
  return sameVariant(check(LayoutSchema, await request("PUT", path, body), `PUT ${path}`), room, variant, `PUT ${path}`);
}

/** Swaps the variant with a (the staged pick); answers the room's variants afterwards. */
export async function promoteVariant(room: string, variant: string): Promise<VariantList> {
  const path = `${layoutsPath(room, variant)}/promote`;
  // An empty JSON body: the API takes request bodies only as application/json.
  return check(VariantListSchema, await request("POST", path, {}), `POST ${path}`);
}

function sameVariant(layout: Layout, room: string, variant: string, what: string): Layout {
  if (layout.room !== room || layout.variant !== variant) {
    throw new ApiError(200, `${what}: the answer is ${layout.room}/${layout.variant}, not ${room}/${variant}`);
  }
  return layout;
}

/** Where the server serves an item photo (`item.images[i].file`). */
export function imageUrl(file: string): string {
  return `/data/images/${encodeURIComponent(file)}`;
}

/** Where the server serves a room sketch (`room.sketch`, a path relative to data/). */
export function sketchUrl(sketch: string): string {
  return `/data/${sketch.split("/").map(encodeURIComponent).join("/")}`;
}
