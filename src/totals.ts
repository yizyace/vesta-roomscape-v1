// What a variant costs, by the contract's rule: every placement counts its item's price once, every
// room-list line (extra) its price × qty, and an item without a price (or missing from the catalog) is
// counted and named, never summed. Pure. Money is added in cents, so 3 × $19.99 is $59.97 exactly.
import type { Extra, Item, Placement } from "../shared/schema.ts";

type Priced = Pick<Item, "name" | "price">;

/** An item the total leaves out, once per item, with how many of it the variant uses. */
export type Unpriced = { itemId: string; name: string; count: number };

export type Totals = {
  /** Σ placed prices + Σ extras price × qty, in dollars. */
  total: number;
  /** The plan's share: one price per placement. */
  placed: number;
  /** The room list's share: price × qty per line. */
  listed: number;
  /** In first-use order: placements, then the room list. */
  unpriced: Unpriced[];
};

const cents = (amount: number): number => Math.round(amount * 100);

export function roomTotals(
  placements: readonly Pick<Placement, "itemId">[],
  extras: readonly Pick<Extra, "itemId" | "qty">[],
  itemsById: ReadonlyMap<string, Priced>,
): Totals {
  let placed = 0;
  let listed = 0;
  const unpriced = new Map<string, Unpriced>();
  const leaveOut = (itemId: string, count: number) => {
    const seen = unpriced.get(itemId);
    if (seen) seen.count += count;
    else unpriced.set(itemId, { itemId, name: itemsById.get(itemId)?.name ?? itemId, count });
  };
  for (const p of placements) {
    const price = itemsById.get(p.itemId)?.price;
    if (price) placed += cents(price.amount);
    else leaveOut(p.itemId, 1);
  }
  for (const e of extras) {
    const price = itemsById.get(e.itemId)?.price;
    if (price) listed += cents(price.amount) * e.qty;
    else leaveOut(e.itemId, e.qty);
  }
  return { total: (placed + listed) / 100, placed: placed / 100, listed: listed / 100, unpriced: [...unpriced.values()] };
}

/** A shopping list of distinct items (the kitchen essentials): each price once. */
export function itemsTotal(items: readonly (Priced & Pick<Item, "id">)[]): Totals {
  return roomTotals(
    items.map((i) => ({ itemId: i.id })),
    [],
    new Map(items.map((i) => [i.id, i])),
  );
}

/** One room-list line: its unit price and price × qty, both null when the item has no price. */
export function extraLine(extra: Pick<Extra, "qty">, item: Pick<Item, "price"> | undefined): { unit: number | null; subtotal: number | null } {
  const price = item?.price;
  if (!price) return { unit: null, subtotal: null };
  return { unit: price.amount, subtotal: (cents(price.amount) * extra.qty) / 100 };
}

/** `1 item without a price`, `3 items without a price`. */
export function unpricedText(n: number): string {
  return `${n} ${n === 1 ? "item" : "items"} without a price`;
}

/** `KALLAX shelf unit, VIHALS curtains ×2`: the unpriced items, named. */
export function unpricedNames(unpriced: readonly Unpriced[]): string {
  return unpriced.map((u) => (u.count > 1 ? `${u.name} ×${u.count}` : u.name)).join(", ");
}
