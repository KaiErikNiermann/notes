import chokidar from "chokidar";
import * as path from "node:path";
import picomatch from "picomatch";
import { match } from "ts-pattern";
import { runRegistry } from "./executor";
import { rootLogger } from "./log";
import type { FileEvent, RunOptions, Stage, StageName } from "./types";

/** A file event is relevant to a stage if any of its input globs matches the path. */
const buildAffectedDispatcher = (
  root: string,
  stages: readonly Stage[],
): ((p: string) => Set<StageName>) => {
  const compiled: Array<{ name: StageName; matchers: ((s: string) => boolean)[] }> = stages.map((s) => ({
    name: s.name,
    matchers: s.inputs.map((g) => picomatch(g, { dot: true })),
  }));

  return (absPath: string) => {
    const rel = path.relative(root, absPath).split(path.sep).join("/");
    const hits = new Set<StageName>();
    for (const { name, matchers } of compiled) {
      if (matchers.some((m) => m(rel))) hits.add(name);
    }
    return hits;
  };
};

const summarizeEvent = (e: FileEvent): string =>
  match(e)
    .with({ kind: "add" }, (x) => `+ ${x.path}`)
    .with({ kind: "change" }, (x) => `~ ${x.path}`)
    .with({ kind: "unlink" }, (x) => `- ${x.path}`)
    .exhaustive();

/**
 * Start chokidar against the union of every stage's input globs.
 * On any change, accumulate affected stage names across a debounce window
 * and rerun the registry filtered by --only those stages (the executor's
 * dep-resolution will fill in any upstreams whose outputs are missing).
 */
export const watch = async (
  root: string,
  stages: readonly Stage[],
  opts: RunOptions = {},
): Promise<void> => {
  const log = rootLogger.child("watch");
  const dispatch = buildAffectedDispatcher(root, stages);
  const allInputGlobs = [...new Set(stages.flatMap((s) => s.inputs))];

  const watcher = chokidar.watch(allInputGlobs, {
    cwd: root,
    ignored: ["**/.lake/**", "**/node_modules/**", "**/_out/**", "**/.git/**", "build/**"],
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
  });

  let pending = new Set<StageName>();
  let debounceTimer: NodeJS.Timeout | null = null;
  let running = false;
  let queued = false;

  const flush = async (): Promise<void> => {
    if (running) {
      queued = true;
      return;
    }
    const affected = pending;
    pending = new Set();
    opts.onWatchTick?.(affected.size);
    if (affected.size === 0) return;
    log.info(`rerunning: ${[...affected].join(", ")}`);
    running = true;
    try {
      await runRegistry(root, stages, {
        ...opts,
        only: [...affected],
      });
    } finally {
      running = false;
      if (queued) {
        queued = false;
        if (debounceTimer === null) void flush();
      }
    }
  };

  const onEvent = (kind: FileEvent["kind"]) => (relPath: string): void => {
    const absPath = path.join(root, relPath);
    const event: FileEvent = { kind, path: absPath };
    log.info(summarizeEvent({ kind, path: relPath }));
    for (const name of dispatch(event.path)) pending.add(name);
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void flush();
    }, 250);
  };

  watcher
    .on("add", onEvent("add"))
    .on("change", onEvent("change"))
    .on("unlink", onEvent("unlink"));

  log.info(`watching ${allInputGlobs.length} input globs (rooted at ${root})`);

  await new Promise<void>(() => {
    // run forever; SIGINT shutdown handled by Node default
  });
};
