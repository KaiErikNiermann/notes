import type { Stage } from "./types";
import { bundleJs } from "./stages/bundle-js";
import { d3Figures } from "./stages/d3-figures";
import { forester } from "./stages/forester";
import { graphData } from "./stages/graph-data";
import { graphPage } from "./stages/graph-page";
import { graphVendor } from "./stages/graph-vendor";
import { inlineAssets } from "./stages/inline-assets";
import { inlineVerso } from "./stages/inline-verso";
import { publish } from "./stages/publish";
import { themeSync } from "./stages/theme-sync";
import { verso } from "./stages/verso";
import { xslt } from "./stages/xslt";

/**
 * The canonical registry. Order doesn't matter — the executor topo-sorts.
 * To add a preprocessor: write a new stages/<name>.ts exporting a Stage value
 * and import it here.
 */
export const stages: readonly Stage[] = [
  verso,
  forester,
  bundleJs,
  xslt,
  inlineVerso,
  inlineAssets,
  themeSync,
  publish,
  graphVendor,
  graphData,
  graphPage,
  d3Figures,
] as const;
