import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getItem } from "../server/catalog.ts";
import { HttpError } from "../server/errors.ts";
import { addImageToItem, downloadImage, isAllowedImageUrl, resizeToJpeg, type FetchLike } from "../server/images.ts";
import { DESK_ID, listPartFiles, mkTempDataDir, type TempDataDir } from "./helpers.ts";

let png: Buffer; // 2000 × 1000

beforeAll(async () => {
  png = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#cc3333" } }).png().toBuffer();
});

/** A fetch that answers every URL with `body` and records which URLs it was asked for. */
function fakeFetch(body: Uint8Array | string, headers: Record<string, string> = { "content-type": "image/png" }, status = 200) {
  const calls: string[] = [];
  const impl: FetchLike = async (url) => {
    calls.push(url);
    return new Response(typeof body === "string" ? body : new Uint8Array(body), { status, headers });
  };
  return { impl, calls };
}

async function rejection(promise: Promise<unknown>): Promise<HttpError> {
  const e = await promise.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(HttpError);
  return e as HttpError;
}

describe("isAllowedImageUrl", () => {
  it.each([
    ["https://www.ikea.com/x.jpg", true],
    ["https://ikea.com/x.jpg", true],
    ["https://WWW.IKEA.COM/x.jpg", true],
    ["https://m.media-amazon.com/images/I/x.jpg", true],
    ["https://images-na.ssl-images-amazon.com/images/I/x.jpg", true],
    ["https://www.costco.com/x.jpg", true],
    ["https://www.upliftdesk.com/x.png", true],
    // UPLIFT's photos live in its own folder on BigCommerce's CDN: that folder only (Andrew, 2026-10-24).
    ["https://cdn11.bigcommerce.com/s-l85bzww3lo/images/stencil/1280w/products/859/36448/x.png", true],
    ["https://cdn11.bigcommerce.com/s-otherstore/images/x.png", false],
    ["https://cdn11.bigcommerce.com/x.png", false],
    ["https://cdn11.bigcommerce.com/s-l85bzww3lo-evil/x.png", false],
    ["https://cdn11.bigcommerce.com/s-l85bzww3lo/../s-otherstore/x.png", false],
    ["https://evil.cdn11.bigcommerce.com/s-l85bzww3lo/x.png", false],
    ["https://cdn11.bigcommerce.com.evil.com/s-l85bzww3lo/x.png", false],
    ["http://cdn11.bigcommerce.com/s-l85bzww3lo/x.png", false],
    ["https://upliftdesk.com.evil.com/x.png", false],
    ["https://ikea.com.evil.com/x.jpg", false],
    ["https://evilikea.com/x.jpg", false],
    ["https://www.ikea.co/x.jpg", false],
    ["http://www.ikea.com/x.jpg", false],
    ["ftp://www.ikea.com/x.jpg", false],
    ["https://user:secret@www.ikea.com/x.jpg", false],
    ["//www.ikea.com/x.jpg", false],
    ["not a url", false],
  ])("%s → %s", (url, allowed) => {
    expect(isAllowedImageUrl(url)).toBe(allowed);
  });
});

