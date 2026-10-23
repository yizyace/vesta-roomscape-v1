// The placed furniture in three layers, bottom to top. Rugs: the photo at about half opacity, a thin
// outline, no front tick, never red for overlapping (only for leaving the room), and a one-line label
// where the furniture standing on them leaves it room. Floor pieces: the photo cropped to the footprint,
// name and size on a label, a tick on the front edge. Top pieces (a TV on its console, a lamp, wall
// art): dashed and slightly translucent, above the rest. A floor piece overlapping another floor piece,
// or any piece leaving the room, has a red outline; a floor piece on a keep-out zone (the stairs, a
// heater, a door's swing) an amber one, and the floor it takes is shaded amber over everything. The
// number badges are for view mode and print (the Legend lists them).
import type { PointerEvent } from "react";
import { placementRect } from "../../../shared/geometry.ts";
import type { Collisions, Rect } from "../../../shared/geometry.ts";
import { dimensionsText, money } from "../../../shared/format.ts";
import type { Item, Layer, Placement, Rotation } from "../../../shared/schema.ts";
import { imageUrl } from "../../api.ts";
import { BACK_TO, keepOutReasons } from "../../edit.ts";
import type { Dims } from "../../edit.ts";
import { intersectRect, pointsAttr, rectAttrs, rugLabelSpot } from "./drawing.ts";
import { ellipsize, textWidth, wrap } from "./text.ts";

/** Bottom to top; within a layer, the layout's order. */
const DRAW_ORDER: readonly Layer[] = ["rug", "floor", "top"];

type Props = {
  placements: Placement[];
  itemsById: ReadonlyMap<string, Item>;
  collisions: Collisions;
  selectedId: string | null;
  highlightItemId: string | null;
  interactive: boolean;
  onPointerDown: (e: PointerEvent<SVGGElement>, p: Placement) => void;
  onSelect: (id: string) => void;
};

type Drawn = { p: Placement; item: Item; dims: Dims; rect: Rect; number: number };
type Status = "bad" | "blocked" | null;

export function Placements({ placements, itemsById, collisions, selectedId, highlightItemId, interactive, onPointerDown, onSelect }: Props) {
  const drawn: Drawn[] = [];
  placements.forEach((p, i) => {
    const item = itemsById.get(p.itemId);
    // An item missing from the catalog, or without dimensions, is listed under the plan as not drawn.
    if (item?.dimensions) drawn.push({ p, item, dims: item.dimensions, rect: placementRect(item.dimensions, p), number: i + 1 });
  });
  const standing = drawn.filter((d) => d.p.layer !== "rug").map((d) => d.rect);
  const status = (p: Placement): Status =>
    collisions.overlapping.has(p.id) || collisions.outside.has(p.id) ? "bad" : collisions.blocked.has(p.id) ? "blocked" : null;

  return (
    <g className="placements">
      {DRAW_ORDER.map((layer) => (
        <g key={layer} className={`layer layer-${layer}`}>
          {drawn
            .filter((d) => d.p.layer === layer)
            .map((d) => (
              <Piece
                key={d.p.id}
                d={d}
                status={status(d.p)}
                standing={layer === "rug" ? standing : undefined}
                selected={d.p.id === selectedId}
                highlighted={d.p.itemId === highlightItemId}
                interactive={interactive}
                onPointerDown={onPointerDown}
                onSelect={onSelect}
              />
            ))}
        </g>
      ))}
      <KeepOutHits drawn={drawn} collisions={collisions} />
    </g>
  );
}

/** The floor a blocked piece takes from a keep-out zone, shaded above every layer. */
function KeepOutHits({ drawn, collisions }: { drawn: Drawn[]; collisions: Collisions }) {
  const hits: { key: string; rect: Rect; title: string }[] = [];
  for (const d of drawn) {
    collisions.blocked.get(d.p.id)?.forEach((zone, i) => {
      const rect = intersectRect(d.rect, zone.rect);
      if (rect) hits.push({ key: `${d.p.id}-${i}`, rect, title: `${d.number}. ${d.item.name}: ${keepOutReasons([zone])[0]?.toLowerCase()}` });
    });
  }
  if (hits.length === 0) return null;
  return (
    <g className="keepout-hits">
      {hits.map((h) => (
        <rect key={h.key} className="keepout-hit" {...rectAttrs(h.rect)}>
          <title>{h.title}</title>
        </rect>
      ))}
    </g>
  );
}

