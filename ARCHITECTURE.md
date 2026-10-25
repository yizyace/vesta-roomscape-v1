# Furniture planner: architecture

For an agent changing the app. The human guide is [`README.md`](README.md). The agent's procedure for
the data is the `furniture-planner` skill (`.claude/skills/furniture-planner/`); its
`references/app-dev.md` is the short version of this page and `references/data-model.md` explains every
field.

## Shape

One package: Vite, React 19 and TypeScript, with no separate backend. Vite's dev server (`npm run dev`,
port 5173) and its preview server (`npm run preview`, port 4173) both mount the JSON API as Connect
middleware, registered by the `furniture-api` plugin in `vite.config.ts`. The CLI (`server/cli.ts`)
calls the same modules. The data lives beside the app, in `data/`, committed to git;
`server/paths.ts` finds it, and `FURNITURE_DATA_DIR` points everything at another directory (the tests
use a temporary copy). Node runs the server and CLI TypeScript directly (type stripping), so only the
client has a build step. `npm run build:pages` builds a second, read-only copy that needs no server, for
GitHub Pages ([The read-only copy](#the-read-only-copy)).

## Modules

```
vesta-roomscape-v1/
├── shared/                 pure (no fs, no DOM): imported by the client, the server, the CLI and the tests
│   ├── schema.ts           zod schemas of the four data files (the data contract), ROOM_IDS, LAYERS, issuesToLines, toJsonText
│   ├── geometry.ts         the wall walk, feature spans and door arcs, footprints, keep-out zones, collisions by layer, snap
│   ├── format.ts           inches and feet-inches, money, dimension text
│   └── static.ts           the read-only copy's file for each GET (staticFile, staticUrl)
├── server/                 Node only
│   ├── paths.ts            DATA_DIR and every file path; an id must pass its regex before it names a file; "view" is a reserved variant
│   ├── errors.ts           HttpError(status, message, issues?)
│   ├── store.ts            JSON reads; atomic writes (<file>.<random>.part, then rename); writePartFile; a per-key lock
│   ├── rooms.ts            loads rooms.json and refuses a walk that is open or counter-clockwise
│   ├── catalog.ts          taxonomy and items: list, get, save (schema, taxonomy, room ids; 409 unless update); loadCatalog
│   ├── layouts.ts          a room's variants: list, get, save (placed items exist and have dimensions, extras exist), promote
│   ├── images.ts           catalog:image: the host allowlist, the download, the 800 px JPEG, images[]
│   ├── validate.ts         validateAll: every file on disk, errors and warnings
│   ├── api.ts              the HTTP API as Connect middleware
│   └── cli.ts              validate · catalog add · catalog image · layout set · layout list · layout promote
├── src/                    the React client
│   ├── main.tsx, App.tsx   entry; App owns the data hooks, the route, the selection, the filters and sort, the keys
│   ├── api.ts              typed fetch wrappers; every answer is parsed with the shared schemas; READ_ONLY reads the static files
│   ├── route.ts            the hash routes: #/<room>[/<variant>][/view] (pure)
│   ├── variants.ts         the switcher's pills, the next free letter, a copy's name (pure)
│   ├── totals.ts           a variant's total and the kitchen list's, in cents; the newest price's date (pure)
│   ├── edit.ts             pure layout edits: placement ids, a category's layer, moves kept in the room's box, rotation, room-list lines, keep-out reasons
│   ├── filters.ts          catalog filters and sorts (pure)
│   ├── zoom.ts             the plan's zoom levels, keeping the view's middle on a zoom, centring a strip's open entry (pure)
│   ├── screen.ts           the one-column (phone and touch tablet) media query, as styles.css writes it
│   ├── hooks/              useRooms, useCatalog, useLayout (one variant: autosave, undo), useVariants, useHashRoute, useWindowFocus, useCenterCurrent
│   └── components/         RoomTabs, Toolbar, VariantBar, CatalogPanel, PlanZoom, RoomPlan (plan/: Walls, Features, Placements), DetailsPanel, RoomList, Legend, Thumb, Chips
├── tests/                  vitest; helpers.ts (temp data dir, test server, plantItem, plantLayout); fixtures/ (two items, one layout variant, the geometry tests' rooms.json snapshot)
├── scripts/
│   ├── check-node.mjs      refuses a Node outside package.json "engines" (runs before dev, test, validate and build:pages)
│   └── export-static.ts    the read-only copy's data: the API's answer to each GET, the photos and the sketches, into dist/
├── .github/workflows/pages.yml  publishes the read-only copy to GitHub Pages on a push to main
└── index.html, vite.config.ts, tsconfig.json, package.json, .npmrc, .tool-versions
```

## Data flow

Every write, from the CLI, the editor or a test, goes through one function: `saveItem`
(`server/catalog.ts`), `saveLayout` or `promoteVariant` (`server/layouts.ts`), or `addImageToItem`
(`server/images.ts`). Each parses its input with the schema, so the keys land in the schema's order and
unknown keys are dropped, checks it against the other files, and only then writes with `writeJsonAtomic`.
`saveLayout` and `promoteVariant` hold a lock on the room's `layouts/<room>/` directory. A promote writes
both swapped files in full as `.part` files before renaming either, so a crash never loses an
arrangement: at worst the old `a` survives in a `.part` file that the error names. The editor's Duplicate
is a plain save of the open variant under a new id. The API reads the files on every request and caches
nothing, so a CLI write shows on the next request; the client re-fetches when its window regains focus.

## Coordinates

The header of `shared/geometry.ts`:

> Room geometry in inches. Pure: no DOM, no fs. The room polygon is the walk of its wall list (clockwise
> from the top-left corner, x right, y down); features and placements are resolved against that walk.

The comment on `PlacementSchema` in `shared/schema.ts`:

> x, y is the top-left corner of the axis-aligned footprint. rotation is clockwise: 0 = the front faces
> +y (the piece is backed against the top wall), 90 against the right wall, 180 the bottom, 270 the left.
> At 90/270 the footprint is d × w.

And the function every check uses:

```ts
/** The footprint an item occupies at a placement; w and d swap at 90° and 270°. */
export function placementRect(dims: NonNullable<Dimensions>, p: Pick<Placement, "x" | "y" | "rotation">): Rect {
  const turned = p.rotation === 90 || p.rotation === 270;
  return { x: p.x, y: p.y, w: turned ? dims.d : dims.w, h: turned ? dims.w : dims.d };
}
```

An L-shaped piece (an L-desk, a sectional) records the free rectangle at one front corner as
`dimensions.notch` `{w, d, side}`, `side` being "left" or "right" as drawn at rotation 0. `placementRect`
stays its whole footprint (dragging, clamping, turning in place); `footprintRects` returns the two
rectangles it covers, the full-width back first (where the plan draws its photo, label and front tick)
and then the arm beside the notch, and `footprintOutline` its six corners for drawing.

`w` is the side that goes along a wall and `d` the projection into the room (`DimensionsSchema`). A
feature's `at` runs from its wall's start in the direction of travel, or back from the wall's end with
`anchor: "end"`; `measured` lists which of `at`, `length` and `depth` came from the tape. `walkWalls`
turns the walls into segments with inward normals; `isClosed` allows 0.01"; `rectInsidePolygon` is
complete for rectilinear rooms (the living room's step, Maddie's notch).

`keepOutZones(walls, features)` returns the floor a standing piece may not use, each zone `{kind, label,
rect}`: a `stairs` band (`depth` deep, `DEFAULT_STAIRS_DEPTH` 36 when left out), or for stairs with
`side: "out"`, which run beyond the wall and take no floor, a `front` landing 36" square at each end of
them labelled with the feature (F-40: which end people step off is unknown), or with `railing: true` one
`front` strip 36" deep along their whole length, since a piece against a railing is a step over it, a `heater` strip
(`DEFAULT_HEATER_DEPTH` 6), and a `swing` square per leaf of every door or closet with `swing: "in"`
(`length` square for a single door, two `length / 2` squares for double doors), a `front` landing 36"
deep before every door and closet whichever way it opens (`FRONT_CLEARANCE`, F-31: it holds every leaf up
to 36", so nothing can stand on a swing's edge), or the feature's own `landing` deep where Andrew agreed to
less (the master bedroom's bathroom door, 30", since 0.2.9), and an `opening` walkway 30" deep along every opening
(`OPENING_CLEARANCE`, F-42); `label` is the feature's `label`, else its type. `findCollisions(placements, itemsById, points, keepOut = [])` returns
`{overlapping, outside, blocked}`: only `floor` pieces overlap each other or land in `blocked` (a map from
placement id to the zones it touches); `rug` and `top` pieces only have to stay inside the room, which
every layer does (`outside`). Rects that share only an edge do not overlap, and items without dimensions
are skipped. An L-shaped piece collides, and stays inside the room, by its two `footprintRects`, so the
chair in an L-desk's notch is clear; `validate` names its overlaps the same way.

## The data contract

`shared/schema.ts` wins over every description of it, this one included:

- **rooms.json**: `{units: "in", source, rooms}`; unique room ids; walls with unique names, `dir`
  right/down/left/up, `kind` measured/derived/assumed; features (`window`, `door`, `heater`, `closet`,
  `opening`, `clear`, `stairs`) on a known wall, ending within it; `side` (`in` or `out`) and `railing` on stairs only; `landing` on doors and closets only;
  a room without walls has no features.
- **taxonomy.json**: `{categories, tags}`, slugs.
- **Item**: `id` `<vendor>-<sku>` starting with its `vendor`; `url` an http(s) URL, `null` only for
  `owned`; `rooms` each one of the six `ROOM_IDS`; `status` candidate/shortlisted/ordered/owned/rejected;
  `price` `{amount, currency: "USD", asOf}` or `null`; `dimensions` `{w, d, h?, notch?, raw?, source?}` or
  `null`, where `notch` `{w, d, side: "left" | "right"}` needs a `d` and is smaller than `w × d` both ways;
  `images[].file` exactly `<id>-<n>.jpg` and `sourceUrl` http(s); every date a real ISO date.
- **Layout** (`layouts/<room>/<variant>.json`): `room` one of the six `ROOM_IDS`; `variant` a slug,
  default `a` (the staged pick; `view` is reserved for the hash routes); `name`, default `""`;
  `updatedAt` an ISO date-time; `notes`; placements with unique slug ids, an item id, `x`, `y`,
  `rotation` 0/90/180/270, `layer` floor/rug/top (default floor) and an optional `note`; `extras`, each
  `{itemId, qty, note?}` with `qty` a whole number of at least 1 (default 1) and each item listed once.

`ROOM_IDS` is fixed: the UI never adds a room, and nothing else may (below).

## API

| Method and path | Answers |
|---|---|
| `GET /api/rooms` | `rooms.json`, parsed; a 500 when it fails the schema or a walk doesn't close |
| `GET /api/catalog` | `{items, taxonomy, errors}`: every item that parses, and `{file, message}` for each that doesn't |
| `GET /api/catalog/:id` | One item; 404 when there is none |
| `PUT /api/catalog/:id` | Saves the body as that item (an upsert); the body's `id` must match the URL |
| `GET /api/layouts/:room` | `{room, variants: [{variant, name, updatedAt, placements, extras}]}`: each saved variant with its counts, sorted by id, `[]` when none is saved; 404 for an unknown room. Any other method is a 405 that names the per-variant path |
| `GET /api/layouts/:room/:variant` | One variant; an empty layout for an unsaved `a`, a 404 for any other unsaved variant |
| `PUT /api/layouts/:room/:variant` | Saves `{name?, notes?, placements, extras?}` (or a whole Layout) and answers it as written, `updatedAt` stamped. Omitted `name`, `notes` and `extras` keep the saved values (`""`, `""` and `[]` for a new variant); a body `room` or `variant` other than the path's is a 400 |
| `POST /api/layouts/:room/:variant/promote` | Swaps the variant with `a` and answers `{room, variants}`. The body may be empty or `{}`, but the Content-Type must be JSON; 404 when the variant is not saved; promoting `a` changes nothing |
| `POST /api/images` | `{itemId, url, caption?}`: downloads, resizes and attaches one photo |
| `GET /data/images/<file>` | A catalog photo |
| `GET /data/sources/<file>` | A sketch or photo from `sources/` (`.jpg`, `.jpeg`, `.png`, `.webp`) |

HEAD works wherever GET does; any other method is a 405 with an `Allow` header. Paths outside `/api/` and
`/data/` go on to Vite. Each JSON GET is one call (`loadRooms`, `loadCatalog`, `listVariants`,
`getLayout`), which the read-only copy's export makes too. Every write, the promote POST included, must be
sent as `application/json` (else 415: a cross-site form cannot send that without a CORS preflight), and a
body is at most 1 MB (else 413). A variant id in a path must be a kebab-case slug other than `view` (else
400).

Every error is `{"error": "<message>", "issues"?: ["<path>: <message>", …]}` with its status:

| Status | When |
|---|---|
| 400 | The body fails the schema, names a category, tag, room or item the data doesn't define, or names another room or variant than the path; a malformed or reserved variant id |
| 403 | An image URL off the allowlist, or a redirect leaving it |
| 404 | No such item, room, variant, file or route |
| 405 | A method the route doesn't take |
| 409 | The item exists (the CLI without `--update`; the API's PUT always upserts) |
| 413 | A body over 1 MB, or an image over 20 MB |
| 415 | A body that isn't JSON, or a download that isn't an image |
| 500 | Broken data on disk (a layout file whose `room` or `variant` disagrees with its path included), logged as `[furniture-api]` |
| 502 | The vendor's server failed or timed out |

## CLI

```
node server/cli.ts validate
node server/cli.ts catalog add <file.json> [--update]
node server/cli.ts catalog image <itemId> <url> [--caption <text>]
node server/cli.ts layout set <room> <file.json> [--variant <id>] [--name <text>]
node server/cli.ts layout list [<room>]
node server/cli.ts layout promote <room> <variant>
```

The npm scripts `validate`, `catalog:add`, `catalog:image` and `layout:set` wrap the first four: `npm run
<script> -- <args>`. `layout list` and `layout promote` have no script: `node server/cli.ts layout list`.
`help` prints the usage. `layout set` takes the variant from `--variant`, else the file's `variant`, else
`a`, and the name from `--name`, else the file's `name`, else the saved one; a `room` in the file must
match the argument. `layout list` prints `<room>/<variant>  <name>  (<n> placed, <m> extras)` per saved
variant, for one room or every room, and says on stderr when there are none. `layout promote` prints the
room's variants afterwards, and says on stderr when the variant was already `a`. Exit 0 on success, 1 on
an error (`validate`: any `ERROR` line; the others print `<command>: <message>` and the issues indented,
on stderr), 2 on a usage error. `validate` prints `OK <file>`, `ERROR <file>: …` or `WARN <file>: …` per
file and a total. On success `catalog add`, `catalog image` and `layout set` print the path they wrote;
`catalog image` says "already attached … nothing downloaded" when the item already lists that URL;
`layout set` then prints that variant's validate lines on stderr. Run through npm, a relative file path is
resolved against the directory npm was started in (`INIT_CWD`).

## Validation layers

1. **Schema** (`shared/schema.ts`), per file, with its refinements: unique wall, room and placement ids,
   each extras item once, features on known walls and within them, the vendor prefix, a `url` unless
   owned, image file names.
2. **Room geometry** (`roomGeometryProblems` in `server/rooms.ts`): every measured room's walk closes and
   runs clockwise. `loadRooms` refuses `rooms.json` otherwise, so every route and every write that needs the
   rooms fails with a 500 until it is fixed.
3. **Cross-file, on save**: `itemReferenceIssues` (category and tags in the taxonomy, rooms in
   `rooms.json`), `parseItemFile` (the id matches the file name), `itemIssues` in `server/layouts.ts`
   (every placed item exists and has dimensions, every extra's item exists), `requireRoom` (the layout's
   room exists), `variantProblem` (the variant is a slug and not `view`), and the body's `room` and
   `variant` match the path.
4. **`validateAll`** (`server/validate.ts`, for `npm run validate`): layers 1 to 3 over every file on disk,
   plus image files that exist and the layout paths (`layouts/<room>/<variant>.json`, the directory its
   `room` and the file name its `variant`; a flat `layouts/<room>.json` is an error that says to move it
   to `layouts/<room>/a.json`), and one warning per finding of `findCollisions` with the room's
   `keepOutZones`: two floor pieces overlapping, any piece outside the room, a floor piece on the stairs,
   a heater strip, in a door's or closet's swing, in front of a door or closet or in an opening's walkway. Errors make `ok` false; warnings never block a save.
   The editor draws the same findings on the plan.
5. **The tests hold the real data too**: `tests/data.test.ts` (the files parse, `rooms.json` lists the six
   `ROOM_IDS` in order, the sketches exist, every reference resolves) and `tests/rooms-vs-csv.test.ts`
   (`rooms.csv` and `rooms.json` carry the same tape values, `rooms.csv` names exactly the six rooms, and
   `feet_inches` is `toFeetInches(inches)`).

## The client

- **Routes** live in the hash (`src/route.ts`, pure): `#/<room>` is the room's variant `a`, the staged
  pick, `#/<room>/<variant>` another variant, and `/view` after either shows the plan alone with the
  numbered legend, the room list and the total, for printing. `routeHash` leaves `a` out. A hash that does
  not parse is replaced (`fallbackRoute`): a bad variant id by its room's `a`, anything else by
  `#/living-room`, keeping view mode. A room tab opens the room's `a`.
- **`useLayout(room, variant)`** holds one variant: its name, notes, placements and room list (`extras`).
  It applies edits locally and saves 300 ms after the last one (at once on pointer-up), with 20 undo steps
  that cover the plan and the room list together. A 400 shows the server's message and reloads what is
  on disk; a failed save stays dirty and retries on the next edit or focus. On focus it re-reads the
  variant unless local edits are unsaved (they win); a variant changed on disk clears the undo stack. A
  404 for a variant other than `a` marks it missing, and the plan pane says so with a link to `a`.
- **`useVariants(room)`** lists the room's variants for the switcher (`GET /api/layouts/:room`), again on
  focus and after a save, a duplicate or a promote; a promote's answer is applied as it comes.
- **The switcher** (`VariantBar`, under the toolbar's title): one pill per variant, letter and name, sorted
  by id; `variantPills` adds `a` before its first save and a copy the list does not show yet. In edit
  mode, **Duplicate** re-reads the list, takes the next free letter from b to z (`nextVariantId`) and
  `PUT`s the open variant there as `Copy of <name>` (`copyName`), then opens it. **Make staged**, on an
  alternative, waits until the variant's edits are saved (`settle`), sends the promote `POST` and opens
  `a`. Neither moves the window if the user has gone to another variant meanwhile.
- **Layers** (`plan/Placements.tsx`) are drawn bottom to top: rugs, faded, with a thin outline and a
  one-line label where the furniture on them leaves room (`rugLabelSpot`); floor pieces; `top` pieces,
  dashed and translucent. A floor piece overlapping another, or any piece leaving the room, gets a red
  outline; a floor piece on a keep-out zone an amber one, with the floor it takes shaded. "Add to plan"
  puts a piece on its category's layer (`layerFor` in `src/edit.ts`: `rug` under; `tv`, `decor` and
  `mirror` on top; the rest, a lamp included, on the floor), and the details panel's Layer field changes
  it. The toolbar counts pieces overlapping, outside, on the stairs, on a heater, in a swing, in front of
  a door or closet and blocking an opening (`keepOutZones` adds a 36" landing before every door and closet,
  or its `landing`, F-31, and a 30" walkway along every opening, F-42).
- **The stairs** (`plan/Features.tsx`) are a band `depth` into the room, or beyond the wall with
  `side: "out"` (the living room's, since 0.2.7), with a tread line every 10" along the wall, dashed until
  `at`, `length` and `depth` are all measured, and labelled with the depth ("stairs ≈36"" until the depth
  is measured). `drawingExtent` takes in a band beyond the wall, and the wall's length label moves past it,
  as past a closet box (`outsideSpans` in `plan/Walls.tsx`).
- **The room list** is the variant's `extras` (`RoomList`). Catalog rows in `LIST_CATEGORIES` (bedding,
  curtains, textiles, bath, kitchenware) get "Add to room list" instead of "Add to plan" and do not drag
  onto the plan; an item's details offer both ("Add to plan" only when it has dimensions), so an item
  without dimensions can still go on the list. Adding an item that is already there raises its qty
  (`addExtra`). With nothing selected, the details panel shows the variant's name (editable), its
  numbered pieces with their layers, the room list with −/+ and remove, and the total. The room list and
  the name need no walls; the plan does.
- **Totals** (`src/totals.ts`, pure, added in cents): `roomTotals` is each placement's price once plus
  each extra's price × qty, split into the plan's share and the room list's, with items that have no
  price (or are missing from the catalog) counted and named; `itemsTotal` adds a list of distinct items,
  each once.
- **A room without walls** (the kitchen) has no plan: the plan pane shows its notes, its sketch and its
  essentials (`Essentials`): the catalog items whose `rooms` name it, rejected ones left out and counted,
  sorted by category and name, with their `itemsTotal`.
- **`useRooms` and `useCatalog`** re-fetch on focus. The details panel saves an item's status and notes
  with `PUT /api/catalog/:id`, optimistically, rolled back if the server refuses.
- **`src/api.ts`** parses every answer with the shared schemas, so a contract drift shows as an error
  message instead of a broken render, and checks that a layout answered is the room and variant asked for.
- **Editing** (`src/edit.ts`): new placements get `<category>-<n>` ids; new pieces and drags snap to 1"
  and are kept inside the room's bounding box. A press that moves the pointer less than 3 px is a click and
  only selects (`isDragStart`), so clicking a piece that sits between grid lines does not move it. The polygon (the step, the notch) is checked by the red
  warning, not by the clamp.
- **Keys** (`App.tsx`): arrows nudge 1", Shift-arrows 12", `r` rotates about the center, Delete or
  Backspace removes, Esc deselects, ⌘Z or Ctrl-Z undoes the last change to the plan or the room list;
  none of them in view mode or while typing in a field.
- **Zoom** (`PlanZoom`, `src/zoom.ts`): − Fit + on every plan, in the pane's top-right corner (under the
  plan on a phone, beside a tip). The plan sits in a frame that scrolls, sized to the drawing's shape
  (`--plan-ratio`, from `planFrame`) times `--zoom`, and never smaller than the frame, which it
  letterboxes; a zoom step keeps the middle of the view in place (`keepCenter`). On a phone the frame
  keeps the fit's height, so the plan scrolls inside it and the buttons stay under the thumb. A room opens
  at the fit; its variants share the zoom, for comparing them.
- **Phones and touch tablets** (`src/screen.ts`: up to 760px wide, or a touch screen up to 1180px; a desktop
  window that narrow keeps the catalog beside the plan): one column, the plan at the room's own shape
  (the fit fills the width or 72% of the screen's height), the room's summary under it with the layout
  notes folded, then the catalog folded under a button with its count. The room tabs and the variant
  pills scroll sideways and keep the open one in view (`useCenterCurrent`). Below 1180px, wherever the
  details are not a side pane, a selection opens in a sheet over the bottom of the screen, product first,
  with a close button, and the summary stays under the plan: App renders the summary and the selection as
  two `DetailsPanel`s (`kind`), and styles.css places them. Where nothing edits, a piece is selected by a
  click rather than a press, and the plan's `touch-action` is `manipulation`, so a swipe that starts on it
  scrolls the page; only a piece in the editor takes the touch (`none`), for dragging. On a touch screen
  the fields are 16px (iOS zooms into smaller ones) and the targets bigger. `tests/styles.test.ts` pins
  these rules.

## The read-only copy

`npm run build:pages` builds a copy of the planner that needs no server, for GitHub Pages:
`VITE_STATIC=1 vite build` with the base `/vesta-roomscape-v1/` (`PAGES_BASE` overrides it), then
`node scripts/export-static.ts dist`.

- **The export** (`scripts/export-static.ts`) writes the API's answer to every GET the client makes: the
  same function `server/api.ts` calls and the same text (`JSON.stringify`), at the file `shared/static.ts`
  names. That is `static/rooms.json`, `static/catalog.json`, `static/layouts/<room>.json` (the variant
  list) and `static/layouts/<room>/<variant>.json` for every saved variant, plus `a` for every room (the
  kitchen's tab reads its empty `a`). It copies each photo a catalog item lists to `data/images/<file>` and
  each room's sketch to `data/<sketch>`, where the client links them. It reads and checks everything
  before the first write: a missing photo or sketch, or a sketch outside the data directory, fails it with
  the file named. It writes only new files, only under the out dir, and refuses an out dir that overlaps
  the data directory or already holds an export (`vite build` empties `dist/` first).
  `tests/export-static.test.ts` holds every file to the live API's answer, byte for byte.
- **The client** (`src/api.ts`): `READ_ONLY` is `import.meta.env.VITE_STATIC === "1"`. `request` then
  sends each GET to `staticUrl(path, import.meta.env.BASE_URL)` and refuses every PUT and POST with a 405
  `ApiError` ("This is a read-only copy of the planner: nothing can be saved here") before any request. A
  file the copy lacks is a 404, so an unsaved variant reads as missing, as on the dev server. `imageUrl`
  and `sketchUrl` start with the base in both modes (`/` on the dev server). `useWindowFocus` does nothing:
  the files change only with a deploy.
- **The UI** offers nothing that would save. App's `editable` and `useLayout`'s `writable` are false, so
  nothing drags, nudges, rotates, deletes or is added; the toolbar has no save state and no Undo, its
  switch reads Browse and View, and a note says "Read-only copy · prices as of <date>", the newest
  `price.asOf` in the catalog (`latestPriceDate`); the switcher has no Duplicate or Make staged; the
  catalog and the details panel have no add buttons; the details panel shows the layer, the status, the
  notes and the variant's name as text. A tap or click on a piece or a catalog row still selects it (photos,
  price, size, store link; in a sheet on a phone), and the filters, the room lists, view mode, the zoom
  and print work as in the editor.
- `index.html` asks search engines not to index the site (`robots: noindex, nofollow`); the site and the
  repo are public all the same.
- **Publishing** (`.github/workflows/pages.yml`), on a push to `main` or by hand (`workflow_dispatch`): a
  build job (checkout; setup-node from `.tool-versions` with the npm cache; `npm ci`; `npm test`; `npm run
  build:pages`; configure-pages; `dist/` uploaded as the Pages artifact) and a deploy job (deploy-pages in
  the `github-pages` environment, whose URL is its `page_url`). The permissions are `contents: read`,
  `pages: write` and `id-token: write`; the concurrency group `pages` queues a newer run behind the one
  deploying. The repo's Pages source must be GitHub Actions. The runner is ubuntu-latest (linux-x64,
  glibc): `package-lock.json` lists the linux-x64 builds of sharp, rolldown, lightningcss and TypeScript
  beside the macOS ones, so `npm ci` installs them there. sharp is only for `catalog:image`, but
  `vite.config.ts` and the tests import `server/api.ts`, which loads it: a lockfile that loses
  `@img/sharp-linux-x64` breaks the build on the runner (regenerate it with `rm -rf node_modules
  package-lock.json && npm install`).

## Images

`server/images.ts`: https only, no credentials in the URL, and a host that is `ikea.com`,
`media-amazon.com`, `ssl-images-amazon.com`, `costco.com` or `upliftdesk.com`, or a subdomain of one
(`ALLOWED_IMAGE_HOSTS`), or a path inside one vendor's folder on a shared CDN, on that exact host
(`ALLOWED_IMAGE_FOLDERS`: UPLIFT's BigCommerce store, `cdn11.bigcommerce.com/s-l85bzww3lo/`, where its
product photos live; Andrew, 2026-10-24).
Redirects are followed by hand, each target checked again, at most five. The response must be `image/*`,
at most 20 MB, within 20 seconds. sharp applies the EXIF orientation, flattens transparency onto white,
fits the image inside 800 × 800 without enlarging it, and writes a quality-82 JPEG with no metadata as
`images/<itemId>-<n>.jpg`, n one past the highest index in `images[]` or on disk. A URL the item already
lists is not fetched again. Choosing n and saving the item run under a per-item lock, and the new file is
removed if the save fails. This is the sanctioned exception to the repo's browser-only rule (AGENTS.md
§11): images only, never a page.

## Run and test

From the repo root, so asdf picks Node 24.22.1: `npm ci`, then `npm run dev`, `npm test`, `npm run
typecheck`, `npm run build`, `npm run build:pages`, `npm run preview`, `npm run validate`. To look at the
read-only copy, `npx vite preview --outDir dist --base /vesta-roomscape-v1/` after `build:pages`.

Tests first: a failing test in `tests/`, then the code. The server tests run the middleware on a loopback
port (`startTestServer`) over a temporary data directory (`mkTempDataDir` copies the real `rooms.json` and
`taxonomy.json` plus `tests/fixtures/`), with a fake `fetch` for images. `tests/cli.test.ts` spawns
`node server/cli.ts`, which also proves that the pinned Node strips the types. A test never writes under
`data/`. Before reporting, `test`, `typecheck`, `build`, `build:pages` and `validate` all pass.

A change to the client is also looked at on a phone's width before it ships, since the published copy is
mostly opened from links on phones: a local page of `<iframe>`s 375 and 390 wide (and 844 by 390, a phone
on its side) over the built copy, opened in Chrome, shows each room, a tap on a piece (the sheet), the
zoom, view mode and the folded catalog. An iframe in desktop Chrome has a fine pointer, so the touch-only
rules (`pointer: coarse`: the one column on a tablet, 16px fields) need the same width check on a real
phone after the deploy. To drag in the editor without touching `data/`, run `npm run dev` with
`FURNITURE_DATA_DIR` pointing at a copy.

## Versioning

`package.json` `version` (0.2.10 today: the phone layout, a selection's sheet and the plan's zoom, after Andrew found the published copy hard to use on a phone; 0.2.9 `landing` on a door or closet, a landing shallower than 36" where Andrew agreed to one, the master bedroom's bathroom door at 30"; 0.2.8 `railing` on stairs, so the floor along the living room's railing stays clear its whole length; 0.2.7 stairs that run beyond their wall, `side: "out"`, so the living room's measured floor is whole and only a 36" landing at each end of its stairs is kept clear; 0.2.6 UPLIFT's photos allowed, `upliftdesk.com` and its store's CDN folder; 0.2.5 L-shaped footprints, `dimensions.notch`, so the chair at an L-desk stands in its corner instead of on a rectangle drawn around it; 0.2.4 a 36" landing kept clear in front of every door and closet, F-31, in place of the 24" before closets only, which a closet's own swing swallowed; 0.2.3 the read-only copy, `npm run build:pages`, for GitHub Pages; 0.2.2 kept a 30" walkway clear along an opening, F-42, and stopped a click from nudging a piece onto the grid; 0.2.1 made an item's `d` optional for flat things, curtains and posters, which only hang on a wall). Below 1.0.0 the minor number stands in for the major, so a
data-shape change goes from 0.x to 0.(x+1):

- **patch**: a fix, with no change to any file's shape;
- **minor**: a feature, or a new optional field that every existing file still passes;
- **major**: a change to the shape of `rooms.json`, an item or a layout. Add an entry under Migrations
  (what changed, how the files were rewritten), migrate every file under `data/` in the
  same pass, and run `validate` and `test`.

### Migrations

**0.1.0 to 0.2.0 (2026-10-22): layout variants, layers, extras, the stairs.** Andrew asked for every room
but the kitchen staged and fully furnished, with at least three alternatives (F-41), and said the living
room's left side is the staircase (F-40).

- A room's layout became one file per variant: `layouts/<room>.json` moved to `layouts/<room>/a.json`
  (`a` the staged pick; `b`, `c`, `d`, … the alternatives). The one file there,
  `layouts/maddie-room.json`, became `layouts/maddie-room/a.json` with `variant: "a"` and `name:
  "Example from the IKEA seed"`; the test fixture moved the same way. `validate` refuses a flat file left
  behind and says where it goes.
- `LayoutSchema` gained `variant` (default `a`), `name` (default `""`) and `extras` (default `[]`), and
  `PlacementSchema` gained `layer` (default `floor`), so a 0.1 layout's content still parses; the migrated
  file was written through the schema, which spelled the defaults out.
- `FEATURE_TYPES` gained `stairs`, and `rooms.json` the living room's band (left wall, `at` 0, `length`
  173, `depth` 36, `measured: ["length"]`).
- `findCollisions` takes the keep-out zones and a layer per placement: rugs and on-top pieces no longer
  overlap anything, and a floor piece on the stairs, a heater strip or a door's swing is a warning.
- The API's single-layout routes went: `GET /api/layouts/:room` now lists the variants and `PUT` there is
  a 405. One variant is `/api/layouts/:room/:variant`, and `POST …/promote` swaps it with `a`.

## Node pin

Node 24.22.1 through asdf. The repo root's `.tool-versions` pins it.
`package.json` `engines` is `>=24.22.1 <25`; `.npmrc` sets `engine-strict=true`, so `npm install` and `npm
ci` refuse another Node; `scripts/check-node.mjs` runs before `dev`, `test`, `validate` and `build:pages`,
because npm does not check `engines` on `run`. The machine's default Node predates the October 2026
security fixes.
`tsconfig.json` sets `erasableSyntaxOnly` and `allowImportingTsExtensions` because Node strips the types
itself: no enums, namespaces or parameter properties, and imports name their `.ts` files.

## Pitfalls

- The Claude-controlled Chrome tab has served another local app's cached page for 127.0.0.1 in this repo.
  Give Andrew the URL for his own window, and `curl` the API to check the server.
- The server binds to 127.0.0.1 only. Vite's host check runs before the middleware, so a DNS-rebound
  request never reaches the API. When 5173 is taken, Vite moves to the next port.
- A `rooms.json` that fails to load takes everything down (500s, failing CLIs); `npm run validate` names
  the problem.
- A `*.part` leftover is an interrupted write (gitignored).
- A change to `shared/schema.ts` changes the client, the server, the CLI and the tests at once, and can
  invalidate files on disk: run `validate` on the real data before reporting, and make it a major version if
  any file has to change.
- The editor clamps a piece to the room's bounding box, not its outline: in the living room and Maddie's
  room a piece can sit in the notch, and shows red.
- A rug left on the `floor` layer collides with everything standing on it, and a table lamp with its table;
  the fix is the layer, not the position.
- `view` cannot be a variant id: `#/<room>/view` is the print view.
- `touch-action: none` on the plan (as before 0.2.10) traps a phone's swipe: the page cannot scroll past
  the plan. Only an editable piece takes the touch, and a read-only piece selects on click, not on press,
  or the start of a scroll selects it.

## Never without Andrew's dated word

- Moving the data out of `data/`.
- Adding, removing or renaming a room (`ROOM_IDS`).
- Widening `ALLOWED_IMAGE_HOSTS` or `ALLOWED_IMAGE_FOLDERS`, or adding any other scripted access to a vendor site.

When a command, a field or a behaviour changes, update `README.md`, this file and the skill
(`.claude/skills/furniture-planner/`, with a version bump) in the same pass (AGENTS.md §11).
