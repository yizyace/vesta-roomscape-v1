// The left pane: search, filters and sort over the catalog, one row per item (thumbnail, name, size,
// price with the date it was read, status, how many the open variant uses). A row drags onto the plan,
// and "Add to plan" drops the item in the middle of the room on its category's layer; bedding,
// curtains, textiles, bath and kitchenware get "Add to room list" instead (they take no floor space).
// A room without walls (the kitchen) takes neither: it never gets a layout. Files the server could not
// parse are listed in a dismissible banner. On a phone the catalog comes last, folded under a button
// with its count (styles.css shows the button only there), so the page is the plan and its room first.
import { useMemo, useState } from "react";
import type { DragEvent } from "react";
import { dimensionsText, money } from "../../shared/format.ts";
import { ITEM_STATUSES, VENDORS } from "../../shared/schema.ts";
import type { Item, Room, Taxonomy } from "../../shared/schema.ts";
import type { CatalogFileError } from "../api.ts";
import { ITEM_DRAG_TYPE, isListCategory } from "../edit.ts";
import { NO_FILTERS, SORT_KEYS, applyFilters, hasFilters, sortItems } from "../filters.ts";
import type { Filters, Sort, SortKey } from "../filters.ts";
import { StatusChip } from "./Chips.tsx";
import { Thumb } from "./Thumb.tsx";

const SORT_LABELS: Record<SortKey, string> = { name: "Name", price: "Price", width: "Width", depth: "Depth", date: "Date captured" };

type Option = readonly [value: string, label: string];
const same = (values: readonly string[]): Option[] => values.map((v) => [v, v] as const);

type Props = {
  items: Item[];
  taxonomy: Taxonomy | null;
  errors: CatalogFileError[];
  loading: boolean;
  error: string | null;
  rooms: Room[];
  roomName: string;
  filters: Filters;
  sort: Sort;
  selectedItemId: string | null;
  placedCounts: ReadonlyMap<string, number>;
  listedCounts: ReadonlyMap<string, number>;
  /** The open room takes additions at all (it has walls); false hides the add buttons. */
  offerAdd: boolean;
  canPlace: boolean;
  canList: boolean;
  onFilters: (f: Filters) => void;
  onSort: (s: Sort) => void;
  onSelect: (itemId: string) => void;
  onAdd: (item: Item) => void;
  onAddToList: (item: Item) => void;
  onRetry: () => void;
};

