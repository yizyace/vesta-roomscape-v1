// Product photos for catalog items. Downloaded only over https from the vendors' own hosts, turned
// into an 800 px JPEG (EXIF orientation applied, metadata dropped), stored as images/<itemId>-<n>.jpg
// and listed in the item's images[] with the URL it came from.
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { Item, ItemImage } from "../shared/schema.ts";
import { getItem, saveItem } from "./catalog.ts";
import { HttpError, errorMessage } from "./errors.ts";
import { imagesDir, itemFile } from "./paths.ts";
import { listFileNames, withLock, writeFileAtomic } from "./store.ts";

/** Image hosts, each allowing itself and its subdomains. */
export const ALLOWED_IMAGE_HOSTS = ["ikea.com", "media-amazon.com", "ssl-images-amazon.com", "costco.com", "upliftdesk.com"] as const;

/**
 * Folders on a shared image CDN, each one exact host and a path: a vendor whose photos live on its
 * platform's CDN is allowed its own store's folder, not the platform (UPLIFT's BigCommerce store).
 */
export const ALLOWED_IMAGE_FOLDERS = ["cdn11.bigcommerce.com/s-l85bzww3lo/"] as const;

const MAX_REDIRECTS = 5;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
export type DownloadOptions = { fetchImpl?: FetchLike; timeoutMs?: number; maxBytes?: number };
export type AddImageOptions = DownloadOptions & { caption?: string };
export type AddImageResult = { item: Item; image: ItemImage; created: boolean };

/**
 * https, no credentials, and a host that is an allowed entry or a subdomain of one (`ikea.com.evil.com` is
 * not), or a path inside an allowed folder on its exact host (the URL parser has already resolved `..`).
 */
export function isAllowedImageUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username !== "" || u.password !== "") return false;
  if (ALLOWED_IMAGE_HOSTS.some((host) => u.hostname === host || u.hostname.endsWith(`.${host}`))) return true;
  return ALLOWED_IMAGE_FOLDERS.some((folder) => `${u.hostname}${u.pathname}`.startsWith(folder));
}

function notAllowed(url: string): HttpError {
  return new HttpError(
    403,
    `images are only downloaded over https from ${ALLOWED_IMAGE_HOSTS.join(", ")} or their subdomains, or from ${ALLOWED_IMAGE_FOLDERS.join(", ")}, not ${url}`,
  );
}

async function discard(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    // already closed
  }
}

function sizeText(bytes: number): string {
  return bytes >= 1_000_000 ? `${bytes / 1_000_000} MB` : `${bytes} bytes`;
}

async function readCapped(res: Response, maxBytes: number, url: string): Promise<Buffer> {
  const tooBig = () => new HttpError(413, `${url} is larger than the ${sizeText(maxBytes)} limit`);
  if (Number(res.headers.get("content-length")) > maxBytes) {
    await discard(res);
    throw tooBig();
  }
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw tooBig();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, size);
}

/**
 * The bytes at `url`: 403 off the allowlist (checked again on every redirect, which fetch would
 * otherwise follow anywhere), 415 when the response is not image/*, 413 past `maxBytes`, 502 for
 * any other failure, including the timeout.
 */
export async function downloadImage(url: string, opts: DownloadOptions = {}): Promise<Buffer> {
  const { fetchImpl = fetch, timeoutMs = 20_000, maxBytes = 20_000_000 } = opts;
  if (!isAllowedImageUrl(url)) throw notAllowed(url);
  const signal = AbortSignal.timeout(timeoutMs);
  let current = url;
  try {
    for (let redirects = 0; ; redirects++) {
      const res = await fetchImpl(current, { redirect: "manual", signal, headers: { accept: "image/*" } });
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        await discard(res);
        const next = new URL(location, current).href;
        if (!isAllowedImageUrl(next)) throw new HttpError(403, `${current} redirects to ${next}, which is not an allowed image host`);
        if (redirects >= MAX_REDIRECTS) throw new HttpError(502, `${url} redirects more than ${MAX_REDIRECTS} times`);
        current = next;
        continue;
      }
      if (!res.ok) {
        await discard(res);
        throw new HttpError(502, `${current} answered HTTP ${res.status}`);
      }
      const type = (res.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
      if (!type.startsWith("image/")) {
        await discard(res);
        throw new HttpError(415, `${current} is not an image (Content-Type ${type ? `"${type}"` : "missing"})`);
      }
      return await readCapped(res, maxBytes, current);
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (signal.aborted) throw new HttpError(502, `downloading ${current} timed out after ${timeoutMs / 1000} s`);
    throw new HttpError(502, `downloading ${current} failed: ${errorMessage(e)}`);
  }
}

/** At most 800 × 800, never enlarged, EXIF orientation applied; transparency goes white; no metadata kept. */
export async function resizeToJpeg(input: Buffer): Promise<Buffer> {
  try {
    return await sharp(input)
      .rotate()
      .flatten({ background: "#ffffff" })
      .resize({ width: 800, height: 800, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
  } catch (e) {
    throw new HttpError(415, `the download is not an image that can be read: ${errorMessage(e)}`);
  }
}

/** n for `<itemId>-<n>.jpg`: one past the highest index in the item's images[] or on disk. */
async function nextImageIndex(dataDir: string, item: Item): Promise<number> {
  const prefix = `${item.id}-`;
  const indexOf = (name: string): number => {
    if (!name.startsWith(prefix) || !name.endsWith(".jpg")) return 0;
    const digits = name.slice(prefix.length, -".jpg".length);
    return /^\d+$/.test(digits) ? Number(digits) : 0;
  };
  const onDisk = await listFileNames(imagesDir(dataDir));
  return Math.max(0, ...item.images.map((img) => indexOf(img.file)), ...onDisk.map(indexOf)) + 1;
}

/**
 * Downloads `url` for the item and appends it to images[]: 404 for an unknown item, 403 off the
 * allowlist. A URL the item already lists is not fetched again (`created: false`).
 */
export async function addImageToItem(dataDir: string, itemId: string, url: string, opts: AddImageOptions = {}): Promise<AddImageResult> {
  const item = await getItem(dataDir, itemId);
  if (!isAllowedImageUrl(url)) throw notAllowed(url);
  const known = item.images.find((img) => img.sourceUrl === url);
  if (known) return { item, image: known, created: false };
  const jpeg = await resizeToJpeg(await downloadImage(url, opts));
  const caption = opts.caption?.trim();
  // Choosing n and saving the item must not interleave with another download for the same item.
  return withLock(itemFile(dataDir, itemId), async () => {
    const fresh = await getItem(dataDir, itemId);
    const raced = fresh.images.find((img) => img.sourceUrl === url);
    if (raced) return { item: fresh, image: raced, created: false };
    const image: ItemImage = { file: `${itemId}-${await nextImageIndex(dataDir, fresh)}.jpg`, sourceUrl: url, ...(caption ? { caption } : {}) };
    const target = path.join(imagesDir(dataDir), image.file);
    await writeFileAtomic(target, jpeg);
    try {
      const saved = await saveItem(dataDir, { ...fresh, images: [...fresh.images, image] }, { update: true });
      return { item: saved, image, created: true };
    } catch (e) {
      await fs.rm(target, { force: true });
      throw e;
    }
  });
}
