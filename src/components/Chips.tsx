import type { ItemStatus } from "../../shared/schema.ts";

export function StatusChip({ status }: { status: ItemStatus }) {
  return <span className={`chip status status-${status}`}>{status}</span>;
}
