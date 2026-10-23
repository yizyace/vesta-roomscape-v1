// Disk access for the data directory. Every write lands in a sibling `.part` file first and is
// renamed over the target, so a crash or a concurrent reader never sees half a file.
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { toJsonText } from "../shared/schema.ts";
import { HttpError, errorMessage } from "./errors.ts";

/** True for the "no such file" errors node:fs throws. */
export function isNotFound(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/** Parses a JSON file. A missing file throws ENOENT (see isNotFound); bad JSON throws a SyntaxError. */
export async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

/** readJson for a file the planner cannot work without: missing or unreadable is a 500 naming `label`. */
export async function readRequiredJson(file: string, label: string): Promise<unknown> {
  try {
    return await readJson(file);
  } catch (e) {
    if (isNotFound(e)) throw new HttpError(500, `${label} is missing`);
    throw new HttpError(500, `${label} ${e instanceof SyntaxError ? "is not valid JSON" : "cannot be read"}: ${errorMessage(e)}`);
  }
}

export async function exists(file: string): Promise<boolean> {
  try {
    await fs.stat(file);
    return true;
  } catch (e) {
    if (isNotFound(e)) return false;
    throw e;
  }
}

/**
 * Writes `data` in full to a new `<file>.<random>.part` beside `file` and returns that path, for the
 * caller to rename over `file`. Creates the parent directories; leaves nothing behind if the write fails.
 */
export async function writePartFile(file: string, data: string | Uint8Array): Promise<string> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  // A suffix per write, so two overlapping saves of one file never share (and race on) a .part.
  const part = `${file}.${randomBytes(4).toString("hex")}.part`;
  try {
    await fs.writeFile(part, data);
  } catch (e) {
    await fs.rm(part, { force: true });
    throw e;
  }
  return part;
}

/** Writes `<file>.<random>.part`, then renames it over `file`. Creates the parent directories. */
export async function writeFileAtomic(file: string, data: string | Uint8Array): Promise<void> {
  const part = await writePartFile(file, data);
  try {
    await fs.rename(part, file);
  } catch (e) {
    await fs.rm(part, { force: true });
    throw e;
  }
}

/** Callers parse with the schema first, so the keys land in the schema's order. */
export function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  return writeFileAtomic(file, toJsonText(value));
}

/** Names of the regular files in `dir`, sorted; [] when the directory does not exist. */
export async function listFileNames(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name).sort();
  } catch (e) {
    if (isNotFound(e)) return [];
    throw e;
  }
}

/** Names of the subdirectories of `dir` (dotfiles skipped), sorted; [] when the directory does not exist. */
export async function listDirNames(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name).sort();
  } catch (e) {
    if (isNotFound(e)) return [];
    throw e;
  }
}

/** The `*.json` names in `dir` (dotfiles skipped), sorted; [] when the directory does not exist. */
export async function listJsonFiles(dir: string): Promise<string[]> {
  return (await listFileNames(dir)).filter((name) => name.endsWith(".json") && !name.startsWith("."));
}

const lockTails = new Map<string, Promise<void>>();

/** Runs `fn` once every earlier withLock(key) call has settled: serialises read-modify-write of one file. */
export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (lockTails.get(key) ?? Promise.resolve()).then(fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  lockTails.set(key, tail);
  try {
    return await run;
  } finally {
    if (lockTails.get(key) === tail) lockTails.delete(key);
  }
}
