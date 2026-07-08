/**
 * index-pass.ts — one walk over the parsed document that precomputes everything
 * the XSLT got from `generate-id()`, `xsl:key`, and `xsl:number`:
 *
 *  - stable anchor ids per tree/footnote (generate-id equivalent),
 *  - `numberOf`  — `xsl:number level=multiple` section numbers,
 *  - `uriToTree` — the `tree-with-uri` key (mainmatter sections by frontmatter uri),
 *  - `footnotesOf` / `footnoteSeq` — footnotes grouped + sequenced per tree,
 *  - structural facts (isRoot / inBackmatter / explicitlyUnnumbered /
 *    sibling+child tree counts) feeding the should-number predicate.
 */
import type { Comment, Content, Footnote, FrTree } from "./ast";
import type { RenderIndex } from "./context";
import { collectArtifacts, type Artifact } from "./artifacts";
import { collectStyles, type StyleSpec } from "./style";

const childTreesOf = (nodes: readonly Content[]): FrTree[] =>
  nodes.filter((n): n is FrTree => n.type === "tree");

const isCountedSection = (t: FrTree): boolean =>
  t.attrs["toc"] !== "false" && t.attrs["numbered"] !== "false";

/** Footnotes owned by a tree: those in its content, not descending into subtrees. */
const collectFootnotes = (nodes: readonly Content[], out: Footnote[]): void => {
  for (const n of nodes) {
    if (n.type === "tree") continue; // belongs to that subtree
    if (n.type === "footnote") {
      out.push(n);
      collectFootnotes(n.children, out); // footnotes can nest in footnotes
    } else if ("children" in n) {
      collectFootnotes(n.children, out);
    } else if (n.type === "resource") {
      collectFootnotes(n.content, out);
    }
  }
};

/** Margin comments owned by a tree (not descending into subtrees), in order. */
const collectComments = (nodes: readonly Content[], out: Comment[]): void => {
  for (const n of nodes) {
    if (n.type === "tree") continue; // belongs to that subtree
    if (n.type === "comment") {
      out.push(n);
      collectComments(n.anchored, out);
      collectComments(n.note, out);
    } else if ("children" in n) {
      collectComments(n.children, out);
    } else if (n.type === "resource") {
      collectComments(n.content, out);
    }
  }
};

