// The route in the hash (src/route.ts). A hash that does not parse is replaced: a bad variant with its
// room's variant a, anything else with the living room; view mode is kept.
import { useEffect, useSyncExternalStore } from "react";
import { fallbackRoute, parseHash, routeHash } from "../route.ts";
import type { Route } from "../route.ts";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

const readHash = (): string => window.location.hash;

export function useHashRoute(): Route {
  const hash = useSyncExternalStore(subscribe, readHash);
  const route = parseHash(hash);
  const invalid = route === null;
  useEffect(() => {
    if (!invalid) return;
    // replace() keeps the bad hash out of history and fires hashchange, which re-reads the store.
    const r = fallbackRoute(hash);
    window.location.replace(routeHash(r.roomId, r.variant, r.view));
  }, [invalid, hash]);
  return route ?? fallbackRoute(hash);
}
