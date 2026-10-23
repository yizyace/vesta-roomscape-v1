import type { Room } from "../../shared/schema.ts";
import { routeHash } from "../route.ts";

/** One tab per room in rooms.json, in file order; switching opens the room's variant a and keeps the mode. */
export function RoomTabs({ rooms, current, view }: { rooms: Room[]; current: string; view: boolean }) {
  return (
    <nav className="tabs" aria-label="Rooms">
      {rooms.map((r) => (
        <a
          key={r.id}
          href={routeHash(r.id, "a", view)}
          className={r.id === current ? "tab active" : "tab"}
          aria-current={r.id === current ? "page" : undefined}
        >
          {r.name}
          {r.walls.length === 0 && <span className="tab-note">not measured</span>}
        </a>
      ))}
    </nav>
  );
}
