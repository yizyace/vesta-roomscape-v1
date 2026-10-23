import { useEffect, useEffectEvent } from "react";
import { READ_ONLY } from "../api.ts";

/**
 * Calls `onFocus` whenever the window regains focus: agents write the data files while the tab is open.
 * Never in the read-only copy, whose files change only with a new deploy (a reload shows it).
 */
export function useWindowFocus(onFocus: () => void): void {
  const handler = useEffectEvent(onFocus);
  useEffect(() => {
    if (READ_ONLY) return;
    const listener = () => handler();
    window.addEventListener("focus", listener);
    return () => window.removeEventListener("focus", listener);
  }, []);
}