export const buildIndex = (root: FrTree): RenderIndex => {
  const ids = new Map<FrTree | Footnote, string>();
  const numbers = new Map<FrTree, string>();
  const uriToTree = new Map<string, FrTree>();
  const footnotesByTree = new Map<FrTree, Footnote[]>();
  const footnoteSeqMap = new Map<Footnote, number>();
  const artifactsByTree = new Map<FrTree, Artifact[]>();
  const artifactSeqMap = new Map<Artifact, number>();
  const artifactIdMap = new Map<Artifact, string>();
  const artifactByKeyMap = new Map<FrTree, Map<string, Artifact>>();
  const stylesByTree = new Map<FrTree, Map<string, StyleSpec>>();
  const commentsByTree = new Map<FrTree, Comment[]>();
  const commentSeqMap = new Map<Comment, number>();
  const commentIdMap = new Map<Comment, string>();
  const inBackmatterSet = new Set<FrTree>();
  const explicitUnnumbered = new Set<FrTree>();
  const siblingCount = new Map<FrTree, number>();
  const childCount = new Map<FrTree, number>();

  let counter = 0;
  const assignId = (node: FrTree | Footnote): string => {
    const existing = ids.get(node);
    if (existing) return existing;
    const id = `n${++counter}`;
    ids.set(node, id);
    return id;
  };

  // Artifacts share the same counter (one unified `n<k>` anchor namespace) but a
  // dedicated map, so the public `idOf` signature stays `FrTree | Footnote`.
  const assignArtifactId = (a: Artifact): string => {
    const existing = artifactIdMap.get(a);
    if (existing) return existing;
    const id = `n${++counter}`;
    artifactIdMap.set(a, id);
    return id;
  };

  // Comments share the unified `n<k>` namespace via a dedicated map too.
  const assignCommentId = (c: Comment): string => {
    const existing = commentIdMap.get(c);
    if (existing) return existing;
    const id = `n${++counter}`;
    commentIdMap.set(c, id);
    return id;
  };

  /**
   * @param segments  accumulated section-number segments from matching ancestors
   * @param ancestorUnnumbered  some ancestor-or-self had numbered/toc=false
   * @param inBackmatter  this tree sits inside a backmatter
   */
  const walk = (
    tree: FrTree,
    siblings: number,
    segments: readonly number[],
    ancestorUnnumbered: boolean,
    inBackmatter: boolean,
  ): void => {
    assignId(tree);
    if (inBackmatter) inBackmatterSet.add(tree);
    const selfUnnumbered = tree.attrs["numbered"] === "false" || tree.attrs["toc"] === "false";
    const unnumbered = ancestorUnnumbered || selfUnnumbered;
    if (unnumbered) explicitUnnumbered.add(tree);
    siblingCount.set(tree, siblings);

    if (tree.frontmatter.uri) uriToTree.set(tree.frontmatter.uri, tree);

    // footnotes directly owned by this tree
    const fns: Footnote[] = [];
    collectFootnotes(tree.mainmatter, fns);
    collectFootnotes(tree.backmatter, fns);
    footnotesByTree.set(tree, fns);
    for (const [i, f] of fns.entries()) { assignId(f); footnoteSeqMap.set(f, i + 1); }

    // artifacts declared on this tree's frontmatter (per-tree, like footnotes:
    // walk runs on every tree incl. transcluded children, so a child's artifacts
    // attach to the child, not the parent).
    const arts = collectArtifacts(tree.frontmatter.metas);
    artifactsByTree.set(tree, arts);
    const byKey = new Map<string, Artifact>();
    for (const [i, a] of arts.entries()) { assignArtifactId(a); artifactSeqMap.set(a, i + 1); byKey.set(a.key, a); }
    artifactByKeyMap.set(tree, byKey);

    // per-block visual style metas (\meta{style:<id>}{...}) for this tree
    stylesByTree.set(tree, collectStyles(tree.frontmatter.metas));

    // margin comments owned by this tree (per-tree, like footnotes)
    const cmts: Comment[] = [];
    collectComments(tree.mainmatter, cmts);
    collectComments(tree.backmatter, cmts);
    commentsByTree.set(tree, cmts);
    for (const [i, c] of cmts.entries()) { assignCommentId(c); commentSeqMap.set(c, i + 1); }

    const mainTrees = childTreesOf(tree.mainmatter);
    const backTrees = childTreesOf(tree.backmatter);
    childCount.set(tree, mainTrees.length);

    // xsl:number level=multiple — per-container counter of matching siblings.
    const recurse = (container: FrTree[], childInBackmatter: boolean): void => {
      let matchCounter = 0;
      for (const child of container) {
        const matches = isCountedSection(child);
        let childSegments: readonly number[] = segments;
        if (matches) {
          matchCounter += 1;
          childSegments = [...segments, matchCounter];
          numbers.set(child, childSegments.join("."));
        }
        walk(child, container.length, childSegments, unnumbered, childInBackmatter);
      }
    };
    recurse(mainTrees, inBackmatter);
    recurse(backTrees, true);
  };

  walk(root, 1, [], false, false);

  return {
    idOf: (node) => assignId(node),
    numberOf: (tree) => numbers.get(tree) ?? "",
    uriToTree,
    footnotesOf: (tree) => footnotesByTree.get(tree) ?? [],
    footnoteSeq: (note) => footnoteSeqMap.get(note) ?? 0,
    artifactsOf: (tree) => artifactsByTree.get(tree) ?? [],
    artifactSeq: (a) => artifactSeqMap.get(a) ?? 0,
    artifactByKey: (tree, key) => artifactByKeyMap.get(tree)?.get(key),
    artifactId: (a) => artifactIdMap.get(a) ?? "",
    styleFor: (tree, id) => stylesByTree.get(tree)?.get(id),
    commentsOf: (tree) => commentsByTree.get(tree) ?? [],
    commentSeq: (c) => commentSeqMap.get(c) ?? 0,
    commentId: (c) => commentIdMap.get(c) ?? "",
    isRoot: (tree) => tree === root,
    inBackmatter: (tree) => inBackmatterSet.has(tree),
    explicitlyUnnumbered: (tree) => explicitUnnumbered.has(tree),
    siblingTreeCount: (tree) => siblingCount.get(tree) ?? 1,
    childTreeCount: (tree) => childCount.get(tree) ?? 0,
  };
};
