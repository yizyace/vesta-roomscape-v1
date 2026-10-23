import { describe, expect, it } from "vitest";
import { dimensionsText, inchesText, lengthLabel, money, toFeetInches } from "../shared/format.ts";

describe("toFeetInches", () => {
  it("writes feet and inches, and bare inches under a foot", () => {
    expect(toFeetInches(93)).toBe(`7'9"`);
    expect(toFeetInches(14.5)).toBe(`1'2.5"`);
    expect(toFeetInches(8)).toBe(`8"`);
  });

  it("keeps 0 inches after whole feet", () => {
    expect(toFeetInches(12)).toBe(`1'0"`);
    expect(toFeetInches(108)).toBe(`9'0"`);
  });

  it("rounds to a tenth of an inch and signs negatives", () => {
    expect(toFeetInches(275.5)).toBe(`22'11.5"`);
    expect(toFeetInches(11.94)).toBe(`11.9"`);
    expect(toFeetInches(-14.5)).toBe(`-1'2.5"`);
  });

  // KNOWN DEFECT (format.ts): the inches are rounded after the feet are taken, so a remainder that
  // rounds up to 12 stays on this foot: 47.95 renders 3'12" and 11.96 renders 12". Drop `.fails`
  // once toFeetInches rounds the total to tenths before splitting off the feet.
  it("carries a remainder that rounds up to 12 inches into the next foot", () => {
    expect(toFeetInches(47.95)).toBe(`4'0"`);
    expect(toFeetInches(11.96)).toBe(`1'0"`);
  });
});

describe("inchesText and lengthLabel", () => {
  it("inchesText keeps one decimal only when there is a fraction", () => {
    expect(inchesText(14.5)).toBe(`14.5"`);
    expect(inchesText(93)).toBe(`93"`);
    expect(inchesText(14.25)).toBe(`14.3"`);
  });

  it("lengthLabel shows inches, then feet and inches", () => {
    expect(lengthLabel(93)).toBe(`93" · 7'9"`);
    expect(lengthLabel(14.5)).toBe(`14.5" · 1'2.5"`);
  });
});

describe("money", () => {
  it("formats US dollars with cents", () => {
    expect(money(85.99)).toBe("$85.99");
    expect(money(250)).toBe("$250.00");
  });
});

describe("dimensionsText", () => {
  it("writes w × d × h, leaving out an unknown h", () => {
    expect(dimensionsText({ w: 24.8, d: 18.9, h: 29.6 })).toBe(`24.8 × 18.9 × 29.6"`);
    expect(dimensionsText({ w: 24.8, d: 18.9 })).toBe(`24.8 × 18.9"`);
    expect(dimensionsText({ w: 60, d: 30, h: 30 })).toBe(`60 × 30 × 30"`);
  });

  it("says so when there are no dimensions", () => {
    expect(dimensionsText(null)).toBe("no dimensions");
  });
});

describe("dimensionsText for flat items", () => {
  it("shows width × height and says flat when there is no depth", () => {
    expect(dimensionsText({ w: 30, h: 22 })).toBe('30 × 22" flat');
    expect(dimensionsText({ w: 57 })).toBe('57" wide, flat');
  });
});
