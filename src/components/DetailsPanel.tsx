// The right pane. For a selected placement or catalog item: photos (each with its source), the vendor
// link, "Add to plan" and "Add to room list", price with the date it was read, W × D × H,
// category/tags/rooms, and the editable status and notes; for a placement also its layer, why it is
// flagged (overlap, outside, on the stairs, the heater or a swing), rotate/remove and its note. With
// nothing selected: the open variant's name, its numbered pieces, its room list (the extras, with qty)
// and total, the layout's notes (folded on a phone) and the room's notes. A room without walls (the
// kitchen) never gets a layout (rules.md F-41): no add buttons, no name, no room list to edit. The
// read-only copy shows the same facts with nothing to change: the layer, the status, the notes and the
// name as text.
// App renders the summary always and a second panel for a selection, with a close button: beside the
// plan the selection takes the summary's place, and below 1180px, where the details are not a side
// pane, it opens as a sheet over the bottom of the screen (styles.css) while the summary stays put.
import { useRef, useState } from "react";
import { dimensionsText, inchesText, money } from "../../shared/format.ts";
import type { KeepOut } from "../../shared/geometry.ts";
import { ITEM_STATUSES, LAYERS } from "../../shared/schema.ts";
import type { Extra, Item, ItemStatus, Layer, Placement, Room } from "../../shared/schema.ts";
import { errorText, imageUrl } from "../api.ts";
import { BACK_TO, hostOf, keepOutReasons } from "../edit.ts";
import { isOneColumn } from "../screen.ts";
import { variantLetter } from "../variants.ts";
import { StatusChip } from "./Chips.tsx";
import { RoomList, TotalBlock } from "./RoomList.tsx";

export type DetailsActions = {
  onRotate: () => void;
  onRemove: () => void;
  onLayer: (layer: Layer) => void;
  onSelectPlacement: (id: string) => void;
  onSelectItem: (itemId: string) => void;
  onAddToPlan: (item: Item) => void;
  onAddToList: (item: Item) => void;
  onExtraQty: (itemId: string, qty: number) => void;
  onRemoveExtra: (itemId: string) => void;
  onRename: (name: string) => void;
  saveItem: (item: Item) => Promise<Item>;
};

type Props = {
  /** The room's summary (nothing selected), or a selected piece or catalog item. */
  kind: "summary" | "selection";
  /** Deselects; a selection panel shows a close button for it. */
  onClose?: () => void;
  room: Room | undefined;
  rooms: Room[];
  variant: string;
  variantName: string;
  item: Item | undefined;
  placement: Placement | undefined;
  number: number | null;
  overlapping: boolean;
  outside: boolean;
  blocked: readonly KeepOut[];
  /** The plan, the room list and the variant's name can change (edit mode, a room with walls, loaded). */
  editable: boolean;
  /** The published read-only copy: nothing is offered that would save, not even disabled. */
  readOnly: boolean;
  /** The room has walls; one without (the kitchen) offers nothing to add and nothing to edit. */
  measured: boolean;
  catalogReady: boolean;
  layoutNotes: string;
  placements: Placement[];
  extras: Extra[];
  itemsById: ReadonlyMap<string, Item>;
  actions: DetailsActions;
};

const LAYER_TEXT: Record<Layer, string> = {
  floor: "Floor: stands on the floor",
  rug: "Rug: lies under the furniture",
  top: "Top: on another piece or a wall",
};

export function DetailsPanel(props: Props) {
  const { kind, onClose, item, placement, actions } = props;
  return (
    <aside className={`details pane ${kind}`} aria-label={kind === "selection" ? "Selected item" : "Details"}>
      {onClose && (
        <div className="close-row">
          <button type="button" className="close" onClick={onClose} aria-label="Close the details" title="Close (Esc)">
            ×
          </button>
        </div>
      )}
      {placement && (
        <PlacementBar
          placement={placement}
          number={props.number}
          overlapping={props.overlapping}
          outside={props.outside}
          blocked={props.blocked}
          editable={props.editable}
          readOnly={props.readOnly}
          onRotate={actions.onRotate}
          onRemove={actions.onRemove}
          onLayer={actions.onLayer}
        />
      )}
      {item ? (
        <ItemDetails
          key={item.id}
          item={item}
          rooms={props.rooms}
          placed={props.placements.filter((p) => p.itemId === item.id).length}
          listed={props.extras.find((e) => e.itemId === item.id)?.qty ?? 0}
          offerAdd={props.measured && !props.readOnly}
          readOnly={props.readOnly}
          canPlace={props.editable}
          canList={props.editable}
          onAddToPlan={actions.onAddToPlan}
          onAddToList={actions.onAddToList}
          saveItem={actions.saveItem}
        />
      ) : placement ? (
        <p className="banner warn">
          This piece's item, <code>{placement.itemId}</code>, is not in the catalog.
        </p>
      ) : (
        <RoomSummary {...props} />
      )}
    </aside>
  );
}

