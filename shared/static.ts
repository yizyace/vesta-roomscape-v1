// The read-only copy (npm run build:pages) answers the client's GETs from files. This is where each
// answer lives, relative to the site's base URL: scripts/export-static.ts writes the files and src/api.ts
// reads them, so the two cannot drift apart. Pure.
//
//   GET /api/rooms                   static/rooms.json
//   GET /api/catalog                 static/catalog.json
//   GET /api/layouts/:room           static/layouts/<room>.json            (the room's variants)
//   GET /api/layouts/:room/:variant  static/layouts/<room>/<variant>.json
//
// Photos and sketches keep the paths the API serves them at: data/images/<file> and data/<sketch>.

const SLUG = "[a-z][a-z0-9-]*";
const LAYOUTS_RE = new RegExp(`^/api/layouts/(${SLUG})(?:/(${SLUG}))?$`);

/** The file that holds the answer to `GET <apiPath>`, or null for any other path: the copy has nothing else. */
export function staticFile(apiPath: string): string | null {
  if (apiPath === "/api/rooms") return "static/rooms.json";
  if (apiPath === "/api/catalog") return "static/catalog.json";
  const m = LAYOUTS_RE.exec(apiPath);
  if (!m) return null;
  return m[2] === undefined ? `static/layouts/${m[1]}.json` : `static/layouts/${m[1]}/${m[2]}.json`;
}

/** staticFile under the site's base URL (import.meta.env.BASE_URL: "/" in dev, "/vesta-roomscape-v1/" on Pages). */
export function staticUrl(apiPath: string, base: string): string | null {
  const file = staticFile(apiPath);
  if (file === null) return null;
  return base.endsWith("/") ? `${base}${file}` : `${base}/${file}`;
}
