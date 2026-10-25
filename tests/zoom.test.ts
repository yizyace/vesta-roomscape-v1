import { describe, expect, it } from "vitest";
import { FIT, ZOOM_STEPS, centeredScrollLeft, keepCenter, zoomIn, zoomOut } from "../src/zoom.ts";

describe("zoomIn and zoomOut", () => {
  it("step through the zoom levels from the fit to the largest and back", () => {
    expect(ZOOM_STEPS[0]).toBe(FIT);
    const up: number[] = [];
    for (let z: number = FIT; up.length < ZOOM_STEPS.length; z = zoomIn(z)) up.push(z);
    expect(up).toEqual([...ZOOM_STEPS]);
    const down: number[] = [];
    for (let z: number = ZOOM_STEPS[ZOOM_STEPS.length - 1] ?? FIT; down.length < ZOOM_STEPS.length; z = zoomOut(z)) down.push(z);
    expect(down).toEqual([...ZOOM_STEPS].reverse());
  });

  it("stop at either end", () => {
    const max = Math.max(...ZOOM_STEPS);
    expect(zoomIn(max)).toBe(max);
    expect(zoomOut(FIT)).toBe(FIT);
  });

  it("land on the next level from a zoom between two levels", () => {
    expect(zoomIn(1.2)).toBe(1.5);
    expect(zoomOut(1.2)).toBe(1);
    expect(zoomIn(2.5)).toBe(3);
    expect(zoomOut(2.5)).toBe(2);
  });
});

describe("keepCenter", () => {
  it("keeps the point in the middle of the view in the middle after zooming in", () => {
    // A 300 × 200 view over a 600 × 400 plan, scrolled to show its middle; the plan doubles.
    const before = { scrollLeft: 150, scrollTop: 100, clientWidth: 300, clientHeight: 200, scrollWidth: 600, scrollHeight: 400 };
    expect(keepCenter(before, { clientWidth: 300, clientHeight: 200, scrollWidth: 1200, scrollHeight: 800 })).toEqual({ left: 450, top: 300 });
  });

  it("keeps an off-centre point too, and allows for a view that grew", () => {
    // The middle of the view is at 25% across and 50% down; the view is 100px taller afterwards.
    const before = { scrollLeft: 0, scrollTop: 100, clientWidth: 300, clientHeight: 200, scrollWidth: 600, scrollHeight: 400 };
    expect(keepCenter(before, { clientWidth: 300, clientHeight: 300, scrollWidth: 1200, scrollHeight: 800 })).toEqual({ left: 150, top: 250 });
  });

  it("never scrolls past either edge", () => {
    const before = { scrollLeft: 0, scrollTop: 0, clientWidth: 300, clientHeight: 200, scrollWidth: 300, scrollHeight: 200 };
    // Back to the fit: nothing left to scroll.
    expect(keepCenter({ ...before, scrollLeft: 900, scrollTop: 600, scrollWidth: 1200, scrollHeight: 800 }, before)).toEqual({ left: 0, top: 0 });
    // From the top-left corner of a plan that fits: the zoom keeps the middle, inside the new plan.
    expect(keepCenter(before, { clientWidth: 300, clientHeight: 200, scrollWidth: 600, scrollHeight: 400 })).toEqual({ left: 150, top: 100 });
  });
});

describe("centeredScrollLeft", () => {
  it("centres an item in a strip that scrolls sideways", () => {
    // A 300px strip over 1000px of tabs; the tab runs from 500 to 600.
    expect(centeredScrollLeft({ clientWidth: 300, scrollWidth: 1000 }, { left: 500, width: 100 })).toBe(400);
  });

  it("clamps to the start and the end of the strip", () => {
    expect(centeredScrollLeft({ clientWidth: 300, scrollWidth: 1000 }, { left: 10, width: 100 })).toBe(0);
    expect(centeredScrollLeft({ clientWidth: 300, scrollWidth: 1000 }, { left: 950, width: 50 })).toBe(700);
  });

  it("leaves a strip that does not scroll at 0", () => {
    expect(centeredScrollLeft({ clientWidth: 300, scrollWidth: 300 }, { left: 200, width: 80 })).toBe(0);
  });
});
