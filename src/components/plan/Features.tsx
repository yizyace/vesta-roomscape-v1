// Windows, heaters, stairs, doors, closets, openings and clear-wall dimensions, each on its named wall.
// Whatever a feature's `measured` list leaves out is drawn dashed, and an unmeasured length or depth
// is labelled with "≈". Three layers: FeatureShapes "floor" (under the walls), FeatureShapes "wall"
// (over them), FeatureLabels; FeatureSwings goes above the furniture so a blocked door shows.
import { doorArc, featureSpan } from "../../../shared/geometry.ts";
import type { Pt, Segment, Walk } from "../../../shared/geometry.ts";
import { inchesText } from "../../../shared/format.ts";
import type { Feature, Room } from "../../../shared/schema.ts";
import {
  CLEAR_OFFSET,
  FEATURE_FONT,
  TREAD,
  WALL_T,
  add,
  arcPath,
  closetDepth,
  heaterDepth,
  isVertical,
  midpoint,
  outward,
  rectAttrs,
  segmentOf,
  stairsDepth,
  strip,
} from "./drawing.ts";
import { textWidth } from "./text.ts";

type OnWall = { f: Feature; seg: Segment; a: Pt; b: Pt; key: string };

function onWalls(room: Room, walk: Walk): OnWall[] {
  const out: OnWall[] = [];
  room.features.forEach((f, i) => {
    const seg = segmentOf(walk, f);
    if (seg) out.push({ f, seg, ...featureSpan(seg, f), key: `${i}-${f.type}` });
  });
  return out;
}

const has = (f: Feature, what: "at" | "length" | "depth"): boolean => f.measured.includes(what);
const approx = (measured: boolean): string => (measured ? "" : "≈");
const cls = (base: string, dashed: boolean): string => (dashed ? `${base} approx` : base);

function tooltip(f: Feature): string {
  const depth = f.depth !== undefined ? ` × ${inchesText(f.depth)} deep` : "";
  const parts = [`${f.label ?? f.type} on the ${f.wall} wall: ${inchesText(f.length)}${depth}`];
  const missing = [...(has(f, "at") ? [] : ["position"]), ...(has(f, "length") ? [] : ["length"]), ...(f.depth === undefined || has(f, "depth") ? [] : ["depth"])];
  if (missing.length > 0) parts.push(`not measured: ${missing.join(", ")}`);
  if (f.note) parts.push(f.note);
  return parts.join(". ");
}

export function FeatureShapes({ room, walk, layer, k }: { room: Room; walk: Walk; layer: "floor" | "wall"; k: number }) {
  return (
    <g className={`features-${layer}`}>
      {onWalls(room, walk).map((w) => (
        <Shape key={w.key} w={w} layer={layer} k={k} />
      ))}
    </g>
  );
}

function Shape({ w, layer, k }: { w: OnWall; layer: "floor" | "wall"; k: number }) {
  const { f, seg, a, b } = w;
  const n = outward(seg);
  const title = <title>{tooltip(f)}</title>;
  const line = (p: Pt, q: Pt) => `M ${p.x} ${p.y} L ${q.x} ${q.y}`;

  if (layer === "floor") {
    if (f.type === "heater") {
      const dashed = !(has(f, "at") && has(f, "length") && has(f, "depth"));
      return (
        <rect className={cls("heater", dashed)} {...rectAttrs(strip(seg, a, b, -heaterDepth(f), 0))}>
          {title}
        </rect>
      );
    }
    if (f.type === "closet") {
      return (
        <rect className="closet" {...rectAttrs(strip(seg, a, b, 0, closetDepth(f)))}>
          {title}
        </rect>
      );
    }
    if (f.type === "stairs") {
      // A band `depth` into the room, with a tread line across it every TREAD inches along the wall.
      const depth = stairsDepth(f);
      const treads: string[] = [];
      for (let t = TREAD; t < f.length - 0.5; t += TREAD) {
        const p = add(a, seg.along, t);
        treads.push(line(p, add(p, seg.inward, depth)));
      }
      const dashed = !(has(f, "at") && has(f, "length") && has(f, "depth"));
      return (
        <g className={cls("stairs", dashed)}>
          {title}
          <rect className="stairs-band" {...rectAttrs(strip(seg, a, b, -depth, 0))} />
          <path className="treads" d={treads.join(" ")} />
        </g>
      );
    }
    return null;
  }

  switch (f.type) {
    case "window": {
      // A band a little thicker than the wall, with the glass line down its middle.
      const dashed = !(has(f, "at") && has(f, "length"));
      return (
        <g className={cls("window", dashed)}>
          {title}
          <rect {...rectAttrs(strip(seg, a, b, -1, WALL_T + 1))} />
          <path d={line(add(a, n, WALL_T / 2), add(b, n, WALL_T / 2))} />
        </g>
      );
    }
    case "door":
    case "closet":
      // The wall is cut open here (Walls); mark the jambs across its thickness.
      return (
        <g className="jambs">
          {title}
          <path d={`${line(a, add(a, n, WALL_T))} ${line(b, add(b, n, WALL_T))}`} />
        </g>
      );
    case "opening":
      return (
        <g className="opening">
          {title}
          <path d={line(add(a, n, WALL_T / 2), add(b, n, WALL_T / 2))} />
        </g>
      );
    case "clear": {
      // A dimension line outside the wall label: extension lines, the line, a 45° slash at each end.
      const p = add(a, n, CLEAR_OFFSET * k);
      const q = add(b, n, CLEAR_OFFSET * k);
      const s = { x: (seg.along.x + n.x) * 1.2, y: (seg.along.y + n.y) * 1.2 };
      const slash = (c: Pt) => line({ x: c.x - s.x, y: c.y - s.y }, { x: c.x + s.x, y: c.y + s.y });
      const extension = (c: Pt) => line(add(c, n, WALL_T + 1), add(c, n, CLEAR_OFFSET * k + 1.5));
      return (
        <g className={cls("clear", !has(f, "length"))}>
          {title}
          <path d={[line(p, q), extension(a), extension(b), slash(p), slash(q)].join(" ")} />
        </g>
      );
    }
    default:
      return null;
  }
}

