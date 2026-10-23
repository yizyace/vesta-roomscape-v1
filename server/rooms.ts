// rooms.json: the schema, plus the rule the schema cannot express: a measured room's walls must walk
// clockwise back to where they started.
import { isClosed, walkWalls } from "../shared/geometry.ts";
import { RoomsSchema, issuesToLines, type Room, type RoomsFile } from "../shared/schema.ts";
import { HttpError } from "./errors.ts";
import { roomsFile } from "./paths.ts";
import { readRequiredJson } from "./store.ts";

const round = (n: number): number => Math.round(n * 100) / 100;

/** One line per problem: walls that do not close, or that run counter-clockwise. Rooms without walls are skipped. */
export function roomGeometryProblems(rooms: RoomsFile): string[] {
  const problems: string[] = [];
  for (const room of rooms.rooms) {
    if (room.walls.length === 0) continue; // not measured yet
    const walk = walkWalls(room.walls);
    if (!isClosed(walk)) {
      problems.push(
        `room "${room.id}": the walls do not close; the walk ends at (${round(walk.closure.x)}, ${round(walk.closure.y)}), not back at (0, 0)`,
      );
    }
    if (!(walk.area > 0)) {
      problems.push(
        `room "${room.id}": the walls must run clockwise from the top-left corner (signed area ${round(walk.area)} is not positive)`,
      );
    }
  }
  return problems;
}

export async function loadRooms(dataDir: string): Promise<RoomsFile> {
  const parsed = RoomsSchema.safeParse(await readRequiredJson(roomsFile(dataDir), "rooms.json"));
  if (!parsed.success) throw new HttpError(500, "rooms.json does not match the schema", issuesToLines(parsed.error));
  const problems = roomGeometryProblems(parsed.data);
  if (problems.length > 0) {
    const more = problems.length > 1 ? ` (and ${problems.length - 1} more)` : "";
    throw new HttpError(500, `rooms.json: ${problems[0]}${more}`, problems);
  }
  return parsed.data;
}

export function roomIds(rooms: RoomsFile): string[] {
  return rooms.rooms.map((r) => r.id);
}

/** The room with this id in rooms.json, or a 404. */
export async function requireRoom(dataDir: string, id: string): Promise<Room> {
  const room = (await loadRooms(dataDir)).rooms.find((r) => r.id === id);
  if (!room) throw new HttpError(404, `no room "${id}" in rooms.json`);
  return room;
}