describe("downloadImage", () => {
  it("returns the body of an image response", async () => {
    const { impl, calls } = fakeFetch(png);
    expect((await downloadImage("https://www.ikea.com/x.png", { fetchImpl: impl })).equals(png)).toBe(true);
    expect(calls).toEqual(["https://www.ikea.com/x.png"]);
  });

  it("answers 415 for a response that is not image/*", async () => {
    const e = await rejection(downloadImage("https://www.ikea.com/x.jpg", { fetchImpl: fakeFetch("<html>", { "content-type": "text/html; charset=utf-8" }).impl }));
    expect(e.status).toBe(415);
    expect(e.message).toMatch(/text\/html/);
  });

  it("answers 502 for an HTTP error, a network error and a timeout", async () => {
    expect((await rejection(downloadImage("https://www.ikea.com/x.jpg", { fetchImpl: fakeFetch("gone", {}, 404).impl }))).status).toBe(502);

    const offline: FetchLike = async () => {
      throw new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED") });
    };
    const network = await rejection(downloadImage("https://www.ikea.com/x.jpg", { fetchImpl: offline }));
    expect([network.status, network.message]).toEqual([502, expect.stringMatching(/ECONNREFUSED/)]);

    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
    const timeout = await rejection(downloadImage("https://www.ikea.com/x.jpg", { fetchImpl: hang, timeoutMs: 50 }));
    expect([timeout.status, timeout.message]).toEqual([502, expect.stringMatching(/timed out/)]);
  });

  it("answers 413 past maxBytes, whether the size is declared or only counted", async () => {
    const declared = fakeFetch(png, { "content-type": "image/png", "content-length": String(png.length) });
    expect((await rejection(downloadImage("https://www.ikea.com/x.png", { fetchImpl: declared.impl, maxBytes: 1000 }))).status).toBe(413);
    const counted = fakeFetch(png);
    expect((await rejection(downloadImage("https://www.ikea.com/x.png", { fetchImpl: counted.impl, maxBytes: 1000 }))).status).toBe(413);
  });

  it("follows redirects only while they stay on the allowlist", async () => {
    const calls: string[] = [];
    const hops: FetchLike = async (url) => {
      calls.push(url);
      if (url === "https://www.ikea.com/a.jpg") return new Response(null, { status: 302, headers: { location: "/b.jpg" } });
      if (url === "https://www.ikea.com/b.jpg") return new Response(null, { status: 301, headers: { location: "https://m.media-amazon.com/c.jpg" } });
      if (url === "https://m.media-amazon.com/c.jpg") return new Response(new Uint8Array(png), { headers: { "content-type": "image/png" } });
      return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } });
    };
    expect((await downloadImage("https://www.ikea.com/a.jpg", { fetchImpl: hops })).equals(png)).toBe(true);
    expect(calls).toEqual(["https://www.ikea.com/a.jpg", "https://www.ikea.com/b.jpg", "https://m.media-amazon.com/c.jpg"]);

    const e = await rejection(downloadImage("https://www.ikea.com/elsewhere.jpg", { fetchImpl: hops }));
    expect(e.status).toBe(403);
    expect(e.message).toMatch(/169\.254\.169\.254/);
  });

  it("refuses a URL off the allowlist without fetching", async () => {
    const { impl, calls } = fakeFetch(png);
    expect((await rejection(downloadImage("https://example.com/x.png", { fetchImpl: impl }))).status).toBe(403);
    expect(calls).toEqual([]);
  });
});

describe("resizeToJpeg", () => {
  it("fits a 2000 × 1000 PNG into an 800 × 400 JPEG", async () => {
    const meta = await sharp(await resizeToJpeg(png)).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 800, 400]);
  });

  it("never enlarges a small image", async () => {
    const small = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#000000" } }).png().toBuffer();
    const meta = await sharp(await resizeToJpeg(small)).metadata();
    expect([meta.width, meta.height]).toEqual([300, 200]);
  });

  it("applies the EXIF orientation, then drops the metadata", async () => {
    const sideways = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#123456" } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    expect((await sharp(sideways).metadata()).exif).toBeDefined();
    const meta = await sharp(await resizeToJpeg(sideways)).metadata();
    expect([meta.width, meta.height, meta.orientation, meta.exif]).toEqual([400, 800, undefined, undefined]);
  });

  it("puts transparent pixels on white", async () => {
    const clear = await sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const pixel = await sharp(await resizeToJpeg(clear)).raw().toBuffer();
    expect([...pixel.subarray(0, 3)]).toEqual([255, 255, 255]);
  });

  it("answers 415 for bytes that are not an image", async () => {
    expect((await rejection(resizeToJpeg(Buffer.from("<html>not an image</html>")))).status).toBe(415);
  });
});

