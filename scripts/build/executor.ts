import * as path from "node:path";
import picomatch from "picomatch";
import { match } from "ts-pattern";
import { StageExecError, formatStageError, runSubprocess } from "./exec";
import { makeFsBundle } from "./fs";
import { hashFiles, hashShort } from "./hash";
import { rootLogger } from "./log";
import type {
  RunOptions,
  RunResult,
  Stage,
  StageContext,
  StageError,
  StageName,
  StageOutcome,
} from "./types";

const CACHE_DIR = "build/.cache";

const validateRegistry = (stages: readonly Stage[]): readonly Stage[] => {
  const names = new Set<StageName>(stages.map((s) => s.name));
  for (const s of stages) {
    for (const dep of s.dependsOn) {
      if (!names.has(dep)) {
        throw new Error(`stage "${s.name}" depends on unknown stage "${dep}"`);
      }
    }
  }
  return stages;
};

const topoSort = (stages: readonly Stage[]): readonly Stage[] => {
  const byName = new Map(stages.map((s) => [s.name, s]));
  const sorted: Stage[] = [];
  const seen = new Set<StageName>();
  const visiting = new Set<StageName>();

  const visit = (name: StageName): void => {
    if (seen.has(name)) return;
    if (visiting.has(name)) {
      throw new Error(`dependency cycle through "${name}"`);
    }
    visiting.add(name);
    const s = byName.get(name);
    if (!s) throw new Error(`unknown stage "${name}"`);
    for (const dep of s.dependsOn) visit(dep);
    visiting.delete(name);
    seen.add(name);
    sorted.push(s);
  };

  for (const s of stages) visit(s.name);
  return sorted;
};

const cachePath = (root: string, name: StageName): string =>
  path.join(root, CACHE_DIR, `${name}.hash`);

const readCachedHash = async (root: string, name: StageName): Promise<string | null> => {
  try {
    const fs = makeFsBundle(root);
    if (!(await fs.exists(cachePath(root, name)))) return null;
    return (await fs.read(cachePath(root, name))).toString("utf-8").trim();
  } catch {
    return null;
  }
};

const writeCachedHash = async (root: string, name: StageName, hex: string): Promise<void> => {
  const fs = makeFsBundle(root);
  await fs.write(cachePath(root, name), hex);
};

const computeStageHash = async (root: string, stage: Stage): Promise<string> => {
  const fs = makeFsBundle(root);
  const paths = await fs.glob(stage.inputs);
  return hashFiles(root, paths);
};

/**
 * Conservative check for whether running a stage could mutate files that also
 * feed its input hash — i.e. an input glob and an output glob share a base
 * directory (one is an ancestor of, or equal to, the other). Used to decide
 * whether the post-run re-hash is necessary. Errs towards `true` (re-hash) when
 * a base is empty/unknown, so this can only ever cost a redundant re-hash, never
 * skip a needed one.
 */
const inputsMayOverlapOutputs = (stage: Stage): boolean => {
  const base = (p: string): string => picomatch.scan(p).base;
  const related = (a: string, b: string): boolean =>
    a === "" || b === "" || a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
  const inBases = stage.inputs.map(base);
  const outBases = stage.outputs.map(base);
  return inBases.some((i) => outBases.some((o) => related(i, o)));
};

const outputsExist = async (root: string, stage: Stage): Promise<boolean> => {
  const fs = makeFsBundle(root);
  for (const pat of stage.outputs) {
    // For exact paths (no glob chars) check existence directly.
    if (!/[*?[\]{}]/.test(pat)) {
      if (!(await fs.exists(path.join(root, pat)))) return false;
      continue;
    }
    const matches = await fs.glob([pat]);
    if (matches.length === 0) return false;
  }
  return true;
};

const buildContext = (root: string, stage: Stage, verbose: boolean): StageContext => {
  const stageLogger = rootLogger.child(stage.name);
  return {
    root,
    stageName: stage.name,
    logger: stageLogger,
    exec: (cmd, args, opts) =>
      runSubprocess(cmd, args, {
        cwd: opts?.cwd ?? root,
        ...(opts?.env === undefined ? {} : { env: opts.env }),
        verbose: opts?.verbose ?? verbose,
      }),
    fs: makeFsBundle(root),
    signal: new AbortController().signal,
  };
};

