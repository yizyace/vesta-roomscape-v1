// Layout variants for the toolbar's switcher: the next free letter for a duplicate, the copy's name, and
// the pills (the listed variants, plus variant a and the open one when the list lacks them). Pure.
import type { VariantSummary } from "./api.ts";
import { STAGED } from "./route.ts";

const LETTERS = "abcdefghijklmnopqrstuvwxyz";

/** `a` → `A`, `reading-nook` → `READING-NOOK`. */
export const variantLetter = (variant: string): string => variant.toUpperCase();

/** The first letter from b to z that no variant uses; null when all 25 are taken. */
export function nextVariantId(used: Iterable<string>): string | null {
  const taken = new Set(used);
  for (const letter of LETTERS.slice(1)) if (!taken.has(letter)) return letter;
  return null;
}

/** `Copy of Staged: sofa facing the TV`; a variant without a name is named by its letter. */
export function copyName(name: string, variant: string): string {
  const source = name.trim() || variantLetter(variant);
  return `Copy of ${source}`;
}

/** `A · Staged: sofa facing the TV`, or just `A`. */
export function variantTitle(variant: string, name: string): string {
  return name.trim() ? `${variantLetter(variant)} · ${name.trim()}` : variantLetter(variant);
}

export type Pill = Pick<VariantSummary, "variant" | "name"> & Partial<Pick<VariantSummary, "placements" | "extras" | "updatedAt">>;

/**
 * One pill per listed variant, sorted by id. Variant a is always offered (it reads as an empty layout
 * before its first save). The open variant's own name and counts win over the list's, which lags its
 * saves, and it joins the list when the list is older than it (a duplicate just made). `open` is null
 * while the open variant is not loaded or does not exist.
 */
export function variantPills(listed: readonly VariantSummary[] | null, open: Pill | null): Pill[] {
  const pills = new Map<string, Pill>((listed ?? []).map((v) => [v.variant, v]));
  if (open) pills.set(open.variant, { ...pills.get(open.variant), ...open });
  if (!pills.has(STAGED)) pills.set(STAGED, { variant: STAGED, name: "" });
  return [...pills.values()].sort((a, b) => (a.variant < b.variant ? -1 : a.variant > b.variant ? 1 : 0));
}

/** The tooltip: `B · Copy of …: 12 placed, 6 on the room list, saved 2026-10-22 14:05`. */
export function pillTooltip(p: Pill): string {
  const parts: string[] = [];
  if (p.placements !== undefined) parts.push(`${p.placements} placed`);
  if (p.extras !== undefined) parts.push(`${p.extras} on the room list`);
  if (p.updatedAt) parts.push(`saved ${p.updatedAt.slice(0, 16).replace("T", " ")} UTC`);
  const role = p.variant === STAGED ? " (the staged pick)" : "";
  return `${variantTitle(p.variant, p.name)}${role}${parts.length > 0 ? `: ${parts.join(", ")}` : ""}`;
}
