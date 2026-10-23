// The variant switcher under the toolbar's title: one pill per layout variant (A, the staged pick, then
// the alternatives), the open one highlighted; in edit mode "Duplicate" (a copy under the next free
// letter, opened at once) and, on an alternative, "Make staged" (swaps it with A). The read-only copy
// has the pills only.
import { STAGED, routeHash } from "../route.ts";
import { pillTooltip, variantLetter } from "../variants.ts";
import type { Pill } from "../variants.ts";

export type VariantAction = "duplicate" | "promote";

type Props = {
  roomId: string;
  current: string;
  pills: Pill[];
  view: boolean;
  readOnly: boolean;
  listError: string | null;
  busy: VariantAction | null;
  canDuplicate: boolean;
  canPromote: boolean;
  onDuplicate: () => void;
  onPromote: () => void;
};

export function VariantBar({ roomId, current, pills, view, readOnly, listError, busy, canDuplicate, canPromote, onDuplicate, onPromote }: Props) {
  return (
    <div className="variant-bar">
      <nav className="variants" aria-label="Layout variants">
        {pills.map((p) => (
          <a
            key={p.variant}
            className="pill"
            href={routeHash(roomId, p.variant, view)}
            aria-current={p.variant === current ? "page" : undefined}
            title={pillTooltip(p)}
          >
            <span className="pill-letter">{variantLetter(p.variant)}</span>
            {p.name.trim() && <span className="pill-name">{p.name.trim()}</span>}
          </a>
        ))}
      </nav>
      {listError && (
        <span className="flag warn" title={listError}>
          variants not listed
        </span>
      )}
      {!view && !readOnly && (
        <span className="variant-actions">
          <button type="button" onClick={onDuplicate} disabled={!canDuplicate} title="Copy this variant to the next free letter and open the copy">
            {busy === "duplicate" ? "Duplicating…" : "Duplicate"}
          </button>
          {current !== STAGED && (
            <button type="button" onClick={onPromote} disabled={!canPromote} title="Swap this variant with A, the staged pick, and open A">
              {busy === "promote" ? "Making staged…" : "Make staged"}
            </button>
          )}
        </span>
      )}
    </div>
  );
}
