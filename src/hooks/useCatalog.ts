// The catalog (items, taxonomy, files that failed to parse), refetched on window focus. saveItem
// updates the list at once and rolls back if the server refuses the item.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Item, Taxonomy } from "../../shared/schema.ts";
import { errorText, getCatalog, putItem } from "../api.ts";
import type { Catalog, CatalogFileError } from "../api.ts";
import { useWindowFocus } from "./useWindowFocus.ts";

const NO_ITEMS: Item[] = [];
const NO_ERRORS: CatalogFileError[] = [];

const replaceItem = (c: Catalog, item: Item): Catalog => ({ ...c, items: c.items.map((i) => (i.id === item.id ? item : i)) });

export function useCatalog() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef<Catalog | null>(null);
  const reads = useRef(0);
  const saves = useRef(0);
  const lastJson = useRef("");

  const apply = useCallback((c: Catalog) => {
    latest.current = c;
    setCatalog(c);
  }, []);

  const refresh = useCallback(async () => {
    if (saves.current > 0) return; // a PUT is out; its answer is fresher than this read would be
    const read = ++reads.current;
    try {
      const c = await getCatalog();
      if (read !== reads.current || saves.current > 0) return;
      const json = JSON.stringify(c);
      if (json !== lastJson.current) {
        lastJson.current = json;
        apply(c);
      }
      setError(null);
    } catch (e) {
      if (read === reads.current) setError(errorText(e));
    }
  }, [apply]);

  const saveItem = useCallback(
    async (item: Item): Promise<Item> => {
      const before = latest.current?.items.find((i) => i.id === item.id);
      if (latest.current) apply(replaceItem(latest.current, item));
      saves.current++;
      reads.current++; // drop any read already in flight
      try {
        const saved = await putItem(item);
        if (latest.current) apply(replaceItem(latest.current, saved));
        return saved;
      } catch (e) {
        if (latest.current && before) apply(replaceItem(latest.current, before));
        throw e;
      } finally {
        saves.current--;
      }
    },
    [apply],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useWindowFocus(() => void refresh());

  return {
    items: catalog?.items ?? NO_ITEMS,
    taxonomy: catalog?.taxonomy ?? (null as Taxonomy | null),
    errors: catalog?.errors ?? NO_ERRORS,
    loading: catalog === null && error === null,
    error,
    refresh,
    saveItem,
  };
}
