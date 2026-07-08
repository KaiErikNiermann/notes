import * as path from "node:path";
import type { Stage } from "../types";
import { incrementalMap } from "../incremental";

const FINAL_INPUT = "build/stage/inline-assets";

/**
 * Copies the last HTML staging directory (currently inline-assets' output)
 * into output/notes/. This stage is the single source of truth for "what's
 * the final HTML." If a new HTML-rewriting preprocessor lands between
 * inline-assets and the final, update FINAL_INPUT here and the new stage's
 * dependency on inline-assets → publish chain accordingly.
 */
export const publish: Stage<"publish"> = {
  name: "publish",
  dependsOn: ["inline-assets", "theme-sync"],
  // Include the destination files in the cache key — forester writes redirect
  // shims to output/notes/<id>/index.html that would otherwise leave us with
  // stale outputs while the input-only hash still matched. Including both sides
  // makes the cache key reflect output drift: re-publish whenever output content
  // diverges from the staged content.
  inputs: [`${FINAL_INPUT}/**/index.html`, "output/notes/**/index.html"],
  outputs: ["output/notes/**/index.html"],
  run: async (ctx) => {
    // Per-file incremental copy: only re-publish staged pages that changed or
    // whose published copy drifted (verifyOutput guards against forester writing
    // over output/notes/<id>/index.html out-of-band).
    const result = await incrementalMap(ctx, {
      cacheId: "publish",
      inputGlob: `${FINAL_INPUT}/**/index.html`,
      inRoot: path.join(ctx.root, FINAL_INPUT),
      outRoot: path.join(ctx.root, "output", "notes"),
      fingerprint: "",
      verifyOutput: true,
      render: (content) => Promise.resolve(content),
    });
    await result.commit();
    ctx.logger.info(
      `published ${result.processed} html files → output/notes/ (skipped ${result.skipped}, removed ${result.removed})`,
    );
  },
};
