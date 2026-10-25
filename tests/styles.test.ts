// The phone layout lives in src/styles.css, where no unit test reaches it. These pin the rules that made
// the published copy work on a phone (Andrew, 2026-10-25: the deployed site "doesn't seem to work well"
// on mobile), so a later change to the stylesheet cannot quietly undo them.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ONE_COLUMN_QUERY } from "../src/screen.ts";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** A rule or at-rule: its selector or condition, its body, and the conditions of the blocks around it. */
type Block = { prelude: string; body: string; within: string[] };

function parse(text: string): Block[] {
  const blocks: Block[] = [];
  const open: { prelude: string; start: number }[] = [];
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "{") {
      open.push({ prelude: text.slice(from, i).replace(/\s+/g, " ").trim(), start: i + 1 });
      from = i + 1;
    } else if (c === "}") {
      const top = open.pop();
      if (top) blocks.push({ prelude: top.prelude, body: text.slice(top.start, i), within: open.map((o) => o.prelude) });
      from = i + 1;
    } else if (c === ";") {
      from = i + 1;
    }
  }
  return blocks;
}

const BLOCKS = parse(css);

/** A declaration's value in a rule's own body (nested rules are not its declarations), on one line. */
function value(block: Block, property: string): string | undefined {
  const own = block.body.replace(/\{[^{}]*\}/g, "");
  return new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(own)?.[1]?.replace(/\s+/g, " ").trim();
}

const rules = (selector: string, within?: string) =>
  BLOCKS.filter((b) => b.prelude.split(",").map((s) => s.trim()).includes(selector) && (within === undefined ? b.within.length === 0 : b.within.includes(within)));

const ONE_COLUMN = "@media screen and (max-width: 760px), screen and (pointer: coarse) and (max-width: 1180px)";
const BELOW_SIDE_PANES = "@media screen and (max-width: 1180px)";

describe("the stylesheet on a phone", () => {
  it("lets a swipe that starts on the plan scroll the page; only a piece being edited takes the touch", () => {
    expect(rules("svg.plan").map((b) => value(b, "touch-action"))).toContain("manipulation");
    const none = BLOCKS.filter((b) => value(b, "touch-action") === "none").map((b) => b.prelude);
    expect(none).toEqual([".plan.editable .piece"]);
  });

  it("gives phones and touch tablets one column, the plan, the room's summary, then the catalog", () => {
    expect(BLOCKS.some((b) => b.prelude === ONE_COLUMN)).toBe(true);
    // The script's query (src/screen.ts) is the same one.
    expect(`@media ${ONE_COLUMN_QUERY.split(", ").map((q) => `screen and ${q}`).join(", ")}`).toBe(ONE_COLUMN);
    const areas = BLOCKS.filter((b) => b.within.includes(ONE_COLUMN) && b.prelude.includes(".workspace")).map((b) => value(b, "grid-template-areas"));
    expect(areas).toContain('"plan" "details" "catalog"');
  });

  it("opens a selected piece's details in a sheet over the bottom of the screen wherever the details are not a side pane", () => {
    expect(rules(".details.selection", BELOW_SIDE_PANES).map((b) => value(b, "position"))).toContain("fixed");
    // The room's summary stays where it is, under the plan.
    expect(rules(".app.has-selection .details.summary").map((b) => value(b, "display"))).toContain("none");
    expect(rules(".app.has-selection .details.summary", BELOW_SIDE_PANES).map((b) => value(b, "display"))).toContain("block");
  });

  it("asks no grid for columns wider than a phone", () => {
    expect(css.match(/repeat\(auto-fill,\s*minmax\(\d/g) ?? []).toEqual([]);
  });

  it("sets form controls in 16px type on touch screens, so iOS does not zoom into a field", () => {
    const sizes = BLOCKS.filter((b) => b.within.some((w) => w.includes("(pointer: coarse)")) && b.prelude.split(",").map((s) => s.trim()).includes("input")).map((b) =>
      value(b, "font-size"),
    );
    expect(sizes).toContain("16px");
  });
});
