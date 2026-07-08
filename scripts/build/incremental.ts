import { createHash } from "node:crypto";
import * as path from "node:path";
import type { StageContext } from "./types";

/**
 * Per-file incremental mapping for the 1:1 page-rewriting stages (xslt,
 * inline-verso, inline-assets, publish).
 *
 * The executor's whole-stage cache short-circuits a stage only when *none* of
 * its inputs changed. When a single tree changes, the stage still runs and would
 * otherwise reprocess every page. This helper makes that run touch only the
 * pages whose content — or the stage's `fingerprint` — actually changed, which
 * is what turns "edit one tree" into a single-tree rebuild.
 *
 * Correctness: the output is byte-identical to a full reprocess. A page is
 * skipped only when its input bytes AND the stage fingerprint match the snapshot
 * from the last *successful* run and its output file still exists; the existing
 * (identical) output is reused untouched. The key map is persisted by `commit()`,
 * which a stage calls only after its own validation passes — so a failed run
 * never records pages as done, and the next run reprocesses them.
 *
 * The `fingerprint` folds in every input that affects output but isn't the page
 * itself (the renderer source, verso fragments, …); changing it re-renders all
 * pages, exactly as the whole-stage cache would force today.
 */

export type IncrementalResult = Readonly<{
  /** Pages whose output was (re)written this run. */
  processed: number;
  /** Pages skipped because input + fingerprint were unchanged. */
  skipped: number;
  /** Stale outputs removed because their input no longer exists. */
  removed: number;
  /** Persist the new key map. Call ONLY after the stage validates successfully. */
  commit: () => Promise<void>;
}>;

export type IncrementalOptions = Readonly<{
  /** Unique id → build/.cache/<cacheId>.files.json. */
  cacheId: string;
  /** Glob for the per-page inputs (root-relative). */
  inputGlob: string;
  /** Absolute dir the input paths are relative to. */
  inRoot: string;
  /** Absolute dir outputs are written under. */
  outRoot: string;
  /** Extra fingerprint mixed into every page key; change ⇒ reprocess all. */
  fingerprint: string;
  /** Map an input rel path to its output rel path (default: identity). */
  toOutRel?: (inputRel: string) => string;
  /**
   * Before skipping an unchanged page, also confirm the existing output still
   * hashes to its key — i.e. nothing rewrote it out-of-band. Needed for `publish`,
   * whose output dir can be clobbered by forester; the others own their outputs.
   */
  verifyOutput?: boolean;
  /** Max pages processed concurrently. */
  concurrency?: number;
  /** Produce the output bytes for one page. */
  render: (content: Buffer, inputRel: string, absInput: string) => Promise<string | Buffer>;
}>;

const cacheFile = (root: string, cacheId: string): string =>
  path.join(root, "build", ".cache", `${cacheId}.files.json`);

const keyOf = (fingerprint: string, content: Buffer): string =>
  createHash("sha256").update(fingerprint).update("\0").update(content).digest("hex");

const toPosix = (p: string): string => p.split(path.sep).join("/");

export const incrementalMap = async (
  ctx: StageContext,
  opts: IncrementalOptions,
): Promise<IncrementalResult> => {
  const toOutRel = opts.toOutRel ?? ((r) => r);
  const cachePath = cacheFile(ctx.root, opts.cacheId);

  let prev: Record<string, string> = {};
  if (await ctx.fs.exists(cachePath)) {
    try {
      prev = JSON.parse((await ctx.fs.read(cachePath)).toString("utf-8")) as Record<string, string>;
    } catch {
      prev = {};
    }
  }

  const inputs = await ctx.fs.glob([opts.inputGlob]);
  const next: Record<string, string> = {};
  let processed = 0;
  let skipped = 0;

  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (let i = cursor++; i < inputs.length; i = cursor++) {
      const abs = inputs[i]!;
      const inputRel = toPosix(path.relative(opts.inRoot, abs));
      const content = await ctx.fs.read(abs);
      const key = keyOf(opts.fingerprint, content);
      next[inputRel] = key;

      const outAbs = path.join(opts.outRoot, toOutRel(inputRel));
      if (prev[inputRel] === key && (await ctx.fs.exists(outAbs))) {
        if (!opts.verifyOutput) {
          skipped += 1;
          continue;
        }
        // Output may have been rewritten out-of-band — re-copy unless it still
        // matches. For a faithful copy the output bytes equal the input bytes,
        // so they hash to the same key.
        if (keyOf(opts.fingerprint, await ctx.fs.read(outAbs)) === key) {
          skipped += 1;
          continue;
        }
      }
      const out = await opts.render(content, inputRel, abs);
      await ctx.fs.mkdir(path.dirname(outAbs));
      await ctx.fs.write(outAbs, out);
      processed += 1;
    }
  };
  const lanes = Math.max(1, Math.min(opts.concurrency ?? 1, inputs.length));
  await Promise.all(Array.from({ length: lanes }, worker));

  // Remove outputs whose input disappeared since the last run — but never when
  // the input set came back empty (a likely upstream hiccup), to avoid nuking
  // every page on a transient miss.
  let removed = 0;
  if (inputs.length > 0) {
    for (const staleRel of Object.keys(prev)) {
      if (staleRel in next) continue;
      const outAbs = path.join(opts.outRoot, toOutRel(staleRel));
      if (await ctx.fs.exists(outAbs)) {
        await ctx.fs.rmrf(outAbs);
        removed += 1;
      }
    }
  }

  const commit = async (): Promise<void> => {
    await ctx.fs.write(cachePath, JSON.stringify(next));
  };

  return { processed, skipped, removed, commit };
};
