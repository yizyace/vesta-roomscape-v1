// rooms.csv is the transcription of Andrew's sketches (measurements.md); rooms.json is what the
// planner draws. These tests hold the two to the same tape values, so an edit to one file that
// isn't carried to the other fails here.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toFeetInches } from "../shared/format.ts";
import { ROOM_IDS, RoomsSchema } from "../shared/schema.ts";
import type { Feature, Room, RoomsFile } from "../shared/schema.ts";

const DATA = new URL("../data/", import.meta.url);

// ---------------------------------------------------------------------------
// A small RFC 4180 reader. A quoted field may hold commas, newlines and doubled quotes. A quote
// inside an unquoted field is kept as is, since rooms.csv writes feet unquoted as 7'9".
// ---------------------------------------------------------------------------

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let fieldStart = true;
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (quoted) {
      if (c !== '"') {
        field += c;
      } else if (text.charAt(i + 1) === '"') {
        field += '"';
        i++;
      } else {
        quoted = false;
      }
    } else if (c === '"' && fieldStart) {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
      fieldStart = true;
      continue;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text.charAt(i + 1) === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      fieldStart = true;
      continue;
    } else {
      field += c;
    }
    fieldStart = false;
  }
  if (quoted) throw new Error("rooms.csv: unterminated quoted field");
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

const COLUMNS = ["room", "item", "wall_as_drawn", "inches", "feet_inches", "kind", "reads_agree", "flag", "note", "photo"] as const;
const KINDS = ["measured", "derived", "not-measured"];
type CsvRow = Record<(typeof COLUMNS)[number], string>;

function readRows(text: string): CsvRow[] {
  const [header, ...body] = parseCsv(text);
  if (header?.join(",") !== COLUMNS.join(",")) throw new Error(`rooms.csv: unexpected header ${JSON.stringify(header)}`);
  return body.map((fields, i) => {
    if (fields.length !== COLUMNS.length) {
      throw new Error(`rooms.csv line ${i + 2}: ${fields.length} fields, expected ${COLUMNS.length}`);
    }
    return Object.fromEntries(COLUMNS.map((c, j) => [c, fields[j]])) as CsvRow;
  });
}

const ROOMS = RoomsSchema.parse(JSON.parse(readFileSync(new URL("rooms.json", DATA), "utf8")));
const ROWS = readRows(readFileSync(new URL("rooms.csv", DATA), "utf8"));
const CSV_ROOM_IDS = [...new Set(ROWS.map((r) => r.room))];

// ---------------------------------------------------------------------------
// The comparison
// ---------------------------------------------------------------------------

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`missing ${what}`);
  return value;
}

const roomIn = (file: RoomsFile, id: string): Room => must(file.rooms.find((r) => r.id === id), `room "${id}" in rooms.json`);
const inches = (row: CsvRow): number => (row.inches === "" ? Number.NaN : Number(row.inches));
const ascending = (values: number[]): number[] => [...values].sort((a, b) => a - b);
const rowsOfKind = (kind: string): CsvRow[] => ROWS.filter((r) => r.kind === kind);

/** The tape values rooms.json claims for a room: its measured walls, and each feature value its `measured` lists. */
function jsonMeasured(room: Room): number[] {
  const walls = room.walls.filter((w) => w.kind === "measured").map((w) => w.length);
  const features = room.features.flatMap((f) => f.measured.map((key) => f[key] ?? Number.NaN));
  return ascending([...walls, ...features]);
}

function csvMeasured(rows: CsvRow[], roomId: string): number[] {
  return ascending(rows.filter((r) => r.room === roomId && r.kind === "measured").map(inches));
}

/** The values of `a` left over after matching each value of `b` once (multiset difference). */
function minus(a: number[], b: number[]): number[] {
  const unmatched = [...b];
  return a.filter((v) => {
    const i = unmatched.indexOf(v);
    if (i === -1) return true;
    unmatched.splice(i, 1);
    return false;
  });
}

/** null when both files hold the same multiset of measured values for the room. */
function measuredDrift(file: RoomsFile, rows: CsvRow[], roomId: string): string | null {
  const room = file.rooms.find((r) => r.id === roomId);
  if (!room) return `${roomId}: in rooms.csv but not in rooms.json`;
  const json = jsonMeasured(room);
  const csv = csvMeasured(rows, roomId);
  const jsonOnly = minus(json, csv);
  const csvOnly = minus(csv, json);
  if (jsonOnly.length === 0 && csvOnly.length === 0) return null;
  return `${roomId}: measured only in rooms.json [${jsonOnly.join(", ")}], only in rooms.csv [${csvOnly.join(", ")}]`;
}

/** null when the derived row's value is a derived wall of its room. */
function derivedProblem(file: RoomsFile, row: CsvRow): string | null {
  const room = file.rooms.find((r) => r.id === row.room);
  if (room?.walls.some((w) => w.kind === "derived" && w.length === inches(row))) return null;
  return `${row.room}: derived "${row.item}" (${row.inches}) is not a derived wall in rooms.json`;
}

/** csv walls are named as drawn ("right"); rooms.json may split one ("right-upper", "right-lower"). */
const onWall = (f: Feature, drawn: string): boolean => f.wall === drawn || f.wall.startsWith(`${drawn}-`);

