# Furniture planner

## What this is

A room planner for L01, our second-floor apartment, before the move on Sunday,
November 1, 2026. It draws the six rooms from Andrew's tape measurements of October 22, keeps a catalog
of furniture with each product's link, price, dimensions and photos, and shows every room but the
kitchen staged: layout A, fully furnished, the way you would walk into it, plus at least three
alternatives to compare. You can move pieces, try your own arrangement, and see what fits and what it
costs. Everything it shows is plain JSON in this repo, under `data/`, so an agent can
add products and lay out rooms while you look at the same files in your browser.

The editor runs only on this Mac, at `http://127.0.0.1:5173/`; nothing it does is sent anywhere, and the
agent never buys anything. A read-only copy is published at <https://yizyace.github.io/vesta-roomscape-v1/>
to share by link ([The read-only copy](#the-read-only-copy)).

## Requirements

- Node 24.22.1, through asdf. The repo root's `.tool-versions` pins it; install it once with
  `asdf install nodejs 24.22.1`.
- The dependencies, once, and again after a pull that changes `package-lock.json`:

```
cd ~/work/vesta-roomscape-v1
npm install
```

## Start it

```
cd ~/work/vesta-roomscape-v1
npm run dev
```

Open the URL it prints (normally `http://127.0.0.1:5173/`) in your own browser window. Stop it with
Ctrl-C.

## Using the editor

- **Rooms** are tabs: living room, dining room, kitchen, master bedroom, back bedroom (the office) and
  Maddie's room. Walls, windows, doors and closets are drawn to scale; anything not measured yet (most
  window and door positions, the width of the living room's stairs) is dashed and marked "≈".
- **Layouts A, B, C, D.** Every room but the kitchen has **layout A, the staged pick**: the room as it
  would be staged for you to walk into. B, C and D are alternatives, each a different arrangement or a
  different key piece. The letters under the room's name switch between them (hover one for how many
  pieces it has), and a room's tab always opens A. To compare two side by side, open each in its own
  browser tab, for example `#/living-room` and `#/living-room/c`. With nothing selected, the right-hand
  panel shows the layout's name, which you can change there.
- **Duplicate** copies the layout you are looking at to the next free letter, names it "Copy of …" and
  opens it, so you can try a change without touching the original. **Make staged**, on an alternative,
  makes it the new A and opens it; the old A takes its letter, so nothing is lost.
- **The catalog** lists every product. Filter it by words, category, tag, store, room, status, maximum
  width, depth or price, and sort it by name, price, width, depth or the date it was added.
- **Place a piece** with "Add to plan", or by dragging its row onto the room, then drag it where you want
  it. With a piece selected, `r` rotates it a quarter turn, the arrow keys nudge it 1" (with Shift, 12"),
  Delete takes it out of the room, and Esc deselects it. ⌘Z undoes the last change.
- **Layers.** Rugs lie under the furniture (drawn faded underneath), and a table lamp, wall art, decor
  and mirrors sit on top (drawn dashed above), so none of them counts as
  overlapping what they share space with. Everything else stands on the floor. A new piece goes on the
  usual layer for its kind; a table lamp starts on the floor, so set its **Layer** to Top in the piece's
  details.
- **The room list** holds what belongs to the room but takes no floor space: bedding, curtains, cushions,
  throws, towels. Those products have "Add to room list" instead of "Add to plan"; a product's own
  details offer "Add to room list" for anything, and "Add to plan" when it has dimensions. With nothing
  selected, the right-hand panel shows the pieces on the plan, the room list with − and + for how many,
  and the **total**: every piece on the plan plus each line of the room list times its count. Anything
  without a price is named under it, not added.
- **The kitchen** isn't measured yet, so it has no plan. Its tab shows the kitchen essentials instead:
  every product meant for the kitchen that hasn't been rejected, with its price, and their total. The
  bathroom's things are in the catalog under the `bathroom` tag.
- **The living room's stairs** run along its whole left side, outside the room as measured: they are drawn
  beyond the left wall as a band with tread lines, 36" deep until the width is measured, so the room's
  261" are all floor. The floor at each end of the stairs, 36" square, is kept clear for stepping on and
  off.
