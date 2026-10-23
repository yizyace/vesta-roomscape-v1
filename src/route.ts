// The route lives in the hash: `#/<room>` (variant a, the staged pick), `#/<room>/<variant>`, and either
// one with `/view` appended for viewing and printing. Pure, so tests/route.test.ts covers it.
import { ROOM_IDS } from "../shared/schema.ts";
import type { RoomId } from "../shared/schema.ts";

export type Route = { roomId: RoomId; variant: string; view: boolean };

export const DEFAULT_ROOM: RoomId = "living-room";
/** Variant a is the staged pick; b, c, d, … are the alternatives. */
export const STAGED = "a";

const VARIANT_RE = /^[a-z][a-z0-9-]*$/;

const isRoomId = (id: string): id is RoomId => (ROOM_IDS as readonly string[]).includes(id);
/** A kebab-case slug other than "view", which the routes reserve. */
export const isVariantId = (id: string): boolean => VARIANT_RE.test(id) && id !== "view";

/** `#/living-room`, `#/living-room/b`, `#/living-room/view`, `#/living-room/b/view`. */
export function routeHash(roomId: string, variant: string = STAGED, view = false): string {
  return `#/${roomId}${variant === STAGED ? "" : `/${variant}`}${view ? "/view" : ""}`;
}

function parts(hash: string): string[] | null {
  const m = /^#\/(.*?)\/?$/.exec(hash);
  return m ? (m[1] ?? "").split("/") : null;
}

const wantsView = (segments: string[]): boolean => segments.length > 1 && segments[segments.length - 1] === "view";

export function parseHash(hash: string): Route | null {
  const segments = parts(hash);
  if (!segments) return null;
  const view = wantsView(segments);
  const [roomId = "", variant = STAGED, ...rest] = view ? segments.slice(0, -1) : segments;
  if (rest.length > 0 || !isRoomId(roomId) || !isVariantId(variant)) return null;
  return { roomId, variant, view };
}

/** Where a hash that does not parse goes: its room's variant a when the room is real, else the living room; view mode kept. */
export function fallbackRoute(hash: string): Route {
  const segments = parts(hash) ?? [];
  const first = segments[0] ?? "";
  return { roomId: isRoomId(first) ? first : DEFAULT_ROOM, variant: STAGED, view: wantsView(segments) };
}
