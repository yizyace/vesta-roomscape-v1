// Text measurement for SVG labels, in plan units (inches). Widths come from a hidden SVG <text> in the
// plan's font (--plan-font in styles.css) at the size the plan draws it. Both details matter: Chrome's
// canvas does not resolve `system-ui`, and the macOS system font is optically sized, so at the plan's
// few-unit font sizes its glyphs are about a quarter wider per em than at 100px.
const SVG_NS = "http://www.w3.org/2000/svg";

let probe: SVGTextElement | null | undefined;
const widths = new Map<string, number>();

function measure(text: string, size: number, weight: number): number {
  if (probe === undefined) {
    if (typeof document === "undefined") {
      probe = null;
    } else {
      const svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("aria-hidden", "true");
      svg.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none";
      probe = document.createElementNS(SVG_NS, "text");
      probe.style.fontFamily = "var(--plan-font)";
      svg.appendChild(probe);
      document.body.appendChild(svg);
    }
  }
  if (!probe) return text.length * 0.6 * size; // no DOM: a rough average glyph width
  probe.setAttribute("font-size", String(size));
  probe.style.fontWeight = String(weight);
  probe.textContent = text;
  return probe.getComputedTextLength();
}

/** Width of `text` drawn at `size` inches. */
export function textWidth(text: string, size: number, weight = 400): number {
  const key = `${weight} ${size} ${text}`;
  let width = widths.get(key);
  if (width === undefined) {
    width = measure(text, size, weight);
    widths.set(key, width);
  }
  return width;
}

/** The text, cut with "…" until it fits `maxWidth`. */
export function ellipsize(text: string, maxWidth: number, size: number, weight = 400): string {
  if (textWidth(text, size, weight) <= maxWidth) return text;
  let cut = text.replace(/…$/, "");
  while (cut.length > 1 && textWidth(`${cut}…`, size, weight) > maxWidth) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/** Word-wraps into at most `maxLines` lines; the last one ends in "…" when words are left over. */
export function wrap(text: string, maxWidth: number, size: number, maxLines: number, weight = 400): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let i = 0;
  while (i < words.length && lines.length < maxLines) {
    let line = words[i++] ?? "";
    while (i < words.length && textWidth(`${line} ${words[i]}`, size, weight) <= maxWidth) line += ` ${words[i++]}`;
    lines.push(line);
  }
  const leftOver = i < words.length;
  return lines.map((line, k) => ellipsize(k === lines.length - 1 && leftOver ? `${line}…` : line, maxWidth, size, weight));
}
