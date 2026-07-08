#!/usr/bin/env tsx
/**
 * scripts/bib-to-tree.ts — turn a BibTeX store into Forester reference trees.
 *
 *   tsx scripts/bib-to-tree.ts                     # generate from references.bib
 *   tsx scripts/bib-to-tree.ts --force             # also re-sync existing trees
 *   tsx scripts/bib-to-tree.ts --add 10.1016/...   # resolve an id, append, generate
 *   tsx scripts/bib-to-tree.ts --add <id> --print  # just print the resolved BibTeX
 *
 * Model — the .bib is a light store you dump entries into; the generated trees
 * are yours to edit afterwards:
 *
 *   - Trees are matched to BibTeX entries by their `\meta{ID}{<citekey>}`, NOT by
 *     filename, so a tree stays matched even after you rename/move it.
 *   - Default is APPEND-ONLY: a new tree is written for every entry that has no
 *     matching tree yet; entries that already have a tree are left untouched.
 *   - `--force` additionally re-writes the trees that DO match, syncing them back
 *     to the .bib (in place, at their current path).
 *   - Nothing is ever deleted. A tree with no corresponding BibTeX entry (an
 *     orphan, or a hand-written stub without a `\meta{ID}`) is always skipped.
 *
 * `--add` uses citation.js to resolve an identifier (DOI / URL / Wikidata / …) to
 * a BibTeX entry. By default it appends the entry to the .bib and then runs an
 * append-only generation pass (so only the new tree is created). Use
 * `--no-generate` to append without generating, or `--print` to emit the entry to
 * stdout without touching the .bib at all.
 *
 * Both parsing and resolution go through citation.js: parsing reads the raw
 * `@…/entries+list` intermediate (verbatim field names + values), so URLs and
 * non-CSL fields like `eprint`/`archiveprefix` survive intact.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";

import type { BibtexEntry } from "@citation-js/core";

const DEFAULT_BIB = "references.bib";
const DEFAULT_OUT = "trees/references";

// citation.js auto-detects bib(la)tex; we request the raw entry list for whichever
// flavour it picks, so values are not yet normalised to CSL.
const ENTRY_LIST_TARGETS = ["@biblatex/entries+list", "@bibtex/entries+list"] as const;

// Fields rendered explicitly (\title, \author, \date) rather than as \meta lines.
const SKIP_FIELDS = new Set(["title", "author", "year", "month", "day"]);
// Fields that collapse to a single \meta{external} link.
const URL_FIELDS = new Set(["url", "howpublished", "external"]);
const META_ID_RE = /\\meta\{ID\}\{([^}]+)\}/;
const ENTRY_KEY_RE = /^@\w+\{([^,]+),/gm;

const MONTH_NAMES: Readonly<Record<string, number>> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// ----------------------------------------------------------------------------
// Field formatting
// ----------------------------------------------------------------------------

function stripBraces(value: string): string {
  let result = value.trim();
  while (result.length > 1 && result.startsWith("{") && result.endsWith("}")) {
    result = result.slice(1, -1).trim();
  }
  return result;
}

// Property values are usually strings but may be numbers (bare numeric fields).
type PropValue = string | number | undefined;

function cleanWhitespace(value: PropValue): string {
  if (value === undefined) return "";
  const text = typeof value === "string" ? value : String(value);
  if (!text) return "";
  return stripBraces(text.replaceAll(/\s+/g, " ").trim());
}

function formatAuthors(raw: PropValue): string | null {
  const cleaned = cleanWhitespace(raw);
  if (!cleaned) return null;
  const authors = cleaned.split(" and ").map((part) => part.trim()).filter(Boolean);
  return authors.length > 0 ? authors.join(", ") : null;
}

function parseMonth(raw: PropValue): number {
  if (raw === undefined) return 1;
  const month = String(raw).trim().toLowerCase();
  if (!month) return 1;
  const numeric = /^(\d{1,2})/.exec(month)?.[1];
  if (numeric) {
    const value = Number.parseInt(numeric, 10);
    if (value >= 1 && value <= 12) return value;
  }
  return MONTH_NAMES[month.slice(0, 3)] ?? 1;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function formatDate(properties: BibtexEntry["properties"]): string | null {
  const year = cleanWhitespace(properties["year"]);
  const yearNum = Number.parseInt(year, 10);
  if (!year || !Number.isFinite(yearNum)) return null;
  const month = parseMonth(properties["month"]);
  const dayRaw = cleanWhitespace(properties["day"]);
  const dayNum = dayRaw ? Number.parseInt(dayRaw, 10) : 1;
  const day = Number.isFinite(dayNum) ? Math.min(Math.max(dayNum, 1), 31) : 1;
  return `${pad(yearNum, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

function stripUrlCommand(value: string): string {
  const trimmed = value.trim();
  const prefix = String.raw`\url{`;
  if (trimmed.startsWith(prefix) && trimmed.endsWith("}")) {
    return trimmed.slice(prefix.length, -1).trim();
  }
  return trimmed;
}

// `%` starts a comment in Forester/TeX, so it must be escaped in metadata values.
function escapeMetaValue(value: string): string {
  return value.replaceAll("%", String.raw`\%`);
}

function metaPairs(entry: BibtexEntry): ReadonlyArray<readonly [string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const [field, value] of Object.entries(entry.properties)) {
    const lower = field.toLowerCase();
    if (SKIP_FIELDS.has(lower)) continue;
    let text = cleanWhitespace(value);
    if (!text) continue;
    const isUrl = URL_FIELDS.has(lower);
    if (isUrl) text = stripUrlCommand(text);
    pairs.push([isUrl ? "external" : field, escapeMetaValue(text)]);
  }
  // Carry the BibTeX entry type and cite key through as metadata. `ID` is what
  // \cite resolves against and what this script uses to match trees to entries.
  pairs.push(
    ["ENTRYTYPE", escapeMetaValue(entry.type)],
    ["ID", escapeMetaValue(entry.label)],
  );
  return pairs;
}

function buildTreeContent(entry: BibtexEntry): string {
  const title = cleanWhitespace(entry.properties["title"]) || "Untitled";
  const lines: string[] = [String.raw`\title{${title}}`, String.raw`\taxon{Reference}`];

  const authors = formatAuthors(entry.properties["author"]);
  if (authors) lines.push(String.raw`\author/literal{${authors}}`);

  const date = formatDate(entry.properties);
  if (date) lines.push(String.raw`\date{${date}}`);

  for (const [key, value] of metaPairs(entry)) lines.push(String.raw`\meta{${key}}{${value}}`);

  lines.push("");
  return lines.join("\n");
}

function slugify(name: string): string {
  const slug = stripBraces(name.trim().toLowerCase())
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "reference";
}

// ----------------------------------------------------------------------------
// Parsing (citation.js)
// ----------------------------------------------------------------------------

/** Parse a .bib string into raw BibTeX entries via citation.js's entry-list format. */
async function parseBibtex(source: string): Promise<readonly BibtexEntry[]> {
  const { plugins } = await import("@citation-js/core");
  await import("@citation-js/plugin-bibtex");
  let lastError: unknown;
  for (const target of ENTRY_LIST_TARGETS) {
    try {
      const entries = plugins.input.chain(source, { generateGraph: false, target });
      if (entries.length > 0) return entries;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw new Error(`could not parse BibTeX: ${errMessage(lastError)}`);
  return [];
}

// ----------------------------------------------------------------------------
// Generation
// ----------------------------------------------------------------------------

interface GenResult {
  readonly created: string[];
  readonly synced: string[];
  readonly skipped: string[];
}

/** Map every existing tree's `\meta{ID}` to its path, so renamed trees stay matched. */
function scanExistingIds(outDir: string): Map<string, string> {
  const ids = new Map<string, string>();
  if (!existsSync(outDir)) return ids;
  for (const name of readdirSync(outDir)) {
    if (!name.endsWith(".tree")) continue;
    const full = path.join(outDir, name);
    const match = META_ID_RE.exec(readFileSync(full, "utf-8"));
    if (match?.[1]) ids.set(match[1], full);
  }
  return ids;
}

/** A fresh tree path for `slug`, suffixed if a same-named file already exists. */
function uniqueTreePath(outDir: string, slug: string): string {
  let candidate = path.join(outDir, `${slug}.tree`);
  let n = 2;
  while (existsSync(candidate)) {
    candidate = path.join(outDir, `${slug}-${n}.tree`);
    n += 1;
  }
  return candidate;
}

async function generate(bibPath: string, outDir: string, force: boolean): Promise<GenResult> {
  if (!existsSync(bibPath)) throw new Error(`BibTeX file not found: ${bibPath}`);
  const entries = await parseBibtex(readFileSync(bibPath, "utf-8"));
  if (entries.length === 0) throw new Error(`No BibTeX entries found in ${bibPath}`);

  mkdirSync(outDir, { recursive: true });
  const existing = scanExistingIds(outDir);
  const result: GenResult = { created: [], synced: [], skipped: [] };

  for (const entry of entries) {
    const content = buildTreeContent(entry);
    const existingPath = existing.get(entry.label);
    if (existingPath) {
      if (force) {
        writeFileSync(existingPath, content);
        result.synced.push(path.relative(process.cwd(), existingPath));
      } else {
        result.skipped.push(entry.label);
      }
      continue;
    }
    const target = uniqueTreePath(outDir, slugify(entry.label));
    writeFileSync(target, content);
    existing.set(entry.label, target);
    result.created.push(path.relative(process.cwd(), target));
  }
  return result;
}

// ----------------------------------------------------------------------------
// citation.js: resolve an identifier -> append BibTeX
// ----------------------------------------------------------------------------

function bibKeys(bib: string): Set<string> {
  const keys = new Set<string>();
  for (const match of bib.matchAll(ENTRY_KEY_RE)) {
    const key = match[1]?.trim();
    if (key) keys.add(key);
  }
  return keys;
}

async function addFromIdentifiers(
  identifiers: readonly string[],
  bibPath: string,
  outDir: string,
  doGenerate: boolean,
  printOnly: boolean,
): Promise<void> {
  // Loaded lazily: a plain generation run never needs the network plugin.
  const { Cite } = await import("@citation-js/core");
  await import("@citation-js/plugin-doi");
  await import("@citation-js/plugin-bibtex");

  const existingKeys = bibKeys(existsSync(bibPath) ? readFileSync(bibPath, "utf-8") : "");
  let appended = 0;

  for (const identifier of identifiers) {
    let bibtex: string;
    try {
      bibtex = (await Cite.async(identifier)).format("bibtex").trim();
    } catch (error) {
      logError(`could not resolve "${identifier}": ${errMessage(error)}`);
      continue;
    }
    if (!bibtex) {
      logError(`"${identifier}" produced no BibTeX`);
      continue;
    }
    const key = /^@\w+\{([^,]+),/.exec(bibtex)?.[1]?.trim();

    if (printOnly) {
      process.stdout.write(`${bibtex}\n\n`);
      continue;
    }
    if (key && existingKeys.has(key)) {
      logWarn(`"${key}" is already in ${bibPath}; skipping`);
      continue;
    }
    appendFileSync(bibPath, `\n${bibtex}\n`);
    if (key) existingKeys.add(key);
    appended += 1;
    logInfo(`added ${key ?? identifier} to ${bibPath}`);
  }

  if (printOnly || !doGenerate || appended === 0) return;
  reportGeneration(await generate(bibPath, outDir, false));
}

// ----------------------------------------------------------------------------
// CLI
// ----------------------------------------------------------------------------

const USAGE = `Usage: bib-to-tree [options] [bibfile]

Generate Forester reference trees from a BibTeX store (default: ${DEFAULT_BIB}).

Options:
  --bib <path>     BibTeX source file (default: ${DEFAULT_BIB})
  --out <dir>      Output directory for reference trees (default: ${DEFAULT_OUT})
  --force          Re-sync existing trees from the .bib (default: append-only)
  --add <id>       Resolve a DOI/URL/identifier via citation.js and append it to
                   the .bib, then generate. Repeatable.
  --no-generate    With --add: append to the .bib only; do not generate trees
  --print          With --add: print the resolved BibTeX to stdout; do not write
  -h, --help       Show this help
`;

function logInfo(message: string): void {
  process.stderr.write(`${message}\n`);
}

function logWarn(message: string): void {
  process.stderr.write(`warning: ${message}\n`);
}

function logError(message: string): void {
  process.stderr.write(`error: ${message}\n`);
}

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function reportGeneration(result: GenResult): void {
  for (const file of result.created) logInfo(`created ${file}`);
  for (const file of result.synced) logInfo(`synced  ${file}`);
  logInfo(
    `${result.created.length} created, ${result.synced.length} synced, ` +
      `${result.skipped.length} skipped`,
  );
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      bib: { type: "string" },
      out: { type: "string" },
      force: { type: "boolean", default: false },
      add: { type: "string", multiple: true },
      "no-generate": { type: "boolean", default: false },
      print: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    process.stdout.write(USAGE);
    return;
  }

  const bibPath = positionals[0] ?? values.bib ?? DEFAULT_BIB;
  const outDir = values.out ?? DEFAULT_OUT;
  const identifiers = values.add ?? [];

  if (identifiers.length > 0) {
    await addFromIdentifiers(
      identifiers,
      bibPath,
      outDir,
      !values["no-generate"],
      values.print ?? false,
    );
    return;
  }

  reportGeneration(await generate(bibPath, outDir, values.force ?? false));
}

main().catch((error: unknown) => {
  logError(errMessage(error));
  process.exitCode = 1;
});
