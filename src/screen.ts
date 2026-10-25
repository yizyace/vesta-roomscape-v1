// The one-column layout's media query: a phone, or any touch screen up to a tablet's width (a phone on
// its side, an iPad). A desktop window that narrow keeps the editor's catalog beside the plan. The
// layout itself is in styles.css, which writes the same query with "screen and" before each part
// (tests/styles.test.ts holds the two together); script reads it for the few choices CSS can't make
// (the layout notes start folded).
export const ONE_COLUMN_QUERY = "(max-width: 760px), (pointer: coarse) and (max-width: 1180px)";

export function isOneColumn(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(ONE_COLUMN_QUERY).matches;
}
