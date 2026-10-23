// Refuses to run under a Node outside package.json's "engines" range.
// npm checks "engines" on install (with engine-strict), not on "npm run", and the
// machine's default Node (asdf's global pin) predates the October 2026 security fixes.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const range = pkg.engines?.node ?? "";
const m = /^>=(\d+)\.(\d+)\.(\d+) <(\d+)$/.exec(range);
if (!m) {
  console.error(`check-node: cannot parse engines.node "${range}" (expected ">=a.b.c <d")`);
  process.exit(1);
}
const min = [Number(m[1]), Number(m[2]), Number(m[3])];
const maxMajor = Number(m[4]);
const cur = process.versions.node.split(".").map(Number);

const atLeastMin =
  cur[0] > min[0] ||
  (cur[0] === min[0] && (cur[1] > min[1] || (cur[1] === min[1] && cur[2] >= min[2])));
if (!atLeastMin || cur[0] >= maxMajor) {
  console.error(
    `check-node: Node ${process.versions.node} is outside "${range}". ` +
      `Run from the repo root (its .tool-versions pins nodejs ${min.join(".")}) ` +
      `or \`asdf install nodejs ${min.join(".")}\`. See ${fileURLToPath(new URL("../README.md", import.meta.url))}.`,
  );
  process.exit(1);
}
