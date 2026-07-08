import * as path from "node:path";
import * as esbuild from "esbuild";
import type { Stage } from "../types";

/**
 * Bundle theme/dev/javascript-source/forester.ts → theme/forester.js via the
 * esbuild JS API. Bare imports (ninja-keys, katex, highlight.js, …) resolve
 * from theme/dev/node_modules via `nodePaths` — equivalent to the old script
 * `cd`-ing into theme/dev before invoking the esbuild CLI. The theme-sync stage
 * copies the resulting bundle into output/notes/.
 */
export const bundleJs: Stage<"bundle-js"> = {
  name: "bundle-js",
  dependsOn: [],
  inputs: [
    "theme/dev/javascript-source/**/*.ts",
    "theme/dev/package.json",
    "theme/dev/tsconfig.json",
    "highlight/*.ts",
  ],
  outputs: ["theme/forester.js"],
  run: async (ctx) => {
    await esbuild.build({
      entryPoints: [
        path.join(ctx.root, "theme", "dev", "javascript-source", "forester.ts"),
      ],
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2020",
      minify: true,
      sourcemap: false,
      logLevel: "warning",
      nodePaths: [path.join(ctx.root, "theme", "dev", "node_modules")],
      outfile: path.join(ctx.root, "theme", "forester.js"),
    });
    ctx.logger.info("bundled theme/dev/javascript-source/forester.ts → theme/forester.js");
  },
};