export function FeatureLabels({ room, walk, k }: { room: Room; walk: Walk; k: number }) {
  const all = onWalls(room, walk);
  // A heater strip along a wall pushes that wall's other labels further into the room.
  const inset = new Map<string, number>();
  for (const { f } of all) if (f.type === "heater") inset.set(f.wall, Math.max(inset.get(f.wall) ?? 0, heaterDepth(f)));
  return (
    <g className="feature-labels">
      {all.map((w) => (
        <FeatureLabel key={w.key} w={w} inset={inset.get(w.f.wall) ?? 0} k={k} />
      ))}
    </g>
  );
}

function FeatureLabel({ w, inset, k }: { w: OnWall; inset: number; k: number }) {
  const { f, seg, a, b } = w;
  const name = f.label ?? f.type;
  const length = `${approx(has(f, "length"))}${inchesText(f.length)}`;
  const mid = midpoint(a, b);
  let size = FEATURE_FONT * k;
  let lines = [`${name} ${length}`];
  let at: Pt;
  switch (f.type) {
    case "heater":
      size = 3 * k; // inside its own strip, over the hatching
      at = add(mid, seg.inward, heaterDepth(f) / 2);
      break;
    case "stairs":
      // In the middle of the band, with its depth (the length runs the whole wall): "stairs ≈36"".
      lines = [`${name} ${approx(has(f, "depth"))}${inchesText(stairsDepth(f))}`];
      at = add(mid, seg.inward, stairsDepth(f) / 2);
      break;
    case "door": {
      const radius = doorArc(seg, f)[0]?.radius;
      at = add(mid, seg.inward, radius ? radius * 0.45 : inset + 1.5 + size / 2);
      break;
    }
    case "closet": {
      // Inside the closet box, outside the room.
      const depth = `${approx(has(f, "depth"))}${inchesText(closetDepth(f))}`;
      const one = `${name} ${length} × ${depth}`;
      lines = textWidth(one, size) <= f.length - 3 ? [one] : [name, `${length} × ${depth}`];
      at = add(mid, outward(seg), closetDepth(f) / 2);
      break;
    }
    case "clear":
      at = add(mid, outward(seg), CLEAR_OFFSET * k + 1.2 + size / 2);
      break;
    default:
      // window, opening: just inside the wall, past any heater on it
      at = add(mid, seg.inward, inset + 1.5 + size / 2);
  }
  const lineHeight = size * 1.15;
  const top = -((lines.length - 1) * lineHeight) / 2;
  return (
    <text
      className={`feature-label kind-${f.type}`}
      fontSize={size}
      textAnchor="middle"
      transform={`translate(${at.x} ${at.y})${isVertical(seg) ? " rotate(-90)" : ""}`}
    >
      {lines.map((text, i) => (
        <tspan key={i} x={0} y={top + i * lineHeight} dy="0.35em">
          {text}
        </tspan>
      ))}
    </text>
  );
}

/** Door and closet swings into the room: the arc and the open leaf. */
export function FeatureSwings({ room, walk }: { room: Room; walk: Walk }) {
  return (
    <g className="swings">
      {onWalls(room, walk).flatMap(({ f, seg, key }) =>
        f.type === "door" || f.type === "closet"
          ? doorArc(seg, f).map((arc, i) => (
              <path
                key={`${key}-${i}`}
                className={cls("swing", !has(f, "length"))}
                d={`${arcPath(arc)} M ${arc.center.x} ${arc.center.y} L ${arc.to.x} ${arc.to.y}`}
              />
            ))
          : [],
      )}
    </g>
  );
}
