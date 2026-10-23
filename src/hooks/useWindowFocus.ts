import { useEffect, useEffectEvent } from "react";

/** Calls `onFocus` whenever the window regains focus: agents write the data files while the tab is open. */
export function useWindowFocus(onFocus: () => void): void {
  const handler = useEffectEvent(onFocus);
  useEffect(() => {
    const listener = () => handler();
    window.addEventListener("focus", listener);
    return () => window.removeEventListener("focus", listener);
  }, []);
}
