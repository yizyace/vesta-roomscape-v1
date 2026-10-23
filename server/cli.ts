// Command line for the planner's data: the checks and writes of the API, for agents and scripts.
// Node runs this file directly (type stripping, no build step); use the Node that the repo root's
// .tool-versions pins. FURNITURE_DATA_DIR overrides the data directory.
import path from "node:path";
import { parseArgs, type ParseArgsConfig } from "node:util";
import { saveItem } from "./catalog.ts";
import { HttpError, errorMessage } from "./errors.ts";
import { addImageToItem } from "./images.ts";
import { STAGED_VARIANT, isRoomId, listVariants, promoteVariant, saveLayout, type VariantList } from "./layouts.ts";
import { DATA_DIR, imagesDir, itemFile, layoutFile } from "./paths.ts";
import { loadRooms } from "./rooms.ts";
import { isNotFound, readJson } from "./store.ts";
import { validateAll, type Problem } from "./validate.ts";

const USAGE = `usage:
  node server/cli.ts validate                                         check every data file; exit 1 on any error
  node server/cli.ts catalog add <file.json> [--update]               save a catalog item; --update overwrites one that exists
  node server/cli.ts catalog image <itemId> <url> [--caption <text>]  download a product photo and attach it to the item
  node server/cli.ts layout set <room> <file.json> [--variant <id>] [--name <text>]
      save one variant of a room's layout, layouts/<room>/<variant>.json, from {name?, notes?, placements, extras?};
      the variant is --variant, else the file's "variant", else "a" (the staged pick); the name is --name,
      else the file's "name", else the saved one
  node server/cli.ts layout list [<room>]                             one line per saved variant: <room>/<variant>  <name>  (<n> placed, <m> extras)
  node server/cli.ts layout promote <room> <variant>                  make the variant the staged pick "a"; the old "a" takes its id

The same through npm, from the repo root:
  npm run validate | npm run catalog:add -- <file.json> [--update]
  npm run catalog:image -- <itemId> <url> [--caption <text>]
  npm run layout:set -- <room> <file.json> [--variant <id>] [--name <text>]

Data directory: ${DATA_DIR} (set FURNITURE_DATA_DIR to use another)`;

// npm runs the package scripts from the repo root; a relative path means one from where npm was started.
const NPM_SCRIPTS = new Set(["validate", "catalog:add", "catalog:image", "layout:set"]);
const BASE_DIR =
  NPM_SCRIPTS.has(process.env.npm_lifecycle_event ?? "") && process.env.INIT_CWD ? process.env.INIT_CWD : process.cwd();

type Args = { positionals: string[]; values: Record<string, unknown> };

