/**
 * Core types for the static-site build orchestrator.
 *
 * A `Stage` is one transformation: a set of input globs → declared output
 * paths/globs → a `run` function that performs the work. Stages are values,
 * not classes — the registry is just an `as const` array. The executor knows
 * nothing about individual stages; it topo-sorts, hashes inputs, and dispatches.
 *
 * StageName is exported as a string union so that `dependsOn` typos become
 * compile errors at the registry boundary.
 */

export type StageName =
  | "verso"
  | "forester"
  | "xslt"
  | "inline-verso"
  | "inline-assets"
  | "bundle-js"
  | "theme-sync"
  | "publish"
  | "graph-vendor"
  | "graph-data"
  | "graph-page"
  | "d3-figures";

export const ALL_STAGE_NAMES: readonly StageName[] = [
  "verso",
  "forester",
  "xslt",
  "inline-verso",
  "inline-assets",
  "bundle-js",
  "theme-sync",
  "publish",
  "graph-vendor",
  "graph-data",
  "graph-page",
  "d3-figures",
] as const;

export type Stage<N extends StageName = StageName> = Readonly<{
  name: N;
  dependsOn: readonly StageName[];
  inputs: readonly string[]; // globs (relative to project root)
  outputs: readonly string[]; // globs/paths (for visibility + skip rule)
  run: (ctx: StageContext) => Promise<void>;
  /** Optional override: return a cache key instead of hashing inputs. */
  cacheKey?: (ctx: StageContext) => Promise<string>;
}>;

export type ExecOpts = Readonly<{
  cwd?: string;
  env?: Readonly<Record<string, string>>;
  verbose?: boolean;
}>;

export type Logger = Readonly<{
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  /** Prefixed sub-logger for a stage. */
  child: (prefix: string) => Logger;
}>;

export type StageContext = Readonly<{
  root: string;
  stageName: StageName;
  logger: Logger;
  exec: (cmd: string, args: readonly string[], opts?: ExecOpts) => Promise<void>;
  fs: Readonly<{
    glob: (patterns: readonly string[]) => Promise<readonly string[]>;
    copy: (src: string, dst: string) => Promise<void>;
    read: (path: string) => Promise<Buffer>;
    write: (path: string, data: Buffer | string) => Promise<void>;
    mkdir: (path: string) => Promise<void>;
    rmrf: (path: string) => Promise<void>;
    exists: (path: string) => Promise<boolean>;
  }>;
  signal: AbortSignal;
}>;

export type StageError =
  | { kind: "missing-tool"; tool: string; hint?: string }
  | { kind: "subprocess-failed"; cmd: string; exitCode: number; stderr: string }
  | { kind: "input-not-found"; path: string }
  | { kind: "output-not-produced"; expected: string }
  | { kind: "stage-threw"; message: string; stack?: string };

export type StageOutcome =
  | { kind: "cached"; name: StageName; hashShort: string }
  | { kind: "ran"; name: StageName; durationMs: number; hashShort: string }
  | { kind: "skipped"; name: StageName; reason: SkipReason }
  | { kind: "failed"; name: StageName; error: StageError };

export type SkipReason =
  | { kind: "no-inputs" }
  | { kind: "upstream-failed"; upstream: StageName }
  | { kind: "not-in-only-filter" };

export type FileEvent =
  | { kind: "add"; path: string }
  | { kind: "change"; path: string }
  | { kind: "unlink"; path: string };

export type RunOptions = Readonly<{
  watch?: boolean;
  dryRun?: boolean;
  only?: readonly StageName[];
  verbose?: boolean;
  onProgress?: (outcome: StageOutcome) => void;
  onWatchTick?: (eventsFlushed: number) => void;
}>;

export type RunResult = Readonly<{
  outcomes: readonly StageOutcome[];
  failed: number;
}>;
