import * as path from "node:path";
import * as cheerio from "cheerio";
import type { Stage } from "../types";
import { incrementalMap } from "../incremental";

const IN_DIR = "build/stage/inline-verso";
const OUT_DIR = "build/stage/inline-assets";
const MAX_TEXT_BYTES = 256 * 1024;

/**
 * inline-assets preprocessor: fills the text embeds the renderer left as
 *
 *     <figure class="embed embed-text embed-pending"
 *             data-embed-url="/notes/<hash>.<ext>" data-embed-mode="code|raw"
 *             data-embed-lang="python"> <figcaption>…</figcaption> </figure>
 *
 * with the attachment's actual text content (the renderer is pure and can't read
 * files — images it handles directly; only text needs this stage). The asset is
 * read from output/notes/<hash>.<ext> (forester plants it there), and spliced as:
 *   code → <pre class="code-block language-X"><code class="language-X">…</code></pre>
 *   raw  → <pre class="asset-text">…</pre>
 * inserted before the <figcaption>. Mirrors inline-verso.ts (cheerio + ctx.fs).
 */
export const inlineAssets: Stage<"inline-assets"> = {
  name: "inline-assets",
  dependsOn: ["inline-verso", "forester"],
  // The hashed asset URL is baked into the HTML, so any asset content change
  // changes the upstream HTML and re-triggers this stage (content-addressing).
  inputs: [`${IN_DIR}/**/index.html`],
  outputs: [`${OUT_DIR}/**/index.html`],
  run: async (ctx) => {
    const inRoot = path.join(ctx.root, IN_DIR);
    const outRoot = path.join(ctx.root, OUT_DIR);

    const textCache = new Map<string, string | null>();
    const loadAsset = async (url: string): Promise<string | null> => {
      const cached = textCache.get(url);
      if (cached !== undefined) return cached;
      // /notes/<hash>.<ext> → output/notes/<hash>.<ext>
      const p = path.join(ctx.root, "output", url);
      let value: string | null = null;
      if (await ctx.fs.exists(p)) {
        const buf = await ctx.fs.read(p);
        value = buf.byteLength > MAX_TEXT_BYTES ? null : buf.toString("utf-8");
      }
      textCache.set(url, value);
      return value;
    };

    let totalFilled = 0;
    let totalPages = 0;

    // No fingerprint: assets are content-addressed (the hash is baked into the
    // embed URL), so any asset content change rewrites the upstream HTML and is
    // captured by the page key itself.
    const result = await incrementalMap(ctx, {
      cacheId: "inline-assets",
      inputGlob: `${IN_DIR}/**/index.html`,
      inRoot,
      outRoot,
      fingerprint: "",
      render: async (content) => {
        const $ = cheerio.load(content.toString("utf-8"));
        const placeholders = $("figure.embed-pending").toArray();

        for (const el of placeholders) {
          const ph = $(el);
          const url = ph.attr("data-embed-url");
          const mode = ph.attr("data-embed-mode") ?? "raw";
          ph.removeClass("embed-pending");
          if (!url) {
            ph.addClass("embed--missing");
            ph.prepend($("<pre>").addClass("asset-text").text("[embed: missing url]"));
            continue;
          }
          const assetText = await loadAsset(url);
          if (assetText === null) {
            ph.addClass("embed--missing");
            ph.prepend($("<pre>").addClass("asset-text").text(`[embed: unreadable/oversized ${url}]`));
            continue;
          }
          if (mode === "code") {
            const lang = ph.attr("data-embed-lang") ?? "plaintext";
            ph.prepend(
              $("<pre>").addClass(`code-block language-${lang}`).append(
                $("<code>").addClass(`language-${lang}`).text(assetText),
              ),
            );
          } else {
            ph.prepend($("<pre>").addClass("asset-text").text(assetText));
          }
          totalFilled += 1;
        }

        if (placeholders.length > 0) totalPages += 1;

        return $.html();
      },
    });

    ctx.logger.info(
      `filled ${totalFilled} text embed(s) across ${totalPages} page(s) (skipped ${result.skipped}, removed ${result.removed})`,
    );
    await result.commit();
  },
};
