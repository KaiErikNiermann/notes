import * as path from "node:path";
import * as esbuild from "esbuild";
import type { Stage } from "../types";

/**
 * Bundle every sidecar figure under figures/*.ts together with the shared d3
 * runtime into a single lazy-loaded ESM module:
 *
 *     output/notes/d3-assets/figures.js
 *
 * A generated entry imports each figure module and hands a name→render map to
 * the runtime's `bootstrap`. d3 itself is resolved from theme/dev/node_modules
 * (where it is installed) via esbuild `nodePaths`, and the `@d3-runtime` alias
 * points figures at the shared runtime source. The bundle auto-runs on import.
 *
 * forester.js lazy-imports this only on pages that contain a figure, so d3 is
 * never fetched elsewhere.
 */
export const d3Figures: Stage<"d3-figures"> = {
  name: "d3-figures",
  dependsOn: [],
  inputs: [
    "figures/*.ts",
    "theme/dev/javascript-source/d3/runtime.ts",
    "theme/dev/package.json",
  ],
  outputs: ["output/notes/d3-assets/figures.js"],
  run: async (ctx) => {
    const figuresDir = path.join(ctx.root, "figures");
    const runtimePath = path.join(ctx.root, "theme", "dev", "javascript-source", "d3", "runtime.ts");
    const nodeModules = path.join(ctx.root, "theme", "dev", "node_modules");
    const outDir = path.join(ctx.root, "output", "notes", "d3-assets");
    await ctx.fs.mkdir(outDir);

    const figureFiles = await ctx.fs.glob(["figures/*.ts"]);
    const names = figureFiles
      .map((f) => path.basename(f, ".ts"))
      .filter((n) => !n.startsWith("_"))
      .sort();

    const imports = names.map((n, i) => `import * as f${i} from "./${n}.ts";`).join("\n");
    const registry = names.map((n, i) => `  ${JSON.stringify(n)}: f${i}.render,`).join("\n");
    const entry = [
      `import { bootstrap } from "@d3-runtime";`,
      imports,
      `bootstrap({`,
      registry,
      `});`,
      ``,
    ].join("\n");

    await esbuild.build({
      stdin: {
        contents: entry,
        // figures glob resolves "./name.ts" relative to figures/; if there are
        // no figures the dir may not matter, but it always exists in-repo.
        resolveDir: figuresDir,
        loader: "ts",
        sourcefile: "_d3-entry.ts",
      },
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2020",
      minify: true,
      sourcemap: false,
      logLevel: "warning",
      alias: { "@d3-runtime": runtimePath },
      nodePaths: [nodeModules],
      outfile: path.join(outDir, "figures.js"),
    });

    ctx.logger.info(`bundled ${names.length} d3 figure(s) → output/notes/d3-assets/figures.js`);
  },
};