type BarProps = {
  placement: Placement;
  number: number | null;
  overlapping: boolean;
  outside: boolean;
  blocked: readonly KeepOut[];
  editable: boolean;
  readOnly: boolean;
  onRotate: () => void;
  onRemove: () => void;
  onLayer: (layer: Layer) => void;
};

function PlacementBar({ placement, number, overlapping, outside, blocked, editable, readOnly, onRotate, onRemove, onLayer }: BarProps) {
  return (
    <section className="placement-bar">
      <div className="placement-head">
        {number !== null && <span className="num">{number}</span>}
        <code>{placement.id}</code>
        <span className="muted">
          back to the {BACK_TO[placement.rotation]} wall · x {inchesText(placement.x)}, y {inchesText(placement.y)}
        </span>
      </div>
      {overlapping && <p className="flag bad">Overlaps another piece</p>}
      {outside && <p className="flag bad">Runs outside the room</p>}
      {keepOutReasons(blocked).map((reason) => (
        <p key={reason} className="flag warn">
          {reason}
        </p>
      ))}
      {placement.note && <p className="placement-note">{placement.note}</p>}
      {readOnly ? (
        <p className="placement-layer">Layer: {LAYER_TEXT[placement.layer]}</p>
      ) : (
        <label className="field layer-field">
          <span>Layer</span>
          <select value={placement.layer} disabled={!editable} onChange={(e) => onLayer(e.target.value as Layer)}>
            {LAYERS.map((l) => (
              <option key={l} value={l}>
                {LAYER_TEXT[l]}
              </option>
            ))}
          </select>
        </label>
      )}
      {editable && (
        <div className="actions">
          <button type="button" onClick={onRotate}>
            Rotate 90° <kbd>R</kbd>
          </button>
          <button type="button" className="danger" onClick={onRemove}>
            Remove <kbd>Del</kbd>
          </button>
        </div>
      )}
    </section>
  );
}

type SaveNote = { state: "idle" | "saving" | "saved" | "error"; message?: string };

type ItemProps = {
  item: Item;
  rooms: Room[];
  placed: number;
  listed: number;
  offerAdd: boolean;
  /** Status and notes as text, not fields. */
  readOnly: boolean;
  canPlace: boolean;
  canList: boolean;
  onAddToPlan: (item: Item) => void;
  onAddToList: (item: Item) => void;
  saveItem: (item: Item) => Promise<Item>;
};