type PieceProps = {
  d: Drawn;
  status: Status;
  /** For a rug: the footprints standing on the floor (and above), which its label keeps clear of. */
  standing?: Rect[];
  selected: boolean;
  highlighted: boolean;
  interactive: boolean;
  onPointerDown: (e: PointerEvent<SVGGElement>, p: Placement) => void;
  onSelect: (id: string) => void;
};

function Piece({ d, status, standing, selected, highlighted, interactive, onPointerDown, onSelect }: PieceProps) {
  const { p, item, dims, rect: r, number } = d;
  const photo = item.images[0];
  const rug = p.layer === "rug";
  const className = ["piece", `layer-${p.layer}`, status, selected && "selected", highlighted && "highlighted"].filter(Boolean).join(" ");
  const price = item.price ? ` · ${money(item.price.amount)}` : "";
  const where =
    p.layer === "rug"
      ? "A rug, drawn under the furniture."
      : p.layer === "top"
        ? `On top of a piece or on a wall, back to the ${BACK_TO[p.rotation]} wall.`
        : `Back to the ${BACK_TO[p.rotation]} wall.`;
  return (
    <g
      className={className}
      data-placement={p.id}
      tabIndex={interactive ? 0 : undefined}
      role={interactive ? "button" : undefined}
      aria-label={`${number}. ${item.name}, ${dimensionsText(dims)}${rug ? ", rug" : p.layer === "top" ? ", on top" : ""}`}
      onPointerDown={(e) => onPointerDown(e, p)}
      onDoubleClick={() => {
        if (item.url) window.open(item.url, "_blank", "noopener,noreferrer");
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(p.id);
        }
      }}
    >
      <title>{`${number}. ${item.name} — ${dimensionsText(dims)}${price}. ${where}${item.url ? " Double-click opens the product page." : ""}`}</title>
      <rect className="piece-fill" {...rectAttrs(r)} />
      {photo && (
        // A nested viewport clips the photo to the footprint; "slice" fills it edge to edge.
        <svg className="piece-photo" {...rectAttrs(r)} overflow="hidden">
          <image href={imageUrl(photo.file)} width="100%" height="100%" preserveAspectRatio="xMidYMid slice" />
        </svg>
      )}
      <rect className="piece-edge" {...rectAttrs(r)} />
      {rug ? (
        <RugLabel r={r} standing={standing ?? []} name={item.name} dims={dims} number={number} />
      ) : (
        <>
          <polygon className="piece-front" points={pointsAttr(frontTick(r, p.rotation))} />
          <PieceLabel r={r} name={item.name} dims={dims} />
          <Badge x={r.x} y={r.y} radius={Math.min(3.5, r.w / 4, r.h / 4)} number={number} />
        </>
      )}
    </g>
  );
}

/** The plan number in a circle whose top-left is (x, y) plus a small inset; too small to read: none. */
function Badge({ x, y, radius, number }: { x: number; y: number; radius: number; number: number }) {
  if (radius < 1.5) return null;
  return (
    <g className="badge">
      <circle cx={x + radius + 0.8} cy={y + radius + 0.8} r={radius} />
      <text x={x + radius + 0.8} y={y + radius + 0.8} dy="0.35em" fontSize={radius * 1.2} textAnchor="middle">
        {number}
      </text>
    </g>
  );
}

/** A small triangle pointing out of the front edge: down at 0°, left at 90°, up at 180°, right at 270°. */
function frontTick(r: Rect, rotation: Rotation): { x: number; y: number }[] {
  const s = Math.max(1.5, Math.min(4, r.w * 0.25, r.h * 0.25));
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const inset = 0.8;
  switch (rotation) {
    case 0: {
      const y = r.y + r.h - inset;
      return [{ x: cx - s / 2, y: y - s * 0.7 }, { x: cx + s / 2, y: y - s * 0.7 }, { x: cx, y }];
    }
    case 90: {
      const x = r.x + inset;
      return [{ x: x + s * 0.7, y: cy - s / 2 }, { x: x + s * 0.7, y: cy + s / 2 }, { x, y: cy }];
    }
    case 180: {
      const y = r.y + inset;
      return [{ x: cx - s / 2, y: y + s * 0.7 }, { x: cx + s / 2, y: y + s * 0.7 }, { x: cx, y }];
    }
    case 270: {
      const x = r.x + r.w - inset;
      return [{ x: x - s * 0.7, y: cy - s / 2 }, { x: x - s * 0.7, y: cy + s / 2 }, { x, y: cy }];
    }
  }
}

