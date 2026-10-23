// rooms.json, refetched on window focus. The state only changes when the file does, so the memoized
// geometry downstream is not recomputed on every focus.
import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomsFile } from "../../shared/schema.ts";
import { errorText, getRooms } from "../api.ts";
import { useWindowFocus } from "./useWindowFocus.ts";

export function useRooms() {
  const [data, setData] = useState<RoomsFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reads = useRef(0);
  const lastJson = useRef("");

  const refresh = useCallback(async () => {
    const read = ++reads.current;
    try {
      const file = await getRooms();
      if (read !== reads.current) return; // a newer read is on its way
      const json = JSON.stringify(file);
      if (json !== lastJson.current) {
        lastJson.current = json;
        setData(file);
      }
      setError(null);
    } catch (e) {
      if (read === reads.current) setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useWindowFocus(() => void refresh());

  return { data, error, refresh };
}
