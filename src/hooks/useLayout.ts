// One variant of a room's layout (layouts/<room>/<variant>.json), edited locally and written back 300 ms
// after the last change (at once on pointer-up via flush). All mutable state lives in a per-visit
// Session; React state only mirrors it for rendering. Async answers check that their session is still
// the open one, so a slow response for the variant you left never lands in the one you opened. A room
// that is not `writable` (no walls: the kitchen, which never gets a layout file) is read, never written.
import { useEffect, useRef, useState } from "react";
import type { Extra, Placement } from "../../shared/schema.ts";
import { ApiError, errorText, getLayout, putLayout } from "../api.ts";
import { STAGED } from "../route.ts";
import { useWindowFocus } from "./useWindowFocus.ts";

export type SaveState = "idle" | "saving" | "saved" | "error";
export type SaveError = { message: string; issues: string[] };
export type PlacementsUpdate = Placement[] | ((prev: Placement[]) => Placement[]);
export type ExtrasUpdate = Extra[] | ((prev: Extra[]) => Extra[]);
/** "push" records an undo step; "replace" folds the change into the last one (a drag under way). */
export type HistoryMode = "push" | "replace";

const SAVE_DEBOUNCE_MS = 300;
const UNDO_DEPTH = 20;

/** "idle": nothing needed saving. "refused": a 400 (the edits were dropped). "failed": still dirty. */
type Outcome = "saved" | "refused" | "failed" | "idle";
/** An undo step: the plan and the room list together. */
type Step = { placements: Placement[]; extras: Extra[] };

type Session = {
  room: string;
  variant: string;
  loaded: boolean;
  missing: boolean; // GET answered 404: there is no such variant
  name: string;
  notes: string;
  placements: Placement[];
  extras: Extra[];
  updatedAt?: string;
  edits: number; // local edits so far
  saved: number; // edits known to be on disk
  flight: Promise<Outcome> | null; // the PUT that is out, if any
  timer?: ReturnType<typeof setTimeout>;
  reads: number; // only the newest GET may apply
  undo: Step[];
};

type Snapshot = {
  room: string;
  variant: string;
  loaded: boolean;
  missing: boolean;
  name: string;
  notes: string;
  placements: Placement[];
  extras: Extra[];
  updatedAt?: string;
  canUndo: boolean;
};

type Ui = {
  setSnapshot: (s: Snapshot) => void;
  setSaving: (s: SaveState) => void;
  setError: (e: SaveError | null) => void;
  setLoadError: (e: string | null) => void;
  /** A PUT landed: the room's variant list (counts, updatedAt) is out of date. */
  onSaved: (room: string) => void;
  /** False: every edit is ignored and nothing is PUT. */
  writable: () => boolean;
};

const NO_PLACEMENTS: Placement[] = [];
const NO_EXTRAS: Extra[] = [];
const blank = (room: string, variant: string): Snapshot => ({
  room,
  variant,
  loaded: false,
  missing: false,
  name: "",
  notes: "",
  placements: NO_PLACEMENTS,
  extras: NO_EXTRAS,
  canUndo: false,
});

function toSaveError(e: unknown): SaveError {
  return e instanceof ApiError ? { message: e.error, issues: e.issues } : { message: errorText(e), issues: [] };
}

