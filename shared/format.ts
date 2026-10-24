// Display helpers. Pure.

/** 93 → `7'9"`, 14.5 → `1'2.5"`, 8 → `8"`. Fractions of an inch keep one decimal. */
export function toFeetInches(inches: number): string {
  // Round the total to tenths first, so 47.95 becomes 4'0" and never 3'12".
  const tenths = Math.round(Math.abs(inches) * 10);
  const sign = inches < 0 && tenths > 0 ? "-" : "";
  const feet = Math.floor(tenths / 120);
  const rest = (tenths - feet * 120) / 10;
  const restText = Number.isInteger(rest) ? String(rest) : rest.toFixed(1);
  if (feet === 0) return `${sign}${restText}"`;
  return `${sign}${feet}'${restText}"`;
}

/** 93 → `93`, 14.5 → `14.5`, 23.98 → `24`. */
function tenthsText(inches: number): string {
  const rounded = Math.round(inches * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** 93 → `93"`, 14.5 → `14.5"`. */
export function inchesText(inches: number): string {
  return `${tenthsText(inches)}"`;
}

/** 93 → `93" · 7'9"`; under a foot the two forms are the same, so 3 → `3"`. */
export function lengthLabel(inches: number): string {
  const plain = inchesText(inches);
  const feet = toFeetInches(inches);
  return feet === plain ? plain : `${plain} · ${feet}`;
}

/** 85.99 → `$85.99`; 250 → `$250.00`. */
export function money(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}

/** `24.8 × 18.9 × 29.6"` (h omitted when unknown). */
export function dimensionsText(d: { w: number; d?: number; h?: number; notch?: object } | null): string {
  if (!d) return "no dimensions";
  // A flat item (no depth on its page): width × height, marked flat.
  if (d.d === undefined) return d.h !== undefined ? `${tenthsText(d.w)} × ${tenthsText(d.h)}" flat` : `${tenthsText(d.w)}" wide, flat`;
  const parts = [d.w, d.d, ...(d.h !== undefined ? [d.h] : [])].map(tenthsText);
  // An L-shaped piece: w × d is its whole footprint, so say it is an L.
  return `${parts.join(" × ")}"${d.notch ? ", L-shaped" : ""}`;
}