/** Name (up to three lines) and size, centred on a translucent plate so it reads over a photo. */
function PieceLabel({ r, name, dims }: { r: Rect; name: string; dims: Dims }) {
  // 4–6" in half-inch steps (few distinct sizes keep the width cache small).
  const font = Math.round(Math.max(4, Math.min(6, Math.min(r.w, r.h) / 6)) * 2) / 2;
  const small = font * 0.8;
  const pad = 1.2;
  const maxWidth = r.w - 2 * pad - 1.6;
  const rows = Math.floor((r.h - 2 * pad) / (font * 1.2));
  if (maxWidth < font * 1.5 || rows < 1) return null;
  const nameLines = wrap(name, maxWidth, font, Math.min(3, Math.max(1, rows - 1)), 600);
  const lines = [
    ...nameLines.map((text) => ({ text, size: font, weight: 600 })),
    ...(rows > nameLines.length ? [{ text: sizeText(dims, maxWidth, small), size: small, weight: 400 }] : []),
  ];
  const heights = lines.map((l) => l.size * 1.2);
  const blockHeight = heights.reduce((a, b) => a + b, 0);
  const blockWidth = Math.max(...lines.map((l) => textWidth(l.text, l.size, l.weight)));
  const cx = r.x + r.w / 2;
  const top = r.y + r.h / 2 - blockHeight / 2;
  const centers = heights.map((h, i) => top + heights.slice(0, i).reduce((a, b) => a + b, 0) + h / 2);
  return (
    <g className="piece-label">
      <rect x={cx - blockWidth / 2 - 0.8} y={top - 0.3} width={blockWidth + 1.6} height={blockHeight + 0.6} rx={1} />
      <text textAnchor="middle">
        {lines.map((l, i) => (
          <tspan key={i} x={cx} y={centers[i]} dy="0.35em" fontSize={l.size} fontWeight={l.weight}>
            {l.text}
          </tspan>
        ))}
      </text>
    </g>
  );
}

/**
 * A rug's badge and one line ("name · W × D") inside its bottom or top edge, in the widest stretch the
 * pieces standing on it leave uncovered; with no such stretch, only the badge in the top-left corner.
 */
function RugLabel({ r, standing, name, dims, number }: { r: Rect; standing: Rect[]; name: string; dims: Dims; number: number }) {
  const font = Math.round(Math.max(3.5, Math.min(4.5, Math.min(r.w, r.h) / 10)) * 2) / 2;
  const h = font * 1.7;
  const spot = r.h >= h * 2 && r.w >= 12 ? rugLabelSpot(r, standing, h) : null;
  if (!spot) return <Badge x={r.x} y={r.y} radius={Math.min(3.5, r.w / 4, r.h / 4)} number={number} />;
  const radius = Math.min(3, h / 2 - 0.4);
  const pad = 1;
  const textX = spot.x + pad + 2 * radius + 1.6;
  const maxWidth = spot.x + spot.w - pad - textX;
  // The name gives way before the size: "TIOKRONA Rug, flat… · 118 × 94"".
  const size = dimensionsText({ w: dims.w, d: dims.d });
  const forName = maxWidth - textWidth(` · ${size}`, font, 500);
  const text =
    forName >= font * 3 ? `${ellipsize(name, forName, font, 500)} · ${size}` : maxWidth >= font * 2 ? ellipsize(size, maxWidth, font, 500) : "";
  const cy = spot.y + h / 2;
  return (
    <>
      {text && (
        <g className="piece-label rug-label">
          <rect x={textX - 0.8} y={cy - font * 0.65} width={textWidth(text, font, 500) + 1.6} height={font * 1.3} rx={1} />
          <text x={textX} y={cy} dy="0.35em" fontSize={font} fontWeight={500}>
            {text}
          </text>
        </g>
      )}
      <Badge x={spot.x + pad - 0.8} y={cy - radius - 0.8} radius={radius} number={number} />
    </>
  );
}

/** W × D × H when it fits, else the footprint W × D (what the plan shows), cut if need be. */
function sizeText(dims: Dims, maxWidth: number, size: number): string {
  const full = dimensionsText(dims);
  if (dims.h === undefined || textWidth(full, size) <= maxWidth) return ellipsize(full, maxWidth, size);
  return ellipsize(dimensionsText({ w: dims.w, d: dims.d }), maxWidth, size);
}
