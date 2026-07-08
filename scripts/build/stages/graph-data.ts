import * as path from "node:path";
import type { Stage } from "../types";

/**
 * Run the vendored extractor against `trees/` to produce
 * `output/notes/graph/data.json`. The extractor itself shells out to
 * `forester query all`; the orchestrator just invokes it.
 */
export const graphData: Stage<"graph-data"> = {
  name: "graph-data",
  dependsOn: ["graph-vendor"],
  inputs: [
    "trees/**/*.tree",
    "forest.toml",
    "vendor/graph-view/extract",
    "build/graph-view.lock",
  ],
  outputs: ["output/notes/graph/data.json"],
  run: async (ctx) => {
    const outPath = path.join(ctx.root, "output", "notes", "graph", "data.json");
    await ctx.fs.mkdir(path.dirname(outPath));
    await ctx.exec("node", [
      path.join(ctx.root, "vendor", "graph-view", "extract"),
      "extract",
      `--out=${outPath}`,
      `--cwd=${ctx.root}`,
    ]);
  },
};
