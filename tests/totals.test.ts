import { describe, expect, it } from "vitest";
import type { Item } from "../shared/schema.ts";
import { extraLine, itemsTotal, roomTotals, unpricedNames, unpricedText } from "../src/totals.ts";

type Priced = Pick<Item, "id" | "name" | "price">;
const priced = (id: string, amount: number | null, name = id): Priced => ({
  id,
  name,
  price: amount === null ? null : { amount, currency: "USD", asOf: "2026-10-22" },
});

const sofa = priced("ikea-sofa", 599);
const rug = priced("ikea-rug", 129.99);
const curtain = priced("ikea-curtain", 19.99, "VIHALS curtains");
const art = priced("ikea-art", null, "BILD poster");
const pillow = priced("ikea-pillow", null, "GURLI cushion cover");
const byId = new Map([sofa, rug, curtain, art, pillow].map((i) => [i.id, i]));

describe("roomTotals", () => {
  it("adds one price per placement and price × qty per room-list line", () => {
    const t = roomTotals(
      [{ itemId: "ikea-sofa" }, { itemId: "ikea-rug" }],
      [{ itemId: "ikea-curtain", qty: 3 }],
      byId,
    );
    expect(t.placed).toBe(728.99);
    expect(t.listed).toBe(59.97); // in cents: 3 × 19.99 is not 59.970000000000006
    expect(t.total).toBe(788.96);
    expect(t.unpriced).toEqual([]);
  });

  it("counts a piece placed twice twice", () => {
    expect(roomTotals([{ itemId: "ikea-sofa" }, { itemId: "ikea-sofa" }], [], byId).total).toBe(1198);
  });

  it("names the items without a price instead of summing them, once per item with how many are used", () => {
    const t = roomTotals(
      [{ itemId: "ikea-art" }, { itemId: "ikea-sofa" }, { itemId: "ikea-art" }],
      [{ itemId: "ikea-pillow", qty: 4 }, { itemId: "ikea-curtain", qty: 1 }],
      byId,
    );
    expect(t.total).toBe(618.99);
    expect(t.unpriced).toEqual([
      { itemId: "ikea-art", name: "BILD poster", count: 2 },
      { itemId: "ikea-pillow", name: "GURLI cushion cover", count: 4 },
    ]);
  });

  it("names an item missing from the catalog by its id", () => {
    const t = roomTotals([{ itemId: "ikea-gone" }], [{ itemId: "amazon-gone", qty: 2 }], byId);
    expect(t.total).toBe(0);
    expect(t.unpriced).toEqual([
      { itemId: "ikea-gone", name: "ikea-gone", count: 1 },
      { itemId: "amazon-gone", name: "amazon-gone", count: 2 },
    ]);
  });

  it("is zero for an empty variant", () => {
    expect(roomTotals([], [], byId)).toEqual({ total: 0, placed: 0, listed: 0, unpriced: [] });
  });
});

describe("itemsTotal", () => {
  it("adds each item's price once and names the unpriced ones", () => {
    const t = itemsTotal([sofa, curtain, art]);
    expect(t.total).toBe(618.99);
    expect(t.unpriced.map((u) => u.name)).toEqual(["BILD poster"]);
  });
});

describe("extraLine", () => {
  it("gives the unit price and the subtotal, or nulls without a price", () => {
    expect(extraLine({ qty: 3 }, curtain)).toEqual({ unit: 19.99, subtotal: 59.97 });
    expect(extraLine({ qty: 2 }, pillow)).toEqual({ unit: null, subtotal: null });
    expect(extraLine({ qty: 2 }, undefined)).toEqual({ unit: null, subtotal: null });
  });
});

describe("unpriced text", () => {
  it("says how many and names them", () => {
    expect(unpricedText(1)).toBe("1 item without a price");
    expect(unpricedText(3)).toBe("3 items without a price");
    expect(
      unpricedNames([
        { itemId: "a", name: "BILD poster", count: 1 },
        { itemId: "b", name: "GURLI cushion cover", count: 4 },
      ]),
    ).toBe("BILD poster, GURLI cushion cover ×4");
  });
});
