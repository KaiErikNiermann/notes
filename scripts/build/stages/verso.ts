import type { Stage } from "../types";

/**
 * Verso stage: elaborate Lean snippets via the sidecar Lake project,
 * extract per-anchor HTML fragments + dedup'd runtime assets.
 * Implementation lives in scripts/build_verso.py (which has its own SHA-256
 * cache — our outer hash is redundant but harmless).
 */
export const verso: Stage<"verso"> = {
  name: "verso",
  dependsOn: [],
  inputs: [
    "lean/examples/**/*.lean",
    "lean/examples/lakefile.toml",
    "lean/examples/lean-toolchain",
    "lean/manual/lakefile.toml",
    "lean/manual/lean-toolchain",
    "lean/manual/Main.lean",
    "lean/**/lake-manifest.json",
    "scripts/build_verso.py",
  ],
  outputs: [
    "build/verso/*.html",
    "build/verso/manifest.json",
    "output/notes/verso-assets/verso-snippet.css",
    "output/notes/verso-assets/verso-snippet-init.js",
    "output/notes/verso-assets/-verso-docs.json",
  ],
  run: async (ctx) => {
    await ctx.exec("python3", ["scripts/build_verso.py"]);
  },
};