function ItemDetails({ item, rooms, placed, listed, offerAdd, readOnly, canPlace, canList, onAddToPlan, onAddToList, saveItem }: ItemProps) {
  const [note, setNote] = useState<SaveNote>({ state: "idle" });
  const [draft, setDraft] = useState(item.notes);
  const [savedNotes, setSavedNotes] = useState(item.notes);
  if (item.notes !== savedNotes) {
    // The notes changed on disk (an agent, or our own save): show them.
    setSavedNotes(item.notes);
    setDraft(item.notes);
  }
  const save = async (next: Item) => {
    setNote({ state: "saving" });
    try {
      await saveItem(next);
      setNote({ state: "saved" });
    } catch (e) {
      setNote({ state: "error", message: errorText(e) });
    }
  };
  const dims = item.dimensions;
  const roomName = new Map(rooms.map((r) => [r.id as string, r.name]));
  const uses = [placed > 0 && `${placed} on the plan`, listed > 0 && `${listed} on the room list`].filter(Boolean).join(" · ");

  return (
    <section className="item-details">
      <Gallery item={item} />
      <h2>{item.name}</h2>
      {item.brand && <p className="brand">{item.brand}</p>}
      {item.url ? (
        <a className="vendor-link" href={item.url} target="_blank" rel="noreferrer">
          Open at {hostOf(item.url)} ↗
        </a>
      ) : (
        <p className="muted">Already owned; no product page.</p>
      )}
      {offerAdd && (
        <div className="item-actions">
          {dims && (
            <button
              type="button"
              onClick={() => onAddToPlan(item)}
              disabled={!canPlace}
              title={canPlace ? "Place it in the middle of the room, on its category's layer" : "Open the room in edit mode to place items"}
            >
              Add to plan
            </button>
          )}
          <button
            type="button"
            onClick={() => onAddToList(item)}
            disabled={!canList}
            title={canList ? "Add one to the room list (no floor space: bedding, curtains, cushions…)" : "Open the room in edit mode to change its room list"}
          >
            Add to room list
          </button>
          {uses && <span className="muted small">{uses}</span>}
        </div>
      )}
      <dl className="facts">
        <dt>Price</dt>
        <dd>
          {item.price ? (
            <>
              {money(item.price.amount)} <span className="muted">as of {item.price.asOf}</span>
            </>
          ) : (
            <span className="muted">not recorded</span>
          )}
        </dd>
        <dt>{dims?.h !== undefined ? "W × D × H" : "W × D"}</dt>
        <dd>
          {dims ? dimensionsText(dims) : <span className="muted">not on the product page, so it can't be placed (the room list takes it)</span>}
          {dims?.raw && (
            <div className="muted small">
              as listed: “{dims.raw}”{dims.source ? ` (${dims.source})` : ""}
            </div>
          )}
        </dd>
        <dt>Captured</dt>
        <dd>
          {item.captured.date} by {item.captured.by} ({item.captured.method})
        </dd>
        <dt>Id</dt>
        <dd>
          <code>{item.id}</code>
        </dd>
        {readOnly && item.notes && (
          <>
            <dt>Notes</dt>
            <dd className="pre">{item.notes}</dd>
          </>
        )}
      </dl>
      <div className="chips">
        <StatusChip status={item.status} />
        <span className="chip category">{item.category}</span>
        {item.tags.map((t) => (
          <span key={t} className="chip tag">
            #{t}
          </span>
        ))}
        {item.rooms.map((r) => (
          <span key={r} className="chip room">
            {roomName.get(r) ?? r}
          </span>
        ))}
      </div>
      {!readOnly && (
        <>
          <label className="field">
            <span>Status</span>
            <select value={item.status} onChange={(e) => void save({ ...item, status: e.target.value as ItemStatus })}>
              {ITEM_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Notes</span>
            <textarea
              rows={4}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                if (draft !== item.notes) void save({ ...item, notes: draft });
              }}
            />
          </label>
          <p className={`save-note ${note.state}`} role="status">
            {note.state === "saving" ? "Saving…" : note.state === "saved" ? "Saved to the catalog" : note.state === "error" ? `Not saved: ${note.message}` : ""}
          </p>
        </>
      )}
    </section>
  );
}

