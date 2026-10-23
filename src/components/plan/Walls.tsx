// The room outline: a WALL_T band outside each wall line (masked off the interior and cut open at
// doors, closets and openings) and one length label per wall, placed outside it. Derived and assumed
// walls are drawn lighter and labelled in muted italic with "≈".
import { featureSpan } from "../../../shared/geometry.ts";
import type { Rect, Segment, Walk } from "../../../shared/geometry.ts";
import { inchesText } from "../../../shared/format.ts";
import type { Room } from "../../../shared/schema.ts";
import { WALL_FONT, WALL_T, add, alongOf, closetDepth, isVertical, outward, pointsAttr, rectAttrs, segmentOf, strip, wallBand, wallLengthText } from "./drawing.ts";
import { textWidth } from "./text.ts";

const CUTS_WALL = new Set(["door", "closet", "opening"]);

export function Walls({ room, walk, frame, maskId }: { room: Room; walk: Walk; frame: Rect; maskId: string }) {
  const gaps: Rect[] = [];
  for (const f of room.features) {
    const seg = CUTS_WALL.has(f.type) ? segmentOf(walk, f) : undefined;
    if (!seg) continue;
    const { a, b } = featureSpan(seg, f);
    gaps.push(strip(seg, a, b, -1, WALL_T + 1));
  }
  // Measured walls go last so their colour wins where two bands overlap at a corner.
  const ordered = [...walk.segments].sort((s, t) => Number(s.kind === "measured") - Number(t.kind === "measured"));
  return (
    <g className="walls">
      <mask id={maskId} maskUnits="userSpaceOnUse" {...rectAttrs(frame)}>
        <rect {...rectAttrs(frame)} fill="white" />
        <polygon points={pointsAttr(walk.points)} fill="black" />
        {gaps.map((r, i) => (
          <rect key={i} {...rectAttrs(r)} fill="black" />
        ))}
      </mask>
      <g mask={`url(#${maskId})`}>
        {ordered.map((seg) => (
          <rect key={seg.name} className={seg.kind === "measured" ? "wall" : "wall approx"} {...rectAttrs(wallBand(seg))} />
        ))}
      </g>
    </g>
  );
}

export function WallLabels({ room, walk, k }: { room: Room; walk: Walk; k: number }) {
  return (
    <g className="wall-labels">
      {layoutWallLabels(room, walk, k).map((l) => (
        <g key={l.key} className={l.className}>
          <title>{l.title}</title>
          <text fontSize={l.size} textAnchor={l.anchor} transform={l.transform}>
            {l.lines.map((line, i) => (
              <tspan key={i} x={line.x} y={line.y} dy="0.35em">
                {line.text}
              </tspan>
            ))}
          </text>
        </g>
      ))}
    </g>
  );
}

type WallText = {
  key: string;
  className: string;
  title: string;
  size: number;
  anchor: "start" | "middle" | "end";
  transform?: string;
  lines: { text: string; x: number; y: number }[];
  box: Rect;
};

type Placed = Omit<WallText, "key" | "className" | "title">;
/** A label's extent along its wall, and where it lands when centred `t` inches from the wall's start. */
type Option = { extent: number; at: (t: number) => Placed };
type Span = { lo: number; hi: number; depth: number };

const collide = (a: Rect, b: Rect, margin = 0.5): boolean =>
  a.x < b.x + b.w + margin && b.x < a.x + a.w + margin && a.y < b.y + b.h + margin && b.y < a.y + a.h + margin;

/**
 * Positions every wall label outside its wall. Shortest walls go first, since they have no room to
 * move. Each wall tries its options in order (inches and feet along the wall, inches only along the
 * wall, small inches beside it), sliding each from the middle until it clears the labels already
 * placed: Maddie's 35" wall reads "35"" along the wall under the 15" step's "15"".
 */
function layoutWallLabels(room: Room, walk: Walk, k: number): WallText[] {
  const bands = walk.segments.map(wallBand); // labels keep off every wall, not just their own
  const placed: WallText[] = [];
  const order = walk.segments.map((seg, i) => ({ seg, i })).sort((a, b) => a.seg.length - b.seg.length);
  for (const { seg, i } of order) {
    const approx = seg.kind !== "measured";
    const note = room.walls[i]?.note;
    const options = labelOptions(seg, approx, closetSpans(room, walk, seg), WALL_FONT * k);
    const taken = [...bands, ...placed.map((p) => p.box)];
    let chosen: Placed | undefined;
    for (const option of options) {
      chosen = slide(seg, option, taken);
      if (chosen) break;
    }
    placed.push({
      key: seg.name,
      className: approx ? "wall-label approx" : "wall-label",
      title: `${seg.name} wall: ${inchesText(seg.length)}, ${seg.kind}${note ? `. ${note}` : ""}`,
      // Nothing clears: the preferred label in the middle.
      ...(chosen ?? (options[0] as Option).at(seg.length / 2)),
    });
  }
  return placed;
}

