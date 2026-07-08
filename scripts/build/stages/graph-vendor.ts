import { promises as fsp } from "node:fs";
import * as path from "node:path";
import type { Stage } from "../types";

/**
 * Fetch the forest-graph artifact from the extension repo.
 *
 * Two modes:
 *  - **Dev override**: if `GRAPH_VIEW_SOURCE` env is set to a local path,
 *    rsync the artifact from there. Lets you iterate on the extension repo
 *    and have changes show up immediately in the notes site.
 *  - **Tag fetch**: `git archive --remote=<EXTENSION_REPO_URL> graph-view-latest dist/graph-view`
 *    pulls the latest committed artifact. The remote URL is configurable via
 *    `GRAPH_VIEW_REMOTE` env (default: a local path beside this repo).
 *
 * After fetch, the manifest's contentHash is written to build/graph-view.lock.
 * The lock file going through git is what surfaces drift between site builds.
 *
 * Hard-fails if the artifact's `schemaVersion` is not one this stage knows
 * how to consume (currently: 1).
 */
const EXPECTED_SCHEMA_VERSION = 1;
const DEFAULT_REMOTE = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "forester-lang-support",
);

interface Manifest {
  readonly schemaVersion: number;
  readonly contentHash: string;
  readonly commit: string;
  readonly date: string;
}

export const graphVendor: Stage<"graph-vendor"> = {
  name: "graph-vendor",
  dependsOn: [],
  // Lock file is committed to the notes repo. Changes to it (i.e. fetching a
  // newer artifact) show up in `git diff` — drift made visible.
  inputs: ["build/graph-view.lock"],
  outputs: [
    "vendor/graph-view/manifest.json",
    "vendor/graph-view/graph.js",
    "vendor/graph-view/graph.css",
    "vendor/graph-view/extract",
    "vendor/graph-view/default-theme.js",
  ],
  run: async (ctx) => {
    const vendorDir = path.join(ctx.root, "vendor", "graph-view");
    await ctx.fs.rmrf(vendorDir);
    await ctx.fs.mkdir(vendorDir);

    const override = process.env.GRAPH_VIEW_SOURCE;
    if (override) {
      const srcDir = path.resolve(override);
      ctx.logger.info(`copying from local path: ${srcDir}`);
      const files = await fsp.readdir(srcDir);
      for (const name of files) {
        await ctx.fs.copy(path.join(srcDir, name), path.join(vendorDir, name));
      }
    } else {
      const remote = process.env.GRAPH_VIEW_REMOTE ?? DEFAULT_REMOTE;
      ctx.logger.info(`git archive --remote=${remote} graph-view-latest dist/graph-view`);
      // tar -x --strip-components=2 dist/graph-view/* → vendor/graph-view/*
      await ctx.exec("bash", [
        "-c",
        `git archive --remote=${JSON.stringify(remote)} graph-view-latest dist/graph-view | tar -x --strip-components=2 -C ${JSON.stringify(vendorDir)}`,
      ]);
    }

    const manifestPath = path.join(vendorDir, "manifest.json");
    const manifestRaw = await ctx.fs.read(manifestPath);
    const manifest = JSON.parse(manifestRaw.toString("utf-8")) as Manifest;

    if (manifest.schemaVersion !== EXPECTED_SCHEMA_VERSION) {
      throw new Error(
        `vendor/graph-view/ schemaVersion=${manifest.schemaVersion} not recognized ` +
          `(expected ${EXPECTED_SCHEMA_VERSION}). Update scripts/build/stages/graph-vendor.ts ` +
          `to handle the new shape, or pin the artifact to an older tag.`,
      );
    }

    const lockPath = path.join(ctx.root, "build", "graph-view.lock");
    await ctx.fs.write(
      lockPath,
      JSON.stringify(
        { schemaVersion: manifest.schemaVersion, contentHash: manifest.contentHash, commit: manifest.commit },
        null,
        2,
      ) + "\n",
    );
    ctx.logger.info(
      `vendored graph-view: contentHash=${manifest.contentHash.slice(0, 12)} commit=${manifest.commit.slice(0, 8)}`,
    );
  },
};
