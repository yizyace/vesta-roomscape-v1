// Catalog filtering and sorting. Pure, so tests/filters.test.ts covers it without a DOM.
import type { Item } from "../shared/schema.ts";

/** "" (or null for the numbers) means the filter is off. */
export type Filters = {
  /** Whitespace-separated words; each must appear in the name, brand or notes (any case). */
  text: string;
  category: string;
  tag: string;
  vendor: string;
  room: string;
  status: string;
  maxW: number | null;
  maxD: number | null;
  maxPrice: number | null;
};

export const NO_FILTERS: Filters = {
  text: "",
  category: "",
  tag: "",
  vendor: "",
  room: "",
  status: "",
  maxW: null,
  maxD: null,
  maxPrice: null,
};

export const SORT_KEYS = ["name", "price", "width", "depth", "date"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = "asc" | "desc";
export type Sort = { key: SortKey; dir: SortDir };

const isSet = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);

/** True when any filter is on. */
export function hasFilters(f: Partial<Filters>): boolean {
  return Boolean(f.text?.trim() || f.category || f.tag || f.vendor || f.room || f.status) || [f.maxW, f.maxD, f.maxPrice].some(isSet);
}

/**
 * The items that pass every filter that is on. An item without dimensions (or without a price)
 * passes only while max W / max D (or max price) is off: it cannot be shown to fit.
 */
export function applyFilters(items: readonly Item[], f: Partial<Filters>): Item[] {
  const words = (f.text ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    if (words.length > 0) {
      // Joined with newlines so a word cannot match across two fields.
      const haystack = [item.name, item.brand ?? "", item.notes].join("\n").toLowerCase();
      if (!words.every((w) => haystack.includes(w))) return false;
    }
    if (f.category && item.category !== f.category) return false;
    if (f.tag && !item.tags.includes(f.tag)) return false;
    if (f.vendor && item.vendor !== f.vendor) return false;
    if (f.room && !(item.rooms as readonly string[]).includes(f.room)) return false;
    if (f.status && item.status !== f.status) return false;
    if (isSet(f.maxW) && !(item.dimensions && item.dimensions.w <= f.maxW)) return false;
    if (isSet(f.maxD) && !(item.dimensions && (item.dimensions.d ?? 0) <= f.maxD)) return false; // a flat item has no depth
    if (isSet(f.maxPrice) && !(item.price && item.price.amount <= f.maxPrice)) return false;
    return true;
  });
}

const names = new Intl.Collator("en", { sensitivity: "base", numeric: true });

const SORT_VALUE: Record<SortKey, (item: Item) => number | string | null> = {
  name: (item) => item.name,
  price: (item) => item.price?.amount ?? null,
  width: (item) => item.dimensions?.w ?? null,
  depth: (item) => item.dimensions?.d ?? null,
  date: (item) => item.captured.date,
};

function compareValues(key: SortKey, a: number | string, b: number | string): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (key === "name") return names.compare(String(a), String(b));
  return a < b ? -1 : a > b ? 1 : 0; // ISO dates sort as strings
}

/**
 * A sorted copy. Missing values (no price, no dimensions) go last in either direction; ties fall
 * back to the name, then the id, so the order is stable across refetches.
 */
export function sortItems(items: readonly Item[], sort: Sort): Item[] {
  const value = SORT_VALUE[sort.key];
  const sign = sort.dir === "desc" ? -1 : 1;
  return [...items].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va === null || vb === null) {
      if (va !== vb) return va === null ? 1 : -1;
    } else {
      const c = compareValues(sort.key, va, vb);
      if (c !== 0) return c * sign;
    }
    return names.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}
