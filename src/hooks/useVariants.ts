// The open room's layout variants (GET /api/layouts/:room), one summary each, for the toolbar's
// switcher. Refetched on window focus and when App says a save, a duplicate or a promote changed them;
// a promote's answer is applied as it is. The state only changes when the list does.
import { useCallback, useEffect, useRef, useState } from "react";
import { errorText, getVariants } from "../api.ts";
import type { VariantList } from "../api.ts";
import { useWindowFocus } from "./useWindowFocus.ts";

export function useVariants(room: string) {
  const [list, setList] = useState<VariantList | null>(null);
  const [error, setError] = useState<{ room: string; message: string } | null>(null);
  const roomRef = useRef(room);
  const reads = useRef(0);
  const lastJson = useRef("");

  const apply = useCallback((next: VariantList) => {
    const json = JSON.stringify(next);
    if (json !== lastJson.current) {
      lastJson.current = json;
      setList(next);
    }
    setError(null);
  }, []);

  const load = useCallback(
    async (r: string) => {
      const read = ++reads.current;
      try {
        const next = await getVariants(r);
        if (read === reads.current) apply(next);
      } catch (e) {
        if (read === reads.current) setError({ room: r, message: errorText(e) });
      }
    },
    [apply],
  );

  const refresh = useCallback(() => load(roomRef.current), [load]);
  /** Shows a list the server just answered (a promote), dropping any read still in flight. */
  const set = useCallback(
    (next: VariantList) => {
      reads.current++;
      apply(next);
    },
    [apply],
  );

  useEffect(() => {
    roomRef.current = room;
    void load(room);
  }, [room, load]);
  useWindowFocus(() => void refresh());

  return { variants: list?.room === room ? list.variants : null, error: error?.room === room ? error.message : null, refresh, set };
}
