import { describe, expect, it } from "vitest";
import type { Item } from "../shared/schema.ts";
import { NO_FILTERS, applyFilters, hasFilters, sortItems } from "../src/filters.ts";

function item(over: Partial<Item> & Pick<Item, "id">): Item {
  return {
    vendor: "ikea",
    url: "https://www.ikea.com/us/en/p/x",
    name: over.id,
    category: "desk",
    tags: [],
    rooms: [],
    status: "candidate",
    price: { amount: 100, currency: "USD", asOf: "2026-10-20" },
    dimensions: { w: 40, d: 20, h: 30 },
    images: [],
    notes: "",
    captured: { date: "2026-10-20", by: "agent", method: "chrome" },
    ...over,
  };
}

const ids = (items: Item[]) => items.map((i) => i.id);

const desk = item({
  id: "ikea-desk",
  name: "MICKE Desk",
  brand: "IKEA",
  tags: ["office", "kids"],
  rooms: ["maddie-room", "back-bedroom"],
  status: "shortlisted",
  price: { amount: 79.99, currency: "USD", asOf: "2026-10-21" },
  dimensions: { w: 41.25, d: 19.75, h: 29.5 },
  notes: "White; cable outlet at the back",
});
const bed = item({
  id: "amazon-bed",
  vendor: "amazon",
  url: "https://www.amazon.com/dp/B0",
  name: "Zinus queen platform bed",
  brand: "Zinus",
  category: "bed",
  tags: ["bedroom"],
  rooms: ["master-bedroom"],
  price: { amount: 249, currency: "USD", asOf: "2026-10-19" },
  dimensions: { w: 64, d: 84, h: 14 },
  captured: { date: "2026-10-19", by: "agent", method: "chrome" },
});
const lamp = item({
  id: "costco-lamp",
  vendor: "costco",
  url: "https://www.costco.com/lamp",
  name: "floor lamp",
  category: "lamp",
  price: null,
  dimensions: null,
  status: "rejected",
  notes: "too tall for the office",
  captured: { date: "2026-10-22", by: "andrew", method: "manual" },
});
const chair = item({
  id: "owned-chair",
  vendor: "owned",
  url: null,
  name: "Desk chair",
  category: "chair",
  tags: ["office", "seating"],
  rooms: ["back-bedroom"],
  status: "owned",
  price: { amount: 0, currency: "USD", asOf: "2026-10-01" },
  dimensions: { w: 26, d: 26 },
  captured: { date: "2026-10-01", by: "andrew", method: "tape" },
});
const all = [desk, bed, lamp, chair];

describe("applyFilters", () => {
  it("passes everything when no filter is on", () => {
    expect(ids(applyFilters(all, NO_FILTERS))).toEqual(ids(all));
    expect(ids(applyFilters(all, {}))).toEqual(ids(all));
  });

  it("matches text against the name, brand and notes, ignoring case", () => {
    expect(ids(applyFilters(all, { text: "micke" }))).toEqual(["ikea-desk"]);
    expect(ids(applyFilters(all, { text: "ZINUS" }))).toEqual(["amazon-bed"]); // brand (and name)
    expect(ids(applyFilters(all, { text: "cable OUTLET" }))).toEqual(["ikea-desk"]); // notes
    expect(ids(applyFilters(all, { text: "desk" }))).toEqual(["ikea-desk", "owned-chair"]);
  });

  it("needs every word of the text, in any field, but never across two fields", () => {
    expect(ids(applyFilters(all, { text: "ikea white" }))).toEqual(["ikea-desk"]); // brand + notes
    expect(ids(applyFilters(all, { text: "ikea chair" }))).toEqual([]);
    expect(ids(applyFilters(all, { text: "  desk   chair " }))).toEqual(["owned-chair"]);
    // "deskikea" would only exist if the name and brand were glued together
    expect(ids(applyFilters(all, { text: "deskikea" }))).toEqual([]);
  });

  it("does not search the category, tags or id", () => {
    expect(ids(applyFilters(all, { text: "bedroom" }))).toEqual([]);
    expect(ids(applyFilters(all, { text: "costco-lamp" }))).toEqual([]);
  });

  it("filters by category, tag, vendor, room and status", () => {
    expect(ids(applyFilters(all, { category: "bed" }))).toEqual(["amazon-bed"]);
    expect(ids(applyFilters(all, { tag: "office" }))).toEqual(["ikea-desk", "owned-chair"]);
    expect(ids(applyFilters(all, { vendor: "owned" }))).toEqual(["owned-chair"]);
    expect(ids(applyFilters(all, { room: "back-bedroom" }))).toEqual(["ikea-desk", "owned-chair"]);
    expect(ids(applyFilters(all, { room: "kitchen" }))).toEqual([]);
    expect(ids(applyFilters(all, { status: "rejected" }))).toEqual(["costco-lamp"]);
  });

  it("keeps items no wider or deeper than the maximum; no dimensions only passes while it is off", () => {
    expect(ids(applyFilters(all, { maxW: 41.25 }))).toEqual(["ikea-desk", "owned-chair"]);
    expect(ids(applyFilters(all, { maxW: 41 }))).toEqual(["owned-chair"]);
    expect(ids(applyFilters(all, { maxD: 26 }))).toEqual(["ikea-desk", "owned-chair"]);
    expect(ids(applyFilters(all, { maxW: 100, maxD: 100 }))).toEqual(["ikea-desk", "amazon-bed", "owned-chair"]);
    expect(applyFilters(all, { maxW: null, maxD: null })).toContain(lamp);
  });

  it("keeps items at or under the max price; no price only passes while it is off", () => {
    expect(ids(applyFilters(all, { maxPrice: 79.99 }))).toEqual(["ikea-desk", "owned-chair"]);
    expect(ids(applyFilters(all, { maxPrice: 0 }))).toEqual(["owned-chair"]);
    expect(ids(applyFilters(all, { maxPrice: 1000 }))).toEqual(["ikea-desk", "amazon-bed", "owned-chair"]);
    expect(applyFilters(all, { maxPrice: null })).toContain(lamp);
  });

  it("treats a NaN or infinite number as off", () => {
    expect(ids(applyFilters(all, { maxPrice: Number.NaN, maxW: Number.POSITIVE_INFINITY }))).toEqual(ids(all));
  });

  it("combines filters with AND", () => {
    expect(ids(applyFilters(all, { tag: "office", maxPrice: 50 }))).toEqual(["owned-chair"]);
    expect(ids(applyFilters(all, { room: "back-bedroom", status: "shortlisted", text: "desk" }))).toEqual(["ikea-desk"]);
  });

  it("does not modify its input", () => {
    const input = [...all];
    applyFilters(input, { category: "bed" });
    expect(input).toEqual(all);
  });
});

