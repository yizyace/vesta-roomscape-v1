import { describe, expect, it } from "vitest";
import { freeRun, intersectRect, rugLabelSpot } from "../src/components/plan/drawing.ts";
import { copyName, nextVariantId, pillTooltip, variantLetter, variantPills, variantTitle } from "../src/variants.ts";

const summary = (variant: string, name = "", placements = 0, extras = 0) => ({ variant, name, placements, extras, updatedAt: "2026-10-22T21:51:39.885Z" });

describe("variant helpers", () => {
  it("nextVariantId takes the first free letter after a, filling gaps", () => {
    expect(nextVariantId([])).toBe("b");
    expect(nextVariantId(["a"])).toBe("b");
    expect(nextVariantId(["a", "b", "c", "d"])).toBe("e");
    expect(nextVariantId(["a", "b", "d"])).toBe("c");
    expect(nextVariantId(["b", "reading-nook"])).toBe("c");
    expect(nextVariantId("abcdefghijklmnopqrstuvwxyz".split(""))).toBeNull();
  });

  it("copyName prefixes the source's name, or its letter when it has none", () => {
    expect(copyName("Staged: sofa facing the TV", "a")).toBe("Copy of Staged: sofa facing the TV");
    expect(copyName("  ", "c")).toBe("Copy of C");
  });

  it("variantTitle and variantLetter", () => {
    expect(variantLetter("b")).toBe("B");
    expect(variantTitle("a", "Staged: sofa facing the TV")).toBe("A · Staged: sofa facing the TV");
    expect(variantTitle("b", "")).toBe("B");
  });

  it("variantPills always offers a, adds the open variant when the list lacks it, and sorts", () => {
    expect(variantPills(null, null)).toEqual([{ variant: "a", name: "" }]);
    expect(variantPills([], { variant: "a", name: "" })).toEqual([{ variant: "a", name: "" }]);
    const listed = [summary("c", "C"), summary("a", "Staged"), summary("b", "B", 3, 1)];
    expect(variantPills(listed, { variant: "b", name: "B renamed", placements: 4 }).map((p) => [p.variant, p.name, p.placements, p.extras])).toEqual([
      ["a", "Staged", 0, 0],
      ["b", "B renamed", 4, 1], // the open variant's own name and counts win; the rest comes from the list
      ["c", "C", 0, 0],
    ]);
    expect(variantPills([summary("a", "Staged")], { variant: "e", name: "Copy of Staged" }).map((p) => p.variant)).toEqual(["a", "e"]);
    expect(variantPills([summary("b", "B")], null).map((p) => p.variant)).toEqual(["a", "b"]);
  });

  it("pillTooltip says what the variant holds", () => {
    expect(pillTooltip(summary("a", "Staged: sofa", 12, 6))).toBe("A · Staged: sofa (the staged pick): 12 placed, 6 on the room list, saved 2026-10-22 21:51 UTC");
    expect(pillTooltip({ variant: "b", name: "" })).toBe("B");
  });
});

describe("plan drawing helpers", () => {
  it("intersectRect is the shared interior, or null", () => {
    expect(intersectRect({ x: 0, y: 0, w: 36, h: 173 }, { x: 20, y: 100, w: 30, h: 30 })).toEqual({ x: 20, y: 100, w: 16, h: 30 });
    expect(intersectRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBeNull();
  });

  it("freeRun finds the widest uncovered stretch of a strip", () => {
    const strip = { x: 0, y: 0, w: 100, h: 6 };
    expect(freeRun(strip, [])).toEqual({ x: 0, w: 100 });
    expect(freeRun(strip, [{ x: 10, y: -5, w: 20, h: 8 }, { x: 25, y: 0, w: 15, h: 3 }, { x: 70, y: 4, w: 10, h: 10 }])).toEqual({ x: 40, w: 30 });
    expect(freeRun(strip, [{ x: 0, y: 6, w: 100, h: 10 }])).toEqual({ x: 0, w: 100 }); // only touches the strip's edge
    expect(freeRun(strip, [{ x: -10, y: 0, w: 120, h: 6 }])).toBeNull();
  });

  it("rugLabelSpot prefers the rug's bottom edge, and moves to the top when a piece covers more of the bottom", () => {
    const rug = { x: 50, y: 50, w: 80, h: 60 };
    expect(rugLabelSpot(rug, [], 6)).toEqual({ x: 50, y: 104, w: 80 });
    const sofaOnTheBottom = { x: 40, y: 90, w: 100, h: 35 };
    expect(rugLabelSpot(rug, [sofaOnTheBottom], 6)).toEqual({ x: 50, y: 50, w: 80 });
    const tableInTheMiddle = { x: 70, y: 70, w: 40, h: 20 };
    expect(rugLabelSpot(rug, [tableInTheMiddle], 6)).toEqual({ x: 50, y: 104, w: 80 });
    expect(rugLabelSpot(rug, [{ x: 0, y: 0, w: 200, h: 200 }], 6)).toBeNull();
  });
});
