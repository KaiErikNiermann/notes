import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import * as path from "node:path";
import type { Stage, StageContext } from "../types";

// Forester writes each tree's XML into `output/<segment>/`, where <segment> is
// the last path component of `forest.toml`'s `url` (or `output/` itself when the
// url has no path, e.g. http://localhost/). The rest of this pipeline is written
// against a canonical `output/notes/`, so we normalise forester's output there
// after every build. The on-disk directory name is irrelevant to the deployed
// site — inter-tree links are baked from `config.url`, not from this path — so a
// forest published at any URL still builds correctly.
function siteSegment(root: string): string {
  try {
    const toml = readFileSync(path.join(root, "forest.toml"), "utf-8");
    const match = /^\s*url\s*=\s*["']([^"']*)["']/m.exec(toml);
    if (!match?.[1]) return "";
    // Last non-empty path component: "/forester-test/" → "forester-test", "/" → "".
    const pathname = new URL(match[1]).pathname;
    return /([^/]+)\/*$/.exec(pathname)?.[1] ?? "";
  } catch {
    return "";
  }
}

async function normaliseOutputDir(ctx: StageContext): Promise<void> {
  const segment = siteSegment(ctx.root);
  if (segment === "notes") return; // already canonical

  const outRoot = path.join(ctx.root, "output");
  const notesDir = path.join(outRoot, "notes");
  // Named segment → move `output/<segment>/*`; pathless url → forester wrote its
  // per-tree dirs to `output/` itself, so move everything except `notes`.
  const fromDir = segment ? path.join(outRoot, segment) : outRoot;
  if (segment && !existsSync(fromDir)) return;

  await mkdir(notesDir, { recursive: true });
  for (const name of await readdir(fromDir)) {
    if (!segment && name === "notes") continue;
    const dst = path.join(notesDir, name);
    await rm(dst, { recursive: true, force: true });
    await rename(path.join(fromDir, name), dst);
  }
  if (segment) await rm(fromDir, { recursive: true, force: true });
  ctx.logger.info(`normalised forester output (output/${segment || "."}) → output/notes`);
}

/**
 * Forester stage: compile .tree → XML. Side effect: forester also copies theme
 * files (forester.js, style.css, etc.) into output/notes/. `theme-sync` is the
 * canonical synchroniser for forester.js and style.css. Presentation is now the
 * TS renderer (scripts/build/render/), so no XSLT is involved.
 */
export const forester: Stage<"forester"> = {
  name: "forester",
  dependsOn: [],
  inputs: [
    "trees/**/*.tree",
    "theme/*.css",
    "forest.toml",
  ],
  outputs: [
    "output/notes/**/index.xml",
  ],
  run: async (ctx) => {
    await ctx.exec("forester", ["build", "--persist-tex", "forest.toml"]);

    // forester's output dir follows forest.toml's url; canonicalise it to
    // output/notes/ (what every downstream stage reads) before touching it.
    await normaliseOutputDir(ctx);

    // Forester's legacy client-side-XSLT serving model writes a per-note
    // index.html that meta-refreshes the browser to index.xml (which carries an
    // <?xml-stylesheet href="default.xsl"?> PI for a stylesheet we no longer
    // ship). Those shims land in output/notes/<id>/index.html — the `publish`
    // target — and would otherwise clobber the rendered HTML and serve a broken
    // page. Strip them so `publish` is the sole producer of per-note index.html;
    // their deletion changes publish's input hash AND removes its declared
    // outputs, so publish re-renders the real HTML next. Spare the forest-root
    // landing redirect (output/notes/index.html → /notes/index/), which targets
    // the rendered page, not .xml. (Belt-and-suspenders: once forester is built
    // with `presentation = "external"` these shims aren't emitted at all.)
    const htmls = await ctx.fs.glob(["output/notes/**/index.html"]);
    let stripped = 0;
    await Promise.all(htmls.map(async (f) => {
      const body = (await ctx.fs.read(f)).toString("utf-8");
      if (/http-equiv="refresh"/i.test(body) && /url=[^"']*index\.xml/i.test(body)) {
        await ctx.fs.rmrf(f);
        stripped += 1;
      }
    }));
    if (stripped > 0) ctx.logger.info(`stripped ${stripped} legacy XSLT redirect shim(s)`);
  },
};
