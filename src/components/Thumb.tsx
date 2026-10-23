// An item's first photo as a small square, or its category's initial when it has none (or the file is
// missing). Used by the catalog rows, the room list, the legend and the kitchen essentials.
import { useState } from "react";
import type { Item } from "../../shared/schema.ts";
import { imageUrl } from "../api.ts";

export function Thumb({ item, size }: { item: Pick<Item, "images" | "category"> | undefined; size?: "small" }) {
  const photo = item?.images[0];
  const [broken, setBroken] = useState<string | null>(null);
  const className = size === "small" ? "thumb small" : "thumb";
  if (!photo || broken === photo.file) {
    return (
      <span className={`${className} placeholder`} aria-hidden="true">
        {(item?.category ?? "?").slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return <img className={className} src={imageUrl(photo.file)} alt="" loading="lazy" draggable={false} onError={() => setBroken(photo.file)} />;
}
