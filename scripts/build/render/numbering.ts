/**
 * numbering.ts — ports the `tree-taxon-with-number` / `contextual-number` XSLT
 * modes and the `should-number` predicate (tree.xsl:84-180).
 *
 * The structural `xsl:number level=multiple` result is precomputed per tree in
 * index-pass.ts (`RenderIndex.numberOf`); here we apply the display gating and
 * assemble the taxon-prefixed string. All output is plain text, exactly as the
 * XSLT emits (callers wrap it in spans/anchors).
 */
import type { FrTree } from "./ast";
import type { RenderIndex } from "./context";

export const NBSP = "\u00A0";

export interface TaxonParams {
  readonly suffix: string;
  readonly taxon: string;
  readonly number: string;
  readonly fallbackNumber: string;
  readonly inBackmatter: boolean;
}

const defaults = (tree: FrTree, index: RenderIndex, p: Partial<TaxonParams>): TaxonParams => ({
  suffix: p.suffix ?? "",
  taxon: p.taxon ?? tree.frontmatter.taxon ?? "",
  number: p.number ?? tree.frontmatter.number ?? "",
  fallbackNumber: p.fallbackNumber ?? "",
  inBackmatter: p.inBackmatter ?? index.inBackmatter(tree),
});

/** `should-number` — mind XPath precedence: `and` binds tighter than `or`. */
export const shouldNumber = (tree: FrTree, index: RenderIndex, params: TaxonParams): boolean => {
  if (params.number !== "") return true;
  const treeIsRoot = index.isRoot(tree);
  const explicitlyUnnumbered = index.explicitlyUnnumbered(tree);
  const implicitlyUnnumbered = index.siblingTreeCount(tree) === 1 && index.childTreeCount(tree) <= 1;
  return (!params.inBackmatter && !treeIsRoot && !explicitlyUnnumbered) && !implicitlyUnnumbered;
};

/** `mode="tree-taxon-with-number"` — taxon prefix + (number | fallback) + suffix. */
export const taxonWithNumber = (
  tree: FrTree,
  index: RenderIndex,
  partial: Partial<TaxonParams> = {},
): string => {
  const p = defaults(tree, index, partial);
  const sn = shouldNumber(tree, index, p);
  let out = "";
  if (p.taxon !== "") {
    out += p.taxon;
    if (sn || p.fallbackNumber !== "") out += NBSP;
  }
  if (sn) {
    out += p.number === "" ? index.numberOf(tree) : p.number;
  } else if (p.fallbackNumber !== "") {
    out += p.fallbackNumber;
  }
  if (p.taxon !== "" || p.fallbackNumber !== "" || sn) out += p.suffix;
  return out;
};

/** `mode="contextual-number"` — like above but no taxon prefix. */
export const contextualNumber = (
  tree: FrTree,
  index: RenderIndex,
  partial: Partial<TaxonParams> = {},
): string => {
  const p = defaults(tree, index, partial);
  const sn = shouldNumber(tree, index, p);
  let out = "";
  if (sn) {
    out += p.number === "" ? index.numberOf(tree) : p.number;
  } else if (p.fallbackNumber !== "") {
    out += p.fallbackNumber;
  }
  if (p.fallbackNumber !== "" || sn) out += p.suffix;
  return out;
};
