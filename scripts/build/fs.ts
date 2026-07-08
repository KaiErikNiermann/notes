import { promises as fsp, constants as fsConstants } from "node:fs";
import * as path from "node:path";
import picomatch from "picomatch";

const SKIP_DIRS: ReadonlySet<string> = new Set([".git", "node_modules", ".lake", "_out", ".cache"]);

/**
 * Walk `root` and yield every file path relative to `root`, skipping common
 * heavy directories. Used by `glob` below.
 */
const walk = async function* (root: string, rel: string = ""): AsyncIterable<string> {
  const here = path.join(root, rel);
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fsp.readdir(here, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const ent of entries) {
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      yield* walk(root, path.join(rel, ent.name));
    } else if (ent.isFile() || ent.isSymbolicLink()) {
      yield path.join(rel, ent.name);
    }
  }
};

// Classify patterns by their static prefix (`picomatch.scan`): exact paths (no
// glob magic), the base dirs of scoped globs, and whether any pattern (e.g.
// `**/*.ts`) has an empty prefix and thus forces a whole-tree walk.
interface PatternScan {
  readonly exactPaths: readonly string[];
  readonly baseDirs: string[];
  readonly walkWholeTree: boolean;
}
const scanPatterns = (patterns: readonly string[]): PatternScan => {
  const exactPaths: string[] = [];
  const baseDirs: string[] = [];
  let walkWholeTree = false;
  for (const p of patterns) {
    const { base, glob } = picomatch.scan(p);
    if (glob === "") exactPaths.push(base);
    else if (base === "" || base === ".") walkWholeTree = true;
    else baseDirs.push(base);
  }
  return { exactPaths, baseDirs, walkWholeTree };
};

/**
 * Glob a set of patterns against the filesystem rooted at `root`.
 * Patterns are interpreted relative to `root` (so `lean/**\/*.lean`,
 * not `/abs/lean/**\/*.lean`). Returns absolute paths sorted lexically.
 */
export const makeGlob = (root: string) => async (patterns: readonly string[]): Promise<readonly string[]> => {
  if (patterns.length === 0) return [];
  const matchers = patterns.map((p) =>
    picomatch(p, { dot: true, nocase: false }),
  );

  const matches: string[] = [];
  const pushIfMatch = (rel: string): void => {
    const relPosix = rel.split(path.sep).join("/");
    if (matchers.some((m) => m(relPosix))) {
      matches.push(path.join(root, rel));
    }
  };

  // Rather than walking the whole tree for every call, use each pattern's static
  // prefix to walk only the subtrees that could contain matches — a pattern
  // scoped to `theme/` never descends into `output/` or `lean/`. Results are
  // identical to a full walk; only the set of directories visited shrinks.
  const { exactPaths, baseDirs, walkWholeTree } = scanPatterns(patterns);

  if (walkWholeTree) {
    for await (const rel of walk(root)) pushIfMatch(rel);
    return [...new Set(matches)].sort();
  }

  for (const ep of exactPaths) {
    try {
      const st = await fsp.stat(path.join(root, ep));
      if (st.isDirectory()) baseDirs.push(ep);
      else pushIfMatch(ep);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
  }

  for (const base of collapseNestedBases(baseDirs)) {
    for await (const rel of walk(root, base)) pushIfMatch(rel);
  }
  // An exact-path match and a base-dir walk can surface the same file; dedup so
  // the result is the identical set a single whole-tree walk would produce.
  return [...new Set(matches)].sort();
};

/**
 * Drop any base that is nested under another base — walking the ancestor
 * already covers it, so we'd otherwise traverse the subtree twice.
 */
const collapseNestedBases = (bases: readonly string[]): readonly string[] => {
  const sorted = [...new Set(bases)].sort();
  const kept: string[] = [];
  for (const b of sorted) {
    if (kept.some((k) => b === k || b.startsWith(`${k}/`))) continue;
    kept.push(b);
  }
  return kept;
};

export const copy = async (src: string, dst: string): Promise<void> => {
  await fsp.mkdir(path.dirname(dst), { recursive: true });
  await fsp.copyFile(src, dst);
};

export const read = (p: string): Promise<Buffer> => fsp.readFile(p);

export const write = async (p: string, data: Buffer | string): Promise<void> => {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, data);
};

export const mkdir = (p: string): Promise<void> => fsp.mkdir(p, { recursive: true }).then(() => {});

export const rmrf = (p: string): Promise<void> => fsp.rm(p, { recursive: true, force: true });

export const exists = async (p: string): Promise<boolean> => {
  try {
    await fsp.access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
};

/** Convenience: build the bundle of fs helpers used by StageContext. */
export const makeFsBundle = (root: string) =>
  ({
    glob: makeGlob(root),
    copy,
    read,
    write,
    mkdir,
    rmrf,
    exists,
  }) as const;