describe("addImageToItem", () => {
  let data: TempDataDir;
  const imageFile = (name: string) => path.join(data.dir, "images", name);

  beforeEach(async () => {
    data = await mkTempDataDir();
  });

  afterEach(async () => {
    const leftovers = await listPartFiles(data.dir);
    await data.cleanup();
    expect(leftovers).toEqual([]);
  });

  it("writes images/<itemId>-1.jpg at most 800 px wide and appends it to images[]", async () => {
    const url = "https://www.ikea.com/us/en/images/products/desk.png";
    const { item, image, created } = await addImageToItem(data.dir, DESK_ID, url, { fetchImpl: fakeFetch(png).impl, caption: " front " });
    expect(created).toBe(true);
    expect(image).toEqual({ file: `${DESK_ID}-1.jpg`, sourceUrl: url, caption: "front" });
    expect(item.images).toEqual([image]);
    expect((await getItem(data.dir, DESK_ID)).images).toEqual([image]);
    const meta = await sharp(imageFile(image.file)).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBeLessThanOrEqual(800);
  });

  it("numbers each new image after the highest index in images[] and on disk", async () => {
    const fetchImpl = fakeFetch(png).impl;
    const first = await addImageToItem(data.dir, DESK_ID, "https://www.ikea.com/1.png", { fetchImpl });
    const second = await addImageToItem(data.dir, DESK_ID, "https://www.ikea.com/2.png", { fetchImpl });
    expect([first.image.file, second.image.file]).toEqual([`${DESK_ID}-1.jpg`, `${DESK_ID}-2.jpg`]);
    await fs.writeFile(imageFile(`${DESK_ID}-7.jpg`), "a stray file nobody listed");
    const third = await addImageToItem(data.dir, DESK_ID, "https://www.ikea.com/3.png", { fetchImpl });
    expect(third.image.file).toBe(`${DESK_ID}-8.jpg`);
    expect(third.item.images.map((img) => img.file)).toEqual([`${DESK_ID}-1.jpg`, `${DESK_ID}-2.jpg`, `${DESK_ID}-8.jpg`]);
  });

  it("does not fetch a URL the item already lists again", async () => {
    const { impl, calls } = fakeFetch(png);
    const url = "https://m.media-amazon.com/images/I/desk.jpg";
    const first = await addImageToItem(data.dir, DESK_ID, url, { fetchImpl: impl });
    const again = await addImageToItem(data.dir, DESK_ID, url, { fetchImpl: impl, caption: "ignored" });
    expect(again.created).toBe(false);
    expect(again.image).toEqual(first.image);
    expect(again.item.images).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(await fs.readdir(path.join(data.dir, "images"))).toEqual([`${DESK_ID}-1.jpg`]);
  });

  it("gives concurrent downloads for one item distinct files and keeps both", async () => {
    const fetchImpl = fakeFetch(png).impl;
    const results = await Promise.all(
      ["a", "b", "c"].map((n) => addImageToItem(data.dir, DESK_ID, `https://www.ikea.com/${n}.png`, { fetchImpl })),
    );
    expect(new Set(results.map((r) => r.image.file)).size).toBe(3);
    expect((await getItem(data.dir, DESK_ID)).images.map((img) => img.sourceUrl).sort()).toEqual([
      "https://www.ikea.com/a.png",
      "https://www.ikea.com/b.png",
      "https://www.ikea.com/c.png",
    ]);
  });

  it("answers 403 off the allowlist, 415 for a non-image and 404 for an unknown item, writing nothing", async () => {
    const { impl, calls } = fakeFetch(png);
    expect((await rejection(addImageToItem(data.dir, DESK_ID, "https://ikea.com.evil.com/x.jpg", { fetchImpl: impl }))).status).toBe(403);
    expect((await rejection(addImageToItem(data.dir, DESK_ID, "http://www.ikea.com/x.jpg", { fetchImpl: impl }))).status).toBe(403);
    expect(calls).toEqual([]);
    const html = fakeFetch("<html>", { "content-type": "text/html" }).impl;
    expect((await rejection(addImageToItem(data.dir, DESK_ID, "https://www.ikea.com/x.jpg", { fetchImpl: html }))).status).toBe(415);
    expect((await rejection(addImageToItem(data.dir, "amazon-NOPE", "https://www.ikea.com/x.jpg", { fetchImpl: impl }))).status).toBe(404);
    expect((await getItem(data.dir, DESK_ID)).images).toEqual([]);
    await expect(fs.readdir(path.join(data.dir, "images"))).rejects.toThrow();
  });
});
