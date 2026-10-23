// The planner: room tabs, a toolbar with the variant switcher, and three panes (catalog | plan | details),
// or in view mode (#/<room>[/<variant>]/view) the plan alone, large, with the numbered legend, the room
// list and the total below. App owns the data hooks, the route, the selection, the catalog filters and
// sort (so they survive room switches), the variant actions (duplicate, make staged) and keyboard
// dispatch.
import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { bounds, depthOf, findCollisions, isClosed, keepOutZones, walkWalls } from "../shared/geometry.ts";
import type { KeepOut, Pt } from "../shared/geometry.ts";
import type { Item, Layer, Placement, Room } from "../shared/schema.ts";
import { errorText, getVariants, promoteVariant, putLayout, sketchUrl } from "./api.ts";
import { CatalogPanel } from "./components/CatalogPanel.tsx";
import { DetailsPanel } from "./components/DetailsPanel.tsx";
import type { DetailsActions } from "./components/DetailsPanel.tsx";
import { Essentials } from "./components/Essentials.tsx";
import { Legend } from "./components/Legend.tsx";
import { RoomPlan } from "./components/RoomPlan.tsx";
import { RoomTabs } from "./components/RoomTabs.tsx";
import { Toolbar } from "./components/Toolbar.tsx";
import { VariantBar } from "./components/VariantBar.tsx";
import type { VariantAction } from "./components/VariantBar.tsx";
import { addExtra, moveTo, newPlacement, removeExtra, rotateClockwise, setExtraQty, updatePlacement } from "./edit.ts";
import type { Dims } from "./edit.ts";
import { NO_FILTERS } from "./filters.ts";
import type { Filters, Sort } from "./filters.ts";
import { useCatalog } from "./hooks/useCatalog.ts";
import { useHashRoute } from "./hooks/useHashRoute.ts";
import { useLayout } from "./hooks/useLayout.ts";
import type { LayoutState } from "./hooks/useLayout.ts";
import { useRooms } from "./hooks/useRooms.ts";
import { useVariants } from "./hooks/useVariants.ts";
import { STAGED, parseHash, routeHash } from "./route.ts";
import { copyName, nextVariantId, variantLetter, variantPills, variantTitle } from "./variants.ts";

export type Selection = { kind: "placement"; id: string } | { kind: "item"; id: string } | null;

const ARROWS: Record<string, Pt> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

const NO_ZONES: KeepOut[] = [];

/** Keys typed into a field belong to the field (Backspace, arrows, ⌘Z). */
function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

/** Whether the window still shows that variant (an action's answer must not yank the user elsewhere). */
function stillOn(roomId: string, variant: string): boolean {
  const now = parseHash(window.location.hash);
  return now !== null && now.roomId === roomId && now.variant === variant;
}

/** Counts per item id, from `id` or `id:n` words (a key string, so a drag does not recompute them). */
function countsOf(key: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const word of key.split(" ").filter(Boolean)) {
    const [id = "", n = "1"] = word.split(":");
    counts.set(id, (counts.get(id) ?? 0) + Number(n));
  }
  return counts;
}