const runStage = async (
  root: string,
  stage: Stage,
  verbose: boolean,
): Promise<StageOutcome> => {
  const ctx = buildContext(root, stage, verbose);
  const t0 = Date.now();
  try {
    const beforeHex = stage.cacheKey ? await stage.cacheKey(ctx) : await computeStageHash(root, stage);
    const cached = await readCachedHash(root, stage.name);
    if (cached === beforeHex && (await outputsExist(root, stage))) {
      return { kind: "cached", name: stage.name, hashShort: hashShort(beforeHex) };
    }
    await stage.run(ctx);
    // Re-hash after running ONLY when the stage may have mutated its own inputs
    // (its input and output globs share a base, e.g. publish writes the
    // output/notes/**/index.html it also reads). For such stages the post-run
    // hash is a steady-state "after" snapshot next builds compare against.
    // When inputs and outputs are disjoint, running cannot change the inputs, so
    // afterHex === beforeHex — recomputing it would re-read every input file's
    // bytes for nothing. (A custom cacheKey may hash anything, so always re-run
    // it.) Worst case of a misjudged disjoint stage is a spurious rebuild next
    // run, never stale output: the stored hash is only ever compared against a
    // freshly recomputed current hash.
    const afterHex =
      stage.cacheKey
        ? await stage.cacheKey(ctx)
        : (inputsMayOverlapOutputs(stage)
            ? await computeStageHash(root, stage)
            : beforeHex);
    await writeCachedHash(root, stage.name, afterHex);
    return {
      kind: "ran",
      name: stage.name,
      durationMs: Date.now() - t0,
      hashShort: hashShort(afterHex),
    };
  } catch (error_) {
    const error: StageError =
      error_ instanceof StageExecError
        ? error_.stageError
        : {
            kind: "stage-threw",
            message: error_ instanceof Error ? error_.message : String(error_),
            ...(error_ instanceof Error && error_.stack !== undefined ? { stack: error_.stack } : {}),
          };
    return { kind: "failed", name: stage.name, error };
  }
};

const formatOutcome = (o: StageOutcome): string =>
  match(o)
    .with({ kind: "cached" }, (x) => `  cache ${x.name.padEnd(14)} (${x.hashShort})`)
    .with({ kind: "ran" }, (x) => `  ran   ${x.name.padEnd(14)} ${x.durationMs}ms (${x.hashShort})`)
    .with({ kind: "skipped" }, (x) =>
      match(x.reason)
        .with({ kind: "no-inputs" }, () => `  skip  ${x.name.padEnd(14)} (no inputs)`)
        .with({ kind: "upstream-failed" }, (r) => `  skip  ${x.name.padEnd(14)} (upstream ${r.upstream} failed)`)
        .with({ kind: "not-in-only-filter" }, () => `  skip  ${x.name.padEnd(14)} (not in --only filter)`)
        .exhaustive(),
    )
    .with({ kind: "failed" }, (x) => `  FAIL  ${x.name.padEnd(14)} ${formatStageError(x.error)}`)
    .exhaustive();

/**
 * Print the topological plan + which stages would currently cache-hit.
 * Read-only — does not run any stage.
 */
export const printDryRun = async (root: string, registry: readonly Stage[]): Promise<void> => {
  const stages = topoSort(validateRegistry(registry));
  process.stdout.write("plan:\n");
  for (const s of stages) {
    const hex = s.cacheKey
      ? await s.cacheKey(buildContext(root, s, false))
      : await computeStageHash(root, s);
    const cached = await readCachedHash(root, s.name);
    const hits = cached === hex && (await outputsExist(root, s));
    const depBit = s.dependsOn.length > 0 ? `← ${s.dependsOn.join(",")}` : "(root)";
    process.stdout.write(`  ${hits ? "✓" : "·"} ${s.name.padEnd(14)} ${depBit}\n`);
  }
};

