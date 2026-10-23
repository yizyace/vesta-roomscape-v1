// One room to scale: an SVG in inches (viewBox = everything drawn around the room plus a margin), a 12"
// grid on the floor, walls and features (the stair band among them), the placed furniture in its three
// layers (rugs, floor pieces, pieces on top) with the keep-out overlaps shaded, and the door swings
// above it all. Editing: drag a piece of any layer (pointer capture, snapped to 1", kept inside the
// room's box; the topmost piece under the pointer wins) or drop a catalog row on the plan. Keyboard
// editing is dispatched by App.
import { useMemo, useRef } from "react";
import type { CSSProperties, DragEvent, PointerEvent } from "react";
import { snap } from "../../shared/geometry.ts";
import type { Collisions, Pt, Rect, Walk } from "../../shared/geometry.ts";
import type { Item, Placement, Room } from "../../shared/schema.ts";
import { ITEM_DRAG_TYPE, isDragStart, moveTo, updatePlacement } from "../edit.ts";
import type { Dims } from "../edit.ts";
import type { HistoryMode, PlacementsUpdate } from "../hooks/useLayout.ts";
import { PAD, drawingExtent, labelScale, padRect, pointsAttr } from "./plan/drawing.ts";
import { FeatureLabels, FeatureShapes, FeatureSwings } from "./plan/Features.tsx";
import { Placements } from "./plan/Placements.tsx";
import { WallLabels, Walls } from "./plan/Walls.tsx";

const GRID = 12;
const MASK_ID = "fp-walls-mask";
const FLOOR_CLIP_ID = "fp-floor-clip";
const HATCH_ID = "fp-heater-hatch"; // styles.css fills `.heater` with it

type Props = {
  room: Room;
  walk: Walk;
  box: Rect;
  placements: Placement[];
  itemsById: ReadonlyMap<string, Item>;
  collisions: Collisions;
  selectedId: string | null;
  highlightItemId: string | null;
  editable: boolean;
  onSelect: (placementId: string | null) => void;
  onChange: (update: PlacementsUpdate, mode?: HistoryMode) => void;
  onCommit: () => void;
  onDropItem: (itemId: string, at: Pt) => void;
};

/** `press` is in client pixels (the drag threshold), `start` in plan inches. */
type Drag = { id: string; pointerId: number; press: Pt; start: Pt; origin: Pt; dims: Dims; moved: boolean };

export function RoomPlan(props: Props) {
  const { room, walk, box, placements, itemsById, collisions, selectedId, highlightItemId, editable } = props;
  const { onSelect, onChange, onCommit, onDropItem } = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const k = useMemo(() => labelScale(walk), [walk]);
  const frame = useMemo(() => padRect(drawingExtent(room, walk, k), PAD * k), [room, walk, k]);

  // The room itself only changes when rooms.json does; keep its elements across drags.
  const floor = useMemo(
    () => (
      <>
        <polygon className="floor" points={pointsAttr(walk.points)} />
        <path className="grid" d={gridPath(box)} clipPath={`url(#${FLOOR_CLIP_ID})`} />
        <FeatureShapes room={room} walk={walk} layer="floor" k={k} />
        <Walls room={room} walk={walk} frame={frame} maskId={MASK_ID} />
        <FeatureShapes room={room} walk={walk} layer="wall" k={k} />
        <WallLabels room={room} walk={walk} k={k} />
        <FeatureLabels room={room} walk={walk} k={k} />
      </>
    ),
    [room, walk, box, frame, k],
  );
  const swings = useMemo(() => <FeatureSwings room={room} walk={walk} />, [room, walk]);

  /** Client pixels to plan inches through the SVG's current transform (viewBox, letterboxing). */
  const toPlan = (clientX: number, clientY: number): Pt | null => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };

  const startDrag = (e: PointerEvent<SVGGElement>, p: Placement) => {
    if (e.button !== 0) return;
    e.stopPropagation(); // not a click on the background
    onSelect(p.id);
    const dims = itemsById.get(p.itemId)?.dimensions;
    const at = toPlan(e.clientX, e.clientY);
    if (!editable || !dims || !at) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: p.id, pointerId: e.pointerId, press: { x: e.clientX, y: e.clientY }, start: at, origin: { x: p.x, y: p.y }, dims, moved: false };
  };

  const moveDrag = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    // A click only selects: snapping a piece that sits between grid lines would otherwise move it.
    if (!d.moved && !isDragStart(d.press, { x: e.clientX, y: e.clientY })) return;
    const at = toPlan(e.clientX, e.clientY);
    if (!at) return;
    const x = snap(d.origin.x + at.x - d.start.x);
    const y = snap(d.origin.y + at.y - d.start.y);
    let changed = false;
    // The first real move records the undo step; the rest of the drag folds into it.
    onChange(
      (ps) => {
        const next = updatePlacement(ps, d.id, (q) => moveTo(q, d.dims, x, y, box));
        changed = next !== ps;
        return next;
      },
      d.moved ? "replace" : "push",
    );
    if (changed) d.moved = true;
  };

  const endDrag = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    drag.current = null;
    if (d.moved) onCommit(); // save now rather than after the debounce
  };

  const onDragOver = (e: DragEvent<SVGSVGElement>) => {
    if (!editable || !e.dataTransfer.types.includes(ITEM_DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const onDrop = (e: DragEvent<SVGSVGElement>) => {
    const id = e.dataTransfer.getData(ITEM_DRAG_TYPE);
    const at = toPlan(e.clientX, e.clientY);
    if (!editable || !id || !at) return;
    e.preventDefault();
    onDropItem(id, at);
  };

  return (
    <svg
      ref={svgRef}
      className={editable ? "plan editable" : "plan"}
      viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ "--plan-aspect": `${frame.w} / ${frame.h}` } as CSSProperties}
      role="group"
      aria-label={`${room.name}, drawn to scale`}
      onPointerDown={() => onSelect(null)}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <defs>
        <clipPath id={FLOOR_CLIP_ID}>
          <polygon points={pointsAttr(walk.points)} />
        </clipPath>
        <pattern id={HATCH_ID} patternUnits="userSpaceOnUse" width={2.5} height={2.5} patternTransform="rotate(45)">
          <rect className="hatch-bg" width={2.5} height={2.5} />
          <line className="hatch-line" x1={0} y1={0} x2={0} y2={2.5} />
        </pattern>
      </defs>
      {floor}
      <Placements
        placements={placements}
        itemsById={itemsById}
        collisions={collisions}
        selectedId={selectedId}
        highlightItemId={highlightItemId}
        interactive={editable}
        onPointerDown={startDrag}
        onSelect={onSelect}
      />
      {swings}
    </svg>
  );
}

/** Lines every 12" from the room's origin, across its box (clipped to the floor). */
function gridPath(box: Rect): string {
  const parts: string[] = [];
  for (let x = Math.ceil(box.x / GRID) * GRID; x <= box.x + box.w; x += GRID) parts.push(`M ${x} ${box.y} V ${box.y + box.h}`);
  for (let y = Math.ceil(box.y / GRID) * GRID; y <= box.y + box.h; y += GRID) parts.push(`M ${box.x} ${y} H ${box.x + box.w}`);
  return parts.join(" ");
}
