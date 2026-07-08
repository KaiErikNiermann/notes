import * as path from "node:path";
import * as esbuild from "esbuild";
import type { Stage } from "../types";

/**
 * Assemble the /notes/graph/ page. Inputs:
 *  - vendored renderer bundle + CSS (from graph-vendor)
 *  - extracted graph data (from graph-data)
 *  - page shell + theme TS (under theme/graph/)
 *
 * Outputs:
 *  - output/notes/graph/index.html  (page shell, copied verbatim)
 *  - output/notes/graph/graph.js    (vendored renderer bundle, copied)
 *  - output/notes/graph/graph.css   (vendored renderer stylesheet, copied)
 *  - output/notes/graph/notes-theme-mount.js  (esbuild-bundled theme + mount wiring)
 *  - output/notes/graph/data.json   (passed through from graph-data)
 */
export const graphPage: Stage<"graph-page"> = {
  name: "graph-page",
  dependsOn: ["graph-data", "graph-vendor"],
  inputs: [
    "vendor/graph-view/graph.js",
    "vendor/graph-view/graph.css",
    "theme/graph/page.html",
    "theme/graph/notes-theme.ts",
    "theme/graph/notes-theme-mount.ts",
    "output/notes/graph/data.json",
  ],
  outputs: [
    "output/notes/graph/index.html",
    "output/notes/graph/graph.js",
    "output/notes/graph/graph.css",
    "output/notes/graph/notes-theme-mount.js",
  ],
  run: async (ctx) => {
    const outDir = path.join(ctx.root, "output", "notes", "graph");
    await ctx.fs.mkdir(outDir);

    await ctx.fs.copy(
      path.join(ctx.root, "vendor", "graph-view", "graph.js"),
      path.join(outDir, "graph.js"),
    );
    await ctx.fs.copy(
      path.join(ctx.root, "vendor", "graph-view", "graph.css"),
      path.join(outDir, "graph.css"),
    );
    await ctx.fs.copy(
      path.join(ctx.root, "theme", "graph", "page.html"),
      path.join(outDir, "index.html"),
    );

    // Bundle the notes-site theme + mount wiring as an ESM module.
    await esbuild.build({
      entryPoints: [path.join(ctx.root, "theme", "graph", "notes-theme-mount.ts")],
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2020",
      outfile: path.join(outDir, "notes-theme-mount.js"),
      minify: true,
      sourcemap: false,
      logLevel: "warning",
    });

    ctx.logger.info(`assembled output/notes/graph/`);
  },
};