/** min to max positionals and only the given options; undefined otherwise (the caller prints usage). */
function parse(args: string[], options: ParseArgsConfig["options"], min: number, max = min): Args | undefined {
  try {
    const { positionals, values } = parseArgs({ args, options: options ?? {}, allowPositionals: true, strict: true });
    return positionals.length >= min && positionals.length <= max ? { positionals, values } : undefined;
  } catch {
    return undefined;
  }
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const line = (file: string, p: Problem): string => `${p.level === "error" ? "ERROR" : "WARN"} ${file}: ${p.message}`;
const variantLines = ({ room, variants }: VariantList): string[] =>
  variants.map((v) => `${room}/${v.variant}  ${v.name}  (${v.placements} placed, ${v.extras} extras)`);

async function validate(): Promise<number> {
  const report = await validateAll(DATA_DIR);
  for (const file of report.checked) {
    const own = report.problems.filter((p) => p.file === file);
    if (own.length === 0) console.log(`OK ${file}`);
    for (const p of own) console.log(line(file, p));
  }
  const errors = report.problems.filter((p) => p.level === "error").length;
  const warnings = report.problems.length - errors;
  console.log(`${report.checked.length} files checked in ${DATA_DIR}: ${errors} error(s), ${warnings} warning(s)`);
  return report.ok ? 0 : 1;
}

async function readInput(file: string): Promise<unknown> {
  const abs = path.resolve(BASE_DIR, file);
  try {
    return await readJson(abs);
  } catch (e) {
    throw new HttpError(400, isNotFound(e) ? `${abs} does not exist` : `${abs}: ${errorMessage(e)}`);
  }
}

async function catalogAdd(file: string, update: boolean): Promise<number> {
  const item = await saveItem(DATA_DIR, await readInput(file), { update });
  console.log(itemFile(DATA_DIR, item.id));
  return 0;
}

async function catalogImage(itemId: string, url: string, caption: string | undefined): Promise<number> {
  const { image, created } = await addImageToItem(DATA_DIR, itemId, url, { caption });
  console.log(path.join(imagesDir(DATA_DIR), image.file));
  if (!created) console.error(`already attached to ${itemId} from this URL; nothing downloaded`);
  return 0;
}

/** The variant is --variant, else the file's, else "a"; the name is --name, else the file's, else the saved one. */
async function layoutSet(room: string, file: string, variantFlag: string | undefined, nameFlag: string | undefined): Promise<number> {
  const input = await readInput(file);
  const fields = typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : undefined;
  if (fields?.room !== undefined && fields.room !== room) {
    throw new HttpError(400, `${file} is the layout for ${JSON.stringify(fields.room)}, not "${room}"`);
  }
  const variant = variantFlag ?? fields?.variant ?? STAGED_VARIANT;
  if (typeof variant !== "string") throw new HttpError(400, `${file}: "variant" is ${JSON.stringify(variant)}, not a variant id such as "b"`);
  const body = fields ? { ...fields, variant, ...(nameFlag !== undefined ? { name: nameFlag } : {}) } : input;
  await saveLayout(DATA_DIR, room, variant, body);
  console.log(layoutFile(DATA_DIR, room, variant));
  const rel = `layouts/${room}/${variant}.json`;
  for (const p of (await validateAll(DATA_DIR)).problems) if (p.file === rel) console.error(line(rel, p));
  return 0;
}

async function layoutList(room: string | undefined): Promise<number> {
  const rooms = room === undefined ? (await loadRooms(DATA_DIR)).rooms.map((r) => r.id).filter(isRoomId) : [room];
  const out: string[] = [];
  for (const id of rooms) out.push(...variantLines(await listVariants(DATA_DIR, id)));
  for (const l of out) console.log(l);
  if (out.length === 0) console.error(room === undefined ? "no layouts saved yet" : `no layouts saved for "${room}" yet`);
  return 0;
}

async function layoutPromote(room: string, variant: string): Promise<number> {
  const list = await promoteVariant(DATA_DIR, room, variant);
  if (variant === STAGED_VARIANT) console.error(`"${STAGED_VARIANT}" is already the staged pick; nothing changed`);
  for (const l of variantLines(list)) console.log(l);
  return 0;
}

async function run(argv: string[]): Promise<number | undefined> {
  const [command, sub, ...rest] = argv;
  if (command === "validate" && argv.length === 1) return validate();
  if (command === "catalog" && sub === "add") {
    const a = parse(rest, { update: { type: "boolean" } }, 1);
    return a && catalogAdd(a.positionals[0]!, a.values.update === true);
  }
  if (command === "catalog" && sub === "image") {
    const a = parse(rest, { caption: { type: "string" } }, 2);
    return a && catalogImage(a.positionals[0]!, a.positionals[1]!, str(a.values.caption));
  }
  if (command === "layout" && sub === "set") {
    const a = parse(rest, { variant: { type: "string" }, name: { type: "string" } }, 2);
    return a && layoutSet(a.positionals[0]!, a.positionals[1]!, str(a.values.variant), str(a.values.name));
  }
  if (command === "layout" && sub === "list") {
    const a = parse(rest, {}, 0, 1);
    return a && layoutList(a.positionals[0]);
  }
  if (command === "layout" && sub === "promote") {
    const a = parse(rest, {}, 2);
    return a && layoutPromote(a.positionals[0]!, a.positionals[1]!);
  }
  return undefined;
}

async function main(argv: string[]): Promise<number> {
  if (argv.length === 1 && ["help", "--help", "-h"].includes(argv[0]!)) {
    console.log(USAGE);
    return 0;
  }
  const label = argv.slice(0, argv[0] === "validate" ? 1 : 2).join(" ");
  try {
    const code = await run(argv);
    if (code !== undefined) return code;
  } catch (e) {
    console.error(`${label}: ${e instanceof HttpError ? e.message : errorMessage(e)}`);
    for (const issue of (e instanceof HttpError && e.issues) || []) console.error(`  ${issue}`);
    return 1;
  }
  console.error(USAGE);
  return 2;
}

process.exitCode = await main(process.argv.slice(2));