function createController(ui: Ui) {
  let session: Session | null = null;
  const isOpen = (s: Session) => session === s;
  const dirty = (s: Session) => s.edits !== s.saved;
  const publish = (s: Session) => {
    if (!isOpen(s)) return;
    ui.setSnapshot({
      room: s.room,
      variant: s.variant,
      loaded: s.loaded,
      missing: s.missing,
      name: s.name,
      notes: s.notes,
      placements: s.placements,
      extras: s.extras,
      updatedAt: s.updatedAt,
      canUndo: s.undo.length > 0,
    });
  };

  async function load(s: Session): Promise<void> {
    const read = ++s.reads;
    try {
      const layout = await getLayout(s.room, s.variant);
      if (read !== s.reads || !isOpen(s)) return;
      if (s.loaded && (dirty(s) || s.flight)) return; // edited meanwhile: the local edits win
      const changed =
        !s.loaded ||
        layout.name !== s.name ||
        layout.notes !== s.notes ||
        JSON.stringify([layout.placements, layout.extras]) !== JSON.stringify([s.placements, s.extras]);
      s.loaded = true;
      s.missing = false;
      s.updatedAt = layout.updatedAt;
      if (changed) {
        s.name = layout.name;
        s.notes = layout.notes;
        s.placements = layout.placements;
        s.extras = layout.extras;
        s.undo = []; // the file changed under us (an agent wrote it): old undo steps no longer apply
      }
      ui.setLoadError(null);
      publish(s);
    } catch (e) {
      if (read !== s.reads || !isOpen(s)) return;
      if (e instanceof ApiError && e.status === 404 && s.variant !== STAGED) {
        // No such variant (a promote elsewhere may have renamed it). Variant a never 404s, so a 404
        // there means the API itself is missing or old: that stays an error.
        Object.assign(s, { loaded: false, missing: true, placements: NO_PLACEMENTS, extras: NO_EXTRAS, undo: [] });
        ui.setLoadError(null);
        publish(s);
      } else {
        ui.setLoadError(errorText(e));
      }
    }
  }

  /** Sends the edits now. While a PUT is out, answers that PUT, which sends whatever was edited meanwhile. */
  function save(s: Session): Promise<Outcome> {
    clearTimeout(s.timer);
    s.timer = undefined;
    if (s.flight) return s.flight;
    if (!s.loaded || !dirty(s) || !ui.writable()) return Promise.resolve("idle");
    const flight = put(s);
    s.flight = flight;
    return flight;
  }

  async function put(s: Session): Promise<Outcome> {
    const edits = s.edits;
    if (isOpen(s)) ui.setSaving("saving");
    let outcome: Outcome;
    try {
      const layout = await putLayout(s.room, s.variant, { name: s.name, notes: s.notes, placements: s.placements, extras: s.extras });
      s.saved = edits;
      s.updatedAt = layout.updatedAt;
      outcome = "saved";
    } catch (e) {
      outcome = e instanceof ApiError && e.status === 400 ? "refused" : "failed";
      if (isOpen(s)) ui.setError(toSaveError(e));
    }
    s.flight = null;
    if (outcome === "saved") {
      ui.onSaved(s.room);
      if (dirty(s)) {
        // Edited while the request was out: send the rest now, unless the debounce is about to.
        return s.timer === undefined ? save(s) : outcome;
      }
      if (isOpen(s)) {
        ui.setError(null);
        ui.setSaving("saved");
      }
      return outcome;
    }
    if (isOpen(s)) ui.setSaving("error");
    if (outcome === "refused") {
      // The server will not take these edits (the banner says why): show what is on disk instead.
      s.saved = s.edits;
      void load(s);
    }
    // "failed" (server down, 500): the edits stay dirty; the next edit or window focus retries.
    return outcome;
  }

  function schedule(s: Session): void {
    clearTimeout(s.timer);
    s.timer = setTimeout(() => {
      s.timer = undefined;
      void save(s);
    }, SAVE_DEBOUNCE_MS);
    if (isOpen(s)) ui.setSaving("saving");
  }

  function edit(s: Session, next: Partial<Step>, mode: HistoryMode): void {
    if (mode === "push") {
      s.undo.push({ placements: s.placements, extras: s.extras });
      if (s.undo.length > UNDO_DEPTH) s.undo.shift();
    }
    if (next.placements) s.placements = next.placements;
    if (next.extras) s.extras = next.extras;
    s.edits++;
    publish(s);
    schedule(s);
  }

  function setPlacements(update: PlacementsUpdate, mode: HistoryMode = "push"): void {
    const s = session;
    if (!s?.loaded || !ui.writable()) return;
    const next = typeof update === "function" ? update(s.placements) : update;
    if (next !== s.placements) edit(s, { placements: next }, mode);
  }

  function setExtras(update: ExtrasUpdate): void {
    const s = session;
    if (!s?.loaded || !ui.writable()) return;
    const next = typeof update === "function" ? update(s.extras) : update;
    if (next !== s.extras) edit(s, { extras: next }, "push");
  }

  /** Renames the variant. Not an undo step: the name field has the browser's own undo. */
  function setName(name: string): void {
    const s = session;
    if (!s?.loaded || !ui.writable() || name === s.name) return;
    s.name = name;
    s.edits++;
    publish(s);
    schedule(s);
  }

  function undo(): void {
    const s = session;
    const previous = s?.loaded && ui.writable() ? s.undo.pop() : undefined;
    if (!s || !previous) return;
    s.placements = previous.placements;
    s.extras = previous.extras;
    s.edits++;
    publish(s);
    schedule(s);
  }

  function flush(): void {
    if (session) void save(session);
  }

  /** Saves now and waits until every edit is on disk: true when it is, false when a save failed or was refused. */
  async function settle(): Promise<boolean> {
    const s = session;
    if (!s) return true;
    while (s.flight || (s.loaded && dirty(s))) {
      const outcome = await save(s);
      if (outcome === "failed" || outcome === "refused") return false;
    }
    return true;
  }

  function refresh(): void {
    const s = session;
    if (!s) return;
    // Unsent edits win over a re-read; this also retries a save that failed.
    if (dirty(s) || s.flight) void save(s);
    else void load(s);
  }

  function open(room: string, variant: string): () => void {
    const s: Session = {
      room,
      variant,
      loaded: false,
      missing: false,
      name: "",
      notes: "",
      placements: NO_PLACEMENTS,
      extras: NO_EXTRAS,
      edits: 0,
      saved: 0,
      flight: null,
      reads: 0,
      undo: [],
    };
    session = s;
    ui.setSaving("idle");
    ui.setError(null);
    ui.setLoadError(null);
    publish(s);
    void load(s);
    return () => void save(s); // leaving the variant: write the edits still waiting on the debounce
  }

  return { open, setPlacements, setExtras, setName, undo, flush, settle, refresh, clearError: () => ui.setError(null) };
}