function Gallery({ item }: { item: Item }) {
  const [index, setIndex] = useState(0);
  const photos = item.images;
  const current = photos[Math.min(index, photos.length - 1)];
  if (!current) return <div className="gallery empty">No photos yet</div>;
  return (
    <figure className="gallery">
      <a href={imageUrl(current.file)} target="_blank" rel="noreferrer" title="Open the photo">
        <img src={imageUrl(current.file)} alt={current.caption ?? item.name} />
      </a>
      <figcaption>
        {current.caption && <span>{current.caption} </span>}
        {current.sourceUrl && (
          <a className="source" href={current.sourceUrl} target="_blank" rel="noreferrer">
            source: {hostOf(current.sourceUrl)} ↗
          </a>
        )}
      </figcaption>
      {photos.length > 1 && (
        <div className="thumbs">
          {photos.map((p, i) => (
            <button key={p.file} type="button" className={i === index ? "active" : undefined} onClick={() => setIndex(i)} aria-label={`Photo ${i + 1}`}>
              <img src={imageUrl(p.file)} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </figure>
  );
}

const LAYER_TAG: Record<Layer, string | null> = { floor: null, rug: "rug", top: "on top" };

function RoomSummary(props: Props) {
  const { room, variant, variantName, placements, extras, itemsById, layoutNotes, editable, readOnly, measured, catalogReady, actions } = props;
  // The notes run to several screens on a phone, between the room list and the catalog: folded there.
  const [notesOpen] = useState(() => !isOneColumn());
  if (!measured) return <NoLayoutSummary {...props} />;
  return (
    <section className="room-summary">
      <h2>
        {room?.name ?? "Room"} <span className="muted">· {variantLetter(variant)}</span>
      </h2>
      {readOnly ? (
        variantName.trim() && <p className="variant-name">{variantName.trim()}</p>
      ) : (
        <VariantName key={`${room?.id}/${variant}`} name={variantName} variant={variant} editable={editable} onRename={actions.onRename} />
      )}
      <p className="muted">Tap or click a piece on the plan, or an item in the catalog, for its photos, price and product page.</p>
      <h3>In this room</h3>
      {placements.length === 0 ? (
        <p className="muted small">Nothing on the plan yet.</p>
      ) : (
        <ol className="placed-list">
          {placements.map((p, i) => {
            const item = itemsById.get(p.itemId);
            const tag = LAYER_TAG[p.layer];
            return (
              <li key={p.id}>
                <span className="num">{i + 1}</span>
                <button type="button" className="link" onClick={() => actions.onSelectPlacement(p.id)}>
                  {item?.name ?? p.itemId}
                </button>
                {tag && <span className="chip layer">{tag}</span>}
                <span className="placed-price">{item?.price ? money(item.price.amount) : <span className="muted">no price</span>}</span>
              </li>
            );
          })}
        </ol>
      )}
      <h3>Room list</h3>
      {extras.length === 0 ? (
        <p className="muted small">
          {readOnly
            ? "Nothing on the room list."
            : "Bedding, curtains, cushions and the like: “Add to room list” on a catalog row or an item puts them here."}
        </p>
      ) : (
        <RoomList
          extras={extras}
          itemsById={itemsById}
          edit={editable ? { onQty: actions.onExtraQty, onRemove: actions.onRemoveExtra } : undefined}
          onSelectItem={actions.onSelectItem}
        />
      )}
      {catalogReady && (placements.length > 0 || extras.length > 0) && <TotalBlock placements={placements} extras={extras} itemsById={itemsById} />}
      {layoutNotes && (
        <details className="layout-notes-fold" open={notesOpen}>
          <summary>Layout notes</summary>
          <p className="pre">{layoutNotes}</p>
        </details>
      )}
      {room && room.notes.length > 0 && (
        <>
          <h3>About this room</h3>
          <ul className="room-notes">
            {room.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * A room without walls (the kitchen): it never gets a layout (rules.md F-41), so nothing here edits one.
 * Its essentials, from the catalog, are in the middle pane; a layout file found anyway is listed read-only.
 */
function NoLayoutSummary({ room, placements, extras, itemsById, catalogReady, actions }: Props) {
  return (
    <section className="room-summary">
      <h2>{room?.name ?? "Room"}</h2>
      <p className="muted">
        The {room?.name.toLowerCase() ?? "room"} has no layout: its walls are not measured and it is not staged. Its essentials are the catalog
        items that list it, shown in the middle with their total.
      </p>
      {(placements.length > 0 || extras.length > 0) && (
        <>
          <h3>In the layout file</h3>
          {extras.length > 0 && <RoomList extras={extras} itemsById={itemsById} onSelectItem={actions.onSelectItem} />}
          {catalogReady && <TotalBlock placements={placements} extras={extras} itemsById={itemsById} />}
        </>
      )}
      {room && room.notes.length > 0 && (
        <>
          <h3>About this room</h3>
          <ul className="room-notes">
            {room.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** The variant's name; saved when the field loses focus or on Enter, put back on Escape. */
function VariantName({ name, variant, editable, onRename }: { name: string; variant: string; editable: boolean; onRename: (name: string) => void }) {
  const [draft, setDraft] = useState(name);
  const [saved, setSaved] = useState(name);
  const cancelled = useRef(false); // Escape blurs the field with the old draft still in this closure
  if (name !== saved) {
    // Renamed on disk (an agent) or by our own save: show it.
    setSaved(name);
    setDraft(name);
  }
  const commit = () => {
    if (cancelled.current) cancelled.current = false;
    else if (draft.trim() !== name) onRename(draft.trim());
  };
  return (
    <label className="field variant-name">
      <span>Name of variant {variantLetter(variant)}</span>
      <input
        type="text"
        value={draft}
        placeholder={variant === "a" ? "the staged pick" : "an alternative"}
        disabled={!editable}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            cancelled.current = true;
            setDraft(name);
            e.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}