export function App() {
  const rooms = useRooms();
  const catalog = useCatalog();
  const route = useHashRoute();
  const variants = useVariants(route.roomId);
  const room = rooms.data?.rooms.find((r) => r.id === route.roomId);
  // A room without walls (the kitchen) never gets a layout file (rules.md F-41): read it, never write it.
  const layout = useLayout(route.roomId, route.variant, { writable: (room?.walls.length ?? 0) > 0, onSaved: () => void variants.refresh() });
  const [selection, setSelection] = useState<Selection>(null);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<Sort>({ key: "name", dir: "asc" });
  const [busy, setBusy] = useState<VariantAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const walk = useMemo(() => walkWalls(room?.walls ?? []), [room]);
  const box = useMemo(() => bounds(walk.points), [walk]);
  const keepOut = useMemo(() => (room ? keepOutZones(room.walls, room.features) : NO_ZONES), [room]);
  const measured = walk.points.length >= 3;
  const itemsById = useMemo(() => new Map(catalog.items.map((i) => [i.id, i])), [catalog.items]);
  const collisions = useMemo(() => findCollisions(layout.placements, itemsById, walk.points, keepOut), [layout.placements, itemsById, walk, keepOut]);
  // Nothing on a wall-less room's tab writes (see useLayout above), nor in view mode, before the
  // variant loads, or while a variant action runs.
  const editable = !route.view && measured && layout.loaded && busy === null;

  // Keyed on the item ids only, so dragging a piece does not re-render the catalog's counts.
  const placedKey = layout.placements.map((p) => p.itemId).join(" ");
  const placedCounts = useMemo(() => countsOf(placedKey), [placedKey]);
  const listedKey = layout.extras.map((e) => `${e.itemId}:${e.qty}`).join(" ");
  const listedCounts = useMemo(() => countsOf(listedKey), [listedKey]);

  // A placement id only means something in its own room (variants of a room keep a piece's id).
  useEffect(() => {
    setSelection((s) => (s?.kind === "placement" ? null : s));
  }, [route.roomId]);
  useEffect(() => {
    setActionError(null);
  }, [route.roomId, route.variant]);
  useEffect(() => {
    const variant = measured ? ` · ${variantTitle(route.variant, layout.name)}` : "";
    document.title = room ? `${room.name}${variant} · Furniture planner` : "Furniture planner";
  }, [room, measured, route.variant, layout.name]);

  const selectedPlacement = selection?.kind === "placement" ? layout.placements.find((p) => p.id === selection.id) : undefined;
  const selectedItem =
    selection?.kind === "item" ? itemsById.get(selection.id) : selectedPlacement ? itemsById.get(selectedPlacement.itemId) : undefined;

  const change = (id: string, fn: (p: Placement, dims: Dims) => Placement) =>
    layout.setPlacements((ps) =>
      updatePlacement(ps, id, (p) => {
        const dims = itemsById.get(p.itemId)?.dimensions;
        return dims ? fn(p, dims) : p;
      }),
    );
  const rotate = (id: string) => change(id, (p, dims) => rotateClockwise(p, dims, box));
  const remove = (id: string) => {
    layout.setPlacements((ps) => ps.filter((p) => p.id !== id));
    setSelection(null);
  };
  const setLayer = (id: string, layer: Layer) => {
    if (!editable) return;
    layout.setPlacements((ps) => updatePlacement(ps, id, (p) => (p.layer === layer ? p : { ...p, layer })));
    layout.flush();
  };
  /** Places the item, on its category's layer, centred on `center` (default: the middle of the room's box) and saves at once. */
  const addItem = (item: Item, center: Pt = { x: box.x + box.w / 2, y: box.y + box.h / 2 }) => {
    const dims = item.dimensions;
    if (!editable || !dims) return;
    let id = "";
    layout.setPlacements((ps) => {
      const p = newPlacement(item, dims, { x: center.x - dims.w / 2, y: center.y - depthOf(dims) / 2 }, box, ps);
      id = p.id;
      return [...ps, p];
    });
    if (id) {
      setSelection({ kind: "placement", id });
      layout.flush();
    }
  };
  const addToList = (item: Item) => {
    if (!editable) return;
    layout.setExtras((es) => addExtra(es, item.id));
    layout.flush();
  };

  const duplicate = async () => {
    const { roomId, variant, view } = route;
    if (!editable) return;
    setBusy("duplicate");
    setActionError(null);
    try {
      // Read the list afresh, so the copy never lands on a variant an agent wrote meanwhile.
      const { variants: listed } = await getVariants(roomId);
      const id = nextVariantId(listed.map((v) => v.variant));
      if (!id) throw new Error("every letter from B to Z is taken");
      await putLayout(roomId, id, { name: copyName(layout.name, variant), notes: layout.notes, placements: layout.placements, extras: layout.extras });
      void variants.refresh();
      if (stillOn(roomId, variant)) window.location.hash = routeHash(roomId, id, view);
    } catch (e) {
      setActionError(`Variant ${variantLetter(variant)} was not duplicated: ${errorText(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const promote = async () => {
    const { roomId, variant, view } = route;
    if (!editable || variant === STAGED) return;
    setBusy("promote");
    setActionError(null);
    try {
      // The swap renames the files: every edit must be on disk under this variant first.
      if (!(await layout.settle())) throw new Error("its last edits are not saved (see the message above)");
      const list = await promoteVariant(roomId, variant);
      variants.set(list);
      if (stillOn(roomId, variant)) window.location.hash = routeHash(roomId, STAGED, view);
    } catch (e) {
      setActionError(`Variant ${variantLetter(variant)} was not made the staged pick: ${errorText(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const actions: DetailsActions = {
    onRotate: () => selectedPlacement && rotate(selectedPlacement.id),
    onRemove: () => selectedPlacement && remove(selectedPlacement.id),
    onLayer: (layer) => selectedPlacement && setLayer(selectedPlacement.id, layer),
    onSelectPlacement: (id) => setSelection({ kind: "placement", id }),
    onSelectItem: (id) => setSelection({ kind: "item", id }),
    onAddToPlan: (item) => addItem(item),
    onAddToList: addToList,
    onExtraQty: (itemId, qty) => {
      if (editable) layout.setExtras((es) => setExtraQty(es, itemId, qty));
    },
    onRemoveExtra: (itemId) => {
      if (!editable) return;
      layout.setExtras((es) => removeExtra(es, itemId));
      layout.flush();
    },
    onRename: (name) => {
      if (editable) layout.setName(name);
    },
    saveItem: catalog.saveItem,
  };

  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || route.view || isTyping(e.target)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (editable) layout.undo();
      return;
    }
    if (mod || e.altKey) return; // leave ⌘R, ⌘←, browser shortcuts alone
    if (e.key === "Escape") {
      setSelection(null);
      return;
    }
    if (!selectedPlacement || !editable) return;
    const arrow = ARROWS[e.key];
    if (arrow) {
      e.preventDefault();
      const step = e.shiftKey ? 12 : 1;
      change(selectedPlacement.id, (p, dims) => moveTo(p, dims, p.x + arrow.x * step, p.y + arrow.y * step, box));
    } else if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      rotate(selectedPlacement.id);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      remove(selectedPlacement.id);
    }
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKeyDown(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  if (!rooms.data) {
    return (
      <div className="app boot">
        {rooms.error ? (
          <div className="fatal">
            <h1>The rooms could not be loaded</h1>
            <p>{rooms.error}</p>
            <button type="button" onClick={() => void rooms.refresh()}>
              Retry
            </button>
          </div>
        ) : (
          <p className="muted">Loading…</p>
        )}
      </div>
    );
  }

  const pills = variantPills(
    variants.variants,
    layout.loaded ? { variant: route.variant, name: layout.name, placements: layout.placements.length, extras: layout.extras.length } : null,
  );

  return (
    <div className={route.view ? "app view" : "app edit"}>
      <div className="screen">
        <header className="top">
          <RoomTabs rooms={rooms.data.rooms} current={route.roomId} view={route.view} />
          <Toolbar
            roomId={route.roomId}
            room={room}
            variant={route.variant}
            variantName={layout.name}
            showVariant={measured}
            box={box}
            measured={measured}
            closed={isClosed(walk)}
            view={route.view}
            saving={layout.saving}
            collisions={collisions}
            canUndo={editable && layout.canUndo}
            onUndo={layout.undo}
          >
            {measured && (
              <VariantBar
                roomId={route.roomId}
                current={route.variant}
                pills={pills}
                view={route.view}
                listError={variants.error}
                busy={busy}
                canDuplicate={editable}
                canPromote={editable}
                onDuplicate={() => void duplicate()}
                onPromote={() => void promote()}
              />
            )}
          </Toolbar>
        </header>
        <main className="workspace">
          {!route.view && (
            <CatalogPanel
              items={catalog.items}
              taxonomy={catalog.taxonomy}
              errors={catalog.errors}
              loading={catalog.loading}
              error={catalog.error}
              rooms={rooms.data.rooms}
              roomName={room?.name ?? route.roomId}
              filters={filters}
              sort={sort}
              selectedItemId={selectedItem?.id ?? null}
              placedCounts={placedCounts}
              listedCounts={listedCounts}
              offerAdd={measured}
              canPlace={editable}
              canList={editable}
              onFilters={setFilters}
              onSort={setSort}
              onSelect={(id) => setSelection({ kind: "item", id })}
              onAdd={(item) => addItem(item)}
              onAddToList={addToList}
              onRetry={() => void catalog.refresh()}
            />
          )}
          <section className="plan-pane" aria-label="Plan">
            <PlanBanners
              layout={layout}
              actionError={actionError}
              onDismissAction={() => setActionError(null)}
              roomsError={rooms.error}
              onRetryRooms={() => void rooms.refresh()}
            />
            {!room ? (
              <div className="unmeasured">
                <h2>“{route.roomId}” is not in rooms.json</h2>
              </div>
            ) : layout.missing ? (
              <MissingVariant room={room} variant={route.variant} view={route.view} />
            ) : !measured ? (
              <Unmeasured
                room={room}
                items={catalog.items}
                loading={catalog.loading}
                onSelect={route.view ? undefined : (id) => setSelection({ kind: "item", id })}
              />
            ) : (
              <RoomPlan
                room={room}
                walk={walk}
                box={box}
                placements={layout.placements}
                itemsById={itemsById}
                collisions={collisions}
                selectedId={selectedPlacement?.id ?? null}
                highlightItemId={selection?.kind === "item" ? selection.id : null}
                editable={editable}
                onSelect={(id) => setSelection(id ? { kind: "placement", id } : null)}
                onChange={layout.setPlacements}
                onCommit={layout.flush}
                onDropItem={(itemId, at) => {
                  const item = itemsById.get(itemId);
                  if (item) addItem(item, at);
                }}
              />
            )}
            <NotDrawn placements={layout.placements} itemsById={itemsById} catalogLoaded={!catalog.loading && !catalog.error} />
          </section>
          {!route.view && (
            <DetailsPanel
              room={room}
              rooms={rooms.data.rooms}
              variant={route.variant}
              variantName={layout.name}
              item={selectedItem}
              placement={selectedPlacement}
              number={selectedPlacement ? layout.placements.indexOf(selectedPlacement) + 1 : null}
              overlapping={selectedPlacement ? collisions.overlapping.has(selectedPlacement.id) : false}
              outside={selectedPlacement ? collisions.outside.has(selectedPlacement.id) : false}
              blocked={(selectedPlacement && collisions.blocked.get(selectedPlacement.id)) || NO_ZONES}
              editable={editable}
              measured={measured}
              catalogReady={!catalog.loading}
              layoutNotes={layout.notes}
              placements={layout.placements}
              extras={layout.extras}
              itemsById={itemsById}
              actions={actions}
            />
          )}
        </main>
      </div>
      {room && !layout.missing && (measured || layout.extras.length > 0) && (
        <Legend room={room} placements={layout.placements} extras={layout.extras} itemsById={itemsById} notes={layout.notes} measured={measured} />
      )}
    </div>
  );
}

type BannerProps = {
  layout: LayoutState;
  actionError: string | null;
  onDismissAction: () => void;
  roomsError: string | null;
  onRetryRooms: () => void;
};

function PlanBanners({ layout, actionError, onDismissAction, roomsError, onRetryRooms }: BannerProps) {
  return (
    <div className="plan-banners">
      {layout.error && (
        <div className="banner error" role="alert">
          <button type="button" className="dismiss" onClick={layout.clearError} aria-label="Dismiss">
            ×
          </button>
          <strong>The layout was not saved: {layout.error.message}</strong>
          {layout.error.issues.length > 0 && (
            <ul>
              {layout.error.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {actionError && (
        <div className="banner error" role="alert">
          <button type="button" className="dismiss" onClick={onDismissAction} aria-label="Dismiss">
            ×
          </button>
          {actionError}
        </div>
      )}
      {layout.loadError && (
        <div className="banner error" role="alert">
          The layout could not be loaded: {layout.loadError}{" "}
          <button type="button" onClick={layout.refresh}>
            Retry
          </button>
        </div>
      )}
      {roomsError && (
        <div className="banner warn">
          rooms.json could not be re-read ({roomsError}); showing the last good copy.{" "}
          <button type="button" onClick={onRetryRooms}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

/** Placements the plan cannot draw: the item is missing from the catalog or has no dimensions. */
function NotDrawn({ placements, itemsById, catalogLoaded }: { placements: Placement[]; itemsById: ReadonlyMap<string, Item>; catalogLoaded: boolean }) {
  const missing = placements.filter((p) => !itemsById.get(p.itemId)?.dimensions);
  if (!catalogLoaded || missing.length === 0) return null;
  return (
    <p className="not-drawn">
      Not drawn:{" "}
      {missing.map((p, i) => (
        <span key={p.id}>
          {i > 0 && "; "}
          <code>{p.id}</code> ({itemsById.has(p.itemId) ? `${p.itemId} has no dimensions` : `${p.itemId} is not in the catalog`})
        </span>
      ))}
    </p>
  );
}

function MissingVariant({ room, variant, view }: { room: Room; variant: string; view: boolean }) {
  return (
    <div className="unmeasured">
      <h2>
        The {room.name.toLowerCase()} has no variant {variantLetter(variant)}
      </h2>
      <p className="muted">It may never have been saved, or “Make staged” swapped it with A.</p>
      <p>
        <a href={routeHash(room.id, STAGED, view)}>Open variant A, the staged pick</a>
      </p>
    </div>
  );
}

/** A room with no walls yet (the kitchen): its notes, its sketch, and the catalog items that list it. */
function Unmeasured({ room, items, loading, onSelect }: { room: Room; items: Item[]; loading: boolean; onSelect?: (itemId: string) => void }) {
  return (
    <div className="unmeasured-scroll">
      <div className="unmeasured">
        <h2>{room.name}: not measured yet</h2>
        {room.notes.map((n, i) => (
          <p key={i}>{n}</p>
        ))}
        {room.sketch && (
          <a href={sketchUrl(room.sketch)} target="_blank" rel="noreferrer" className="sketch-preview">
            <img src={sketchUrl(room.sketch)} alt={`The sketch that shows the ${room.name.toLowerCase()}`} />
          </a>
        )}
        <Essentials room={room} items={items} loading={loading} onSelect={onSelect} />
      </div>
    </div>
  );
}
