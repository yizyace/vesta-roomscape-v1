// A room with no walls yet (the kitchen) has no plan: under its note and sketch, the catalog items that
// list the room, each with its photo, status, price and product link, and their total (each item once).
// Rejected items are left out and counted.
import { money } from "../../shared/format.ts";
import type { Item, Room } from "../../shared/schema.ts";
import { hostOf } from "../edit.ts";
import { itemsTotal, unpricedNames, unpricedText } from "../totals.ts";
import { StatusChip } from "./Chips.tsx";
import { Thumb } from "./Thumb.tsx";

const names = new Intl.Collator("en", { sensitivity: "base", numeric: true });

type Props = { room: Room; items: Item[]; loading: boolean; onSelect?: (itemId: string) => void };

export function Essentials({ room, items, loading, onSelect }: Props) {
  const forRoom = items.filter((i) => (i.rooms as readonly string[]).includes(room.id));
  const kept = forRoom.filter((i) => i.status !== "rejected").sort((a, b) => names.compare(a.category, b.category) || names.compare(a.name, b.name));
  const rejected = forRoom.length - kept.length;
  const t = itemsTotal(kept);
  return (
    <section className="essentials" aria-label={`${room.name} essentials`}>
      <h2>{room.name} essentials</h2>
      {loading ? (
        <p className="muted">Loading the catalog…</p>
      ) : kept.length === 0 ? (
        <p className="muted">
          No catalog item lists the {room.name.toLowerCase()} yet (an item's <code>rooms</code> names it).
        </p>
      ) : (
        <>
          <ul className="essentials-list">
            {kept.map((item) => (
              <li key={item.id}>
                <Thumb item={item} />
                <div className="essential-text">
                  {onSelect ? (
                    <button type="button" className="link essential-name" onClick={() => onSelect(item.id)}>
                      {item.name}
                    </button>
                  ) : (
                    <span className="essential-name">{item.name}</span>
                  )}
                  <span className="essential-meta">
                    <StatusChip status={item.status} />
                    <span className="chip category">{item.category}</span>
                  </span>
                  <span className="essential-price">
                    {item.price ? (
                      <>
                        {money(item.price.amount)} <span className="muted">as of {item.price.asOf}</span>
                      </>
                    ) : (
                      <span className="muted">no price</span>
                    )}
                  </span>
                  {item.url && (
                    <a className="essential-link" href={item.url} target="_blank" rel="noreferrer">
                      {hostOf(item.url)} ↗
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="total">
            Total {money(t.total)} for {kept.length === 1 ? "1 item" : `${kept.length} items`}
            {t.unpriced.length > 0 && (
              <span className="muted">
                {" "}
                · {unpricedText(t.unpriced.length)}: {unpricedNames(t.unpriced)}
              </span>
            )}
          </p>
        </>
      )}
      {rejected > 0 && <p className="muted small">{rejected === 1 ? "1 rejected item is" : `${rejected} rejected items are`} not shown.</p>}
    </section>
  );
}
