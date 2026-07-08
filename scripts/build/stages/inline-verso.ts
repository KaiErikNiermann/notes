import * as path from "node:path";
import * as cheerio from "cheerio";
import type { Stage } from "../types";
import { hashFiles } from "../hash";
import { incrementalMap } from "../incremental";

const IN_DIR = "build/stage/xslt";
const OUT_DIR = "build/stage/inline-verso";
const FRAGMENTS_DIR = "build/verso";

/**
 * inline-verso preprocessor: read build/stage/xslt/<id>/index.html, splice
 * Verso fragments from build/verso/<name>.html into
 *
 *     <div class="verso-snippet" data-verso="X"></div>
 *
 * placeholders, write the rewritten HTML to build/stage/inline-verso/.
 *
 * A 1:1 TS port of the former scripts/inline_verso.py (cheerio replaces lxml).
 * The same anchor may appear in several placeholders on one page (e.g. the main
 * rendering plus a backmatter copy), so each splice re-parses the cached
 * fragment string — cheerio's `.append(html)` parses fresh nodes per call,
 * reproducing the Python deep-copy-per-placeholder behaviour. Missing fragments
 * are marked in place and fail the stage (non-zero), as before.
 */
export const inlineVerso: Stage<"inline-verso"> = {
  name: "inline-verso",
  dependsOn: ["xslt", "verso"],
  inputs: [
    "build/stage/xslt/**/index.html",
    "build/verso/*.html",
  ],
  outputs: ["build/stage/inline-verso/**/index.html"],
  run: async (ctx) => {
    const inRoot = path.join(ctx.root, IN_DIR);
    const outRoot = path.join(ctx.root, OUT_DIR);
    const fragmentsRoot = path.join(ctx.root, FRAGMENTS_DIR);

    const fragmentCache = new Map<string, string | null>();
    const loadFragment = async (name: string): Promise<string | null> => {
      const cached = fragmentCache.get(name);
      if (cached !== undefined) return cached;
      const p = path.join(fragmentsRoot, `${name}.html`);
      const value = (await ctx.fs.exists(p)) ? (await ctx.fs.read(p)).toString("utf-8") : null;
      fragmentCache.set(name, value);
      return value;
    };

    // Fingerprint on the fragment set: a changed/added/removed fragment must
    // re-splice every page (any page may reference any fragment), while an edit
    // to one page's upstream HTML re-splices only that page.
    const fragmentFiles = await ctx.fs.glob([`${FRAGMENTS_DIR}/*.html`]);
    const fingerprint = await hashFiles(ctx.root, fragmentFiles);

    let totalReplaced = 0;
    let totalPages = 0;
    const unresolved = new Map<string, string[]>();

    const result = await incrementalMap(ctx, {
      cacheId: "inline-verso",
      inputGlob: `${IN_DIR}/**/index.html`,
      inRoot,
      outRoot,
      fingerprint,
      render: async (content, rel) => {
        const $ = cheerio.load(content.toString("utf-8"));
        const placeholders = $(".verso-snippet").toArray();
        const pageUnresolved: string[] = [];

        for (const el of placeholders) {
          const ph = $(el);
          const name = ph.attr("data-verso");
          if (!name) {
            ctx.logger.warn(`${rel}: .verso-snippet without data-verso attribute, skipping`);
            continue;
          }
          const fragment = await loadFragment(name);
          if (fragment === null) {
            pageUnresolved.push(name);
            ph.addClass("verso-snippet--missing").empty().text(`[verso: unresolved anchor '${name}']`);
            continue;
          }
          ph.empty().append(fragment);
        }

        if (placeholders.length > 0) {
          totalReplaced += placeholders.length;
          totalPages += 1;
        }
        if (pageUnresolved.length > 0) unresolved.set(rel, pageUnresolved);

        return $.html();
      },
    });

    ctx.logger.info(
      `inlined ${totalReplaced} fragment(s) across ${totalPages} page(s) (skipped ${result.skipped}, removed ${result.removed})`,
    );

    if (unresolved.size > 0) {
      const detail = [...unresolved.entries()]
        .map(([page, names]) => `  ${page} -> ${names.join(", ")}`)
        .join("\n");
      throw new Error(`unresolved verso anchors:\n${detail}`);
    }
    await result.commit();
  },
};
