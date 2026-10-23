// The room list (a variant's extras: bedding, curtains, cushions, towels, …): one line per item with
// its photo, name, unit price × qty and subtotal; −/+ and remove when editable. And the variant's total
// by the contract's rule (src/totals.ts), with the items that have no price counted and named.
import { money } from "../../shared/format.ts";
import type { Extra, Item, Placement } from "../../shared/schema.ts";
import { hostOf } from "../edit.ts";
import { extraLine, roomTotals, unpricedNames, unpricedText } from "../totals.ts";
import { Thumb } from "./Thumb.tsx";

type ListProps = {
  extras: Extra[];
  itemsById: ReadonlyMap<string, Item>;
  /** −/+ and remove; absent: read-only (view mode, print). */
  edit?: { onQty: (itemId: string, qty: number) => void; onRemove: (itemId: string) => void };
  onSelectItem?: (itemId: string) => void;
  /** The product link on each line (view mode and paper). */
  links?: boolean;
};

export function RoomList({ extras, itemsById, edit, onSelectItem, links }: ListProps) {
  return (
    <ul className="room-list">
      {extras.map((e) => {
        const item = itemsById.get(e.itemId);
        const { unit, subtotal } = extraLine(e, item);
        const name = item?.name ?? e.itemId;
        return (
          <li key={e.itemId} className="extra">
            <Thumb item={item} size="small" />
            <div className="extra-name">
              {onSelectItem && item ? (
                <button type="button" className="link" onClick={() => onSelectItem(e.itemId)} title="Show its photos, price and product page">
                  {name}
                </button>
              ) : (
                <span className="name">{name}</span>
              )}
              {!item && <span className="muted small"> not in the catalog</span>}
              {e.note && <span className="extra-note muted small">{e.note}</span>}
              {links && item?.url && (
                <a className="extra-link small" href={item.url} target="_blank" rel="noreferrer">
                  {hostOf(item.url)} ↗
                </a>
              )}
            </div>
            {edit && (
              <button
                type="button"
                className="remove"
                onClick={() => edit.onRemove(e.itemId)}
                title="Remove from the room list"
                aria-label={`Remove ${name} from the room list`}
              >
                ×
              </button>
            )}
            <div className="extra-qty">
              {unit !== null ? money(unit) : <span className="muted">no price</span>}
              <span className="times" aria-hidden="true">
                ×
              </span>
              {edit ? (
                <span className="stepper">
                  <button type="button" onClick={() => edit.onQty(e.itemId, e.qty - 1)} disabled={e.qty <= 1} aria-label={`One fewer ${name}`}>
                    −
                  </button>
                  <span className="qty" aria-label={`${e.qty} on the list`}>
                    {e.qty}
                  </span>
                  <button type="button" onClick={() => edit.onQty(e.itemId, e.qty + 1)} aria-label={`One more ${name}`}>
                    +
                  </button>
                </span>
              ) : (
                <span className="qty">{e.qty}</span>
              )}
            </div>
            <span className="extra-subtotal">{subtotal !== null ? money(subtotal) : "—"}</span>
          </li>
        );
      })}
    </ul>
  );
}

type TotalProps = {
  placements: readonly Pick<Placement, "itemId">[];
  extras: readonly Pick<Extra, "itemId" | "qty">[];
  itemsById: ReadonlyMap<string, Item>;
};

/** The plan's and the room list's shares, the total, and "n items without a price: …". */
export function TotalBlock({ placements, extras, itemsById }: TotalProps) {
  const t = roomTotals(placements, extras, itemsById);
  return (
    <div className="totals">
      <dl>
        <dt>On the plan ({placements.length})</dt>
        <dd>{money(t.placed)}</dd>
        <dt>Room list ({extras.reduce((n, e) => n + e.qty, 0)})</dt>
        <dd>{money(t.listed)}</dd>
        <dt className="grand">Total</dt>
        <dd className="grand">{money(t.total)}</dd>
      </dl>
      {t.unpriced.length > 0 && (
        <p className="unpriced">
          {unpricedText(t.unpriced.length)}: <span className="muted">{unpricedNames(t.unpriced)}</span>
        </p>
      )}
    </div>
  );
}
