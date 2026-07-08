import type { Stage } from "../types";

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
