// The room's title (with the open variant's letter and name, shown in view mode and on paper; a room
// without walls has no variants), its size, the warning flags, save state, undo, print and the
// edit/view switch; the variant switcher below. In the read-only copy: no save state and no undo, the
// switch reads Browse/View, and a note says it is a copy, with the date of the catalog's newest price.
import type { ReactNode } from "react";
import type { Collisions, KeepOutKind, Rect } from "../../shared/geometry.ts";
import { lengthLabel } from "../../shared/format.ts";
import type { Room } from "../../shared/schema.ts";
import { sketchUrl } from "../api.ts";
import { blockedCounts } from "../edit.ts";
import type { SaveState } from "../hooks/useLayout.ts";
import { routeHash } from "../route.ts";
import { variantTitle } from "../variants.ts";

type Props = {
  roomId: string;
  room: Room | undefined;
  variant: string;
  variantName: string;
  showVariant: boolean;
  box: Rect;
  measured: boolean;
  closed: boolean;
  view: boolean;
  /** The published read-only copy. */
  readOnly: boolean;
  /** The date of the catalog's newest price, for the read-only note. */
  pricesAsOf: string | null;
  saving: SaveState;
  collisions: Collisions;
  canUndo: boolean;
  onUndo: () => void;
  /** The VariantBar. */
  children: ReactNode;
};

const SAVE_TEXT: Record<SaveState, string> = { idle: "", saving: "Saving…", saved: "Saved", error: "Not saved" };

const pieces = (n: number) => (n === 1 ? "1 piece" : `${n} pieces`);

const BLOCKED_TEXT: Record<KeepOutKind, string> = {
  stairs: "on the stairs",
  heater: "on a heater",
  swing: "in a door's swing",
  front: "in front of a closet",
  opening: "blocking an opening",
};

const EDIT_HINT =
  'Drag a piece to move it · arrows nudge 1" (Shift 12") · R rotates · Delete removes · Esc deselects · ⌘Z undoes · ' +
  "double-click opens the product page · drop catalog rows on the plan";
const READ_ONLY_HINT = "Click a piece or a catalog row for its photos, price and size · double-click a piece opens its product page";

export function Toolbar({ roomId, room, variant, variantName, showVariant, box, measured, closed, view, readOnly, pricesAsOf, saving, collisions, canUndo, onUndo, children }: Props) {
  const blocked = blockedCounts(collisions.blocked);
  return (
    <div className="toolbar">
      <div className="toolbar-row">
        <h1>
          {room?.name ?? roomId}
          {showVariant && <span className="variant-title"> · {variantTitle(variant, variantName)}</span>}
        </h1>
        <span className="size">{measured ? `${lengthLabel(box.w)} × ${lengthLabel(box.h)}` : "not measured yet"}</span>
        {room?.sketch && (
          <a className="sketch-link" href={sketchUrl(room.sketch)} target="_blank" rel="noreferrer">
            Sketch ↗
          </a>
        )}
        {measured && !closed && <span className="flag warn">the walls do not close</span>}
        {collisions.overlapping.size > 0 && <span className="flag bad">{pieces(collisions.overlapping.size)} overlapping</span>}
        {collisions.outside.size > 0 && <span className="flag bad">{pieces(collisions.outside.size)} outside the room</span>}
        {(Object.keys(BLOCKED_TEXT) as KeepOutKind[]).map(
          (kind) =>
            blocked[kind] > 0 && (
              <span key={kind} className="flag warn">
                {pieces(blocked[kind])} {BLOCKED_TEXT[kind]}
              </span>
            ),
        )}
        <span className="spacer" />
        {readOnly && (
          <span className="read-only-note" title="Published from the planner's files; nothing here saves. Each price shows the date it was read.">
            Read-only copy{pricesAsOf && ` · prices as of ${pricesAsOf}`}
          </span>
        )}
        {!view && !readOnly && (
          <span className={`save-state ${saving}`} role="status">
            {SAVE_TEXT[saving]}
          </span>
        )}
        {!view && !readOnly && (
          <button type="button" onClick={onUndo} disabled={!canUndo} title="Undo the last change to the plan or the room list (⌘Z)">
            Undo
          </button>
        )}
        {view && (
          <button type="button" className="print" onClick={() => window.print()}>
            Print
          </button>
        )}
        <nav className="mode" aria-label="Mode">
          <a href={routeHash(roomId, variant, false)} aria-current={view ? undefined : "page"}>
            {readOnly ? "Browse" : "Edit"}
          </a>
          <a href={routeHash(roomId, variant, true)} aria-current={view ? "page" : undefined}>
            View
          </a>
        </nav>
      </div>
      {children}
      {!view && measured && <p className="hint">{readOnly ? READ_ONLY_HINT : EDIT_HINT}</p>}
    </div>
  );
}
