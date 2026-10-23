// Under the plan in view mode and on paper, for the open variant: the numbered pieces (every layer,
// numbered as on the plan) with size, price and product link, the room list with qty and subtotals, and
// the total by the contract's rule.
import { dimensionsText, money } from "../../shared/format.ts";
import type { Extra, Item, Layer, Placement, Room } from "../../shared/schema.ts";
import { hostOf } from "../edit.ts";
import { RoomList, TotalBlock } from "./RoomList.tsx";

type Props = {
  room: Room;
  placements: Placement[];
  extras: Extra[];
  itemsById: ReadonlyMap<string, Item>;
  notes: string;
  /** Whether the room is drawn: the grid note and the "nothing placed" line only make sense then. */
  measured: boolean;
};

const LAYER_TAG: Record<Layer, string | null> = { floor: null, rug: "rug", top: "on top" };

export function Legend({ room, placements, extras, itemsById, notes, measured }: Props) {
  return (
    <section className="legend" aria-label="Legend">
      {placements.length === 0 ? (
        measured && <p className="muted">Nothing is placed in the {room.name.toLowerCase()} yet.</p>
      ) : (
        <ol className="legend-list">
          {placements.map((p, i) => {
            const item = itemsById.get(p.itemId);
            const tag = LAYER_TAG[p.layer];
            return (
              <li key={p.id}>
                <span className="num">{i + 1}</span>
                <span className="legend-name" title={item?.name}>
                  {item?.name ?? p.itemId}
                </span>
                <span className="legend-dims">
                  {item ? dimensionsText(item.dimensions) : "not in the catalog"}
                  {tag && <span className="chip layer">{tag}</span>}
                </span>
                <span className="legend-price">
                  {item?.price ? (
                    <>
                      {money(item.price.amount)} <span className="muted">as of {item.price.asOf}</span>
                    </>
                  ) : (
                    <span className="muted">no price</span>
                  )}
                </span>
                {item?.url && (
                  <a className="legend-link" href={item.url} target="_blank" rel="noreferrer">
                    {hostOf(item.url)} ↗
                  </a>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {extras.length > 0 && (
        <>
          <h3 className="legend-heading">Room list</h3>
          <RoomList extras={extras} itemsById={itemsById} links />
        </>
      )}
      {(placements.length > 0 || extras.length > 0) && <TotalBlock placements={placements} extras={extras} itemsById={itemsById} />}
      {notes && <p className="pre layout-notes">{notes}</p>}
      {room.notes.length > 0 && (
        <ul className="room-notes muted">
          {room.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
      {measured && <p className="muted small">Grid squares are 1 ft. Dashed or “≈” means not measured yet.</p>}
    </section>
  );
}