/**
 * The spot nearest the wall's middle where the label clears every taken box, if any. A label that fits
 * stays within its wall; one wider than its wall (a step's) may shift up to half its width sideways.
 */
function slide(seg: Segment, option: Option, taken: Rect[]): Placed | undefined {
  const mid = seg.length / 2;
  const fits = option.extent <= seg.length - 2;
  const lo = fits ? option.extent / 2 + 1 : mid - option.extent / 2;
  const hi = fits ? seg.length - option.extent / 2 - 1 : mid + option.extent / 2;
  for (let d = 0; mid + d <= hi || mid - d >= lo; d++) {
    for (const t of d === 0 ? [mid] : [mid + d, mid - d]) {
      if (t < lo || t > hi) continue;
      const p = option.at(t);
      if (!taken.some((b) => collide(p.box, b))) return p;
    }
  }
  return undefined;
}

function closetSpans(room: Room, walk: Walk, seg: Segment): Span[] {
  const spans: Span[] = [];
  for (const f of room.features) {
    if (f.type !== "closet" || f.wall !== seg.name || !segmentOf(walk, f)) continue;
    const { a, b } = featureSpan(seg, f);
    const ta = alongOf(seg, a);
    const tb = alongOf(seg, b);
    spans.push({ lo: Math.min(ta, tb), hi: Math.max(ta, tb), depth: closetDepth(f) });
  }
  return spans;
}

function labelOptions(seg: Segment, approx: boolean, closets: Span[], font: number): Option[] {
  const weight = approx ? 500 : 600; // as styles.css draws them
  const prefix = approx ? "≈ " : "";
  const full = prefix + wallLengthText(seg.length);
  const inches = prefix + inchesText(seg.length);
  const small = font * 0.85;
  const options: Option[] = [];
  if (textWidth(full, font, weight) <= seg.length - 4) options.push(alongWall(seg, full, font, weight, closets));
  if (inches !== full && textWidth(inches, font, weight) <= seg.length - 2) options.push(alongWall(seg, inches, font, weight, closets));
  options.push(isVertical(seg) ? besideWall(seg, inches, small, weight) : alongWall(seg, inches, small, weight, closets));
  return options;
}

/** One line along the wall (rotated on a vertical wall), past the band and any closet box under it. */
function alongWall(seg: Segment, text: string, size: number, weight: number, closets: Span[]): Option {
  const width = textWidth(text, size, weight);
  const vertical = isVertical(seg);
  const n = outward(seg);
  return {
    extent: width,
    at: (t) => {
      const clearance = closets.reduce((c, s) => (s.lo < t + width / 2 && s.hi > t - width / 2 ? Math.max(c, s.depth) : c), WALL_T);
      const c = add(add(seg.start, seg.along, t), n, clearance + 1.25 + size / 2);
      return {
        size,
        anchor: "middle",
        transform: vertical ? `rotate(-90 ${c.x} ${c.y})` : undefined,
        lines: [{ text, x: c.x, y: c.y }],
        box: vertical ? { x: c.x - size / 2, y: c.y - width / 2, w: size, h: width } : { x: c.x - width / 2, y: c.y - size / 2, w: width, h: size },
      };
    },
  };
}

/** Unrotated beside a vertical wall too short to carry its label (the living room's 3" blocker). */
function besideWall(seg: Segment, text: string, size: number, weight: number): Option {
  const width = textWidth(text, size, weight);
  const n = outward(seg);
  return {
    extent: size,
    at: (t) => {
      const p = add(seg.start, seg.along, t);
      const x = p.x + n.x * (WALL_T + 1);
      return {
        size,
        anchor: n.x > 0 ? "start" : "end",
        lines: [{ text, x, y: p.y }],
        box: { x: n.x > 0 ? x : x - width, y: p.y - size / 2, w: width, h: size },
      };
    },
  };
}
