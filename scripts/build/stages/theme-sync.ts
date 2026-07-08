import type { Stage } from "../types";

/**
 * Canonical sync of theme files into output/notes/. Forester also copies
 * some theme files during its build, but we keep this stage as the explicit
 * source of truth — that way bundle-js → output/notes/forester.js is visible
 * in the dep graph and not hidden inside forester's own copy logic.
 */
export const themeSync: Stage<"theme-sync"> = {
  name: "theme-sync",
  dependsOn: ["bundle-js", "forester"],
  inputs: ["theme/style.css", "theme/forester.js"],
  outputs: ["output/notes/style.css", "output/notes/forester.js"],
  run: async (ctx) => {
    await ctx.fs.copy(`${ctx.root}/theme/style.css`, `${ctx.root}/output/notes/style.css`);
    await ctx.fs.copy(`${ctx.root}/theme/forester.js`, `${ctx.root}/output/notes/forester.js`);
  },
};