describe("hasFilters", () => {
  it("is false for no filters and blank text, true for any filter", () => {
    expect(hasFilters(NO_FILTERS)).toBe(false);
    expect(hasFilters({ text: "   " })).toBe(false);
    expect(hasFilters({ text: "desk" })).toBe(true);
    expect(hasFilters({ status: "owned" })).toBe(true);
    expect(hasFilters({ maxPrice: 0 })).toBe(true);
  });
});

describe("sortItems", () => {
  it("sorts by price both ways, with no price last either way", () => {
    expect(ids(sortItems(all, { key: "price", dir: "asc" }))).toEqual(["owned-chair", "ikea-desk", "amazon-bed", "costco-lamp"]);
    expect(ids(sortItems(all, { key: "price", dir: "desc" }))).toEqual(["amazon-bed", "ikea-desk", "owned-chair", "costco-lamp"]);
  });

  it("sorts by width and depth, with no dimensions last", () => {
    expect(ids(sortItems(all, { key: "width", dir: "asc" }))).toEqual(["owned-chair", "ikea-desk", "amazon-bed", "costco-lamp"]);
    expect(ids(sortItems(all, { key: "width", dir: "desc" }))).toEqual(["amazon-bed", "ikea-desk", "owned-chair", "costco-lamp"]);
    expect(ids(sortItems(all, { key: "depth", dir: "asc" }))).toEqual(["ikea-desk", "owned-chair", "amazon-bed", "costco-lamp"]);
    expect(ids(sortItems(all, { key: "depth", dir: "desc" }))).toEqual(["amazon-bed", "owned-chair", "ikea-desk", "costco-lamp"]);
  });

  it("sorts by name ignoring case, with numbers in natural order", () => {
    expect(ids(sortItems(all, { key: "name", dir: "asc" }))).toEqual(["owned-chair", "costco-lamp", "ikea-desk", "amazon-bed"]);
    expect(ids(sortItems(all, { key: "name", dir: "desc" }))).toEqual(["amazon-bed", "ikea-desk", "costco-lamp", "owned-chair"]);
    const shelves = [item({ id: "ikea-s10", name: "Shelf 10" }), item({ id: "ikea-s9", name: "shelf 9" })];
    expect(ids(sortItems(shelves, { key: "name", dir: "asc" }))).toEqual(["ikea-s9", "ikea-s10"]);
  });

  it("sorts by the date the item was captured", () => {
    expect(ids(sortItems(all, { key: "date", dir: "asc" }))).toEqual(["owned-chair", "amazon-bed", "ikea-desk", "costco-lamp"]);
    expect(ids(sortItems(all, { key: "date", dir: "desc" }))).toEqual(["costco-lamp", "ikea-desk", "amazon-bed", "owned-chair"]);
  });

  it("breaks ties by name, then id, whatever the direction", () => {
    const tied = [
      item({ id: "ikea-c", name: "Beta" }),
      item({ id: "ikea-b", name: "alpha" }),
      item({ id: "ikea-a", name: "Alpha" }),
    ];
    expect(ids(sortItems(tied, { key: "price", dir: "asc" }))).toEqual(["ikea-a", "ikea-b", "ikea-c"]);
    expect(ids(sortItems(tied, { key: "price", dir: "desc" }))).toEqual(["ikea-a", "ikea-b", "ikea-c"]);
  });

  it("keeps several missing values in name order at the end", () => {
    const unpriced = [item({ id: "ikea-z", name: "Zed", price: null }), item({ id: "ikea-y", name: "Why", price: null }), desk];
    expect(ids(sortItems(unpriced, { key: "price", dir: "desc" }))).toEqual(["ikea-desk", "ikea-y", "ikea-z"]);
  });

  it("returns a sorted copy and leaves the input alone", () => {
    const input = [...all];
    const sorted = sortItems(input, { key: "price", dir: "desc" });
    expect(sorted).not.toBe(input);
    expect(input).toEqual(all);
  });
});