/**
 * Print Graphviz dot for the dep graph.
 */
export const printGraph = (registry: readonly Stage[]): void => {
  const stages = validateRegistry(registry);
  process.stdout.write("digraph build {\n  rankdir=LR;\n  node [shape=box, style=rounded];\n");
  for (const s of stages) {
    for (const dep of s.dependsOn) {
      process.stdout.write(`  "${dep}" -> "${s.name}";\n`);
    }
    if (s.dependsOn.length === 0) {
      process.stdout.write(`  "${s.name}";\n`);
    }
  }
  process.stdout.write("}\n");
};

/**
 * Run the full registry once. Stages with all upstreams `cached` or `ran` go
 * in the next wave. A `failed` outcome marks the rest of its downstream
 * subgraph as `skipped (upstream-failed)`. Outcomes are emitted via
 * `onProgress` as they finalize.
 */
export const runRegistry = async (
  root: string,
  registry: readonly Stage[],
  opts: RunOptions = {},
): Promise<RunResult> => {
  const stages = topoSort(validateRegistry(registry));
  const byName = new Map(stages.map((s) => [s.name, s]));
  const only = opts.only ? new Set<StageName>(opts.only) : null;
  const verbose = opts.verbose ?? false;
  const emit = opts.onProgress ?? (() => {});
  const log = rootLogger;

  /** Final outcome for each stage, in declaration order. */
  const final = new Map<StageName, StageOutcome>();
  /** Names that already failed (their downstreams will be marked skipped). */
  const failedUpstreamFor = new Map<StageName, StageName>(); // dep → root cause

  const propagateFailure = (causeRoot: StageName): void => {
    // Walk downstream from causeRoot, mark anything not yet completed as upstream-failed.
    const downstream: StageName[] = [];
    for (const s of stages) {
      if (s.dependsOn.some((d) => d === causeRoot || downstream.includes(d))) {
        downstream.push(s.name);
      }
    }
    for (const n of downstream) {
      if (!failedUpstreamFor.has(n)) failedUpstreamFor.set(n, causeRoot);
    }
  };

  // Run in waves: each wave contains stages whose deps are all finalized
  // (either cached/ran or failed/skipped).
  const remaining = new Set<StageName>(stages.map((s) => s.name));
  while (remaining.size > 0) {
    const wave: Stage[] = [];
    for (const name of remaining) {
      const s = byName.get(name);
      if (!s) continue;
      if (s.dependsOn.every((d) => final.has(d))) wave.push(s);
    }
    if (wave.length === 0) {
      log.error("executor stalled — possible cycle escaped validation");
      break;
    }
    const results = await Promise.all(
      wave.map(async (s): Promise<StageOutcome> => {
        if (only && !only.has(s.name)) {
          return { kind: "skipped", name: s.name, reason: { kind: "not-in-only-filter" } };
        }
        if (failedUpstreamFor.has(s.name)) {
          const upstream = failedUpstreamFor.get(s.name);
          if (upstream) {
            return {
              kind: "skipped",
              name: s.name,
              reason: { kind: "upstream-failed", upstream },
            };
          }
        }
        return runStage(root, s, verbose);
      }),
    );
    for (const r of results) {
      final.set(r.name, r);
      remaining.delete(r.name);
      emit(r);
      if (r.kind === "failed") propagateFailure(r.name);
    }
  }

  const outcomes = stages.map((s): StageOutcome => {
    const o = final.get(s.name);
    if (o) return o;
    // Defensive — shouldn't happen, but typecheck demands.
    return { kind: "skipped", name: s.name, reason: { kind: "no-inputs" } };
  });
  const failed = outcomes.filter((o) => o.kind === "failed").length;

  // Final report
  process.stderr.write("\nbuild report:\n");
  for (const o of outcomes) process.stderr.write(formatOutcome(o) + "\n");
  if (failed > 0) process.stderr.write(`\n${failed} stage(s) failed.\n`);

  return { outcomes, failed };
};