/** null when the not-measured row is a room without walls, or one feature on its wall with nothing measured. */
function notMeasuredProblem(file: RoomsFile, row: CsvRow): string | null {
  const room = file.rooms.find((r) => r.id === row.room);
  if (!room) return `${row.room}: not in rooms.json`;
  if (room.walls.length === 0) return null;
  const matches = room.features.filter(
    (f) => onWall(f, row.wall_as_drawn) && [f.label, f.type].some((name) => name !== undefined && row.item.includes(name)),
  );
  const [only] = matches;
  if (!only || matches.length > 1) {
    return `${row.room}: not-measured "${row.item}" matches ${matches.length} features on wall "${row.wall_as_drawn}"`;
  }
  if (only.measured.length > 0) {
    return `${row.room}: not-measured "${row.item}" has measured [${only.measured.join(", ")}] in rooms.json`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("reading rooms.csv", () => {
  it("handles quoted commas, doubled quotes, quoted newlines, bare quotes and CRLF", () => {
    expect(parseCsv('a,"b, c","say ""hi""",7\'9"\r\n"two\nlines",,""\n')).toEqual([
      ["a", "b, c", 'say "hi"', `7'9"`],
      ["two\nlines", "", ""],
    ]);
  });

  it("reads every row with the ten columns, the six rooms and known kinds", () => {
    expect(ROWS.length).toBeGreaterThan(0);
    expect(new Set(CSV_ROOM_IDS)).toEqual(new Set(ROOM_IDS));
    expect(ROWS.filter((r) => !KINDS.includes(r.kind))).toEqual([]);
    const windowWall = ROWS.find((r) => r.room === "master-bedroom" && r.item === "window wall: corner to corner");
    expect(windowWall?.note).toBe('Hatched, with "heater" at its right end; the heater runs the whole wall (Andrew, 2026-10-24: "heater runs whole fall")');
  });

  it("writes feet_inches as toFeetInches(inches) on every row with a number", () => {
    const wrong = ROWS.filter((r) => r.inches !== "" || r.feet_inches !== "")
      .filter((r) => toFeetInches(inches(r)) !== r.feet_inches)
      .map((r) => `${r.room} "${r.item}": ${r.inches} gives ${toFeetInches(inches(r))}, the csv says ${r.feet_inches}`);
    expect(wrong).toEqual([]);
  });
});

describe("rooms.json holds the measured values of rooms.csv", () => {
  it.each(CSV_ROOM_IDS)("%s: the same measured values in both files", (id) => {
    expect(measuredDrift(ROOMS, ROWS, id)).toBeNull();
  });

  it("maddie-room gives 118, 87, 15, 35, 55, 108, 55 both ways", () => {
    const expected = ascending([118, 87, 15, 35, 55, 108, 55]);
    expect(jsonMeasured(roomIn(ROOMS, "maddie-room"))).toEqual(expected);
    expect(csvMeasured(ROWS, "maddie-room")).toEqual(expected);
  });

  it.each(rowsOfKind("derived"))('$room: derived "$item" ($inches) is a derived wall', (row) => {
    expect(derivedProblem(ROOMS, row)).toBeNull();
  });

  it.each(rowsOfKind("not-measured"))('$room: not-measured "$item" has nothing measured in rooms.json', (row) => {
    expect(notMeasuredProblem(ROOMS, row)).toBeNull();
  });
});

describe("the comparison catches drift", () => {
  it("Maddie's right-upper wall edited from 87 to 88 in rooms.json", () => {
    const drifted = structuredClone(ROOMS);
    const wall = must(roomIn(drifted, "maddie-room").walls.find((w) => w.name === "right-upper"), "right-upper");
    expect(wall.length).toBe(87);
    wall.length = 88;
    expect(measuredDrift(drifted, ROWS, "maddie-room")).toBe(
      "maddie-room: measured only in rooms.json [88], only in rooms.csv [87]",
    );
    expect(measuredDrift(ROOMS, ROWS, "maddie-room")).toBeNull();
  });

  it("Maddie's derived bottom wall edited from 103 to 104 in rooms.json", () => {
    const drifted = structuredClone(ROOMS);
    must(roomIn(drifted, "maddie-room").walls.find((w) => w.name === "bottom"), "bottom").length = 104;
    const row = must(rowsOfKind("derived").find((r) => r.room === "maddie-room" && r.inches === "103"), "the 103 row");
    expect(derivedProblem(drifted, row)).toBe('maddie-room: derived "bottom wall" (103) is not a derived wall in rooms.json');
  });

  it("the master walk-in closet marked measured in rooms.json", () => {
    const drifted = structuredClone(ROOMS);
    const closet = must(roomIn(drifted, "master-bedroom").features.find((f) => f.label === "walk-in closet"), "closet");
    closet.measured = ["length"];
    const row = must(rowsOfKind("not-measured").find((r) => r.room === "master-bedroom"), "the closet row");
    expect(notMeasuredProblem(drifted, row)).toBe('master-bedroom: not-measured "walk-in closet" has measured [length] in rooms.json');
    expect(measuredDrift(drifted, ROWS, "master-bedroom")).toBe("master-bedroom: measured only in rooms.json [42], only in rooms.csv []");
  });
});