- **An L-shaped piece** (an L-desk) is drawn as an L, and the chair goes in its corner.
- **Red** means a piece overlaps another piece standing on the floor, or sticks out of the room.
  **Amber** means it stands at the foot or head of the stairs, on a heater or in a door's or a closet's
  swing; the toolbar counts each kind.
- **Click a piece** (or a catalog row) for its photos, its store link, its price and the date that price
  was read, and its size; you can change its status (shortlisted, ordered…) and its notes there.
  Double-click a piece to open its product page.
- A piece without dimensions (the store's page showed none) is listed but can't be placed.
- **Your changes save by themselves** to `data/layouts/<room>/<letter>.json`, for
  example `layouts/maddie-room/a.json` for A. When an agent changes a layout, click back into the window
  and it reloads.
- **View mode**, `#/<room>/view` for A or `#/<room>/<letter>/view` for an alternative (for example
  `http://127.0.0.1:5173/#/maddie-room/view`), hides the panels and numbers each piece, with a legend of
  sizes, prices and links, the room list and the total. Print from the browser to get it on paper.

## The read-only copy

A copy of the planner that changes nothing, to share by link: there is nothing to install, only a
browser. It has the same room tabs, layouts A to D, plans, catalog with its search and filters, kitchen
essentials, room lists, totals and view mode, read from the files in `data/` as they were when it was
built. Click a piece or a catalog row for its photos, its price with the date it was read, its size and
its store link. Nothing in it saves, so it has no Edit mode (the switch reads Browse and View), no Add to
plan, no dragging, rotating or deleting, and no Duplicate or Make staged; statuses, notes and names show
as text. The toolbar says "Read-only copy", with the date of the newest price in the catalog.

Build it with `npm run build:pages`: the site lands in `dist/`, for
`https://yizyace.github.io/vesta-roomscape-v1/` (`PAGES_BASE=/another/path/ npm run build:pages` builds it
for another path). To look at it on this Mac first:

```
npx vite preview --outDir dist --base /vesta-roomscape-v1/
```

and open `http://127.0.0.1:4173/vesta-roomscape-v1/`. Search engines are asked not to index it, but it
is public: anyone with the link can open it, and this repo is public too.

**Publishing.** GitHub Actions rebuilds it and publishes it at
<https://yizyace.github.io/vesta-roomscape-v1/> on every push to `main` (`.github/workflows/pages.yml`):
the tests, `npm run build:pages`, then the upload, so it shows `data/` as of the last push. If a test or
the build fails, nothing is published and the last copy stays up. To publish again without a push, run
the Pages workflow from the repo's Actions tab. Once per repo, the Pages source must be GitHub Actions
(Settings, Pages, or `gh api -X POST repos/yizyace/vesta-roomscape-v1/pages -f build_type=workflow`).

The editor is unchanged: `npm run dev` still reads and writes `data/` on this Mac.

## Asking an agent

Start Claude Code from `~/work/vesta` as `claude --chrome`: it reads the stores' pages in your Chrome,
which it needs for adding products. Then ask in plain words, for example:

- `add this IKEA dresser: https://www.ikea.com/us/en/p/<slug>-60561248/`
- `add this Amazon chair: https://www.amazon.com/dp/B0FBGR4MM4`
- `find three kids desks under $150 for Maddie's room`
- `find a queen bed frame under 64 inches wide for the master bedroom, IKEA only`
- `lay out the master bedroom with the shortlisted bed and dressers`
- `pre-populate Maddie's room with a twin bed, a desk and a dresser`
- `show me the living room alternatives`
- `make the living room's C layout the staged one`
- `add a fourth layout for Maddie's room with the KURA bed`
- `what does the master bedroom cost as staged?`
- `the living room's far wall is 276 inches, update the measurements`
- `the stairs are 40 inches wide and you step off at the window end`
- `the stairs are 36 inches wide with a landing, and the apartment door is 32; record the delivery path`
- `start the planner`
- `we ordered the HEMNES dresser for the master bedroom`
- `that desk is 47 inches wide, not 42`

Paste the whole product link from your browser's address bar. The agent checks the catalog before it
opens a store page, says each fit in inches with the rule it used, and asks at most two questions. When
it lays out a room, it writes a new letter for an alternative and never overwrites A unless you ask,
moves anything that lands on the stairs, a heater or a door's swing before it reports, and gives each
layout's total. Its instructions are the `furniture-planner` skill (`.claude/skills/furniture-planner/`).

## Where the data lives

All of it is in `data/`, committed to git:

| Path | What it is |
|---|---|
| `rooms.csv` | The measurements as written on the sketches, and what is still unmeasured |
| `rooms.json` | The same rooms as the planner draws them |
| `catalog/taxonomy.json` | The categories and tags a product can have |
| `catalog/items/<id>.json` | One file per product, e.g. `ikea-60561248.json` or `amazon-B0FBGR4MM4.json` |
| `catalog/lists.json` | The kitchen's and the bathroom's lists of things to buy |
| `layouts/<room>/<letter>.json` | Each room's layouts: `a.json` is the staged pick, `b.json`, `c.json`, `d.json` the alternatives |
| `images/` | Product photos, small copies |
| `sources/` | The sketches the rooms are drawn from |
| `staging.md` | Every room's layouts with their pieces and totals, and the kitchen and bathroom lists (written by `scripts/staging_report.py`) |

The measurement notes (`measurements.md`), the fitting rules (`rules.md`: clearances, heaters, door
swings, Maddie's safety), the notes from each browsing session and the task summary did not move here;
they stay in Andrew's private vesta repo.

## Rules of the road

- **The agent never buys.** It doesn't add to a cart, sign in or pay anywhere. When you buy something,
  tell it ("we ordered …") and it marks the item ordered.
- **Dimensions come from the product's own page** (or your tape), never from a title or a guess. A
  product whose page shows none is listed but never placed.
- **Prices carry the date they were read.** A price from an earlier day is marked stale.
- **Nothing goes against a heater or into a door's or a closet's swing**, and nothing stands on the
  living room's stairs. The hatched window walls are treated as heater walls until someone looks.
- **Window and door positions are guesses** until they are measured, and so is the width of the
  stairs; the agent flags every placement that depends on one.
- **There are six rooms, and they stay six.** The kitchen and the bathroom get lists of things to buy,
  not layouts. A new measurement goes through the agent, which records it as you wrote it in
  `measurements.md`, `rooms.csv` and `rooms.json` together.
- **Product photos** are the one thing downloaded by script, from the stores' own image servers. Store
  pages are read only in your Chrome.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `check-node: Node … is outside ">=24.22.1 <25"` | `asdf install nodejs 24.22.1`, and run from inside `~/work/vesta-roomscape-v1` |
| `npm install` fails with `EBADENGINE` | The same: the wrong Node is active |
| The browser shows a blank page or another app | Open the printed URL in your own window (not the tab Claude controls) and reload |
| The URL isn't `:5173` | Another program has that port; use the URL `npm run dev` printed |
| A banner says `rooms.json` can't be read | Run `npm run validate`; it names the file and the problem. Ask an agent to fix it |
| An agent's change doesn't show | Click into the window (it reloads on focus), or reload the page |
| A piece won't go into the room | It has no dimensions; ask an agent to check its page or to record your tape measurement |
| A piece is red | It overlaps another piece or leaves the room: drag it or rotate it. A rug that shows red only leaves the room |
| A piece is amber | It stands on the stairs, on a heater, in a door's swing, in the 36" in front of a door or closet or in the walkway along the dining room's side open to the kitchen: move it off the shaded part |
| The page says the room has no variant B (or C…) | That letter was never saved, or Make staged swapped it with A: follow the link to A |
| The read-only copy doesn't show a change | It shows what was pushed to `main`, a minute or two after the push: reload it. If the Pages run in the repo's Actions tab failed, the last copy stays up until a push passes the tests |

How it is built, for whoever changes it: [`ARCHITECTURE.md`](ARCHITECTURE.md).
