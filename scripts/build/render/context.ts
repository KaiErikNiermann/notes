/**
 * Shared render types: the precomputed {@link RenderIndex} (the TS equivalents
 * of XSLT's `generate-id`, `xsl:key`, and `xsl:number`) and the threaded
 * {@link RenderContext}.
 */
import type { Comment, Footnote, FrTree } from "./ast";
import type { Artifact } from "./artifacts";
import type { StyleSpec } from "./style";
import type { FlagField, SigDiagnostic } from "./sig";

export interface RenderIndex {
  /** `generate-id()` — stable per-node anchor id (string differs from libxslt). */
  readonly idOf: (node: FrTree | Footnote) => string;
  /** `xsl:number level=multiple` result for a tree ("" when it has no number). */
  readonly numberOf: (tree: FrTree) => string;
  /** `xsl:key tree-with-uri` — frontmatter uri → tree (mainmatter sections). */
  readonly uriToTree: ReadonlyMap<string, FrTree>;
  /** `xsl:key footnotes-by-tree` — footnotes under a given tree, in order. */
  readonly footnotesOf: (tree: FrTree) => readonly Footnote[];
  /** `xsl:number level=any count=footnote from=tree` — 1-based seq in its tree. */
  readonly footnoteSeq: (note: Footnote) => number;

  // artifacts (per-tree attachments, see artifacts.ts) ----------------------
  /** Artifacts declared on a tree's frontmatter, in declaration order. */
  readonly artifactsOf: (tree: FrTree) => readonly Artifact[];
  /** 1-based sequence of an artifact within its tree (for citation-style markers). */
  readonly artifactSeq: (a: Artifact) => number;
  /** Look up an artifact in a tree by its display-path key (for inline refs). */
  readonly artifactByKey: (tree: FrTree, key: string) => Artifact | undefined;
  /** Stable on-page anchor id of an artifact's row (the jump target). */
  readonly artifactId: (a: Artifact) => string;

  /** Per-block visual style (`\meta{style:<id>}`) for a tree, by data-style-id. */
  readonly styleFor: (tree: FrTree, id: string) => StyleSpec | undefined;

  // margin comments (\comment, see content.ts/render.ts) ---------------------
  /** Margin comments owned by a tree, in document order. */
  readonly commentsOf: (tree: FrTree) => readonly Comment[];
  /** 1-based sequence of a comment within its tree. */
  readonly commentSeq: (c: Comment) => number;
  /** Stable anchor id shared by the inline anchor and the margin card. */
  readonly commentId: (c: Comment) => string;

  // structural facts for the should-number predicate -------------------------
  /** True only for the document root tree (`not(parent::*)`). */
  readonly isRoot: (tree: FrTree) => boolean;
  /** True if the tree lives inside any backmatter. */
  readonly inBackmatter: (tree: FrTree) => boolean;
  /** `ancestor-or-self::tree[@numbered='false' or @toc='false']`. */
  readonly explicitlyUnnumbered: (tree: FrTree) => boolean;
  /** `count(../f:tree)` — number of sibling section trees (incl. self). */
  readonly siblingTreeCount: (tree: FrTree) => number;
  /** `count(f:mainmatter/f:tree)` — number of child section trees. */
  readonly childTreeCount: (tree: FrTree) => number;
}

export interface RenderContext {
  readonly baseUrl: string;
  readonly index: RenderIndex;
  /** Whether the current render position is inside a backmatter (for refs). */
  readonly inBackmatter: boolean;
  /** The tree that owns the content currently being rendered (artifact-ref scope). */
  readonly currentTree: FrTree;
  /** `\embed` opts flag schema (from the construct `%! sig`); falls back to the
   *  renderer's default when absent (sig-less callers like the renderer tests). */
  readonly embedFlags?: readonly FlagField[];
  /** Sink for construct-option validation diagnostics (build-time warnings). */
  readonly onSigDiagnostic?: (d: SigDiagnostic) => void;
}
