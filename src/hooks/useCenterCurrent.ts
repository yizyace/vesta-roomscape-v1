// Keeps the open entry ([aria-current="page"]) of a strip that scrolls sideways in view: the room tabs
// and, on a phone, the variant pills, so Maddie's room or layout H is not hidden past the right edge
// when it is the one open. Runs when `key` changes (the open entry, how many there are).
import { useLayoutEffect } from "react";
import type { RefObject } from "react";
import { centeredScrollLeft } from "../zoom.ts";

export function useCenterCurrent(ref: RefObject<HTMLElement | null>, key: string): void {
  useLayoutEffect(() => {
    const strip = ref.current;
    const item = strip?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!strip || !item || strip.scrollWidth <= strip.clientWidth) return;
    const box = item.getBoundingClientRect();
    const left = box.left - strip.getBoundingClientRect().left - strip.clientLeft + strip.scrollLeft;
    strip.scrollLeft = centeredScrollLeft(strip, { left, width: box.width });
  }, [ref, key]);
}
