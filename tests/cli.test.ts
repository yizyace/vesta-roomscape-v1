// Spawns `node server/cli.ts` from the repo root with the Node running these tests (the
// pinned one), so passing here also proves Node strips the types without a build step.
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { toJsonText } from "../shared/schema.ts";
import { APP_DIR, DESK_ID, NO_DIMS_ID, mkTempDataDir, plantItem, plantLayout, readFixtureItem, type TempDataDir } from "./helpers.ts";

type Run = { code: number; stdout: string; stderr: string };

let data: TempDataDir;

beforeEach(async () => {
  data = await mkTempDataDir();
});

afterEach(() => data.cleanup());

function cli(...args: string[]): Promise<Run> {
  // npm_lifecycle_event is unset so relative paths resolve against the cwd, as when run by hand.
  const env = { ...process.env, FURNITURE_DATA_DIR: data.dir, npm_lifecycle_event: undefined };
  return new Promise((resolve) => {
    execFile(process.execPath, ["server/cli.ts", ...args], { cwd: APP_DIR, env }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === "number" ? err.code : -1) : 0, stdout, stderr });
    });
  });
}

async function writeInput(name: string, value: unknown): Promise<string> {
  const file = path.join(data.dir, "inputs", name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value));
  return file;
}

const lines = (text: string) => text.split("\n").filter(Boolean);
/** The messages of the WARN lines validate printed for one file. */
const warnings = (stdout: string, file: string) =>
  lines(stdout).filter((l) => l.startsWith(`WARN ${file}: `)).map((l) => l.slice(`WARN ${file}: `.length));
const readLayout = async (room: string, variant: string) => JSON.parse(await fs.readFile(path.join(data.dir, "layouts", room, `${variant}.json`), "utf8"));

