// The plan's zoom (1 fits the whole room in its pane; above that the pane scrolls) and the scroll
// arithmetic around it: keeping the middle of the view in place when the zoom changes, and centring the
// open room's tab or variant pill in a strip that scrolls sideways on a phone. Pure, so
// tests/zoom.test.ts covers it.

export const FIT = 1;
export const ZOOM_STEPS = [FIT, 1.5, 2, 3, 4] as const;

const MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1] ?? FIT;

/** The next zoom level above `z`, or the largest. */
export function zoomIn(z: number): number {
  return ZOOM_STEPS.find((s) => s > z) ?? MAX;
}

/** The next zoom level below `z`, or the fit. */
export function zoomOut(z: number): number {
  return [...ZOOM_STEPS].reverse().find((s) => s < z) ?? FIT;
}

export type ScrollBox = { scrollLeft: number; scrollTop: number; clientWidth: number; clientHeight: number; scrollWidth: number; scrollHeight: number };
type Extent = Pick<ScrollBox, "clientWidth" | "clientHeight" | "scrollWidth" | "scrollHeight">;

const clamp = (v: number, max: number): number => Math.min(Math.max(v, 0), Math.max(max, 0));

/** Where to scroll after a zoom, so the point that was in the middle of the view is in the middle again. */
export function keepCenter(before: ScrollBox, after: Extent): { left: number; top: number } {
  const rx = (before.scrollLeft + before.clientWidth / 2) / before.scrollWidth;
  const ry = (before.scrollTop + before.clientHeight / 2) / before.scrollHeight;
  return {
    left: clamp(rx * after.scrollWidth - after.clientWidth / 2, after.scrollWidth - after.clientWidth),
    top: clamp(ry * after.scrollHeight - after.clientHeight / 2, after.scrollHeight - after.clientHeight),
  };
}

/** The scrollLeft that centres an item (`left` measured from the strip's scrolled content's start) in its strip. */
export function centeredScrollLeft(strip: { clientWidth: number; scrollWidth: number }, item: { left: number; width: number }): number {
  return clamp(item.left + item.width / 2 - strip.clientWidth / 2, strip.scrollWidth - strip.clientWidth);
}