type Options = {
  /** False for a room that never gets a layout file (no walls): edits are ignored and nothing is PUT. */
  writable: boolean;
  /** Runs after every PUT that lands (App refreshes the variant list with it). */
  onSaved?: (room: string) => void;
};

export function useLayout(roomId: string, variant: string, { writable, onSaved }: Options) {
  const [snapshot, setSnapshot] = useState<Snapshot>(() => blank(roomId, variant));
  const [saving, setSaving] = useState<SaveState>("idle");
  const [error, setError] = useState<SaveError | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const latest = useRef({ writable, onSaved });
  useEffect(() => {
    latest.current = { writable, onSaved };
  });
  const [ctl] = useState(() =>
    createController({
      setSnapshot,
      setSaving,
      setError,
      setLoadError,
      onSaved: (room) => latest.current.onSaved?.(room),
      writable: () => latest.current.writable,
    }),
  );

  useEffect(() => ctl.open(roomId, variant), [ctl, roomId, variant]);
  useWindowFocus(ctl.refresh);

  // Between a route change and the effect above, never show the previous variant's placements.
  const current = snapshot.room === roomId && snapshot.variant === variant ? snapshot : blank(roomId, variant);
  return {
    ...current,
    saving,
    error,
    loadError,
    setPlacements: ctl.setPlacements,
    setExtras: ctl.setExtras,
    setName: ctl.setName,
    undo: ctl.undo,
    flush: ctl.flush,
    settle: ctl.settle,
    refresh: ctl.refresh,
    clearError: ctl.clearError,
  };
}

export type LayoutState = ReturnType<typeof useLayout>;
