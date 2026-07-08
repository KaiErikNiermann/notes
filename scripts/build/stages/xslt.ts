import * as path from "node:path";
import type { Stage } from "../types";
import { hashFiles } from "../hash";
import { incrementalMap } from "../incremental";
import { renderForesterXml } from "../render/render";
import { parseMacroSigs, flagsOf, type SigDiagnostic } from "../render/sig";

const STAGE_OUT = "build/stage/xslt";
const CONCURRENCY = 16;

/**
 * Render each output/notes/<id>/index.xml → staged HTML using the in-process TS
 * renderer (scripts/build/render/), which replaced the libxslt/`xsltproc`
 * pipeline. The stage name and `build/stage/xslt/` output contract are kept for
 * the downstream inline-verso/publish stages; only the engine changed.
 *
 * Rendering is per-file incremental (see incrementalMap): only XMLs whose
 * content — or the renderer/sig fingerprint — changed are re-rendered, so an
 * edit to one tree re-renders one page instead of the whole forest.
 */
export const xslt: Stage<"xslt"> = {
  name: "xslt",
  dependsOn: ["forester"],
  inputs: [
    "output/notes/**/index.xml",
    // The renderer IS the theme now — edits to it must invalidate the cache.
    "scripts/build/render/**/*.ts",
    // Construct signatures (the single source of option constraints) live here.
    "trees/base-macros.tree",
  ],
  outputs: ["build/stage/xslt/**/index.html"],
  run: async (ctx) => {
    const inDir = path.join(ctx.root, "output", "notes");
    const outRoot = path.join(ctx.root, STAGE_OUT);
    const baseMacrosPath = path.join(ctx.root, "trees", "base-macros.tree");

    // Parse the construct `%! sig`s once; the `\embed` opts schema is the only one
    // the renderer validates against (others drive the editor; see sig.ts).
    const sigs = parseMacroSigs((await ctx.fs.read(baseMacrosPath)).toString("utf-8"));
    const embedSig = sigs.get(String.raw`\embed`);
    const embedFlags = embedSig ? flagsOf(embedSig, "opts") : undefined;

    // Fingerprint every page key with the renderer source + sig source, so any
    // change to the renderer or base macros re-renders all pages (matching the
    // whole-stage cache), while an edit to one tree re-renders only that page.
    const rendererFiles = await ctx.fs.glob(["scripts/build/render/**/*.ts"]);
    const fingerprint = await hashFiles(ctx.root, [...rendererFiles, baseMacrosPath]);

    const violations: string[] = [];
    const result = await incrementalMap(ctx, {
      cacheId: "xslt",
      inputGlob: "output/notes/**/index.xml",
      inRoot: inDir,
      outRoot,
      fingerprint,
      concurrency: CONCURRENCY,
      toOutRel: (rel) => rel.replace(/index\.xml$/, "index.html"),
      // Conforms to the processor's async render contract though the render
      // itself is synchronous.
      // eslint-disable-next-line @typescript-eslint/require-await
      render: async (content, inputRel) => {
        const rel = path.dirname(inputRel);
        const onSigDiagnostic = (d: SigDiagnostic): void => {
          violations.push(`${rel}: ${d.construct} ${d.param ? `'${d.param}'` : ""} — ${d.message}`);
        };
        return renderForesterXml(content.toString("utf-8"), {
          ...(embedFlags ? { embedFlags } : {}),
          onSigDiagnostic,
        });
      },
    });

    for (const v of violations) ctx.logger.warn(`[sig] ${v}`);
    if (process.env["STRICT_SIG"] === "1" && violations.length > 0) {
      throw new Error(`${violations.length} construct-signature violation(s) (STRICT_SIG=1)`);
    }
    await result.commit();
    ctx.logger.info(
      `rendered ${result.processed} html file(s) (skipped ${result.skipped}, removed ${result.removed}) → ${STAGE_OUT}/`,
    );
  },
};
