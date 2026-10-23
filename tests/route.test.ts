import { describe, expect, it } from "vitest";
import { fallbackRoute, isVariantId, parseHash, routeHash } from "../src/route.ts";

describe("parseHash", () => {
  it("reads a room as its variant a, in edit or view mode", () => {
    expect(parseHash("#/living-room")).toEqual({ roomId: "living-room", variant: "a", view: false });
    expect(parseHash("#/living-room/")).toEqual({ roomId: "living-room", variant: "a", view: false });
    expect(parseHash("#/living-room/view")).toEqual({ roomId: "living-room", variant: "a", view: true });
    expect(parseHash("#/living-room/view/")).toEqual({ roomId: "living-room", variant: "a", view: true });
  });

  it("reads a variant, in edit or view mode", () => {
    expect(parseHash("#/maddie-room/b")).toEqual({ roomId: "maddie-room", variant: "b", view: false });
    expect(parseHash("#/maddie-room/a")).toEqual({ roomId: "maddie-room", variant: "a", view: false });
    expect(parseHash("#/maddie-room/c/view")).toEqual({ roomId: "maddie-room", variant: "c", view: true });
    expect(parseHash("#/maddie-room/reading-nook")).toEqual({ roomId: "maddie-room", variant: "reading-nook", view: false });
  });

  it("refuses unknown rooms, bad variant ids, extra segments and the reserved word as a variant", () => {
    for (const hash of ["", "#", "#/", "#/attic", "#/living-room/B", "#/living-room//view", "#/living-room/b/c", "#/living-room/view/view", "#/living-room/b/view/x", "living-room"]) {
      expect(parseHash(hash), hash).toBeNull();
    }
  });
});

describe("routeHash", () => {
  it("leaves variant a out of the hash and round-trips through parseHash", () => {
    expect(routeHash("living-room")).toBe("#/living-room");
    expect(routeHash("living-room", "a", true)).toBe("#/living-room/view");
    expect(routeHash("living-room", "b")).toBe("#/living-room/b");
    expect(routeHash("living-room", "d", true)).toBe("#/living-room/d/view");
    for (const [variant, view] of [["a", false], ["a", true], ["b", false], ["c", true]] as const) {
      expect(parseHash(routeHash("kitchen", variant, view))).toEqual({ roomId: "kitchen", variant, view });
    }
  });
});

describe("fallbackRoute", () => {
  it("keeps a real room and view mode, and drops a bad variant", () => {
    expect(fallbackRoute("#/maddie-room/B")).toEqual({ roomId: "maddie-room", variant: "a", view: false });
    expect(fallbackRoute("#/maddie-room/B/view")).toEqual({ roomId: "maddie-room", variant: "a", view: true });
  });

  it("sends anything else to the living room", () => {
    expect(fallbackRoute("")).toEqual({ roomId: "living-room", variant: "a", view: false });
    expect(fallbackRoute("#/attic/view")).toEqual({ roomId: "living-room", variant: "a", view: true });
  });
});

describe("isVariantId", () => {
  it("takes kebab-case slugs except view", () => {
    expect(["a", "b", "z", "a-2", "reading-nook"].every(isVariantId)).toBe(true);
    expect(["", "A", "2", "-a", "a_b", "view", "a/b"].some(isVariantId)).toBe(false);
  });
});