export function CatalogPanel(props: Props) {
  const { items, taxonomy, errors, loading, error, rooms, filters, sort, onFilters, onSort } = props;
  const shown = useMemo(() => sortItems(applyFilters(items, filters), sort), [items, filters, sort]);
  const set = (patch: Partial<Filters>) => onFilters({ ...filters, ...patch });
  const [open, setOpen] = useState(false);

  return (
    <aside className={open ? "catalog pane open" : "catalog pane"} aria-label="Catalog">
      <button type="button" className="catalog-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{open ? "Hide the catalog" : "The catalog"}</span>
        <span className="muted">{loading ? "loading…" : `${items.length} items`}</span>
      </button>
      <ErrorsBanner errors={errors} />
      <div className="filters">
        <input
          type="search"
          className="search"
          placeholder="Search name, brand, notes"
          aria-label="Search the catalog"
          value={filters.text}
          onChange={(e) => set({ text: e.target.value })}
        />
        <div className="filter-grid">
          <Choice label="Category" value={filters.category} options={same(taxonomy?.categories ?? [])} onChange={(category) => set({ category })} />
          <Choice label="Tag" value={filters.tag} options={same(taxonomy?.tags ?? [])} onChange={(tag) => set({ tag })} />
          <Choice label="Vendor" value={filters.vendor} options={same(VENDORS)} onChange={(vendor) => set({ vendor })} />
          <Choice label="Room" value={filters.room} options={rooms.map((r) => [r.id, r.name] as const)} onChange={(room) => set({ room })} />
          <Choice label="Status" value={filters.status} options={same(ITEM_STATUSES)} onChange={(status) => set({ status })} />
          <Limit label="Max W" suffix="in" value={filters.maxW} onChange={(maxW) => set({ maxW })} />
          <Limit label="Max D" suffix="in" value={filters.maxD} onChange={(maxD) => set({ maxD })} />
          <Limit label="Max price" suffix="$" value={filters.maxPrice} onChange={(maxPrice) => set({ maxPrice })} />
        </div>
        <div className="sort-row">
          <label>
            Sort{" "}
            <select value={sort.key} onChange={(e) => onSort({ ...sort, key: e.target.value as SortKey })}>
              {SORT_KEYS.map((k) => (
                <option key={k} value={k}>
                  {SORT_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="dir"
            onClick={() => onSort({ ...sort, dir: sort.dir === "asc" ? "desc" : "asc" })}
            title={sort.dir === "asc" ? "Ascending (click for descending)" : "Descending (click for ascending)"}
            aria-label={sort.dir === "asc" ? "Sort ascending; switch to descending" : "Sort descending; switch to ascending"}
          >
            {sort.dir === "asc" ? "↑" : "↓"}
          </button>
          <span className="count">{shown.length === items.length ? `${items.length} items` : `${shown.length} of ${items.length}`}</span>
          {hasFilters(filters) && (
            <button type="button" className="link" onClick={() => onFilters(NO_FILTERS)}>
              Clear
            </button>
          )}
        </div>
      </div>
      {error && (
        <div className="banner error">
          {error}{" "}
          <button type="button" onClick={props.onRetry}>
            Retry
          </button>
        </div>
      )}
      {loading && <p className="muted pad">Loading the catalog…</p>}
      {!loading && !error && items.length === 0 && (
        <p className="muted pad">
          The catalog is empty. Agents add items with <code>npm run catalog:add</code>.
        </p>
      )}
      {items.length > 0 && shown.length === 0 && <p className="muted pad">No item passes these filters.</p>}
      <ul className="items">
        {shown.map((item) => (
          <CatalogRow
            key={item.id}
            item={item}
            selected={item.id === props.selectedItemId}
            placed={props.placedCounts.get(item.id) ?? 0}
            listed={props.listedCounts.get(item.id) ?? 0}
            offerAdd={props.offerAdd}
            canPlace={props.canPlace}
            canList={props.canList}
            roomName={props.roomName}
            onSelect={props.onSelect}
            onAdd={props.onAdd}
            onAddToList={props.onAddToList}
          />
        ))}
      </ul>
    </aside>
  );
}

type RowProps = {
  item: Item;
  selected: boolean;
  placed: number;
  listed: number;
  offerAdd: boolean;
  canPlace: boolean;
  canList: boolean;
  roomName: string;
  onSelect: (itemId: string) => void;
  onAdd: (item: Item) => void;
  onAddToList: (item: Item) => void;
};

function CatalogRow({ item, selected, placed, listed, offerAdd, canPlace, canList, roomName, onSelect, onAdd, onAddToList }: RowProps) {
  const toList = isListCategory(item.category);
  const placeable = offerAdd && !toList && canPlace && item.dimensions !== null;
  const onDragStart = (e: DragEvent<HTMLLIElement>) => {
    e.dataTransfer.setData(ITEM_DRAG_TYPE, item.id);
    e.dataTransfer.effectAllowed = "copy";
  };
  const addTitle = !item.dimensions
    ? "No dimensions recorded, so it can't be placed"
    : canPlace
      ? `Add to the ${roomName.toLowerCase()} plan (or drag the row onto it)`
      : "Open a measured room in edit mode to place items";
  const listTitle = canList ? `Add one to the ${roomName.toLowerCase()} room list` : "Open the room in edit mode to change its room list";
  return (
    <li className={selected ? "item-row selected" : "item-row"} draggable={placeable} onDragStart={placeable ? onDragStart : undefined}>
      <div
        className="row-main"
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        onClick={() => onSelect(item.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(item.id);
          }
        }}
      >
        <Thumb item={item} />
        <div className="row-text">
          <div className="row-name">{item.name}</div>
          <div className="row-dims">{dimensionsText(item.dimensions)}</div>
          <div className="row-price">
            {item.price ? (
              <>
                {money(item.price.amount)} <span className="muted">as of {item.price.asOf}</span>
              </>
            ) : (
              <span className="muted">no price</span>
            )}
          </div>
        </div>
      </div>
      <div className="row-foot">
        <StatusChip status={item.status} />
        {placed > 0 && <span className="chip placed">here ×{placed}</span>}
        {listed > 0 && <span className="chip listed">on the list ×{listed}</span>}
        {!offerAdd ? null : toList ? (
          <button type="button" className="add" disabled={!canList} onClick={() => onAddToList(item)} title={listTitle} aria-label={`Add ${item.name} to the room list`}>
            Add to room list
          </button>
        ) : (
          <button type="button" className="add" disabled={!placeable} onClick={() => onAdd(item)} title={addTitle} aria-label={`Add ${item.name} to the plan`}>
            Add to plan
          </button>
        )}
      </div>
    </li>
  );
}

function Choice({ label, value, options, onChange }: { label: string; value: string; options: Option[]; onChange: (v: string) => void }) {
  return (
    <select className={value ? "choice on" : "choice"} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Any {label.toLowerCase()}</option>
      {options.map(([v, text]) => (
        <option key={v} value={v}>
          {text}
        </option>
      ))}
    </select>
  );
}

const parseLimit = (text: string): number | null => {
  const n = Number(text);
  return text.trim() === "" || !Number.isFinite(n) ? null : n;
};

/** A max-size or max-price box. Keeps its own text so "1." can be typed on the way to "1.5". */
function Limit({ label, suffix, value, onChange }: { label: string; suffix: string; value: number | null; onChange: (v: number | null) => void }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    // Changed from outside (Clear): show it, unless the text already says it.
    setSeen(value);
    if (parseLimit(text) !== value) setText(value === null ? "" : String(value));
  }
  return (
    <label className={value === null ? "limit" : "limit on"}>
      <span>{label}</span>
      <input
        type="text"
        inputMode="decimal"
        placeholder={suffix}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(parseLimit(e.target.value));
        }}
      />
    </label>
  );
}

function ErrorsBanner({ errors }: { errors: CatalogFileError[] }) {
  const key = JSON.stringify(errors);
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (errors.length === 0 || dismissed === key) return null;
  return (
    <div className="banner warn" role="status">
      <button type="button" className="dismiss" onClick={() => setDismissed(key)} aria-label="Dismiss">
        ×
      </button>
      <strong>{errors.length === 1 ? "1 catalog file" : `${errors.length} catalog files`} could not be read</strong>
      <ul>
        {errors.map((e) => (
          <li key={e.file}>
            <code>{e.file}</code> {e.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
