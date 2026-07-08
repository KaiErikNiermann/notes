#!/usr/bin/env tsx
/**
 * scripts/sync-template.ts — project this forest's generic file-set into the
 * copier template repo, so downstream forests can `copier update` to pull the
 * latest build pipeline / theme / macros.
 *
 *   tsx scripts/sync-template.ts ../forest-template          # mirror + prune
 *   tsx scripts/sync-template.ts ../forest-template --dry-run
 *   tsx scripts/sync-template.ts ../forest-template --no-prune
 *
 * What it does, driven entirely by scripts/template-manifest.ts:
 *   1. `include` globs are matched against `git ls-files` (so only *tracked*,
 *      shareable files are ever mirrored) and copied verbatim.
 *   2. `templated` files are read from disk, have their personal values rewritten
 *      to copier placeholders, and are written with a `.jinja` suffix.
 *   3. Every emitted path is recorded in `<dest>/.sync-manifest.json`. On the
 *      next run, any path that was emitted before but isn't now is pruned — so
 *      deletions here propagate. Files the template owns by hand (copier.yml,
 *      the scaffold stubs) are never in that set and are never touched.
 *
 * Writes are incremental: a file whose content is unchanged is left alone.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import * as path from "node:path";
import { posix } from "node:path";
import { parseArgs } from "node:util";

import picomatch from "picomatch";

import { TEMPLATE_MANIFEST, type TemplateManifest } from "./template-manifest";

const SYNC_MANIFEST = ".sync-manifest.json";

// ----------------------------------------------------------------------------
// Logging
// ----------------------------------------------------------------------------

function logInfo(message: string): void {
  process.stderr.write(`${message}\n`);
}

function logError(message: string): void {
  process.stderr.write(`error: ${message}\n`);
}

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ----------------------------------------------------------------------------
// Repo + filesystem walk
// ----------------------------------------------------------------------------

// Directory names never descended into while collecting candidates — build
// artifacts, installs and VCS state that no include glob should ever want.
const DIR_IGNORE = new Set([
  "node_modules", ".git", ".tmp", ".venv", "__pycache__", "output", "build",
]);

// This is a dev build tool; git is expected on PATH, just like `forester`.
function git(args: readonly string[], cwd?: string): Buffer {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- see above
  return execFileSync("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
}

function repoRoot(): string {
  return git(["rev-parse", "--show-toplevel"]).toString().trim();
}

/** The literal directory prefix of a glob (everything before the first wildcard). */
function globRoot(glob: string): string {
  const wildcard = glob.search(/[*?[{]/);
  const prefix = wildcard === -1 ? glob : glob.slice(0, wildcard);
  const slash = prefix.lastIndexOf("/");
  return slash === -1 ? "" : prefix.slice(0, slash);
}

/** All files under `<root>/<dir>` (repo-relative, POSIX), skipping DIR_IGNORE dirs. */
function walkFiles(root: string, dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = dir ? posix.join(dir, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if (!DIR_IGNORE.has(entry.name)) found.push(...walkFiles(root, rel));
    } else if (entry.isFile()) {
      found.push(rel);
    }
  }
  return found;
}

function compileMatchers(globs: readonly string[]): (candidate: string) => boolean {
  const matchers = globs.map((glob) => picomatch(glob, { dot: true }));
  return (candidate) => matchers.some((match) => match(candidate));
}

/**
 * Candidate files for the `include` globs. The pipeline is largely untracked, so
 * we walk the filesystem (from each glob's literal root) rather than git — the
 * include globs themselves are the whitelist. Literal (wildcard-free) entries
 * are taken directly.
 */
function includeCandidates(root: string, include: readonly string[]): readonly string[] {
  const roots = new Set<string>();
  const literals: string[] = [];
  for (const glob of include) {
    if (/[*?[{]/.test(glob)) roots.add(globRoot(glob));
    else literals.push(glob);
  }
  const walked = [...roots].flatMap((dir) => (existsSync(path.join(root, dir)) ? walkFiles(root, dir) : []));
  return [...new Set([...literals, ...walked])];
}

// ----------------------------------------------------------------------------
// Emit planning
// ----------------------------------------------------------------------------

interface Emit {
  /** Template-repo-relative destination path (POSIX). */
  readonly dest: string;
  readonly content: Buffer;
}

function applyReplacements(
  text: string,
  replacements: ReadonlyArray<readonly [string, string]>,
): string {
  let result = text;
  for (const [from, to] of replacements) result = result.replaceAll(from, to);
  return result;
}

/** Build the full set of files to write, from `include` globs + `templated` entries. */
function planEmits(root: string, manifest: TemplateManifest): Emit[] {
  const isIncluded = compileMatchers(manifest.include);
  const isExcluded = compileMatchers(manifest.exclude);

  const emits = new Map<string, Buffer>();

  for (const rel of trackedFiles(root)) {
    if (!isIncluded(rel) || isExcluded(rel)) continue;
    const abs = path.join(root, rel);
    // A path can be in the index but gone from disk (e.g. a staged deletion).
    if (!existsSync(abs)) continue;
    emits.set(rel, readFileSync(abs));
  }

  for (const entry of manifest.templated) {
    const srcPath = path.join(root, entry.src);
    if (!existsSync(srcPath)) throw new Error(`templated source missing: ${entry.src}`);
    const rendered = applyReplacements(readFileSync(srcPath, "utf-8"), entry.replace);
    emits.set(entry.dest, Buffer.from(rendered, "utf-8"));
  }

  return [...emits].map(([dest, content]) => ({ dest, content }));
}

// ----------------------------------------------------------------------------
// Write + prune
// ----------------------------------------------------------------------------

function sha(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

interface SyncManifest {
  readonly version: 1;
  readonly files: readonly string[];
}

function readPrevFiles(destRoot: string): readonly string[] {
  const manifestPath = path.join(destRoot, SYNC_MANIFEST);
  if (!existsSync(manifestPath)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf-8"));
    const files = (parsed as { files?: unknown }).files;
    if (!Array.isArray(files)) return [];
    return files.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

interface SyncStats {
  created: number;
  updated: number;
  unchanged: number;
  pruned: number;
}

function writeEmit(destRoot: string, emit: Emit, dryRun: boolean, stats: SyncStats): void {
  const full = path.join(destRoot, emit.dest);
  if (existsSync(full) && sha(readFileSync(full)) === sha(emit.content)) {
    stats.unchanged += 1;
    return;
  }
  const verb = existsSync(full) ? "update" : "create";
  if (verb === "create") stats.created += 1;
  else stats.updated += 1;
  logInfo(`${dryRun ? `${verb} (dry)` : verb.padEnd(6)} ${emit.dest}`);
  if (dryRun) return;
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, emit.content);
}

/** Remove now-empty ancestor directories, stopping at (but never removing) destRoot. */
function pruneEmptyDirs(destRoot: string, fileRel: string): void {
  let dir = path.dirname(path.join(destRoot, fileRel));
  const root = path.resolve(destRoot);
  while (path.resolve(dir) !== root && existsSync(dir) && readdirSync(dir).length === 0) {
    rmdirSync(dir);
    dir = path.dirname(dir);
  }
}

function prune(
  destRoot: string,
  current: ReadonlySet<string>,
  prev: readonly string[],
  dryRun: boolean,
  stats: SyncStats,
): void {
  for (const rel of prev) {
    if (current.has(rel)) continue;
    const full = path.join(destRoot, rel);
    if (!existsSync(full)) continue;
    stats.pruned += 1;
    logInfo(`${dryRun ? "prune (dry)" : "prune "} ${rel}`);
    if (dryRun) continue;
    unlinkSync(full);
    pruneEmptyDirs(destRoot, rel);
  }
}

// ----------------------------------------------------------------------------
// CLI
// ----------------------------------------------------------------------------

const USAGE = `Usage: sync-template <template-repo-dir> [options]

Mirror this forest's generic file-set (see scripts/template-manifest.ts) into
the copier template repo at <template-repo-dir>.

Options:
  --dry-run     Report what would change; write nothing
  --no-prune    Keep files that are no longer emitted (default: prune them)
  -h, --help    Show this help
`;

function main(): void {
  const { values, positionals } = parseArgs({
    options: {
      "dry-run": { type: "boolean", default: false },
      prune: { type: "boolean", default: true },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    process.stdout.write(USAGE);
    return;
  }

  const destArg = positionals[0];
  if (!destArg) throw new Error("missing <template-repo-dir> argument (see --help)");
  const destRoot = path.resolve(destArg);
  if (!existsSync(destRoot) || !statSync(destRoot).isDirectory()) {
    throw new Error(`template repo dir not found: ${destRoot} (create/clone it first)`);
  }

  const dryRun = values["dry-run"] ?? false;
  const doPrune = values.prune ?? true;

  const root = repoRoot();
  const emits = planEmits(root, TEMPLATE_MANIFEST);
  const current = new Set(emits.map((emit) => emit.dest));
  const stats: SyncStats = { created: 0, updated: 0, unchanged: 0, pruned: 0 };

  for (const emit of emits) writeEmit(destRoot, emit, dryRun, stats);
  if (doPrune) prune(destRoot, current, readPrevFiles(destRoot), dryRun, stats);

  if (!dryRun) {
    const manifest: SyncManifest = { version: 1, files: [...current].sort() };
    writeFileSync(path.join(destRoot, SYNC_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  }

  logInfo(
    `${dryRun ? "[dry-run] " : ""}${stats.created} created, ${stats.updated} updated, ` +
      `${stats.unchanged} unchanged, ${stats.pruned} pruned`,
  );
}

try {
  main();
} catch (error) {
  logError(errMessage(error));
  process.exitCode = 1;
}