describe("cli", { timeout: 30_000 }, () => {
  it("validate prints OK for every file and exits 0 on good data", async () => {
    const r = await cli("validate");
    expect(r.code).toBe(0);
    expect(lines(r.stdout).slice(0, -1)).toEqual([
      "OK rooms.json",
      "OK catalog/taxonomy.json",
      `OK catalog/items/${DESK_ID}.json`,
      `OK catalog/items/${NO_DIMS_ID}.json`,
      "OK layouts/maddie-room/a.json",
    ]);
    expect(lines(r.stdout).at(-1)).toMatch(/^5 files checked in .*: 0 error\(s\), 0 warning\(s\)$/);
  });

  it("validate exits 1 with ERROR lines once a broken item file is planted", async () => {
    await fs.writeFile(path.join(data.dir, "catalog/items/amazon-BROKEN.json"), JSON.stringify({ id: "amazon-BROKEN", vendor: "amazon" }));
    const r = await cli("validate");
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/^ERROR catalog\/items\/amazon-BROKEN\.json: name: /m);
    expect(r.stdout).toContain(`OK catalog/items/${DESK_ID}.json`);
  });

  it("validate warns about overlapping and outside placements but exits 0", async () => {
    await plantLayout(data.dir, "maddie-room", "a", {
      room: "maddie-room",
      variant: "a",
      placements: [
        { id: "desk", itemId: DESK_ID, x: 6, y: 0 },
        { id: "desk-2", itemId: DESK_ID, x: 10, y: 5 },
        { id: "desk-3", itemId: DESK_ID, x: 100, y: 100 }, // in the notch at the bottom right
      ],
    });
    const r = await cli("validate");
    expect(r.code).toBe(0);
    expect(warnings(r.stdout, "layouts/maddie-room/a.json")).toEqual(["desk overlaps desk-2", "desk-3 is outside the room"]);
    expect(lines(r.stdout).at(-1)).toMatch(/: 0 error\(s\), 2 warning\(s\)$/);
  });

  it("validate warns about floor pieces on the stairs, the heater or in a swing, and not about a rug or a lamp on top", async () => {
    // Positions from the live rooms.json: the living room's stairs are a 36" band along its whole left
    // wall; Maddie's heater is a 6" strip along the upper right wall (x 112-118), her door swings
    // through the 30" square in the bottom-left corner and the closet's double doors through x 40-95
    // above the bottom wall.
    const sofa = await plantItem(data.dir, "amazon-TESTSOFA01", { name: "Test sofa", category: "sofa", dimensions: { w: 84, d: 36 } });
    const rug = await plantItem(data.dir, "amazon-TESTRUG001", { name: "Test rug", category: "rug", dimensions: { w: 96, d: 60 } });
    const lamp = await plantItem(data.dir, "amazon-TESTLAMP01", { name: "Test lamp", category: "lamp", dimensions: { w: 10, d: 10 } });
    await plantLayout(data.dir, "living-room", "b", {
      room: "living-room",
      variant: "b",
      placements: [
        { id: "sofa-stairs", itemId: sofa, x: 0, y: 60, rotation: 270 },
        { id: "rug", itemId: rug, x: 100, y: 80, layer: "rug" },
        { id: "sofa", itemId: sofa, x: 106, y: 100 },
        { id: "lamp", itemId: lamp, x: 110, y: 105, layer: "top" },
      ],
    });
    await plantLayout(data.dir, "maddie-room", "b", {
      room: "maddie-room",
      variant: "b",
      placements: [
        { id: "desk-door", itemId: DESK_ID, x: 2, y: 100 },
        { id: "desk-heater", itemId: DESK_ID, x: 93, y: 10 },
        { id: "desk-closet", itemId: DESK_ID, x: 45, y: 100 }, // in both leaves' squares: one warning
      ],
    });
    const r = await cli("validate");
    expect(r.code).toBe(0);
    expect(warnings(r.stdout, "layouts/living-room/b.json")).toEqual(["sofa-stairs is on the stairs"]);
    expect(warnings(r.stdout, "layouts/maddie-room/b.json")).toEqual([
      "desk-door is in the door's swing",
      "desk-door is in front of the door",
      "desk-heater is on the heater",
      "desk-closet is in the closet's swing",
      "desk-closet is in front of the closet",
    ]);
  });

  it("validate warns about a floor piece in the walkway along the dining room's open side", async () => {
    // The live rooms.json: the dining room's whole left side is open to the kitchen (F-42), so the
    // walkway is x 0-30 along it.
    await plantLayout(data.dir, "dining-room", "b", {
      room: "dining-room",
      variant: "b",
      placements: [
        { id: "desk-open-side", itemId: DESK_ID, x: 0, y: 40, rotation: 270 },
        { id: "desk-clear", itemId: DESK_ID, x: 60, y: 40 },
      ],
    });
    const r = await cli("validate");
    expect(r.code).toBe(0);
    expect(warnings(r.stdout, "layouts/dining-room/b.json")).toEqual(["desk-open-side blocks the opening to the kitchen"]);
  });

  it("validate lets a chair stand in an L-desk's notch, and flags one on its return", async () => {
    // The master bedroom's middle (x 50-130, y 20-80) is clear of its doors, closet and heater.
    const lDesk = await plantItem(data.dir, "amazon-TESTLDESK1", {
      name: "Test L-desk",
      category: "desk",
      dimensions: { w: 80, d: 60, notch: { w: 52.5, d: 30, side: "right" } },
    });
    const chair = await plantItem(data.dir, "amazon-TESTCHAIR1", { name: "Test chair", category: "chair", dimensions: { w: 24, d: 24 } });
    await plantLayout(data.dir, "master-bedroom", "b", {
      room: "master-bedroom",
      variant: "b",
      placements: [
        { id: "l-desk", itemId: lDesk, x: 50, y: 20 },
        { id: "chair-notch", itemId: chair, x: 90, y: 52, rotation: 180 },
        { id: "chair-return", itemId: chair, x: 60, y: 55, rotation: 180 },
      ],
    });
    const r = await cli("validate");
    expect(r.code).toBe(0);
    expect(warnings(r.stdout, "layouts/master-bedroom/b.json")).toEqual(["l-desk overlaps chair-return"]);
  });

  it("layout set refuses a flat item (no depth) anywhere but the top layer", async () => {
    const poster = await plantItem(data.dir, "amazon-TESTPOSTR1", { name: "Test poster", category: "decor", dimensions: { w: 22, h: 22 } });
    const file = path.join(data.dir, "flat.json");
    await fs.writeFile(file, toJsonText({ placements: [{ id: "art-1", itemId: poster, x: 10, y: 0, rotation: 0 }] }));
    const refused = await cli("layout", "set", "maddie-room", file, "--variant", "c");
    expect(refused.code).toBe(1);
    expect(refused.stderr).toMatch(/placements\.0\.layer: "amazon-TESTPOSTR1" is flat/);
    await fs.writeFile(file, toJsonText({ placements: [{ id: "art-1", itemId: poster, x: 10, y: 0, rotation: 0, layer: "top" }] }));
    expect((await cli("layout", "set", "maddie-room", file, "--variant", "c")).code).toBe(0);
  });

  it("validate checks layouts/<room>/<variant>.json names and refuses a flat layouts/<room>.json", async () => {
    const fixture = await readLayout("maddie-room", "a");
    await fs.writeFile(path.join(data.dir, "layouts/back-bedroom.json"), toJsonText({ ...fixture, room: "back-bedroom", placements: [] }));
    await plantLayout(data.dir, "maddie-room", "c", { ...fixture, variant: "b" });
    await plantLayout(data.dir, "kitchen", "view", { room: "kitchen", variant: "view" });
    await plantLayout(data.dir, "kitchen", "b", { room: "dining-room", variant: "b" });
    await plantLayout(data.dir, "master-bedroom", "b", { room: "master-bedroom", variant: "b", extras: [{ itemId: "ikea-00000000" }] });
    const r = await cli("validate");
    expect(r.code).toBe(1);
    expect(lines(r.stdout).filter((l) => l.startsWith("ERROR "))).toEqual([
      "ERROR layouts/back-bedroom.json: layouts are stored one file per variant now; move it to layouts/back-bedroom/a.json",
      'ERROR layouts/kitchen/b.json: room: "dining-room" does not match the directory (expected layouts/dining-room/b.json)',
      'ERROR layouts/kitchen/view.json: file name: "view" is reserved (#/<room>/view is the print view); use another variant id',
      'ERROR layouts/maddie-room/c.json: variant: "b" does not match the file name (expected layouts/maddie-room/b.json)',
      'ERROR layouts/master-bedroom/b.json: extras.0.itemId: no catalog item "ikea-00000000"',
    ]);
    expect(r.stdout).toContain("OK layouts/maddie-room/a.json");
  });

  it("catalog add writes the item, refuses to overwrite it without --update, and overwrites with it", async () => {
    const item = { ...(await readFixtureItem(DESK_ID)), id: "amazon-B0NEWDESK1", url: "https://www.amazon.com/dp/B0NEWDESK1" };
    const input = await writeInput("item.json", item);
    const target = path.join(data.dir, "catalog/items/amazon-B0NEWDESK1.json");

    const added = await cli("catalog", "add", input);
    expect(added.code).toBe(0);
    expect(added.stdout.trim()).toBe(target);
    expect(await fs.readFile(target, "utf8")).toBe(toJsonText(item));

    const again = await cli("catalog", "add", input);
    expect(again.code).toBe(1);
    expect(again.stderr).toMatch(/already exists \(use --update/);

    await writeInput("item.json", { ...item, status: "shortlisted" });
    const updated = await cli("catalog", "add", input, "--update");
    expect(updated.code).toBe(0);
    expect(JSON.parse(await fs.readFile(target, "utf8")).status).toBe("shortlisted");
  });

  it("catalog add exits 1 with one line per issue for an invalid item", async () => {
    const input = await writeInput("bad.json", { ...(await readFixtureItem(DESK_ID)), category: "spaceship", tags: ["zzz"] });
    const r = await cli("catalog", "add", input);
    expect(r.code).toBe(1);
    expect(lines(r.stderr)).toEqual([
      `catalog add: item "${DESK_ID}" uses a category, tag or room the data does not define`,
      '  category: "spaceship" is not a category in catalog/taxonomy.json',
      '  tags.0: "zzz" is not a tag in catalog/taxonomy.json',
    ]);
    const missing = await cli("catalog", "add", path.join(data.dir, "nope.json"));
    expect(missing.code).toBe(1);
    expect(missing.stderr).toMatch(/nope\.json does not exist/);
  });

  it("layout set saves a variant: --variant, else the file's, else a; --name, else the file's, else the saved one", async () => {
    const placements = [{ id: "desk", itemId: DESK_ID, x: 50, y: 0, rotation: 0, layer: "floor" }];
    const input = await writeInput("layout.json", { placements });
    const r = await cli("layout", "set", "back-bedroom", input);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe(path.join(data.dir, "layouts/back-bedroom/a.json"));
    expect(await readLayout("back-bedroom", "a")).toEqual({
      room: "back-bedroom", variant: "a", name: "", updatedAt: expect.any(String), notes: "", placements, extras: [],
    });

    const b = await cli("layout", "set", "back-bedroom", input, "--variant", "b", "--name", "Desk by the window");
    expect(b.code).toBe(0);
    expect(b.stdout.trim()).toBe(path.join(data.dir, "layouts/back-bedroom/b.json"));
    const savedB = await readLayout("back-bedroom", "b");
    expect(savedB).toMatchObject({ room: "back-bedroom", variant: "b", name: "Desk by the window", placements });

    const fromFile = await cli("layout", "set", "back-bedroom", await writeInput("c.json", { variant: "c", name: "From the file", placements }));
    expect(fromFile.code).toBe(0);
    expect(await readLayout("back-bedroom", "c")).toMatchObject({ variant: "c", name: "From the file" });

    // A whole saved layout copied to another variant: the flag wins over the file's variant.
    const copy = await cli("layout", "set", "back-bedroom", await writeInput("whole.json", { ...savedB, notes: "moved" }), "--variant=d");
    expect(copy.code).toBe(0);
    expect(await readLayout("back-bedroom", "d")).toMatchObject({ variant: "d", name: "Desk by the window", notes: "moved", placements });

    // No --name and no name in the file: the saved name stays.
    const kept = await cli("layout", "set", "back-bedroom", await writeInput("empty.json", { placements: [] }), "--variant", "b");
    expect(kept.code).toBe(0);
    expect(await readLayout("back-bedroom", "b")).toMatchObject({ variant: "b", name: "Desk by the window", placements: [] });
  });

  it("layout set refuses another room's layout, a reserved or malformed variant and items it cannot use", async () => {
    const input = await writeInput("layout.json", { placements: [] });
    const wrongRoom = await cli("layout", "set", "kitchen", await writeInput("whole.json", { room: "back-bedroom", placements: [] }));
    expect(wrongRoom.code).toBe(1);
    expect(wrongRoom.stderr).toMatch(/is the layout for "back-bedroom", not "kitchen"/);

    const view = await cli("layout", "set", "maddie-room", input, "--variant", "view");
    expect(view.code).toBe(1);
    expect(view.stderr).toMatch(/^layout set: "view" is reserved/);
    const upper = await cli("layout", "set", "maddie-room", await writeInput("upper.json", { variant: "B", placements: [] }));
    expect(upper.code).toBe(1);
    expect(upper.stderr).toMatch(/^layout set: "B" is not a variant id/);

    const unplaceable = await cli("layout", "set", "maddie-room", await writeInput("nodims.json", { placements: [{ id: "x", itemId: NO_DIMS_ID, x: 0, y: 0 }] }));
    expect(unplaceable.code).toBe(1);
    expect(unplaceable.stderr).toContain("has no dimensions");
    const unknownExtra = await cli("layout", "set", "maddie-room", await writeInput("extra.json", { placements: [], extras: [{ itemId: "ikea-00000000" }] }));
    expect(unknownExtra.code).toBe(1);
    expect(lines(unknownExtra.stderr)).toContain('  extras.0.itemId: no catalog item "ikea-00000000"');
    await expect(fs.readdir(path.join(data.dir, "layouts/kitchen"))).rejects.toThrow();
    expect(await fs.readdir(path.join(data.dir, "layouts/maddie-room"))).toEqual(["a.json"]);
  });

  it("layout list prints one line per saved variant, for one room or all of them", async () => {
    const fixtureLine = "maddie-room/a  Desk on the top wall  (1 placed, 1 extras)";
    expect(lines((await cli("layout", "list")).stdout)).toEqual([fixtureLine]);

    const bed = await writeInput("b.json", { placements: [{ id: "desk", itemId: DESK_ID, x: 0, y: 30 }, { id: "desk-2", itemId: DESK_ID, x: 60, y: 30 }] });
    expect((await cli("layout", "set", "maddie-room", bed, "--variant", "b", "--name", "Two desks")).code).toBe(0);
    expect((await cli("layout", "set", "back-bedroom", await writeInput("a.json", { placements: [] }))).code).toBe(0);

    const all = await cli("layout", "list");
    expect(all.code).toBe(0);
    expect(lines(all.stdout)).toEqual(["back-bedroom/a    (0 placed, 0 extras)", fixtureLine, "maddie-room/b  Two desks  (2 placed, 0 extras)"]);
    const one = await cli("layout", "list", "maddie-room");
    expect(lines(one.stdout)).toEqual([fixtureLine, "maddie-room/b  Two desks  (2 placed, 0 extras)"]);

    const none = await cli("layout", "list", "kitchen");
    expect([none.code, none.stdout]).toEqual([0, ""]);
    expect(none.stderr).toMatch(/no layouts saved for "kitchen"/);
    const unknown = await cli("layout", "list", "garage");
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toMatch(/^layout list: no room "garage"/);
  });

  it("layout promote swaps a variant with a and prints the room's variants", async () => {
    const input = await writeInput("b.json", { name: "Desk lower down", placements: [{ id: "desk", itemId: DESK_ID, x: 6, y: 40 }] });
    expect((await cli("layout", "set", "maddie-room", input, "--variant", "b")).code).toBe(0);
    const before = { a: await readLayout("maddie-room", "a"), b: await readLayout("maddie-room", "b") };

    const r = await cli("layout", "promote", "maddie-room", "b");
    expect(r.code).toBe(0);
    expect(lines(r.stdout)).toEqual([
      "maddie-room/a  Desk lower down  (1 placed, 0 extras)",
      "maddie-room/b  Desk on the top wall  (1 placed, 1 extras)",
    ]);
    expect(await readLayout("maddie-room", "a")).toEqual({ ...before.b, variant: "a" });
    expect(await readLayout("maddie-room", "b")).toEqual({ ...before.a, variant: "b" });

    const noop = await cli("layout", "promote", "maddie-room", "a");
    expect(noop.code).toBe(0);
    expect(noop.stderr).toMatch(/already the staged pick/);
    expect(await readLayout("maddie-room", "a")).toEqual({ ...before.b, variant: "a" });

    const missing = await cli("layout", "promote", "maddie-room", "c");
    expect(missing.code).toBe(1);
    expect(missing.stderr).toMatch(/^layout promote: "maddie-room" has no variant "c"/);
  });

  it("catalog image refuses a host off the allowlist without fetching", async () => {
    const r = await cli("catalog", "image", DESK_ID, "https://ikea.com.evil.com/x.jpg");
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^catalog image: images are only downloaded over https from ikea\.com/);
  });

  it("prints usage and exits 2 for missing, unknown or extra arguments; 0 for --help", async () => {
    for (const args of [
      [],
      ["bogus"],
      ["validate", "extra"],
      ["catalog", "add"],
      ["catalog", "add", "x.json", "--force"],
      ["catalog", "image", DESK_ID],
      ["layout", "set", "maddie-room"],
      ["layout", "set", "maddie-room", "x.json", "--variant"],
      ["layout", "set", "maddie-room", "x.json", "--room", "kitchen"],
      ["layout", "list", "maddie-room", "a"],
      ["layout", "promote", "maddie-room"],
    ]) {
      const r = await cli(...args);
      expect(r.code, args.join(" ")).toBe(2);
      expect(r.stderr).toMatch(/^usage:/);
    }
    const help = await cli("--help");
    expect(help.code).toBe(0);
    expect(help.stdout).toMatch(/^usage:/);
    expect(help.stdout).toContain("layout set <room> <file.json> [--variant <id>] [--name <text>]");
  });
});
