#!/usr/bin/env tsx
/**
 * scripts/build.ts — single entrypoint for the static-site build.
 *
 *   tsx scripts/build.ts                # full build
 *   tsx scripts/build.ts --watch        # watch + auto-rebuild affected stages
 *   tsx scripts/build.ts --dry-run      # print plan + predicted cache hits
 *   tsx scripts/build.ts --only verso   # comma-separated subset
 *   tsx scripts/build.ts --graph        # emit graphviz dot
 *   tsx scripts/build.ts --verbose      # stream subprocess stdout
 */
import * as path from "node:path";
import { match, P } from "ts-pattern";
import { printDryRun, printGraph, runRegistry } from "./build/executor";
import { stages } from "./build/registry";
import { ALL_STAGE_NAMES, type RunOptions, type StageName } from "./build/types";
import { watch } from "./build/watch";

type Cli = Readonly<{
  mode: "build" | "watch" | "dry-run" | "graph";
  only: readonly StageName[] | null;
  verbose: boolean;
}>;

const STAGE_NAMES_SET = new Set<string>(ALL_STAGE_NAMES);

const parseOnly = (raw: string): readonly StageName[] => {
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  for (const p of parts) {
    if (!STAGE_NAMES_SET.has(p)) {
      throw new Error(`unknown stage in --only: "${p}" (valid: ${ALL_STAGE_NAMES.join(", ")})`);
    }
  }
  return parts as StageName[];
};

const parseArgv = (argv: readonly string[]): Cli => {
  let mode: Cli["mode"] = "build";
  let only: readonly StageName[] | null = null;
  let verbose = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === undefined) continue;
    switch (a) {
    case "--watch": {
    mode = "watch";
    break;
    }
    case "--dry-run": {
    mode = "dry-run";
    break;
    }
    case "--graph": {
    mode = "graph";
    break;
    }
    case "--verbose": 
    case "-v": {
    verbose = true;
    break;
    }
    case "--only": {
      const next = argv[i + 1];
      if (next === undefined) throw new Error("--only requires a comma-separated argument");
      only = parseOnly(next);
      i += 1;
    
    break;
    }
    default: { if (a.startsWith("--only=")) {
      only = parseOnly(a.slice("--only=".length));
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
    }
    }
  }
  return { mode, only, verbose };
};

const main = async (): Promise<number> => {
  const root = path.resolve(__dirname, "..");
  const cli = parseArgv(process.argv.slice(2));
  const baseOpts: RunOptions = {
    verbose: cli.verbose,
    ...(cli.only === null ? {} : { only: cli.only }),
  };

  return match(cli.mode)
    .with("graph", () => {
      printGraph(stages);
      return 0;
    })
    .with("dry-run", async () => {
      await printDryRun(root, stages);
      return 0;
    })
    .with("watch", async () => {
      // Run once first, then watch.
      const result = await runRegistry(root, stages, baseOpts);
      if (result.failed > 0) {
        process.stderr.write("initial build had failures; entering watch anyway\n");
      }
      await watch(root, stages, baseOpts);
      return 0; // unreachable in normal flow
    })
    .with("build", async () => {
      const result = await runRegistry(root, stages, baseOpts);
      return result.failed > 0 ? 1 : 0;
    })
    .with(P.string, () => {
      throw new Error(`unreachable mode`);
    })
    .exhaustive();
};

main().then(
  (code) => process.exit(code),
  (error) => {
    process.stderr.write(`build orchestrator crashed: ${error instanceof Error ? error.message : String(error)}\n`);
    if (error instanceof Error && error.stack) process.stderr.write(error.stack + "\n");
    process.exit(2);
  },
);

/** Re-export for server.ts integration. */
export { runRegistry } from "./build/executor";
export { stages } from "./build/registry";
export type { RunOptions, RunResult, StageOutcome } from "./build/types";
